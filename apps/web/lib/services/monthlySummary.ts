import { Prisma } from "@/lib/db/prisma";

type Tx = Prisma.TransactionClient;

interface CategoryAggregateRow {
  categoryId: string;
  total: Prisma.Decimal;
  itemCount: bigint;
  orderCount: bigint;
}

interface WeekAggregateRow {
  periodWeek: number;
  total: Prisma.Decimal;
  itemCount: bigint;
  orderCount: bigint;
}

interface ProteinAggregateRow {
  total: Prisma.Decimal;
  itemCount: bigint;
  orderCount: bigint;
}

/**
 * Recomputes every `MonthlySummary`, `WeeklySummary`, and `ProteinMonthlySummary` row for one
 * (userId, periodMonth) from source `OrderItem` rows. Must run inside the same transaction as the
 * order write that triggered it (PROJECT_SPEC.md §12, CLAUDE.md rule 8) — never leave a summary
 * stale even for one request. A full month recompute covers every week in it, so callers never need
 * to track which specific week changed (e.g. moving an order between weeks).
 *
 * Each aggregate is one `GROUP BY` round trip in Postgres, not a pull of every `OrderItem` row in
 * the month into Node — that scan grows with month size on every single order write, where these
 * queries' cost is bounded by category/week count either way.
 */
export async function recomputeMonthlySummary(
  tx: Tx,
  userId: string,
  periodMonth: Date,
): Promise<void> {
  await Promise.all([
    recomputeCategorySummary(tx, userId, periodMonth),
    recomputeWeeklySummary(tx, userId, periodMonth),
    recomputeProteinSummary(tx, userId, periodMonth),
  ]);
}

async function recomputeCategorySummary(tx: Tx, userId: string, periodMonth: Date): Promise<void> {
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
 * Total-only per week (no category split — confirmed with the user), grouped on `Order.periodWeek`
 * rather than `OrderItem` so an item without its own week concept still rolls up under its order's.
 */
async function recomputeWeeklySummary(tx: Tx, userId: string, periodMonth: Date): Promise<void> {
  const rows = await tx.$queryRaw<WeekAggregateRow[]>`
    SELECT o."periodWeek"                    AS "periodWeek",
           SUM(oi."lineTotal")               AS "total",
           COUNT(*)                          AS "itemCount",
           COUNT(DISTINCT oi."orderId")      AS "orderCount"
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."userId" = ${userId} AND o."periodMonth" = ${periodMonth}
    GROUP BY o."periodWeek"
  `;

  const weeks = rows.map((row) => row.periodWeek);
  await tx.weeklySummary.deleteMany({
    where: { userId, periodMonth, periodWeek: { notIn: weeks } },
  });

  for (const row of rows) {
    await tx.weeklySummary.upsert({
      where: {
        userId_periodMonth_periodWeek: { userId, periodMonth, periodWeek: row.periodWeek },
      },
      create: {
        userId,
        periodMonth,
        periodWeek: row.periodWeek,
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
 * One row per (userId, periodMonth) summing items flagged `isProtein` — cuts across categories and
 * weeks on purpose (BR-2/the protein ask): a protein item counts toward the month total regardless
 * of which week its order fell in.
 */
async function recomputeProteinSummary(tx: Tx, userId: string, periodMonth: Date): Promise<void> {
  const [row] = await tx.$queryRaw<ProteinAggregateRow[]>`
    SELECT SUM(oi."lineTotal")               AS "total",
           COUNT(*)                          AS "itemCount",
           COUNT(DISTINCT oi."orderId")      AS "orderCount"
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."userId" = ${userId} AND o."periodMonth" = ${periodMonth} AND oi."isProtein" = true
  `;

  if (!row || row.itemCount === BigInt(0)) {
    await tx.proteinMonthlySummary.deleteMany({ where: { userId, periodMonth } });
    return;
  }

  await tx.proteinMonthlySummary.upsert({
    where: { userId_periodMonth: { userId, periodMonth } },
    create: {
      userId,
      periodMonth,
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
