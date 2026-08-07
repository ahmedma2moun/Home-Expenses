# Month comparison prompt — v1

**Status:** live — wired into `lib/services/monthComparison.ts` and `lib/services/prompts.ts`
(`COMPARISON_SYSTEM_PROMPT_V1`), served by `POST /analytics/compare`. Provider-agnostic — see
`AI_PROVIDER.md`; the default provider is Gemini. The "baseline" mode (comparing against a
trailing 3-month average instead of a second real month) needed no change to this prompt — the
average is built server-side into the same `monthA` shape as a real month, so this contract is
unchanged either way.

**Hypothesis:** first version — no prior baseline to improve on. Establishes the comparison
contract in PROJECT_SPEC.md §7.3. The model receives aggregates only, never raw items or receipt
images — cheaper, faster, and less sensitive data leaves the system.

## Input shape

Compact aggregate JSON built server-side from two `MonthlySummary` rows:

```json
{
  "currency": "EGP",
  "monthA": {
    "label": "2026-05",
    "total": "18240.00",
    "orders": 21,
    "byCategory": { "produce": "2100.00", "dining": "3400.00" },
    "topMerchants": [{ "name": "Carrefour", "total": "6100.00" }]
  },
  "monthB": { "label": "2026-06", "total": "21980.00", "orders": 26, "...": "..." },
  "deltas": { "totalPct": 20.5, "byCategoryPct": { "dining": 61.2, "produce": null } }
}
```

`deltas.byCategoryPct` (and `totalPct`) is `null`, not `100`, when the "before" side is zero and
the "after" side isn't — a category with no spend last month is new, not "up 100%".

## System prompt

> You compare two months of household spending using only the aggregate numbers provided. Return
> JSON with `headline` (≤ 20 words), `drivers[]` (category, direction, amount, one-sentence
> explanation), `anomalies[]`, `suggestions[]` (2–4, concrete and tied to the numbers), and
> `confidence`. A null value in `deltas.byCategoryPct` means that category is new this month —
> describe it as new rather than as a percentage change. You must not invent categories or amounts
> not present in the input, and must not moralize about the user's spending.

## Output contract

```json
{
  "headline": "Dining drove the increase, up 61% on more takeout orders.",
  "drivers": [
    { "category": "dining", "direction": "up", "amount": "1300.00", "explanation": "..." }
  ],
  "anomalies": ["..."],
  "suggestions": ["...", "..."],
  "confidence": 0.85
}
```

## Server-side hardening

- Reject any category in the output that doesn't trace back to the input aggregate — a driver
  naming an unknown category slug is dropped, not fixed. (Amounts aren't independently
  re-validated against a computed delta; the model only ever sees real numbers, so this is
  deliberately category-only rather than risking a false-positive drop over rounding.)
- Cache the result in `MonthComparison` keyed by `(userId, monthA, monthB, dataVersion)`, where
  `dataVersion` also hashes the prompt version — changing this prompt invalidates every cached
  narrative even for months whose numbers haven't changed (CLAUDE.md rule 9).

## Eval baseline

None yet — `npm run eval:comparison` exists (mirrors `eval:extraction`'s current shape) but
`fixtures/comparisons/` is empty. Add hand-labelled fixtures there before scoring is meaningful.
