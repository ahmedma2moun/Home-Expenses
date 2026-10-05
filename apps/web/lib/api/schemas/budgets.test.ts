import { describe, expect, it } from "vitest";
import { BudgetUpdateRequestSchema } from "./budgets";

describe("BudgetUpdateRequestSchema", () => {
  it.each([1, 6, 31])("accepts a standalone period count of %i", (periodCount) => {
    expect(BudgetUpdateRequestSchema.parse({ periodCount })).toEqual({ periodCount });
  });

  it.each([0, 32, -1, 1.5, "6", null])("rejects an invalid period count %s", (periodCount) => {
    expect(BudgetUpdateRequestSchema.safeParse({ periodCount }).success).toBe(false);
  });

  it("accepts budgets beyond the original five periods alongside the new count", () => {
    const request = { periodCount: 31, weeks: [{ week: 31, amount: "123.45" }] };

    expect(BudgetUpdateRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects duplicate period budgets", () => {
    const request = {
      periodCount: 6,
      weeks: [
        { week: 6, amount: "100.00" },
        { week: 6, amount: "200.00" },
      ],
    };

    expect(BudgetUpdateRequestSchema.safeParse(request).success).toBe(false);
  });

  it.each([0, 32])("rejects a period index of %i", (week) => {
    expect(
      BudgetUpdateRequestSchema.safeParse({ weeks: [{ week, amount: "100.00" }] }).success,
    ).toBe(false);
  });
});
