---
name: backend-recurring-findings
description: Recurring apps/web backend defect patterns found in the 2026-08-02 full review — check these first on any future backend review
metadata:
  type: project
---

Recurring defect classes in `apps/web` (from the full backend review on 2026-08-02). Check these
before re-deriving findings; the CLAUDE.md non-negotiables themselves are already well-honoured, so
review time is better spent here.

1. **Check-then-write races outside the transaction.** `confirmReceipt` and `createReceipt` both
   read state (status / clientRef) outside `$transaction`, then write. Unique constraints
   (`Order.receiptId`, `Receipt(userId, clientRef)`) turn a double-tap or a network retry into a
   raw P2002.
2. **Prisma known-request errors are not mapped in `withApi`'s `toAppError`.** Anything Prisma
   throws (P2002/P2003/P2025) surfaces as `INTERNAL_ERROR` 500 instead of a 400/404/409 envelope.
3. **Writes scoped by a prior read rather than by the `where` clause.** Pattern is
   `findFirst({ id, userId })` then `update({ where: { id } })`. Safe today, but it makes the
   "every query is userId-scoped" audit fail textually — matters once real auth replaces
   `DEV_USER_ID`.
4. **AI retry only covers HTTP 429/5xx.** Timeouts and connection errors carry no `status`, so they
   are never retried; combined per-attempt timeouts can also exceed the route's `maxDuration`, and
   the SDK's own built-in retries stack on top of `withRetry`.
5. **Token usage / retry attempts are never logged.** `withRetry` returns `attempts` and every
   caller drops it; token counts land on the `Receipt` row but no structured log line exists.
   PROJECT_SPEC.md §7.1 requires token-usage logging.
6. **Path params validated inconsistently.** `/orders/:id` uses `OrderIdParamSchema`; the whole
   `/receipts/:id/*` family passes the raw string straight into a service.

**Why:** these are the classes that survived a clean first pass — layering, money-as-string,
envelope, and transaction pairing are all solid and lint/type-enforced, so re-checking them is low
yield.

**How to apply:** on a future backend review, grep these six patterns first, then do the
diff-specific reading. Verify each still applies before reporting it — several may have been fixed.
