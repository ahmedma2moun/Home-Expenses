import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/envelope";
import { OrderUpdateRequestSchema } from "@/lib/api/schemas/orders";
import { UNKNOWN_MERCHANT } from "./orders";
import { deleteOrder, updateOrder } from "./orderManagement";

const orderFindFirst = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderUpdate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderDelete = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderItemFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderItemDeleteMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const receiptUpdateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const categoryFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const overrideCreateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const userFindUnique = vi.fn<(...args: unknown[]) => Promise<unknown>>();
/** Records that a write actually opened a transaction, so guard clauses can prove they bailed. */
const transaction = vi.fn<() => void>();

// One set of doubles serves both `prisma.x` and `tx.x`: which client a call went through is not
// what these tests assert — the `where` clauses are. Built inside the factory because `vi.mock`
// is hoisted above every top-level binding.
vi.mock("@/lib/db/prisma", () => {
  const client = {
    order: {
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
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
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

describe("updateOrder", () => {
  function arrangeExistingOrder(periodMonth = JULY) {
    orderFindFirst.mockResolvedValue({ periodMonth });
    orderUpdate.mockResolvedValue(orderRow({ periodMonth }));
    orderItemFindMany.mockResolvedValue([]);
    categoryFindMany.mockResolvedValue([{ id: "dairy_eggs" }]);
    userFindUnique.mockResolvedValue({ currency: "EGP" });
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

  // A retired-but-still-a-real-slug category is a foreign-key violation, which would reach the
  // client as an opaque 500 — this is the service-level guard, distinct from the schema-level
  // `z.enum` rejection of a slug that was never a real category at all.
  it("rejects a retired category before deleting anything", async () => {
    arrangeExistingOrder();
    categoryFindMany.mockResolvedValue([]);

    const failure = updateOrder(
      "user-1",
      "order-1",
      updateInput(itemsInput({ categoryId: "clothing" })),
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

  it("rejects a currency that doesn't match the account's configured currency", async () => {
    arrangeExistingOrder();
    userFindUnique.mockResolvedValue({ currency: "EGP" });

    const failure = updateOrder("user-1", "order-1", updateInput({ currency: "USD" }));

    await expect(failure).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    expect(orderUpdate).not.toHaveBeenCalled();
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
