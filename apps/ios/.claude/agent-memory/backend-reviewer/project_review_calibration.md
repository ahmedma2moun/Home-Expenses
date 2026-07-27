---
name: project-review-calibration
description: Two repo-wide states that must NOT be flagged as blocking in apps/web reviews — auth is intentionally stubbed to a single dev user, and .test.ts files are waived for the current milestone build-out
metadata:
  type: project
---

Two standing conditions in `apps/web` that look like CLAUDE.md violations but are deliberate.
Verify both are still true (read `lib/api/devUser.ts`, `apps/web/vitest.config.ts`) before relying
on this.

**1. Auth is stubbed.** `withApi` resolves every request to `DEV_USER_ID` from
`lib/api/devUser.ts`; there is no JWT verification in the request path right now, even though
`docs/api.md` marks routes "auth: required" and `app/api/v1/auth/*` routes exist.

**Why:** Intentional, documented in the `devUser.ts` file comment ("Swap this back for real
JWT-derived userId resolution when auth comes back") — auth was removed to move faster through the
milestone build.

**How to apply:** Do not raise "userId not from the verified session" as a Blocking finding on a
route that takes `userId` from the `withApi` context — that is the repo's session seam and fixing
it is a repo-wide change, not this diff's job. Still block if a handler reads `userId` from the
body/params/query/header, or if a Prisma call on Order/Receipt/OrderItem/MonthlySummary drops the
`userId` filter entirely.

**2. Tests are waived for the milestone build-out.** New services/routes are shipping without
`*.test.ts` files, and `vitest.config.ts` coverage thresholds for `lib/services/**` were dropped
from 80/75 to 0/0 so `verify.sh` passes.

**Why:** The user asked to skip tests partway through the M1–M6 backend + iOS build-out to move
faster; the threshold drop is the downstream consequence, confirmed by the user.

**How to apply:** Report missing tests under **Nits**, never Blocking, for work that is part of
this build-out — and mention that the 0/0 thresholds need to go back to 80/75 once tests are
backfilled. If the user starts a small, standalone bug fix or feature later, the default
"new business logic ships with tests" rule applies again. See also
[[project-review-recurring-findings]].
