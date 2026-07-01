import { Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import { QUESTION_BATCH_SAMPLE_COMPLETE_QUEUE } from '@/queues';
import type { TQuestionBatchSampleCompleteJobData } from '@/common/types';
import { QuestionBatchItemStatus } from '@/db/schemas/question-batch-item.schema';
import { QuestionBatchStatus } from '@/db/schemas/question-batch.schema';
import { EmailTemplate, TSendEmailOptions } from '@/modules/email';
import { QuestionBatchService } from '@/modules/question-batch/services/question-batch.service';
import { serializeError } from '@/utils';
import { BaseWorker } from './base.worker';

/**
 * Runs after all sample-phase children complete (BullMQ flow parent).
 * Inspects sample item statuses and transitions the batch to either
 * PENDING_REVIEW (all OK) or FAILED (any sample failed permanently).
 */
@Processor(QUESTION_BATCH_SAMPLE_COMPLETE_QUEUE, { concurrency: 3 })
@Injectable()
export class QuestionBatchSampleWorker extends BaseWorker {
  @Inject(QuestionBatchService)
  private readonly questionBatchService: QuestionBatchService;

  override async process(
    job: Job<TQuestionBatchSampleCompleteJobData>,
  ): Promise<void> {
    const { batchId } = job.data;

    void job.log(`Sample phase complete for batch ${batchId}`);
    this.logger.info({
      message: 'Processing sample-complete job',
      data: { jobId: job.id, batchId },
    });

    try {
      const itemsResult =
        await this.questionBatchService.getSampleItems(batchId);
      if (itemsResult.isErr()) {
        throw new Error(itemsResult.error.message);
      }

      const sampleItems = itemsResult.value;
      const anyFailed = sampleItems.some(
        (i) => i.Status === QuestionBatchItemStatus.FAILED,
      );

      if (anyFailed) {
        await this.questionBatchService.markBatchFailed(batchId);
        this.logger.warn({
          message: 'One or more sample items failed — batch marked FAILED',
          data: { batchId },
        });
      } else {
        await this.questionBatchService.markBatchPendingReview(batchId);
        this.logger.info({
          message: 'All sample items succeeded — batch marked PENDING_REVIEW',
          data: { batchId },
        });
      }
    } catch (error) {
      this.logger.error({
        message: 'Error processing sample-complete job',
        data: { batchId, error: serializeError(error) },
      });
      throw error;
    }
  }

  protected override async onSuccess(
    job: Job<TQuestionBatchSampleCompleteJobData>,
  ): Promise<TSendEmailOptions | null> {
    const { batchId, user } = job.data;

    const batchResult =
      await this.questionBatchService.getQuestionBatch(batchId);
    if (batchResult.isErr()) return null;

    const batch = batchResult.value;

    if (batch.status === QuestionBatchStatus.FAILED) {
      return {
        to: user.email,
        subject: `✗ Sample Generation Failed — ${batch.metadata.subject} / ${batch.metadata.topic}`,
        template: EmailTemplate.QUESTION_BATCH_FAILURE,
        context: {
          batchId,
          examType: batch.metadata.examType,
          subject: batch.metadata.subject,
          topic: batch.metadata.topic,
          difficulty: batch.metadata.difficulty,
          questionType: batch.metadata.questionType,
          requestedCount: batch.requestedCount,
          completedCount: batch.completedCount,
          failedCount: batch.failedCount,
          estimatedCostUsd: batch.estimatedCostUsd,
          completedAt: new Date().toUTCString(),
          year: new Date().getFullYear(),
        },
      };
    }

    if (batch.status === QuestionBatchStatus.PENDING_REVIEW) {
      return {
        to: user.email,
        subject: `⏳ Review Your Samples — ${batch.metadata.subject} / ${batch.metadata.topic}`,
        template: EmailTemplate.QUESTION_BATCH_PENDING_REVIEW,
        context: {
          batchId,
          examType: batch.metadata.examType,
          subject: batch.metadata.subject,
          topic: batch.metadata.topic,
          difficulty: batch.metadata.difficulty,
          questionType: batch.metadata.questionType,
          requestedCount: batch.requestedCount,
          sampleCount: batch.sampleCount,
          readyAt: new Date().toUTCString(),
          year: new Date().getFullYear(),
        },
      };
    }

    return null;
  }
}
