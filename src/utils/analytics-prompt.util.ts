// Row types matching the PostgreSQL analytics function return columns.
// Column names are preserved as quoted identifiers in the functions.

// ── Existing function-backed row types ───────────────────────────────────────

export interface ExamOverallStats {
  ExamTitle: string;
  SessionId: string;
  TotalQuestions: number;
  TotalTime: number;
  TotalTimeTaken: number;
  AttemptedQuestions: number;
  CorrectAnswers: number;
  IncorrectAnswers: number;
  SkippedQuestions: number;
  TimeOnCorrect: number;
  TimeOnIncorrect: number;
  TimeOnSkipped: number;
  PercentageCorrect: string; // NUMERIC returned as string by node-postgres
  PercentageTimeOnCorrect: string;
  PercentageTimeOnIncorrect: string;
  PercentageTimeOnSkipped: string;
}

export interface ExamTopicScore {
  TopicId: string;
  TopicName: string;
  AttemptedQuestions: number;
  CorrectAnswers: number;
  TopicPercentage: string;
}

export interface ExamSectionScore {
  ExamTestId: string;
  ExamTestTitle: string;
  TotalQuestions: number;
  AttemptedQuestions: number;
  CorrectAnswers: number;
  SectionPercentage: string;
}

export interface ExamDifficultyScore {
  Difficulty: string;
  AttemptedQuestions: number;
  CorrectAnswers: number;
  PercentageCorrect: string;
  TotalTimePercentage: string;
}

export interface HistoricalSession {
  SessionId: string;
  Date: string; // YYYY-MM-DD
  PercentageCorrect: string; // NUMERIC as string
}

// ── New granular row types ────────────────────────────────────────────────────

/**
 * Average time the student spent per question broken down by topic.
 * Skipped questions are excluded from the average.
 */
export interface ExamTopicTimeData {
  TopicName: string;
  /** ROUND result comes back as a string from node-postgres */
  AvgTimePerQuestion: string;
  QuestionCount: number;
  CorrectCount: number;
}

/**
 * Per-topic, per-difficulty accuracy + time breakdown.
 * Difficulty is read from QuestionTags (Name = 'difficulty').
 */
export interface TopicDifficultyBreakdown {
  TopicName: string;
  Difficulty: string; // 'High' | 'Medium' | 'Low' | null if untagged
  Total: number;
  Skipped: number;
  Correct: number;
  Incorrect: number;
  /** Avg seconds on non-skipped questions; null when all were skipped */
  AvgTime: string | null;
}

/**
 * Slow/fast × correct/wrong quadrant counts per topic.
 * "Slow" = above session avg time; "Fast" = at or below.
 * Skipped questions are excluded.
 */
export interface QuestionQuadrant {
  TopicName: string;
  /** Slow AND correct — understands but needs speed */
  SlowCorrect: number;
  /** Slow AND incorrect — actively struggling */
  SlowIncorrect: number;
  /** Fast AND correct — mastered */
  FastCorrect: number;
  /** Fast AND incorrect — careless or knowledge gap */
  FastIncorrect: number;
}

/**
 * Topics where questions were skipped.
 * AvgTimeBeforeSkip shows how long the student engaged before giving up.
 */
export interface SkippedTopicStats {
  TopicName: string;
  SkippedCount: number;
  /** Can be null if TimeTakenInSeconds was 0 for all skips */
  AvgTimeBeforeSkip: string | null;
}

/**
 * Performance split by question answer type (MCQ vs open-ended).
 * Derived from whether AnswerId or TextAnswer is set on StudentExam.
 * Open-ended questions have IsCorrect = null (not auto-graded).
 */
export interface QuestionTypeStats {
  /** 'MCQ' | 'OpenEnded' | 'Skipped' */
  QuestionType: string;
  Total: number;
  Correct: number;
  Incorrect: number;
  /** Null for skipped-only rows */
  AvgTime: string | null;
}

/**
 * Per-category performance aggregated across all topics in that category.
 * A category is the parent group for topics (e.g. Pure Math, Applied Science).
 */
export interface CategoryScore {
  CategoryName: string;
  Total: number;
  Correct: number;
  Incorrect: number;
  Skipped: number;
  /** NUMERIC as string — accuracy over attempted (non-skipped) questions */
  PercentageCorrect: string;
  /** NUMERIC as string — average seconds per question across all questions */
  AvgTimePerQuestion: string;
}

/**
 * Context about the session configuration chosen by the student,
 * plus pre-computed session totals from the StudentExamSessions record.
 */
export interface SessionMetadata {
  /** Difficulty filter applied to the session (High / Medium / Low) */
  Difficulty: string;
  /** E.g. Practice, Mock, Timed */
  ExamType: string;
  /** TypeOfQuestion filter: Mcqs, Short, Comprehensive, Grouped, Closed */
  QuestionType: string;
  /** ISO timestamp of when the session was started */
  TimeTakenAt: string;
  /** Spaced-repetition recall interval (e.g. 'Day1', 'Week1'), null if not set */
  RecallInterval: string | null;
  /** Pre-computed totals written by .NET when the session completed */
  SessionTotalQuestions: number;
  SessionCorrectAnswers: number;
  SessionIncorrectAnswers: number;
  SessionSkippedQuestions: number;
  /** NUMERIC as string */
  SessionOverallPercentage: string;
}

// ── Composite input type for buildAnalyticsPrompt ────────────────────────────

import type { TAiAngelReport } from '@/common/types/analytics.types';

export interface ExamAnalysisData {
  overall: ExamOverallStats;
  topicScores: ExamTopicScore[];
  sectionScores: ExamSectionScore[];
  difficultyScores: ExamDifficultyScore[];
  /** Last 4 sessions for this student, most recent first, excludes current session */
  historicalSessions: HistoricalSession[];
  /** Percentage of students on the same exam who scored strictly lower. Null when < 5 cohort attempts. */
  cohortPercentile: number | null;
  cohortSize: number;
  /** Average seconds per question by topic (skipped excluded). Empty when no time data recorded. */
  topicTimeData: ExamTopicTimeData[];
  /** Accuracy + avg time broken down by topic AND difficulty level. */
  topicDifficultyBreakdown: TopicDifficultyBreakdown[];
  /** Slow/fast × correct/wrong quadrant counts per topic. */
  questionQuadrants: QuestionQuadrant[];
  /** Topics where questions were skipped, sorted by skip count desc. */
  skippedTopicStats: SkippedTopicStats[];
  /** MCQ vs open-ended performance split. */
  questionTypeStats: QuestionTypeStats[];
  /** Per-category aggregated performance. */
  categoryScores: CategoryScore[];
  /** Session configuration + pre-computed totals from the StudentExamSessions record. */
  sessionMetadata: SessionMetadata | null;
  /** The last completed report for this student, used for trend comparison context. */
  previousReport: TAiAngelReport | null;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildAnalyticsPrompt(data: ExamAnalysisData): string {
  const {
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
  } = data;

  // ── Score delta ──────────────────────────────────────────────────────────

  // historicalSessions is most-recent-first; [0] is the last session before this one
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
  const scoreDeltaLabel =
    scoreDelta !== null
      ? scoreDelta > 0
        ? ` (▲${scoreDelta} pts vs last session)`
        : scoreDelta < 0
          ? ` (▼${Math.abs(scoreDelta)} pts vs last session)`
          : ' (no change vs last session)'
      : '';

  // ── Topic lines ──────────────────────────────────────────────────────────

  const topicLines =
    topicScores.length > 0
      ? topicScores
          .map(
            (t) =>
              `  ${t.TopicName}: ${t.CorrectAnswers}/${t.AttemptedQuestions} correct (${t.TopicPercentage}%)`,
          )
          .join('\n')
      : '  (no topic data)';

  // ── Difficulty lines ─────────────────────────────────────────────────────

  const difficultyLines =
    difficultyScores.length > 0
      ? difficultyScores
          .map(
            (d) =>
              `  ${d.Difficulty}: ${d.CorrectAnswers}/${d.AttemptedQuestions} correct (${d.PercentageCorrect}%), ${d.TotalTimePercentage}% of total time`,
          )
          .join('\n')
      : '  (no difficulty data)';

  // ── Section lines ────────────────────────────────────────────────────────

  const sectionLines =
    sectionScores.length > 0
      ? sectionScores
          .map(
            (s) =>
              `  ${s.ExamTestTitle}: ${s.CorrectAnswers}/${s.AttemptedQuestions} correct (${s.SectionPercentage}%), ${s.TotalQuestions} total questions`,
          )
          .join('\n')
      : '  (no section data)';

  // ── Category lines ───────────────────────────────────────────────────────

  const categoryLines =
    categoryScores.length > 0
      ? categoryScores
          .map((c) => {
            const skippedPart = c.Skipped > 0 ? `, ${c.Skipped} skipped` : '';
            const timePart = c.AvgTimePerQuestion
              ? `, avg ${parseFloat(c.AvgTimePerQuestion).toFixed(1)}s/question`
              : '';
            return `  ${c.CategoryName}: ${c.Correct}/${c.Total} correct (${c.PercentageCorrect}%)${skippedPart}${timePart}`;
          })
          .join('\n')
      : '  (no category data)';

  // ── Score history ────────────────────────────────────────────────────────

  // historicalSessions is most-recent-first; reverse to display oldest→current
  const chronological = [...historicalSessions].reverse();
  const historyLines =
    chronological.length > 0
      ? [
          ...chronological.map((h) => `  ${h.Date}: ${h.PercentageCorrect}%`),
          `  Current session: ${overall.PercentageCorrect}%${scoreDeltaLabel}`,
        ].join('\n')
      : `  Current session: ${overall.PercentageCorrect}% (first session — no prior history)`;

  // ── Cohort ───────────────────────────────────────────────────────────────

  const cohortLine =
    cohortPercentile !== null && cohortSize >= 5
      ? `${cohortPercentile}th percentile (${cohortSize} distinct students have attempted this exam)`
      : `(insufficient cohort data — only ${cohortSize} distinct student${cohortSize === 1 ? '' : 's'} on record; do not invent a percentile)`;

  const cohortInstruction =
    cohortPercentile !== null && cohortSize >= 5
      ? `Use the provided ${cohortPercentile}th percentile figure. Set cohortSize to ${cohortSize}.`
      : `Set percentile to 50 as a neutral placeholder and cohortSize to ${cohortSize}. Clearly state in the summary that cohort data is not yet available.`;

  // ── Time calculations ────────────────────────────────────────────────────

  const totalTimeMin = overall.TotalTime;
  const timeTakenMin = Math.round(overall.TotalTimeTaken / 60);
  const overallAvgSec =
    overall.AttemptedQuestions > 0
      ? Math.round(overall.TotalTimeTaken / overall.AttemptedQuestions)
      : null;
  const completionRate =
    overall.TotalQuestions > 0
      ? Math.round((overall.AttemptedQuestions / overall.TotalQuestions) * 100)
      : 100;

  // ── Topic time lines ─────────────────────────────────────────────────────

  const topicTimeLines =
    topicTimeData.length > 0 && overallAvgSec !== null
      ? topicTimeData
          .map((t) => {
            const avg = parseFloat(t.AvgTimePerQuestion);
            const diffPct = Math.round(
              ((avg - overallAvgSec) / overallAvgSec) * 100,
            );
            const label =
              diffPct > 0
                ? `${diffPct}% above avg`
                : diffPct < 0
                  ? `${Math.abs(diffPct)}% below avg`
                  : 'at avg';
            return `  ${t.TopicName}: ${avg}s avg/question (${label}), ${t.CorrectCount}/${t.QuestionCount} correct`;
          })
          .join('\n')
      : '  (no per-question time data)';

  // ── Topic × Difficulty breakdown ─────────────────────────────────────────

  const tdGrouped = new Map<string, TopicDifficultyBreakdown[]>();
  for (const row of topicDifficultyBreakdown) {
    if (!tdGrouped.has(row.TopicName)) tdGrouped.set(row.TopicName, []);
    tdGrouped.get(row.TopicName)!.push(row);
  }

  const topicDiffLines =
    tdGrouped.size > 0
      ? Array.from(tdGrouped.entries())
          .map(([topic, rows]) => {
            const subLines = rows
              .map((r) => {
                const diff = r.Difficulty ?? 'Untagged';
                const attempted = r.Correct + r.Incorrect;
                const accPct =
                  attempted > 0 ? Math.round((r.Correct / attempted) * 100) : 0;
                const timePart = r.AvgTime ? `, avg ${r.AvgTime}s` : '';
                const skipPart = r.Skipped > 0 ? `, ${r.Skipped} skipped` : '';
                return `      ${diff}: ${r.Correct}/${attempted} correct (${accPct}%)${timePart}${skipPart}`;
              })
              .join('\n');
            return `  ${topic}:\n${subLines}`;
          })
          .join('\n')
      : '  (no topic-difficulty data)';

  // ── Question quadrant table ───────────────────────────────────────────────

  const quadrantLines =
    questionQuadrants.length > 0
      ? questionQuadrants
          .map(
            (q) =>
              `  ${q.TopicName}: slow+correct=${q.SlowCorrect}, slow+incorrect=${q.SlowIncorrect}, fast+correct=${q.FastCorrect}, fast+incorrect=${q.FastIncorrect}`,
          )
          .join('\n')
      : '  (no quadrant data)';

  // ── Skipped questions by topic ────────────────────────────────────────────

  const skippedLines =
    skippedTopicStats.length > 0
      ? skippedTopicStats
          .map((s) => {
            const timePart = s.AvgTimeBeforeSkip
              ? ` (avg ${s.AvgTimeBeforeSkip}s before skipping)`
              : '';
            return `  ${s.TopicName}: ${s.SkippedCount} skipped${timePart}`;
          })
          .join('\n')
      : '  (no skipped questions)';

  // ── Question type performance ─────────────────────────────────────────────

  const qtLines =
    questionTypeStats.length > 0
      ? questionTypeStats
          .map((qt) => {
            const attempted = qt.Correct + qt.Incorrect;
            const accPart =
              attempted > 0
                ? `${qt.Correct}/${attempted} correct (${Math.round((qt.Correct / attempted) * 100)}%)`
                : 'not auto-graded';
            const timePart = qt.AvgTime ? `, avg ${qt.AvgTime}s` : '';
            return `  ${qt.QuestionType}: ${qt.Total} questions — ${accPart}${timePart}`;
          })
          .join('\n')
      : '  (no question type data)';

  // ── Session context ───────────────────────────────────────────────────────

  const sessionDate = sessionMetadata?.TimeTakenAt
    ? new Date(sessionMetadata.TimeTakenAt).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : null;

  const sessionCtxParts = sessionMetadata
    ? [
        `Difficulty filter: ${sessionMetadata.Difficulty}`,
        `Exam type: ${sessionMetadata.ExamType}`,
        `Question type filter: ${sessionMetadata.QuestionType}`,
        sessionDate ? `Session date: ${sessionDate}` : null,
        sessionMetadata.RecallInterval
          ? `Recall interval: ${sessionMetadata.RecallInterval}`
          : null,
      ].filter(Boolean)
    : null;

  const sessionCtx = sessionCtxParts
    ? sessionCtxParts.join(' | ')
    : '(session metadata unavailable)';

  // Session pre-computed totals cross-check (from StudentExamSessions record)
  const sessionTotalsLine = sessionMetadata
    ? `  Pre-computed session totals: ${sessionMetadata.SessionTotalQuestions} total, ${sessionMetadata.SessionCorrectAnswers} correct, ${sessionMetadata.SessionIncorrectAnswers} incorrect, ${sessionMetadata.SessionSkippedQuestions} skipped, ${sessionMetadata.SessionOverallPercentage}% overall`
    : '  (session totals unavailable)';

  // ── Previous report summary ───────────────────────────────────────────────

  const previousReportSection = previousReport
    ? `Previous report summary (for trend comparison only — do NOT copy these conclusions):
  Progress trend was: ${previousReport.progress.trend}
  Prior score delta was: ${previousReport.progress.scoreDelta != null ? `${previousReport.progress.scoreDelta > 0 ? '+' : ''}${previousReport.progress.scoreDelta} pts` : 'N/A (was first session)'}
  Strengths summary: ${previousReport.strengths.summary}
  Weaknesses summary: ${previousReport.weaknesses.summary}
  Time management summary: ${previousReport.timeManagement.summary}
  Category insights summary: ${previousReport.categoryInsights?.summary ?? '(not available in previous report)'}
  Suggestions from last report: ${previousReport.suggestions.summary}
  → Use this to detect improvements or regressions since the last session. Note if previous weaknesses have been addressed.`
    : "(no previous report available — this is the student's first report)";

  // ── Absolute pace classification (used in timeManagement instruction) ───────

  const paceNote =
    overallAvgSec === null
      ? 'No time data recorded.'
      : overallAvgSec < 20
        ? `FAST student: session avg is only ${overallAvgSec}s/question. Do NOT call this student slow. Focus on accuracy patterns (fast+incorrect = careless) rather than pace.`
        : overallAvgSec <= 45
          ? `NORMAL pace: session avg is ${overallAvgSec}s/question.`
          : `SLOW pace: session avg is ${overallAvgSec}s/question. Time pressure may genuinely affect performance.`;

  const timeUsedPct =
    totalTimeMin > 0 ? Math.round((timeTakenMin / totalTimeMin) * 100) : 0;
  const pacingLabel =
    timeUsedPct < 80
      ? `finished early (used ${timeUsedPct}% of allocated time)`
      : timeUsedPct <= 100
        ? `on time (used ${timeUsedPct}% of allocated time)`
        : `over time (used ${timeUsedPct}% of allocated time)`;

  // ── Final prompt ──────────────────────────────────────────────────────────

  return `Student session analytics for exam "${overall.ExamTitle}".

${previousReportSection}

Session context:
  ${sessionCtx}
${sessionTotalsLine}

Overall performance:
  Total questions: ${overall.TotalQuestions} | Attempted: ${overall.AttemptedQuestions} | Correct: ${overall.CorrectAnswers} | Incorrect: ${overall.IncorrectAnswers} | Skipped: ${overall.SkippedQuestions}
  Completion rate: ${completionRate}%
  Score: ${overall.PercentageCorrect}%${scoreDeltaLabel}
  Allocated time: ${totalTimeMin} min | Time taken: ${timeTakenMin} min
  Session avg time per question: ${overallAvgSec !== null ? `${overallAvgSec}s` : 'n/a'}
  Time split — correct: ${overall.PercentageTimeOnCorrect}% | incorrect: ${overall.PercentageTimeOnIncorrect}% | skipped: ${overall.PercentageTimeOnSkipped}%

Score history (oldest → current):
${historyLines}

Cohort comparison:
  ${cohortLine}

Performance by category (subject grouping above topic level):
${categoryLines}

Performance by topic (within categories):
${topicLines}

Performance by section:
${sectionLines}

Performance by difficulty (overall):
${difficultyLines}

Topic × Difficulty breakdown (accuracy + avg time per question):
${topicDiffLines}

Time per question by topic (session avg: ${overallAvgSec !== null ? `${overallAvgSec}s` : 'n/a'}):
${topicTimeLines}

Question behaviour quadrants per topic:
  Session avg time: ${overallAvgSec !== null ? `${overallAvgSec}s/question` : 'n/a'} — "slow" = above this avg, "fast" = at or below.
  Absolute pace: ${paceNote}
  Interpretation: slow+correct = understands but needs speed | slow+incorrect = struggling | fast+correct = mastered | fast+incorrect = careless/knowledge gap
${quadrantLines}

Skipped questions by topic:
${skippedLines}

Question type performance (MCQ = AnswerId set; OpenEnded = TextAnswer set; open-ended IsCorrect is always null):
${qtLines}

Instructions — generate all 11 report sections:

1. sessionSummary: Echo the factual numbers faithfully.
   - examTitle: exact exam name from data above.
   - score: ${overall.PercentageCorrect} (as a number, not string).
   - totalQuestions: ${overall.TotalQuestions}, attempted: ${overall.AttemptedQuestions}, correct: ${overall.CorrectAnswers}, incorrect: ${overall.IncorrectAnswers}, skipped: ${overall.SkippedQuestions}.
   - completionRate: ${completionRate}.
   - timeTakenMinutes: ${timeTakenMin}, allocatedMinutes: ${totalTimeMin}.
   - summary: 1–2 sentences stating the score, completion rate, and whether the student finished within allocated time. Mention the exam type and difficulty filter.

2. progress: Analyse the score history to assess trajectory.
   - trend: Set to 'improving' if scoreDelta > 0; 'declining' if scoreDelta < 0; 'stable' if scoreDelta is 0 or null.
     If 2+ prior sessions exist, also consider the overall direction across all of them — a single bad session
     after a long upward trend is still 'declining' for the delta, but the summary should acknowledge the broader pattern.
   - summary: 2–3 sentences. MUST include: (a) the current score (${overall.PercentageCorrect}%),
     (b) the exact score delta vs last session${scoreDelta !== null ? ` (${scoreDelta > 0 ? '+' : ''}${scoreDelta} pts)` : ' (first session — no delta)'},
     (c) a one-line characterisation of the trend across all sessions shown. Be specific — cite actual
     percentages and dates. Do NOT write vague phrases like "showing steady improvement" without numbers.
   - details (2–4 bullets): each must reference a real data point from the history. E.g.:
     "Score rose from 58% (2024-01-22) to ${overall.PercentageCorrect}% today — a gain of ${scoreDelta !== null ? Math.abs(scoreDelta) : '?'} points."
     "Consistent upward trend across all ${historicalSessions.length + 1} sessions recorded."
     "Despite overall improvement, accuracy on [weak topic] remains below 50% — see weaknesses."
   - scoreDelta: ${scoreDelta !== null ? scoreDelta : 'null (first session)'} — set to this exact value.

3. strengths: Topics the student genuinely excels at.
   Rules (all must hold):
   - Only include topics whose TopicPercentage is ABOVE the overall session score (${overall.PercentageCorrect}%) AND above 60%.
   - A topic that appears in weaknesses MUST NOT appear here.
   - If no topic meets both conditions, return an empty topics array and state in the summary that no clear strengths were established yet.
   Each entry: exact topic name + TopicPercentage as a number.

4. weaknesses: Topics that need focused study.
   Rules (all must hold):
   - Only include topics whose TopicPercentage is BELOW the overall session score (${overall.PercentageCorrect}%) OR below 50%.
   - A topic that appears in strengths MUST NOT appear here.
   Each entry: exact topic name + TopicPercentage as a number.
   Frame as focus areas, not failures.

5. cohortComparison: ${cohortInstruction}
   - cohortSize must be set to ${cohortSize}.

6. timeManagement:
   CRITICAL CONTEXT: "slow" in the quadrant data means ABOVE THIS STUDENT'S OWN session average
   (${overallAvgSec !== null ? `${overallAvgSec}s/question` : 'not recorded'}). It is RELATIVE, not absolute.
   ${paceNote}
   - summary: State the pacing result: student ${pacingLabel}. Mention exam type (${sessionMetadata?.ExamType ?? 'unknown'}).
     If the student is overall fast, acknowledge this — do NOT characterise them as slow.
   - details (2–4 bullets):
     * ONLY flag a topic as "slow" if its avg time is BOTH above the session avg AND above 40s in absolute terms.
       If session avg is < 25s, do NOT write any "slow" bullets — instead focus on accuracy.
     * Fast+incorrect topics → careless errors; recommend slowing down on those specific topics only.
     * Slow+incorrect topics (only if avg > 40s) → genuine struggle; recommend targeted study.
     * Slow+correct topics (only if avg > 40s) → knowledge present but needs speed practice.
     * If all quadrants show fast+correct or fast+incorrect, focus the bullets on accuracy patterns, not pace.
     * Reference completion rate (${completionRate}%) if it is below 100%.

7. questionPatterns:
   - summary: dominant pattern across the session (mastered, careless, struggling, or mixed).
   - details (2–4 bullets): for each notable topic, name its quadrant pattern. E.g.:
     "Fractions: 3 slow+incorrect — spending time but not converting to correct answers."
     "Algebra: 6 fast+correct — clear strength, keep it sharp."
     "Number Theory: 2 fast+incorrect — review fundamentals to avoid careless errors."

8. difficultyInsights:
   - summary: which difficulty band the student handles best and which needs the most work.
   - details (2–4 bullets): for each difficulty level that appears, note accuracy, avg time,
     and which topics drag the score down. Cross-reference topic×difficulty table above.

9. sectionInsights:
   - summary: which section(s) performed best and worst; note if completion rates differ across sections.
   - details (2–4 bullets): one bullet per section that has a notable result (strong or weak).
     E.g.: "Section A (Pure Math): 12/15 correct (80%) — solid performance."
     "Section B (Applied Science): 4/10 correct (40%) — primary area for improvement."
     If only one section exists, focus on which topics within it dragged the score.

10. categoryInsights:
    - categories: one entry per category with name, percentage (as a number), correct count, and total count.
      Order by percentage ascending (weakest first).
    - summary: 1–2 sentences naming the strongest and weakest category, and whether the gap is wide or narrow.
    - details (2–4 bullets): for each category that is notably above or below average, explain which topics
      within it are contributing most to the result. Reference the topic data above.

11. suggestions:
    Provide specific, data-grounded CTAs. NEVER write generic advice like "study more" or "practice
    regularly". Every bullet must name exact topic names, percentages, difficulty levels, or counts
    from the session data above — use real numbers, not placeholders.

    - summary: 2–3 sentences. Name the #1 priority area (the single weakest topic or category from the
      data by name and exact percentage). State the recommended immediate action: which exam to retake,
      at which difficulty, and which specific topic or category to focus on.
      If a previous report exists and this same area was flagged before, explicitly state:
      "This was also flagged in your previous session — it requires a dedicated study plan, not just
      another attempt."
      Example: "Your top priority is [Weakest Topic] — you scored only [X]% there. Retake '[ExamTitle]'
      filtered to [difficulty] difficulty, focusing specifically on [Weakest Topic] questions."

    - details (4–6 bullets — include all applicable CTAs below; skip any that have no supporting data):

      CTA A — RETAKE RECOMMENDATION (always include):
      "Retake '[ExamTitle]' — [choose: same difficulty if overall < 60%, otherwise the difficulty band
      where accuracy is lowest from difficultyScores] difficulty filter. Set topic focus to
      [weakest topic by name]. Target > [current score + 10]% as your next milestone."
      → Use: ExamTitle, weakest difficultyScore band, weakest topicScore name, PercentageCorrect.

      CTA B — TARGETED TOPIC DRILL (always include — weakest topic):
      "Before your next full attempt, drill [Weakest Topic by name] in Practice mode (no timer).
      You scored [X]% there ([CorrectAnswers]/[AttemptedQuestions] correct). Aim to reach [X + 15]%
      before attempting a timed session on this topic again."
      → Use: lowest-percentage topic from topicScores with its exact counts.

      CTA C — CARELESS ERROR FIX (only if any topic has fast+incorrect ≥ 2):
      "On [Topic with highest fast+incorrect count], you answered [N] questions quickly but got them
      wrong. In your next session, read each option fully before selecting on this topic — these are
      recoverable points lost to speed, not knowledge gaps."
      → Only emit if quadrant data has fast+incorrect ≥ 2 for any topic. Name the specific topic.

      CTA D — DIFFICULTY ESCALATION (only if overall score > 70%):
      "You scored [X]% overall — solid performance. On [strongest topic/category by name], try
      stepping up to [Low→Medium / Medium→High] difficulty to build exam-ready depth.
      Mastering harder questions on your strong topics will make them even more reliable on exam day."
      → Only emit if PercentageCorrect > 70. Use strongest topic and current session difficulty.

      CTA E — SKIPPED QUESTION RECOVERY (only if skippedTopicStats is non-empty):
      "You skipped [N] questions in [most-skipped topic by name]. Return to these questions without a
      timer to identify whether the gap is knowledge-based or confidence-based. Attempting just these
      skipped questions could recover up to [round(skippedCount/totalQuestions * 100)]% in score."
      → Only emit if skippedTopicStats has entries. Use exact SkippedCount and calculate score impact.

      CTA F — CATEGORY FOCUS (only if any category scores < 50%):
      "Your [Weakest Category name] accuracy is only [X]%. This category accounts for [N] questions
      on this exam — improving it has the highest overall impact. Schedule a Practice session filtered
      to [Weakest Category] topics before your next Mock or Timed attempt."
      → Only emit if any categoryScore PercentageCorrect < 50. Name the category and its question count.

    HARD CONSTRAINTS:
    - Do NOT emit a CTA if its condition is not met by the data (no filler bullets).
    - Do NOT use placeholder text — every value in brackets must be replaced with a real figure.
    - Do NOT repeat the same topic in multiple CTAs unless it is genuinely the weakest across all dimensions.

General rules:
- Do NOT invent numbers. Every figure must come from the data above.
- Keep each insight section to 2–4 sentences for summaries. Details are bullet strings.
- Open-ended questions cannot be graded automatically; exclude them from accuracy commentary.
- If a section has no data (e.g. no skips, no sections), skip mentioning it rather than padding.
- Where previous report data exists, explicitly compare to last session rather than making generic statements.`;
}
