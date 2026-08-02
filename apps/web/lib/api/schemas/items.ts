import { z } from "zod";
import { moneySchema } from "@/lib/api/schemas/common";
import { normalizeItemName } from "@/lib/services/itemNormalization";

/** `GET /items/price-history?name=` — the client can send the raw item name; it's normalized the
 *  same way `OrderItem.normalizedName` is at write time (`normalizeItemName`), so callers don't
 *  need to duplicate that rule. */
export const ItemPriceHistoryQuerySchema = z.object({
  name: z.string().min(1).max(200).transform(normalizeItemName),
});
export type ItemPriceHistoryQuery = z.infer<typeof ItemPriceHistoryQuerySchema>;

const DRAFT_ITEM_LIMIT = 50;

/** `POST /items/price-check` — one-shot batch lookup for the Review screen's unconfirmed draft
 *  items. `merchant` is the receipt's (not-yet-saved) merchant; `unitPrice` is optional because a
 *  draft row can still be missing a price the user hasn't filled in yet. */
export const PriceCheckRequestSchema = z.object({
  merchant: z.string().trim().min(1).max(200),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        unitPrice: moneySchema.optional(),
        unit: z.string().max(50).optional(),
      }),
    )
    .min(1)
    .max(DRAFT_ITEM_LIMIT),
});
export type PriceCheckRequest = z.infer<typeof PriceCheckRequestSchema>;
