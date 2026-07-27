import { z } from "zod";
import { moneySchema, monthLabelSchema } from "@/lib/api/schemas/common";

const MAX_ITEMS_PER_ORDER = 200;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/**
 * One order line as the client sends it. Shared by the receipt-confirm request (BR-3) and the
 * order edit request (BR-4) — an order item has the same shape however it enters the system.
 *
 * `quantity` is a JSON number, not a money string: it is a count/weight, not an amount, and the
 * two are deliberately different on the wire so a `parseFloat` on money stays impossible.
 * `aiCategoryId` is the AI's original suggestion echoed back for the learning-loop dataset
 * (ItemCategoryOverride); omit it for items the user added by hand.
 */
export const OrderItemInputSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.coerce.number().positive().default(1),
  unit: z.string().min(1).max(20).nullable().optional(),
  unitPrice: moneySchema.nullable().optional(),
  lineTotal: moneySchema,
  categoryId: z.string().min(1),
  aiCategoryId: z.string().min(1).nullable().optional(),
  position: z.number().int().min(0),
});
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;

/** `GET /orders?month=YYYY-MM&cursor=&limit=` — `month` omitted lists every month. */
export const OrderListQuerySchema = z.object({
  month: monthLabelSchema.optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

/**
 * `PATCH /orders/:id`. Every field is optional — an omitted field is left untouched, which is what
 * separates "clear the notes" (`null`) from "don't touch the notes" (absent).
 *
 * `items` replaces the whole line-item list rather than patching individual rows: the edit screen
 * owns the list (reorder, delete, add), and diffing it row-by-row over the wire would need stable
 * item ids the client doesn't have for rows it just created.
 */
export const OrderUpdateRequestSchema = z
  .object({
    // Blank is accepted for the same reason as on confirm — a receipt with no legible merchant is
    // stored under a placeholder rather than costing the user their edit.
    merchant: z.string().trim().max(200).optional(),
    purchasedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    periodMonth: monthLabelSchema.optional(),
    currency: z.string().min(1).max(8).optional(),
    subtotal: moneySchema.optional(),
    tax: moneySchema.optional(),
    discount: moneySchema.optional(),
    total: moneySchema.optional(),
    notes: z.string().max(2000).nullable().optional(),
    items: z.array(OrderItemInputSchema).min(1).max(MAX_ITEMS_PER_ORDER).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "Provide at least one field to update.",
  })
  // Replacing the items changes what the order is worth. Letting the stored totals stay behind
  // would leave the order self-inconsistent, so the client must restate them alongside.
  .refine((input) => input.items === undefined || (!!input.subtotal && !!input.total), {
    message: "subtotal and total are required when items are replaced.",
    path: ["total"],
  });
export type OrderUpdateRequest = z.infer<typeof OrderUpdateRequestSchema>;
