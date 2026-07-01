import { Global, Module } from '@nestjs/common';

import { LangfuseService } from '@/common/services/langfuse.service';
import { AppInsightsMetricsService } from '@/common/services/app-insights-metrics.service';

@Global()
@Module({
  providers: [LangfuseService, AppInsightsMetricsService],
  exports: [LangfuseService, AppInsightsMetricsService],
})
export class ObservabilityModule {}
