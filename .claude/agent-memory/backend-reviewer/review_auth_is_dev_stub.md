---
name: review-auth-is-dev-stub
description: withApi injects a hardcoded DEV_USER_ID instead of a verified JWT — pre-existing, do not re-raise as a blocking finding on every PR
metadata:
  type: project
---

`withApi` supplies `userId: DEV_USER_ID` to every route handler; there is no JWT verification yet
(`POST /auth/apple` and `/auth/refresh` are still 501 stubs). This is pre-existing scaffolding from
the M1–M6 milestone build-out, not something any individual PR introduced.

**Why:** the blocking check "`userId` read from the request instead of the verified session" cannot
currently be satisfied by any PR, so treating it as blocking would reject every diff and drown the
real findings.

**How to apply:** do not list it under **Blocking**. Note it once under **Should fix** only when the
new routes expose user-scoped data that would leak across users at cutover (item/merchant purchase
history, receipts, analytics), and say explicitly that it is pre-existing. Re-check whether auth has
landed before repeating it — grep `withApi.ts` for `DEV_USER_ID`. Related:
[[review-recurring-findings]].
