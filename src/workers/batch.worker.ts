import { Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import { BATCH_ITEM_QUEUE } from '@/queues';
import { TBatchItemJobData } from '@/common/types';
import { GeneratorService } from '@/modules/generator/services/generator.service';
import { BatchService } from '@/modules/batch/services/batch.service';
import { serializeError } from '@/utils';
import { BaseWorker } from './base.worker';

@Processor(BATCH_ITEM_QUEUE, { concurrency: 5 })
@Injectable()
export class BatchWorker extends BaseWorker {
  override async process(job: Job<TBatchItemJobData>): Promise<void> {
    const generatorService = this.resolve(GeneratorService);
    const batchService = this.resolve(BatchService);

    const { batchItemId, batchId, subject, topic, difficulty } = job.data;
    const logContext = {
      queueName: job.queueName,
      jobId: job.id,
      jobName: job.name,
    };

    try {
      const itemResult = await batchService.getItem(batchItemId);
      if (itemResult.isErr()) {
        throw new Error(itemResult.error.message);
      }

      if (itemResult.value.Status === 'generated') {
        this.logger.info({
          message: 'Skipping already-generated item',
          data: { batchItemId },
        });
        return;
      }

      job.log(
        `Processing batch item ${batchItemId} (attempt ${job.attemptsMade + 1})`,
      );
      this.logger.info({
        message: 'Processing batch item',
        data: {
          ...logContext,
          batchItemId,
          batchId,
          subject,
          topic,
          difficulty,
        },
      });

      const result = await generatorService.generateOne({
        subject,
        topic,
        difficulty,
      });

      if (result.isOk()) {
        await batchService.markItemGenerated(
          batchItemId,
          result.value.questionId,
        );
      } else {
        await batchService.markItemFailed(batchItemId, result.error.message);
        throw new Error(result.error.message);
      }

      await batchService.updateBatchStatus(batchId);
      job.log(`Successfully processed batch item ${batchItemId}`);
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
