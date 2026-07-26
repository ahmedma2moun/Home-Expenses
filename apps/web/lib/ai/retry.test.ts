import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withRetry", () => {
  it("returns the result and attempt count on the first success", async () => {
    const call = vi.fn().mockResolvedValue("ok");

    const outcome = await withRetry(call);

    expect(outcome.result).toBe("ok");
    expect(outcome.attempts).toBe(1);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable error and succeeds on the second attempt", async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce("ok");

    const promise = withRetry(call, { isRetryable: () => true });
    await vi.runAllTimersAsync();
    const outcome = await promise;

    expect(outcome.attempts).toBe(2);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and rethrows the last error", async () => {
    const error = new Error("500");
    const call = vi.fn().mockRejectedValue(error);

    const promise = withRetry(call, { isRetryable: () => true, maxRetries: 1 });
    const assertion = expect(promise).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;

    expect(call).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable error", async () => {
    const error = new Error("400");
    const call = vi.fn().mockRejectedValue(error);

    await expect(withRetry(call, { isRetryable: () => false })).rejects.toBe(error);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
