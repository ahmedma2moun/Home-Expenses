import { CATEGORY_SLUGS } from "@/lib/services/categoryTaxonomy";

/** Keep in sync with docs/prompts/extraction.v1.md — see the `prompt-change` skill before editing. */
export const EXTRACTION_SYSTEM_PROMPT_V1 = `You extract structured data from retail receipt images. The images provided are pages/parts of a single receipt, in order. Read every line item. Return only a JSON object matching the schema below — no prose, no markdown fences. Never invent a price you cannot read: set the value to null and lower the confidence. Assign each item exactly one category slug from this allowed list: ${CATEGORY_SLUGS.join(", ")}. Prefer the most specific matching category; use "other" only when nothing fits. Currency is read from the receipt symbol/text; if absent, infer from merchant/locale and mark low confidence.

Return JSON matching exactly this shape:
{
  "isReceipt": boolean,
  "merchant": string | null,
  "purchasedAt": string | null,
  "currency": string | null,
  "items": [
    { "name": string, "quantity": number, "unit": string | null, "unitPrice": string | null, "lineTotal": string | null, "category": string, "confidence": number }
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
  return `${EXTRACTION_SYSTEM_PROMPT_V1}

Your previous output failed validation:
${previousText}

Validation error: ${validationError}

Return corrected JSON only, matching the schema exactly.`;
}
