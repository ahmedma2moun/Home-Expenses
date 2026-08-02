import { afterEach, describe, expect, it, vi } from "vitest";

/** Same rationale as analytics.test.ts's FakeDecimal — priceHistory.ts chains `.comparedTo`,
 *  `.minus`, `.dividedBy`, `.toNumber`, `.toFixed`, `.lessThanOrEqualTo` across `Prisma.Decimal`
 *  values, so every priced fixture has to be one of these, not a plain number. */
class FakeDecimal {
  private readonly value: number;
  constructor(value: number | string) {
    this.value = typeof value === "string" ? Number(value) : value;
  }
  comparedTo(other: FakeDecimal): number {
    return this.value - other.value;
  }
  minus(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value - other.value);
  }
  dividedBy(other: FakeDecimal): FakeDecimal {
    return new FakeDecimal(this.value / other.value);
  }
  toNumber(): number {
    return this.value;
  }
  toFixed(n: number): string {
    return this.value.toFixed(n);
  }
  lessThanOrEqualTo(other: number): boolean {
    return this.value <= other;
  }
}

const orderItemFindMany = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@/lib/db/prisma", () => ({
  prisma: { orderItem: { findMany: (...args: unknown[]) => orderItemFindMany(...args) } },
  Prisma: { Decimal: FakeDecimal },
}));

vi.mock("@/lib/services/itemNormalization", () => ({
  normalizeItemName: (name: string) => name.trim().toLowerCase(),
  normalizeMerchant: (merchant: string) => merchant.trim().toLowerCase(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function row(opts: {
  name: string;
  normalizedName: string;
  unitPrice: number;
  merchant: string;
  periodMonth: Date;
  purchasedAt?: Date | null;
  orderId?: string;
  unit?: string | null;
}) {
  return {
    name: opts.name,
    normalizedName: opts.normalizedName,
    unit: opts.unit ?? null,
    unitPrice: new FakeDecimal(opts.unitPrice),
    order: {
      id: opts.orderId ?? `order-${opts.merchant}-${opts.periodMonth.toISOString()}`,
      merchant: opts.merchant,
      purchasedAt: opts.purchasedAt ?? opts.periodMonth,
      periodMonth: opts.periodMonth,
    },
  };
}

describe("getItemPriceHistory", () => {
  it("picks the cheapest store across merchants without treating a store switch as price creep", async () => {
    orderItemFindMany.mockResolvedValue([
      row({
        name: "Tomatoes",
        normalizedName: "tomatoes",
        unitPrice: 20,
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 4, 1)),
      }),
      row({
        name: "Tomatoes",
        normalizedName: "tomatoes",
        unitPrice: 15,
        merchant: "Metro",
        periodMonth: new Date(Date.UTC(2026, 5, 1)),
      }),
      row({
        name: "Tomatoes",
        normalizedName: "tomatoes",
        unitPrice: 24,
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 6, 1)),
      }),
    ]);

    const { getItemPriceHistory } = await import("./priceHistory");
    const result = await getItemPriceHistory("user-1", "tomatoes");

    expect(result.cheapest).toMatchObject({ merchant: "Metro", unitPrice: "15.00" });
    // The Metro purchase (cheapest, but a different merchant) is skipped when looking for "the
    // previous purchase" — the comparison lands on the earlier Carrefour purchase instead, a real
    // 20% increase, not the 60% jump a naive by-date-only comparison against Metro would produce.
    expect(result.priceCreep).toEqual({
      previousMerchant: "Carrefour",
      previousUnitPrice: "20.00",
      latestUnitPrice: "24.00",
      changeRatio: 0.2,
    });
  });

  it("does not flag an increase below the threshold", async () => {
    orderItemFindMany.mockResolvedValue([
      row({
        name: "Olive oil",
        normalizedName: "olive oil",
        unitPrice: 20,
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 4, 1)),
      }),
      row({
        name: "Olive oil",
        normalizedName: "olive oil",
        unitPrice: 22,
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 5, 1)),
      }),
    ]);

    const { getItemPriceHistory } = await import("./priceHistory");
    const result = await getItemPriceHistory("user-1", "olive oil");

    expect(result.priceCreep).toBeNull();
  });

  it("flags an increase exactly at the threshold", async () => {
    orderItemFindMany.mockResolvedValue([
      row({
        name: "Olive oil",
        normalizedName: "olive oil",
        unitPrice: 20,
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 4, 1)),
      }),
      row({
        name: "Olive oil",
        normalizedName: "olive oil",
        unitPrice: 23,
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 5, 1)),
      }),
    ]);

    const { getItemPriceHistory } = await import("./priceHistory");
    const result = await getItemPriceHistory("user-1", "olive oil");

    expect(result.priceCreep).toMatchObject({ changeRatio: 0.15 });
  });

  it("treats a merchant name as the same store regardless of case", async () => {
    orderItemFindMany.mockResolvedValue([
      row({
        name: "Olive oil",
        normalizedName: "olive oil",
        unitPrice: 20,
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 4, 1)),
      }),
      row({
        name: "Olive oil",
        normalizedName: "olive oil",
        unitPrice: 24,
        merchant: "carrefour",
        periodMonth: new Date(Date.UTC(2026, 5, 1)),
      }),
    ]);

    const { getItemPriceHistory } = await import("./priceHistory");
    const result = await getItemPriceHistory("user-1", "olive oil");

    expect(result.priceCreep).toMatchObject({ previousMerchant: "Carrefour", changeRatio: 0.2 });
  });

  it("never compares two purchases recorded in different units", async () => {
    orderItemFindMany.mockResolvedValue([
      row({
        name: "Tomatoes",
        normalizedName: "tomatoes",
        unitPrice: 8,
        unit: "pcs",
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 4, 1)),
      }),
      row({
        name: "Tomatoes",
        normalizedName: "tomatoes",
        unitPrice: 24,
        unit: "kg",
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 5, 1)),
      }),
    ]);

    const { getItemPriceHistory } = await import("./priceHistory");
    const result = await getItemPriceHistory("user-1", "tomatoes");

    // A per-kg price and a per-item price for the same item name aren't comparable — neither a
    // "cheapest" nor a "creep" signal should come from mixing them.
    expect(result.priceCreep).toBeNull();
    expect(result.cheapest).toMatchObject({ unitPrice: "24.00" });
  });

  it("returns no history for an item that's never been bought", async () => {
    orderItemFindMany.mockResolvedValue([]);

    const { getItemPriceHistory } = await import("./priceHistory");
    const result = await getItemPriceHistory("user-1", "unicorn tears");

    expect(result).toEqual({
      itemName: "unicorn tears",
      history: [],
      cheapest: null,
      priceCreep: null,
    });
  });
});

describe("getPriceWatchItems", () => {
  it("flags items bought this month whose price rose past the threshold at the same merchant", async () => {
    const targetMonth = new Date(Date.UTC(2026, 6, 1));

    orderItemFindMany
      .mockResolvedValueOnce([
        row({
          name: "Milk",
          normalizedName: "milk",
          unitPrice: 30,
          merchant: "Spinneys",
          periodMonth: targetMonth,
        }),
        row({
          name: "Bread",
          normalizedName: "bread",
          unitPrice: 10.5,
          merchant: "Spinneys",
          periodMonth: targetMonth,
        }),
      ])
      .mockResolvedValueOnce([
        row({
          name: "Milk",
          normalizedName: "milk",
          unitPrice: 30,
          merchant: "Spinneys",
          periodMonth: targetMonth,
        }),
        row({
          name: "Milk",
          normalizedName: "milk",
          unitPrice: 24,
          merchant: "Spinneys",
          periodMonth: new Date(Date.UTC(2026, 5, 1)),
        }),
        row({
          name: "Bread",
          normalizedName: "bread",
          unitPrice: 10.5,
          merchant: "Spinneys",
          periodMonth: targetMonth,
        }),
        row({
          name: "Bread",
          normalizedName: "bread",
          unitPrice: 10,
          merchant: "Spinneys",
          periodMonth: new Date(Date.UTC(2026, 5, 1)),
        }),
      ]);

    const { getPriceWatchItems } = await import("./priceHistory");
    const results = await getPriceWatchItems("user-1", targetMonth);

    // Milk jumped 25% (past the 15% threshold); bread only moved ~5% and is filtered out entirely.
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      itemName: "Milk",
      normalizedName: "milk",
      merchant: "Spinneys",
      previousUnitPrice: "24.00",
      latestUnitPrice: "30.00",
      changeRatio: 0.25,
    });
  });

  it("catches a price rise between two purchases inside the same month", async () => {
    const targetMonth = new Date(Date.UTC(2026, 6, 1));

    orderItemFindMany
      .mockResolvedValueOnce([
        row({
          name: "Eggs",
          normalizedName: "eggs",
          unitPrice: 30,
          merchant: "Spinneys",
          periodMonth: targetMonth,
          purchasedAt: new Date(Date.UTC(2026, 6, 20)),
          orderId: "order-second",
        }),
        row({
          name: "Eggs",
          normalizedName: "eggs",
          unitPrice: 24,
          merchant: "Spinneys",
          periodMonth: targetMonth,
          purchasedAt: new Date(Date.UTC(2026, 6, 3)),
          orderId: "order-first",
        }),
      ])
      .mockResolvedValueOnce([
        row({
          name: "Eggs",
          normalizedName: "eggs",
          unitPrice: 30,
          merchant: "Spinneys",
          periodMonth: targetMonth,
          purchasedAt: new Date(Date.UTC(2026, 6, 20)),
          orderId: "order-second",
        }),
        row({
          name: "Eggs",
          normalizedName: "eggs",
          unitPrice: 24,
          merchant: "Spinneys",
          periodMonth: targetMonth,
          purchasedAt: new Date(Date.UTC(2026, 6, 3)),
          orderId: "order-first",
        }),
      ]);

    const { getPriceWatchItems } = await import("./priceHistory");
    const results = await getPriceWatchItems("user-1", targetMonth);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      itemName: "Eggs",
      previousUnitPrice: "24.00",
      latestUnitPrice: "30.00",
      changeRatio: 0.25,
    });
  });

  it("returns nothing when the month has no purchases", async () => {
    orderItemFindMany.mockResolvedValueOnce([]);

    const { getPriceWatchItems } = await import("./priceHistory");
    const results = await getPriceWatchItems("user-1", new Date(Date.UTC(2026, 6, 1)));

    expect(results).toEqual([]);
    // No follow-up history query is issued once there's nothing this month to compare.
    expect(orderItemFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("checkDraftItemPrices", () => {
  it("compares the draft's own unit price against history at the receipt's merchant", async () => {
    orderItemFindMany.mockResolvedValueOnce([
      row({
        name: "Tomatoes",
        normalizedName: "tomatoes",
        unitPrice: 20,
        merchant: "Carrefour",
        periodMonth: new Date(Date.UTC(2026, 4, 1)),
      }),
      row({
        name: "Tomatoes",
        normalizedName: "tomatoes",
        unitPrice: 15,
        merchant: "Metro",
        periodMonth: new Date(Date.UTC(2026, 5, 1)),
      }),
    ]);

    const { checkDraftItemPrices } = await import("./priceHistory");
    const results = await checkDraftItemPrices("user-1", "Carrefour", [
      { name: "Tomatoes", unitPrice: "25.00" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "tomatoes",
      priceCreep: {
        previousMerchant: "Carrefour",
        previousUnitPrice: "20.00",
        latestUnitPrice: "25.00",
        changeRatio: 0.25,
      },
    });
    expect(results[0]?.cheapest).toMatchObject({ merchant: "Metro", unitPrice: "15.00" });
  });

  it("skips the creep check for a brand-new item with no history", async () => {
    orderItemFindMany.mockResolvedValueOnce([]);

    const { checkDraftItemPrices } = await import("./priceHistory");
    const results = await checkDraftItemPrices("user-1", "Carrefour", [
      { name: "Kombucha", unitPrice: "45.00" },
    ]);

    expect(results).toEqual([{ name: "kombucha", cheapest: null, priceCreep: null }]);
  });
});
