import { z } from 'zod';

import { AiAngelReportStatusSchema } from '@/db/schemas/ai-angel-report.schema';

// ── Shared building blocks ───────────────────────────────────────────────────

export const ProgressTrendSchema = z.enum(['improving', 'declining', 'stable']);
export type TProgressTrend = z.infer<typeof ProgressTrendSchema>;
export const ProgressTrend = ProgressTrendSchema.enum;

export const ProgressInsightSchema = z.object({
  summary: z.string(),
  trend: ProgressTrendSchema,
  details: z.array(z.string()),
  /**
   * Score change (in percentage points) vs the most recent prior session.
   * Positive = improvement, negative = regression. Null when this is the student's first session.
   */
  scoreDelta: z.number().nullable(),
});

export const TopicScoreEntrySchema = z.object({
  name: z.string(),
  /** Accuracy percentage for this topic (0–100) */
  percentage: z.number().min(0).max(100),
});

export const StrengthWeaknessSchema = z.object({
  topics: z.array(TopicScoreEntrySchema),
  summary: z.string(),
});

export const CohortComparisonSchema = z.object({
  percentile: z.number().min(0).max(100),
  /** Total number of students who have attempted this exam (used to judge percentile reliability). */
  cohortSize: z.number(),
  summary: z.string(),
});

/** Generic summary + bullet-detail block used by multiple report sections. */
export const InsightBlockSchema = z.object({
  summary: z.string(),
  details: z.array(z.string()),
});

// Keep named alias for backwards compatibility with existing usages
export const TimeManagementSchema = InsightBlockSchema;

// ── Category insights ────────────────────────────────────────────────────────

export const CategoryScoreEntrySchema = z.object({
  name: z.string(),
  /** Accuracy % across all attempted questions in this category (0–100) */
  percentage: z.number().min(0).max(100),
  correct: z.number(),
  total: z.number(),
});
export type TCategoryScoreEntry = z.infer<typeof CategoryScoreEntrySchema>;

export const CategoryInsightsSchema = z.object({
  /**
   * One entry per subject category, ordered by percentage ascending
   * so the weakest categories appear first.
   */
  categories: z.array(CategoryScoreEntrySchema),
  summary: z.string(),
  details: z.array(z.string()),
});

// ── Session summary ──────────────────────────────────────────────────────────

export const SessionSummarySchema = z.object({
  examTitle: z.string(),
  /** Overall score as a percentage (0–100). */
  score: z.number().min(0).max(100),
  totalQuestions: z.number(),
  attempted: z.number(),
  correct: z.number(),
  incorrect: z.number(),
  skipped: z.number(),
  /**
   * Percentage of total questions that were attempted (0–100).
   * Low completion rate may indicate time pressure or avoidance behaviour.
   */
  completionRate: z.number().min(0).max(100),
  timeTakenMinutes: z.number(),
  allocatedMinutes: z.number(),
  /** 1–2 sentence factual overview of this session's result and time efficiency. */
  summary: z.string(),
});

// ── AI Angel report ──────────────────────────────────────────────────────────

export const AiAngelReportSchema = z.object({
  /**
   * Factual session overview: score, attempt counts, time efficiency.
   * Should echo the raw numbers faithfully — no interpretation here.
   */
  sessionSummary: SessionSummarySchema,

  /** Score trend across historical sessions. */
  progress: ProgressInsightSchema,

  /** Topics where the student genuinely excels. */
  strengths: StrengthWeaknessSchema,

  /** Topics that need focused study. */
  weaknesses: StrengthWeaknessSchema,

  /** How the student compares to peers who attempted the same exam. */
  cohortComparison: CohortComparisonSchema,

  /**
   * Time management analysis: overall pacing, per-topic time efficiency,
   * slow+correct vs slow+incorrect patterns.
   */
  timeManagement: InsightBlockSchema,

  /**
   * Question-behaviour pattern analysis using the slow/fast × correct/wrong
   * quadrant data per topic: mastered, developing (slow+correct), careless
   * (fast+wrong), struggling (slow+wrong).
   */
  questionPatterns: InsightBlockSchema,

  /**
   * Difficulty-level insights: per-difficulty accuracy, which difficulty
   * bands need most work, cross-referenced with topic performance.
   */
  difficultyInsights: InsightBlockSchema,

  /**
   * Section-level performance: which exam sections are strong vs weak,
   * completion rates per section, and priority sections to focus on.
   */
  sectionInsights: InsightBlockSchema,

  /**
   * Subject-category performance: high-level view of which categories
   * (e.g. Pure Math, Applied Science) the student is strongest/weakest in,
   * above the topic level.
   */
  categoryInsights: CategoryInsightsSchema,

  /**
   * Actionable next-step recommendations for the student.
   */
  suggestions: InsightBlockSchema,
});
export type TAiAngelReport = z.infer<typeof AiAngelReportSchema>;

// Re-export status enum (single source of truth in DB schema)
export { AiAngelReportStatusSchema };
export type { TAiAngelReportStatus } from '@/db/schemas/ai-angel-report.schema';

// ── Session history (for frontend graphs) ─────────────────────────────────────

export const SessionHistoryEntrySchema = z.object({
  sessionId: z.string(),
  /** YYYY-MM-DD */
  date: z.string(),
  /** Accuracy percentage (0–100) */
  percentage: z.number(),
});
export type TSessionHistoryEntry = z.infer<typeof SessionHistoryEntrySchema>;

/**
 * What is actually persisted in ReportData: the LLM-generated report plus
 * the raw session-score history for frontend graphing.
 * sessionHistory is NOT generated by the LLM — it is appended by the service.
 */
export const StoredReportDataSchema = AiAngelReportSchema.extend({
  sessionHistory: z.array(SessionHistoryEntrySchema),
});
export type TStoredReportData = z.infer<typeof StoredReportDataSchema>;

// ── Response schemas ──────────────────────────────────────────────────────────

export const AiAngelReportResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: AiAngelReportStatusSchema,
    sessionId: z.string().nullable(),
    createdAt: z.string(),
    report: StoredReportDataSchema.nullable(),
  })
  .nullable();
export type TAiAngelReportResponse = z.infer<
  typeof AiAngelReportResponseSchema
>;

export const RequestAngelReportResponseSchema = z.object({
  id: z.string().uuid(),
  status: AiAngelReportStatusSchema,
});
export type TRequestAngelReportResponse = z.infer<
  typeof RequestAngelReportResponseSchema
>;

// ── Job data ──────────────────────────────────────────────────────────────────

export type TAiAngelReportJobData = {
  reportId: string;
  sessionId: string;
  userId: string;
  userEmail: string;
  userName: string;
  previousReport: TAiAngelReport | null;
};

// ── Path params ──────────────────────────────────────────────────────────────

export const GetAngelReportParamsSchema = z.object({
  sessionId: z.string().uuid(),
});
