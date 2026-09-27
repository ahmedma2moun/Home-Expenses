# Home Expenses — Engineering Rules

Monorepo: `apps/web` (Next.js 15 + Prisma on Vercel), `apps/ios` (SwiftUI).
Read `PROJECT_SPEC.md` before changing architecture or the data model, `AI_PROVIDER.md` before
changing the AI provider layer, and either before editing any AI prompt.

## Non-negotiables

1. **Money is never a float.** Postgres `Decimal(12,2)`, Prisma `Decimal` in TS, `Decimal` in Swift,
   and **strings** on the wire. A `parseFloat` on a money field is a bug.
2. **`userId` comes from the verified JWT, never from the request body, params, or query.**
   Every Prisma query that touches user data is scoped by it.
3. **Every route handler validates its input with a Zod schema** exported from `lib/api/schemas/`.
   Handlers never read raw `req.json()` into business logic.
4. **Every response uses the envelope** `{ data }` or `{ error: { code, message, details? } }`.
   Errors are thrown as `AppError` and mapped centrally — no ad-hoc `NextResponse.json({...}, 500)`.
5. **No secrets in `apps/ios`.** AI provider credentials (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, …)
   exist only in Vercel env vars.
6. **Never log `parsedPayload`, item names, or merchant data above debug level.** Receipts are PII.
7. **Schema changes go through `prisma migrate dev`.** `prisma db push` and `migrate reset` are
   banned in this repo — see the `db-migration` skill.
8. **Order writes and `MonthlySummary` updates happen in the same transaction.** Never one without
   the other.
9. **AI prompts live in `docs/prompts/*.vN.md` and are versioned, provider-agnostic.** Editing one
   requires an eval run — see the `prompt-change` skill.
10. **`any`, `as` casts, and non-null `!` are forbidden** in `apps/web` (lint-enforced). In Swift,
    force unwrap and `try!` are forbidden outside tests.

## Conventions

- Layering: `app/api/**` (transport) → `lib/services/**` (business logic) → `lib/db/**` (Prisma).
  Route handlers must not import `@prisma/client` directly; services must not import `next/server`.
- Files under 300 lines, functions under 40, max 3 levels of nesting. Extract, don't nest.
- Name things after the domain: `periodMonth`, `lineTotal`, `receipt`, not `data`, `obj`, `tmp`.
- Tests live next to the unit: `foo.ts` → `foo.test.ts`. New business logic ships with tests.
- Conventional Commits. One logical change per PR.

## Before you say you're done

Run `./scripts/verify.sh` (or use the `verify-build` skill). A change is not complete until it
passes typecheck, lint, tests, the migration-drift check, and the build.
