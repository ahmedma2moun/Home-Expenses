import { prisma, Prisma } from "@/lib/db/prisma";
import { formatMonthLabel, monthRange, toPeriodMonth } from "@/lib/services/period";
import { CATEGORIES } from "@/lib/services/categoryTaxonomy";

const CATEGORY_LOOKUP = new Map<string, (typeof CATEGORIES)[number]>(
  CATEGORIES.map((category) => [category.id, category]),
);

function categoryMeta(categoryId: string): { name: string; emoji: string } {
  const meta = CATEGORY_LOOKUP.get(categoryId);
  return { name: meta?.name ?? categoryId, emoji: meta?.emoji ?? "💼" };
}

export interface MonthCategoryTotal {
  categoryId: string;
  name: string;
  emoji: string;
  totalAmount: string;
  itemCount: number;
  orderCount: number;
}

export interface MonthSummary {
  month: string;
  totalAmount: string;
  orderCount: number;
  itemCount: number;
  categories: MonthCategoryTotal[];
}

/** Reads the materialized MonthlySummary rows for one month — never scans OrderItem (§12). */
export async function getMonthSummary(userId: string, periodMonth: Date): Promise<MonthSummary> {
  const [rows, orderCount] = await Promise.all([
    prisma.monthlySummary.findMany({
      where: { userId, periodMonth },
      orderBy: { totalAmount: "desc" },
    }),
    prisma.order.count({ where: { userId, periodMonth } }),
  ]);

  const categories = rows.map((row) => ({
    categoryId: row.categoryId,
    ...categoryMeta(row.categoryId),
    totalAmount: row.totalAmount.toFixed(2),
    itemCount: row.itemCount,
    orderCount: row.orderCount,
  }));

  const totalAmount = rows.reduce((sum, row) => sum.add(row.totalAmount), new Prisma.Decimal(0));
  const itemCount = categories.reduce((sum, category) => sum + category.itemCount, 0);

  return {
    month: formatMonthLabel(periodMonth),
    totalAmount: totalAmount.toFixed(2),
    orderCount,
    itemCount,
    categories,
  };
}

export interface TrendPoint {
  month: string;
  totalAmount: string;
}

export interface TrendCategorySeries {
  categoryId: string;
  name: string;
  emoji: string;
  /** Sum across the whole window — lets a client rank/color categories consistently. */
  totalAmount: string;
  series: TrendPoint[];
}

export interface Trends {
  months: string[];
  totals: TrendPoint[];
  categories: TrendCategorySeries[];
}

/**
 * Reads materialized `MonthlySummary` rows across a rolling window ending at the current month
 * (BR-5's "last 6/12 months" trend view). Every month in the window is present in the response
 * even if it has no spending, so a client can plot a continuous x-axis without filling gaps itself.
 * `now` is injectable so the window boundary is deterministic under test.
 */
export async function getTrends(
  userId: string,
  months: number,
  now: Date = new Date(),
): Promise<Trends> {
  const end = toPeriodMonth(now);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  const monthLabels = monthRange(start, end);

  const rows = await prisma.monthlySummary.findMany({
    where: { userId, periodMonth: { gte: start, lte: end } },
    select: { periodMonth: true, categoryId: true, totalAmount: true },
  });

  const totalsByMonth = new Map<string, Prisma.Decimal>(
    monthLabels.map((label) => [label, new Prisma.Decimal(0)]),
  );
  const byCategory = new Map<string, Map<string, Prisma.Decimal>>();

  for (const row of rows) {
    const label = formatMonthLabel(row.periodMonth);
    totalsByMonth.set(
      label,
      (totalsByMonth.get(label) ?? new Prisma.Decimal(0)).add(row.totalAmount),
    );

    const monthMap =
      byCategory.get(row.categoryId) ?? new Map(monthLabels.map((m) => [m, new Prisma.Decimal(0)]));
    monthMap.set(label, (monthMap.get(label) ?? new Prisma.Decimal(0)).add(row.totalAmount));
    byCategory.set(row.categoryId, monthMap);
  }

  return {
    months: monthLabels,
    totals: monthLabels.map((month) => ({
      month,
      totalAmount: (totalsByMonth.get(month) ?? new Prisma.Decimal(0)).toFixed(2),
    })),
    categories: buildCategorySeries(byCategory, monthLabels),
  };
}

/**
 * Sorted by each category's total across the window, descending — a tiebreak on `categoryId`
 * keeps that order deterministic even when Postgres returns rows in an arbitrary sequence (`§1`:
 * comparing on `Prisma.Decimal`, never a parsed float).
 */
function buildCategorySeries(
  byCategory: Map<string, Map<string, Prisma.Decimal>>,
  monthLabels: string[],
): TrendCategorySeries[] {
  return Array.from(byCategory.entries())
    .map(([categoryId, monthMap]) => {
      const series = monthLabels.map((month) => ({
        month,
        totalAmount: (monthMap.get(month) ?? new Prisma.Decimal(0)).toFixed(2),
      }));
      const totalDecimal = monthLabels.reduce(
        (sum, month) => sum.add(monthMap.get(month) ?? new Prisma.Decimal(0)),
        new Prisma.Decimal(0),
      );
      return { categoryId, ...categoryMeta(categoryId), totalDecimal, series };
    })
    .sort(
      (a, b) =>
        b.totalDecimal.comparedTo(a.totalDecimal) || a.categoryId.localeCompare(b.categoryId),
    )
    .map(({ totalDecimal, ...rest }) => ({ ...rest, totalAmount: totalDecimal.toFixed(2) }));
}
