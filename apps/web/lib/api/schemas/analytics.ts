import { z } from "zod";
import { monthLabelSchema } from "@/lib/api/schemas/common";

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
