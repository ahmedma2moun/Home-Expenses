import { prisma, Prisma } from "@/lib/db/prisma";
import type { BudgetUpdateRequest } from "@/lib/api/schemas/budgets";

const WEEKS_PER_MONTH = 5;
const ZERO = new Prisma.Decimal(0);
/** A 5-week upsert/delete plus a protein upsert/delete outruns Prisma's 5s interactive default. */
const WRITE_TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 5_000 };

export interface WeekBudgetDto {
  week: number;
  budgetAmount: string | null;
  spentAmount: string;
  /** `null` when no budget is set for this week — there's nothing to be "remaining" against. */
  remaining: string | null;
}

export interface ProteinBudgetDto {
  budgetAmount: string | null;
  spentAmount: string;
  remaining: string | null;
}

export interface MonthBudgetDto {
  /** Σ(week budgetAmount), but **only** when every week (1-5) has one set — see the note on
   *  `consolidateMonthBudget`. `null` otherwise, including when nothing at all is budgeted. */
  budgetAmount: string | null;
  /** Actual cash out for the month: Σ(COALESCE(order.actualPaid, order.total)) across every order,
   *  every week — not the item-based `MonthSummary.totalAmount` shown elsewhere on the page, which
   *  excludes tax/discount and can't reflect `actualPaid` (it's an order-level fact, not
   *  distributable to individual items). Protein spend is included here, same as it's included in
   *  any single week's `spentAmount` — it's still cash that left the wallet that week. */
  spentAmount: string;
  remaining: string | null;
}

export interface BudgetSummary {
  weeks: WeekBudgetDto[];
  protein: ProteinBudgetDto;
  month: MonthBudgetDto;
}

interface WeekActualRow {
  periodWeek: number;
  // Not guaranteed to already be a `Prisma.Decimal` instance off the wire — normalized through
  // `new Prisma.Decimal(...)` below rather than trusted as one (CLAUDE.md rule 1: a driver/adapter
  // change that started returning a plain `number` here must not quietly ship float-rounded money).
  total: Prisma.Decimal | string | number;
}

/** Live query over `Order`, not a materialized summary — mirrors how `getMonthSummary` already
 *  counts orders live (PROJECT_SPEC.md §12 only forbids scanning `OrderItem` at request time). Not
 *  filtered to `periodWeek` 1-5: the column carries no DB check constraint, so an out-of-range row
 *  (there shouldn't be one — `periodWeekSchema` guards every write path) still counts toward the
 *  month total rather than silently vanishing from it. */
async function getWeeklyActualSpend(
  userId: string,
  periodMonth: Date,
): Promise<Map<number, Prisma.Decimal>> {
  const rows = await prisma.$queryRaw<WeekActualRow[]>`
    SELECT o."periodWeek"                          AS "periodWeek",
           SUM(COALESCE(o."actualPaid", o."total")) AS "total"
    FROM "Order" o
    WHERE o."userId" = ${userId} AND o."periodMonth" = ${periodMonth}
    GROUP BY o."periodWeek"
  `;
  return new Map(rows.map((row) => [row.periodWeek, new Prisma.Decimal(row.total)]));
}

function remainingOf(
  budgetAmount: Prisma.Decimal | null,
  spentAmount: Prisma.Decimal,
): string | null {
  return budgetAmount === null ? null : budgetAmount.sub(spentAmount).toFixed(2);
}

/**
 * Reads the user's budget targets for one month plus what's actually been spent against them —
 * embedded into `GET /analytics/month/:month` (see `analytics.ts`) alongside the existing
 * category/week/protein breakdown. Protein's `spentAmount` reuses `ProteinMonthlySummary` (the
 * same item-based figure shown in `MonthSummary.protein`) — protein items don't carry their own
 * `actualPaid`, so there's no principled way to apply an order-level override to just the protein
 * slice of an order.
 *
 * `proteinSpentAmount`, when the caller already has it (`getMonthSummary` fetches
 * `ProteinMonthlySummary` for its own `protein` field anyway), skips this function's own lookup of
 * the same row — pass it whenever available; `GET /budgets/:month` has no other reason to read
 * that table, so it's left to fetch it itself.
 */
export async function getBudgetSummary(
  userId: string,
  periodMonth: Date,
  proteinSpentAmount?: Prisma.Decimal,
): Promise<BudgetSummary> {
  const [weekBudgetRows, proteinBudgetRow, proteinSpentRow, weeklyActualSpend] = await Promise.all([
    prisma.weeklyBudget.findMany({ where: { userId, periodMonth } }),
    prisma.proteinBudget.findUnique({ where: { userId_periodMonth: { userId, periodMonth } } }),
    proteinSpentAmount !== undefined
      ? Promise.resolve(null)
      : prisma.proteinMonthlySummary.findUnique({
          where: { userId_periodMonth: { userId, periodMonth } },
        }),
    getWeeklyActualSpend(userId, periodMonth),
  ]);

  // Filtered to 1-5 (unlike `getWeeklyActualSpend`'s deliberately-unfiltered spend map — see its
  // own doc comment) so `consolidateMonthBudget`'s "every week 1-5 has a budget" guard and its sum
  // can never disagree about which rows count. A `WeeklyBudget` row outside 1-5 shouldn't exist —
  // `periodWeekSchema` guards every write path — but this keeps the two in lockstep regardless.
  const budgetByWeek = new Map(
    weekBudgetRows
      .filter((row) => row.periodWeek >= 1 && row.periodWeek <= WEEKS_PER_MONTH)
      .map((row) => [row.periodWeek, row.amount]),
  );
  const weeks: WeekBudgetDto[] = Array.from({ length: WEEKS_PER_MONTH }, (_, index) => {
    const week = index + 1;
    const budgetAmount = budgetByWeek.get(week) ?? null;
    const spentAmount = weeklyActualSpend.get(week) ?? ZERO;
    return {
      week,
      budgetAmount: budgetAmount?.toFixed(2) ?? null,
      spentAmount: spentAmount.toFixed(2),
      remaining: remainingOf(budgetAmount, spentAmount),
    };
  });

  const proteinBudgetAmount = proteinBudgetRow?.amount ?? null;
  const proteinSpent = proteinSpentAmount ?? proteinSpentRow?.totalAmount ?? ZERO;
  const protein: ProteinBudgetDto = {
    budgetAmount: proteinBudgetAmount?.toFixed(2) ?? null,
    spentAmount: proteinSpent.toFixed(2),
    remaining: remainingOf(proteinBudgetAmount, proteinSpent),
  };

  const monthBudgetAmount = consolidateMonthBudget(weeks, budgetByWeek);
  const monthSpentAmount = Array.from(weeklyActualSpend.values()).reduce(
    (sum, amount) => sum.add(amount),
    ZERO,
  );
  const month: MonthBudgetDto = {
    budgetAmount: monthBudgetAmount?.toFixed(2) ?? null,
    spentAmount: monthSpentAmount.toFixed(2),
    remaining: remainingOf(monthBudgetAmount, monthSpentAmount),
  };

  return { weeks, protein, month };
}

/**
 * Σ(week budgets) — deliberately **excludes** the protein budget, even though the product ask was
 * "the sum of all budgets." Protein isn't separate money: every protein purchase is already inside
 * whichever week's order it was bought in, so `spentAmount` never double-counts it — folding
 * `proteinBudget` into this total on top of the week budgets would size the target for money that
 * isn't there, silently inflating `remaining` by the whole protein budget. Protein stays visible as
 * its own line (`BudgetSummary.protein`) instead — a second, overlapping lens on the same cash, not
 * an addition to it.
 *
 * Also `null` unless **every** week (1-5) has a budget set: a partial target (say, only week 1)
 * compared against the whole month's spend would read as "over/under budget" against money three
 * other weeks never had a target for — not a number worth showing at all.
 */
function consolidateMonthBudget(
  weeks: WeekBudgetDto[],
  budgetByWeek: Map<number, Prisma.Decimal>,
): Prisma.Decimal | null {
  if (!weeks.every((week) => week.budgetAmount !== null)) {
    return null;
  }
  return Array.from(budgetByWeek.values()).reduce((sum, amount) => sum.add(amount), ZERO);
}

/**
 * Upserts the given weeks' budgets and/or sets/clears the protein budget for one month — a partial
 * update by design (`BudgetUpdateRequestSchema`): the Budgets screen can save one week or the
 * protein figure without restating the rest. A week's own `amount: null` deletes that week's
 * budget (back to unset), same convention as `protein: null`.
 */
export async function upsertBudgets(
  userId: string,
  periodMonth: Date,
  input: BudgetUpdateRequest,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const week of input.weeks ?? []) {
      if (week.amount === null) {
        await tx.weeklyBudget.deleteMany({
          where: { userId, periodMonth, periodWeek: week.week },
        });
        continue;
      }
      await tx.weeklyBudget.upsert({
        where: { userId_periodMonth_periodWeek: { userId, periodMonth, periodWeek: week.week } },
        create: { userId, periodMonth, periodWeek: week.week, amount: week.amount },
        update: { amount: week.amount },
      });
    }

    if (input.protein === null) {
      await tx.proteinBudget.deleteMany({ where: { userId, periodMonth } });
    } else if (input.protein !== undefined) {
      await tx.proteinBudget.upsert({
        where: { userId_periodMonth: { userId, periodMonth } },
        create: { userId, periodMonth, amount: input.protein },
        update: { amount: input.protein },
      });
    }
  }, WRITE_TRANSACTION_OPTIONS);
}
