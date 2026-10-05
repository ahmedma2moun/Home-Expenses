import { afterEach, describe, expect, it, vi } from "vitest";

const monthlySummaryFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const weeklySummaryFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const proteinFindUnique = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderCount = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getUserCurrency = vi.fn<(...args: unknown[]) => Promise<string>>();
const getBudgetSummary = vi.fn<(...args: unknown[]) => Promise<unknown>>();

/** A real-enough `Prisma.Decimal` stand-in: `analytics.ts` constructs `new Prisma.Decimal(0)`
 *  directly and chains `.add`/`.comparedTo`/`.toFixed` across it and every row's `totalAmount`, so
 *  every decimal-shaped value in this test — row fixtures included — has to be one of these, not a
 *  plain number or an ad-hoc stub, or the two won't compose the way real `Decimal` instances do. */
class FakeDecimal {
  constructor(private readonly value: number) {}
  add(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value + other.value);
  }
  comparedTo(other: FakeDecimal): number {
    return this.value - other.value;
  }
  toFixed(n: number): string {
    return this.value.toFixed(n);
  }
}

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    monthlySummary: { findMany: (...args: unknown[]) => monthlySummaryFindMany(...args) },
    weeklySummary: { findMany: (...args: unknown[]) => weeklySummaryFindMany(...args) },
    proteinMonthlySummary: { findUnique: (...args: unknown[]) => proteinFindUnique(...args) },
    order: { count: (...args: unknown[]) => orderCount(...args) },
  },
  Prisma: { Decimal: FakeDecimal },
}));

vi.mock("@/lib/services/users", () => ({
  getUserCurrency: (...args: unknown[]) => getUserCurrency(...args),
}));

// `budgets.ts` has its own dedicated tests (budgets.test.ts) — here it's just a collaborator
// `getMonthSummary` embeds the result of, so a fixed stub is enough.
vi.mock("@/lib/services/budgets", () => ({
  getBudgetSummary: (...args: unknown[]) => getBudgetSummary(...args),
}));

const EMPTY_BUDGET = {
  periodCount: 5,
  weeks: Array.from({ length: 5 }, (_, index) => ({
    week: index + 1,
    budgetAmount: null,
    spentAmount: "0.00",
    remaining: null,
  })),
  protein: { budgetAmount: null, spentAmount: "0.00", remaining: null },
  month: { budgetAmount: null, spentAmount: "0.00", remaining: null },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("getMonthSummary", () => {
  it("sums category totals into the month total and includes the account's currency", async () => {
    monthlySummaryFindMany.mockResolvedValue([
      { categoryId: "dairy_eggs", totalAmount: new FakeDecimal(120), itemCount: 2, orderCount: 1 },
      { categoryId: "produce", totalAmount: new FakeDecimal(45.5), itemCount: 3, orderCount: 2 },
    ]);
    weeklySummaryFindMany.mockResolvedValue([
      { periodWeek: 1, totalAmount: new FakeDecimal(100), itemCount: 4, orderCount: 2 },
      { periodWeek: 3, totalAmount: new FakeDecimal(65.5), itemCount: 1, orderCount: 1 },
    ]);
    proteinFindUnique.mockResolvedValue({
      totalAmount: new FakeDecimal(30),
      itemCount: 1,
      orderCount: 1,
    });
    orderCount.mockResolvedValue(3);
    getUserCurrency.mockResolvedValue("EGP");
    getBudgetSummary.mockResolvedValue(EMPTY_BUDGET);

    const { getMonthSummary } = await import("./analytics");
    const summary = await getMonthSummary("user-1", new Date(Date.UTC(2026, 6, 1)));

    expect(summary.currency).toBe("EGP");
    expect(summary.totalAmount).toBe("165.50");
    expect(summary.itemCount).toBe(5);
    expect(summary.orderCount).toBe(3);
    expect(summary.categories).toHaveLength(2);
    expect(summary.categories[0]).toMatchObject({
      categoryId: "dairy_eggs",
      name: "Dairy & Eggs",
      emoji: "🥛",
      totalAmount: "120.00",
    });

    // Always 5 weeks, zero-filled for any week the aggregate didn't return.
    expect(summary.weeks).toEqual([
      { week: 1, totalAmount: "100.00", itemCount: 4, orderCount: 2 },
      { week: 2, totalAmount: "0.00", itemCount: 0, orderCount: 0 },
      { week: 3, totalAmount: "65.50", itemCount: 1, orderCount: 1 },
      { week: 4, totalAmount: "0.00", itemCount: 0, orderCount: 0 },
      { week: 5, totalAmount: "0.00", itemCount: 0, orderCount: 0 },
    ]);
    expect(summary.protein).toEqual({ totalAmount: "30.00", itemCount: 1, orderCount: 1 });
    // `budget` is embedded verbatim from `getBudgetSummary` — its own math is covered by
    // budgets.test.ts, this only checks the wiring.
    expect(summary.budget).toBe(EMPTY_BUDGET);
  });

  it("returns a zero total for a month with no orders, not an error", async () => {
    monthlySummaryFindMany.mockResolvedValue([]);
    weeklySummaryFindMany.mockResolvedValue([]);
    proteinFindUnique.mockResolvedValue(null);
    orderCount.mockResolvedValue(0);
    getUserCurrency.mockResolvedValue("EGP");
    getBudgetSummary.mockResolvedValue(EMPTY_BUDGET);

    const { getMonthSummary } = await import("./analytics");
    const summary = await getMonthSummary("user-1", new Date(Date.UTC(2026, 6, 1)));

    expect(summary.totalAmount).toBe("0.00");
    expect(summary.categories).toEqual([]);
    expect(summary.weeks).toHaveLength(5);
    expect(summary.weeks.every((week) => week.totalAmount === "0.00")).toBe(true);
    expect(summary.protein).toEqual({ totalAmount: "0.00", itemCount: 0, orderCount: 0 });
  });

  // A category slug that isn't in the seeded taxonomy falls back to the slug itself as its own
  // display name rather than throwing — PROJECT_SPEC.md never promises the lookup is exhaustive.
  it("falls back to the raw slug when a category isn't in the taxonomy lookup", async () => {
    monthlySummaryFindMany.mockResolvedValue([
      {
        categoryId: "not-a-real-category",
        totalAmount: new FakeDecimal(10),
        itemCount: 1,
        orderCount: 1,
      },
    ]);
    weeklySummaryFindMany.mockResolvedValue([]);
    proteinFindUnique.mockResolvedValue(null);
    orderCount.mockResolvedValue(1);
    getUserCurrency.mockResolvedValue("EGP");

    const { getMonthSummary } = await import("./analytics");
    const summary = await getMonthSummary("user-1", new Date(Date.UTC(2026, 6, 1)));

    expect(summary.categories[0]).toMatchObject({
      categoryId: "not-a-real-category",
      name: "not-a-real-category",
    });
  });
});

describe("getTrends", () => {
  it("fills every month in the window, including months with no spend", async () => {
    monthlySummaryFindMany.mockResolvedValue([]);
    getUserCurrency.mockResolvedValue("EGP");

    const { getTrends } = await import("./analytics");
    const trends = await getTrends("user-1", 3, new Date(Date.UTC(2026, 6, 15)));

    expect(trends.currency).toBe("EGP");
    expect(trends.months).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(trends.totals).toEqual([
      { month: "2026-05", totalAmount: "0.00" },
      { month: "2026-06", totalAmount: "0.00" },
      { month: "2026-07", totalAmount: "0.00" },
    ]);
  });

  it("sums a category's series across the window for its ranking total", async () => {
    monthlySummaryFindMany.mockResolvedValue([
      {
        periodMonth: new Date(Date.UTC(2026, 5, 1)),
        categoryId: "produce",
        totalAmount: new FakeDecimal(10),
      },
      {
        periodMonth: new Date(Date.UTC(2026, 6, 1)),
        categoryId: "produce",
        totalAmount: new FakeDecimal(20),
      },
    ]);
    getUserCurrency.mockResolvedValue("EGP");

    const { getTrends } = await import("./analytics");
    const trends = await getTrends("user-1", 2, new Date(Date.UTC(2026, 6, 15)));

    expect(trends.categories[0]).toMatchObject({ categoryId: "produce", totalAmount: "30.00" });
    expect(trends.categories[0]?.series).toEqual([
      { month: "2026-06", totalAmount: "10.00" },
      { month: "2026-07", totalAmount: "20.00" },
    ]);
  });

  // Two categories tied on total must still sort deterministically, or a client's color/order
  // assignment would flap between requests.
  it("breaks a tie between two categories' totals by categoryId", async () => {
    monthlySummaryFindMany.mockResolvedValue([
      {
        periodMonth: new Date(Date.UTC(2026, 6, 1)),
        categoryId: "produce",
        totalAmount: new FakeDecimal(10),
      },
      {
        periodMonth: new Date(Date.UTC(2026, 6, 1)),
        categoryId: "dairy_eggs",
        totalAmount: new FakeDecimal(10),
      },
    ]);
    getUserCurrency.mockResolvedValue("EGP");

    const { getTrends } = await import("./analytics");
    const trends = await getTrends("user-1", 1, new Date(Date.UTC(2026, 6, 15)));

    expect(trends.categories.map((c) => c.categoryId)).toEqual(["dairy_eggs", "produce"]);
  });
});
