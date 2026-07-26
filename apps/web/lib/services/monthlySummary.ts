import { Prisma } from "@/lib/db/prisma";

type Tx = Prisma.TransactionClient;

/**
 * Recomputes every `MonthlySummary` row for one (userId, periodMonth) from source `OrderItem`
 * rows. Must run inside the same transaction as the order write that triggered it
 * (PROJECT_SPEC.md §12) — never leave a summary stale even for one request.
 */
export async function recomputeMonthlySummary(
  tx: Tx,
  userId: string,
  periodMonth: Date,
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { order: { userId, periodMonth } },
    select: { categoryId: true, lineTotal: true, orderId: true },
  });

  const byCategory = new Map<
    string,
    { total: Prisma.Decimal; itemCount: number; orderIds: Set<string> }
  >();
  for (const item of items) {
    const bucket = byCategory.get(item.categoryId) ?? {
      total: new Prisma.Decimal(0),
      itemCount: 0,
      orderIds: new Set<string>(),
    };
    bucket.total = bucket.total.add(item.lineTotal);
    bucket.itemCount += 1;
    bucket.orderIds.add(item.orderId);
    byCategory.set(item.categoryId, bucket);
  }

  const existing = await tx.monthlySummary.findMany({
    where: { userId, periodMonth },
    select: { categoryId: true },
  });
  const staleCategoryIds = existing
    .map((row) => row.categoryId)
    .filter((categoryId) => !byCategory.has(categoryId));
  if (staleCategoryIds.length > 0) {
    await tx.monthlySummary.deleteMany({
      where: { userId, periodMonth, categoryId: { in: staleCategoryIds } },
    });
  }

  for (const [categoryId, bucket] of byCategory) {
    await tx.monthlySummary.upsert({
      where: { userId_periodMonth_categoryId: { userId, periodMonth, categoryId } },
      create: {
        userId,
        periodMonth,
        categoryId,
        totalAmount: bucket.total,
        itemCount: bucket.itemCount,
        orderCount: bucket.orderIds.size,
      },
      update: {
        totalAmount: bucket.total,
        itemCount: bucket.itemCount,
        orderCount: bucket.orderIds.size,
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
