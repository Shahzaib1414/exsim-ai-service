import { z } from 'zod';

// ── Sub-schemas ────────────────────────────────────────────────────────────

export const ProgressInsightSchema = z.object({
  summary: z.string(),
  trend: z.enum(['improving', 'declining', 'stable']),
  details: z.array(z.string()),
});

export const StrengthWeaknessSchema = z.object({
  topics: z.array(z.string()),
  summary: z.string(),
});

export const CohortComparisonSchema = z.object({
  percentile: z.number().min(0).max(100),
  summary: z.string(),
});

// ── AI Angel report ────────────────────────────────────────────────────────

export const AiAngelReportSchema = z.object({
  progress: ProgressInsightSchema,
  strengths: StrengthWeaknessSchema,
  weaknesses: StrengthWeaknessSchema,
  cohortComparison: CohortComparisonSchema,
});
export type TAiAngelReport = z.infer<typeof AiAngelReportSchema>;

// ── Request body ───────────────────────────────────────────────────────────

export const QuestionResultSchema = z.object({
  questionId: z.string().uuid(),
  isCorrect: z.boolean(),
  timeTakenSeconds: z.number().nonnegative(),
  difficulty: z.enum(['High', 'Medium', 'Low']),
  bloomsLevel: z.string().optional(),
});

export const HistoricalScoreSchema = z.object({
  sessionId: z.string(),
  score: z.number().min(0).max(100),
  date: z.string(),
});

export const GenerateAngelReportBodySchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().min(1),
  subject: z.string().min(1),
  topic: z.string().min(1),
  questionResults: z.array(QuestionResultSchema).min(1),
  cohortAverageScore: z.number().min(0).max(100).optional(),
  historicalScores: z.array(HistoricalScoreSchema).optional(),
});
export type TGenerateAngelReportBody = z.infer<
  typeof GenerateAngelReportBodySchema
>;

// ── Path params ────────────────────────────────────────────────────────────

export const GetAngelReportParamsSchema = z.object({
  sessionId: z.string().min(1),
});
