const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_JITTER_MS = 250;

export interface RetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  isRetryable?: (error: unknown) => boolean;
  /**
   * Absolute `Date.now()`-scale deadline shared across every call site in one request (e.g. both
   * the first extraction attempt and its one correction retry in `extraction.ts`). Without this,
   * `timeoutMs * (maxRetries + 1)` per call can add up to well past the route's `maxDuration`,
   * leaving a receipt stuck in `PARSING` forever with nothing to time it out.
   */
  deadlineMs?: number;
}

export interface RetryOutcome<T> {
  result: T;
  attempts: number;
  latencyMs: number;
}

/** Every AI provider call is wrapped with this: timeout, retry-with-backoff on 429/5xx, telemetry. */
export async function withRetry<T>(
  call: (timeoutMs: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const isRetryable = options.isRetryable ?? (() => false);
  const deadline = options.deadlineMs ?? Date.now() + timeoutMs;
  const start = Date.now();

  let attempt = 0;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("Timed out before an AI provider attempt could run.");
    }

    try {
      const result = await call(Math.min(timeoutMs, remainingMs));
      return { result, attempts: attempt + 1, latencyMs: Date.now() - start };
    } catch (error) {
      const wait = backoffMs(attempt);
      if (attempt >= maxRetries || !isRetryable(error) || Date.now() + wait >= deadline) {
        throw error;
      }
      await sleep(wait);
      attempt += 1;
    }
  }
}

function backoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * 2 ** attempt + Math.random() * MAX_JITTER_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
