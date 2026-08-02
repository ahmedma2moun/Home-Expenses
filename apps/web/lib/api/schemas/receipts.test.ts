import { describe, expect, it } from "vitest";
import { ConfirmReceiptRequestSchema } from "./receipts";

const confirmRequest = {
  merchant: "Carrefour",
  purchasedAt: "2026-07-26T18:32:00+02:00",
  periodMonth: "2026-07",
  currency: "EGP",
  subtotal: "120.00",
  tax: "0.00",
  discount: "0.00",
  total: "120.00",
  items: [
    {
      name: "Milk",
      quantity: 2,
      lineTotal: "120.00",
      categoryId: "dairy_eggs",
      position: 0,
    },
  ],
};

describe("ConfirmReceiptRequestSchema.merchant", () => {
  // Accepted blank on purpose — an unreadable merchant must not cost the user a confirmed order.
  // `confirmReceipt` substitutes the placeholder; the schema's job is only to let it through.
  it("accepts a blank merchant", () => {
    const result = ConfirmReceiptRequestSchema.safeParse({ ...confirmRequest, merchant: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.merchant).toBe("");
    }
  });

  it("trims surrounding whitespace", () => {
    const result = ConfirmReceiptRequestSchema.safeParse({
      ...confirmRequest,
      merchant: "  Carrefour  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.merchant).toBe("Carrefour");
    }
  });

  it("reduces a whitespace-only merchant to blank", () => {
    const result = ConfirmReceiptRequestSchema.safeParse({ ...confirmRequest, merchant: "   " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.merchant).toBe("");
    }
  });

  it("still rejects a merchant longer than 200 characters", () => {
    const result = ConfirmReceiptRequestSchema.safeParse({
      ...confirmRequest,
      merchant: "x".repeat(201),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("merchant");
    }
  });

  it("still rejects an omitted merchant", () => {
    const withoutMerchant: Record<string, unknown> = { ...confirmRequest };
    delete withoutMerchant.merchant;
    const result = ConfirmReceiptRequestSchema.safeParse(withoutMerchant);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("merchant");
    }
  });
});

describe("ConfirmReceiptRequestSchema.periodMonth", () => {
  // BR-4: the user chooses the accounting month freely — a receipt can be booked into a
  // future month (e.g. a purchase on the 31st charged to next month's budget).
  it("accepts a periodMonth in a future month", () => {
    const result = ConfirmReceiptRequestSchema.safeParse({
      ...confirmRequest,
      periodMonth: "2099-12",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.periodMonth).toBe("2099-12");
    }
  });

  it("accepts a periodMonth in a past month", () => {
    const result = ConfirmReceiptRequestSchema.safeParse({
      ...confirmRequest,
      periodMonth: "1999-11",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.periodMonth).toBe("1999-11");
    }
  });

  it.each(["2026-13", "2026-00", "2026-7", "07-2026", "2026-07-01"])(
    "rejects malformed month %s",
    (periodMonth) => {
      const result = ConfirmReceiptRequestSchema.safeParse({ ...confirmRequest, periodMonth });
      expect(result.success).toBe(false);
      if (!result.success) {
        const failedPaths = result.error.issues.map((issue) => issue.path.join("."));
        expect(failedPaths).toContain("periodMonth");
      }
    },
  );
});
