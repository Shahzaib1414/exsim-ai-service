import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq, and } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import { Batches, TBatchSelect } from '@/db/schemas/batch.schema';
import { BatchItems, TBatchItemSelect } from '@/db/schemas/batch-item.schema';
import type { TErrorResult } from '@/common/types';
import { serializeError } from '@/utils';
import { InjectBatchItemQueue } from '@/queues';
import { createMediumFrequencyJobOptions } from '@/common/queue.types';
import {
  TCreateBatch,
  TBatchResponse,
  TBatchWithItemsResponse,
  TBatchItemJobData,
} from '@/common/types';

@Injectable()
export class BatchService extends BaseService {
  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectBatchItemQueue()
    private readonly batchItemQueue: Queue<TBatchItemJobData>,
    @InjectPinoLogger(BatchService.name)
    private readonly logger: PinoLogger,
  ) {
    super(db);
  }

  async createBatch(
    dto: TCreateBatch,
  ): Promise<Result<TBatchResponse, TErrorResult>> {
    try {
      const batchId = randomUUID();
      const now = new Date();

      await this.db.insert(Batches).values({
        Id: batchId,
        Subject: dto.subject,
        Topic: dto.topic,
        Difficulty: dto.difficulty,
        RequestedCount: dto.count,
        Status: 'pending',
        Created: now,
      });

      const itemIds: string[] = Array.from({ length: dto.count }, () =>
        randomUUID(),
      );

      await this.db.insert(BatchItems).values(
        itemIds.map((id) => ({
          Id: id,
          BatchId: batchId,
          Status: 'pending' as const,
          AttemptCount: 0,
          Created: now,
        })),
      );

      await Promise.all(
        itemIds.map((itemId) =>
          this.batchItemQueue.add(
            'process-batch-item',
            {
              batchItemId: itemId,
              batchId,
              subject: dto.subject,
              topic: dto.topic,
              difficulty: dto.difficulty,
            },
            createMediumFrequencyJobOptions(itemId),
          ),
        ),
      );

      await this.db
        .update(Batches)
        .set({ Status: 'running' })
        .where(eq(Batches.Id, batchId));

      return ok({
        id: batchId,
        subject: dto.subject,
        topic: dto.topic,
        difficulty: dto.difficulty,
        requestedCount: dto.count,
        completedCount: 0,
        failedCount: 0,
        status: 'running',
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
        items: items.map((item) => ({
          id: item.Id,
          status: item.Status,
          questionId: item.QuestionId ?? null,
          attemptCount: item.AttemptCount,
          errorMessage: item.ErrorMessage ?? null,
        })),
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

  async markItemGenerated(
    itemId: string,
    questionId: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      await this.db
        .update(BatchItems)
        .set({ Status: 'generated', QuestionId: questionId })
        .where(eq(BatchItems.Id, itemId));
      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to mark item generated',
        data: { itemId, questionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to mark item generated',
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

      await this.db
        .update(BatchItems)
        .set({
          Status: 'failed',
          AttemptCount: currentAttempts + 1,
          ErrorMessage: errorMessage,
        })
        .where(eq(BatchItems.Id, itemId));

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
        (i) => i.Status === 'generated' || i.Status === 'failed',
      );

      if (!allTerminal) return ok(undefined);

      const anyFailed = items.some((i) => i.Status === 'failed');
      const newStatus = anyFailed ? 'failed' : 'completed';

      await this.db
        .update(Batches)
        .set({ Status: newStatus })
        .where(eq(Batches.Id, batchId));

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
      subject: batch.Subject,
      topic: batch.Topic,
      difficulty: batch.Difficulty,
      requestedCount: batch.RequestedCount,
      completedCount: items.filter((i) => i.Status === 'generated').length,
      failedCount: items.filter((i) => i.Status === 'failed').length,
      status: batch.Status,
    };
  }
}
