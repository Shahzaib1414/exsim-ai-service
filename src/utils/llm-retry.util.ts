import { randomUUID } from 'crypto';

export interface LlmRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number) => void;
  /** Reuse a caller-supplied idempotency key across all retry attempts. */
  idempotencyKey?: string;
}

function is429(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  if (e['statusCode'] === 429) return true;
  if (typeof e['message'] === 'string' && e['message'].includes('429'))
    return true;
  return false;
}

function backoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.min(exponential * jitter, 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withLlmRetry<T>(
  fn: (idempotencyKey: string) => Promise<T>,
  options?: LlmRetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const idempotencyKey = options?.idempotencyKey ?? randomUUID();

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(idempotencyKey);
    } catch (error) {
      lastError = error;

      if (!is429(error)) {
        throw error;
      }

      if (attempt < maxAttempts) {
        options?.onRetry?.(attempt);
        const delay = backoffDelay(attempt, baseDelayMs);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
