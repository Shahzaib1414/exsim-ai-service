import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq, and, or, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
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
  createMediumFrequencyJobOptions,
  BatchFlowService,
  FlowConfigService,
} from '@/queues';
import {
  TCreateQuestionBatch,
  TQuestionBatchResponse,
  TQuestionBatchWithItemsResponse,
  TQuestionBatchItemJobData,
  TQuestionBatchItemResponse,
  TQuestionBatchPaginatedResponse,
  TQuestionBatchesFilter,
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
    private readonly batchFlowService: BatchFlowService,
    private readonly flowConfigService: FlowConfigService,
  ) {
    super(db);
  }

  private async resolveActiveBatch(): Promise<Result<void, TErrorResult>> {
    const [inProgress] = await this.db
      .select({ id: QuestionBatches.Id })
      .from(QuestionBatches)
      .where(
        or(
          eq(QuestionBatches.Status, QuestionBatchStatus.IN_PROGRESS),
          eq(QuestionBatches.Status, QuestionBatchStatus.PENDING_REVIEW),
        ),
      )
      .limit(1);

    if (!inProgress) return ok(undefined);

    // A PENDING_REVIEW batch is intentionally paused — always block.
    const [pending] = await this.db
      .select({ id: QuestionBatches.Id })
      .from(QuestionBatches)
      .where(eq(QuestionBatches.Status, QuestionBatchStatus.PENDING_REVIEW))
      .limit(1);

    if (pending) {
      return err({
        status: HttpStatus.CONFLICT,
        message:
          'A question batch is awaiting review. Approve or reject it before creating a new one.',
      });
    }

    const { active, waiting, delayed } =
      await this.questionBatchItemQueue.getJobCounts(
        'active',
        'waiting',
        'delayed',
      );

    if (active + waiting + delayed > 0) {
      return err({
        status: HttpStatus.CONFLICT,
        message: 'A question batch is already in progress',
      });
    }

    // Queue is empty but DB still shows IN_PROGRESS — batch is stale. Heal it.
    await this.updateIn(
      QuestionBatches,
      eq(QuestionBatches.Id, inProgress.id),
      {
        Status: QuestionBatchStatus.FAILED,
      },
    );

    this.logger.warn({
      message: 'Auto-healed stale IN_PROGRESS batch',
      data: { batchId: inProgress.id },
    });

    return ok(undefined);
  }

  async createQuestionBatch(
    dto: TCreateQuestionBatch,
    user: TAuthUserReq,
    file?: Express.Multer.File,
  ): Promise<Result<TQuestionBatchResponse, TErrorResult>> {
    try {
      const activeCheck = await this.resolveActiveBatch();
      if (activeCheck.isErr()) return err(activeCheck.error);

      const sampleCount = dto.count <= 3 ? 1 : 3;
      const metadata = {
        examType: dto.examType,
        subject: dto.subject,
        topic: dto.topic,
        difficulty: dto.difficulty,
        grade: dto.grade,
        questionType: dto.questionType,
      };

      const { questionBatchId, sampleItems } = await this.db.transaction(
        async (tx) => {
          const [batch] = await tx
            .insert(QuestionBatches)
            .values({
              MetaData: metadata,
              RequestedCount: dto.count,
              SampleCount: sampleCount,
              Status: QuestionBatchStatus.IN_PROGRESS,
            })
            .returning();

          const insertedItems = await tx
            .insert(QuestionBatchItems)
            .values(
              Array.from({ length: sampleCount }, () => ({
                QuestionBatchId: batch.Id,
                Status: QuestionBatchItemStatus.PENDING,
                IsSample: true,
                AttemptCount: 0,
              })),
            )
            .returning();

          return { questionBatchId: batch.Id, sampleItems: insertedItems };
        },
      );

      const flowJob = this.flowConfigService.buildSamplePhaseFlow({
        batchId: questionBatchId,
        user,
        sampleItems,
        metadata,
        file,
      });

      await this.batchFlowService.add(flowJob);

      return ok({
        id: questionBatchId,
        metadata,
        requestedCount: dto.count,
        sampleCount,
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

  async approveQuestionBatch(
    batchId: string,
    user: TAuthUserReq,
  ): Promise<Result<TQuestionBatchResponse, TErrorResult>> {
    try {
      const batchRows = await this.db
        .select()
        .from(QuestionBatches)
        .where(eq(QuestionBatches.Id, batchId));
      const batch = batchRows[0];

      if (!batch) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch not found',
        });
      }

      if (batch.Status !== QuestionBatchStatus.PENDING_REVIEW) {
        return err({
          status: HttpStatus.CONFLICT,
          message: `Batch cannot be approved — current status is ${batch.Status}`,
        });
      }

      const remainder = batch.RequestedCount - batch.SampleCount;

      if (remainder === 0) {
        // All items were samples; nothing left to generate — complete immediately.
        await this.updateIn(QuestionBatches, eq(QuestionBatches.Id, batchId), {
          Status: QuestionBatchStatus.COMPLETED,
        });

        const updatedBatch = {
          ...batch,
          Status: QuestionBatchStatus.COMPLETED,
        };
        const items = await this.db
          .select()
          .from(QuestionBatchItems)
          .where(eq(QuestionBatchItems.QuestionBatchId, batchId));

        return ok(
          this.toQuestionBatchResponse(
            updatedBatch as TQuestionBatchSelect,
            items,
          ),
        );
      }

      // Transition to IN_PROGRESS and create remainder items atomically.
      const { remainderItems } = await this.db.transaction(async (tx) => {
        await tx
          .update(QuestionBatches)
          .set({ Status: QuestionBatchStatus.IN_PROGRESS })
          .where(eq(QuestionBatches.Id, batchId));

        const inserted = await tx
          .insert(QuestionBatchItems)
          .values(
            Array.from({ length: remainder }, () => ({
              QuestionBatchId: batchId,
              Status: QuestionBatchItemStatus.PENDING,
              IsSample: false,
              AttemptCount: 0,
            })),
          )
          .returning();

        return { remainderItems: inserted };
      });

      // Enqueue each remainder item individually (no flow needed).
      await Promise.all(
        remainderItems.map((item) =>
          this.questionBatchItemQueue.add(
            PROCESS_QUESTION_BATCH_ITEM_JOB,
            {
              questionBatchItemId: item.Id,
              questionBatchId: batchId,
              examType: batch.MetaData.examType,
              subject: batch.MetaData.subject,
              topic: batch.MetaData.topic,
              difficulty: batch.MetaData.difficulty,
              grade: batch.MetaData.grade,
              questionType: batch.MetaData.questionType,
              user,
            },
            createMediumFrequencyJobOptions(item.Id),
          ),
        ),
      );

      const allItems = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(eq(QuestionBatchItems.QuestionBatchId, batchId));

      const updatedBatch = {
        ...batch,
        Status: QuestionBatchStatus.IN_PROGRESS,
      };
      return ok(
        this.toQuestionBatchResponse(
          updatedBatch as TQuestionBatchSelect,
          allItems,
        ),
      );
    } catch (error) {
      this.logger.error({
        message: 'Failed to approve question batch',
        data: { batchId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to approve question batch',
      });
    }
  }

  async rejectQuestionBatch(
    batchId: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      const batchRows = await this.db
        .select()
        .from(QuestionBatches)
        .where(eq(QuestionBatches.Id, batchId));
      const batch = batchRows[0];

      if (!batch) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'batch not found',
        });
      }

      if (batch.Status !== QuestionBatchStatus.PENDING_REVIEW) {
        return err({
          status: HttpStatus.CONFLICT,
          message: `Batch cannot be rejected — current status is ${batch.Status}`,
        });
      }

      // Delete generated sample questions.
      const sampleItems = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(
          and(
            eq(QuestionBatchItems.QuestionBatchId, batchId),
            eq(QuestionBatchItems.IsSample, true),
          ),
        );

      for (const item of sampleItems) {
        if (item.QuestionId) {
          const deleteResult = await this.questionService.deleteQuestion(
            item.QuestionId,
          );
          if (deleteResult.isErr()) {
            this.logger.warn({
              message: 'Failed to delete sample question during rejection',
              data: {
                questionId: item.QuestionId,
                error: deleteResult.error.message,
              },
            });
          }
        }
      }

      await this.db
        .delete(QuestionBatchItems)
        .where(eq(QuestionBatchItems.QuestionBatchId, batchId));

      await this.updateIn(QuestionBatches, eq(QuestionBatches.Id, batchId), {
        Status: QuestionBatchStatus.REJECTED,
      });

      return ok(undefined);
    } catch (error) {
      this.logger.error({
        message: 'Failed to reject question batch',
        data: { batchId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to reject question batch',
      });
    }
  }

  async getSampleItems(
    batchId: string,
  ): Promise<Result<TQuestionBatchItemSelect[], TErrorResult>> {
    try {
      const items = await this.db
        .select()
        .from(QuestionBatchItems)
        .where(
          and(
            eq(QuestionBatchItems.QuestionBatchId, batchId),
            eq(QuestionBatchItems.IsSample, true),
          ),
        );
      return ok(items);
    } catch (error) {
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to fetch sample items',
      });
    }
  }

  async markBatchPendingReview(
    batchId: string,
  ): Promise<Result<void, TErrorResult>> {
    try {
      await this.updateIn(QuestionBatches, eq(QuestionBatches.Id, batchId), {
        Status: QuestionBatchStatus.PENDING_REVIEW,
      });
      return ok(undefined);
    } catch (error) {
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to mark batch PENDING_REVIEW',
      });
    }
  }

  async markBatchFailed(batchId: string): Promise<Result<void, TErrorResult>> {
    try {
      await this.updateIn(QuestionBatches, eq(QuestionBatches.Id, batchId), {
        Status: QuestionBatchStatus.FAILED,
      });
      return ok(undefined);
    } catch (error) {
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to mark batch FAILED',
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
    filters: TQuestionBatchesFilter,
  ): Promise<Result<TQuestionBatchPaginatedResponse, TErrorResult>> {
    try {
      const { page, limit, subject, topic, examType, search, status } = filters;

      const conditions: SQL[] = [];

      if (status) {
        conditions.push(sql`${QuestionBatches.Status} ILIKE ${status}`);
      }
      if (subject) {
        conditions.push(
          sql`${QuestionBatches.MetaData}->>'subject' ILIKE ${'%' + subject + '%'}`,
        );
      }
      if (topic) {
        conditions.push(
          sql`${QuestionBatches.MetaData}->>'topic' ILIKE ${'%' + topic + '%'}`,
        );
      }
      if (examType) {
        conditions.push(
          sql`${QuestionBatches.MetaData}->>'examType' ILIKE ${'%' + examType + '%'}`,
        );
      }
      if (search) {
        const term = `%${search}%`;
        conditions.push(
          or(
            sql`${QuestionBatches.MetaData}->>'subject' ILIKE ${term}`,
            sql`${QuestionBatches.MetaData}->>'topic' ILIKE ${term}`,
            sql`${QuestionBatches.MetaData}->>'examType' ILIKE ${term}`,
          )!,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const paginated = await this.paginate(
        this.db
          .select()
          .from(QuestionBatches)
          .where(where)
          .limit(limit)
          .offset((page - 1) * limit),
        this.countIn(QuestionBatches, where),
        { page, limit },
      );

      if (paginated.items.length === 0)
        return ok({ items: [], meta: paginated.meta });

      const batchIds = paginated.items.map((b) => b.Id);
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

      return ok({
        items: paginated.items.map((batch) =>
          this.toQuestionBatchResponse(batch, itemsByBatch.get(batch.Id) ?? []),
        ),
        meta: paginated.meta,
      });
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
      await this.db
        .update(QuestionBatchItems)
        .set({
          Status: QuestionBatchItemStatus.FAILED,
          AttemptCount: sql`${QuestionBatchItems.AttemptCount} + 1`,
          ErrorMessage: errorMessage,
        })
        .where(eq(QuestionBatchItems.Id, itemId));

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

      // Pre-approval phase: only sample items exist.
      // The sample-complete worker handles the PENDING_REVIEW transition — skip here.
      const hasRemainderItems = items.some((i) => !i.IsSample);
      if (!hasRemainderItems) return ok(undefined);

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

      const pt = items.reduce((acc, i) => acc + (i.PromptTokens ?? 0), 0);
      const ct = items.reduce((acc, i) => acc + (i.CompletionTokens ?? 0), 0);
      const tt = items.reduce((acc, i) => acc + (i.TotalTokens ?? 0), 0);
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
      sampleCount: batch.SampleCount,
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
      isSample: item.IsSample,
      attemptCount: item.AttemptCount,
      errorMessage: item.ErrorMessage ?? null,
      promptTokens: item.PromptTokens,
      completionTokens: item.CompletionTokens,
      totalTokens: item.TotalTokens,
    };
  }
}
