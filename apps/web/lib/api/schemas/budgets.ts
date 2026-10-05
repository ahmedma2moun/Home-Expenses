import { z } from "zod";
import { nonNegativeMoneySchema, periodWeekSchema } from "@/lib/api/schemas/common";

/**
 * `PUT /budgets/:month` — sets some or all of a month's weekly budgets plus its protein budget in
 * one call (the Budgets screen edits a whole month at a time). Fields are independently optional:
 * an omitted `weeks`/`protein` leaves that budget untouched; a `protein` of `null` deletes it
 * (back to "no protein budget set" — same absent/null convention as `OrderUpdateRequestSchema`).
 * `weeks` entries not mentioned are left alone too — this is an upsert of the given weeks, not a
 * full replace of the month's configured periods; a week's own `amount: null` deletes just that week's budget,
 * same convention as `protein`.
 */
export const WeekBudgetInputSchema = z.object({
  week: periodWeekSchema,
  amount: nonNegativeMoneySchema.nullable(),
});
export type WeekBudgetInput = z.infer<typeof WeekBudgetInputSchema>;

export const BudgetUpdateRequestSchema = z
  .object({
    periodCount: z.number().int().min(1).max(31).optional(),
    weeks: z
      .array(WeekBudgetInputSchema)
      .min(1)
      .max(31)
      .refine((weeks) => new Set(weeks.map((week) => week.week)).size === weeks.length, {
        message: "Each week may appear at most once.",
      })
      .optional(),
    protein: nonNegativeMoneySchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.weeks !== undefined || input.protein !== undefined || input.periodCount !== undefined,
    {
      message: "Provide periods, protein, or a period count.",
    },
  );
export type BudgetUpdateRequest = z.infer<typeof BudgetUpdateRequestSchema>;
