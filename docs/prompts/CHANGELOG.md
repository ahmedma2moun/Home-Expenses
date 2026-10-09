# Prompt changelog

Every prompt version change is recorded here: version, hypothesis, eval metric deltas, decision.
See the `prompt-change` skill for the required procedure.

## extraction

| Version | Date | Hypothesis | Metric deltas | Decision |
|---|---|---|---|---|
| v1 | 2026-07-27 | Initial contract (PROJECT_SPEC.md §7.2) | No baseline yet | Drafted, not yet wired into code (M1) |
| v2 | 2026-08-07 | Split each item's `name` into `brand` + `name` so brand and product are distinct fields instead of one free-text string | No baseline yet — fixtures still empty | Live in code |
| v3 | 2026-08-07 | Drop `purchasedAt` from the output contract — the printed receipt date was rarely legible/reliable and the app now orders by `Order.createdAt` instead | No baseline yet — fixtures still empty | Live in code |

## extraction-on-device

Separate family from `extraction` above — runs inside the iOS app via Apple's Foundation
Models framework instead of a cloud `ExtractionProvider`. See `AI_PROVIDER.md` §10.

| Version | Date | Hypothesis | Metric deltas | Decision |
|---|---|---|---|---|
| v1 | 2026-09-27 | Offer a private/offline extraction path on Apple Intelligence-capable devices: Vision OCR + on-device Foundation Model, same output contract as the cloud path | No baseline — the `eval:extraction` harness feeds images to a cloud provider and cannot exercise this OCR-text/on-device path; unverified, not just "no fixtures yet" | Live in code |
| v2 | 2026-10-09 | Read the receipt photos directly (iOS 27 image input) instead of Vision OCR text, which garbled or dropped Arabic item names; keep names in their printed script; greedy sampling for repeatable parses | No baseline — same harness gap as v1; manual device testing only | Live in code; on-device path now iOS 27+ only, OCR path removed |

## comparison

| Version | Date | Hypothesis | Metric deltas | Decision |
|---|---|---|---|---|
| v1 | 2026-07-27 | Initial contract (PROJECT_SPEC.md §7.3) | No baseline yet | Drafted, not yet wired into code (M5) |
| v1 | 2026-08-08 | Same contract — first wiring, not a content change (`POST /analytics/compare`, Insights tab) | No baseline yet — `eval:comparison` harness added, fixtures still empty | Live in code |
