import { afterEach, describe, expect, it, vi } from "vitest";

const monthlySummaryFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderCount = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getUserCurrency = vi.fn<(...args: unknown[]) => Promise<string>>();

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
    order: { count: (...args: unknown[]) => orderCount(...args) },
  },
  Prisma: { Decimal: FakeDecimal },
}));

vi.mock("@/lib/services/users", () => ({
  getUserCurrency: (...args: unknown[]) => getUserCurrency(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("getMonthSummary", () => {
  it("sums category totals into the month total and includes the account's currency", async () => {
    monthlySummaryFindMany.mockResolvedValue([
      { categoryId: "dairy_eggs", totalAmount: new FakeDecimal(120), itemCount: 2, orderCount: 1 },
      { categoryId: "produce", totalAmount: new FakeDecimal(45.5), itemCount: 3, orderCount: 2 },
    ]);
    orderCount.mockResolvedValue(3);
    getUserCurrency.mockResolvedValue("EGP");

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
  });

  it("returns a zero total for a month with no orders, not an error", async () => {
    monthlySummaryFindMany.mockResolvedValue([]);
    orderCount.mockResolvedValue(0);
    getUserCurrency.mockResolvedValue("EGP");

    const { getMonthSummary } = await import("./analytics");
    const summary = await getMonthSummary("user-1", new Date(Date.UTC(2026, 6, 1)));

    expect(summary.totalAmount).toBe("0.00");
    expect(summary.categories).toEqual([]);
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
