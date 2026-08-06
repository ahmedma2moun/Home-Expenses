# Extraction prompt — v2

**Status:** live — wired into `lib/services/extraction.ts` (`EXTRACTION_SYSTEM_PROMPT_V2`) and
called from `POST /receipts` and `POST /receipts/:id/reparse`. Keep this file and that constant in
sync per the `prompt-change` skill. Provider-agnostic — see `AI_PROVIDER.md`; the default provider
is Gemini.

**Hypothesis:** splitting each item's `name` into a separate `brand` and `name` improves
downstream matching and readability — e.g. "The Milkman Full Cream Milk - 1 Liter" should extract
as `brand: "Milkman"`, `name: "Full Cream Milk"`, `unit: "L"`, `quantity: 1`, rather than folding
the brand and size into one free-text string. `brand` is display-only: item price-history/creep
matching stays keyed on the item name alone (`OrderItem.normalizedName`), unchanged from v1.

## Request shape

Unchanged from v1 — one request whose content is `[image, image, …, text]`, images in `position`
order, sent as base64 with the correct MIME type, all images of one receipt in a single request.

## System prompt

> You extract structured data from retail receipt images. The images provided are pages/parts of a
> **single** receipt, in order. Read every line item. For each item, separate the **brand**
> (manufacturer or product-line name, e.g. "Milkman", "Coca-Cola", a store's own private label)
> from the **item name** (what the product actually is, e.g. "Full Cream Milk", "Diet Cola"). Set
> `brand` to `null` when no brand is printed or legible — do not guess one, and do not use the
> merchant/store name as the brand. Never fold size or pack count into either field: that belongs
> in `quantity`/`unit`. Return **only** a JSON object matching the schema — no prose, no markdown
> fences. Never invent a price you cannot read: set the value to `null` and lower the confidence.
> Assign each item exactly one category slug from the allowed list. Prefer the most specific
> matching category; use `other` only when nothing fits. Currency is read from the receipt
> symbol/text; if absent, infer from merchant/locale and mark low confidence.

## Output contract

```json
{
  "isReceipt": true,
  "merchant": "Carrefour",
  "purchasedAt": "2026-07-14T18:32:00",
  "currency": "EGP",
  "items": [
    {
      "name": "Full Cream Milk",
      "brand": "Milkman",
      "quantity": 1,
      "unit": "L",
      "unitPrice": "45.00",
      "lineTotal": "45.00",
      "category": "dairy_eggs",
      "confidence": 0.94
    },
    {
      "name": "Tomatoes",
      "brand": null,
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

`brand` is nullable and optional — most produce, bakery, and unbranded items legitimately have
none. `name` never includes the brand once `brand` is non-null.

## Server-side hardening

Same as v1 (`ParsedReceiptItemSchema` in `lib/services/extraction.ts`):

- Validate with Zod; on validation failure retry once with the validation error appended as a
  follow-up user turn ("Your output failed validation: … Return corrected JSON only.").
- Coerce unknown category slugs → `other`, clamp negative amounts, recompute `subtotal` if missing.
- `isReceipt: false` → `status = FAILED` with a user-facing message; don't burn a retry.
- Store the raw text response alongside the parsed object for debugging.
- `brand` is stored as-is (trimmed) on `OrderItem.brand`; it does **not** participate in
  `normalizedName`, so price-history/creep matching is unaffected by this change.

## Eval baseline

None yet — same gap as v1: `apps/web/fixtures/receipts/` is still empty, no one has run
`npm run eval:extraction` against real fixtures. When fixtures exist, re-run the suite against both
v1 and v2 prompts before treating this as the new baseline (`prompt-eval-runner` agent).
