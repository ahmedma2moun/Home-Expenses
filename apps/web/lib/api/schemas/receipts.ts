import { z } from "zod";
import {
  clientRefSchema,
  moneySchema,
  monthLabelSchema,
  nonNegativeMoneySchema,
  periodWeekSchema,
} from "@/lib/api/schemas/common";
import { OrderItemInputSchema } from "@/lib/api/schemas/orders";

const confidenceSchema = z.coerce.number().min(0).max(1).nullable().optional();

// Strict, size-capped wire schema for `clientParsedPayload` (the on-device extraction result,
// AI_PROVIDER.md §10). Deliberately a *separate* schema from the cloud AI-output parser
// (`ParsedReceiptSchema` in lib/services/extraction.ts): that one exists to tolerate a model's
// occasional bare-number-instead-of-string money field, which is leniency a client request has no
// business needing. Money here is `nonNegativeMoneySchema` (no coercion from numbers, no rounding of
// odd input) so a malformed amount is rejected with a 400 instead of silently reformatted and stored.
const ClientParsedReceiptItemSchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().min(1).max(200).nullable().optional(),
  quantity: z.coerce.number().positive().nullable().default(1),
  unit: z.string().max(50).nullable().optional(),
  unitPrice: nonNegativeMoneySchema.nullable(),
  lineTotal: nonNegativeMoneySchema.nullable(),
  category: z.string().min(1).max(100),
  confidence: confidenceSchema,
});

export const ClientParsedReceiptSchema = z.object({
  isReceipt: z.boolean(),
  merchant: z.string().max(200).nullable().optional(),
  currency: z.string().min(1).max(8).nullable().optional(),
  items: z.array(ClientParsedReceiptItemSchema).max(200).default([]),
  subtotal: nonNegativeMoneySchema.nullable(),
  tax: nonNegativeMoneySchema.nullable(),
  discount: nonNegativeMoneySchema.nullable(),
  total: nonNegativeMoneySchema.nullable(),
  warnings: z.array(z.string().max(300)).max(20).default([]),
  overallConfidence: confidenceSchema,
});
export type ClientParsedReceipt = z.infer<typeof ClientParsedReceiptSchema>;

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

// "cloud" (default): the backend calls the configured AI provider (AI_PROVIDER.md). "on_device":
// the iOS Foundation Models pipeline already parsed the receipt locally — the backend validates and
// stores `clientParsedPayload` instead of making a vision call. See AI_PROVIDER.md §10.
export const ExtractionModeSchema = z.enum(["cloud", "on_device"]).default("cloud");
export type ExtractionMode = z.infer<typeof ExtractionModeSchema>;

export const DEFAULT_ON_DEVICE_MODEL = "on-device:apple-foundation-model";

export const ReceiptCreateRequestSchema = z
  .object({
    clientRef: clientRefSchema,
    images: z.array(ReceiptImageInputSchema).min(1).max(MAX_IMAGES),
    extractionMode: ExtractionModeSchema,
    // Required when extractionMode is "on_device" (enforced below) — the client's own parse,
    // validated against the strict schema above. Never trusted blindly just because it came from
    // the phone's own model.
    clientParsedPayload: ClientParsedReceiptSchema.optional(),
    // Free-form label for `Receipt.model` (e.g. `DEFAULT_ON_DEVICE_MODEL`) and the client-measured
    // OCR+generation latency for `Receipt.latencyMs` — `inputTokens`/`outputTokens` stay null for
    // this path (AI_PROVIDER.md's `AiResult`: "local models simply report null token counts").
    // `latencyMs` is capped well under `Receipt.latencyMs`'s int4 range: an unbounded value here
    // risks a Prisma int-overflow error whose message can echo back the call's other arguments,
    // including `parsedPayload` — never something to risk over an unvalidated timing number.
    clientModel: z.string().min(1).max(100).optional(),
    clientLatencyMs: z.number().int().min(0).max(600_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.extractionMode === "on_device" && !value.clientParsedPayload) {
      ctx.addIssue({
        code: "custom",
        path: ["clientParsedPayload"],
        message: 'Required when extractionMode is "on_device".',
      });
    }
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
  periodWeek: periodWeekSchema.default(1),
  currency: z.string().min(1).max(8),
  subtotal: moneySchema,
  tax: moneySchema.default("0.00"),
  discount: moneySchema.default("0.00"),
  // Non-negative: unlike discount/an adjustment line item, `total` feeds `budgets.ts`'s live
  // `COALESCE(actualPaid, total)` spend query directly — a negative total would subtract from a
  // week's spend instead of adding to it.
  total: nonNegativeMoneySchema,
  // What actually left the wallet (tip, rounding, register discount); omitted/null means "same as
  // total". Optional at confirm time — most receipts don't need it.
  actualPaid: nonNegativeMoneySchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(OrderItemInputSchema).min(1).max(200),
});
export type ConfirmReceiptRequest = z.infer<typeof ConfirmReceiptRequestSchema>;
