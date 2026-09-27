import { describe, expect, it } from "vitest";
import { ConfirmReceiptRequestSchema, ReceiptCreateRequestSchema } from "./receipts";

const confirmRequest = {
  merchant: "Carrefour",
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

const onDeviceRequest = {
  clientRef: "client-ref-1",
  images: [{ base64: "b64", position: 0, mimeType: "image/jpeg" as const }],
  extractionMode: "on_device" as const,
  clientParsedPayload: {
    isReceipt: true,
    merchant: "Carrefour",
    currency: "EGP",
    items: [
      { name: "Milk", quantity: 1, unitPrice: "10.00", lineTotal: "10.00", category: "dairy_eggs" },
    ],
    subtotal: "10.00",
    tax: "0.00",
    discount: "0.00",
    total: "10.00",
    warnings: [],
  },
};

describe("ReceiptCreateRequestSchema — on_device extraction", () => {
  it("requires clientParsedPayload when extractionMode is on_device", () => {
    const withoutPayload: Record<string, unknown> = { ...onDeviceRequest };
    delete withoutPayload.clientParsedPayload;
    const result = ReceiptCreateRequestSchema.safeParse(withoutPayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "clientParsedPayload",
      );
    }
  });

  it("accepts a well-formed clientParsedPayload", () => {
    const result = ReceiptCreateRequestSchema.safeParse(onDeviceRequest);
    expect(result.success).toBe(true);
  });

  // Regression: the client schema must never accept a bare JSON number, or round/reformat a
  // malformed string, for a money field — unlike the cloud AI-output schema in
  // lib/services/extraction.ts, which deliberately tolerates that from a model's completion.
  it.each([
    ["a JSON number", 10],
    ["a value with more than two decimals", "10.005"],
    ["a thousands separator", "1,000.00"],
  ])("rejects a lineTotal that is %s instead of a strict money string", (_label, lineTotal) => {
    const result = ReceiptCreateRequestSchema.safeParse({
      ...onDeviceRequest,
      clientParsedPayload: {
        ...onDeviceRequest.clientParsedPayload,
        items: [{ ...onDeviceRequest.clientParsedPayload.items[0], lineTotal }],
      },
    });
    expect(result.success).toBe(false);
  });

  // Regression: a real receipt can carry negative per-item discount lines, and the cloud path
  // (`ParsedReceiptSchema`) already allows a signed lineTotal/unitPrice — the client schema must
  // match that, not reject a well-formed negative amount the way `nonNegativeMoneySchema` would.
  it("accepts a negative lineTotal for a discount line item", () => {
    const result = ReceiptCreateRequestSchema.safeParse({
      ...onDeviceRequest,
      clientParsedPayload: {
        ...onDeviceRequest.clientParsedPayload,
        items: [
          ...onDeviceRequest.clientParsedPayload.items,
          {
            name: "Discount",
            quantity: 1,
            unitPrice: "-10.00",
            lineTotal: "-10.00",
            category: "other",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a clientLatencyMs above the 10-minute cap", () => {
    const result = ReceiptCreateRequestSchema.safeParse({
      ...onDeviceRequest,
      clientLatencyMs: 600_001,
    });
    expect(result.success).toBe(false);
  });
});
