import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { eq, inArray, sql } from 'drizzle-orm';

import type { Config } from '@/config';
import { serializeError } from '@/utils';
import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient, DrizzleTransaction } from '@/db';
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
  QuestionEmbeddings,
} from '@/db/schemas';

@Injectable()
export class QuestionService extends BaseService {
  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(QuestionService.name)
    private readonly logger: PinoLogger,
    private readonly httpService: HttpService,
    private readonly config: ConfigService<Config, true>,
  ) {
    super(db);
  }

  async saveQuestion(
    question: TQuestion,
    topic: string,
    subject: string,
    difficulty: z.infer<typeof QuestionDifficultySchema>,
    questionType: TQuestionType,
    extraTags: TExtraTag[] = [],
    duplicateQuestionIds?: string[],
  ): Promise<Result<TSaveQuestionResponse, TErrorResult>> {
    const payload = this.buildPayload(
      question,
      topic,
      difficulty,
      questionType,
      extraTags,
    );

    try {
      const questionId = await this.db.transaction(async (tx) => {
        const categoryId = await this.resolveCategory(tx, subject);
        const topicId = await this.resolveTopic(tx, topic, categoryId);
        const qId = await this.insertQuestionRow(tx, payload, topicId, {
          duplicateQuestionIds,
        });
        for (const child of payload.childQuestions) {
          await this.insertQuestionRow(tx, child, topicId, {
            parentQuestionId: qId,
          });
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

  private buildPayload(
    question: TQuestion,
    topic: string,
    difficulty: z.infer<typeof QuestionDifficultySchema>,
    questionType: TQuestionType,
    extraTags: TExtraTag[],
  ) {
    return CreateQuestionPayloadSchema.parse({
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
              tags: [
                { name: TOPIC_TAG_NAME, value: topic },
                { name: DIFFICULTY_TAG_NAME, value: difficulty },
                { name: TYPE_TAG_NAME, value: questionType },
              ],
            }))
          : [],
      tags: [
        { name: TOPIC_TAG_NAME, value: topic },
        { name: DIFFICULTY_TAG_NAME, value: difficulty },
        { name: TYPE_TAG_NAME, value: questionType },
        ...extraTags,
      ],
    });
  }

  private async resolveCategory(
    tx: DrizzleTransaction,
    subject: string,
  ): Promise<string> {
    const normalised = subject.trim().toLowerCase();
    const [existing] = await tx
      .select({ Id: Categories.Id })
      .from(Categories)
      .where(sql`LOWER(TRIM(${Categories.Name})) = ${normalised}`)
      .limit(1);
    if (existing) return existing.Id;
    const [created] = await tx
      .insert(Categories)
      .values({ Name: subject, Description: '' })
      .returning({ Id: Categories.Id });
    return created.Id;
  }

  private async resolveTopic(
    tx: DrizzleTransaction,
    topic: string,
    categoryId: string,
  ): Promise<string> {
    const normalised = topic.trim().toLowerCase();
    const [existing] = await tx
      .select({ Id: Topics.Id })
      .from(Topics)
      .where(sql`LOWER(TRIM(${Topics.Name})) = ${normalised}`)
      .limit(1);
    if (existing) return existing.Id;
    const [created] = await tx
      .insert(Topics)
      .values({ Name: topic, Description: '', CategoryId: categoryId })
      .returning({ Id: Topics.Id });
    return created.Id;
  }

  private async insertQuestionRow(
    tx: DrizzleTransaction,
    payload: ReturnType<typeof CreateQuestionPayloadSchema.parse>,
    topicId: string,
    opts: { duplicateQuestionIds?: string[]; parentQuestionId?: string } = {},
  ): Promise<string> {
    const [row] = await tx
      .insert(Questions)
      .values({
        Statement: payload.statement,
        Solution: payload.solution,
        ImageUrl: payload.imageUrl ?? null,
        TopicId: topicId,
        ParentQuestionId: opts.parentQuestionId ?? null,
        Status: opts.duplicateQuestionIds
          ? QuestionStatus.Duplicate
          : QuestionStatus.Draft,
        DuplicateQuestionIds: opts.duplicateQuestionIds?.join(',') ?? null,
      })
      .returning({ Id: Questions.Id });

    if (payload.options.length > 0) {
      await tx.insert(questionOptions).values(
        payload.options.map((opt) => ({
          Option: opt.option,
          IsCorrect: opt.isCorrect,
          QuestionId: row.Id,
        })),
      );
    }

    if (payload.tags.length > 0) {
      await tx.insert(questionTags).values(
        payload.tags.map((tag) => ({
          Name: tag.name,
          Value: tag.value,
          QuestionId: row.Id,
        })) as (typeof questionTags.$inferInsert)[],
      );
    }

    return row.Id;
  }

  async deleteQuestion(
    questionId: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(QuestionEmbeddings)
          .where(eq(QuestionEmbeddings.QuestionId, questionId));
        await tx
          .delete(questionTags)
          .where(eq(questionTags.QuestionId, questionId));
        await tx
          .delete(questionOptions)
          .where(eq(questionOptions.QuestionId, questionId));
        await tx
          .delete(Questions)
          .where(eq(Questions.ParentQuestionId, questionId));
        await tx.delete(Questions).where(eq(Questions.Id, questionId));
      });
      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to delete question',
        data: { questionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to delete question',
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
