import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmReceiptRequestSchema } from "@/lib/api/schemas/receipts";
import { UNKNOWN_MERCHANT, confirmReceipt } from "./orders";

const receiptFindFirst = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderFindFirst = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderCreate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const receiptUpdateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const overrideCreateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const categoryFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const userFindUnique = vi.fn<(...args: unknown[]) => Promise<unknown>>();

/** Stands in for a Prisma P2002 unique-constraint violation without depending on its real shape. */
class FakeUniqueConstraintError extends Error {}

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    receipt: { findFirst: (...args: unknown[]) => receiptFindFirst(...args) },
    order: { findFirst: (...args: unknown[]) => orderFindFirst(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    $transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({
        order: { create: (...args: unknown[]) => orderCreate(...args) },
        receipt: { updateMany: (...args: unknown[]) => receiptUpdateMany(...args) },
        category: { findMany: (...args: unknown[]) => categoryFindMany(...args) },
        itemCategoryOverride: { createMany: (...args: unknown[]) => overrideCreateMany(...args) },
      }),
  },
  isUniqueConstraintViolation: (error: unknown) => error instanceof FakeUniqueConstraintError,
}));

const recomputeMonthlySummary = vi.fn<(...args: unknown[]) => Promise<void>>();
const invalidateMonthComparisons = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock("@/lib/services/monthlySummary", () => ({
  recomputeMonthlySummary: (...args: unknown[]) => recomputeMonthlySummary(...args),
  invalidateMonthComparisons: (...args: unknown[]) => invalidateMonthComparisons(...args),
}));

function confirmInput(overrides: Record<string, unknown> = {}) {
  return ConfirmReceiptRequestSchema.parse({
    merchant: "Carrefour",
    purchasedAt: null,
    periodMonth: "2026-07",
    currency: "EGP",
    subtotal: "120.00",
    total: "120.00",
    items: [
      { name: "Milk", quantity: 2, lineTotal: "120.00", categoryId: "dairy_eggs", position: 0 },
    ],
    ...overrides,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("confirmReceipt", () => {
  function arrangeConfirmableReceipt() {
    receiptFindFirst.mockResolvedValue({ id: "receipt-1", status: "PARSED" });
    orderCreate.mockResolvedValue({ id: "order-1" });
    receiptUpdateMany.mockResolvedValue({ count: 1 });
    userFindUnique.mockResolvedValue({ currency: "EGP" });
    categoryFindMany.mockResolvedValue([{ id: "dairy_eggs" }]);
  }

  // BR-4: the user chooses the accounting month freely — a future periodMonth must create the
  // order and recompute that future month's summary, exactly like a past or current month.
  it("creates the order and recomputes the summary for a future periodMonth", async () => {
    arrangeConfirmableReceipt();

    const result = await confirmReceipt(
      "user-1",
      "receipt-1",
      confirmInput({ periodMonth: "2099-12" }),
    );

    expect(result.orderId).toBe("order-1");

    const futureMonth = new Date(Date.UTC(2099, 11, 1));
    expect(orderCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { userId: "user-1", periodMonth: futureMonth },
    });
    expect(recomputeMonthlySummary).toHaveBeenCalledWith(expect.anything(), "user-1", futureMonth);
    expect(invalidateMonthComparisons).toHaveBeenCalledWith(expect.anything(), "user-1", [
      futureMonth,
    ]);
  });

  it("keeps the merchant the user supplied", async () => {
    arrangeConfirmableReceipt();

    await confirmReceipt("user-1", "receipt-1", confirmInput({ merchant: "  Carrefour  " }));

    expect(orderCreate.mock.calls[0]?.[0]).toMatchObject({ data: { merchant: "Carrefour" } });
  });

  // A receipt whose merchant was never legible must still produce an order rather than a 400.
  it("substitutes a placeholder when the merchant is blank", async () => {
    arrangeConfirmableReceipt();

    await confirmReceipt("user-1", "receipt-1", confirmInput({ merchant: "" }));

    expect(orderCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { merchant: UNKNOWN_MERCHANT },
    });
  });

  // The schema trims, but the service must not depend on that: a caller holding a structurally
  // valid request (a future manual-order path, a hand-built fixture) can still pass whitespace.
  it("substitutes a placeholder for a whitespace-only merchant the schema didn't trim", async () => {
    arrangeConfirmableReceipt();

    await confirmReceipt("user-1", "receipt-1", { ...confirmInput(), merchant: "   " });

    expect(orderCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { merchant: UNKNOWN_MERCHANT },
    });
  });

  it("scopes the idempotency lookup for a confirmed receipt by userId", async () => {
    receiptFindFirst.mockResolvedValue({ id: "receipt-1", status: "CONFIRMED" });
    orderFindFirst.mockResolvedValue({ id: "order-existing" });

    const result = await confirmReceipt("user-1", "receipt-1", confirmInput());

    expect(result.orderId).toBe("order-existing");
    expect(orderFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { receiptId: "receipt-1", userId: "user-1" },
    });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("uses the placeholder for the category-override learning key too", async () => {
    arrangeConfirmableReceipt();

    await confirmReceipt(
      "user-1",
      "receipt-1",
      confirmInput({
        merchant: "",
        items: [
          {
            name: "Milk",
            quantity: 2,
            lineTotal: "120.00",
            categoryId: "dairy_eggs",
            aiCategoryId: "pantry",
            position: 0,
          },
        ],
      }),
    );

    expect(overrideCreateMany.mock.calls[0]?.[0]).toMatchObject({
      data: [{ merchant: UNKNOWN_MERCHANT, itemName: "Milk", finalCategoryId: "dairy_eggs" }],
    });
  });

  it("rejects a currency that doesn't match the account's configured currency", async () => {
    arrangeConfirmableReceipt();
    userFindUnique.mockResolvedValue({ currency: "EGP" });

    const failure = confirmReceipt("user-1", "receipt-1", confirmInput({ currency: "USD" }));

    await expect(failure).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown category before creating the order", async () => {
    arrangeConfirmableReceipt();
    categoryFindMany.mockResolvedValue([]);

    const failure = confirmReceipt("user-1", "receipt-1", confirmInput());

    await expect(failure).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      httpStatus: 400,
      details: { issues: [{ path: "items.0.categoryId" }] },
    });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  // Two concurrent confirms of the same receipt both pass every check above and race into
  // order.create; the loser must get the winner's order back, not a 500 (§13 idempotency).
  it("returns the winner's order when two confirms race on Order.receiptId", async () => {
    arrangeConfirmableReceipt();
    orderCreate.mockRejectedValue(new FakeUniqueConstraintError("duplicate receiptId"));
    orderFindFirst.mockResolvedValue({ id: "order-from-the-winner" });

    const result = await confirmReceipt("user-1", "receipt-1", confirmInput());

    expect(result.orderId).toBe("order-from-the-winner");
    expect(orderFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { receiptId: "receipt-1", userId: "user-1" },
    });
  });
});
