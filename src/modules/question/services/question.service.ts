import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { inArray, sql } from 'drizzle-orm';

import { TEnv } from '@/config';
import { serializeError } from '@/utils';
import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import {
  TQuestion,
  CreateQuestionPayloadSchema,
  TSaveQuestionResponse,
  TErrorResult,
  TExtraTag,
  TOPIC_TAG_NAME,
  DIFFICULTY_TAG_NAME,
  TYPE_TAG_NAME,
} from '@/common/types';
import {
  QuestionDifficultySchema,
  QuestionStatus,
  QuestionType,
  TQuestionType,
} from '@/db/schemas/question.schema';
import {
  Categories,
  Topics,
  Questions,
  questionOptions,
  questionTags,
} from '@/db/schemas';

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
    subject: string,
    difficulty: z.infer<typeof QuestionDifficultySchema>,
    questionType: TQuestionType,
    extraTags: TExtraTag[] = [],
  ): Promise<Result<TSaveQuestionResponse, TErrorResult>> {
    const payload = CreateQuestionPayloadSchema.parse({
      statement: question.stem,
      solution:
        question.questionType === QuestionType.Grouped
          ? ''
          : question.questionType === QuestionType.Mcqs
            ? question.explanation
            : question.solution,
      imageUrl: null,
      options:
        question.questionType === QuestionType.Mcqs
          ? question.options.map((option, index) => ({
              option,
              isCorrect: index === question.correctAnswerIndex,
            }))
          : [],
      childQuestions:
        question.questionType === QuestionType.Grouped
          ? question.childQuestions.map((child) => ({
              statement: child.stem,
              solution: child.explanation,
              imageUrl: null,
              options: child.options.map((option, index) => ({
                option,
                isCorrect: index === child.correctAnswerIndex,
              })),
              childQuestions: [],
              tags: [],
            }))
          : [],
      tags: [
        { name: TOPIC_TAG_NAME, value: topic },
        { name: DIFFICULTY_TAG_NAME, value: difficulty },
        { name: TYPE_TAG_NAME, value: questionType },
        ...extraTags,
      ],
    });

    try {
      const questionId = await this.db.transaction(async (tx) => {
        // -------------------------
        // 1. CATEGORY (check-or-create)
        // -------------------------
        const [existingCategory] = await tx
          .select({ Id: Categories.Id })
          .from(Categories)
          .where(sql`LOWER(${Categories.Name}) = ${subject.toLowerCase()}`)
          .limit(1);

        let resolvedCategoryId: string;
        if (existingCategory) {
          resolvedCategoryId = existingCategory.Id;
        } else {
          const [newCategory] = await tx
            .insert(Categories)
            .values({ Name: subject, Description: '' })
            .returning({ Id: Categories.Id });
          resolvedCategoryId = newCategory.Id;
        }

        // -------------------------
        // 2. TOPIC (check-or-create)
        // -------------------------
        const [existingTopic] = await tx
          .select({ Id: Topics.Id })
          .from(Topics)
          .where(sql`LOWER(${Topics.Name}) = ${topic.toLowerCase()}`)
          .limit(1);

        let resolvedTopicId: string;
        if (existingTopic) {
          resolvedTopicId = existingTopic.Id;
        } else {
          const [newTopic] = await tx
            .insert(Topics)
            .values({
              Name: topic,
              Description: '',
              CategoryId: resolvedCategoryId,
            })
            .returning({ Id: Topics.Id });
          resolvedTopicId = newTopic.Id;
        }

        // -------------------------
        // 3. QUESTION
        // -------------------------
        const [newQuestion] = await tx
          .insert(Questions)
          .values({
            Statement: payload.statement,
            Solution: payload.solution,
            ImageUrl: payload.imageUrl ?? null,
            TopicId: resolvedTopicId,
            Status: QuestionStatus.Draft,
          })
          .returning({ Id: Questions.Id });
        const qId = newQuestion.Id;

        // -------------------------
        // 4. OPTIONS
        // -------------------------
        if (payload.options.length > 0) {
          await tx.insert(questionOptions).values(
            payload.options.map((opt) => ({
              Option: opt.option,
              IsCorrect: opt.isCorrect,
              QuestionId: qId,
            })),
          );
        }

        // -------------------------
        // 5. TAGS
        // -------------------------
        if (payload.tags.length > 0) {
          await tx.insert(questionTags).values(
            payload.tags.map((tag) => ({
              Name: tag.name,
              Value: tag.value,
              QuestionId: qId,
            })) as (typeof questionTags.$inferInsert)[],
          );
        }

        return qId;
      });

      return ok({ id: questionId });
    } catch (error) {
      this.logger.error({
        message: 'Failed to save question',
        data: { error: serializeError(error) },
      });

      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to save question',
      });
    }
  }

  async getQuestionTexts(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ Statement: Questions.Statement })
      .from(Questions)
      .where(inArray(Questions.Id, ids));
    return rows.map((r) => r.Statement);
  }
}
