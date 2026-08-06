import { z } from "zod";
import { clientRefSchema, moneySchema, monthLabelSchema } from "@/lib/api/schemas/common";
import { OrderItemInputSchema } from "@/lib/api/schemas/orders";

// No blob storage: images travel as base64 in the request body and are used once, in memory, for
// the extraction call — never persisted (PROJECT_SPEC.md §2's direct-to-blob path is superseded).
// ~3,000,000 base64 chars ≈ 2.2 MB raw per image; kept well under Vercel's ~4.5 MB request-body
// ceiling for the whole payload since client-side downscaling (BR-1) keeps real files far smaller.
const MAX_IMAGE_BASE64_LENGTH = 3_000_000;
const MAX_IMAGES = 6;

export const ReceiptImageInputSchema = z.object({
  base64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
  position: z.number().int().min(0),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
export type ReceiptImageInput = z.infer<typeof ReceiptImageInputSchema>;

/** Rule 3 applies to path params too — an id reaches Prisma, so it is validated like any input. */
export const ReceiptIdParamSchema = z.object({ id: z.string().min(1).max(64) });

export const ReceiptCreateRequestSchema = z.object({
  clientRef: clientRefSchema,
  images: z.array(ReceiptImageInputSchema).min(1).max(MAX_IMAGES),
});
export type ReceiptCreateRequest = z.infer<typeof ReceiptCreateRequestSchema>;

export const ReparseRequestSchema = z.object({
  images: z.array(ReceiptImageInputSchema).min(1).max(MAX_IMAGES),
});
export type ReparseRequest = z.infer<typeof ReparseRequestSchema>;

// BR-3: the backend trusts the client's final, user-edited payload — not the AI parse. The line
// shape itself lives in schemas/orders.ts, shared with the order edit request.
export const ConfirmReceiptRequestSchema = z.object({
  // Blank is accepted: plenty of receipts have no legible merchant (cropped photo, logo-only
  // header), and losing a whole confirmed order to a 400 is worse than storing a placeholder.
  // `confirmReceipt` substitutes UNKNOWN_MERCHANT — the wire contract stays "a string".
  merchant: z.string().trim().max(200),
  periodMonth: monthLabelSchema,
  currency: z.string().min(1).max(8),
  subtotal: moneySchema,
  tax: moneySchema.default("0.00"),
  discount: moneySchema.default("0.00"),
  total: moneySchema,
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(OrderItemInputSchema).min(1).max(200),
});
export type ConfirmReceiptRequest = z.infer<typeof ConfirmReceiptRequestSchema>;
