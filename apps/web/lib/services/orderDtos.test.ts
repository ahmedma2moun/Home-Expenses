import { describe, expect, it } from "vitest";
import { toCategoryOrderGroup, toOrderDto, toOrderItemDto, toOrderSummary } from "./orderDtos";

/** Stands in for a Prisma `Decimal` column — only the accessors these DTOs actually call. */
function decimal(value: string) {
  return { toFixed: () => value, toNumber: () => Number(value) };
}

const JULY = new Date(Date.UTC(2026, 6, 1));

function orderWithItems(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    receiptId: "receipt-1",
    merchant: "Carrefour",
    periodMonth: JULY,
    currency: "EGP",
    subtotal: decimal("120.00"),
    tax: decimal("0.00"),
    discount: decimal("0.00"),
    total: decimal("120.00"),
    notes: null,
    source: "receipt",
    createdAt: new Date("2026-07-14T19:00:00.000Z"),
    updatedAt: new Date("2026-07-14T19:00:00.000Z"),
    items: [],
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    name: "Milk",
    quantity: decimal("2"),
    unit: "L",
    unitPrice: decimal("60.00"),
    lineTotal: decimal("120.00"),
    categoryId: "dairy_eggs",
    aiCategoryId: "pantry",
    position: 0,
    ...overrides,
  };
}

describe("toOrderItemDto", () => {
  it("serializes money as two-decimal strings and quantity as a number", () => {
    const dto = toOrderItemDto(item() as never);

    expect(dto).toEqual({
      id: "item-1",
      name: "Milk",
      quantity: 2,
      unit: "L",
      unitPrice: "60.00",
      lineTotal: "120.00",
      categoryId: "dairy_eggs",
      aiCategoryId: "pantry",
      position: 0,
    });
  });

  // unitPrice is nullable (BR-2: the model can fail to read it); lineTotal never is.
  it("passes through a null unitPrice rather than throwing", () => {
    const dto = toOrderItemDto(item({ unitPrice: null }) as never);

    expect(dto.unitPrice).toBeNull();
    expect(dto.lineTotal).toBe("120.00");
  });
});

describe("toOrderSummary", () => {
  it("formats the period month and counts items from _count", () => {
    const dto = toOrderSummary(orderWithItems({ _count: { items: 4 } }) as never);

    expect(dto).toMatchObject({
      id: "order-1",
      periodMonth: "2026-07",
      total: "120.00",
      itemCount: 4,
    });
  });
});

describe("toOrderDto", () => {
  it("includes every money field as a two-decimal string and counts items from the array", () => {
    const dto = toOrderDto(orderWithItems({ items: [item(), item({ id: "item-2" })] }) as never);

    expect(dto).toMatchObject({
      subtotal: "120.00",
      tax: "0.00",
      discount: "0.00",
      total: "120.00",
      itemCount: 2,
      notes: null,
    });
    expect(dto.items).toHaveLength(2);
  });
});

describe("toCategoryOrderGroup", () => {
  it("carries the order's merchant/currency alongside its (pre-filtered) items", () => {
    const group = toCategoryOrderGroup(
      orderWithItems({ items: [item({ categoryId: "dairy_eggs" })] }) as never,
    );

    expect(group).toMatchObject({
      orderId: "order-1",
      merchant: "Carrefour",
      currency: "EGP",
    });
    expect(group.items).toHaveLength(1);
  });
});
