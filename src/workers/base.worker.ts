import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { EmailService, TSendEmailOptions } from '@/modules/email';
import { serializeError } from '@/utils';

@Injectable()
export abstract class BaseWorker extends WorkerHost {
  constructor(
    @InjectPinoLogger('WorkerHostProcessor')
    protected readonly logger: PinoLogger,
    @Inject(EmailService)
    protected readonly emailService: EmailService,
  ) {
    super();
  }

  // Override to return email options on job success, or null to skip.
  protected onSuccess(_job: Job): Promise<TSendEmailOptions | null> {
    return Promise.resolve(null);
  }

  // Override to return email options on terminal failure, or null to skip.
  protected onTerminalFailure(
    _job: Job,
    _error: Error,
  ): Promise<TSendEmailOptions | null> {
    return Promise.resolve(null);
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

    void this.onSuccess(job)
      .then((options) => {
        if (!options) return;
        return this.emailService.send(options).then((result) => {
          if (result.isErr()) {
            this.logger.warn({
              message: 'Failed to send job success email',
              data: {
                jobId: job.id,
                queue: job.queueName,
                error: result.error.message,
              },
            });
          }
        });
      })
      .catch((err: unknown) => {
        this.logger.warn({
          message: 'Unexpected error in onSuccess hook',
          data: { jobId: job.id, error: serializeError(err) },
        });
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

    if (!job) return;

    const maxAttempts = job.opts?.attempts ?? 1;
    const isTerminal = job.attemptsMade >= maxAttempts;
    if (!isTerminal) return;

    void this.onTerminalFailure(job, error)
      .then((options) => {
        if (!options) return;
        return this.emailService.send(options).then((result) => {
          if (result.isErr()) {
            this.logger.warn({
              message: 'Failed to send job failure email',
              data: {
                jobId: job.id,
                queue: job.queueName,
                error: result.error.message,
              },
            });
          }
        });
      })
      .catch((err: unknown) => {
        this.logger.warn({
          message: 'Unexpected error in onTerminalFailure hook',
          data: { jobId: job.id, error: serializeError(err) },
        });
      });
  }
}
