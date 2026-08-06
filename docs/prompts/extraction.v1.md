# Extraction prompt — v1

**Status:** superseded by [`extraction.v2.md`](./extraction.v2.md) — `lib/services/extraction.ts`
now calls `EXTRACTION_SYSTEM_PROMPT_V2`. Kept for history; do not wire this version back in.

**Hypothesis:** first version — no prior baseline to improve on. Establishes the extraction
contract in PROJECT_SPEC.md §7.2 (now served through the provider interface in `AI_PROVIDER.md`).

## Request shape

One request whose content is `[image, image, …, text]`, images in `position` order, sent as
base64 with the correct MIME type. All images belonging to one receipt are sent in a single
request to whichever provider is configured (`ExtractionProvider.extract`, `lib/ai/types.ts`).

## System prompt

> You extract structured data from retail receipt images. The images provided are pages/parts of a
> **single** receipt, in order. Read every line item. Return **only** a JSON object matching the
> schema — no prose, no markdown fences. Never invent a price you cannot read: set the value to
> `null` and lower the confidence. Assign each item exactly one category slug from the allowed list.
> Prefer the most specific matching category; use `other` only when nothing fits. Currency is read
> from the receipt symbol/text; if absent, infer from merchant/locale and mark low confidence.

## Output contract

```json
{
  "isReceipt": true,
  "merchant": "Carrefour",
  "purchasedAt": "2026-07-14T18:32:00",
  "currency": "EGP",
  "items": [
    {
      "name": "Tomatoes 1kg",
      "quantity": 2,
      "unit": "kg",
      "unitPrice": "22.50",
      "lineTotal": "45.00",
      "category": "produce",
      "confidence": 0.94
    }
  ],
  "subtotal": "612.00",
  "tax": "38.00",
  "discount": "0.00",
  "total": "650.00",
  "warnings": ["Line 12 price is cropped and was not read"],
  "overallConfidence": 0.88
}
```

## Server-side hardening

- Validate with Zod; on validation failure retry once with the validation error appended as a
  follow-up user turn ("Your output failed validation: … Return corrected JSON only.").
- Coerce unknown category slugs → `other`, clamp negative amounts, recompute `subtotal` if missing.
- `isReceipt: false` → `status = FAILED` with a user-facing message; don't burn a retry.
- Store the raw text response alongside the parsed object for debugging.

## Eval baseline

None yet — `apps/web/fixtures/receipts/` is still empty even though the prompt is live in code; no
one has run `npm run eval:extraction` against real fixtures yet. See `apps/web/fixtures/baseline.json`
(currently all-`null` placeholders) and the `prompt-eval-runner` agent.
