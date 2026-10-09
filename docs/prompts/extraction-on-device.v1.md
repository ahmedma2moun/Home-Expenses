# On-device extraction prompt — v1

**Status:** superseded by `extraction-on-device.v2.md` (image input, iOS 27+). Kept for history;
was wired into `apps/ios/HomeExpenses/Core/AI/OnDeviceReceiptExtractor.swift`
(`OnDeviceReceiptExtractor.instructions(categorySlugs:)`), called from the Capture screen when the
user picks the "On This iPhone" extraction option instead of the default cloud path. Keep this file
and that string in sync per the `prompt-change` skill. See `AI_PROVIDER.md` §10 for how this path
fits alongside the cloud `ExtractionProvider`s.

**This is a separate prompt family from `extraction.vN.md`, not a continuation of it.** The cloud
prompts (`extraction.v3.md` current) are given the receipt **images** directly — vision input. This
prompt is given **OCR text** (`VNRecognizeTextRequest` output, run on-device first) — the on-device
Foundation Model is text-only. Expect lower accuracy on cluttered layouts, handwriting, faint print,
or anything OCR misreads, since the model can never look at the image to disambiguate.

## Request shape

One `LanguageModelSession`, instructions set at session creation (this prompt, with the current
active category slugs interpolated in), a single `respond(to:generating:)` call per receipt whose
prompt is the OCR text of all of the receipt's images concatenated in `position` order, separated by
`"\n---\n"`. Structured output via `@Generable`/`@Guide` (`GeneratedReceipt`/`GeneratedItem` in
`OnDeviceReceiptExtractor.swift`), not a JSON-in-prose contract — the framework enforces the shape,
so there is no "no prose, no markdown fences" instruction to give here the way the cloud prompt needs.

## Instructions

> You extract structured data from OCR text of a retail receipt. Read every line item. Never invent
> a price you cannot read: set it to null and lower confidence. Assign each item exactly one
> category slug from this allowed list: {categorySlugs, comma-separated, fetched from `GET
> /api/v1/categories` at capture time — never hardcoded, so it can't drift from the server's
> taxonomy}. Prefer the most specific matching category; use "other" only when nothing fits. If the
> text is not a receipt, set isReceipt to false.

Deliberately narrower than the cloud prompt (`extraction.v3.md`): no brand/name-splitting guidance,
no currency-inference-from-locale instruction. OCR text alone rarely carries enough visual layout
signal (logo position, font weight) to reliably separate brand from item name the way the vision
model can from the image, so v1 keeps `brand` in the output shape (for schema parity with
`ParsedReceiptSchema`) but doesn't specifically coach the model to populate it — expect it null more
often than the cloud path.

## Output contract

Identical to `ParsedReceiptSchema` (`apps/web/lib/api/schemas/receipts.ts`) — same field names,
same nullability — except every money field is `String` in the `@Generable` struct rather than
`Decimal`: Apple's Foundation Models framework does not support `Decimal` as a generable field type,
and the wire format is a string anyway (CLAUDE.md rule 1). `OnDeviceReceiptExtractor.map(_:)` converts
each money string into `MoneyString` (backed by `Decimal`) via `MoneyString(wireString:)` before it
ever reaches `ParsedReceiptDTO` — the app-side type never sees a raw unparsed string.

```json
{
  "isReceipt": true,
  "merchant": "Carrefour",
  "currency": "EGP",
  "items": [
    {
      "name": "Full Cream Milk",
      "brand": null,
      "quantity": 1,
      "unit": "L",
      "unitPrice": "45.00",
      "lineTotal": "45.00",
      "category": "dairy_eggs",
      "confidence": 0.7
    }
  ],
  "subtotal": "612.00",
  "tax": "38.00",
  "discount": "0.00",
  "total": "650.00",
  "warnings": [],
  "overallConfidence": 0.7
}
```

## Server-side hardening

Same as the cloud path, and for the same reason — the client is not trusted just because it's the
phone's own model:

- `POST /api/v1/receipts`'s `ReceiptCreateRequestSchema` validates `clientParsedPayload` against
  the exact same `ParsedReceiptSchema` the cloud path's output goes through.
- Coerce unknown category slugs → `other` (`normalizeParsedPayload` in `lib/services/receipts.ts`,
  shared with the cloud path).
- `isReceipt: false` → `status = FAILED`, same user-facing message as the cloud path.
- No retry-on-validation-failure loop exists for this path (unlike the cloud path's one correction
  retry) — a `clientParsedPayload` that fails `ParsedReceiptSchema` is a `400` at request time, and
  the iOS client's fallback is to resubmit via the cloud path (`extractionMode: "cloud"`), not to
  retry on-device with a corrective follow-up turn.

## Eval baseline

**None — and the existing harness can't run this prompt as-is.** `npm run eval:extraction`
(`prompt-eval-runner` agent) feeds labelled receipt *images* to the configured cloud
`ExtractionProvider`; this prompt takes OCR text and runs inside the iOS app via
`LanguageModelSession`, which the Node-side eval harness has no way to invoke. Evaluating this
version needs either an on-device/simulator-driven harness or a small offline shim that replays
`VNRecognizeTextRequest` output through the same instructions — neither exists yet. Treat this as
unverified, not merely "no baseline yet" like the cloud prompts' fixture gap.
