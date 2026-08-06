import { prisma, Prisma } from "@/lib/db/prisma";
import { formatMonthLabel } from "@/lib/services/period";
import { normalizeItemName, normalizeMerchant } from "@/lib/services/itemNormalization";

/**
 * Derived insight over `OrderItem.normalizedName` (PROJECT_SPEC.md §11's "merchant-item memory"),
 * which is already populated on every order create/update — no schema change needed here.
 *
 * Cross-merchant price comparisons are deliberately never treated as "creep": switching stores
 * changes the price for reasons that have nothing to do with inflation, so a creep signal only ever
 * compares two purchases of the same item at the **same merchant**. Comparing across merchants is
 * exactly what "cheapest store" (`cheapest` below) is for instead. Comparisons also require the
 * same `unit` (both `null`, or an equal string) — "24.00/kg" and "8.00/pcs" are not the same price
 * for the same thing, even under an identical item name.
 */

/** MVP heuristic for "meaningfully more expensive" — there's no Settings screen yet to make this
 *  configurable, so it lives as a constant until one exists. */
const PRICE_CREEP_THRESHOLD = 0.15;

const PRICE_WATCH_LIMIT = 20;
/** Safety cap on how much history a single item (or a batch of draft items) can pull into memory —
 *  generous for a personal household tracker, not a real pagination contract. */
const MAX_PRICED_ROWS = 500;
const HISTORY_DISPLAY_LIMIT = 100;

export interface PriceHistoryEntry {
  orderId: string;
  merchant: string;
  brand: string | null;
  unitPrice: string;
  createdAt: string;
  periodMonth: string;
}

export interface PriceCreep {
  previousMerchant: string;
  previousUnitPrice: string;
  latestUnitPrice: string;
  changeRatio: number;
}

export interface ItemPriceHistory {
  itemName: string;
  history: PriceHistoryEntry[];
  cheapest: PriceHistoryEntry | null;
  priceCreep: PriceCreep | null;
}

export interface PriceWatchItem {
  itemName: string;
  brand: string | null;
  normalizedName: string;
  merchant: string;
  previousMerchant: string;
  previousUnitPrice: string;
  latestUnitPrice: string;
  changeRatio: number;
  periodMonth: string;
}

export interface DraftItemPriceCheck {
  name: string;
  cheapest: PriceHistoryEntry | null;
  priceCreep: PriceCreep | null;
}

type OrderItemWithOrder = Prisma.OrderItemGetPayload<{
  include: {
    order: { select: { id: true; merchant: true; createdAt: true; periodMonth: true } };
  };
}>;

type PricedRow = OrderItemWithOrder & { unitPrice: Prisma.Decimal; normalizedName: string };

/** A priced row without a normalized name shouldn't exist — both are set together at creation — but
 *  the type is nullable, so this is where that's confirmed rather than asserted with `!`. */
function isPricedRow(row: OrderItemWithOrder): row is PricedRow {
  return row.unitPrice !== null && row.normalizedName !== null;
}

/** Newest accounting month first — `periodMonth`, not `createdAt`, is what "recent" means for a
 *  purchase (a receipt confirmed late still belongs to the month it was bought in). `createdAt`
 *  only breaks ties *within* a month; a stable id tiebreak covers same-instant saves. */
function sortByRecency(rows: PricedRow[]): PricedRow[] {
  return [...rows].sort(
    (a, b) =>
      b.order.periodMonth.getTime() - a.order.periodMonth.getTime() ||
      b.order.createdAt.getTime() - a.order.createdAt.getTime() ||
      b.order.id.localeCompare(a.order.id),
  );
}

function sameMerchant(row: PricedRow, merchant: string): boolean {
  return normalizeMerchant(row.order.merchant) === normalizeMerchant(merchant);
}

/** `null`/`null` counts as compatible (unit was never tracked for either purchase); any other
 *  mismatch does not. */
function sameUnit(a: string | null, b: string | null): boolean {
  return a === b;
}

function toPriceHistoryEntry(row: PricedRow): PriceHistoryEntry {
  return {
    orderId: row.order.id,
    merchant: row.order.merchant,
    brand: row.brand,
    unitPrice: row.unitPrice.toFixed(2),
    createdAt: row.order.createdAt.toISOString(),
    periodMonth: formatMonthLabel(row.order.periodMonth),
  };
}

/** Cheapest sighting **at the same unit** as `reference` — comparing a per-kg price against a
 *  per-item price would produce a meaningless "cheapest". */
function findCheapest(
  rows: PricedRow[],
  reference: PricedRow | undefined,
): PriceHistoryEntry | null {
  if (!reference) return null;
  const candidates = rows.filter((row) => sameUnit(row.unit, reference.unit));
  const cheapest = candidates.reduce<PricedRow | null>(
    (min, row) => (!min || row.unitPrice.comparedTo(min.unitPrice) < 0 ? row : min),
    null,
  );
  return cheapest ? toPriceHistoryEntry(cheapest) : null;
}

/** `previous` is always an actual saved purchase; `latestUnitPrice` may instead be an unsaved
 *  draft price (Review screen), which is why it's passed as a plain value, not a row. */
function computeCreep(previous: PricedRow, latestUnitPrice: Prisma.Decimal): PriceCreep | null {
  if (previous.unitPrice.lessThanOrEqualTo(0)) return null;
  const changeRatio = latestUnitPrice
    .minus(previous.unitPrice)
    .dividedBy(previous.unitPrice)
    .toNumber();
  if (changeRatio < PRICE_CREEP_THRESHOLD) return null;
  return {
    previousMerchant: previous.order.merchant,
    previousUnitPrice: previous.unitPrice.toFixed(2),
    latestUnitPrice: latestUnitPrice.toFixed(2),
    changeRatio,
  };
}

/** Latest purchase vs. the most recent prior purchase at that same purchase's merchant and unit. */
function findPriceCreep(sortedRows: PricedRow[]): PriceCreep | null {
  const [latest, ...rest] = sortedRows;
  if (!latest) return null;
  const previous = rest.find(
    (row) => sameMerchant(row, latest.order.merchant) && sameUnit(row.unit, latest.unit),
  );
  return previous ? computeCreep(previous, latest.unitPrice) : null;
}

interface PricedRowFilter {
  normalizedName?: string | { in: string[] };
  periodMonth?: Date;
}

async function loadPricedRows(userId: string, filter: PricedRowFilter): Promise<PricedRow[]> {
  const rows = await prisma.orderItem.findMany({
    where: {
      ...(filter.normalizedName !== undefined && { normalizedName: filter.normalizedName }),
      order: {
        userId,
        ...(filter.periodMonth !== undefined && { periodMonth: filter.periodMonth }),
      },
    },
    include: {
      order: { select: { id: true, merchant: true, createdAt: true, periodMonth: true } },
    },
    // Not a real pagination contract — just a ceiling so one item name (or a batch of them) can't
    // pull an unbounded payload into memory. Ordered the same way `sortByRecency` re-sorts below
    // (month first, then createdAt), so the ceiling drops the oldest *months*, not the oldest saves.
    orderBy: [{ order: { periodMonth: "desc" } }, { order: { createdAt: "desc" } }],
    take: MAX_PRICED_ROWS,
  });
  return rows.filter(isPricedRow);
}

/** Backs the item-history sheet: every past purchase of one item, its cheapest store, and whether
 *  the most recent purchase was a price jump over the one before it. */
export async function getItemPriceHistory(
  userId: string,
  normalizedName: string,
): Promise<ItemPriceHistory> {
  const rows = sortByRecency(await loadPricedRows(userId, { normalizedName }));
  return {
    itemName: rows[0]?.name ?? normalizedName,
    history: rows.slice(0, HISTORY_DISPLAY_LIMIT).map(toPriceHistoryEntry),
    cheapest: findCheapest(rows, rows[0]),
    priceCreep: findPriceCreep(rows),
  };
}

/** Backs the Home teaser and the Analytics "Price Watch" section: every item bought in
 *  `periodMonth` whose price jumped at least `PRICE_CREEP_THRESHOLD` over the last time it was
 *  bought at the same merchant and unit — including an earlier purchase in that same month, not
 *  only a strictly earlier month — sorted by the sharpest increase first. */
export async function getPriceWatchItems(
  userId: string,
  periodMonth: Date,
): Promise<PriceWatchItem[]> {
  const monthRows = sortByRecency(await loadPricedRows(userId, { periodMonth }));
  const names = [...new Set(monthRows.map((row) => row.normalizedName))];
  if (names.length === 0) return [];

  const allRows = sortByRecency(await loadPricedRows(userId, { normalizedName: { in: names } }));
  const allByName = groupByNormalizedName(allRows);

  const results: PriceWatchItem[] = [];
  for (const name of names) {
    const latest = monthRows.find((row) => row.normalizedName === name);
    if (!latest) continue;
    const candidates = allByName.get(name) ?? [];
    const latestIndex = candidates.findIndex((row) => row.order.id === latest.order.id);
    const rest = latestIndex >= 0 ? candidates.slice(latestIndex + 1) : [];
    const previous = rest.find(
      (row) => sameMerchant(row, latest.order.merchant) && sameUnit(row.unit, latest.unit),
    );
    const creep = previous ? computeCreep(previous, latest.unitPrice) : null;
    if (!creep) continue;
    results.push({
      itemName: latest.name,
      brand: latest.brand,
      normalizedName: name,
      merchant: latest.order.merchant,
      ...creep,
      periodMonth: formatMonthLabel(latest.order.periodMonth),
    });
  }

  return results
    .sort((a, b) => b.changeRatio - a.changeRatio || a.itemName.localeCompare(b.itemName))
    .slice(0, PRICE_WATCH_LIMIT);
}

/** Backs the Review screen's one-shot check over unconfirmed draft items — `merchant` is the
 *  receipt's (not-yet-saved) merchant, and each draft's own (not-yet-saved) unit price is what gets
 *  compared against history, not any value already in the database. A draft with no `unit` only
 *  matches history rows that also have no `unit` recorded. */
export async function checkDraftItemPrices(
  userId: string,
  merchant: string,
  items: { name: string; unitPrice?: string | undefined; unit?: string | undefined }[],
): Promise<DraftItemPriceCheck[]> {
  const draftsByName = new Map<string, { unitPrice: string | undefined; unit: string | null }>();
  for (const item of items) {
    draftsByName.set(normalizeItemName(item.name), {
      unitPrice: item.unitPrice,
      unit: item.unit ?? null,
    });
  }
  const names = [...draftsByName.keys()];
  if (names.length === 0) return [];

  const rows = await loadPricedRows(userId, { normalizedName: { in: names } });
  const byName = groupByNormalizedName(rows);

  return names.map((name) => {
    const history = sortByRecency(byName.get(name) ?? []);
    const draft = draftsByName.get(name);
    const sameUnitHistory = draft ? history.filter((row) => sameUnit(row.unit, draft.unit)) : [];
    const previous = draft ? sameUnitHistory.find((row) => sameMerchant(row, merchant)) : undefined;
    const priceCreep =
      draft?.unitPrice && previous
        ? computeCreep(previous, new Prisma.Decimal(draft.unitPrice))
        : null;
    return {
      name,
      cheapest: findCheapest(history, sameUnitHistory[0] ?? history[0]),
      priceCreep,
    };
  });
}

function groupByNormalizedName(rows: PricedRow[]): Map<string, PricedRow[]> {
  const byName = new Map<string, PricedRow[]>();
  for (const row of rows) {
    const bucket = byName.get(row.normalizedName);
    if (bucket) {
      bucket.push(row);
    } else {
      byName.set(row.normalizedName, [row]);
    }
  }
  return byName;
}
