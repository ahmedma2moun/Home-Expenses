import { afterEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const upsert = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const deleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const weeklyUpsert = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const weeklyDeleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const proteinUpsert = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const proteinDeleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
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
    weeklySummary: {
      upsert: (...args: unknown[]) => weeklyUpsert(...args),
      deleteMany: (...args: unknown[]) => weeklyDeleteMany(...args),
    },
    proteinMonthlySummary: {
      upsert: (...args: unknown[]) => proteinUpsert(...args),
      deleteMany: (...args: unknown[]) => proteinDeleteMany(...args),
    },
    monthComparison: {
      deleteMany: (...args: unknown[]) => comparisonDeleteMany(...args),
    },
  };
}

const JULY = new Date(Date.UTC(2026, 6, 1));

/**
 * `recomputeMonthlySummary` runs its three aggregates (category, week, protein) via `Promise.all`,
 * but each async function calls `$queryRaw` synchronously before its first `await` — so the three
 * calls land on the mock in that fixed order regardless of the concurrency. Tests that don't care
 * about one of the three just hand it empty results via this helper.
 */
async function run(categoryRows: unknown[], weekRows: unknown[] = [], proteinRows: unknown[] = []) {
  queryRaw
    .mockResolvedValueOnce(categoryRows)
    .mockResolvedValueOnce(weekRows)
    .mockResolvedValueOnce(proteinRows);

  const { recomputeMonthlySummary } = await import("./monthlySummary");
  await recomputeMonthlySummary(fakeTx() as never, "user-1", JULY);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("recomputeMonthlySummary — category aggregate", () => {
  it("upserts one row per category from the aggregated query, converting bigint counts", async () => {
    await run([
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
    await run([
      {
        categoryId: "dairy_eggs",
        total: decimal("60.00"),
        itemCount: BigInt(1),
        orderCount: BigInt(1),
      },
    ]);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY, categoryId: { notIn: ["dairy_eggs"] } },
    });
  });

  // The last order in a month's last category was just deleted — every summary row for the month
  // has to go, not be left behind because the category list to exclude is (correctly) empty.
  it("deletes every remaining summary row when the month has no spend left", async () => {
    await run([]);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY, categoryId: { notIn: [] } },
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("recomputeMonthlySummary — weekly aggregate (total-only, no category split)", () => {
  it("upserts one row per week present in the aggregate", async () => {
    await run(
      [],
      [
        { periodWeek: 1, total: decimal("30.00"), itemCount: BigInt(2), orderCount: BigInt(1) },
        { periodWeek: 3, total: decimal("70.00"), itemCount: BigInt(4), orderCount: BigInt(2) },
      ],
    );

    expect(weeklyUpsert).toHaveBeenCalledTimes(2);
    expect(weeklyUpsert.mock.calls[0]?.[0]).toMatchObject({
      where: {
        userId_periodMonth_periodWeek: { userId: "user-1", periodMonth: JULY, periodWeek: 1 },
      },
      create: { userId: "user-1", periodMonth: JULY, periodWeek: 1, itemCount: 2, orderCount: 1 },
      update: { itemCount: 2, orderCount: 1 },
    });
  });

  it("deletes week rows no longer present, including all of them when the month is empty", async () => {
    await run([], []);

    expect(weeklyDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY, periodWeek: { notIn: [] } },
    });
    expect(weeklyUpsert).not.toHaveBeenCalled();
  });
});

describe("recomputeMonthlySummary — protein aggregate (month-level only)", () => {
  it("upserts the single protein row for the month when protein items exist", async () => {
    await run([], [], [{ total: decimal("88.00"), itemCount: BigInt(3), orderCount: BigInt(2) }]);

    expect(proteinUpsert.mock.calls[0]?.[0]).toMatchObject({
      where: { userId_periodMonth: { userId: "user-1", periodMonth: JULY } },
      create: { userId: "user-1", periodMonth: JULY, itemCount: 3, orderCount: 2 },
      update: { itemCount: 3, orderCount: 2 },
    });
  });

  // An aggregate `SUM`/`COUNT` with no matching rows still returns one row (count 0, sum null) —
  // that must read as "no protein spend this month", not a row worth keeping.
  it("deletes the protein row when no items are flagged protein this month", async () => {
    await run([], [], [{ total: null, itemCount: BigInt(0), orderCount: BigInt(0) }]);

    expect(proteinDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", periodMonth: JULY },
    });
    expect(proteinUpsert).not.toHaveBeenCalled();
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
