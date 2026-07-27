---
name: project-review-recurring-findings
description: Running list of non-blocking issues that keep recurring in apps/web backend diffs — check these first in later reviews
metadata:
  type: project
---

Issues found more than once in `apps/web` reviews. Check these before doing a full pass — they are
the fast wins, and the blocking checks (userId scoping, Zod, envelope, Decimal money, layering)
have so far been clean.

**Why:** The hard rules in CLAUDE.md are well internalised and lint/boundaries catch most of them;
the recurring gaps are all in the "conventions" tier that nothing enforces automatically.

**How to apply:** Grep/scan the diff for these first, then do the blocking checklist.

- **Load-bearing sort order without a tie-break.** Services sort aggregates by a money `Decimal`
  and the iOS side consumes the array order (chart colors, ranking). Prisma `findMany` without
  `orderBy` + a comparator with no secondary key = arbitrary order on ties, which can change
  between requests. Ask for `orderBy` on the query *and* a `categoryId` tie-break.
  (Seen: `getTrends` in `lib/services/analytics.ts`, 2026-07-27.)
- **Service functions read the clock directly** (`new Date()` inside the function) instead of
  taking `now` as a parameter, the way `suggestPeriodMonth(purchasedAt, now)` in
  `lib/services/period.ts` does. Makes the rolling-window math impossible to pin in a test.
  (Seen: `getTrends`, 2026-07-27.)
- **Aggregation functions drift past the 40-line limit** — the map/reduce over month buckets wants
  to be its own `buildXSeries` helper. (Seen: `getTrends`, 2026-07-27.)
- **`z.infer` query types exported from `lib/api/schemas/**` but never imported**, because the
  handler destructures the parsed object instead of passing it to the service. `knip` flags these.
  Either pass the whole query object (as `app/api/v1/orders/route.ts` does with `listOrders`) or
  drop the type export. (Seen: `TrendsQuery`, 2026-07-27.)
- **`docs/api.md` examples truncated in a way that contradicts the prose right above them**, and
  new sections omitting the `400` validation cases that sibling sections document.
  (Seen: trends section, 2026-07-27.)

See [[project-review-calibration]] for what NOT to flag.
