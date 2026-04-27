export const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';

/**
 * Builds the text used to generate a question embedding.
 * Must be used consistently in both Phase 2 (write) and Phase 3 (deduplication read)
 * to ensure cosine similarity comparisons are meaningful.
 */
export function buildEmbeddingText(stem: string, options: string[]): string {
  return `${stem}\n${options.join('\n')}`;
}
