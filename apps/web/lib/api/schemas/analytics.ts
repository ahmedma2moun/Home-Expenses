import { z } from "zod";
import { monthLabelSchema, moneySchema } from "@/lib/api/schemas/common";

const DEFAULT_TRENDS_MONTHS = 6;
const MAX_TRENDS_MONTHS = 24;

/** `GET /analytics/trends?months=` — window ending at the current month, oldest first. */
export const TrendsQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(MAX_TRENDS_MONTHS).default(DEFAULT_TRENDS_MONTHS),
});
export type TrendsQuery = z.infer<typeof TrendsQuerySchema>;

/** `GET /analytics/price-watch?month=` — items bought in this month whose price jumped over the
 *  last purchase at the same merchant. */
export const PriceWatchQuerySchema = z.object({
  month: monthLabelSchema,
});
export type PriceWatchQuery = z.infer<typeof PriceWatchQuerySchema>;

/** `POST /analytics/compare` body — omitting `monthA` asks for a trailing 3-month baseline instead
 *  of a second real month (PROJECT_SPEC.md §7.3, BR-5). */
export const CompareRequestSchema = z.object({
  monthB: monthLabelSchema,
  monthA: monthLabelSchema.optional(),
  refresh: z.boolean().optional().default(false),
});
export type CompareRequest = z.infer<typeof CompareRequestSchema>;

/** A model-returned money string close enough to shape to normalize: an integer or up to two
 *  decimal places, optionally negative. Deliberately narrower than accepting anything `Number()`
 *  can parse — `Number("1e3")` or `Number("0x10")` would otherwise silently round-trip through a
 *  money field as "1000.00"/"16.00", which is exactly the float-parsing rule 1 forbids, just one
 *  layer removed from a literal `parseFloat`. */
const MODEL_MONEY_STRING_RE = /^-?\d+(\.\d{1,2})?$/;

/** Models sometimes return a bare number for a money field despite the prompt — normalize before
 *  the strict "12.34" check, same defensive coercion as extraction's `moneyFromModelSchema`. Pure
 *  string manipulation for the string branch, never a `Number()` round trip — a JS number input
 *  has already lost whatever precision it had by the time it reaches here, but a string input
 *  hasn't, and shouldn't be made to. */
const moneyFromModelSchema = z.preprocess((value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = MODEL_MONEY_STRING_RE.exec(trimmed);
    if (match) {
      const negative = trimmed.startsWith("-");
      const [whole = "0", frac = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
      return `${negative ? "-" : ""}${whole}.${frac.padEnd(2, "0")}`;
    }
  }
  return value;
}, moneySchema);

/** A driver's `amount` is always a magnitude — `direction` already carries the sign, so a negative
 *  value here would be a contradiction, not a smaller number. */
const driverAmountSchema = moneyFromModelSchema.refine(
  (value) => !value.startsWith("-"),
  "amount must not be negative — direction already carries the sign",
);

/** The AI's month-comparison output contract — `docs/prompts/comparison.v1.md`'s "Output contract".
 *  Validated server-side; never trusted as-is (see `monthComparison.ts`'s category hardening).
 *  Arrays and strings are capped so a runaway model response can't put an unbounded payload into
 *  the `MonthComparison.payload` Json column. */
export const ComparisonPayloadSchema = z.object({
  headline: z.string().min(1).max(200),
  drivers: z
    .array(
      z.object({
        category: z.string(),
        direction: z.enum(["up", "down"]),
        amount: driverAmountSchema,
        explanation: z.string().min(1).max(300),
      }),
    )
    .max(6),
  anomalies: z.array(z.string().min(1).max(300)).max(10),
  suggestions: z.array(z.string().min(1).max(300)).min(2).max(4),
  confidence: z.coerce.number().min(0).max(1),
});
export type ComparisonPayload = z.infer<typeof ComparisonPayloadSchema>;
export type ComparisonDriver = ComparisonPayload["drivers"][number];
