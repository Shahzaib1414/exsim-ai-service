import { ok, err, Result } from 'neverthrow';

/**
 * Builds a PostgreSQL vector literal string from an array of floats.
 *
 * Returns `err` if the array is empty or contains non-finite values, preventing
 * SQL injection via crafted embedding values before the string ever reaches the
 * Drizzle `sql` tag.
 */
export function buildSafeVectorLiteral(
  embedding: number[],
): Result<string, string> {
  if (
    embedding.length === 0 ||
    !embedding.every((n) => typeof n === 'number' && isFinite(n))
  ) {
    return err(
      'invalid embedding: must be a non-empty array of finite numbers',
    );
  }
  return ok(`[${embedding.join(',')}]`);
}
