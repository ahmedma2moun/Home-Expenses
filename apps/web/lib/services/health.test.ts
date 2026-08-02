import { afterEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/db/prisma", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("getHealthReport", () => {
  it("reports ok when the database responds and the configured provider has a key", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    delete process.env.EXTRACTION_PROVIDER;
    process.env.GEMINI_API_KEY = "AIza-test";

    const { getHealthReport } = await import("./health");
    const report = await getHealthReport();

    expect(report).toEqual({ status: "ok", db: { ok: true }, ai: { ok: true } });
  });

  it("reports degraded when the database query fails", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused"));
    process.env.GEMINI_API_KEY = "AIza-test";

    const { getHealthReport } = await import("./health");
    const report = await getHealthReport();

    expect(report.status).toBe("degraded");
    expect(report.db).toEqual({ ok: false, error: "connection refused" });
  });

  it("reports degraded when the configured provider's key is missing", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    delete process.env.GEMINI_API_KEY;

    const { getHealthReport } = await import("./health");
    const report = await getHealthReport();

    expect(report.status).toBe("degraded");
    expect(report.ai.ok).toBe(false);
  });

  it("reports degraded, not a thrown error, when EXTRACTION_PROVIDER is unrecognized", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    process.env.EXTRACTION_PROVIDER = "not-a-real-provider";

    const { getHealthReport } = await import("./health");
    const report = await getHealthReport();

    expect(report.status).toBe("degraded");
    expect(report.ai.ok).toBe(false);
    expect(report.ai.error).toMatch(/not-a-real-provider/);
  });

  it("checks the anthropic key when EXTRACTION_PROVIDER=anthropic", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    process.env.EXTRACTION_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = "AIza-test";

    const { getHealthReport } = await import("./health");
    const report = await getHealthReport();

    expect(report.ai).toEqual({
      ok: false,
      error: "ANTHROPIC_API_KEY is not configured for EXTRACTION_PROVIDER=anthropic.",
    });
  });
});
