import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq, and, sum, inArray } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import {
  QuestionBatches,
  QuestionBatchStatus,
  TQuestionBatchSelect,
} from '@/db/schemas/question-batch.schema';
import {
  QuestionBatchItems,
  QuestionBatchItemStatus,
  TQuestionBatchItemSelect,
} from '@/db/schemas/question-batch-item.schema';
import { QuestionStatus } from '@/db/schemas/question.schema';
import type { TAuthUserReq, TErrorResult, TLlmUsage } from '@/common/types';
import { serializeError, calculateGpt4oCost, formatCostUsd } from '@/utils';
import {
  InjectQuestionBatchItemQueue,
  PROCESS_QUESTION_BATCH_ITEM_JOB,
} from '@/queues';
import { createMediumFrequencyJobOptions } from '@/common/queue.types';
import {
  TCreateQuestionBatch,
  TQuestionBatchResponse,
  TQuestionBatchWithItemsResponse,
  TQuestionBatchItemJobData,
  TQuestionBatchItemResponse,
} from '@/common/types';
import { AppInsightsMetricsService } from '@/common/services';
import { QuestionService } from '@/modules/question/services/question.service';

@Injectable()
export class QuestionBatchService extends BaseService {
  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectQuestionBatchItemQueue()
    private readonly questionBatchItemQueue: Queue<TQuestionBatchItemJobData>,
    @InjectPinoLogger(QuestionBatchService.name)
    private readonly logger: PinoLogger,
    private readonly metricsService: AppInsightsMetricsService,
    private readonly questionService: QuestionService,
  ) {
    super(db);
  }

  async createQuestionBatch(
    dto: TCreateQuestionBatch,
    user: TAuthUserReq,
  ): Promise<Result<TQuestionBatchResponse, TErrorResult>> {
    try {
      // Batch row + all item rows are committed atomically.
      // Queue jobs are added only after the transaction succeeds so we never
      // enqueue jobs for a batch that was rolled back.
      const { questionBatchId, items } = await this.db.transaction(
        async (tx) => {
          const [batch] = await tx
            .insert(QuestionBatches)
            .values({
              MetaData: {
                examType: dto.examType,
                subject: dto.subject,
                topic: dto.topic,
                difficulty: dto.difficulty,
                grade: dto.grade,
                questionType: dto.questionType,
              },
              RequestedCount: dto.count,
              Status: QuestionBatchStatus.IN_PROGRESS,
            })
            .returning();

          const insertedItems = await tx
            .insert(QuestionBatchItems)
            .values(
              Array.from({ length: dto.count }, () => ({
                QuestionBatchId: batch.Id,
                Status: QuestionBatchItemStatus.PENDING,
                AttemptCount: 0,
              })),
            )
            .returning();

          return { questionBatchId: batch.Id, items: insertedItems };
        },
      );

      await Promise.all(
        items.map((item) =>
          this.questionBatchItemQueue.add(
            PROCESS_QUESTION_BATCH_ITEM_JOB,
            {
              questionBatchItemId: item.Id,
              questionBatchId,
              examType: dto.examType,
              subject: dto.subject,
              topic: dto.topic,
              difficulty: dto.difficulty,
              grade: dto.grade,
              questionType: dto.questionType,
              user,
            },
            createMediumFrequencyJobOptions(item.Id),
          ),
        ),
      );

      return ok({
        id: questionBatchId,
        metadata: {
          examType: dto.examType,
          subject: dto.subject,
          topic: dto.topic,
          difficulty: dto.difficulty,
          grade: dto.grade,
          questionType: dto.questionType,
        },
        requestedCount: dto.count,
        completedCount: 0,
        failedCount: 0,
        status: QuestionBatchStatus.IN_PROGRESS,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: '0.00',
      });
    } catch (error) {
      this.logger.error({
        message: 'Failed to create question batch',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to create question batch',
      });
    }
  }

  async getQuestionBatch(
    id: string,
  ): Promise<Result<TQuestionBatchResponse, TErrorResult>> {
    try {
      const rows = await this.db
        .select()
        .from(QuestionBatches)
        .where(eq(QuestionBatches.Id, id));
      const batch = rows[0];

      if (!batch) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'question batch not found',
        });
      }

      const items = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(eq(QuestionBatchItems.QuestionBatchId, id));

      return ok(this.toQuestionBatchResponse(batch, items));
    } catch (error) {
      this.logger.error({
        message: 'Failed to get batch',
        data: { id, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to get batch',
      });
    }
  }

  async listQuestionBatches(
    page: number,
    limit: number,
  ): Promise<Result<TQuestionBatchResponse[], TErrorResult>> {
    try {
      const batches = await this.db
        .select()
        .from(QuestionBatches)
        .limit(limit)
        .offset((page - 1) * limit);

      if (batches.length === 0) return ok([]);

      // Fetch all items for the current page in a single query, then group in
      // memory — eliminates the N+1 pattern of one query per batch row.
      const batchIds = batches.map((b) => b.Id);
      const allItems = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(inArray(QuestionBatchItems.QuestionBatchId, batchIds));

      const itemsByBatch = new Map<string, TQuestionBatchItemSelect[]>();
      for (const item of allItems) {
        const list = itemsByBatch.get(item.QuestionBatchId) ?? [];
        list.push(item);
        itemsByBatch.set(item.QuestionBatchId, list);
      }

      return ok(
        batches.map((batch) =>
          this.toQuestionBatchResponse(batch, itemsByBatch.get(batch.Id) ?? []),
        ),
      );
    } catch (error) {
      this.logger.error({
        message: 'Failed to list question batches',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to list question batches',
      });
    }
  }

  async getQuestionBatchItems(
    batchId: string,
    statusFilter?: TQuestionBatchItemSelect['Status'],
  ): Promise<Result<TQuestionBatchWithItemsResponse, TErrorResult>> {
    try {
      const batches = await this.db
        .select()
        .from(QuestionBatches)
        .where(eq(QuestionBatches.Id, batchId));
      const batch = batches[0];

      if (!batch) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch not found',
        });
      }

      const whereClause = statusFilter
        ? and(
            eq(QuestionBatchItems.QuestionBatchId, batchId),
            eq(QuestionBatchItems.Status, statusFilter),
          )
        : eq(QuestionBatchItems.QuestionBatchId, batchId);

      const items = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(whereClause);

      return ok({
        ...this.toQuestionBatchResponse(batch, items),
        items: items.map((item) => this.toQuestionBatchItemResponse(item)),
      });
    } catch (error) {
      this.logger.error({
        message: 'Failed to get batch items',
        data: { batchId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to get batch items',
      });
    }
  }

  async getItem(
    itemId: string,
  ): Promise<Result<TQuestionBatchItemSelect, TErrorResult>> {
    try {
      const rows = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(eq(QuestionBatchItems.Id, itemId));
      const item = rows[0];

      if (!item) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch item not found',
        });
      }

      return ok(item);
    } catch (error) {
      this.logger.error({
        message: 'Failed to get batch item',
        data: { itemId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to get batch item',
      });
    }
  }

  async markItemCompleted(
    itemId: string,
    questionId: string,
    usage: TLlmUsage,
  ): Promise<Result<void, TErrorResult>> {
    try {
      await this.updateIn(
        QuestionBatchItems,
        eq(QuestionBatchItems.Id, itemId),
        {
          Status: QuestionBatchItemStatus.COMPLETED,
          QuestionId: questionId,
          PromptTokens: usage.promptTokens,
          CompletionTokens: usage.completionTokens,
          TotalTokens: usage.totalTokens,
        },
      );
      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to mark item COMPLETED',
        data: { itemId, questionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to mark item COMPLETED',
      });
    }
  }

  async markItemFailed(
    itemId: string,
    errorMessage: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      const rows = await this.db
        .select({ AttemptCount: QuestionBatchItems.AttemptCount })
        .from(QuestionBatchItems)
        .where(eq(QuestionBatchItems.Id, itemId));

      const currentAttempts = rows[0]?.AttemptCount ?? 0;

      await this.updateIn(
        QuestionBatchItems,
        eq(QuestionBatchItems.Id, itemId),
        {
          Status: QuestionBatchItemStatus.FAILED,
          AttemptCount: currentAttempts + 1,
          ErrorMessage: errorMessage,
        },
      );

      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to mark item failed',
        data: { itemId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to mark item failed',
      });
    }
  }

  async updateQuestionBatchStatus(
    batchId: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      const items = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(eq(QuestionBatchItems.QuestionBatchId, batchId));

      const allTerminal = items.every(
        (i) =>
          i.Status === QuestionBatchItemStatus.COMPLETED ||
          i.Status === QuestionBatchItemStatus.FAILED,
      );

      if (!allTerminal) return ok(undefined);

      const anyFailed = items.some(
        (i) => i.Status === QuestionBatchItemStatus.FAILED,
      );
      const newStatus = anyFailed
        ? QuestionBatchStatus.FAILED
        : QuestionBatchStatus.COMPLETED;

      // Aggregate token counts across all items
      const tokenTotals = await this.db
        .select({
          totalPromptTokens: sum(QuestionBatchItems.PromptTokens),
          totalCompletionTokens: sum(QuestionBatchItems.CompletionTokens),
          totalTokens: sum(QuestionBatchItems.TotalTokens),
        })
        .from(QuestionBatchItems)
        .where(eq(QuestionBatchItems.QuestionBatchId, batchId));

      const pt = Number(tokenTotals[0]?.totalPromptTokens ?? 0);
      const ct = Number(tokenTotals[0]?.totalCompletionTokens ?? 0);
      const tt = Number(tokenTotals[0]?.totalTokens ?? 0);
      const estimatedCostUsd = formatCostUsd(
        calculateGpt4oCost({
          promptTokens: pt,
          completionTokens: ct,
          totalTokens: tt,
        }),
      );

      await this.updateIn(QuestionBatches, eq(QuestionBatches.Id, batchId), {
        Status: newStatus,
        TotalPromptTokens: pt,
        TotalCompletionTokens: ct,
        TotalTokens: tt,
        EstimatedCostUsd: estimatedCostUsd,
      });

      const failedCount = items.filter(
        (i) => i.Status === QuestionBatchItemStatus.FAILED,
      ).length;
      const failureRate = failedCount / items.length;
      this.metricsService.trackBatchCompletion(batchId, failureRate);

      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to update batch status',
        data: { batchId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to update batch status',
      });
    }
  }

  private toQuestionBatchResponse(
    batch: TQuestionBatchSelect,
    items: TQuestionBatchItemSelect[],
  ): TQuestionBatchResponse {
    return {
      id: batch.Id,
      metadata: batch.MetaData,
      requestedCount: batch.RequestedCount,
      completedCount: items.filter(
        (i) => i.Status === QuestionBatchItemStatus.COMPLETED,
      ).length,
      failedCount: items.filter(
        (i) => i.Status === QuestionBatchItemStatus.FAILED,
      ).length,
      status: batch.Status,
      totalPromptTokens: batch.TotalPromptTokens,
      totalCompletionTokens: batch.TotalCompletionTokens,
      totalTokens: batch.TotalTokens,
      estimatedCostUsd: batch.EstimatedCostUsd,
    };
  }

  async retryDuplicateItem(
    itemId: string,
    user: TAuthUserReq,
  ): Promise<Result<TQuestionBatchItemResponse, TErrorResult>> {
    try {
      const item = await this.db.query.QuestionBatchItems.findFirst({
        where: eq(QuestionBatchItems.Id, itemId),
        with: { question: true, batch: true },
      });

      if (!item) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch item not found',
        });
      }

      if (!item.question || item.question.Status !== QuestionStatus.Duplicate) {
        return err({
          status: HttpStatus.CONFLICT,
          message: 'associated question is not a duplicate',
        });
      }

      if (!item.batch) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch not found',
        });
      }

      const negativeExampleIds = item.question.DuplicateQuestionIds
        ? item.question.DuplicateQuestionIds.split(',').filter(Boolean)
        : [];

      const deleteResult = await this.questionService.deleteQuestion(
        item.question.Id,
      );
      if (deleteResult.isErr()) return err(deleteResult.error);

      await this.updateIn(
        QuestionBatchItems,
        eq(QuestionBatchItems.Id, itemId),
        {
          Status: QuestionBatchItemStatus.PENDING,
          QuestionId: null,
          ErrorMessage: null,
          PromptTokens: 0,
          CompletionTokens: 0,
          TotalTokens: 0,
        },
      );

      const { examType, subject, topic, difficulty, grade, questionType } =
        item.batch.MetaData;

      await this.questionBatchItemQueue.add(
        PROCESS_QUESTION_BATCH_ITEM_JOB,
        {
          questionBatchItemId: itemId,
          questionBatchId: item.QuestionBatchId,
          examType,
          subject,
          topic,
          difficulty,
          grade,
          questionType,
          negativeExampleIds,
          user,
        },
        createMediumFrequencyJobOptions(itemId),
      );

      const updatedRows = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(eq(QuestionBatchItems.Id, itemId));

      return ok(this.toQuestionBatchItemResponse(updatedRows[0]));
    } catch (error) {
      this.logger.error({
        message: 'Failed to retry duplicate item',
        data: { itemId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to retry duplicate item',
      });
    }
  }

  async discardDuplicateItem(
    itemId: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      const item = await this.db.query.QuestionBatchItems.findFirst({
        where: eq(QuestionBatchItems.Id, itemId),
        with: { question: true },
      });

      if (!item) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch item not found',
        });
      }

      if (!item.question || item.question.Status !== QuestionStatus.Duplicate) {
        return err({
          status: HttpStatus.CONFLICT,
          message: 'associated question is not a duplicate',
        });
      }

      const deleteResult = await this.questionService.deleteQuestion(
        item.question.Id,
      );
      if (deleteResult.isErr()) return err(deleteResult.error);

      await this.db
        .delete(QuestionBatchItems)
        .where(eq(QuestionBatchItems.Id, itemId));

      await this.updateQuestionBatchStatus(item.QuestionBatchId);

      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to discard duplicate item',
        data: { itemId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to discard duplicate item',
      });
    }
  }

  private toQuestionBatchItemResponse(item: TQuestionBatchItemSelect) {
    return {
      id: item.Id,
      status: item.Status,
      questionId: item.QuestionId ?? null,
      attemptCount: item.AttemptCount,
      errorMessage: item.ErrorMessage ?? null,
      promptTokens: item.PromptTokens,
      completionTokens: item.CompletionTokens,
      totalTokens: item.TotalTokens,
    };
  }
}
