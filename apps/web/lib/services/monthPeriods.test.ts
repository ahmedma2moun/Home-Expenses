import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  assertPeriodInMonth,
  getPeriodCount,
  lockMonthPeriods,
  resizeMonthPeriods,
} from "./monthPeriods";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  executeRaw: vi.fn(),
  recompute: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    monthPeriodSettings: { findUnique: mocks.findUnique, upsert: mocks.upsert },
    order: { updateMany: mocks.updateMany },
    weeklyBudget: { deleteMany: mocks.deleteMany },
    $executeRaw: mocks.executeRaw,
  };
  return {
    prisma: {
      ...client,
      $transaction: (run: (tx: typeof client) => Promise<unknown>) => run(client),
    },
  };
});
vi.mock("@/lib/services/monthlySummary", () => ({
  recomputeMonthlySummary: mocks.recompute,
  invalidateMonthComparisons: mocks.invalidate,
}));
const scope = { userId: "user-1", periodMonth: new Date("2026-10-01T00:00:00Z") };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("monthly periods", () => {
  it("preserves five periods for existing months without settings", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await getPeriodCount(scope)).toBe(5);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { userId_periodMonth: scope } });
  });

  it("uses the saved count and locks all writes for that user before reading it", async () => {
    mocks.findUnique.mockResolvedValue({ periodCount: 8 });
    expect(await prisma.$transaction((tx) => lockMonthPeriods(tx, scope))).toBe(8);
    expect(mocks.executeRaw.mock.calls[0]?.slice(1)).toEqual(["periods:user-1"]);
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findUnique.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([1, 3, 8, 31])(
    "resizes to %i without losing purchases, and refreshes summaries in the transaction",
    async (periodCount) => {
      await prisma.$transaction((tx) => resizeMonthPeriods(tx, scope, periodCount));
      expect(mocks.upsert).toHaveBeenCalledWith({
        where: { userId_periodMonth: scope },
        create: { ...scope, periodCount },
        update: { periodCount },
      });
      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: { ...scope, periodWeek: { gt: periodCount } },
        data: { periodWeek: periodCount },
      });
      expect(mocks.deleteMany).toHaveBeenCalledWith({
        where: { ...scope, periodWeek: { gt: periodCount } },
      });
      expect(mocks.recompute).toHaveBeenCalledWith(
        expect.anything(),
        scope.userId,
        scope.periodMonth,
      );
      expect(mocks.invalidate).toHaveBeenCalledWith(expect.anything(), scope.userId, [
        scope.periodMonth,
      ]);
    },
  );

  it("rejects assignments outside the configured month while accepting its last period", () => {
    expect(() => {
      assertPeriodInMonth(3, 3);
    }).not.toThrow();
    expect(() => {
      assertPeriodInMonth(4, 3);
    }).toThrow("Choose a period between 1 and 3.");
  });

  it("propagates recomputation failure so the enclosing transaction rolls back", async () => {
    mocks.recompute.mockRejectedValue(new Error("aggregate failed"));
    await expect(prisma.$transaction((tx) => resizeMonthPeriods(tx, scope, 2))).rejects.toThrow(
      "aggregate failed",
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
