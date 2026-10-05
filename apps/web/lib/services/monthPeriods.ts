import { prisma, Prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/envelope";
import { recomputeMonthlySummary, invalidateMonthComparisons } from "@/lib/services/monthlySummary";

interface MonthScope {
  userId: string;
  periodMonth: Date;
}

export async function getPeriodCount(scope: MonthScope): Promise<number> {
  const settings = await prisma.monthPeriodSettings.findUnique({
    where: { userId_periodMonth: scope },
  });
  return settings?.periodCount ?? 5;
}

// Serialize all period-affecting writes for a user before reading order state. A user lock
// also covers moves between months without lock-order inversions or stale source months.
export async function lockPeriodWrites(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"periods:" + userId}, 0))`;
}

export async function lockMonthPeriods(tx: Prisma.TransactionClient, scope: MonthScope) {
  await lockPeriodWrites(tx, scope.userId);
  const settings = await tx.monthPeriodSettings.findUnique({
    where: { userId_periodMonth: scope },
  });
  return settings?.periodCount ?? 5;
}

export function assertPeriodInMonth(period: number, periodCount: number) {
  if (period > periodCount) {
    throw new AppError("VALIDATION_ERROR", `Choose a period between 1 and ${periodCount}.`, 400);
  }
}

export async function resizeMonthPeriods(
  tx: Prisma.TransactionClient,
  scope: MonthScope,
  periodCount: number,
) {
  await tx.monthPeriodSettings.upsert({
    where: { userId_periodMonth: scope },
    create: { ...scope, periodCount },
    update: { periodCount },
  });
  await tx.order.updateMany({
    where: { ...scope, periodWeek: { gt: periodCount } },
    data: { periodWeek: periodCount },
  });
  await tx.weeklyBudget.deleteMany({
    where: { ...scope, periodWeek: { gt: periodCount } },
  });
  await recomputeMonthlySummary(tx, scope.userId, scope.periodMonth);
  await invalidateMonthComparisons(tx, scope.userId, [scope.periodMonth]);
}
