import { Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import type { Config } from '@/config';
import { AI_ANGEL_REPORT_QUEUE } from '@/queues';
import { TAiAngelReportJobData } from '@/common/types';
import { EmailTemplate, TSendEmailOptions } from '@/modules/email';
import { AnalyticsService } from '@/modules/analytics/services/analytics.service';
import { BaseWorker } from './base.worker';

@Processor(AI_ANGEL_REPORT_QUEUE, { concurrency: 2 })
@Injectable()
export class AnalyticsReportWorker extends BaseWorker {
  @Inject(AnalyticsService)
  private readonly analyticsService: AnalyticsService;
  @Inject(ConfigService)
  private readonly config: ConfigService<Config, true>;

  override async process(job: Job<TAiAngelReportJobData>): Promise<void> {
    const { reportId, sessionId, previousReport } = job.data;
    const result = await this.analyticsService.executeReportGeneration(
      reportId,
      sessionId,
      previousReport,
    );
    if (result.isErr()) throw new Error(result.error.message);
  }

  protected override onSuccess(
    job: Job<TAiAngelReportJobData>,
  ): Promise<TSendEmailOptions | null> {
    const { reportId, sessionId, userEmail, userName } = job.data;
    const frontendBaseUrl = this.config.get('app', {
      infer: true,
    }).frontendBaseUrl;
    const reportUrl = `${frontendBaseUrl}/ai-angel-report?reportId=${reportId}&sessionId=${sessionId}`;

    return Promise.resolve({
      to: userEmail,
      subject: '✓ Your AI Angel Report Is Ready',
      template: EmailTemplate.AI_ANGEL_REPORT_SUCCESS,
      context: {
        userName,
        reportId,
        sessionId,
        reportUrl,
        generatedAt: new Date().toUTCString(),
        year: new Date().getFullYear(),
      },
    });
  }

  protected override onTerminalFailure(
    job: Job<TAiAngelReportJobData>,
    _error: Error,
  ): Promise<TSendEmailOptions | null> {
    const { reportId, sessionId, userEmail, userName } = job.data;

    return Promise.resolve({
      to: userEmail,
      subject: '✗ AI Angel Report Generation Failed',
      template: EmailTemplate.AI_ANGEL_REPORT_FAILURE,
      context: {
        userName,
        reportId,
        sessionId,
        failedAt: new Date().toUTCString(),
        year: new Date().getFullYear(),
      },
    });
  }
}
