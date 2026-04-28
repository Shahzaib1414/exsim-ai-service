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
  TQuestionDifficulty,
  TagsResultSchema,
  TExtraTag,
  TLlmUsage,
} from '@/common/types';
import { serializeError, withLlmRetry } from '@/utils';
import { AppInsightsMetricsService } from '@/common/services';

@Injectable()
export class TaggerService {
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    private readonly config: ConfigService<TEnv, true>,
    @InjectPinoLogger(TaggerService.name)
    private readonly logger: PinoLogger,
    private readonly metricsService: AppInsightsMetricsService,
  ) {
    const azure = createAzure({
      resourceName: config.get('AZURE_OPENAI_RESOURCE'),
      apiKey: config.get('AZURE_OPENAI_KEY'),
    });

    this.model = azure(config.get('AZURE_OPENAI_DEPLOYMENT_GPT4O'));
  }

  async tag(
    question: TQuestion,
    subject: string,
    topic: string,
    difficulty: TQuestionDifficulty,
    trace?: ILangfuseTrace,
  ): Promise<
    Result<{ extraTags: TExtraTag[]; usage: TLlmUsage }, TErrorResult>
  > {
    const prompt = `You are an educational metadata specialist. Analyze the following exam question and assign metadata tags.

Subject: ${subject}
Topic: ${topic}
Difficulty: ${difficulty}

Question stem: "${question.stem}"
Options:
${question.options.map((o, i) => `  ${i}. ${o}`).join('\n')}
Correct answer index: ${question.correctAnswerIndex}
Explanation: "${question.explanation}"

Determine:
1. bloomsLevel: Which level of Bloom's Taxonomy does this question target? Choose one of: Remember, Understand, Apply, Analyze, Evaluate, Create.
2. gradeLevel: What is the most appropriate grade or academic level for this question? (e.g. "Grade 8", "Grade 10", "Undergraduate Year 1")`;

    const generation = trace?.generation({
      name: 'llm:tag-question',
      input: { prompt },
    });

    try {
      const result = await withLlmRetry(
        (idempotencyKey) =>
          generateObject({
            model: this.model,
            schema: TagsResultSchema,
            prompt,
            headers: { 'Idempotency-Key': idempotencyKey },
          }),
        {
          onRetry: (attempt) =>
            this.metricsService.trackLlmRetry('tagger', attempt),
        },
      );

      const promptTokens = result.usage.inputTokens ?? 0;
      const completionTokens = result.usage.outputTokens ?? 0;
      const usage: TLlmUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };

      const extraTags: TExtraTag[] = [
        { name: 'bloomsLevel', value: result.object.bloomsLevel },
        { name: 'gradeLevel', value: result.object.gradeLevel },
      ];

      generation?.end({
        output: result.object,
        usage: {
          input: usage.promptTokens,
          output: usage.completionTokens,
          total: usage.totalTokens,
        },
      });

      return ok({ extraTags, usage });
    } catch (error) {
      generation?.end({ output: { error: serializeError(error) } });
      this.logger.error({
        message: 'Failed to tag question via LLM',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to tag question',
      });
    }
  }
}
