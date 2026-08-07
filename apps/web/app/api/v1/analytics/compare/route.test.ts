import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_USER_ID } from "@/lib/api/devUser";
import { POST } from "./route";

const compareMonths = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/services/monthComparison", () => ({
  compareMonths: (...args: unknown[]) => compareMonths(...args),
}));

function request(body: unknown): Request {
  return new Request("https://example.com/api/v1/analytics/compare", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const RESULT = {
  payload: { headline: "…", drivers: [], anomalies: [], suggestions: ["…", "…"], confidence: 0.8 },
  model: "gemini-3.5-flash",
  cached: false,
  currency: "EGP",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/analytics/compare", () => {
  it("passes the parsed body through to the service and envelopes the result", async () => {
    compareMonths.mockResolvedValue(RESULT);

    const res = await POST(request({ monthA: "2026-06", monthB: "2026-07" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: RESULT });
    expect(compareMonths).toHaveBeenCalledWith(
      DEV_USER_ID,
      { monthA: "2026-06", monthB: "2026-07", refresh: false },
      expect.any(String),
    );
  });

  it("omitting monthA asks the service for baseline mode", async () => {
    compareMonths.mockResolvedValue(RESULT);

    await POST(request({ monthB: "2026-07" }));

    expect(compareMonths).toHaveBeenCalledWith(
      DEV_USER_ID,
      { monthA: undefined, monthB: "2026-07", refresh: false },
      expect.any(String),
    );
  });

  it("rejects a body missing monthB with a 400 rather than calling the service", async () => {
    const res = await POST(request({ monthA: "2026-06" }));

    expect(res.status).toBe(400);
    expect(compareMonths).not.toHaveBeenCalled();
  });

  it("passes refresh: true through to bypass the cache", async () => {
    compareMonths.mockResolvedValue(RESULT);

    await POST(request({ monthB: "2026-07", refresh: true }));

    expect(compareMonths).toHaveBeenCalledWith(
      DEV_USER_ID,
      expect.objectContaining({ refresh: true }),
      expect.any(String),
    );
  });
});
