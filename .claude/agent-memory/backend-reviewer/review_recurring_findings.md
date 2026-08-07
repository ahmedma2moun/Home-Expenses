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

**Why:** these are systematic gaps in this codebase's shape, not one-off mistakes, and each has
been found in at least one review. Items 1, 2, 5, 6, 9 and 10 are the ones most likely to be a real
bug.

**How to apply:** grep the diff for `merchant ===`, `groupBy(["merchant"])`, `unitPrice`,
`findMany`, `createdAt`, `lib/api/schemas` imports, `inputTokens`, `deadlineMs`, and `maxDuration`
before line-by-line reading. See [[review-auth-is-dev-stub]] for the one finding that should *not*
be re-raised as blocking.
