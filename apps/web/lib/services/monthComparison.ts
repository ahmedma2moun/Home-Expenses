import { createHash } from "node:crypto";
import { prisma, Prisma } from "@/lib/db/prisma";
import { getAnalysisProvider } from "@/lib/ai";
import { AppError } from "@/lib/api/envelope";
import { formatMonthLabel, parseMonthLabel } from "@/lib/services/period";
import { getUserCurrency } from "@/lib/services/users";
import { extractJsonObject } from "@/lib/services/aiJson";
import {
  COMPARISON_PROMPT_VERSION,
  COMPARISON_SYSTEM_PROMPT_V1,
  buildComparisonCorrectionPrompt,
} from "@/lib/services/prompts";
import {
  ComparisonPayloadSchema,
  type ComparisonPayload,
  type CompareRequest,
} from "@/lib/api/schemas/analytics";

/** Trailing window averaged into a synthetic "monthA" when the caller omits a real one (BR-5's
 *  "monthly analysis" — this month vs. a rolling baseline instead of a second real month). */
const BASELINE_WINDOW_MONTHS = 3;

/**
 * `app/api/v1/analytics/compare/route.ts` sets `maxDuration = 30`. Budgeting under that — not at
 * it — leaves headroom for the aggregate queries and the cache read/write around the AI call.
 * Mirrors `extraction.ts`'s `EXTRACTION_BUDGET_MS`: without a shared deadline here, a first attempt
 * plus one correction retry (each defaulting to `withRetry`'s own 60s) can run well past the
 * route's hard limit — the client gets a bare 504 with no `{ error }` envelope, and the
 * `MonthComparison` upsert never runs, so a retry re-pays for the model call that timed out.
 */
const COMPARISON_BUDGET_MS = 25_000;

interface MonthAggregate {
  label: string;
  total: string;
  orders: number;
  byCategory: Record<string, string>;
  topMerchants: { name: string; total: string }[];
}

export interface CompareResult {
  payload: ComparisonPayload;
  model: string;
  cached: boolean;
  /** The account's one configured currency (`User.currency`) — every amount in `payload` is in
   *  this currency. Not part of the AI's own output contract; attached here so a client can format
   *  `drivers[].amount` without a second round trip. */
  currency: string;
}

/** The `count` calendar months immediately before `periodMonth`, nearest first. */
function monthsBefore(periodMonth: Date, count: number): Date[] {
  return Array.from(
    { length: count },
    (_, i) =>
      new Date(Date.UTC(periodMonth.getUTCFullYear(), periodMonth.getUTCMonth() - (i + 1), 1)),
  );
}

/** Reads the materialized MonthlySummary rows for one real month — never scans OrderItem (§12),
 *  same source as `getMonthSummary`. Top merchants come from `Order` since MonthlySummary has no
 *  merchant dimension. */
async function buildAggregate(userId: string, periodMonth: Date): Promise<MonthAggregate> {
  const [rows, orderCount, merchantRows] = await Promise.all([
    prisma.monthlySummary.findMany({ where: { userId, periodMonth } }),
    prisma.order.count({ where: { userId, periodMonth } }),
    prisma.order.groupBy({
      by: ["merchant"],
      where: { userId, periodMonth },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 3,
    }),
  ]);

  const byCategory: Record<string, string> = {};
  let total = new Prisma.Decimal(0);
  for (const row of rows) {
    byCategory[row.categoryId] = row.totalAmount.toFixed(2);
    total = total.add(row.totalAmount);
  }

  return {
    label: formatMonthLabel(periodMonth),
    total: total.toFixed(2),
    orders: orderCount,
    byCategory,
    topMerchants: merchantRows.flatMap((row) =>
      row._sum.total === null ? [] : [{ name: row.merchant, total: row._sum.total.toFixed(2) }],
    ),
  };
}

/** Synthetic "monthA": the per-category average over the `BASELINE_WINDOW_MONTHS` months before
 *  `periodMonth`, in the exact same shape as a real month's aggregate — the prompt never needs to
 *  know this isn't a real month. Top merchants are omitted; averaging merchants across months
 *  isn't meaningful and the output contract doesn't require them.
 *
 *  Divides by however many of those months actually have data, not by the fixed window size — a
 *  user with one prior month of history who divided by 3 would see a baseline a third of their
 *  real spending, and the model would narrate a fabricated ~200% jump. Throws if there's no prior
 *  data at all, rather than spending a model call narrating a comparison against an all-zero month.
 */
async function buildBaselineAggregate(userId: string, periodMonth: Date): Promise<MonthAggregate> {
  const window = monthsBefore(periodMonth, BASELINE_WINDOW_MONTHS);

  const [rows, orderCounts] = await Promise.all([
    prisma.monthlySummary.findMany({ where: { userId, periodMonth: { in: window } } }),
    prisma.order.groupBy({
      by: ["periodMonth"],
      where: { userId, periodMonth: { in: window } },
      _count: { _all: true },
    }),
  ]);

  const monthsWithData = new Set(rows.map((row) => row.periodMonth.getTime())).size;
  if (monthsWithData === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Not enough spending history yet to compare this month against a baseline.",
      400,
    );
  }
  const divisor = new Prisma.Decimal(monthsWithData);

  const byCategoryTotal = new Map<string, Prisma.Decimal>();
  let total = new Prisma.Decimal(0);
  for (const row of rows) {
    total = total.add(row.totalAmount);
    byCategoryTotal.set(
      row.categoryId,
      (byCategoryTotal.get(row.categoryId) ?? new Prisma.Decimal(0)).add(row.totalAmount),
    );
  }
  const byCategory: Record<string, string> = {};
  for (const [categoryId, sum] of byCategoryTotal) {
    byCategory[categoryId] = sum.dividedBy(divisor).toFixed(2);
  }

  const totalOrders = orderCounts.reduce((sum, row) => sum + row._count._all, 0);
  const newest = window[0] ?? periodMonth;
  const oldest = window[window.length - 1] ?? periodMonth;

  return {
    label: `Avg (${formatMonthLabel(oldest)} – ${formatMonthLabel(newest)})`,
    total: total.dividedBy(divisor).toFixed(2),
    orders: Math.round(totalOrders / monthsWithData),
    byCategory,
    topMerchants: [],
  };
}

/** `null` when `before` is zero and `after` isn't — "up 100%" would understate a category that
 *  didn't exist last month at all, so the caller (and the prompt) treat `null` as "new," not as a
 *  number. */
function pctChange(before: Prisma.Decimal, after: Prisma.Decimal): number | null {
  if (before.isZero()) {
    return after.isZero() ? 0 : null;
  }
  return after.minus(before).dividedBy(before).times(100).toDecimalPlaces(1).toNumber();
}

function computeDeltas(
  monthA: MonthAggregate,
  monthB: MonthAggregate,
): { totalPct: number | null; byCategoryPct: Record<string, number | null> } {
  const totalPct = pctChange(new Prisma.Decimal(monthA.total), new Prisma.Decimal(monthB.total));

  const categoryIds = new Set([
    ...Object.keys(monthA.byCategory),
    ...Object.keys(monthB.byCategory),
  ]);
  const byCategoryPct: Record<string, number | null> = {};
  for (const categoryId of categoryIds) {
    const before = new Prisma.Decimal(monthA.byCategory[categoryId] ?? "0.00");
    const after = new Prisma.Decimal(monthB.byCategory[categoryId] ?? "0.00");
    byCategoryPct[categoryId] = pctChange(before, after);
  }
  return { totalPct, byCategoryPct };
}

/** Hash of both months' aggregates plus the prompt version — the `dataVersion` half of
 *  `MonthComparison`'s cache key. Any order write that changes either month's numbers changes
 *  this, so a stale narrative never survives a cache read even though
 *  `invalidateMonthComparisons` also deletes rows proactively. The prompt version is included so
 *  that changing the prompt (CLAUDE.md rule 9) invalidates the cache too — otherwise a user whose
 *  numbers haven't changed would keep being served a narrative generated under the old prompt. */
function computeDataVersion(
  currency: string,
  monthA: MonthAggregate,
  monthB: MonthAggregate,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion: COMPARISON_PROMPT_VERSION, currency, monthA, monthB }))
    .digest("hex")
    .slice(0, 16);
}

type ParseAttempt = { success: true; data: ComparisonPayload } | { success: false; error: string };

/** Validates the model's JSON, then drops (never fails on) any driver referencing a category that
 *  doesn't appear in either aggregate — the category half of "reject any category or amount that
 *  doesn't trace back to the input aggregate" per `docs/prompts/comparison.v1.md`'s server-side
 *  hardening note. (Amounts aren't independently re-validated against the aggregate — the model
 *  already only sees real numbers, and bounding `amount` to a tolerance band around a computed
 *  delta risks dropping legitimate driver rows over rounding, so this is deliberately category-only.) */
function tryParseComparison(
  text: string,
  monthA: MonthAggregate,
  monthB: MonthAggregate,
): ParseAttempt {
  try {
    const parsed = ComparisonPayloadSchema.parse(extractJsonObject(text));
    const knownCategories = new Set([
      ...Object.keys(monthA.byCategory),
      ...Object.keys(monthB.byCategory),
    ]);
    return {
      success: true,
      data: {
        ...parsed,
        drivers: parsed.drivers.filter((driver) => knownCategories.has(driver.category)),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error.";
    return { success: false, error: message };
  }
}

interface GeneratedComparison {
  payload: ComparisonPayload;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  attempts: number;
}

async function generateComparison(
  requestId: string,
  diffJson: string,
  monthA: MonthAggregate,
  monthB: MonthAggregate,
  deadlineMs: number,
): Promise<GeneratedComparison> {
  const provider = getAnalysisProvider();

  const first = await provider.compare({
    diffJson,
    systemPrompt: COMPARISON_SYSTEM_PROMPT_V1,
    deadlineMs,
  });
  const firstAttempt = tryParseComparison(first.text, monthA, monthB);
  if (firstAttempt.success) {
    return {
      payload: firstAttempt.data,
      model: first.model,
      ...(first.inputTokens !== undefined && { inputTokens: first.inputTokens }),
      ...(first.outputTokens !== undefined && { outputTokens: first.outputTokens }),
      latencyMs: first.latencyMs,
      attempts: first.attempts,
    };
  }

  const retry = await provider.compare({
    diffJson,
    systemPrompt: buildComparisonCorrectionPrompt(first.text, firstAttempt.error),
    deadlineMs,
  });
  const retryAttempt = tryParseComparison(retry.text, monthA, monthB);
  if (!retryAttempt.success) {
    // Logged separately, never in the thrown AppError's own message/details — both are
    // client-visible (`errorEnvelope`), and this is the model's raw (possibly malformed) text.
    console.error("comparison_validation_failed", { requestId, error: retryAttempt.error });
    throw new AppError("INTERNAL_ERROR", "The comparison could not be generated. Try again.", 502);
  }
  return {
    payload: retryAttempt.data,
    model: retry.model,
    ...(retry.inputTokens !== undefined && { inputTokens: retry.inputTokens }),
    ...(retry.outputTokens !== undefined && { outputTokens: retry.outputTokens }),
    latencyMs: first.latencyMs + retry.latencyMs,
    attempts: first.attempts + retry.attempts,
  };
}

/** Mirrors `receipts.ts`'s `logExtractionUsage` (§7.1 cost tracking) — the request id, user id,
 *  model, token counts, latency, and attempt count only. Never `diffJson`, `payload`, or anything
 *  derived from merchant/category names — receipts are PII (CLAUDE.md rule 6) and this narrative
 *  is built from the same account's data. */
function logComparisonUsage(
  requestId: string,
  userId: string,
  outcome: Pick<
    GeneratedComparison,
    "model" | "inputTokens" | "outputTokens" | "latencyMs" | "attempts"
  >,
): void {
  console.debug("comparison_usage", {
    requestId,
    userId,
    model: outcome.model,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    latencyMs: outcome.latencyMs,
    attempts: outcome.attempts,
  });
}

/**
 * Manually triggered only — this is never called from a background job or on page load, so the
 * cache lookup below (skipped only when `refresh` is set) is the entire cost control for v1; see
 * the plan's rate-limiting scope decision.
 */
export async function compareMonths(
  userId: string,
  input: CompareRequest,
  requestId: string,
): Promise<CompareResult> {
  const periodMonthB = parseMonthLabel(input.monthB);
  const monthALabel = input.monthA;
  const isBaseline = monthALabel === undefined;
  const periodMonthA =
    monthALabel === undefined
      ? (monthsBefore(periodMonthB, BASELINE_WINDOW_MONTHS)[BASELINE_WINDOW_MONTHS - 1] ??
        periodMonthB)
      : parseMonthLabel(monthALabel);

  const [monthA, monthB, currency] = await Promise.all([
    isBaseline
      ? buildBaselineAggregate(userId, periodMonthB)
      : buildAggregate(userId, periodMonthA),
    buildAggregate(userId, periodMonthB),
    getUserCurrency(userId),
  ]);

  const deltas = computeDeltas(monthA, monthB);
  const dataVersion = computeDataVersion(currency, monthA, monthB);
  const cacheKey = { userId, monthA: periodMonthA, monthB: periodMonthB, dataVersion };

  if (!input.refresh) {
    const cached = await prisma.monthComparison.findUnique({
      where: { userId_monthA_monthB_dataVersion: cacheKey },
    });
    if (cached) {
      return {
        payload: ComparisonPayloadSchema.parse(cached.payload),
        model: cached.model,
        cached: true,
        currency,
      };
    }
  }

  const deadlineMs = Date.now() + COMPARISON_BUDGET_MS;
  const diffJson = JSON.stringify({ currency, monthA, monthB, deltas });
  const generated = await generateComparison(requestId, diffJson, monthA, monthB, deadlineMs);
  logComparisonUsage(requestId, userId, generated);
  const { payload, model } = generated;

  await prisma.monthComparison.upsert({
    where: { userId_monthA_monthB_dataVersion: cacheKey },
    create: { ...cacheKey, payload, model },
    update: { payload, model },
  });

  return { payload, model, cached: false, currency };
}
