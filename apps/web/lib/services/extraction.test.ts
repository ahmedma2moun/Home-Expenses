import { afterEach, describe, expect, it, vi } from "vitest";

const extract = vi.fn();

vi.mock("@/lib/ai", () => ({
  getExtractionProvider: () => ({ extract }),
}));

const VALID_RECEIPT = {
  isReceipt: true,
  merchant: "Carrefour",
  currency: "EGP",
  items: [
    {
      name: "Milk",
      quantity: 2,
      unit: "L",
      unitPrice: "30.00",
      lineTotal: "60.00",
      category: "dairy_eggs",
      confidence: 0.9,
    },
  ],
  subtotal: "60.00",
  tax: "0.00",
  discount: "0.00",
  total: "60.00",
  warnings: [],
  overallConfidence: 0.9,
};

function providerResult(text: string, overrides: Record<string, unknown> = {}) {
  return { text, model: "gemini-3.5-flash", latencyMs: 100, attempts: 1, ...overrides };
}

const IMAGE = { base64: "b64", mediaType: "image/jpeg", position: 0 };

afterEach(() => {
  vi.clearAllMocks();
});

describe("extractReceipt", () => {
  it("returns the parsed result on the first valid response, with no correction call", async () => {
    extract.mockResolvedValueOnce(providerResult(JSON.stringify(VALID_RECEIPT)));

    const { extractReceipt } = await import("./extraction");
    const outcome = await extractReceipt([IMAGE]);

    expect(outcome.result.merchant).toBe("Carrefour");
    expect(outcome.attempts).toBe(1);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  // §7.2: the model's raw text sometimes isn't valid per the schema (wrong shape, prose wrapper) —
  // one correction turn gets the validation error appended and asks for corrected JSON only.
  it("retries once with the validation error on a malformed first response, then succeeds", async () => {
    extract
      .mockResolvedValueOnce(providerResult("not json at all"))
      .mockResolvedValueOnce(providerResult(JSON.stringify(VALID_RECEIPT), { attempts: 2 }));

    const { extractReceipt } = await import("./extraction");
    const outcome = await extractReceipt([IMAGE]);

    expect(outcome.result.merchant).toBe("Carrefour");
    expect(outcome.attempts).toBe(3); // 1 (failed first) + 2 (the correction call's own attempts)
    expect(extract).toHaveBeenCalledTimes(2);
    const correctionCall = extract.mock.calls[1]?.[0] as { systemPrompt: string };
    expect(correctionCall.systemPrompt).toContain("failed validation");
  });

  it("throws when the correction retry also fails validation", async () => {
    extract
      .mockResolvedValueOnce(providerResult("still not json"))
      .mockResolvedValueOnce(providerResult("nope, also not json"));

    const { extractReceipt } = await import("./extraction");

    await expect(extractReceipt([IMAGE])).rejects.toThrow(/failed validation twice/);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  // moneyFromModelSchema: models sometimes return a bare number despite the prompt telling them
  // not to — that's normalized to the "12.34" string shape rather than bounced into a wasted retry.
  it("coerces a bare-number money field instead of treating it as invalid", async () => {
    const receiptWithNumericMoney = { ...VALID_RECEIPT, total: 60, subtotal: 60 };
    extract.mockResolvedValueOnce(providerResult(JSON.stringify(receiptWithNumericMoney)));

    const { extractReceipt } = await import("./extraction");
    const outcome = await extractReceipt([IMAGE]);

    expect(outcome.result.total).toBe("60.00");
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("shares one deadline across the first call and the correction retry", async () => {
    extract
      .mockResolvedValueOnce(providerResult("not json"))
      .mockResolvedValueOnce(providerResult(JSON.stringify(VALID_RECEIPT)));

    const { extractReceipt } = await import("./extraction");
    await extractReceipt([IMAGE]);

    const firstDeadline = (extract.mock.calls[0]?.[0] as { deadlineMs: number }).deadlineMs;
    const secondDeadline = (extract.mock.calls[1]?.[0] as { deadlineMs: number }).deadlineMs;
    expect(firstDeadline).toBe(secondDeadline);
  });
});
