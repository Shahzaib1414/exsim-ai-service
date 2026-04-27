import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { serializeError } from '@/utils';

@Injectable()
export abstract class BaseWorker extends WorkerHost {
  constructor(
    @InjectPinoLogger(BaseWorker.name)
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  @OnWorkerEvent('active')
  onActive(job: Job): void {
    this.logger.info({
      message: 'Job started',
      data: { jobId: job.id, queue: job.queueName },
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.info({
      message: 'Job completed',
      data: { jobId: job.id, queue: job.queueName },
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error({
      message: 'Job failed',
      data: {
        jobId: job?.id,
        queue: job?.queueName,
        attemptsMade: job?.attemptsMade,
        error: serializeError(error),
      },
    });
  }
}
