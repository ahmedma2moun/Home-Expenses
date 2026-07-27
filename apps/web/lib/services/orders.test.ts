import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmReceiptRequestSchema } from "@/lib/api/schemas/receipts";

const receiptFindFirst = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderFindUnique = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const orderCreate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const receiptUpdate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const overrideCreateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    receipt: { findFirst: (...args: unknown[]) => receiptFindFirst(...args) },
    order: { findUnique: (...args: unknown[]) => orderFindUnique(...args) },
    $transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({
        order: { create: (...args: unknown[]) => orderCreate(...args) },
        receipt: { update: (...args: unknown[]) => receiptUpdate(...args) },
        itemCategoryOverride: { createMany: (...args: unknown[]) => overrideCreateMany(...args) },
      }),
  },
}));

const recomputeMonthlySummary = vi.fn<(...args: unknown[]) => Promise<void>>();
const invalidateMonthComparisons = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock("@/lib/services/monthlySummary", () => ({
  recomputeMonthlySummary: (...args: unknown[]) => recomputeMonthlySummary(...args),
  invalidateMonthComparisons: (...args: unknown[]) => invalidateMonthComparisons(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("confirmReceipt", () => {
  // BR-4: the user chooses the accounting month freely — a future periodMonth must create the
  // order and recompute that future month's summary, exactly like a past or current month.
  it("creates the order and recomputes the summary for a future periodMonth", async () => {
    receiptFindFirst.mockResolvedValue({ id: "receipt-1", status: "PARSED" });
    orderCreate.mockResolvedValue({ id: "order-1" });
    receiptUpdate.mockResolvedValue({});

    const input = ConfirmReceiptRequestSchema.parse({
      merchant: "Carrefour",
      purchasedAt: null,
      periodMonth: "2099-12",
      currency: "EGP",
      subtotal: "120.00",
      total: "120.00",
      items: [
        { name: "Milk", quantity: 2, lineTotal: "120.00", categoryId: "groceries", position: 0 },
      ],
    });

    const { confirmReceipt } = await import("./orders");
    const result = await confirmReceipt("user-1", "receipt-1", input);

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
});
