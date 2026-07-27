import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/envelope";
import { OrderListQuerySchema, OrderUpdateRequestSchema } from "@/lib/api/schemas/orders";
import { UNKNOWN_MERCHANT } from "./orders";
import { deleteOrder, getOrder, listOrders, updateOrder } from "./orderManagement";

const orderFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderFindFirst = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderUpdate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderDelete = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderItemDeleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const receiptUpdateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const categoryFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
/** Records that a write actually opened a transaction, so guard clauses can prove they bailed. */
const transaction = vi.fn<() => void>();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    order: {
      findMany: (...args: unknown[]) => orderFindMany(...args),
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
    },
    category: { findMany: (...args: unknown[]) => categoryFindMany(...args) },
    $transaction: (run: (tx: unknown) => Promise<unknown>) => {
      transaction();
      return run({
        order: {
          update: (...args: unknown[]) => orderUpdate(...args),
          delete: (...args: unknown[]) => orderDelete(...args),
        },
        orderItem: { deleteMany: (...args: unknown[]) => orderItemDeleteMany(...args) },
        receipt: { updateMany: (...args: unknown[]) => receiptUpdateMany(...args) },
      });
    },
  },
  Prisma: {},
}));

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

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    receiptId: null,
    merchant: "Carrefour",
    purchasedAt: new Date("2026-07-14T18:32:00.000Z"),
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
    categoryFindMany.mockResolvedValue([{ id: "dairy_eggs" }]);

    await updateOrder(
      "user-1",
      "order-1",
      updateInput({
        subtotal: "60.00",
        total: "60.00",
        items: [
          { name: "Milk", quantity: 1, lineTotal: "60.00", categoryId: "dairy_eggs", position: 0 },
        ],
      }),
    );

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
  it("rejects an unknown category before touching the order", async () => {
    arrangeExistingOrder();
    categoryFindMany.mockResolvedValue([]);

    const failure = updateOrder(
      "user-1",
      "order-1",
      updateInput({
        subtotal: "60.00",
        total: "60.00",
        items: [
          { name: "Milk", quantity: 1, lineTotal: "60.00", categoryId: "not_a_slug", position: 0 },
        ],
      }),
    );

    await expect(failure).rejects.toBeInstanceOf(AppError);
    await expect(failure).rejects.toMatchObject({
      httpStatus: 400,
      details: { issues: [{ path: "items.0.categoryId" }] },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("raises a 404 for another user's order without opening a transaction", async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(
      updateOrder("user-1", "order-1", updateInput({ merchant: "Metro" })),
    ).rejects.toMatchObject({ httpStatus: 404 });
    expect(transaction).not.toHaveBeenCalled();
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

  it("raises a 404 for another user's order without opening a transaction", async () => {
    orderFindFirst.mockResolvedValue(null);

    await expect(deleteOrder("user-1", "order-1")).rejects.toMatchObject({ httpStatus: 404 });
    expect(transaction).not.toHaveBeenCalled();
  });
});
