import { afterEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const upsert = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const deleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const comparisonDeleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/lib/db/prisma", () => ({
  // `$queryRaw` is called as a tagged template — Prisma's real client exposes it that way, so the
  // double stands in for the tag function itself, not a plain call.
  Prisma: {},
}));

/** Minimal stand-in for a Prisma `Decimal` — only the accessor `recomputeMonthlySummary` calls. */
function decimal(value: string) {
  return { toFixed: () => value };
}

function fakeTx() {
  return {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    monthlySummary: {
      upsert: (...args: unknown[]) => upsert(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
    monthComparison: {
      deleteMany: (...args: unknown[]) => comparisonDeleteMany(...args),
    },
  };
}

const JULY = new Date(Date.UTC(2026, 6, 1));

afterEach(() => {
  vi.clearAllMocks();
});

describe("recomputeMonthlySummary", () => {
  it("upserts one row per category from the aggregated query, converting bigint counts", async () => {
    queryRaw.mockResolvedValue([
      {
        categoryId: "dairy_eggs",
        total: decimal("120.00"),
        itemCount: BigInt(2),
        orderCount: BigInt(1),
      },
      {
        categoryId: "produce",
        total: decimal("45.50"),
        itemCount: BigInt(3),
        orderCount: BigInt(2),
      },
    ]);

    const { recomputeMonthlySummary } = await import("./monthlySummary");
    await recomputeMonthlySummary(fakeTx() as never, "user-1", JULY);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      where: {
        userId_periodMonth_categoryId: {
          userId: "user-1",
          periodMonth: JULY,
          categoryId: "dairy_eggs",
        },
      },
      create: {
        userId: "user-1",
        periodMonth: JULY,
        categoryId: "dairy_eggs",
        itemCount: 2,
        orderCount: 1,
      },
      update: { itemCount: 2, orderCount: 1 },
    });
  });

  // A category with zero items this month must not keep a stale row around from before the order
  // that used to hold it was edited/deleted — the aggregate query simply won't return it anymore.
  it("deletes every summary row for a category the aggregate no longer returns", async () => {
    queryRaw.mockResolvedValue([
      {
        categoryId: "dairy_eggs",
        total: decimal("60.00"),
        itemCount: BigInt(1),
        orderCount: BigInt(1),
      },
    ]);

    const { recomputeMonthlySummary } = await import("./monthlySummary");
    await recomputeMonthlySummary(fakeTx() as never, "user-1", JULY);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY, categoryId: { notIn: ["dairy_eggs"] } },
    });
  });

  // The last order in a month's last category was just deleted — every summary row for the month
  // has to go, not be left behind because the category list to exclude is (correctly) empty.
  it("deletes every remaining summary row when the month has no spend left", async () => {
    queryRaw.mockResolvedValue([]);

    const { recomputeMonthlySummary } = await import("./monthlySummary");
    await recomputeMonthlySummary(fakeTx() as never, "user-1", JULY);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY, categoryId: { notIn: [] } },
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("invalidateMonthComparisons", () => {
  it("does nothing for an empty month list", async () => {
    const { invalidateMonthComparisons } = await import("./monthlySummary");
    await invalidateMonthComparisons(fakeTx() as never, "user-1", []);

    expect(comparisonDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes comparisons referencing any affected month on either side", async () => {
    const { invalidateMonthComparisons } = await import("./monthlySummary");
    await invalidateMonthComparisons(fakeTx() as never, "user-1", [JULY]);

    expect(comparisonDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", OR: [{ monthA: { in: [JULY] } }, { monthB: { in: [JULY] } }] },
    });
  });
});
