import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderItemsByCategoryQuerySchema, OrderListQuerySchema } from "@/lib/api/schemas/orders";
import { getOrder, listOrderItemsByCategory, listOrders } from "./orderQueries";

const orderFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderFindFirst = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    order: {
      findMany: (...args: unknown[]) => orderFindMany(...args),
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
    },
  },
  Prisma: {},
}));

/** Stands in for a Prisma `Decimal` column — only the two accessors the serializers call. */
function decimal(value: string) {
  return { toFixed: () => value, toNumber: () => Number(value) };
}

const JULY = new Date(Date.UTC(2026, 6, 1));
const CREATED_AT = new Date("2026-07-14T19:00:00.000Z");

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    receiptId: null,
    merchant: "Carrefour",
    periodMonth: JULY,
    currency: "EGP",
    subtotal: decimal("120.00"),
    tax: decimal("0.00"),
    discount: decimal("0.00"),
    total: decimal("120.00"),
    notes: null,
    source: "receipt",
    createdAt: CREATED_AT,
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

  it("sorts newest-created first, with id as the tiebreak", async () => {
    orderFindMany.mockResolvedValue([]);

    await listOrders("user-1", OrderListQuerySchema.parse({}));

    expect(orderFindMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
    orderFindFirst.mockResolvedValue({ id: "order-9", createdAt: CREATED_AT });
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

  it("pages past a cursor with a keyset predicate on createdAt", async () => {
    orderFindFirst.mockResolvedValue({ id: "order-9", createdAt: CREATED_AT });
    orderFindMany.mockResolvedValue([]);

    await listOrders("user-1", OrderListQuerySchema.parse({ cursor: "order-9" }));

    expect(orderFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        OR: [{ createdAt: { lt: CREATED_AT } }, { createdAt: CREATED_AT, id: { lt: "order-9" } }],
      },
    });
  });
});

describe("listOrderItemsByCategory", () => {
  it("scopes the query to the user, the month, and orders holding that category", async () => {
    orderFindMany.mockResolvedValue([]);

    await listOrderItemsByCategory(
      "user-1",
      OrderItemsByCategoryQuerySchema.parse({ month: "2026-07", categoryId: "dairy_eggs" }),
    );

    expect(orderFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        userId: "user-1",
        periodMonth: JULY,
        items: { some: { categoryId: "dairy_eggs" } },
      },
      include: { items: { where: { categoryId: "dairy_eggs" }, orderBy: { position: "asc" } } },
    });
  });

  // Items outside the requested category must not leak into another order's group just because
  // the order also holds a matching item.
  it("groups only the matching items under each order, newest order first", async () => {
    orderFindMany.mockResolvedValue([
      orderRow({
        id: "order-1",
        merchant: "Carrefour",
        items: [itemRow({ id: "item-1", categoryId: "dairy_eggs" })],
      }),
    ]);

    const page = await listOrderItemsByCategory(
      "user-1",
      OrderItemsByCategoryQuerySchema.parse({ month: "2026-07", categoryId: "dairy_eggs" }),
    );

    expect(page).toEqual({
      month: "2026-07",
      categoryId: "dairy_eggs",
      orders: [
        {
          orderId: "order-1",
          merchant: "Carrefour",
          createdAt: CREATED_AT.toISOString(),
          currency: "EGP",
          items: [
            {
              id: "item-1",
              name: "Milk",
              quantity: 2,
              unit: "L",
              unitPrice: "60.00",
              lineTotal: "120.00",
              categoryId: "dairy_eggs",
              aiCategoryId: "pantry",
              position: 0,
            },
          ],
        },
      ],
    });
  });

  it("rejects an unknown category slug rather than querying", () => {
    expect(() =>
      OrderItemsByCategoryQuerySchema.parse({ month: "2026-07", categoryId: "not-a-category" }),
    ).toThrow();
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
