import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { TEnv } from '@/config';
import { serializeError } from '@/utils';
import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import {
  TQuestion,
  TCreateQuestionPayload,
  CreateQuestionPayloadSchema,
  TSaveQuestionResponse,
  TErrorResult,
  TExtraTag,
  TOPIC_TAG_NAME,
  DIFFICULTY_TAG_NAME,
  TYPE_TAG_NAME,
  QUESTION_TYPE,
} from '@/common/types';
import { QuestionDifficultySchema } from '@/db/schemas/question.schema';

@Injectable()
export class QuestionService extends BaseService {
  private readonly baseUrl: string;

  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(QuestionService.name)
    private readonly logger: PinoLogger,
    private readonly httpService: HttpService,
    private readonly config: ConfigService<TEnv, true>,
  ) {
    super(db);
    this.baseUrl = config.get('DOTNET_API_URL');
  }

  async saveQuestion(
    question: TQuestion,
    topic: string,
    difficulty: z.infer<typeof QuestionDifficultySchema>,
    extraTags: TExtraTag[] = [],
  ): Promise<Result<TSaveQuestionResponse, TErrorResult>> {
    const payload: TCreateQuestionPayload = CreateQuestionPayloadSchema.parse({
      statement: question.stem,
      solution: question.explanation,
      imageUrl: null,
      options: question.options.map((option, index) => ({
        option,
        isCorrect: index === question.correctAnswerIndex,
      })),
      childQuestions: [],
      tags: [
        { name: TOPIC_TAG_NAME, value: topic },
        { name: DIFFICULTY_TAG_NAME, value: difficulty },
        { name: TYPE_TAG_NAME, value: QUESTION_TYPE },
        ...extraTags,
      ],
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post<string>(`${this.baseUrl}/Questions`, payload),
      );

      return ok({ id: response.data });
    } catch (error) {
      this.logger.error({
        message: 'Failed to save question via .NET API',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to save question',
      });
    }
  }
}
