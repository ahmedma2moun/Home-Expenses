---
name: review-recurring-findings
description: Recurring backend-review findings in apps/web that keep resurfacing — check these first before reading a diff in detail
metadata:
  type: project
---

Recurring findings in `apps/web` reviews. Check these before doing anything else on a diff.

1. **Merchant strings are only `trim()`-ed at write time, never case-normalized** (unlike
   `OrderItem.normalizedName`, which is `trim().toLowerCase()`). Any feature that *matches* on
   merchant (price creep, merchant-item memory, per-store grouping) silently treats
   "carrefour" and "Carrefour" as different stores. There is no `normalizeMerchant` helper yet.
2. **`OrderItem.unit` is ignored in unit-price comparisons.** Same `normalizedName` with a
   different unit (per-kg vs per-pcs) is not commensurable — comparing them produces false
   price-creep signals and a wrong "cheapest store".
3. **`lib/api/schemas/**` importing from `lib/services/**`** slips past `eslint-plugin-boundaries`
   (`default: "allow"`, only three explicit disallow policies) and drags Prisma into the validation
   layer. Pure helpers shared by schemas and services need their own dependency-free module.
4. **Unbounded `findMany`** in read-model/derived-insight services — no `take`, no `orderBy` — so
   the response grows with the user's whole history.
5. **Service unit tests mock the Prisma client without asserting the `where` clause**, so
   `userId` scoping (CLAUDE.md rule 2) is never actually verified by a test even when the code is
   correct.

6. **`Order.createdAt` (save time) is not `periodMonth` (accounting month), and the two diverge for
   backfilled/manual orders.** Any "most recent purchase" ordering that keys on `createdAt` alone
   gets the wrong "previous price" when a user scans an older receipt after a newer one. Economic
   recency in `priceHistory.ts` should sort `periodMonth desc, createdAt desc, id desc`; only the
   orders *list* (`orderQueries.ts`) legitimately sorts by `createdAt` alone.
7. **`Order` has no index on the column the list sorts by.** Indexes are `([userId, periodMonth])`
   and `([userId, merchant])`; unfiltered `GET /orders` filters on `userId` and sorts on something
   else, so it plans a sort. Flag whenever the list's sort key changes.
8. **Prompt-version docs go stale one file behind.** When `docs/prompts/extraction.vN.md` is added,
   the previous version's `**Status:** live` line is often left un-flipped to "superseded by vN".
   Check the *old* file, not just the new one.

9. **New AI service call sites drop the provider's telemetry.** `AiResult` carries
   `inputTokens`/`outputTokens`/`latencyMs`/`attempts`, and `receipts.ts`'s `logExtractionUsage`
   is the house pattern (console.debug, requestId + userId, no receipt content). A new service that
   returns only `{ payload, model }` silently kills §7.1 cost tracking on the route. Check that the
   service threads `requestId` through from `withApi` too — it usually doesn't.
10. **No shared `deadlineMs` on AI calls, and the budget exceeds the route's `maxDuration`.**
    `withRetry` defaults to a 60s deadline *per call*, so a first attempt + a correction retry is
    ~120s. `ExtractionInput` has a `deadlineMs` field; `AnalysisInput` does not. Compare the
    worst-case budget against the route's `maxDuration` on every new AI route — a hard kill means
    no `{ error }` envelope and no cache write, so every user retry re-pays for the model call.
11. **`moneyFromModelSchema` is copy-pasted per feature and coerces with `Number(...).toFixed(2)`.**
    Float math on a money field (CLAUDE.md rule 1), and now duplicated in `extraction.ts` and
    `lib/api/schemas/analytics.ts`. It belongs in `lib/api/schemas/common.ts`, normalizing strings
    without going through a float.
12. **AI-output hardening enforces less than the prompt doc claims.** `docs/prompts/*.md`'s
    "Server-side hardening" section is the contract; check each bullet against the code. Amounts in
    particular tend to go unvalidated while categories get filtered.
13. **AI cache keys hash only the data, not the prompt version.** `MonthComparison.dataVersion`
    hashes the aggregates, so bumping a prompt to vN+1 keeps serving vN narratives until the
    numbers change.

14. **Two incompatible definitions of "spent" now coexist.** The materialized summaries
    (`MonthlySummary`/`WeeklySummary`/`ProteinMonthlySummary`) are *item-based*: Σ`lineTotal`,
    no tax, no discount, no `Order.actualPaid`, and `WeeklySummary` also *excludes* protein items.
    Anything reading `Order` directly (e.g. budgets' `SUM(COALESCE(actualPaid, total))`) is
    *order-cash*: includes tax/discount/`actualPaid` and protein. Never add or subtract across the
    two bases, and never compare a target set in one basis against spend in the other. Any new
    money figure must say which basis it's on.
15. **`moneySchema` accepts negatives** — `MONEY_RE` is `/^-?\d+\.\d{2}$/`, and it has no digit cap
    against `Decimal(12,2)`. Fine for `discount`, wrong for budgets/`actualPaid`. Every new money
    field needs its own `.refine(nonNegative)` (and, for user-typed values, a max) or it accepts
    `"-600.00"` and a 13-digit overflow that surfaces as a 500, not a 400.
16. **A partial/optional-target aggregate compares apples to a full-month denominator.** Per-week
    figures correctly go `null` when unbudgeted; the consolidated month figure keeps summing spend
    over everything. Whenever a roll-up mixes "set" and "unset" targets, check what its `remaining`
    reads when only *one* part is budgeted.

17. **Only one side of a `COALESCE(a, b)` gets its validation tightened.** `budgets.ts` sums
    `COALESCE(actualPaid, total)`, and `actualPaid` was moved to `nonNegativeMoneySchema` while
    `total` stayed on the negative-accepting, uncapped `moneySchema` — so the fallback branch still
    admits `"-500.00"`. Whenever a new aggregate starts consuming a column, re-check *every* column
    in that expression, not just the new one. Extends item 15.
18. **`docs/api.md` JSON examples go one fix behind the prose.** After a math fix the paragraph gets
    rewritten and the sample response beside it keeps the old numbers — and the iOS DTOs are written
    against the sample, not the paragraph. Recompute every example by hand against the new rule
    (same failure mode as item 8's prompt docs).
19. **A "reuse the row the caller already fetched" dedup silently serializes a parallel read.**
    Passing an already-fetched row into a service as an optional param forces that service's whole
    query batch out of the caller's `Promise.all` and behind it. Saving one PK lookup is not worth a
    round trip — check whether the `await` moved outside the `Promise.all`.

**Why:** these are systematic gaps in this codebase's shape, not one-off mistakes, and each has
been found in at least one review. Items 1, 2, 5, 6, 9, 10 and 14 are the ones most likely to be a
real bug.

**How to apply:** grep the diff for `merchant ===`, `groupBy(["merchant"])`, `unitPrice`,
`findMany`, `createdAt`, `lib/api/schemas` imports, `inputTokens`, `deadlineMs`, `maxDuration`,
`moneySchema`, `spentAmount`/`totalAmount`, `COALESCE`, and `Promise.all` before line-by-line
reading. On a *re-review*, recompute the `docs/api.md` examples by hand — the prose usually gets
fixed and the JSON beside it usually does not. See [[review-auth-is-dev-stub]] for the one finding that should *not*
be re-raised as blocking.
