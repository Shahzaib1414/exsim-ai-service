import { Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { BATCH_ITEM_QUEUE } from '@/queues';
import { GeneratorService } from '@/modules/generator/services/generator.service';
import { BatchService } from '@/modules/batch/services/batch.service';
import { TBatchItemJobData } from '@/modules/batch/schemas/batch.schema';
import { BaseWorker } from './base.worker';

@Processor(BATCH_ITEM_QUEUE, { concurrency: 5 })
@Injectable()
export class BatchWorker extends BaseWorker {
  constructor(
    @InjectPinoLogger(BatchWorker.name)
    private readonly workerLogger: PinoLogger,
    private readonly generatorService: GeneratorService,
    private readonly batchService: BatchService,
  ) {
    super(workerLogger);
  }

  override async process(job: Job<TBatchItemJobData>): Promise<void> {
    const { batchItemId, batchId, subject, topic, difficulty } = job.data;

    const itemResult = await this.batchService.getItem(batchItemId);
    if (itemResult.isErr()) {
      throw new Error(itemResult.error.message);
    }

    if (itemResult.value.Status === 'generated') {
      job.log(`Skipping already-generated item ${batchItemId}`);
      return;
    }

    job.log(
      `Processing batch item ${batchItemId} (attempt ${job.attemptsMade + 1})`,
    );

    const result = await this.generatorService.generateOne({
      subject,
      topic,
      difficulty,
    });

    if (result.isOk()) {
      await this.batchService.markItemGenerated(
        batchItemId,
        result.value.questionId,
      );
    } else {
      await this.batchService.markItemFailed(batchItemId, result.error.message);
      throw new Error(result.error.message);
    }

    await this.batchService.updateBatchStatus(batchId);
  }
}
