import type { TQuestion } from './question.types';
import { QuestionType } from '@/db/schemas/question.schema';

export const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';

/**
 * Builds the text used to generate a question embedding.
 * Must be used consistently in both Phase 2 (write) and Phase 3 (deduplication read)
 * to ensure cosine similarity comparisons are meaningful.
 */
export function buildEmbeddingText(question: TQuestion): string {
  if (question.questionType === QuestionType.Mcqs) {
    return `${question.stem}\n${question.options.join('\n')}`;
  }
  if (question.questionType === QuestionType.Grouped) {
    const childTexts = question.childQuestions
      .map((c) => `${c.stem}\n${c.options.join('\n')}`)
      .join('\n');
    return `${question.stem}\n${childTexts}`;
  }
  return `${question.stem}\n${question.solution}`;
}
