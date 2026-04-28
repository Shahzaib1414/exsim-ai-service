import type { TGenerateAngelReportBody } from '@/common/types';

interface PerformanceSummary {
  totalQuestions: number;
  correctCount: number;
  scorePercent: number;
  byDifficulty: Record<string, { correct: number; total: number }>;
  byBloomsLevel: Record<string, { correct: number; total: number }>;
  trend: 'improving' | 'declining' | 'stable';
}

export function buildPerformanceSummary(
  body: TGenerateAngelReportBody,
): PerformanceSummary {
  const { questionResults, historicalScores } = body;

  const totalQuestions = questionResults.length;
  const correctCount = questionResults.filter((q) => q.isCorrect).length;
  const scorePercent = Math.round((correctCount / totalQuestions) * 100);

  const byDifficulty: Record<string, { correct: number; total: number }> = {};
  const byBloomsLevel: Record<string, { correct: number; total: number }> = {};

  for (const q of questionResults) {
    const d = q.difficulty;
    byDifficulty[d] ??= { correct: 0, total: 0 };
    byDifficulty[d].total++;
    if (q.isCorrect) byDifficulty[d].correct++;

    if (q.bloomsLevel) {
      byBloomsLevel[q.bloomsLevel] ??= { correct: 0, total: 0 };
      byBloomsLevel[q.bloomsLevel].total++;
      if (q.isCorrect) byBloomsLevel[q.bloomsLevel].correct++;
    }
  }

  let trend: 'improving' | 'declining' | 'stable' = 'stable';
  if (historicalScores && historicalScores.length >= 2) {
    const sorted = [...historicalScores].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const oldest = sorted[0].score;
    const newest = sorted[sorted.length - 1].score;
    const delta = newest - oldest;
    if (delta >= 5) trend = 'improving';
    else if (delta <= -5) trend = 'declining';
  }

  return {
    totalQuestions,
    correctCount,
    scorePercent,
    byDifficulty,
    byBloomsLevel,
    trend,
  };
}

export function buildAnalyticsPrompt(
  body: TGenerateAngelReportBody,
  summary: PerformanceSummary,
): string {
  const difficultyLines = Object.entries(summary.byDifficulty)
    .map(
      ([d, s]) =>
        `  ${d}: ${s.correct}/${s.total} correct (${Math.round((s.correct / s.total) * 100)}%)`,
    )
    .join('\n');

  const bloomsLines =
    Object.keys(summary.byBloomsLevel).length > 0
      ? Object.entries(summary.byBloomsLevel)
          .map(
            ([b, s]) =>
              `  ${b}: ${s.correct}/${s.total} correct (${Math.round((s.correct / s.total) * 100)}%)`,
          )
          .join('\n')
      : "  (no Bloom's level data provided)";

  const historyLines =
    body.historicalScores && body.historicalScores.length > 0
      ? body.historicalScores
          .sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          )
          .map((h) => `  ${h.date}: ${h.score}%`)
          .join('\n')
      : '  (no historical data provided)';

  const cohortLine =
    body.cohortAverageScore !== undefined
      ? `Cohort average score: ${body.cohortAverageScore}%`
      : 'Cohort data: not available';

  return `Student session analytics for subject "${body.subject}", topic "${body.topic}".

Current session:
  Score: ${summary.correctCount}/${summary.totalQuestions} (${summary.scorePercent}%)
  Trend (from history): ${summary.trend}

Performance by difficulty:
${difficultyLines}

Performance by Bloom's taxonomy level:
${bloomsLines}

Historical scores (oldest → newest):
${historyLines}

${cohortLine}

Instructions:
- Base all insights strictly on the data above — do not invent percentiles or scores.
- Keep each section to 2–4 sentences.
- Frame weaknesses as focus areas, not failures.
- For cohortComparison.percentile: if cohort data is unavailable, use 50 as a neutral placeholder and note it in the summary.
- For progress.trend use exactly one of: improving, declining, stable — matching the trend value above.`;
}
