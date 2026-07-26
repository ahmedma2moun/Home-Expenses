import { prisma, Prisma } from "@/lib/db/prisma";
import { formatMonthLabel } from "@/lib/services/period";
import { CATEGORIES } from "@/lib/services/categoryTaxonomy";

const CATEGORY_LOOKUP = new Map<string, (typeof CATEGORIES)[number]>(
  CATEGORIES.map((category) => [category.id, category]),
);

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

  const categories = rows.map((row) => {
    const meta = CATEGORY_LOOKUP.get(row.categoryId);
    return {
      categoryId: row.categoryId,
      name: meta?.name ?? row.categoryId,
      emoji: meta?.emoji ?? "💼",
      totalAmount: row.totalAmount.toFixed(2),
      itemCount: row.itemCount,
      orderCount: row.orderCount,
    };
  });

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
