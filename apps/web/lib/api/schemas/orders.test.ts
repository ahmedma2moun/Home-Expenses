import { describe, expect, it } from "vitest";
import {
  OrderItemsByCategoryQuerySchema,
  OrderListQuerySchema,
  OrderUpdateRequestSchema,
} from "./orders";

const item = {
  name: "Milk",
  quantity: 2,
  lineTotal: "120.00",
  categoryId: "dairy_eggs",
  position: 0,
};

describe("OrderListQuerySchema", () => {
  it("defaults the page size when no limit is given", () => {
    const result = OrderListQuerySchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.month).toBeUndefined();
  });

  it("coerces the limit from the query string", () => {
    expect(OrderListQuerySchema.parse({ limit: "10" }).limit).toBe(10);
  });

  it("rejects a page size above the cap", () => {
    expect(OrderListQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("rejects a malformed month", () => {
    expect(OrderListQuerySchema.safeParse({ month: "2026-13" }).success).toBe(false);
  });
});

describe("OrderItemsByCategoryQuerySchema", () => {
  it("accepts a valid month and a known category slug", () => {
    const result = OrderItemsByCategoryQuerySchema.parse({
      month: "2026-07",
      categoryId: "dairy_eggs",
    });
    expect(result).toEqual({ month: "2026-07", categoryId: "dairy_eggs" });
  });

  // Unlike OrderListQuerySchema, month is required — this reads OrderItem rows directly, so an
  // unscoped scan across every month is not on offer.
  it("rejects a missing month", () => {
    expect(OrderItemsByCategoryQuerySchema.safeParse({ categoryId: "dairy_eggs" }).success).toBe(
      false,
    );
  });

  it("rejects a category slug that isn't in the taxonomy", () => {
    const result = OrderItemsByCategoryQuerySchema.safeParse({
      month: "2026-07",
      categoryId: "not-a-category",
    });
    expect(result.success).toBe(false);
  });
});

describe("OrderUpdateRequestSchema", () => {
  it("accepts a single-field edit", () => {
    const result = OrderUpdateRequestSchema.safeParse({ merchant: "Carrefour" });
    expect(result.success).toBe(true);
  });

  // An empty PATCH would otherwise take the write path — transaction, summary recompute, cache
  // invalidation — to change nothing at all.
  it("rejects an empty body", () => {
    expect(OrderUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it("distinguishes clearing the notes from leaving them alone", () => {
    const cleared = OrderUpdateRequestSchema.parse({ notes: null });
    expect(cleared.notes).toBeNull();
    expect(OrderUpdateRequestSchema.parse({ merchant: "Carrefour" }).notes).toBeUndefined();
  });

  // Replacing the lines without restating the totals would leave the order's stored total
  // disagreeing with the sum of its own items.
  it("requires subtotal and total when items are replaced", () => {
    const result = OrderUpdateRequestSchema.safeParse({ items: [item] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["total"]);
  });

  it("accepts replaced items alongside restated totals", () => {
    const result = OrderUpdateRequestSchema.safeParse({
      items: [item],
      subtotal: "120.00",
      total: "120.00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty item list", () => {
    const result = OrderUpdateRequestSchema.safeParse({
      items: [],
      subtotal: "0.00",
      total: "0.00",
    });
    expect(result.success).toBe(false);
  });

  // CLAUDE.md rule 1: money crosses the wire as a string, never a JSON number.
  it("rejects money sent as a number", () => {
    expect(OrderUpdateRequestSchema.safeParse({ total: 120 }).success).toBe(false);
    expect(OrderUpdateRequestSchema.safeParse({ total: "120" }).success).toBe(false);
  });

  // BR-4: the user owns the accounting month, including a future one.
  it("accepts a future period month", () => {
    expect(OrderUpdateRequestSchema.safeParse({ periodMonth: "2099-12" }).success).toBe(true);
  });
});
