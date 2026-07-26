import { z } from "zod";
import { clientRefSchema, moneySchema, monthLabelSchema } from "@/lib/api/schemas/common";

export const ReceiptImageInputSchema = z.object({
  blobKey: z.string().min(1),
  position: z.number().int().min(0),
  mimeType: z.string().min(1),
});

export const ReceiptCreateRequestSchema = z.object({
  clientRef: clientRefSchema,
  images: z.array(ReceiptImageInputSchema).min(1).max(10),
});
export type ReceiptCreateRequest = z.infer<typeof ReceiptCreateRequestSchema>;

// BR-3: the backend trusts the client's final, user-edited payload — not the AI parse. `aiCategoryId`
// is the AI's original suggestion for this item (if any), echoed back by the client for the
// learning-loop dataset (ItemCategoryOverride); omit it for items the user added by hand.
export const ConfirmOrderItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.coerce.number().positive().default(1),
  unit: z.string().min(1).max(20).nullable().optional(),
  unitPrice: moneySchema.nullable().optional(),
  lineTotal: moneySchema,
  categoryId: z.string().min(1),
  aiCategoryId: z.string().min(1).nullable().optional(),
  position: z.number().int().min(0),
});
export type ConfirmOrderItem = z.infer<typeof ConfirmOrderItemSchema>;

export const ConfirmReceiptRequestSchema = z.object({
  merchant: z.string().min(1).max(200),
  purchasedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  periodMonth: monthLabelSchema,
  currency: z.string().min(1).max(8),
  subtotal: moneySchema,
  tax: moneySchema.default("0.00"),
  discount: moneySchema.default("0.00"),
  total: moneySchema,
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(ConfirmOrderItemSchema).min(1).max(200),
});
export type ConfirmReceiptRequest = z.infer<typeof ConfirmReceiptRequestSchema>;
