# Month comparison prompt — v1

**Status:** not yet wired into code (ships in M5, `lib/ai/*`). Recorded here first so the
prompt is versioned from the start, per the `prompt-change` skill. Provider-agnostic — see
`AI_PROVIDER.md`; the default provider is Gemini.

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
  "deltas": { "totalPct": 20.5, "byCategoryPct": { "dining": 61.2, "produce": -4.1 } }
}
```

## System prompt

> You compare two months of household spending using only the aggregate numbers provided. Return
> JSON with `headline` (≤ 20 words), `drivers[]` (category, direction, amount, one-sentence
> explanation), `anomalies[]`, `suggestions[]` (2–4, concrete and tied to the numbers), and
> `confidence`. You must not invent categories or amounts not present in the input, and must not
> moralize about the user's spending.

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

- Reject any category or amount in the output that doesn't trace back to the input aggregate.
- Cache the result in `MonthComparison` keyed by `(userId, monthA, monthB, dataVersion)`.

## Eval baseline

None yet — comparison ships in M5.
