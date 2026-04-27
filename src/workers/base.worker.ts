import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { serializeError } from '@/utils';

@Injectable()
export abstract class BaseWorker extends WorkerHost {
  constructor(
    @InjectPinoLogger('WorkerHostProcessor')
    protected readonly logger: PinoLogger,
    protected readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  protected resolve<T>(token: Type<T>): T {
    return this.moduleRef.get(token, { strict: false });
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
