import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/lib/db/prisma";

/** Same rationale as `analytics.test.ts`'s FakeDecimal — `budgets.ts` chains `.add`/`.sub`/`.toFixed`
 *  across `Prisma.Decimal` instances built from numbers (`new Prisma.Decimal(0)`), row fixtures,
 *  and — since `getWeeklyActualSpend` re-wraps its query result through `new Prisma.Decimal(...)`
 *  to normalize whatever the driver handed back — another `Prisma.Decimal` instance itself, so the
 *  constructor has to accept all three. */
class FakeDecimal {
  private readonly value: number;
  constructor(value: number | string | FakeDecimal) {
    if (value instanceof FakeDecimal) {
      this.value = value.value;
    } else {
      this.value = typeof value === "string" ? Number(value) : value;
    }
  }
  add(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value + other.value);
  }
  sub(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value - other.value);
  }
  toFixed(n: number): string {
    return this.value.toFixed(n);
  }
}

const weeklyBudgetFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const weeklyBudgetUpsert = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const weeklyBudgetDeleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const proteinBudgetFindUnique = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const proteinBudgetUpsert = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const proteinBudgetDeleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const proteinMonthlySummaryFindUnique = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const queryRaw = vi.fn<(...args: unknown[]) => Promise<unknown>>();
/** Records the options `$transaction` was called with, so a test can pin `WRITE_TRANSACTION_OPTIONS`
 *  without the mock itself needing to care what they are. */
const transaction = vi.fn<(...args: unknown[]) => void>();

vi.mock("@/lib/db/prisma", () => {
  const client = {
    weeklyBudget: {
      findMany: (...args: unknown[]) => weeklyBudgetFindMany(...args),
      upsert: (...args: unknown[]) => weeklyBudgetUpsert(...args),
      deleteMany: (...args: unknown[]) => weeklyBudgetDeleteMany(...args),
    },
    proteinBudget: {
      findUnique: (...args: unknown[]) => proteinBudgetFindUnique(...args),
      upsert: (...args: unknown[]) => proteinBudgetUpsert(...args),
      deleteMany: (...args: unknown[]) => proteinBudgetDeleteMany(...args),
    },
    proteinMonthlySummary: {
      findUnique: (...args: unknown[]) => proteinMonthlySummaryFindUnique(...args),
    },
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  };

  return {
    prisma: {
      ...client,
      $transaction: (run: (tx: unknown) => Promise<unknown>, options: unknown) => {
        transaction(options);
        return run(client);
      },
    },
    Prisma: { Decimal: FakeDecimal },
  };
});

const JULY = new Date(Date.UTC(2026, 6, 1));

afterEach(() => {
  vi.clearAllMocks();
});

describe("getBudgetSummary", () => {
  it("zero-fills weeks with no budget and no spend, and reports null remaining when unbudgeted", async () => {
    weeklyBudgetFindMany.mockResolvedValue([]);
    proteinBudgetFindUnique.mockResolvedValue(null);
    proteinMonthlySummaryFindUnique.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);

    const { getBudgetSummary } = await import("./budgets");
    const summary = await getBudgetSummary("user-1", JULY);

    expect(summary.weeks).toEqual([
      { week: 1, budgetAmount: null, spentAmount: "0.00", remaining: null },
      { week: 2, budgetAmount: null, spentAmount: "0.00", remaining: null },
      { week: 3, budgetAmount: null, spentAmount: "0.00", remaining: null },
      { week: 4, budgetAmount: null, spentAmount: "0.00", remaining: null },
      { week: 5, budgetAmount: null, spentAmount: "0.00", remaining: null },
    ]);
    expect(summary.protein).toEqual({ budgetAmount: null, spentAmount: "0.00", remaining: null });
    expect(summary.month).toEqual({ budgetAmount: null, spentAmount: "0.00", remaining: null });
  });

  // The `$queryRaw` call is the one place in this feature Prisma's types can't enforce the scope —
  // a missing `WHERE userId = ...` there would leak every user's spend and every other assertion in
  // this file would stay green.
  it("scopes every read to the given userId and periodMonth, including the raw query", async () => {
    weeklyBudgetFindMany.mockResolvedValue([]);
    proteinBudgetFindUnique.mockResolvedValue(null);
    proteinMonthlySummaryFindUnique.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);

    const { getBudgetSummary } = await import("./budgets");
    await getBudgetSummary("user-1", JULY);

    expect(weeklyBudgetFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY },
    });
    expect(proteinBudgetFindUnique).toHaveBeenCalledWith({
      where: { userId_periodMonth: { userId: "user-1", periodMonth: JULY } },
    });
    // Tagged-template call: the interpolated values land as the trailing arguments.
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual(["user-1", JULY]);
  });

  it("computes remaining per week from live order spend", async () => {
    weeklyBudgetFindMany.mockResolvedValue([
      { periodWeek: 1, amount: new FakeDecimal(600) },
      { periodWeek: 3, amount: new FakeDecimal(600) },
    ]);
    proteinBudgetFindUnique.mockResolvedValue({ amount: new FakeDecimal(350) });
    proteinMonthlySummaryFindUnique.mockResolvedValue({ totalAmount: new FakeDecimal(310) });
    queryRaw.mockResolvedValue([
      { periodWeek: 1, total: new FakeDecimal(500) },
      { periodWeek: 3, total: new FakeDecimal(830) },
    ]);

    const { getBudgetSummary } = await import("./budgets");
    const summary = await getBudgetSummary("user-1", JULY);

    expect(summary.weeks[0]).toEqual({
      week: 1,
      budgetAmount: "600.00",
      spentAmount: "500.00",
      remaining: "100.00",
    });
    // Over budget reads as a negative remaining, not clamped to zero — the point is to show it.
    expect(summary.weeks[2]).toEqual({
      week: 3,
      budgetAmount: "600.00",
      spentAmount: "830.00",
      remaining: "-230.00",
    });
    expect(summary.protein).toEqual({
      budgetAmount: "350.00",
      spentAmount: "310.00",
      remaining: "40.00",
    });
  });

  // Only weeks 1 and 3 are budgeted here — the month figure must not compare a two-fifths target
  // against the whole month's spend, so it reads as unset rather than a misleading number.
  it("leaves the month budget null when not every week is budgeted, even though spend is still totalled", async () => {
    weeklyBudgetFindMany.mockResolvedValue([
      { periodWeek: 1, amount: new FakeDecimal(600) },
      { periodWeek: 3, amount: new FakeDecimal(600) },
    ]);
    proteinBudgetFindUnique.mockResolvedValue({ amount: new FakeDecimal(350) });
    proteinMonthlySummaryFindUnique.mockResolvedValue({ totalAmount: new FakeDecimal(310) });
    queryRaw.mockResolvedValue([
      { periodWeek: 1, total: new FakeDecimal(500) },
      { periodWeek: 3, total: new FakeDecimal(830) },
    ]);

    const { getBudgetSummary } = await import("./budgets");
    const summary = await getBudgetSummary("user-1", JULY);

    expect(summary.month).toEqual({ budgetAmount: null, spentAmount: "1330.00", remaining: null });
  });

  // Every week budgeted (350 x 5 = 1750) plus a protein budget on top — the month total must equal
  // Σ(week budgets) only. Protein spend already rides inside its week's `spentAmount`, so adding
  // the protein *budget* on top without adding protein *spend* on top would inflate `remaining` by
  // exactly the protein budget — the bug this test guards against.
  it("consolidates the month budget from weeks alone once every week is set, excluding protein", async () => {
    weeklyBudgetFindMany.mockResolvedValue(
      [1, 2, 3, 4, 5].map((week) => ({ periodWeek: week, amount: new FakeDecimal(350) })),
    );
    proteinBudgetFindUnique.mockResolvedValue({ amount: new FakeDecimal(300) });
    proteinMonthlySummaryFindUnique.mockResolvedValue({ totalAmount: new FakeDecimal(250) });
    queryRaw.mockResolvedValue([{ periodWeek: 1, total: new FakeDecimal(300) }]);

    const { getBudgetSummary } = await import("./budgets");
    const summary = await getBudgetSummary("user-1", JULY);

    expect(summary.month).toEqual({
      budgetAmount: "1750.00",
      spentAmount: "300.00",
      remaining: "1450.00",
    });
  });

  // A caller that already has the protein row (`getMonthSummary`) passes it in — no second
  // `proteinMonthlySummary` lookup for the same (userId, periodMonth).
  it("skips its own protein-spend lookup when the caller passes one in", async () => {
    weeklyBudgetFindMany.mockResolvedValue([]);
    proteinBudgetFindUnique.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);

    const { getBudgetSummary } = await import("./budgets");
    const summary = await getBudgetSummary(
      "user-1",
      JULY,
      new FakeDecimal(75) as unknown as Prisma.Decimal,
    );

    expect(proteinMonthlySummaryFindUnique).not.toHaveBeenCalled();
    expect(summary.protein.spentAmount).toBe("75.00");
  });

  it("sums an order's periodWeek into the month total even if it fell outside 1-5", async () => {
    weeklyBudgetFindMany.mockResolvedValue([]);
    proteinBudgetFindUnique.mockResolvedValue(null);
    proteinMonthlySummaryFindUnique.mockResolvedValue(null);
    // Not a real state (periodWeekSchema guards every write path) — this only proves the month
    // total sums the live query's own groups rather than re-deriving from the zero-filled 1-5
    // display array, which would silently drop a row like this one.
    queryRaw.mockResolvedValue([{ periodWeek: 9, total: new FakeDecimal(40) }]);

    const { getBudgetSummary } = await import("./budgets");
    const summary = await getBudgetSummary("user-1", JULY);

    expect(summary.month.spentAmount).toBe("40.00");
  });
});

describe("upsertBudgets", () => {
  it("upserts only the weeks given, keyed on the compound id", async () => {
    const { upsertBudgets } = await import("./budgets");
    await upsertBudgets("user-1", JULY, { weeks: [{ week: 2, amount: "400.00" }] });

    expect(weeklyBudgetUpsert).toHaveBeenCalledTimes(1);
    expect(weeklyBudgetUpsert).toHaveBeenCalledWith({
      where: {
        userId_periodMonth_periodWeek: { userId: "user-1", periodMonth: JULY, periodWeek: 2 },
      },
      create: { userId: "user-1", periodMonth: JULY, periodWeek: 2, amount: "400.00" },
      update: { amount: "400.00" },
    });
    expect(weeklyBudgetDeleteMany).not.toHaveBeenCalled();
    expect(proteinBudgetUpsert).not.toHaveBeenCalled();
    expect(proteinBudgetDeleteMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith({ timeout: 15_000, maxWait: 5_000 });
  });

  it("deletes a week's budget when its amount is explicitly cleared with null", async () => {
    const { upsertBudgets } = await import("./budgets");
    await upsertBudgets("user-1", JULY, { weeks: [{ week: 3, amount: null }] });

    expect(weeklyBudgetDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY, periodWeek: 3 },
    });
    expect(weeklyBudgetUpsert).not.toHaveBeenCalled();
  });

  it("upserts the protein budget when an amount is given", async () => {
    const { upsertBudgets } = await import("./budgets");
    await upsertBudgets("user-1", JULY, { protein: "350.00" });

    expect(proteinBudgetUpsert).toHaveBeenCalledWith({
      where: { userId_periodMonth: { userId: "user-1", periodMonth: JULY } },
      create: { userId: "user-1", periodMonth: JULY, amount: "350.00" },
      update: { amount: "350.00" },
    });
  });

  it("deletes the protein budget when it is explicitly cleared with null", async () => {
    const { upsertBudgets } = await import("./budgets");
    await upsertBudgets("user-1", JULY, { protein: null });

    expect(proteinBudgetDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY },
    });
    expect(proteinBudgetUpsert).not.toHaveBeenCalled();
  });

  it("leaves protein untouched when omitted", async () => {
    const { upsertBudgets } = await import("./budgets");
    await upsertBudgets("user-1", JULY, { weeks: [{ week: 1, amount: "100.00" }] });

    expect(proteinBudgetUpsert).not.toHaveBeenCalled();
    expect(proteinBudgetDeleteMany).not.toHaveBeenCalled();
  });
});
