# On-device extraction prompt — v2

**Status:** live — wired into `apps/ios/HomeExpenses/Core/AI/OnDeviceReceiptExtractor.swift`
(`OnDeviceReceiptExtractor.instructions(categorySlugs:)` plus the `@Guide` descriptions on
`GeneratedReceipt`/`GeneratedItem`), called from the Capture screen when the user picks "On This
iPhone". Keep this file and that code in sync per the `prompt-change` skill. See `AI_PROVIDER.md` §10.

## Hypothesis

v1 gave the model Vision OCR text, not the image. On Arabic receipts the OCR step was the failure
point: with no recognition languages set it produced Latin-diacritic garbage (`232.5îșîŚš`) or dropped
the Arabic item names entirely, leaving the model to name items after their prices. Even with Arabic
enabled, the model could never look at the receipt to disambiguate a misread. From iOS 27 the
on-device model accepts image input, so v2 removes the OCR step and lets the model read the photos
directly — the same shape as the cloud path — and should fix garbled/missing item names on Arabic and
mixed Arabic/English receipts. Greedy sampling is added so the same photos give the same parse.

## Request shape

One `LanguageModelSession`, instructions set at session creation (below, with the current active
category slugs interpolated), a single `respond(generating:options:)` call per receipt with
`GenerationOptions(sampling: .greedy)`. The prompt is one line of text followed by one image
`Attachment` per captured photo in `position` order, each downscaled to the upload long edge
(`ImagePreprocessor.maxDimension`, 1568px):

> The receipt, one photo per page, in reading order:

Structured output via `@Generable`/`@Guide`, unchanged from v1 except two guide descriptions now refer
to the photos/receipt instead of "the text".

## Instructions

> You extract structured data from photos of a retail receipt. The receipt may be in Arabic, English,
> or both; copy item names in the language and script printed on the receipt, never transliterated or
> translated. Read every line item. Never invent a price you cannot read: set it to null and lower
> confidence. Assign each item exactly one category slug from this allowed list: {categorySlugs,
> comma-separated, fetched from `GET /api/v1/categories` at capture time}. Prefer the most specific
> matching category; use "other" only when nothing fits. If the photos are not of a receipt, set
> isReceipt to false.

Changes from v1: "OCR text of a retail receipt" → "photos of a retail receipt"; the Arabic/English
script instruction is new; "If the text is not a receipt" → "If the photos are not of a receipt".

## Output contract

Unchanged from v1 — identical to `ParsedReceiptSchema`, money as strings converted through
`MoneyString(wireString:)`. No Zod, Review screen or DTO change.

## Limits

- **Context window:** 8K tokens on-device, shared by instructions, schema, images and output. A long
  receipt split over several photos can exceed it → `OnDeviceExtractionError.tooLarge` ("try fewer
  photos, or use Cloud").
- **Availability:** iOS 27+ with Apple Intelligence on and its model ready. iOS 26 devices no longer
  get on-device extraction at all (v1's OCR path is removed, not kept as a fallback).

## Eval baseline

**None.** Same gap as v1: `npm run eval:extraction` calls a cloud `ExtractionProvider` from Node and
cannot drive `LanguageModelSession` on a device. Verified only by manual testing on device.
