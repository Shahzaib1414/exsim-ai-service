import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { eq } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { TEnv } from '@/config';
import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import {
  AiAngelReportSchema,
  TAiAngelReport,
  TErrorResult,
  TGenerateAngelReportBody,
} from '@/common/types';
import { AIAngelReports } from '@/db/schemas/ai-angel-report.schema';
import { serializeError, withLlmRetry } from '@/utils';
import {
  buildPerformanceSummary,
  buildAnalyticsPrompt,
} from '@/utils/analytics-prompt.util';
import { LangfuseService } from '@/common/services/langfuse.service';
import { AppInsightsMetricsService } from '@/common/services';

@Injectable()
export class AnalyticsService extends BaseService {
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(AnalyticsService.name)
    private readonly logger: PinoLogger,
    private readonly config: ConfigService<TEnv, true>,
    private readonly langfuseService: LangfuseService,
    private readonly metricsService: AppInsightsMetricsService,
  ) {
    super(db);

    const azure = createAzure({
      resourceName: config.get('AZURE_OPENAI_RESOURCE'),
      apiKey: config.get('AZURE_OPENAI_KEY'),
    });

    this.model = azure(config.get('AZURE_OPENAI_DEPLOYMENT_GPT4O'));
  }

  async generateAngelReport(
    body: TGenerateAngelReportBody,
  ): Promise<Result<TAiAngelReport, TErrorResult>> {
    // Step 1: Cache check — idempotent by sessionId
    try {
      const existing = await this.db
        .select()
        .from(AIAngelReports)
        .where(eq(AIAngelReports.SessionId, body.sessionId))
        .limit(1);

      if (existing[0]) {
        const cached = AiAngelReportSchema.parse({
          progress: existing[0].Progress,
          strengths: existing[0].Strengths,
          weaknesses: existing[0].Weaknesses,
          cohortComparison: existing[0].CohortComparison,
        });
        this.logger.info({
          message: 'Returning cached AI Angel report',
          data: { sessionId: body.sessionId },
        });
        return ok(cached);
      }
    } catch (error) {
      this.logger.error({
        message: 'Failed to query cached AI Angel report',
        data: { sessionId: body.sessionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to query AI Angel report cache',
      });
    }

    // Step 2: Build performance summary for the prompt
    const summary = buildPerformanceSummary(body);
    const prompt = buildAnalyticsPrompt(body, summary);

    // Step 3: Call GPT-4o with structured output
    const trace = this.langfuseService.client.trace({
      name: 'ai-angel-report',
      metadata: { sessionId: body.sessionId, userId: body.userId },
    });
    const generation = trace.generation({
      name: 'llm:ai-angel-report',
      input: { prompt },
    });

    let report: TAiAngelReport;
    try {
      const result = await withLlmRetry(
        (idempotencyKey) =>
          generateObject({
            model: this.model,
            schema: AiAngelReportSchema,
            system:
              'You are an educational analytics assistant. Generate structured, empathetic, data-grounded insights for a student based on their test session performance.',
            prompt,
            headers: { 'Idempotency-Key': idempotencyKey },
          }),
        {
          onRetry: (attempt) =>
            this.metricsService.trackLlmRetry('analytics', attempt),
        },
      );

      generation.end({
        output: result.object,
        usage: {
          input: result.usage.inputTokens ?? 0,
          output: result.usage.outputTokens ?? 0,
          total:
            (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
        },
      });

      report = result.object;
    } catch (error) {
      generation.end({ output: { error: serializeError(error) } });
      this.logger.error({
        message: 'Failed to generate AI Angel report',
        data: { sessionId: body.sessionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to generate AI Angel report',
      });
    }

    // Step 4: Persist the report
    try {
      await this.db.insert(AIAngelReports).values({
        Id: randomUUID(),
        UserId: body.userId,
        SessionId: body.sessionId,
        Subject: body.subject,
        Topic: body.topic,
        Progress: report.progress,
        Strengths: report.strengths,
        Weaknesses: report.weaknesses,
        CohortComparison: report.cohortComparison,
        Created: new Date(),
      });
    } catch (error) {
      this.logger.error({
        message: 'Failed to persist AI Angel report',
        data: { sessionId: body.sessionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to persist AI Angel report',
      });
    }

    return ok(report);
  }

  async getReport(
    sessionId: string,
  ): Promise<Result<TAiAngelReport, TErrorResult>> {
    try {
      const rows = await this.db
        .select()
        .from(AIAngelReports)
        .where(eq(AIAngelReports.SessionId, sessionId))
        .limit(1);

      if (!rows[0]) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: `AI Angel report not found for session ${sessionId}`,
        });
      }

      const report = AiAngelReportSchema.parse({
        progress: rows[0].Progress,
        strengths: rows[0].Strengths,
        weaknesses: rows[0].Weaknesses,
        cohortComparison: rows[0].CohortComparison,
      });

      return ok(report);
    } catch (error) {
      this.logger.error({
        message: 'Failed to retrieve AI Angel report',
        data: { sessionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to retrieve AI Angel report',
      });
    }
  }
}
