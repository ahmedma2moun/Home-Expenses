import { prisma, Prisma } from "@/lib/db/prisma";
import type { BudgetUpdateRequest } from "@/lib/api/schemas/budgets";

import {
  getPeriodCount,
  lockMonthPeriods,
  assertPeriodInMonth,
  resizeMonthPeriods,
} from "@/lib/services/monthPeriods";
const ZERO = new Prisma.Decimal(0);
/** A 5-week upsert/delete plus a protein upsert/delete outruns Prisma's 5s interactive default. */
const WRITE_TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 5_000 };

export interface WeekBudgetDto {
  week: number;
  budgetAmount: string | null;
  /** Actual cash out for the week — `Σ(order.actualPaid ?? order.total)`, **excluding protein
   *  spend** (see `getWeeklyActualSpend`). Protein has its own separate budget/spend (`protein`
   *  below); a protein purchase counts there, not here, regardless of which week it fell in. */
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
  /** Σ(week budgetAmount) + protein budgetAmount, but the week sum only counts **once every week
   *  in the configured count has one set** — see the note on `consolidateMonthBudget`. `null` when that condition
   *  isn't met, including when nothing at all is budgeted. */
  budgetAmount: string | null;
  /** Σ(weeks[].spentAmount) + protein.spentAmount — actual cash out for the whole month. Adding
   *  the two is safe because they're now non-overlapping: `weeks[].spentAmount` excludes protein
   *  cash (see its own doc comment), so a protein purchase is counted here exactly once, via
   *  `protein.spentAmount`. Not the item-based `MonthSummary.totalAmount` shown elsewhere on the
   *  page, which excludes tax/discount and can't reflect `actualPaid` (an order-level fact, not
   *  distributable to individual items). */
  spentAmount: string;
  remaining: string | null;
}

export interface BudgetSummary {
  periodCount: number;
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

/**
 * Live query over `Order`/`OrderItem`, not a materialized summary — mirrors how `getMonthSummary`
 * already counts orders live (PROJECT_SPEC.md §12 only forbids scanning `OrderItem` at request
 * time). **Excludes protein spend**, same rule as `WeeklySummary` (`monthlySummary.ts`'s
 * `recomputeWeeklySummary`): protein has its own separate budget (`ProteinBudgetDto`), so a
 * protein purchase counts toward that and *not* toward the week it happened to fall in.
 *
 * The exclusion is applied per order — `SUM(COALESCE(actualPaid, total)) - (that order's protein
 * item total)` — then summed by week, rather than filtering `OrderItem` rows directly: `actualPaid`
 * is an order-level fact (tip, rounding, a register discount), so there's no principled per-item
 * price to sum in the first place. An order that's *entirely* protein still leaves a small residual
 * here equal to its tax/discount/tip — the same limitation `ProteinBudgetDto.spentAmount`'s own doc
 * comment already calls out for the reverse direction.
 *
 * Not filtered to the configured period count: the column carries no DB check constraint, so an out-of-range
 * row (there shouldn't be one — `periodWeekSchema` guards every write path) still counts toward the
 * month total rather than silently vanishing from it.
 */
async function getWeeklyActualSpend(
  userId: string,
  periodMonth: Date,
): Promise<Map<number, Prisma.Decimal>> {
  const rows = await prisma.$queryRaw<WeekActualRow[]>`
    SELECT o."periodWeek" AS "periodWeek",
           SUM(COALESCE(o."actualPaid", o."total") - COALESCE(protein."proteinTotal", 0)) AS "total"
    FROM "Order" o
    LEFT JOIN (
      SELECT oi."orderId" AS "orderId", SUM(oi."lineTotal") AS "proteinTotal"
      FROM "OrderItem" oi
      WHERE oi."isProtein" = true
      GROUP BY oi."orderId"
    ) protein ON protein."orderId" = o.id
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
  const periodCount = await getPeriodCount({ userId, periodMonth });
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

  // Only configured periods contribute targets; all spending still counts toward the month.
  const budgetByWeek = new Map(
    weekBudgetRows
      .filter((row) => row.periodWeek >= 1 && row.periodWeek <= periodCount)
      .map((row) => [row.periodWeek, row.amount]),
  );
  const weeks: WeekBudgetDto[] = Array.from({ length: periodCount }, (_, index) => {
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

  const monthBudgetAmount = consolidateMonthBudget(weeks, budgetByWeek, proteinBudgetAmount);
  const monthSpentAmount = Array.from(weeklyActualSpend.values())
    .reduce((sum, amount) => sum.add(amount), ZERO)
    .add(proteinSpent);
  const month: MonthBudgetDto = {
    budgetAmount: monthBudgetAmount?.toFixed(2) ?? null,
    spentAmount: monthSpentAmount.toFixed(2),
    remaining: remainingOf(monthBudgetAmount, monthSpentAmount),
  };

  return { periodCount, weeks, protein, month };
}

/**
 * Σ(week budgets) + protein budget — safe to add the two because `getWeeklyActualSpend` excludes
 * protein cash from `weeks[].spentAmount`, so `month.spentAmount` never double-counts a protein
 * purchase either; budget and spend stay on the same footing. (An earlier version of this function
 * excluded the protein budget here specifically because weekly spend *did* include protein cash
 * back then — that's no longer true, so the exclusion would now just be wrong in the other
 * direction: real protein spend with a real protein budget, silently missing from the total.)
 *
 * Still `null` unless **every** configured period has a budget set: a partial target (say, only week 1)
 * compared against the whole month's spend would read as "over/under budget" against money three
 * other weeks never had a target for — not a number worth showing at all. Protein has no such gate
 * of its own: an unset protein budget just contributes `0` to the total, which is correct — money
 * spent on protein with no target for it still reduces `remaining` against the weeks' targets.
 */
function consolidateMonthBudget(
  weeks: WeekBudgetDto[],
  budgetByWeek: Map<number, Prisma.Decimal>,
  proteinBudgetAmount: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (!weeks.every((week) => week.budgetAmount !== null)) {
    return null;
  }
  const weekTotal = Array.from(budgetByWeek.values()).reduce(
    (sum, amount) => sum.add(amount),
    ZERO,
  );
  return weekTotal.add(proteinBudgetAmount ?? ZERO);
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
    const scope = { userId, periodMonth };
    const currentCount = await lockMonthPeriods(tx, scope);
    const periodCount = input.periodCount ?? currentCount;
    for (const week of input.weeks ?? []) assertPeriodInMonth(week.week, periodCount);
    if (input.periodCount !== undefined && periodCount !== currentCount) {
      await resizeMonthPeriods(tx, scope, periodCount);
    }
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
