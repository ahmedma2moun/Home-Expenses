# Prompt changelog

Every prompt version change is recorded here: version, hypothesis, eval metric deltas, decision.
See the `prompt-change` skill for the required procedure.

## extraction

| Version | Date | Hypothesis | Metric deltas | Decision |
|---|---|---|---|---|
| v1 | 2026-07-27 | Initial contract (PROJECT_SPEC.md §7.2) | No baseline yet | Drafted, not yet wired into code (M1) |
| v2 | 2026-08-07 | Split each item's `name` into `brand` + `name` so brand and product are distinct fields instead of one free-text string | No baseline yet — fixtures still empty | Live in code |
| v3 | 2026-08-07 | Drop `purchasedAt` from the output contract — the printed receipt date was rarely legible/reliable and the app now orders by `Order.createdAt` instead | No baseline yet — fixtures still empty | Live in code |

## comparison

| Version | Date | Hypothesis | Metric deltas | Decision |
|---|---|---|---|---|
| v1 | 2026-07-27 | Initial contract (PROJECT_SPEC.md §7.3) | No baseline yet | Drafted, not yet wired into code (M5) |
| v1 | 2026-08-08 | Same contract — first wiring, not a content change (`POST /analytics/compare`, Insights tab) | No baseline yet — `eval:comparison` harness added, fixtures still empty | Live in code |
