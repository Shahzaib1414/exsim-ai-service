import { Module } from '@nestjs/common';

import { AI_ANGEL_REPORT_QUEUE, QueueModule } from '@/queues';
import { AnalyticsReportWorker } from '@/workers/analytics-report.worker';
import { AnalyticsController } from './controllers/analytics.controller';
import { AnalyticsService } from './services/analytics.service';

@Module({
  imports: [QueueModule.register({ queues: [AI_ANGEL_REPORT_QUEUE] })],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsReportWorker],
})
export class AnalyticsModule {}
