import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { err, ok, Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { TEnv } from '@/config';
import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import {
  QuestionSchema,
  TQuestion,
  TErrorResult,
  buildEmbeddingText,
} from '@/common/types';
import { EmbeddingService } from '@/modules/embedding/services/embedding.service';
import { QuestionService } from '@/modules/question/services/question.service';
import { DeduplicatorService } from '@/modules/deduplicator/services/deduplicator.service';
import { ValidatorService } from '@/modules/validator/services/validator.service';
import { TaggerService } from '@/modules/tagger/services/tagger.service';
import { GroundingService } from '@/modules/grounding/services/grounding.service';
import { QuestionEmbeddings } from '@/db/schemas/question-embedding.schema';
import { serializeError } from '@/utils';
import type { TGenerateOneInput } from '@/common/types';

const MAX_ATTEMPTS = 3;

@Injectable()
export class GeneratorService extends BaseService {
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
  ) {
    super(db);

    const azure = createAzure({
      resourceName: config.get('AZURE_OPENAI_RESOURCE'),
      apiKey: config.get('AZURE_OPENAI_KEY'),
    });

    this.model = azure(config.get('AZURE_OPENAI_DEPLOYMENT_GPT4O'));
  }

  async generateOne({
    subject,
    topic,
    difficulty,
  }: TGenerateOneInput): Promise<
    Result<TQuestion & { questionId: string }, TErrorResult>
  > {
    // Retrieve grounding context once before the retry loop
    const groundingContext = await this.fetchGroundingContext(subject, topic);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Step 1: Generate question via LLM
      const llmResult = await this.callLlm(
        subject,
        topic,
        difficulty,
        groundingContext,
      );
      if (llmResult.isErr()) return err(llmResult.error);
      const question = llmResult.value;

      // Step 2: Generate embedding
      const embeddingText = buildEmbeddingText(question.stem, question.options);
      const embeddingResult =
        await this.embeddingService.embedText(embeddingText);
      if (embeddingResult.isErr()) return err(embeddingResult.error);
      const embedding = embeddingResult.value;

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
          return err({
            status: HttpStatus.CONFLICT,
            message: 'failed to generate unique question after 3 attempts',
          });
        }

        continue;
      }

      // Step 4: Validate question quality
      const validationResult = await this.validatorService.validate(question);
      if (validationResult.isErr()) return err(validationResult.error);
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
      );
      if (tagResult.isErr()) return err(tagResult.error);

      // Step 6: Save question via .NET API
      const saveResult = await this.questionService.saveQuestion(
        question,
        topic,
        difficulty,
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

      return ok({ ...question, questionId });
    }

    // Unreachable — loop always returns, satisfies TypeScript
    return err({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'failed to generate question after max attempts',
    });
  }

  private async fetchGroundingContext(
    subject: string,
    topic: string,
  ): Promise<string[]> {
    try {
      const queryEmbedResult = await this.embeddingService.embedText(
        `${subject} ${topic}`,
      );
      if (queryEmbedResult.isErr()) return [];

      const chunksResult = await this.groundingService.retrieveRelevantChunks(
        queryEmbedResult.value,
        subject,
        topic,
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
    groundingContext: string[] = [],
  ): Promise<Result<TQuestion, TErrorResult>> {
    const groundingBlock =
      groundingContext.length > 0
        ? `Use the following syllabus content as context when generating the question:\n<grounding>\n${groundingContext.join('\n\n---\n\n')}\n</grounding>\n\n`
        : '';

    const prompt = `${groundingBlock}Generate a multiple-choice exam question for the subject "${subject}", topic "${topic}", difficulty level "${difficulty}".
The question must have exactly 4 distinct answer options.
Return the index (0-3) of the correct answer and a brief explanation of why it is correct.`;

    try {
      const result = await generateObject({
        model: this.model,
        schema: QuestionSchema,
        prompt,
      });
      return ok(result.object);
    } catch (error) {
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
      await this.db.insert(QuestionEmbeddings).values({
        Id: randomUUID(),
        QuestionId: questionId,
        Embedding: embedding,
        ModelName: modelName,
        Created: new Date(),
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
