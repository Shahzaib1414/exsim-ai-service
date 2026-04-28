import { Injectable } from '@nestjs/common';
import * as appInsights from 'applicationinsights';

import type { TLlmUsage } from '@/common/types';

@Injectable()
export class AppInsightsMetricsService {
  private readonly client: appInsights.TelemetryClient | null =
    appInsights.defaultClient ?? null;

  trackBatchItemSuccess(batchId: string): void {
    if (!this.client) return;
    this.client.trackMetric({
      name: 'ai.batch.item.success',
      value: 1,
      properties: { batchId },
    });
  }

  trackBatchItemFailure(batchId: string, reason: string): void {
    if (!this.client) return;
    this.client.trackMetric({
      name: 'ai.batch.item.failure',
      value: 1,
      properties: { batchId, reason },
    });
    this.client.trackEvent({
      name: 'BatchItemFailed',
      properties: { batchId, reason },
    });
  }

  trackBatchCompletion(batchId: string, failureRate: number): void {
    if (!this.client) return;
    this.client.trackMetric({
      name: 'ai.batch.failure_rate',
      value: failureRate,
      properties: { batchId },
    });
    this.client.trackEvent({
      name: 'BatchCompleted',
      properties: { batchId, failureRate: String(failureRate) },
    });
  }

  trackLlmTokenUsage(service: string, usage: TLlmUsage): void {
    if (!this.client) return;
    this.client.trackMetric({
      name: 'ai.llm.tokens.prompt',
      value: usage.promptTokens,
      properties: { service },
    });
    this.client.trackMetric({
      name: 'ai.llm.tokens.completion',
      value: usage.completionTokens,
      properties: { service },
    });
  }

  trackLlmRetry(service: string, attempt: number): void {
    if (!this.client) return;
    this.client.trackMetric({
      name: 'ai.llm.retry',
      value: 1,
      properties: { service, attempt: String(attempt) },
    });
    this.client.trackEvent({
      name: 'LlmRetry',
      properties: { service, attempt: String(attempt) },
    });
  }
}
