import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReceiptCreateRequest } from "@/lib/api/schemas/receipts";

const receiptCreate = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const receiptFindUnique = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const receiptFindFirst = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const receiptUpdateMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();

/** Stands in for a Prisma P2002 unique-constraint violation without depending on its real shape. */
class FakeUniqueConstraintError extends Error {}

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    receipt: {
      create: (...args: unknown[]) => receiptCreate(...args),
      findUnique: (...args: unknown[]) => receiptFindUnique(...args),
      findFirst: (...args: unknown[]) => receiptFindFirst(...args),
      updateMany: (...args: unknown[]) => receiptUpdateMany(...args),
    },
  },
  isUniqueConstraintViolation: (error: unknown) => error instanceof FakeUniqueConstraintError,
}));

const extractReceipt = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/services/extraction", () => ({
  extractReceipt: (...args: unknown[]) => extractReceipt(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function createInput(overrides: Partial<ReceiptCreateRequest> = {}): ReceiptCreateRequest {
  return {
    clientRef: "client-ref-1",
    images: [{ base64: "b64", position: 0, mimeType: "image/jpeg" }],
    ...overrides,
  };
}

describe("createReceipt", () => {
  it("creates a new receipt and reports created: true", async () => {
    receiptCreate.mockResolvedValue({ id: "receipt-1", status: "PARSING" });

    const { createReceipt } = await import("./receipts");
    const result = await createReceipt("user-1", createInput());

    expect(result).toEqual({ id: "receipt-1", status: "PARSING", created: true });
  });

  it("rejects duplicate image positions before ever calling the database", async () => {
    const { createReceipt } = await import("./receipts");

    await expect(
      createReceipt(
        "user-1",
        createInput({
          images: [
            { base64: "a", position: 0, mimeType: "image/jpeg" },
            { base64: "b", position: 0, mimeType: "image/jpeg" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    expect(receiptCreate).not.toHaveBeenCalled();
  });

  // A retried POST /receipts with the same clientRef (poor connectivity, client-side retry) must
  // return the receipt the first request already created, not race a second vision call against it.
  it("falls back to the existing receipt on a clientRef conflict, reporting created: false", async () => {
    receiptCreate.mockRejectedValue(new FakeUniqueConstraintError("duplicate clientRef"));
    receiptFindUnique.mockResolvedValue({ id: "receipt-existing", status: "PARSING" });

    const { createReceipt } = await import("./receipts");
    const result = await createReceipt("user-1", createInput());

    expect(result).toEqual({ id: "receipt-existing", status: "PARSING", created: false });
    expect(receiptFindUnique.mock.calls[0]?.[0]).toEqual({
      where: { userId_clientRef: { userId: "user-1", clientRef: "client-ref-1" } },
    });
  });

  it("rethrows a conflict that isn't actually the clientRef race", async () => {
    receiptCreate.mockRejectedValue(new Error("some other db error"));

    const { createReceipt } = await import("./receipts");

    await expect(createReceipt("user-1", createInput())).rejects.toThrow("some other db error");
  });
});

const IMAGE = { base64: "b64", position: 0, mimeType: "image/jpeg" as const };

function extractionOutcome(overrides: Record<string, unknown> = {}) {
  return {
    result: {
      isReceipt: true,
      merchant: "Carrefour",
      purchasedAt: null,
      currency: "EGP",
      items: [
        {
          name: "Milk",
          quantity: 1,
          unit: null,
          unitPrice: null,
          lineTotal: "10.00",
          category: "not_a_real_slug",
          confidence: 0.5,
        },
      ],
      subtotal: "10.00",
      tax: "0.00",
      discount: "0.00",
      total: "10.00",
      warnings: [],
      overallConfidence: 0.5,
    },
    model: "gemini-3.5-flash",
    inputTokens: 100,
    outputTokens: 20,
    latencyMs: 500,
    attempts: 1,
    ...overrides,
  };
}

describe("runExtraction", () => {
  it("does nothing when the receipt no longer belongs to the caller", async () => {
    receiptFindFirst.mockResolvedValue(null);

    const { runExtraction } = await import("./receipts");
    await runExtraction("req-1", "user-1", "receipt-1", [IMAGE]);

    expect(extractReceipt).not.toHaveBeenCalled();
  });

  it("marks the receipt PARSED and coerces an unrecognized category to other", async () => {
    receiptFindFirst.mockResolvedValue({ id: "receipt-1" });
    extractReceipt.mockResolvedValue(extractionOutcome());

    const { runExtraction } = await import("./receipts");
    await runExtraction("req-1", "user-1", "receipt-1", [IMAGE]);

    const call = receiptUpdateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: { status: string; parsedPayload: { items: { category: string }[] } };
    };
    expect(call.where).toEqual({ id: "receipt-1", userId: "user-1" });
    expect(call.data.status).toBe("PARSED");
    expect(call.data.parsedPayload.items[0]?.category).toBe("other");
  });

  it("marks the receipt FAILED with a user-facing message when isReceipt is false", async () => {
    receiptFindFirst.mockResolvedValue({ id: "receipt-1" });
    extractReceipt.mockResolvedValue(
      extractionOutcome({ result: { ...extractionOutcome().result, isReceipt: false } }),
    );

    const { runExtraction } = await import("./receipts");
    await runExtraction("req-1", "user-1", "receipt-1", [IMAGE]);

    expect(receiptUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { status: "FAILED", parseError: "These images don't look like a receipt." },
    });
  });

  // Never throws (the route calls this from `after()`, with nothing left to catch it) — a thrown
  // provider error must still land the receipt in a terminal FAILED state, not leave it PARSING.
  it("marks the receipt FAILED instead of throwing when extraction itself errors", async () => {
    receiptFindFirst.mockResolvedValue({ id: "receipt-1" });
    extractReceipt.mockRejectedValue(new Error("provider unreachable"));

    const { runExtraction } = await import("./receipts");
    await expect(runExtraction("req-1", "user-1", "receipt-1", [IMAGE])).resolves.toBeUndefined();

    expect(receiptUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "receipt-1", userId: "user-1" },
      data: { status: "FAILED", parseError: "provider unreachable" },
    });
  });
});
