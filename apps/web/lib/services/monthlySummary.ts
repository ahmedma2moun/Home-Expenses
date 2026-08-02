import { Prisma } from "@/lib/db/prisma";

type Tx = Prisma.TransactionClient;

interface CategoryAggregateRow {
  categoryId: string;
  total: Prisma.Decimal;
  itemCount: bigint;
  orderCount: bigint;
}

/**
 * Recomputes every `MonthlySummary` row for one (userId, periodMonth) from source `OrderItem`
 * rows. Must run inside the same transaction as the order write that triggered it
 * (PROJECT_SPEC.md §12) — never leave a summary stale even for one request.
 *
 * Aggregated in Postgres (one `GROUP BY` round trip), not by pulling every `OrderItem` row in the
 * month into Node and reducing it there — that scan grows with month size on every single order
 * write, where this query's cost is bounded by category count either way.
 */
export async function recomputeMonthlySummary(
  tx: Tx,
  userId: string,
  periodMonth: Date,
): Promise<void> {
  const rows = await tx.$queryRaw<CategoryAggregateRow[]>`
    SELECT oi."categoryId"                  AS "categoryId",
           SUM(oi."lineTotal")               AS "total",
           COUNT(*)                          AS "itemCount",
           COUNT(DISTINCT oi."orderId")      AS "orderCount"
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."userId" = ${userId} AND o."periodMonth" = ${periodMonth}
    GROUP BY oi."categoryId"
  `;

  const categoryIds = rows.map((row) => row.categoryId);
  await tx.monthlySummary.deleteMany({
    where: { userId, periodMonth, categoryId: { notIn: categoryIds } },
  });

  for (const row of rows) {
    await tx.monthlySummary.upsert({
      where: {
        userId_periodMonth_categoryId: { userId, periodMonth, categoryId: row.categoryId },
      },
      create: {
        userId,
        periodMonth,
        categoryId: row.categoryId,
        totalAmount: row.total,
        itemCount: Number(row.itemCount),
        orderCount: Number(row.orderCount),
      },
      update: {
        totalAmount: row.total,
        itemCount: Number(row.itemCount),
        orderCount: Number(row.orderCount),
      },
    });
  }
}

/**
 * Any order write invalidates cached AI comparisons that reference the affected month(s) — the
 * underlying numbers changed, so a stale narrative would be wrong (PROJECT_SPEC.md §4 BR-5, §12).
 */
export async function invalidateMonthComparisons(
  tx: Tx,
  userId: string,
  periodMonths: Date[],
): Promise<void> {
  if (periodMonths.length === 0) {
    return;
  }
  await tx.monthComparison.deleteMany({
    where: {
      userId,
      OR: [{ monthA: { in: periodMonths } }, { monthB: { in: periodMonths } }],
    },
  });
}
