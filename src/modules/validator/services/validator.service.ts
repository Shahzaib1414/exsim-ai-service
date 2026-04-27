import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { ok, err, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { TEnv } from '@/config';
import {
  TErrorResult,
  TQuestion,
  ValidationResultSchema,
  TValidationResult,
} from '@/common/types';
import { serializeError } from '@/utils';

@Injectable()
export class ValidatorService {
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    private readonly config: ConfigService<TEnv, true>,
    @InjectPinoLogger(ValidatorService.name)
    private readonly logger: PinoLogger,
  ) {
    const azure = createAzure({
      resourceName: config.get('AZURE_OPENAI_RESOURCE'),
      apiKey: config.get('AZURE_OPENAI_KEY'),
    });

    this.model = azure(config.get('AZURE_OPENAI_DEPLOYMENT_GPT4O'));
  }

  async validate(
    question: TQuestion,
  ): Promise<Result<TValidationResult, TErrorResult>> {
    // Stage 1: rule-based checks (no LLM)
    const ruleIssues = this.runRuleChecks(question);
    if (ruleIssues.length > 0) {
      return ok({ isValid: false, issues: ruleIssues });
    }

    // Stage 2: LLM quality check
    const prompt = `You are an exam question quality reviewer. Evaluate the following multiple-choice question and determine if it meets quality standards.

Question stem: "${question.stem}"
Options:
${question.options.map((o, i) => `  ${i}. ${o}`).join('\n')}
Correct answer index: ${question.correctAnswerIndex}
Explanation: "${question.explanation}"

Assess the following criteria:
- Is the stem clear and unambiguous?
- Are all distractors (wrong options) plausible and not obviously incorrect?
- Is the correct answer unambiguously correct?
- Is the explanation accurate and concise?

Return isValid=true only if all criteria pass. List any specific issues found.`;

    try {
      const result = await generateObject({
        model: this.model,
        schema: ValidationResultSchema,
        prompt,
      });
      return ok(result.object);
    } catch (error) {
      this.logger.error({
        message: 'Failed to validate question via LLM',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to validate question',
      });
    }
  }

  private runRuleChecks(question: TQuestion): string[] {
    const issues: string[] = [];

    const uniqueOptions = new Set(question.options);
    if (uniqueOptions.size !== question.options.length) {
      issues.push('options must all be distinct');
    }

    if (!question.stem.trim()) {
      issues.push('stem must not be empty');
    }

    if (!question.explanation.trim()) {
      issues.push('explanation must not be empty');
    }

    return issues;
  }
}
