import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { ok, err, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ILangfuseTrace } from '@/common/types';

import { TEnv } from '@/config';
import {
  TErrorResult,
  TQuestion,
  ValidationResultSchema,
  TValidationResult,
  TLlmUsage,
  ZERO_LLM_USAGE,
} from '@/common/types';
import { serializeError, withLlmRetry } from '@/utils';
import { AppInsightsMetricsService } from '@/common/services';

@Injectable()
export class ValidatorService {
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    private readonly config: ConfigService<TEnv, true>,
    @InjectPinoLogger(ValidatorService.name)
    private readonly logger: PinoLogger,
    private readonly metricsService: AppInsightsMetricsService,
  ) {
    const azure = createAzure({
      resourceName: config.get('AZURE_OPENAI_RESOURCE'),
      apiKey: config.get('AZURE_OPENAI_KEY'),
    });

    this.model = azure(config.get('AZURE_OPENAI_DEPLOYMENT_GPT4O'));
  }

  async validate(
    question: TQuestion,
    trace?: ILangfuseTrace,
  ): Promise<Result<TValidationResult & { usage: TLlmUsage }, TErrorResult>> {
    // Stage 1: rule-based checks (no LLM)
    const ruleIssues = this.runRuleChecks(question);
    if (ruleIssues.length > 0) {
      return ok({ isValid: false, issues: ruleIssues, usage: ZERO_LLM_USAGE });
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

    const generation = trace?.generation({
      name: 'llm:validate-question',
      input: { prompt },
    });

    try {
      const result = await withLlmRetry(
        (idempotencyKey) =>
          generateObject({
            model: this.model,
            schema: ValidationResultSchema,
            prompt,
            headers: { 'Idempotency-Key': idempotencyKey },
          }),
        {
          onRetry: (attempt) =>
            this.metricsService.trackLlmRetry('validator', attempt),
        },
      );

      const promptTokens = result.usage.inputTokens ?? 0;
      const completionTokens = result.usage.outputTokens ?? 0;
      const usage: TLlmUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };

      generation?.end({
        output: result.object,
        usage: {
          input: usage.promptTokens,
          output: usage.completionTokens,
          total: usage.totalTokens,
        },
      });

      return ok({ ...result.object, usage });
    } catch (error) {
      generation?.end({ output: { error: serializeError(error) } });
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
