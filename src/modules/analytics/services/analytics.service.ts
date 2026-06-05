import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAzure } from '@ai-sdk/azure';
import { generateObject } from 'ai';
import { eq, sql } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import type { Queue } from 'bullmq';

import type { Config } from '@/config';
import { BaseService } from '@/common/services';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';
import { AIAngelReports, AiAngelReportStatus } from '@/db/schemas';
import {
  AiAngelReportSchema,
  TAiAngelReport,
  TAiAngelReportJobData,
  TAiAngelReportResponse,
  TAuthUserReq,
  TErrorResult,
  TRequestAngelReportResponse,
  TSessionHistoryEntry,
  TStoredReportData,
} from '@/common/types';
import { detectPhantomFeatures, serializeError, withLlmRetry } from '@/utils';
import {
  buildAnalyticsPrompt,
  CategoryScore,
  ExamDifficultyScore,
  ExamOverallStats,
  ExamSectionScore,
  ExamTopicScore,
  ExamTopicTimeData,
  HistoricalSession,
  QuestionQuadrant,
  QuestionTypeStats,
  SessionMetadata,
  SkippedTopicStats,
  TopicDifficultyBreakdown,
} from '@/utils/analytics-prompt.util';
import { LangfuseService } from '@/common/services/langfuse.service';
import { AppInsightsMetricsService } from '@/common/services';
import {
  InjectAiAngelReportQueue,
  PROCESS_AI_ANGEL_REPORT_JOB,
} from '@/queues';

@Injectable()
export class AnalyticsService extends BaseService<typeof AIAngelReports> {
  private readonly model: ReturnType<ReturnType<typeof createAzure>>;

  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(AnalyticsService.name)
    private readonly logger: PinoLogger,
    private readonly config: ConfigService<Config, true>,
    private readonly langfuseService: LangfuseService,
    private readonly metricsService: AppInsightsMetricsService,
    private readonly cls: ClsService,
    @InjectAiAngelReportQueue()
    private readonly reportQueue: Queue<TAiAngelReportJobData>,
  ) {
    super(db, AIAngelReports);

    const azure = this.config.get('azure', { infer: true });
    const client = createAzure({
      resourceName: azure.openai.resource,
      apiKey: azure.openai.key,
    });
    this.model = client(azure.openai.deployment);
  }

  // ── Request (POST) ──────────────────────────────────────────────────────────

  async requestReport(): Promise<
    Result<TRequestAngelReportResponse, TErrorResult>
  > {
    const {
      id: userId,
      email: userEmail,
      firstName,
      lastName,
    } = this.cls.get<TAuthUserReq>('user');
    const userName = `${firstName} ${lastName}`;

    try {
      // 1. Find the most recent completed session for this user
      const sessionResult = await this.db.execute(sql`
        SELECT "Id"
        FROM "StudentExamSessions"
        WHERE "UserId" = ${userId}
          AND "IsCompleted" = TRUE
        ORDER BY "Created" DESC
        LIMIT 1
      `);

      if (sessionResult.rows.length === 0) {
        return err({
          status: HttpStatus.NOT_FOUND,
          message: 'No completed exam session found',
        });
      }

      const sessionId = (sessionResult.rows[0] as { Id: string }).Id;

      // 2. Check if a report already exists for this session
      const [existingReport] = await this.db
        .select({ Id: AIAngelReports.Id, Status: AIAngelReports.Status })
        .from(AIAngelReports)
        .where(
          sql`${AIAngelReports.SessionId} = ${sessionId} AND ${AIAngelReports.UserId} = ${userId}`,
        )
        .limit(1);

      if (existingReport) {
        if (existingReport.Status !== AiAngelReportStatus.FAILED) {
          return err({
            status: HttpStatus.CONFLICT,
            message: 'A report already exists for this session',
          });
        }
        // FAILED → delete and regenerate
        await this.db
          .delete(AIAngelReports)
          .where(eq(AIAngelReports.Id, existingReport.Id));
      }

      // 3. Find the most recent completed report for the same exam (LLM context)
      const prevReportResult = await this.db.execute(sql`
        SELECT ar."ReportData"
        FROM "AiAngelReports" ar
        JOIN "StudentExamSessions" ses ON ses."Id" = ar."SessionId"::uuid
        WHERE ar."UserId" = ${userId}
          AND ar."Status" = 'COMPLETED'
          AND ses."ExamId" = (
            SELECT "ExamId" FROM "StudentExamSessions" WHERE "Id" = ${sessionId}::uuid
          )
        ORDER BY ar."Created" DESC
        LIMIT 1
      `);

      const prevRow = prevReportResult.rows[0] as
        | { ReportData: unknown }
        | undefined;
      const previousReport =
        prevRow?.ReportData != null
          ? (prevRow.ReportData as unknown as TAiAngelReport)
          : null;

      // 4. Insert a new PENDING report
      const [inserted] = await this.db
        .insert(AIAngelReports)
        .values({
          UserId: userId,
          SessionId: sessionId,
          Status: AiAngelReportStatus.PENDING,
        })
        .returning({ Id: AIAngelReports.Id, Status: AIAngelReports.Status });

      // 5. Enqueue the job
      await this.reportQueue.add(PROCESS_AI_ANGEL_REPORT_JOB, {
        reportId: inserted.Id,
        sessionId,
        userId,
        userEmail,
        userName,
        previousReport,
      });

      return ok({ id: inserted.Id, status: inserted.Status });
    } catch (error) {
      this.logger.error({
        message: 'Failed to request AI Angel report',
        data: { userId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to request AI Angel report',
      });
    }
  }

  // ── Get (GET /:sessionId) ───────────────────────────────────────────────────

  async getReport(
    sessionId: string,
  ): Promise<Result<TAiAngelReportResponse | null, TErrorResult>> {
    const userId = this.cls.get<TAuthUserReq>('user').id;

    try {
      const [row] = await this.db
        .select()
        .from(AIAngelReports)
        .where(
          sql`${AIAngelReports.SessionId} = ${sessionId} AND ${AIAngelReports.UserId} = ${userId}`,
        )
        .orderBy(sql`${AIAngelReports.Created} DESC`)
        .limit(1);

      if (!row) {
        return ok(null);
      }

      return ok({
        id: row.Id,
        status: row.Status,
        sessionId: row.SessionId ?? null,
        createdAt: row.Created.toISOString(),
        report:
          row.Status === AiAngelReportStatus.COMPLETED &&
          row.ReportData !== null
            ? (row.ReportData as unknown as TStoredReportData)
            : null,
      });
    } catch (error) {
      this.logger.error({
        message: 'Failed to fetch AI Angel report',
        data: { sessionId, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to fetch AI Angel report',
      });
    }
  }

  // ── Execute (called by worker) ──────────────────────────────────────────────

  async executeReportGeneration(
    reportId: string,
    sessionId: string,
    previousReport: TAiAngelReport | null,
  ): Promise<Result<void, TErrorResult>> {
    // Mark IN_PROGRESS
    await this.db
      .update(AIAngelReports)
      .set({ Status: AiAngelReportStatus.IN_PROGRESS })
      .where(eq(AIAngelReports.Id, reportId));

    let overall: ExamOverallStats;
    let topicScores: ExamTopicScore[];
    let sectionScores: ExamSectionScore[];
    let difficultyScores: ExamDifficultyScore[];
    let historicalSessions: HistoricalSession[];
    let cohortPercentile: number | null;
    let cohortSize: number;
    let topicTimeData: ExamTopicTimeData[];
    let topicDifficultyBreakdown: TopicDifficultyBreakdown[];
    let questionQuadrants: QuestionQuadrant[];
    let skippedTopicStats: SkippedTopicStats[];
    let questionTypeStats: QuestionTypeStats[];
    let categoryScores: CategoryScore[];
    let sessionMetadata: SessionMetadata | null;

    try {
      const [
        overallResult,
        topicsResult,
        sectionsResult,
        difficultyResult,
        historicalResult,
        cohortResult,
        topicTimeResult,
        topicDiffResult,
        quadrantResult,
        skippedResult,
        questionTypeResult,
        sessionMetaResult,
        categoryResult,
      ] = await Promise.all([
        this.db.execute(
          sql`SELECT * FROM calculate_exam_overall_stats(${sessionId}::uuid)`,
        ),
        this.db.execute(
          sql`SELECT * FROM calculate_exam_topic_scores(${sessionId}::uuid)`,
        ),
        this.db.execute(
          sql`SELECT * FROM calculate_exam_section_scores(${sessionId}::uuid)`,
        ),
        this.db.execute(
          sql`SELECT * FROM calculate_exam_difficulty_scores(${sessionId}::uuid)`,
        ),

        this.db.execute(sql`
          SELECT
            ses."Id"                                                             AS "SessionId",
            TO_CHAR(ses."Created", 'YYYY-MM-DD')                               AS "Date",
            ROUND(
              SUM(CASE WHEN se."IsCorrect" = TRUE AND se."IsSkipped" = FALSE THEN 1 ELSE 0 END)::NUMERIC
              / NULLIF(ses."Count", 0) * 100, 2
            )                                                                   AS "PercentageCorrect"
          FROM "StudentExamSessions" ses
          JOIN "StudentExams" se ON se."SessionId" = ses."Id"
          WHERE ses."UserId" = (SELECT "UserId" FROM "StudentExamSessions" WHERE "Id" = ${sessionId}::uuid)
            AND ses."Id" != ${sessionId}::uuid
            AND ses."IsCompleted" = TRUE
          GROUP BY ses."Id", ses."Created", ses."Count"
          ORDER BY ses."Created" DESC
          LIMIT 4
        `),

        this.db.execute(sql`
          WITH UserLatestSession AS (
            -- One row per distinct student: their most recent completed session for this exam
            SELECT DISTINCT ON (ses."UserId")
              ses."UserId",
              ses."Id"    AS "SessionId",
              ses."Count"
            FROM "StudentExamSessions" ses
            WHERE ses."ExamId" = (
              SELECT "ExamId" FROM "StudentExamSessions" WHERE "Id" = ${sessionId}::uuid
            )
              AND ses."IsCompleted" = TRUE
            ORDER BY ses."UserId", ses."Created" DESC
          ),
          UserScores AS (
            -- Score for each student based on their latest session
            SELECT
              uls."UserId",
              SUM(CASE WHEN se."IsCorrect" = TRUE AND se."IsSkipped" = FALSE THEN 1 ELSE 0 END)::NUMERIC
              / NULLIF(uls."Count", 0) * 100 AS score
            FROM UserLatestSession uls
            JOIN "StudentExams" se ON se."SessionId" = uls."SessionId"
            GROUP BY uls."UserId", uls."Count"
          ),
          CurrentScore AS (
            SELECT
              SUM(CASE WHEN se."IsCorrect" = TRUE AND se."IsSkipped" = FALSE THEN 1 ELSE 0 END)::NUMERIC
              / NULLIF(ses."Count", 0) * 100 AS score
            FROM "StudentExams" se
            JOIN "StudentExamSessions" ses ON se."SessionId" = ses."Id"
            WHERE ses."Id" = ${sessionId}::uuid
            GROUP BY ses."Count"
          ),
          Stats AS (
            SELECT
              COUNT(*)                                                                         AS total,
              COUNT(CASE WHEN us.score < (SELECT score FROM CurrentScore) THEN 1 END) AS below
            FROM UserScores us
          )
          SELECT
            ROUND(below::NUMERIC / NULLIF(total, 0) * 100, 0) AS "Percentile",
            total::INTEGER                                      AS "CohortSize"
          FROM Stats
        `),

        this.db.execute(sql`
          SELECT
            t."Name"                                                             AS "TopicName",
            ROUND(AVG(se."TimeTakenInSeconds")::NUMERIC, 1)                    AS "AvgTimePerQuestion",
            COUNT(*)::INTEGER                                                    AS "QuestionCount",
            SUM(CASE WHEN se."IsCorrect" = TRUE THEN 1 ELSE 0 END)::INTEGER    AS "CorrectCount"
          FROM "StudentExams" se
          JOIN "Questions" q ON se."QuestionId" = q."Id"
          JOIN "Topics" t ON q."TopicId" = t."Id"
          WHERE se."SessionId" = ${sessionId}::uuid
            AND se."IsSkipped" = FALSE
          GROUP BY t."Id", t."Name"
          ORDER BY "AvgTimePerQuestion" DESC
        `),

        this.db.execute(sql`
          SELECT
            t."Name"                                                             AS "TopicName",
            qt_diff."Value"                                                      AS "Difficulty",
            COUNT(*)::INTEGER                                                    AS "Total",
            SUM(CASE WHEN se."IsSkipped" = TRUE  THEN 1 ELSE 0 END)::INTEGER   AS "Skipped",
            SUM(CASE WHEN se."IsCorrect" = TRUE   THEN 1 ELSE 0 END)::INTEGER   AS "Correct",
            SUM(CASE WHEN se."IsCorrect" = FALSE
                      AND se."IsSkipped" = FALSE   THEN 1 ELSE 0 END)::INTEGER  AS "Incorrect",
            ROUND(
              AVG(CASE WHEN se."IsSkipped" = FALSE THEN se."TimeTakenInSeconds" END)::NUMERIC, 1
            )                                                                    AS "AvgTime"
          FROM "StudentExams" se
          JOIN "Questions" q ON se."QuestionId" = q."Id"
          JOIN "Topics" t ON q."TopicId" = t."Id"
          LEFT JOIN "QuestionTags" qt_diff
            ON qt_diff."QuestionId" = q."Id" AND qt_diff."Name" = 'difficulty'
          WHERE se."SessionId" = ${sessionId}::uuid
          GROUP BY t."Id", t."Name", qt_diff."Value"
          ORDER BY t."Name", qt_diff."Value"
        `),

        this.db.execute(sql`
          WITH SessionAvg AS (
            SELECT AVG("TimeTakenInSeconds")::NUMERIC AS avg_time
            FROM "StudentExams"
            WHERE "SessionId" = ${sessionId}::uuid AND "IsSkipped" = FALSE
          )
          SELECT
            t."Name"                                                             AS "TopicName",
            SUM(CASE WHEN se."TimeTakenInSeconds" >  sa.avg_time AND se."IsCorrect" = TRUE  THEN 1 ELSE 0 END)::INTEGER AS "SlowCorrect",
            SUM(CASE WHEN se."TimeTakenInSeconds" >  sa.avg_time AND se."IsCorrect" = FALSE THEN 1 ELSE 0 END)::INTEGER AS "SlowIncorrect",
            SUM(CASE WHEN se."TimeTakenInSeconds" <= sa.avg_time AND se."IsCorrect" = TRUE  THEN 1 ELSE 0 END)::INTEGER AS "FastCorrect",
            SUM(CASE WHEN se."TimeTakenInSeconds" <= sa.avg_time AND se."IsCorrect" = FALSE THEN 1 ELSE 0 END)::INTEGER AS "FastIncorrect"
          FROM "StudentExams" se
          JOIN "Questions" q ON se."QuestionId" = q."Id"
          JOIN "Topics" t ON q."TopicId" = t."Id"
          CROSS JOIN SessionAvg sa
          WHERE se."SessionId" = ${sessionId}::uuid
            AND se."IsSkipped" = FALSE
          GROUP BY t."Id", t."Name"
          ORDER BY t."Name"
        `),

        this.db.execute(sql`
          SELECT
            t."Name"                                                             AS "TopicName",
            COUNT(*)::INTEGER                                                    AS "SkippedCount",
            ROUND(AVG(se."TimeTakenInSeconds")::NUMERIC, 1)                    AS "AvgTimeBeforeSkip"
          FROM "StudentExams" se
          JOIN "Questions" q ON se."QuestionId" = q."Id"
          JOIN "Topics" t ON q."TopicId" = t."Id"
          WHERE se."SessionId" = ${sessionId}::uuid
            AND se."IsSkipped" = TRUE
          GROUP BY t."Id", t."Name"
          ORDER BY "SkippedCount" DESC
        `),

        this.db.execute(sql`
          SELECT
            CASE
              WHEN se."AnswerId"   IS NOT NULL                          THEN 'MCQ'
              WHEN se."TextAnswer" IS NOT NULL AND se."TextAnswer" != '' THEN 'OpenEnded'
              WHEN se."IsSkipped"  = TRUE                               THEN 'Skipped'
              ELSE 'Unknown'
            END                                                                  AS "QuestionType",
            COUNT(*)::INTEGER                                                    AS "Total",
            SUM(CASE WHEN se."IsCorrect" = TRUE  THEN 1 ELSE 0 END)::INTEGER   AS "Correct",
            SUM(CASE WHEN se."IsCorrect" = FALSE THEN 1 ELSE 0 END)::INTEGER   AS "Incorrect",
            ROUND(
              AVG(CASE WHEN se."IsSkipped" = FALSE THEN se."TimeTakenInSeconds" END)::NUMERIC, 1
            )                                                                    AS "AvgTime"
          FROM "StudentExams" se
          WHERE se."SessionId" = ${sessionId}::uuid
          GROUP BY 1
          ORDER BY 1
        `),

        this.db.execute(sql`
          SELECT
            ses."Difficulty"        AS "Difficulty",
            ses."ExamType"          AS "ExamType",
            ses."Type"              AS "QuestionType",
            ses."TimeTakenAt"       AS "TimeTakenAt",
            ses."RecallInterval"    AS "RecallInterval",
            ses."TotalQuestions"    AS "SessionTotalQuestions",
            ses."CorrectAnswers"    AS "SessionCorrectAnswers",
            ses."IncorrectAnswers"  AS "SessionIncorrectAnswers",
            ses."SkippedQuestions"  AS "SessionSkippedQuestions",
            ses."OverallPercentage"::TEXT AS "SessionOverallPercentage"
          FROM "StudentExamSessions" ses
          WHERE ses."Id" = ${sessionId}::uuid
        `),

        this.db.execute(sql`
          SELECT
            c."Name"::TEXT AS "CategoryName",
            COUNT(se."Id")::INTEGER AS "Total",
            SUM(CASE WHEN se."IsCorrect" = TRUE  AND se."IsSkipped" = FALSE THEN 1 ELSE 0 END)::INTEGER AS "Correct",
            SUM(CASE WHEN se."IsCorrect" = FALSE AND se."IsSkipped" = FALSE THEN 1 ELSE 0 END)::INTEGER AS "Incorrect",
            SUM(CASE WHEN se."IsSkipped" = TRUE  THEN 1 ELSE 0 END)::INTEGER AS "Skipped",
            ROUND(
              SUM(CASE WHEN se."IsCorrect" = TRUE AND se."IsSkipped" = FALSE THEN 1 ELSE 0 END)::NUMERIC
              / NULLIF(SUM(CASE WHEN se."IsSkipped" = FALSE THEN 1 ELSE 0 END), 0) * 100,
              2
            ) AS "PercentageCorrect",
            ROUND(AVG(se."TimeTakenInSeconds")::NUMERIC, 1) AS "AvgTimePerQuestion"
          FROM "StudentExams" se
          JOIN "Questions"   q ON se."QuestionId"  = q."Id"
          JOIN "Topics"      t ON q."TopicId"       = t."Id"
          JOIN "Categories"  c ON t."CategoryId"    = c."Id"
          WHERE se."SessionId" = ${sessionId}::uuid
          GROUP BY c."Id", c."Name"
          ORDER BY c."Name"
        `),
      ]);

      if (overallResult.rows.length === 0) {
        await this.db
          .update(AIAngelReports)
          .set({
            Status: AiAngelReportStatus.FAILED,
            ErrorMessage: `Session not found: ${sessionId}`,
          })
          .where(eq(AIAngelReports.Id, reportId));
        return err({
          status: HttpStatus.NOT_FOUND,
          message: `Session not found: ${sessionId}`,
        });
      }

      overall = overallResult.rows[0] as unknown as ExamOverallStats;
      topicScores = topicsResult.rows as unknown as ExamTopicScore[];
      sectionScores = sectionsResult.rows as unknown as ExamSectionScore[];
      difficultyScores =
        difficultyResult.rows as unknown as ExamDifficultyScore[];
      historicalSessions =
        historicalResult.rows as unknown as HistoricalSession[];

      const cohortRow = cohortResult.rows[0] as
        | { Percentile: string; CohortSize: number }
        | undefined;
      cohortSize = cohortRow?.CohortSize ?? 0;
      cohortPercentile =
        cohortRow && cohortSize >= 5 ? Number(cohortRow.Percentile) : null;

      topicTimeData = topicTimeResult.rows as unknown as ExamTopicTimeData[];
      topicDifficultyBreakdown =
        topicDiffResult.rows as unknown as TopicDifficultyBreakdown[];
      questionQuadrants = quadrantResult.rows as unknown as QuestionQuadrant[];
      skippedTopicStats = skippedResult.rows as unknown as SkippedTopicStats[];
      questionTypeStats =
        questionTypeResult.rows as unknown as QuestionTypeStats[];
      categoryScores = categoryResult.rows as unknown as CategoryScore[];
      sessionMetadata =
        (sessionMetaResult.rows[0] as unknown as SessionMetadata) ?? null;
    } catch (error) {
      const message = 'Failed to fetch exam analytics from database';
      this.logger.error({
        message,
        data: { reportId, sessionId, error: serializeError(error) },
      });
      await this.db
        .update(AIAngelReports)
        .set({ Status: AiAngelReportStatus.FAILED, ErrorMessage: message })
        .where(eq(AIAngelReports.Id, reportId));
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to fetch exam analytics',
      });
    }

    const trace = this.langfuseService.client.trace({
      name: 'ai-angel-report',
      metadata: { reportId, sessionId },
    });

    // Pre-compute derived values needed for both prompt and numeric correction
    const totalTimeMin = overall.TotalTime;
    const timeTakenMin = Math.round(overall.TotalTimeTaken / 60);
    const completionRate =
      overall.TotalQuestions > 0
        ? Math.round(
            (overall.AttemptedQuestions / overall.TotalQuestions) * 100,
          )
        : 100;
    const mostRecentPriorScore =
      historicalSessions.length > 0
        ? parseFloat(historicalSessions[0].PercentageCorrect)
        : null;
    const scoreDelta =
      mostRecentPriorScore !== null
        ? Math.round(
            (parseFloat(overall.PercentageCorrect) - mostRecentPriorScore) * 10,
          ) / 10
        : null;

    // Helper: one LLM call with its own Langfuse generation span
    const runLlmGeneration = async (
      prompt: string,
    ): Promise<TAiAngelReport> => {
      const gen = trace.generation({
        name: 'llm:ai-angel-report',
        input: { prompt },
      });
      try {
        const result = await withLlmRetry(
          (idempotencyKey) =>
            generateObject({
              model: this.model,
              schema: AiAngelReportSchema,
              system:
                'You are an educational analytics assistant. Generate structured, empathetic, data-grounded insights for a student based on their exam session performance.',
              prompt,
              headers: { 'Idempotency-Key': idempotencyKey },
            }),
          {
            onRetry: (attempt) =>
              this.metricsService.trackLlmRetry('analytics', attempt),
          },
        );
        gen.end({
          output: result.object,
          usage: {
            input: result.usage.inputTokens ?? 0,
            output: result.usage.outputTokens ?? 0,
            total:
              (result.usage.inputTokens ?? 0) +
              (result.usage.outputTokens ?? 0),
          },
        });
        return result.object;
      } catch (error) {
        gen.end({ output: { error: serializeError(error) } });
        throw error;
      }
    };

    try {
      const prompt = buildAnalyticsPrompt({
        overall,
        topicScores,
        sectionScores,
        difficultyScores,
        historicalSessions,
        cohortPercentile,
        cohortSize,
        topicTimeData,
        topicDifficultyBreakdown,
        questionQuadrants,
        skippedTopicStats,
        questionTypeStats,
        categoryScores,
        sessionMetadata,
        previousReport,
      });

      let reportObject = await runLlmGeneration(prompt);

      // Guard: detect phantom platform features hallucinated in suggestions
      const phantomViolations = detectPhantomFeatures(reportObject.suggestions);
      if (phantomViolations.length > 0) {
        this.logger.warn({
          message:
            'Phantom features detected — retrying with correction prompt',
          data: { reportId, sessionId, violations: phantomViolations },
        });
        this.metricsService.trackSuggestionsPhantomFeatures(
          reportId,
          phantomViolations.length,
        );

        // Retry once with explicit correction suffix
        const correctionSuffix =
          `\n\nCORRECTION — MANDATORY: Your previous response mentioned ` +
          `"${phantomViolations.map((v) => v.term).join('", "')}" which do NOT exist on ` +
          `this platform. Remove ALL mentions of these terms. Use ONLY FullExam, Sectional, ` +
          `or QuickReview as session type names.`;
        reportObject = await runLlmGeneration(prompt + correctionSuffix);

        const retryPhantoms = detectPhantomFeatures(reportObject.suggestions);
        trace.score({
          name: 'suggestions_quality',
          value: retryPhantoms.length === 0 ? 1 : 0,
          comment:
            retryPhantoms.length > 0
              ? `Phantom features persist after retry: ${retryPhantoms.map((v) => v.term).join(', ')}`
              : 'Phantom features resolved after retry',
        });
      } else {
        trace.score({
          name: 'suggestions_quality',
          value: 1,
          comment: 'No phantom features detected',
        });
      }

      // Sanity-check: force key numeric fields to match source data exactly
      reportObject = this.applyNumericCorrections(reportObject, {
        score: parseFloat(overall.PercentageCorrect),
        totalQuestions: overall.TotalQuestions,
        attempted: overall.AttemptedQuestions,
        correct: overall.CorrectAnswers,
        incorrect: overall.IncorrectAnswers,
        skipped: overall.SkippedQuestions,
        completionRate,
        timeTakenMinutes: timeTakenMin,
        allocatedMinutes: totalTimeMin,
        scoreDelta,
        cohortSize,
        reportId,
      });

      // Build chronological session history (oldest → newest) for frontend graphs
      const currentDate = sessionMetadata?.TimeTakenAt
        ? new Date(sessionMetadata.TimeTakenAt).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const sessionHistoryEntries: TSessionHistoryEntry[] = [
        ...[...historicalSessions].reverse().map((h) => ({
          sessionId: h.SessionId,
          date: h.Date,
          percentage: parseFloat(h.PercentageCorrect),
        })),
        {
          sessionId,
          date: currentDate,
          percentage: parseFloat(overall.PercentageCorrect),
        },
      ];

      const storedReport: TStoredReportData = {
        ...reportObject,
        sessionHistory: sessionHistoryEntries,
      };

      await this.db
        .update(AIAngelReports)
        .set({
          Status: AiAngelReportStatus.COMPLETED,
          ReportData: storedReport,
        })
        .where(eq(AIAngelReports.Id, reportId));

      return ok(undefined);
    } catch (error) {
      const message = 'Failed to generate AI Angel report';
      this.logger.error({
        message,
        data: { reportId, sessionId, error: serializeError(error) },
      });
      await this.db
        .update(AIAngelReports)
        .set({ Status: AiAngelReportStatus.FAILED, ErrorMessage: message })
        .where(eq(AIAngelReports.Id, reportId));
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to generate AI Angel report',
      });
    }
  }

  private applyNumericCorrections(
    report: TAiAngelReport,
    params: {
      score: number;
      totalQuestions: number;
      attempted: number;
      correct: number;
      incorrect: number;
      skipped: number;
      completionRate: number;
      timeTakenMinutes: number;
      allocatedMinutes: number;
      scoreDelta: number | null;
      cohortSize: number;
      reportId: string;
    },
  ): TAiAngelReport {
    const corrections: string[] = [];

    const ss = { ...report.sessionSummary };
    if (ss.score !== params.score) {
      corrections.push(`sessionSummary.score: ${ss.score} → ${params.score}`);
      ss.score = params.score;
    }
    if (ss.totalQuestions !== params.totalQuestions) {
      corrections.push(
        `sessionSummary.totalQuestions: ${ss.totalQuestions} → ${params.totalQuestions}`,
      );
      ss.totalQuestions = params.totalQuestions;
    }
    if (ss.attempted !== params.attempted) {
      corrections.push(
        `sessionSummary.attempted: ${ss.attempted} → ${params.attempted}`,
      );
      ss.attempted = params.attempted;
    }
    if (ss.correct !== params.correct) {
      corrections.push(
        `sessionSummary.correct: ${ss.correct} → ${params.correct}`,
      );
      ss.correct = params.correct;
    }
    if (ss.incorrect !== params.incorrect) {
      corrections.push(
        `sessionSummary.incorrect: ${ss.incorrect} → ${params.incorrect}`,
      );
      ss.incorrect = params.incorrect;
    }
    if (ss.skipped !== params.skipped) {
      corrections.push(
        `sessionSummary.skipped: ${ss.skipped} → ${params.skipped}`,
      );
      ss.skipped = params.skipped;
    }
    if (ss.completionRate !== params.completionRate) {
      corrections.push(
        `sessionSummary.completionRate: ${ss.completionRate} → ${params.completionRate}`,
      );
      ss.completionRate = params.completionRate;
    }
    if (ss.timeTakenMinutes !== params.timeTakenMinutes) {
      corrections.push(
        `sessionSummary.timeTakenMinutes: ${ss.timeTakenMinutes} → ${params.timeTakenMinutes}`,
      );
      ss.timeTakenMinutes = params.timeTakenMinutes;
    }
    if (ss.allocatedMinutes !== params.allocatedMinutes) {
      corrections.push(
        `sessionSummary.allocatedMinutes: ${ss.allocatedMinutes} → ${params.allocatedMinutes}`,
      );
      ss.allocatedMinutes = params.allocatedMinutes;
    }

    const progress = { ...report.progress };
    if (progress.scoreDelta !== params.scoreDelta) {
      corrections.push(
        `progress.scoreDelta: ${progress.scoreDelta} → ${params.scoreDelta}`,
      );
      progress.scoreDelta = params.scoreDelta;
    }

    const cohortComparison = { ...report.cohortComparison };
    if (cohortComparison.cohortSize !== params.cohortSize) {
      corrections.push(
        `cohortComparison.cohortSize: ${cohortComparison.cohortSize} → ${params.cohortSize}`,
      );
      cohortComparison.cohortSize = params.cohortSize;
    }

    if (corrections.length > 0) {
      this.logger.warn({
        message: 'Numeric corrections applied to analytics report',
        data: { reportId: params.reportId, corrections },
      });
      this.metricsService.trackNumericCorrections(
        params.reportId,
        corrections.length,
      );
    }

    return { ...report, sessionSummary: ss, progress, cohortComparison };
  }
}
