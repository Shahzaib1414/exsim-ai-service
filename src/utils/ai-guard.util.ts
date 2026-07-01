/**
 * Runtime guard for AI-generated suggestions.
 *
 * The LLM sometimes invents platform features that do not exist
 * (e.g. "Practice mode", "untimed session", "drill mode").
 * This util detects those violations so they can be logged/tracked.
 */

import type { TAiAngelReport } from '@/common/types';

/** Terms that indicate a hallucinated platform feature. */
export const PHANTOM_FEATURE_TERMS: readonly string[] = [
  'practice mode',
  'drill mode',
  'study mode',
  'learning mode',
  'revision mode',
  'untimed',
  'no timer',
  'without a timer',
  'without timer',
  'no time pressure',
  'time pressure',
  'flashcard',
  'spaced repetition',
  'practice drill',
  'timed mode',
] as const;

export interface SuggestionsViolation {
  term: string;
  excerpt: string;
}

/**
 * Scans the suggestions section of a generated report for phantom feature
 * references. Returns one entry per violation found (term + context excerpt).
 */
export function detectPhantomFeatures(
  suggestions: TAiAngelReport['suggestions'],
): SuggestionsViolation[] {
  const violations: SuggestionsViolation[] = [];
  const texts = [suggestions.summary, ...suggestions.details];

  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const term of PHANTOM_FEATURE_TERMS) {
      if (lower.includes(term)) {
        violations.push({
          term,
          excerpt: text.length > 120 ? `${text.slice(0, 120)}…` : text,
        });
      }
    }
  }

  return violations;
}
