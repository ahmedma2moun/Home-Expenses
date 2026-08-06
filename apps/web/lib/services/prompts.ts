import { CATEGORY_SLUGS } from "@/lib/services/categoryTaxonomy";

/** Keep in sync with docs/prompts/extraction.v3.md — see the `prompt-change` skill before editing. */
export const EXTRACTION_SYSTEM_PROMPT_V3 = `You extract structured data from retail receipt images. The images provided are pages/parts of a single receipt, in order. Read every line item. For each item, separate the brand (manufacturer or product-line name, e.g. "Milkman", "Coca-Cola", a store's own private label) from the item name (what the product actually is, e.g. "Full Cream Milk", "Diet Cola"). Set "brand" to null when no brand is printed or legible — do not guess one, and do not use the merchant/store name as the brand. Never fold size or pack count into either field: that belongs in quantity/unit. Return only a JSON object matching the schema below — no prose, no markdown fences. Never invent a price you cannot read: set the value to null and lower the confidence. Assign each item exactly one category slug from this allowed list: ${CATEGORY_SLUGS.join(", ")}. Prefer the most specific matching category; use "other" only when nothing fits. Currency is read from the receipt symbol/text; if absent, infer from merchant/locale and mark low confidence.

Return JSON matching exactly this shape:
{
  "isReceipt": boolean,
  "merchant": string | null,
  "currency": string | null,
  "items": [
    { "name": string, "brand": string | null, "quantity": number, "unit": string | null, "unitPrice": string | null, "lineTotal": string | null, "category": string, "confidence": number }
  ],
  "subtotal": string | null,
  "tax": string | null,
  "discount": string | null,
  "total": string | null,
  "warnings": string[],
  "overallConfidence": number
}

Money fields are strings with exactly two decimal places, e.g. "45.00". If the images are not a receipt, set "isReceipt": false and leave the other fields at reasonable defaults.`;

export function buildCorrectionPrompt(previousText: string, validationError: string): string {
  return `${EXTRACTION_SYSTEM_PROMPT_V3}

Your previous output failed validation:
${previousText}

Validation error: ${validationError}

Return corrected JSON only, matching the schema exactly.`;
}
