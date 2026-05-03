import { Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import { BATCH_ITEM_QUEUE } from '@/queues';
import { TBatchItemJobData } from '@/common/types';
import { GeneratorService } from '@/modules/generator/services/generator.service';
import { BatchService } from '@/modules/batch/services/batch.service';
import { QuestionService } from '@/modules/question/services/question.service';
import { AppInsightsMetricsService } from '@/common/services';
import { LangfuseService } from '@/common/services/langfuse.service';
import { serializeError } from '@/utils';
import { BaseWorker } from './base.worker';
import { BatchItemStatus } from '@/db';

@Processor(BATCH_ITEM_QUEUE, { concurrency: 5 })
@Injectable()
export class BatchWorker extends BaseWorker {
  override async process(job: Job<TBatchItemJobData>): Promise<void> {
    const generatorService = this.resolve(GeneratorService);
    const batchService = this.resolve(BatchService);
    const metricsService = this.resolve(AppInsightsMetricsService);
    const langfuseService = this.resolve(LangfuseService);

    const {
      batchItemId,
      batchId,
      examType,
      subject,
      topic,
      difficulty,
      grade,
      questionType,
      negativeExampleIds = [],
    } = job.data;
    const logContext = {
      queueName: job.queueName,
      jobId: job.id,
      jobName: job.name,
      data: job.data,
    };

    try {
      const itemResult = await batchService.getItem(batchItemId);
      if (itemResult.isErr()) {
        throw new Error(itemResult.error.message);
      }

      if (itemResult.value.Status === BatchItemStatus.COMPLETED) {
        this.logger.info({
          message: 'Skipping already-generated item',
          data: { batchItemId },
        });
        return;
      }

      void job.log(
        `Processing batch item ${batchItemId} (attempt ${job.attemptsMade + 1})`,
      );
      this.logger.info({
        message: 'Processing batch item',
        data: {
          ...logContext,
          batchItemId,
          batchId,
          examType,
          subject,
          topic,
          difficulty,
        },
      });

      const trace = langfuseService.client.trace({
        id: batchItemId,
        name: 'batch-item',
        metadata: {
          batchId,
          examType,
          subject,
          topic,
          difficulty,
          grade,
          questionType,
        },
      });

      const questionService = this.resolve(QuestionService);
      const negativeExamples =
        await questionService.getQuestionTexts(negativeExampleIds);

      const result = await generatorService.generateOne({
        examType,
        subject,
        topic,
        difficulty,
        grade,
        questionType,
        negativeExamples,
        trace,
      });

      if (result.isOk()) {
        const value = result.value;
        if (value.needsReview) {
          trace.update({
            output: {
              needsReview: true,
              duplicateQuestionIds: value.duplicateQuestionIds,
            },
          });
          await batchService.markItemNeedsReview(
            batchItemId,
            value.duplicateQuestionIds,
          );
          metricsService.trackBatchItemFailure(
            batchId,
            'duplicate after max attempts — flagged for review',
          );
        } else {
          trace.update({ output: { questionId: value.questionId } });
          await batchService.markItemCompleted(
            batchItemId,
            value.questionId,
            value.usage,
          );
          metricsService.trackBatchItemSuccess(batchId);
          metricsService.trackLlmTokenUsage('generator', value.usage);
        }
      } else {
        trace.update({ output: { error: result.error.message } });
        await batchService.markItemFailed(batchItemId, result.error.message);
        metricsService.trackBatchItemFailure(batchId, result.error.message);
        throw new Error(result.error.message);
      }

      await batchService.updateBatchStatus(batchId);
      void job.log(`Successfully processed batch item ${batchItemId}`);
      this.logger.info({
        message: 'Batch item processed successfully',
        data: logContext,
      });
    } catch (error) {
      this.logger.error({
        message: 'Error processing batch item',
        data: logContext,
        error: serializeError(error),
      });
      throw error;
    }
  }
}
