import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ILangfuseTrace } from '@/common/types';

import { TEnv } from '@/config';
import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import {
  TQuestion,
  TErrorResult,
  buildEmbeddingText,
  TLlmUsage,
  ZERO_LLM_USAGE,
  addLlmUsage,
  McqsQuestionSchema,
  GroupedQuestionSchema,
  OpenEndedQuestionSchema,
  TGenerateOneResult,
} from '@/common/types';
import { QuestionType, TQuestionType } from '@/db/schemas/question.schema';
import { EmbeddingService } from '@/modules/embedding/services/embedding.service';
import { QuestionService } from '@/modules/question/services/question.service';
import { DeduplicatorService } from '@/modules/deduplicator/services/deduplicator.service';
import { ValidatorService } from '@/modules/validator/services/validator.service';
import { TaggerService } from '@/modules/tagger/services/tagger.service';
import { GroundingService } from '@/modules/grounding/services/grounding.service';
import { QuestionEmbeddings } from '@/db/schemas/question-embedding.schema';
import { serializeError, withLlmRetry } from '@/utils';
import { AppInsightsMetricsService } from '@/common/services';
import type { TGenerateOneInput } from '@/common/types';

const MAX_ATTEMPTS = 3;

const QUESTION_SCHEMAS = {
  [QuestionType.Mcqs]: McqsQuestionSchema,
  [QuestionType.Grouped]: GroupedQuestionSchema,
  [QuestionType.Short]: OpenEndedQuestionSchema,
  [QuestionType.Comprehensive]: OpenEndedQuestionSchema,
  [QuestionType.Closed]: OpenEndedQuestionSchema,
};

const QUESTION_PROMPT_INSTRUCTIONS = {
  [QuestionType.Mcqs]:
    'The question must have exactly 4 distinct answer options. Return the index (0-3) of the correct answer and a brief explanation of why it is correct.',
  [QuestionType.Grouped]:
    'Create a parent question stem only — no options on the parent. Then create between 2 and 5 child questions, each with exactly 4 distinct answer options and the index (0-3) of the correct answer with an explanation.',
  [QuestionType.Short]:
    'Provide a concise model answer in the solution field. No options required.',
  [QuestionType.Comprehensive]:
    'Provide a detailed, structured model answer in the solution field. No options required.',
  [QuestionType.Closed]:
    'Provide a model answer in the solution field. No options required.',
};

@Injectable()
export class GeneratorService extends BaseService<typeof QuestionEmbeddings> {
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(GeneratorService.name)
    private readonly logger: PinoLogger,
    private readonly config: ConfigService<TEnv, true>,
    private readonly embeddingService: EmbeddingService,
    private readonly questionService: QuestionService,
    private readonly deduplicatorService: DeduplicatorService,
    private readonly validatorService: ValidatorService,
    private readonly taggerService: TaggerService,
    private readonly groundingService: GroundingService,
    private readonly metricsService: AppInsightsMetricsService,
  ) {
    super(db, QuestionEmbeddings);

    const azure = createAzure({
      resourceName: config.get('AZURE_OPENAI_RESOURCE'),
      apiKey: config.get('AZURE_OPENAI_KEY'),
    });

    this.model = azure(config.get('AZURE_OPENAI_DEPLOYMENT_GPT4O'));
  }

  async generateOne({
    examType,
    subject,
    topic,
    difficulty,
    grade,
    questionType,
    negativeExamples = [],
    trace,
  }: TGenerateOneInput & {
    trace?: ILangfuseTrace;
    negativeExamples?: string[];
  }): Promise<Result<TGenerateOneResult, TErrorResult>> {
    // Retrieve grounding context once before the retry loop
    const groundingContext = await this.fetchGroundingContext(
      examType,
      subject,
      topic,
      grade,
      questionType,
    );

    let accumulatedUsage: TLlmUsage = ZERO_LLM_USAGE;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Step 1: Generate question via LLM
      const llmResult = await this.callLlm(
        subject,
        topic,
        difficulty,
        grade,
        questionType,
        groundingContext,
        negativeExamples,
        trace,
      );
      if (llmResult.isErr()) return err(llmResult.error);
      const { question, usage: llmUsage } = llmResult.value;
      accumulatedUsage = addLlmUsage(accumulatedUsage, llmUsage);

      // Step 2: Generate embedding
      const embeddingText = buildEmbeddingText(question);
      const embeddingResult = await this.embeddingService.embedText(
        embeddingText,
        trace,
      );
      if (embeddingResult.isErr()) return err(embeddingResult.error);
      const { embedding } = embeddingResult.value;

      // Step 3: Deduplication check
      const dedupResult =
        await this.deduplicatorService.checkUniqueness(embedding);
      if (dedupResult.isErr()) {
        return err(dedupResult.error);
      }

      if (!dedupResult.value.isUnique) {
        this.logger.warn({
          message: 'Duplicate question detected',
          data: {
            attempt,
            similarQuestionIds: dedupResult.value.similarQuestionIds,
          },
        });

        if (attempt === MAX_ATTEMPTS) {
          return ok({
            needsReview: true,
            duplicateQuestionIds: dedupResult.value.similarQuestionIds,
          });
        }

        continue;
      }

      // Step 4: Validate question quality
      const validationResult = await this.validatorService.validate(
        question,
        trace,
      );
      if (validationResult.isErr()) return err(validationResult.error);
      accumulatedUsage = addLlmUsage(
        accumulatedUsage,
        validationResult.value.usage,
      );
      if (!validationResult.value.isValid) {
        return err({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message: `question failed validation: ${validationResult.value.issues.join('; ')}`,
        });
      }

      // Step 5: Tag question with metadata
      const tagResult = await this.taggerService.tag(
        question,
        subject,
        topic,
        difficulty,
        trace,
      );
      if (tagResult.isErr()) return err(tagResult.error);
      accumulatedUsage = addLlmUsage(accumulatedUsage, tagResult.value.usage);

      // Step 6: Save question
      const saveResult = await this.questionService.saveQuestion(
        question,
        topic,
        subject,
        difficulty,
        questionType,
        tagResult.value.extraTags,
      );
      if (saveResult.isErr()) return err(saveResult.error);
      const { id: questionId } = saveResult.value;

      // Step 7: Store embedding
      const storeResult = await this.storeEmbedding(
        questionId,
        embedding,
        this.embeddingService.modelName,
      );
      if (storeResult.isErr()) {
        this.logger.error({
          message:
            'Embedding write failed after question was saved — orphaned question',
          data: { questionId },
        });
        return err(storeResult.error);
      }

      trace?.update({ output: { questionId } });

      return ok({ needsReview: false, questionId, usage: accumulatedUsage });
    }

    // Unreachable — loop always returns, satisfies TypeScript
    return err({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'failed to generate question after max attempts',
    });
  }

  private async fetchGroundingContext(
    examType: string,
    subject: string,
    topic: string,
    grade: number,
    questionType: TQuestionType,
  ): Promise<string[]> {
    try {
      const queryEmbedResult = await this.embeddingService.embedText(
        `${subject} ${topic}`,
      );
      if (queryEmbedResult.isErr()) return [];

      const chunksResult = await this.groundingService.retrieveRelevantChunks(
        queryEmbedResult.value.embedding,
        { examType, subject, topic, grade, questionType },
      );
      return chunksResult.isOk() ? chunksResult.value : [];
    } catch {
      // Grounding failure must never abort generation
      return [];
    }
  }

  private async callLlm(
    subject: string,
    topic: string,
    difficulty: string,
    grade: number,
    questionType: TQuestionType,
    groundingContext: string[] = [],
    negativeExamples: string[] = [],
    trace?: ILangfuseTrace,
  ): Promise<Result<{ question: TQuestion; usage: TLlmUsage }, TErrorResult>> {
    const groundingBlock =
      groundingContext.length > 0
        ? `Use the following syllabus content as context when generating the question:\n<grounding>\n${groundingContext.join('\n\n---\n\n')}\n</grounding>\n\n`
        : '';

    const negativeBlock =
      negativeExamples.length > 0
        ? `\nDo NOT generate a question similar to any of the following existing questions:\n${negativeExamples.map((q, i) => `${i + 1}. "${q}"`).join('\n')}\n`
        : '';

    const prompt = `${groundingBlock}Generate a ${questionType} exam question for grade ${grade} students, subject "${subject}", topic "${topic}", difficulty level "${difficulty}".
${QUESTION_PROMPT_INSTRUCTIONS[questionType]}${negativeBlock}`;

    const generation = trace?.generation({
      name: 'llm:generate-question',
      input: { prompt },
    });

    try {
      const result = await withLlmRetry(
        (idempotencyKey) =>
          generateObject({
            model: this.model,
            schema: QUESTION_SCHEMAS[questionType],
            prompt,
            headers: { 'Idempotency-Key': idempotencyKey },
          }),
        {
          onRetry: (attempt) =>
            this.metricsService.trackLlmRetry('generator', attempt),
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

      const question = { ...result.object, questionType } as TQuestion;
      return ok({ question, usage });
    } catch (error) {
      generation?.end({ output: { error: serializeError(error) } });
      this.logger.error({
        message: 'Failed to generate question',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to generate question',
      });
    }
  }

  private async storeEmbedding(
    questionId: string,
    embedding: number[],
    modelName: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      await this.insertOne({
        QuestionId: questionId,
        Embedding: embedding,
        ModelName: modelName,
      });
      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to insert question embedding',
        data: { questionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to store question embedding',
      });
    }
  }
}
