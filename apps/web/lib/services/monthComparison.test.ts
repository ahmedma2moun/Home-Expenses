import { afterEach, describe, expect, it, vi } from "vitest";

const monthlySummaryFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderCount = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderGroupBy = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const monthComparisonFindUnique = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const monthComparisonUpsert = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getUserCurrency = vi.fn<(...args: unknown[]) => Promise<string>>();
const compare = vi.fn<(...args: unknown[]) => Promise<unknown>>();

/** Same rationale as `analytics.test.ts`'s FakeDecimal — `monthComparison.ts` chains `.add`,
 *  `.minus`, `.dividedBy`, `.times`, `.toDecimalPlaces`, `.isZero`, `.toNumber`, `.toFixed` across
 *  `Prisma.Decimal` instances built from both numbers (row fixtures) and strings (`new
 *  Prisma.Decimal(monthA.total)`), so this stand-in has to support both constructor inputs and
 *  every one of those methods, not just the subset one call site happens to use. */
class FakeDecimal {
  private readonly value: number;
  constructor(value: number | string) {
    this.value = typeof value === "string" ? Number(value) : value;
  }
  add(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value + other.value);
  }
  minus(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value - other.value);
  }
  dividedBy(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value / other.value);
  }
  times(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value * other.value);
  }
  toDecimalPlaces(n: number): FakeDecimal {
    return new FakeDecimal(Number(this.value.toFixed(n)));
  }
  isZero(): boolean {
    return this.value === 0;
  }
  toNumber(): number {
    return this.value;
  }
  toFixed(n: number): string {
    return this.value.toFixed(n);
  }
}

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    monthlySummary: { findMany: (...args: unknown[]) => monthlySummaryFindMany(...args) },
    order: {
      count: (...args: unknown[]) => orderCount(...args),
      groupBy: (...args: unknown[]) => orderGroupBy(...args),
    },
    monthComparison: {
      findUnique: (...args: unknown[]) => monthComparisonFindUnique(...args),
      upsert: (...args: unknown[]) => monthComparisonUpsert(...args),
    },
  },
  Prisma: { Decimal: FakeDecimal },
}));

vi.mock("@/lib/services/users", () => ({
  getUserCurrency: (...args: unknown[]) => getUserCurrency(...args),
}));

vi.mock("@/lib/ai", () => ({
  getAnalysisProvider: () => ({ compare: (...args: unknown[]) => compare(...args) }),
}));

function providerResult(text: string, overrides: Record<string, unknown> = {}) {
  return { text, model: "gemini-3.5-flash", latencyMs: 100, attempts: 1, ...overrides };
}

const VALID_PAYLOAD = {
  headline: "Dining drove the increase, up 61% on more takeout orders.",
  drivers: [
    { category: "dining", direction: "up", amount: "1300.00", explanation: "More takeout." },
  ],
  anomalies: [],
  suggestions: ["Set a dining budget for next month.", "Review the two largest dining orders."],
  confidence: 0.85,
};

/** Queues one `buildAggregate` call's worth of mock responses, in the exact call order
 *  `monthComparison.ts` makes them: summary rows, then order count, then top-merchant groupBy. */
function mockRealMonth(summaryRows: unknown[], orders: number, merchantRows: unknown[] = []): void {
  monthlySummaryFindMany.mockResolvedValueOnce(summaryRows);
  orderCount.mockResolvedValueOnce(orders);
  orderGroupBy.mockResolvedValueOnce(merchantRows);
}

/** Queues one `buildBaselineAggregate` call's worth of mock responses: summary rows across the
 *  window (each needs `periodMonth` — the divisor is derived from how many distinct months are
 *  actually present, not the fixed window size), then the per-month order-count groupBy. */
function mockBaselineMonth(summaryRows: unknown[], periodMonthCounts: unknown[]): void {
  monthlySummaryFindMany.mockResolvedValueOnce(summaryRows);
  orderGroupBy.mockResolvedValueOnce(periodMonthCounts);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("compareMonths", () => {
  it("returns the cached payload without calling the AI provider", async () => {
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(3400) }], 21);
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(5470) }], 26);
    getUserCurrency.mockResolvedValue("EGP");
    monthComparisonFindUnique.mockResolvedValueOnce({
      payload: VALID_PAYLOAD,
      model: "gemini-3.5-flash",
    });

    const { compareMonths } = await import("./monthComparison");
    const result = await compareMonths(
      "user-1",
      { monthA: "2026-06", monthB: "2026-07", refresh: false },
      "req-1",
    );

    expect(result.cached).toBe(true);
    expect(result.payload.headline).toBe(VALID_PAYLOAD.headline);
    expect(compare).not.toHaveBeenCalled();
    expect(monthComparisonUpsert).not.toHaveBeenCalled();
  });

  it("on a cache miss, calls the provider once, validates the result, and caches it", async () => {
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(3400) }], 21);
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(5470) }], 26);
    getUserCurrency.mockResolvedValue("EGP");
    monthComparisonFindUnique.mockResolvedValueOnce(null);
    compare.mockResolvedValueOnce(providerResult(JSON.stringify(VALID_PAYLOAD)));
    monthComparisonUpsert.mockResolvedValueOnce({});

    const { compareMonths } = await import("./monthComparison");
    const result = await compareMonths(
      "user-1",
      { monthA: "2026-06", monthB: "2026-07", refresh: false },
      "req-1",
    );

    expect(result.cached).toBe(false);
    expect(result.payload.headline).toBe(VALID_PAYLOAD.headline);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(monthComparisonUpsert).toHaveBeenCalledTimes(1);
    // Each `compare` call carries a shared deadline (§7.4 cost/latency controls) — same pattern as
    // extraction's `deadlineMs`.
    const call = compare.mock.calls[0]?.[0] as { deadlineMs: number };
    expect(call.deadlineMs).toBeGreaterThan(Date.now());
  });

  it("retries once with the validation error on a malformed first response, then succeeds", async () => {
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(3400) }], 21);
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(5470) }], 26);
    getUserCurrency.mockResolvedValue("EGP");
    monthComparisonFindUnique.mockResolvedValueOnce(null);
    compare
      .mockResolvedValueOnce(providerResult("not json at all"))
      .mockResolvedValueOnce(providerResult(JSON.stringify(VALID_PAYLOAD), { attempts: 2 }));
    monthComparisonUpsert.mockResolvedValueOnce({});

    const { compareMonths } = await import("./monthComparison");
    const result = await compareMonths(
      "user-1",
      { monthA: "2026-06", monthB: "2026-07", refresh: false },
      "req-1",
    );

    expect(result.payload.headline).toBe(VALID_PAYLOAD.headline);
    expect(compare).toHaveBeenCalledTimes(2);
    const correctionCall = compare.mock.calls[1]?.[0] as { systemPrompt: string };
    expect(correctionCall.systemPrompt).toContain("failed validation");
  });

  it("throws a safe, generic error when the correction retry also fails validation", async () => {
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(3400) }], 21);
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(5470) }], 26);
    getUserCurrency.mockResolvedValue("EGP");
    monthComparisonFindUnique.mockResolvedValueOnce(null);
    compare
      .mockResolvedValueOnce(providerResult("still not json"))
      .mockResolvedValueOnce(providerResult("nope, also not json"));

    const { compareMonths } = await import("./monthComparison");

    await expect(
      compareMonths("user-1", { monthA: "2026-06", monthB: "2026-07", refresh: false }, "req-1"),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", httpStatus: 502 });
    expect(compare).toHaveBeenCalledTimes(2);
    expect(monthComparisonUpsert).not.toHaveBeenCalled();
  });

  it("drops a driver referencing a category absent from both months' aggregates", async () => {
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(3400) }], 21);
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(5470) }], 26);
    getUserCurrency.mockResolvedValue("EGP");
    monthComparisonFindUnique.mockResolvedValueOnce(null);
    const payloadWithUnknownCategory = {
      ...VALID_PAYLOAD,
      drivers: [
        ...VALID_PAYLOAD.drivers,
        { category: "space_travel", direction: "up", amount: "99.00", explanation: "Invented." },
      ],
    };
    compare.mockResolvedValueOnce(providerResult(JSON.stringify(payloadWithUnknownCategory)));
    monthComparisonUpsert.mockResolvedValueOnce({});

    const { compareMonths } = await import("./monthComparison");
    const result = await compareMonths(
      "user-1",
      { monthA: "2026-06", monthB: "2026-07", refresh: false },
      "req-1",
    );

    expect(result.payload.drivers).toHaveLength(1);
    expect(result.payload.drivers[0]?.category).toBe("dining");
  });

  it("builds a synthetic trailing-average monthA when monthA is omitted, dividing by the months that actually have data", async () => {
    mockBaselineMonth(
      [
        {
          categoryId: "produce",
          totalAmount: new FakeDecimal(30),
          periodMonth: new Date(Date.UTC(2026, 3, 1)),
        },
        {
          categoryId: "produce",
          totalAmount: new FakeDecimal(60),
          periodMonth: new Date(Date.UTC(2026, 4, 1)),
        },
        {
          categoryId: "produce",
          totalAmount: new FakeDecimal(90),
          periodMonth: new Date(Date.UTC(2026, 5, 1)),
        },
      ],
      [
        { periodMonth: new Date(Date.UTC(2026, 3, 1)), _count: { _all: 10 } },
        { periodMonth: new Date(Date.UTC(2026, 4, 1)), _count: { _all: 20 } },
        { periodMonth: new Date(Date.UTC(2026, 5, 1)), _count: { _all: 30 } },
      ],
    );
    mockRealMonth([{ categoryId: "produce", totalAmount: new FakeDecimal(100) }], 25);
    getUserCurrency.mockResolvedValue("EGP");
    monthComparisonFindUnique.mockResolvedValueOnce(null);
    compare.mockResolvedValueOnce(
      providerResult(
        JSON.stringify({
          ...VALID_PAYLOAD,
          drivers: [{ category: "produce", direction: "up", amount: "40.00", explanation: "…" }],
        }),
      ),
    );
    monthComparisonUpsert.mockResolvedValueOnce({});

    const { compareMonths } = await import("./monthComparison");
    await compareMonths("user-1", { monthB: "2026-07", refresh: false }, "req-1");

    const call = compare.mock.calls[0]?.[0] as { diffJson: string };
    const diff = JSON.parse(call.diffJson) as {
      monthA: { total: string; orders: number; label: string };
    };
    expect(diff.monthA.total).toBe("60.00"); // (30 + 60 + 90) / 3 months of data
    expect(diff.monthA.orders).toBe(20); // (10 + 20 + 30) / 3 months of data
    expect(diff.monthA.label).toContain("Avg (");

    const upsertArgs = monthComparisonUpsert.mock.calls[0]?.[0] as {
      where: { userId_monthA_monthB_dataVersion: { monthA: Date } };
    };
    expect(upsertArgs.where.userId_monthA_monthB_dataVersion.monthA).toEqual(
      new Date(Date.UTC(2026, 3, 1)), // 3 months before 2026-07
    );
  });

  it("averages only over months that actually have data, not the full 3-month window", async () => {
    // Only one of the three window months has a row — dividing by a fixed 3 would understate this
    // user's real spending and narrate a fabricated jump.
    mockBaselineMonth(
      [
        {
          categoryId: "produce",
          totalAmount: new FakeDecimal(90),
          periodMonth: new Date(Date.UTC(2026, 5, 1)),
        },
      ],
      [{ periodMonth: new Date(Date.UTC(2026, 5, 1)), _count: { _all: 9 } }],
    );
    mockRealMonth([{ categoryId: "produce", totalAmount: new FakeDecimal(100) }], 25);
    getUserCurrency.mockResolvedValue("EGP");
    monthComparisonFindUnique.mockResolvedValueOnce(null);
    compare.mockResolvedValueOnce(providerResult(JSON.stringify(VALID_PAYLOAD)));
    monthComparisonUpsert.mockResolvedValueOnce({});

    const { compareMonths } = await import("./monthComparison");
    await compareMonths("user-1", { monthB: "2026-07", refresh: false }, "req-1");

    const call = compare.mock.calls[0]?.[0] as { diffJson: string };
    const diff = JSON.parse(call.diffJson) as { monthA: { total: string; orders: number } };
    expect(diff.monthA.total).toBe("90.00"); // 90 / 1 month of data, not 90 / 3
    expect(diff.monthA.orders).toBe(9);
  });

  it("rejects a baseline request with no prior spending history at all, without calling the AI provider", async () => {
    mockBaselineMonth([], []);

    const { compareMonths } = await import("./monthComparison");

    await expect(
      compareMonths("user-1", { monthB: "2026-07", refresh: false }, "req-1"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    expect(compare).not.toHaveBeenCalled();
  });

  it("reports a null percentage delta for a category with no spend last month, not +100%", async () => {
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(3400) }], 21);
    mockRealMonth(
      [
        { categoryId: "dining", totalAmount: new FakeDecimal(5470) },
        { categoryId: "electronics", totalAmount: new FakeDecimal(500) },
      ],
      26,
    );
    getUserCurrency.mockResolvedValue("EGP");
    monthComparisonFindUnique.mockResolvedValueOnce(null);
    compare.mockResolvedValueOnce(providerResult(JSON.stringify(VALID_PAYLOAD)));
    monthComparisonUpsert.mockResolvedValueOnce({});

    const { compareMonths } = await import("./monthComparison");
    await compareMonths(
      "user-1",
      { monthA: "2026-06", monthB: "2026-07", refresh: false },
      "req-1",
    );

    const call = compare.mock.calls[0]?.[0] as { diffJson: string };
    const diff = JSON.parse(call.diffJson) as {
      deltas: { byCategoryPct: Record<string, number | null> };
    };
    expect(diff.deltas.byCategoryPct.electronics).toBeNull();
  });

  it("bypasses the cache and overwrites it when refresh is set", async () => {
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(3400) }], 21);
    mockRealMonth([{ categoryId: "dining", totalAmount: new FakeDecimal(5470) }], 26);
    getUserCurrency.mockResolvedValue("EGP");
    compare.mockResolvedValueOnce(providerResult(JSON.stringify(VALID_PAYLOAD)));
    monthComparisonUpsert.mockResolvedValueOnce({});

    const { compareMonths } = await import("./monthComparison");
    const result = await compareMonths(
      "user-1",
      { monthA: "2026-06", monthB: "2026-07", refresh: true },
      "req-1",
    );

    expect(monthComparisonFindUnique).not.toHaveBeenCalled();
    expect(result.cached).toBe(false);
    expect(monthComparisonUpsert).toHaveBeenCalledTimes(1);
  });
});
