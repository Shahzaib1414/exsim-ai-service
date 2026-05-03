import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq, and, sum } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import { Batches, BatchStatus, TBatchSelect } from '@/db/schemas/batch.schema';
import {
  BatchItems,
  BatchItemStatus,
  TBatchItemSelect,
} from '@/db/schemas/batch-item.schema';
import type { TErrorResult, TLlmUsage } from '@/common/types';
import { serializeError, calculateGpt4oCost, formatCostUsd } from '@/utils';
import { InjectBatchItemQueue, PROCESS_BATCH_ITEM_JOB } from '@/queues';
import { createMediumFrequencyJobOptions } from '@/common/queue.types';
import {
  TCreateBatch,
  TBatchResponse,
  TBatchWithItemsResponse,
  TBatchItemJobData,
  TBatchItemResponse,
} from '@/common/types';
import { AppInsightsMetricsService } from '@/common/services';

@Injectable()
export class BatchService extends BaseService {
  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectBatchItemQueue()
    private readonly batchItemQueue: Queue<TBatchItemJobData>,
    @InjectPinoLogger(BatchService.name)
    private readonly logger: PinoLogger,
    private readonly metricsService: AppInsightsMetricsService,
  ) {
    super(db);
  }

  async createBatch(
    dto: TCreateBatch,
  ): Promise<Result<TBatchResponse, TErrorResult>> {
    try {
      const batch = await this.insertInto(Batches, {
        Metadata: {
          examType: dto.examType,
          subject: dto.subject,
          topic: dto.topic,
          difficulty: dto.difficulty,
          grade: dto.grade,
          questionType: dto.questionType,
        },
        RequestedCount: dto.count,
        Status: BatchStatus.PENDING,
      });

      const batchId = batch.Id;

      const items = await this.insertManyInto(
        BatchItems,
        Array.from({ length: dto.count }, () => ({
          BatchId: batchId,
          Status: BatchItemStatus.PENDING,
          AttemptCount: 0,
        })),
      );

      await Promise.all(
        items.map((item) =>
          this.batchItemQueue.add(
            PROCESS_BATCH_ITEM_JOB,
            {
              batchItemId: item.Id,
              batchId,
              examType: dto.examType,
              subject: dto.subject,
              topic: dto.topic,
              difficulty: dto.difficulty,
              grade: dto.grade,
              questionType: dto.questionType,
            },
            createMediumFrequencyJobOptions(item.Id),
          ),
        ),
      );

      await this.updateIn(Batches, eq(Batches.Id, batchId), {
        Status: BatchStatus.IN_PROGRESS,
      });

      return ok({
        id: batchId,
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
        status: BatchStatus.IN_PROGRESS,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: '0.000000',
      });
    } catch (error) {
      this.logger.error({
        message: 'Failed to create batch',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to create batch',
      });
    }
  }

  async getBatch(id: string): Promise<Result<TBatchResponse, TErrorResult>> {
    try {
      const rows = await this.db
        .select()
        .from(Batches)
        .where(eq(Batches.Id, id));
      const batch = rows[0];

      if (!batch) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch not found',
        });
      }

      const items = await this.db
        .select()
        .from(BatchItems)
        .where(eq(BatchItems.BatchId, id));

      return ok(this.toBatchResponse(batch, items));
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

  async listBatches(): Promise<Result<TBatchResponse[], TErrorResult>> {
    try {
      const batches = await this.db.select().from(Batches);

      const results = await Promise.all(
        batches.map(async (batch) => {
          const items = await this.db
            .select()
            .from(BatchItems)
            .where(eq(BatchItems.BatchId, batch.Id));
          return this.toBatchResponse(batch, items);
        }),
      );

      return ok(results);
    } catch (error) {
      this.logger.error({
        message: 'Failed to list batches',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to list batches',
      });
    }
  }

  async getBatchItems(
    batchId: string,
    statusFilter?: string,
  ): Promise<Result<TBatchWithItemsResponse, TErrorResult>> {
    try {
      const batches = await this.db
        .select()
        .from(Batches)
        .where(eq(Batches.Id, batchId));
      const batch = batches[0];

      if (!batch) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch not found',
        });
      }

      const whereClause = statusFilter
        ? and(
            eq(BatchItems.BatchId, batchId),
            eq(BatchItems.Status, statusFilter as TBatchItemSelect['Status']),
          )
        : eq(BatchItems.BatchId, batchId);

      const items = await this.db.select().from(BatchItems).where(whereClause);

      return ok({
        ...this.toBatchResponse(batch, items),
        items: items.map((item) => this.toBatchItemResponse(item)),
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
  ): Promise<Result<TBatchItemSelect, TErrorResult>> {
    try {
      const rows = await this.db
        .select()
        .from(BatchItems)
        .where(eq(BatchItems.Id, itemId));
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
      await this.updateIn(BatchItems, eq(BatchItems.Id, itemId), {
        Status: BatchItemStatus.COMPLETED,
        QuestionId: questionId,
        PromptTokens: usage.promptTokens,
        CompletionTokens: usage.completionTokens,
        TotalTokens: usage.totalTokens,
      });
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
        .select({ AttemptCount: BatchItems.AttemptCount })
        .from(BatchItems)
        .where(eq(BatchItems.Id, itemId));

      const currentAttempts = rows[0]?.AttemptCount ?? 0;

      await this.updateIn(BatchItems, eq(BatchItems.Id, itemId), {
        Status: BatchItemStatus.FAILED,
        AttemptCount: currentAttempts + 1,
        ErrorMessage: errorMessage,
      });

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

  async updateBatchStatus(
    batchId: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      const items = await this.db
        .select()
        .from(BatchItems)
        .where(eq(BatchItems.BatchId, batchId));

      const allTerminal = items.every(
        (i) =>
          i.Status === BatchItemStatus.COMPLETED ||
          i.Status === BatchItemStatus.FAILED,
      );

      if (!allTerminal) return ok(undefined);

      const anyFailed = items.some((i) => i.Status === BatchItemStatus.FAILED);
      const newStatus = anyFailed ? BatchStatus.FAILED : BatchStatus.COMPLETED;

      // Aggregate token counts across all items
      const tokenTotals = await this.db
        .select({
          totalPromptTokens: sum(BatchItems.PromptTokens),
          totalCompletionTokens: sum(BatchItems.CompletionTokens),
          totalTokens: sum(BatchItems.TotalTokens),
        })
        .from(BatchItems)
        .where(eq(BatchItems.BatchId, batchId));

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

      await this.updateIn(Batches, eq(Batches.Id, batchId), {
        Status: newStatus,
        TotalPromptTokens: pt,
        TotalCompletionTokens: ct,
        TotalTokens: tt,
        EstimatedCostUsd: estimatedCostUsd,
      });

      const failedCount = items.filter(
        (i) => i.Status === BatchItemStatus.FAILED,
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

  private toBatchResponse(
    batch: TBatchSelect,
    items: TBatchItemSelect[],
  ): TBatchResponse {
    return {
      id: batch.Id,
      metadata: batch.Metadata,
      requestedCount: batch.RequestedCount,
      completedCount: items.filter(
        (i) => i.Status === BatchItemStatus.COMPLETED,
      ).length,
      failedCount: items.filter((i) => i.Status === BatchItemStatus.FAILED)
        .length,
      status: batch.Status,
      totalPromptTokens: batch.TotalPromptTokens,
      totalCompletionTokens: batch.TotalCompletionTokens,
      totalTokens: batch.TotalTokens,
      estimatedCostUsd: batch.EstimatedCostUsd,
    };
  }

  async markItemNeedsReview(
    itemId: string,
    duplicateQuestionIds: string[],
  ): Promise<Result<void, TErrorResult>> {
    try {
      const rows = await this.db
        .select({ AttemptCount: BatchItems.AttemptCount })
        .from(BatchItems)
        .where(eq(BatchItems.Id, itemId));
      const currentAttempts = rows[0]?.AttemptCount ?? 0;

      await this.updateIn(BatchItems, eq(BatchItems.Id, itemId), {
        Status: BatchItemStatus.NEEDS_REVIEW,
        AttemptCount: currentAttempts + 1,
        DuplicateQuestions: duplicateQuestionIds.join(','),
      });
      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to mark item NEEDS_REVIEW',
        data: { itemId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to mark item NEEDS_REVIEW',
      });
    }
  }

  async retryDuplicateItem(
    itemId: string,
  ): Promise<Result<TBatchItemResponse, TErrorResult>> {
    try {
      const itemRows = await this.db
        .select()
        .from(BatchItems)
        .where(eq(BatchItems.Id, itemId));
      const item = itemRows[0];

      if (!item) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch item not found',
        });
      }

      if (item.Status !== BatchItemStatus.NEEDS_REVIEW) {
        return err({
          status: HttpStatus.CONFLICT,
          message: 'only items with NEEDS_REVIEW status can be retried',
        });
      }

      const batchRows = await this.db
        .select()
        .from(Batches)
        .where(eq(Batches.Id, item.BatchId));
      const batch = batchRows[0];

      if (!batch) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch not found',
        });
      }

      const negativeExampleIds = item.DuplicateQuestions
        ? item.DuplicateQuestions.split(',').filter(Boolean)
        : [];

      await this.updateIn(BatchItems, eq(BatchItems.Id, itemId), {
        Status: BatchItemStatus.PENDING,
        DuplicateQuestions: null,
        ErrorMessage: null,
      });

      const { examType, subject, topic, difficulty, grade, questionType } =
        batch.Metadata;

      await this.batchItemQueue.add(
        PROCESS_BATCH_ITEM_JOB,
        {
          batchItemId: itemId,
          batchId: item.BatchId,
          examType,
          subject,
          topic,
          difficulty,
          grade,
          questionType,
          negativeExampleIds,
        },
        createMediumFrequencyJobOptions(itemId),
      );

      const updatedRows = await this.db
        .select()
        .from(BatchItems)
        .where(eq(BatchItems.Id, itemId));

      return ok(this.toBatchItemResponse(updatedRows[0]));
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

  private toBatchItemResponse(item: TBatchItemSelect) {
    return {
      id: item.Id,
      status: item.Status,
      questionId: item.QuestionId ?? null,
      attemptCount: item.AttemptCount,
      errorMessage: item.ErrorMessage ?? null,
      duplicateQuestions: item.DuplicateQuestions ?? null,
      promptTokens: item.PromptTokens,
      completionTokens: item.CompletionTokens,
      totalTokens: item.TotalTokens,
    };
  }
}
