import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { err, ok, Result } from 'neverthrow';
import { randomUUID } from 'crypto';

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
import { QuestionEmbeddings } from '@/db/schemas/question-embedding.schema';
import { serializeError } from '@/utils';
import type { TGenerateOneInput } from '@/common/types';

@Injectable()
export class GeneratorService extends BaseService {
  protected readonly logger = new Logger(GeneratorService.name);
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    private readonly config: ConfigService<TEnv, true>,
    private readonly embeddingService: EmbeddingService,
    private readonly questionService: QuestionService,
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
  }: TGenerateOneInput): Promise<Result<TQuestion, TErrorResult>> {
    const prompt = `Generate a multiple-choice exam question for the subject "${subject}", topic "${topic}", difficulty level "${difficulty}".
The question must have exactly 4 distinct answer options.
Return the index (0-3) of the correct answer and a brief explanation of why it is correct.`;

    try {
      // Step 1: Generate question via LLM
      const result = await generateObject({
        model: this.model,
        schema: QuestionSchema,
        prompt,
      });
      const question = result.object;

      // Step 2: Generate embedding
      const embeddingText = buildEmbeddingText(question.stem, question.options);
      const embeddingResult =
        await this.embeddingService.embedText(embeddingText);
      if (embeddingResult.isErr()) {
        return err(embeddingResult.error);
      }
      const embedding = embeddingResult.value;

      // Step 3: Save question via .NET API
      const saveResult = await this.questionService.saveQuestion(
        question,
        topic,
        difficulty,
      );
      if (saveResult.isErr()) {
        return err(saveResult.error);
      }
      const { id: questionId } = saveResult.value;

      // Step 4: Store embedding
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

      return ok(question);
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
