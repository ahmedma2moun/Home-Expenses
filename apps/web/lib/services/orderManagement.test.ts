import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/envelope";
import { OrderListQuerySchema, OrderUpdateRequestSchema } from "@/lib/api/schemas/orders";
import { UNKNOWN_MERCHANT } from "./orders";
import { deleteOrder, getOrder, listOrders, updateOrder } from "./orderManagement";

const orderFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderFindFirst = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderUpdate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderDelete = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderItemFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderItemDeleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const receiptUpdateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const categoryFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const overrideCreateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
/** Records that a write actually opened a transaction, so guard clauses can prove they bailed. */
const transaction = vi.fn<() => void>();

// One set of doubles serves both `prisma.x` and `tx.x`: which client a call went through is not
// what these tests assert — the `where` clauses are. Built inside the factory because `vi.mock`
// is hoisted above every top-level binding.
vi.mock("@/lib/db/prisma", () => {
  const client = {
    order: {
      findMany: (...args: unknown[]) => orderFindMany(...args),
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
      update: (...args: unknown[]) => orderUpdate(...args),
      delete: (...args: unknown[]) => orderDelete(...args),
    },
    orderItem: {
      findMany: (...args: unknown[]) => orderItemFindMany(...args),
      deleteMany: (...args: unknown[]) => orderItemDeleteMany(...args),
    },
    receipt: { updateMany: (...args: unknown[]) => receiptUpdateMany(...args) },
    category: { findMany: (...args: unknown[]) => categoryFindMany(...args) },
    itemCategoryOverride: { createMany: (...args: unknown[]) => overrideCreateMany(...args) },
  };

  return {
    prisma: {
      ...client,
      $transaction: (run: (tx: unknown) => Promise<unknown>) => {
        transaction();
        return run(client);
      },
    },
    Prisma: {},
  };
});

const recomputeMonthlySummary = vi.fn<(...args: unknown[]) => Promise<void>>();
const invalidateMonthComparisons = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock("@/lib/services/monthlySummary", () => ({
  recomputeMonthlySummary: (...args: unknown[]) => recomputeMonthlySummary(...args),
  invalidateMonthComparisons: (...args: unknown[]) => invalidateMonthComparisons(...args),
}));

/** Stands in for a Prisma `Decimal` column — only the two accessors the serializers call. */
function decimal(value: string) {
  return { toFixed: () => value, toNumber: () => Number(value) };
}

const JULY = new Date(Date.UTC(2026, 6, 1));
const AUGUST = new Date(Date.UTC(2026, 7, 1));
const PURCHASED_AT = new Date("2026-07-14T18:32:00.000Z");

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    receiptId: null,
    merchant: "Carrefour",
    purchasedAt: PURCHASED_AT,
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

function itemRow(overrides: Record<string, unknown> = {}) {
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

function updateInput(overrides: Record<string, unknown>) {
  return OrderUpdateRequestSchema.parse(overrides);
}

function itemsInput(overrides: Record<string, unknown> = {}) {
  return {
    subtotal: "60.00",
    total: "60.00",
    items: [
      {
        name: "Milk",
        quantity: 1,
        lineTotal: "60.00",
        categoryId: "dairy_eggs",
        position: 0,
        ...overrides,
      },
    ],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("listOrders", () => {
  it("scopes the query to the user and the requested month", async () => {
    orderFindMany.mockResolvedValue([]);

    await listOrders("user-1", OrderListQuerySchema.parse({ month: "2026-07" }));

    expect(orderFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: "user-1", periodMonth: JULY },
    });
  });

  it("lists every month when none is given", async () => {
    orderFindMany.mockResolvedValue([]);

    await listOrders("user-1", OrderListQuerySchema.parse({}));

    const where = (orderFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ userId: "user-1" });
  });

  // The extra row is the lookahead that proves another page exists — it must not be served.
  it("returns a cursor only when a further page exists", async () => {
    orderFindMany.mockResolvedValue([
      { ...orderRow({ id: "order-1" }), _count: { items: 3 } },
      { ...orderRow({ id: "order-2" }), _count: { items: 1 } },
    ]);

    const page = await listOrders("user-1", OrderListQuerySchema.parse({ limit: "1" }));

    expect(page.orders.map((order) => order.id)).toEqual(["order-1"]);
    expect(page.nextCursor).toBe("order-1");
  });

  it("returns no cursor on the last page", async () => {
    orderFindMany.mockResolvedValue([{ ...orderRow(), _count: { items: 3 } }]);

    const page = await listOrders("user-1", OrderListQuerySchema.parse({ limit: "10" }));

    expect(page.nextCursor).toBeNull();
    expect(page.orders[0]).toMatchObject({
      periodMonth: "2026-07",
      total: "120.00",
      itemCount: 3,
    });
  });

  // Prisma's own `cursor` would resolve the anchor by primary key alone, letting another user's
  // order id position this user's page.
  it("resolves the cursor row within the caller's own orders", async () => {
    orderFindFirst.mockResolvedValue({ id: "order-9", purchasedAt: PURCHASED_AT });
    orderFindMany.mockResolvedValue([]);

    await listOrders("user-1", OrderListQuerySchema.parse({ cursor: "order-9" }));

    expect(orderFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "order-9", userId: "user-1" },
    });
  });

  it("rejects a cursor that isn't the caller's own order", async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(
      listOrders("user-1", OrderListQuerySchema.parse({ cursor: "someone-elses" })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    expect(orderFindMany).not.toHaveBeenCalled();
  });

  it("pages past a dated cursor with a keyset predicate, not a NULL comparison", async () => {
    orderFindFirst.mockResolvedValue({ id: "order-9", purchasedAt: PURCHASED_AT });
    orderFindMany.mockResolvedValue([]);

    await listOrders("user-1", OrderListQuerySchema.parse({ cursor: "order-9" }));

    expect(orderFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        OR: [
          { purchasedAt: { lt: PURCHASED_AT } },
          { purchasedAt: null },
          { purchasedAt: PURCHASED_AT, id: { lt: "order-9" } },
        ],
      },
    });
  });

  // The date-less block sorts last, so paging from inside it stays inside it. Prisma's cursor
  // compared against NULL here and silently returned nothing.
  it("keeps paging through date-less orders", async () => {
    orderFindFirst.mockResolvedValue({ id: "order-9", purchasedAt: null });
    orderFindMany.mockResolvedValue([]);

    await listOrders("user-1", OrderListQuerySchema.parse({ cursor: "order-9" }));

    expect(orderFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { OR: [{ purchasedAt: null, id: { lt: "order-9" } }] },
    });
  });
});

describe("getOrder", () => {
  it("scopes the lookup by userId and serializes money as strings", async () => {
    orderFindFirst.mockResolvedValue(orderRow({ items: [itemRow()] }));

    const order = await getOrder("user-1", "order-1");

    expect(orderFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "order-1", userId: "user-1" },
    });
    expect(order.total).toBe("120.00");
    expect(order.items[0]).toMatchObject({ lineTotal: "120.00", unitPrice: "60.00", quantity: 2 });
  });

  // Another user's order is indistinguishable from one that doesn't exist (docs/api.md).
  it("raises a 404, not a 403, when the order isn't the caller's", async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(getOrder("user-1", "order-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("updateOrder", () => {
  function arrangeExistingOrder(periodMonth = JULY) {
    orderFindFirst.mockResolvedValue({ periodMonth });
    orderUpdate.mockResolvedValue(orderRow({ periodMonth }));
    orderItemFindMany.mockResolvedValue([]);
    categoryFindMany.mockResolvedValue([{ id: "dairy_eggs" }]);
  }

  it("patches only the fields the client sent", async () => {
    arrangeExistingOrder();

    await updateOrder("user-1", "order-1", updateInput({ merchant: "Metro" }));

    const call = orderUpdate.mock.calls[0]?.[0] as {
      where: unknown;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: "order-1", userId: "user-1" });
    expect(call.data).toEqual({ merchant: "Metro" });
  });

  it("substitutes the placeholder when the merchant is blanked", async () => {
    arrangeExistingOrder();

    await updateOrder("user-1", "order-1", updateInput({ merchant: "" }));

    expect(orderUpdate.mock.calls[0]?.[0]).toMatchObject({
      data: { merchant: UNKNOWN_MERCHANT },
    });
  });

  // §12: moving an order leaves the month it came from as wrong as the one it went to.
  it("recomputes both months when the order moves", async () => {
    arrangeExistingOrder(JULY);

    await updateOrder("user-1", "order-1", updateInput({ periodMonth: "2026-08" }));

    expect(recomputeMonthlySummary).toHaveBeenCalledWith(expect.anything(), "user-1", JULY);
    expect(recomputeMonthlySummary).toHaveBeenCalledWith(expect.anything(), "user-1", AUGUST);
    expect(invalidateMonthComparisons).toHaveBeenCalledWith(expect.anything(), "user-1", [
      JULY,
      AUGUST,
    ]);
  });

  it("recomputes one month when the period is restated unchanged", async () => {
    arrangeExistingOrder(JULY);

    await updateOrder("user-1", "order-1", updateInput({ periodMonth: "2026-07" }));

    expect(recomputeMonthlySummary).toHaveBeenCalledTimes(1);
    expect(invalidateMonthComparisons).toHaveBeenCalledWith(expect.anything(), "user-1", [JULY]);
  });

  it("replaces the line items through the order's own user scope", async () => {
    arrangeExistingOrder();

    await updateOrder("user-1", "order-1", updateInput(itemsInput()));

    expect(orderItemDeleteMany.mock.calls[0]?.[0]).toEqual({
      where: { orderId: "order-1", order: { userId: "user-1" } },
    });
    expect(orderUpdate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        items: {
          create: [
            expect.objectContaining({
              name: "Milk",
              normalizedName: "milk",
              lineTotal: "60.00",
              category: { connect: { id: "dairy_eggs" } },
            }),
          ],
        },
      },
    });
  });

  // A bad slug is a foreign-key violation, which would reach the client as an opaque 500.
  it("rejects an unknown category before deleting anything", async () => {
    arrangeExistingOrder();
    categoryFindMany.mockResolvedValue([]);

    const failure = updateOrder(
      "user-1",
      "order-1",
      updateInput(itemsInput({ categoryId: "not_a_slug" })),
    );

    await expect(failure).rejects.toBeInstanceOf(AppError);
    await expect(failure).rejects.toMatchObject({
      httpStatus: 400,
      details: { issues: [{ path: "items.0.categoryId" }] },
    });
    expect(orderItemDeleteMany).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  // A retired slug is no longer offered by GET /categories, so nothing legitimate still sends one.
  it("only accepts categories that are still active", async () => {
    arrangeExistingOrder();

    await updateOrder("user-1", "order-1", updateInput(itemsInput()));

    expect(categoryFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: { in: ["dairy_eggs"] }, isActive: true },
    });
  });

  // §11: the edit screen is the same correction signal as the review screen.
  it("records a re-categorization for the learning loop", async () => {
    arrangeExistingOrder();
    orderItemFindMany.mockResolvedValue([{ position: 0, categoryId: "pantry" }]);

    await updateOrder("user-1", "order-1", updateInput(itemsInput({ aiCategoryId: "pantry" })));

    expect(overrideCreateMany.mock.calls[0]?.[0]).toMatchObject({
      data: [
        {
          userId: "user-1",
          merchant: "Carrefour",
          itemName: "Milk",
          aiCategoryId: "pantry",
          finalCategoryId: "dairy_eggs",
        },
      ],
    });
  });

  // Re-saving an unchanged order would otherwise file the same correction on every PATCH.
  it("doesn't re-record a correction the user already made", async () => {
    arrangeExistingOrder();
    orderItemFindMany.mockResolvedValue([{ position: 0, categoryId: "dairy_eggs" }]);

    await updateOrder("user-1", "order-1", updateInput(itemsInput({ aiCategoryId: "pantry" })));

    expect(overrideCreateMany).not.toHaveBeenCalled();
  });

  it("raises a 404 for another user's order without writing", async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(
      updateOrder("user-1", "order-1", updateInput({ merchant: "Metro" })),
    ).rejects.toMatchObject({ httpStatus: 404 });
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  // The ownership read has to see the same snapshot as the write, or a concurrent move leaves the
  // month the order came from stale.
  it("establishes ownership inside the write transaction", async () => {
    arrangeExistingOrder();

    await updateOrder("user-1", "order-1", updateInput({ merchant: "Metro" }));

    expect(transaction).toHaveBeenCalled();
    expect(orderFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "order-1", userId: "user-1" },
    });
  });
});

describe("deleteOrder", () => {
  it("deletes within the user's scope and recomputes that month", async () => {
    orderFindFirst.mockResolvedValue({ periodMonth: JULY, receiptId: null });

    const result = await deleteOrder("user-1", "order-1");

    expect(result).toEqual({ id: "order-1" });
    expect(orderDelete.mock.calls[0]?.[0]).toEqual({ where: { id: "order-1", userId: "user-1" } });
    expect(recomputeMonthlySummary).toHaveBeenCalledWith(expect.anything(), "user-1", JULY);
    expect(invalidateMonthComparisons).toHaveBeenCalledWith(expect.anything(), "user-1", [JULY]);
  });

  // Order.receiptId is unique: a receipt left at CONFIRMED could never yield an order again.
  it("releases the source receipt back to PARSED", async () => {
    orderFindFirst.mockResolvedValue({ periodMonth: JULY, receiptId: "receipt-1" });

    await deleteOrder("user-1", "order-1");

    expect(receiptUpdateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: "receipt-1", userId: "user-1" },
      data: { status: "PARSED" },
    });
  });

  it("leaves receipts alone for a manually entered order", async () => {
    orderFindFirst.mockResolvedValue({ periodMonth: JULY, receiptId: null });

    await deleteOrder("user-1", "order-1");

    expect(receiptUpdateMany).not.toHaveBeenCalled();
  });

  it("raises a 404 for another user's order without deleting", async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(deleteOrder("user-1", "order-1")).rejects.toMatchObject({ httpStatus: 404 });
    expect(orderDelete).not.toHaveBeenCalled();
  });
});
