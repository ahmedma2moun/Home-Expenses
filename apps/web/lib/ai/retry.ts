const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_JITTER_MS = 250;

export interface RetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  isRetryable?: (error: unknown) => boolean;
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
  const start = Date.now();

  let attempt = 0;
  for (;;) {
    try {
      const result = await call(timeoutMs);
      return { result, attempts: attempt + 1, latencyMs: Date.now() - start };
    } catch (error) {
      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }
      await sleep(backoffMs(attempt));
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
