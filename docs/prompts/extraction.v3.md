# Extraction prompt — v3

**Status:** live — wired into `lib/services/extraction.ts` (`EXTRACTION_SYSTEM_PROMPT_V3`) and
called from `POST /receipts` and `POST /receipts/:id/reparse`. Keep this file and that constant in
sync per the `prompt-change` skill. Provider-agnostic — see `AI_PROVIDER.md`; the default provider
is Gemini.

**Hypothesis:** `purchasedAt` (the receipt's printed date/time) was extracted but rarely legible or
reliable — receipts crop the header, print ambiguous locale formats, or omit a date entirely — and
the field wasn't worth the misreads it introduced. `Order.createdAt` (when the user actually saved
the order) is a simpler, always-correct substitute for "when this happened," and the orders list
now sorts by it instead. Dropping `purchasedAt` from the output contract removes a source of parse
noise without losing anything the app actually uses.

## Request shape

Unchanged from v2 — one request whose content is `[image, image, …, text]`, images in `position`
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

`purchasedAt` is **removed** from this version's contract (present in v1/v2). It is no longer
extracted, stored, or returned anywhere on the wire — `Order.createdAt` (server-set, never null) is
the only date an order carries now, and the orders list sorts by it.

`brand` is nullable and optional — most produce, bakery, and unbranded items legitimately have
none. `name` never includes the brand once `brand` is non-null.

## Server-side hardening

Same as v2 (`ParsedReceiptItemSchema` in `lib/services/extraction.ts`), minus `purchasedAt`
validation, which no longer exists:

- Validate with Zod; on validation failure retry once with the validation error appended as a
  follow-up user turn ("Your output failed validation: … Return corrected JSON only.").
- Coerce unknown category slugs → `other`, clamp negative amounts, recompute `subtotal` if missing.
- `isReceipt: false` → `status = FAILED` with a user-facing message; don't burn a retry.
- Store the raw text response alongside the parsed object for debugging.
- `brand` is stored as-is (trimmed) on `OrderItem.brand`; it does **not** participate in
  `normalizedName`, so price-history/creep matching is unaffected by this change.

## Eval baseline

None yet — same gap as v1/v2: `apps/web/fixtures/receipts/` is still empty, no one has run
`npm run eval:extraction` against real fixtures. When fixtures exist, re-run the suite against v2
and v3 prompts before treating this as the new baseline (`prompt-eval-runner` agent). Removing a
field only narrows the output contract, so no regression on the remaining fields is expected, but
this is unverified without fixtures.
