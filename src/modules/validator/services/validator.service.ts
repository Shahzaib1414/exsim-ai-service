import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { ok, err, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ILangfuseTrace } from '@/common/types';

import type { Config } from '@/config';
import {
  TErrorResult,
  TQuestion,
  ValidationResultSchema,
  TValidationResult,
  TLlmUsage,
  ZERO_LLM_USAGE,
} from '@/common/types';
import { QuestionType } from '@/db/schemas/question.schema';
import { serializeError, withLlmRetry, buildQuestionBody } from '@/utils';
import { AppInsightsMetricsService } from '@/common/services';

@Injectable()
export class ValidatorService {
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    private readonly config: ConfigService<Config, true>,
    @InjectPinoLogger(ValidatorService.name)
    private readonly logger: PinoLogger,
    private readonly metricsService: AppInsightsMetricsService,
  ) {
    const azure = this.config.get('azure', { infer: true });
    const client = createAzure({
      resourceName: azure.openai.resource,
      apiKey: azure.openai.key,
    });

    this.model = client(azure.openai.deployment);
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
    const questionTypeRules =
      question.questionType === QuestionType.Mcqs
        ? `MCQ-SPECIFIC RULES — REJECT if any fail:
  □ Exactly one option is unambiguously correct. If you can make a reasonable argument that two or
    more options are correct, REJECT immediately — do not give benefit of the doubt.
  □ The three incorrect options are plausible (a student with partial knowledge could pick any of
    them) but are definitively wrong based solely on the information in the stem.
  □ No two options are semantically equivalent or numerically identical under unit conversion
    (e.g., "200 g" and "0.2 kg" count as duplicates). REJECT if any pair could mean the same thing.
  □ No "all of the above" or "none of the above" option — these create inherent ambiguity.
  □ All options are at a similar level of detail and specificity. If one option is significantly
    longer, more carefully worded, or more precise than the others, it may telegraph the answer. REJECT.
  □ The correct answer does not rely on information absent from the stem.`
        : question.questionType === QuestionType.Closed
          ? `CLOSED (BINARY) RULES — REJECT if any fail:
  □ The stem's statement has exactly one definitive answer — no "it depends" interpretation is possible.
  □ The two options form a genuine binary pair (Yes/No, True/False, Agree/Disagree, etc.).
  □ The correct answer is not debatable among students who have studied the subject.`
          : question.questionType === QuestionType.Grouped
            ? `GROUPED QUESTION RULES — REJECT if any fail:
  □ The parent stem provides sufficient shared context for ALL child questions.
  □ Each child question has exactly one unambiguously correct answer.
  □ No two child questions test the exact same sub-concept.
  □ Child question answers do not hint at or reveal each other's correct answers.`
            : `OPEN-ENDED RULES — REJECT if any fail:
  □ The question has a single objectively correct and complete answer.
  □ The solution is not opinion-based, context-dependent, or open to multiple valid interpretations.
  □ The solution provided is accurate, complete, and well-structured.`;

    const prompt = `You are a strict exam question quality auditor. Your role is to REJECT questions that could generate disputes, have multiple defensible answers, or test ambiguous knowledge. When in doubt, REJECT.

${buildQuestionBody(question)}

UNIVERSAL RULES (apply to all question types — REJECT if any fail):
  □ The stem contains ALL information needed to answer the question. Students must not need any
    external knowledge or context beyond what is explicitly stated in the stem.
  □ The stem does not use double negatives (e.g., "NOT unlikely", "cannot fail to", "not incorrect").
  □ The question does not have a time-dependent answer (e.g., "who currently holds the record").
  □ The question is not opinion-based, culturally relative, or dependent on unstated assumptions.
  □ The question tests exactly one concept — not multiple unrelated skills simultaneously.

${questionTypeRules}

ANSWER INTEGRITY — REJECT if any fail:
  □ The explanation correctly and fully justifies why the correct answer is right.
  □ The explanation does not introduce information that was necessary to answer the question but
    was absent from the stem. If the explanation reveals missing context, REJECT the whole question.
  □ The explanation does not contradict the correct answer or any of the options.

Return isValid=true ONLY if every applicable rule above passes.
For each failing rule, state the specific issue clearly and concisely so the question can be corrected
or regenerated. Name the problematic option, the conflicting information, or the missing context.`;

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

    if (!question.stem.trim()) {
      issues.push('stem must not be empty');
    } else if (question.stem.trim().length < 10) {
      issues.push('stem is too short to be a meaningful question');
    }

    if (
      question.questionType === QuestionType.Mcqs ||
      question.questionType === QuestionType.Closed
    ) {
      const uniqueOptions = new Set(
        question.options.map((o) => o.trim().toLowerCase()),
      );
      if (uniqueOptions.size !== question.options.length) {
        issues.push('options must all be distinct');
      }
      if (question.options.some((o) => !o.trim())) {
        issues.push('all options must be non-empty');
      }
      if (!question.explanation.trim()) {
        issues.push('explanation must not be empty');
      } else if (question.explanation.trim().length < 10) {
        issues.push('explanation is too short to be meaningful');
      }
    }

    if (question.questionType === QuestionType.Grouped) {
      if (question.childQuestions.length === 0) {
        issues.push('grouped question must have at least one child question');
      }
      for (const child of question.childQuestions) {
        if (!child.stem.trim()) {
          issues.push('all child question stems must be non-empty');
          break;
        }
      }
    }

    return issues;
  }
}
