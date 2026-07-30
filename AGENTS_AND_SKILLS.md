# Agents, Skills & Quality Gates

> Companion to `PROJECT_SPEC.md`. Defines the Claude Code **subagents**, **skills**, **hooks**, and
> **automated gates** that keep the codebase clean, the backend build green, and database migrations safe.
> Everything here is checked into the repo so every engineer and every agent session works from the
> same rules.

---

## 0. Layout

```
home-expenses/
├── CLAUDE.md                          # non-negotiable engineering rules (always in context)
├── .claude/
│   ├── settings.json                  # hooks + permission denies (committed)
│   ├── settings.local.json            # personal overrides (gitignored)
│   ├── agents/
│   │   ├── backend-reviewer.md
│   │   ├── db-migration-guard.md
│   │   ├── build-doctor.md
│   │   ├── clean-code-refactorer.md
│   │   ├── api-contract-guard.md
│   │   ├── prompt-eval-runner.md
│   │   ├── ios-reviewer.md
│   │   └── security-auditor.md
│   └── skills/
│       ├── code-quality-standards/SKILL.md
│       ├── add-endpoint/SKILL.md
│       ├── db-migration/SKILL.md
│       ├── verify-build/SKILL.md
│       ├── prompt-change/SKILL.md
│       └── release-check/SKILL.md
└── scripts/
    ├── guard-db-commands.sh           # PreToolUse hook — blocks destructive DB commands
    ├── format-changed.sh              # PostToolUse hook — format + lint the edited file
    └── verify.sh                      # the single canonical verification pipeline
```

**Agents vs. skills — the split used here:**
- A **subagent** is a *worker* with its own context window and restricted tools. Use it when the work
  produces verbose output (test logs, build errors, full-file reads) that shouldn't pollute the main
  conversation, or when tools must be restricted (read-only review, no writes).
- A **skill** is a *procedure* injected into the current context. Use it when the model needs to
  follow the team's steps in the main conversation — scaffolding an endpoint, running a migration.
- Reviewer agents preload the standards skill via the `skills:` frontmatter field, so the rules and
  the reviewer never drift apart.

---

## 1. `CLAUDE.md` — the standing rules

```markdown
# Home Expenses — Engineering Rules

Monorepo: `apps/web` (Next.js 15 + Prisma on Vercel), `apps/ios` (SwiftUI).
Read `PROJECT_SPEC.md` before changing architecture, the data model, or any Claude prompt.

## Non-negotiables

1. **Money is never a float.** Postgres `Decimal(12,2)`, Prisma `Decimal` in TS, `Decimal` in Swift,
   and **strings** on the wire. A `parseFloat` on a money field is a bug.
2. **`userId` comes from the verified JWT, never from the request body, params, or query.**
   Every Prisma query that touches user data is scoped by it.
3. **Every route handler validates its input with a Zod schema** exported from `lib/api/schemas/`.
   Handlers never read raw `req.json()` into business logic.
4. **Every response uses the envelope** `{ data }` or `{ error: { code, message, details? } }`.
   Errors are thrown as `AppError` and mapped centrally — no ad-hoc `NextResponse.json({...}, 500)`.
5. **No secrets in `apps/ios`.** The Anthropic API key exists only in Vercel env vars.
6. **Never log `parsedPayload`, item names, or merchant data above debug level.** Receipts are PII.
7. **Schema changes go through `prisma migrate dev`.** `prisma db push` and `migrate reset` are
   banned in this repo — see the `db-migration` skill.
8. **Order writes and `MonthlySummary` updates happen in the same transaction.** Never one without
   the other.
9. **Claude prompts live in `docs/prompts/*.vN.md` and are versioned.** Editing one requires an eval
   run — see the `prompt-change` skill.
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
```

---

## 2. Subagents

### 2.1 `backend-reviewer` — read-only quality gate for the Next.js backend

```markdown
---
name: backend-reviewer
description: MUST BE USED after any change under apps/web. Reviews TypeScript/Next.js backend code for layering violations, missing Zod validation, unscoped Prisma queries, money-as-float bugs, error-envelope drift, and PII logging. Read-only — never edits.
tools: Read, Grep, Glob, Bash
skills:
  - code-quality-standards
model: opus
color: red
memory: project
---

You are a senior backend reviewer for a payments-adjacent Next.js + Prisma codebase.

When invoked:
1. Run `git diff --stat` then `git diff` for the changed files under `apps/web`. Review only the diff
   and the files it touches — do not audit the whole repo unless asked.
2. Check each item below. Cite `file:line` for every finding.

Blocking checks:
- A Prisma query on Order/Receipt/OrderItem/MonthlySummary without a `userId` scope.
- `userId` read from the request body, params, query, or a header instead of the verified session.
- A route handler without Zod validation, or validating with a schema defined inline in the handler.
- Money handled as `number`/`parseFloat`, or serialized as a JSON number instead of a string.
- A response not using the `{ data }` / `{ error }` envelope.
- An order/item write that does not update MonthlySummary in the same transaction.
- `console.log` of parsed receipt payloads, item names, merchants, or auth tokens.
- `any`, non-null `!`, or an unchecked `as` cast.
- A route handler importing Prisma directly, or a service importing from `next/server`.
- A Claude API call without timeout, retry, Zod validation of the output, or token-usage logging.

Non-blocking: naming, duplication, function length, missing tests, dead code.

Output exactly three sections — **Blocking**, **Should fix**, **Nits** — each item as
`file:line — problem — concrete fix`. If a section is empty, write "None". End with a one-line
verdict: APPROVE or REQUEST CHANGES. Never edit files; propose the patch in the review text.

Record recurring issues in your project memory so later reviews check for them first.
```

### 2.2 `db-migration-guard` — the only agent that touches migrations

```markdown
---
name: db-migration-guard
description: Use for any change to prisma/schema.prisma or anything under prisma/migrations. Plans and generates safe migrations, enforces expand-contract for destructive changes, checks index coverage, and verifies no drift between schema and migration history. Blocks destructive database commands.
tools: Read, Edit, Write, Grep, Glob, Bash
skills:
  - db-migration
model: opus
color: orange
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/guard-db-commands.sh"
---

You own database change safety. A bad migration on this project loses a user's receipt history —
treat every change as production-bound.

Procedure:
1. `git diff prisma/schema.prisma` — restate the intended change in one sentence.
2. Classify it: **additive** (new nullable column, new table, new index) or **destructive**
   (drop/rename column or table, narrow a type, add NOT NULL to an existing column, add a unique
   constraint to existing data).
3. Destructive changes MUST be split expand-contract across at least two deploys:
   expand (add new, dual-write) → backfill (separate, idempotent, batched script) → contract (drop old).
   Never generate a single migration that drops or renames a populated column. If asked to, refuse
   and produce the multi-step plan instead.
4. Generate with `npx prisma migrate dev --name <verb_noun>` (e.g. `add_order_period_month_index`).
   Read the generated SQL and quote anything containing DROP, ALTER COLUMN, or a table rewrite.
5. Verify:
   - `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --exit-code` returns 0.
   - Every foreign key and every column used in a `where`/`orderBy` of a hot query has an index —
     specifically `(userId, periodMonth)` on Order and `(userId, periodMonth)` on MonthlySummary.
   - A new index on a large table uses `CREATE INDEX CONCURRENTLY` in a standalone migration.
   - Money columns are `DECIMAL(12,2)`, never `DOUBLE PRECISION`.
6. Report: the change, the generated SQL summary, the rollback plan, whether a backfill is needed,
   and whether the deploy is safe with old application code still running (it must be).

Never run `prisma db push`, `prisma migrate reset`, `prisma migrate resolve`, or raw DDL against any
database. Never edit a migration file that is already applied on a shared environment — write a new one.
```

**`scripts/guard-db-commands.sh`** (also wired globally in `.claude/settings.json`):

```bash
#!/usr/bin/env bash
# Blocks destructive DB commands. Exit 2 = block and tell Claude why.
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

if echo "$CMD" | grep -qiE 'prisma (db push|migrate reset|migrate resolve)'; then
  echo "Blocked: use 'prisma migrate dev' (see the db-migration skill). db push / reset / resolve are banned." >&2
  exit 2
fi

if echo "$CMD" | grep -qiE '\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b'; then
  echo "Blocked: raw destructive DDL. Generate a reviewed migration instead." >&2
  exit 2
fi

# Never point a migration/seed command at production
if echo "$CMD" | grep -qiE 'prisma (migrate|db seed)' && echo "$CMD" | grep -qiE 'PROD|production'; then
  echo "Blocked: migrations against production run only in CI." >&2
  exit 2
fi
exit 0
```

### 2.3 `build-doctor` — keeps the backend build green without flooding context

```markdown
---
name: build-doctor
description: Use proactively whenever the typecheck, lint, test suite, or Next.js build fails, or after a dependency change. Runs the verification pipeline, diagnoses failures, applies minimal fixes, and reports only a summary.
tools: Read, Edit, Bash, Grep, Glob
skills:
  - verify-build
model: sonnet
color: yellow
memory: project
---

You keep the build green. Build and test output is verbose — that is exactly why you exist. Keep it
in your context and return a short summary.

When invoked:
1. Run `./scripts/verify.sh`. If it fails early, fix that stage before running later ones.
2. For each failure: identify the root cause, apply the **minimal** fix, re-run only that stage.
3. Never fix a failure by weakening the check — no `// @ts-expect-error`, no `eslint-disable`, no
   `.skip()` on a test, no lowering coverage thresholds, no removing a type. If the check itself is
   wrong, say so and stop; that is a human decision.
4. A failing test means the code is wrong until proven otherwise. Do not edit the assertion to match
   the output without explaining why the old expectation was incorrect.
5. Re-run the full pipeline at the end to confirm green.

Report: stages run, failures found (one line each with root cause), files changed, final status.
Do not paste build logs into your summary — quote at most the decisive error line.
```

### 2.4 `clean-code-refactorer`

```markdown
---
name: clean-code-refactorer
description: Use when code is duplicated, a file or function has grown too large, naming is unclear, or layering has blurred. Performs behavior-preserving refactors only, and verifies with tests after every step.
tools: Read, Edit, Write, Bash, Grep, Glob
skills:
  - code-quality-standards
model: opus
color: green
---

You refactor without changing behavior.

Rules:
- Establish a green baseline first: run the tests for the affected area. If they are red, stop and
  hand back to build-doctor.
- If the code you are about to restructure has no test, write a characterization test first.
- One refactoring at a time — extract, rename, move, inline — and run tests after each.
- Never mix a refactor with a behavior change or a dependency bump. If you find a bug, report it;
  do not fix it in the same pass.
- Respect the layering in CLAUDE.md: transport → service → data. Business logic moves *down*,
  never up into route handlers or SwiftUI views.
- Delete dead code you can prove is unreferenced (`npx knip`); don't comment it out.

Report: what you changed, why, and the test result before and after.
```

### 2.5 `api-contract-guard`

```markdown
---
name: api-contract-guard
description: Use whenever a route handler, Zod schema, Prisma model, or iOS DTO changes. Verifies the API contract stays consistent across the Zod schemas, docs/api.md, and the Swift Codable models, and flags breaking changes for shipped app versions.
tools: Read, Grep, Glob, Bash
model: sonnet
color: blue
---

The iOS app ships independently of the backend, so an old client will always be in the wild.

Check:
1. Every `/api/v1` route in `apps/web/app/api/v1/**` has a request and response Zod schema and an
   entry in `docs/api.md`.
2. Every Swift `Codable` DTO in `apps/ios/**/Networking/DTOs` matches its Zod response schema:
   field names, optionality, and money as `String`.
3. Breaking changes to a shipped endpoint: removed field, field made non-optional, type change,
   renamed field, new required request field, changed enum value. Any of these is BLOCKING unless
   it lands as `/api/v2` or is additive-and-optional.
4. Date and month formats: dates ISO-8601, months `"YYYY-MM"`, money strings with 2 decimals.

Report a table: endpoint | drift found | breaking? | fix. Verdict: SAFE or BREAKING.
```

### 2.6 `prompt-eval-runner`

```markdown
---
name: prompt-eval-runner
description: Use before merging any change to files under docs/prompts or to the Claude extraction/comparison code. Runs the prompt eval suite over the labelled receipt fixtures and reports accuracy deltas against the baseline.
tools: Read, Write, Bash, Grep, Glob
model: sonnet
color: purple
---

You are the regression gate for the AI layer. Prompt changes are code changes.

1. Run `npm run eval:extraction` in `apps/web` (fixtures in `fixtures/receipts/`, each with a
   hand-labelled expected JSON).
2. Report per-metric, current vs. baseline in `fixtures/baseline.json`:
   - item-detection recall and precision
   - category accuracy (exact slug match)
   - total-amount exact match rate
   - malformed/schema-invalid output rate
   - mean input+output tokens and p50 latency per receipt
3. A change is BLOCKING if category accuracy or item recall drops more than 1 point, or if the
   schema-invalid rate rises at all.
4. Never edit a fixture's expected output to make an eval pass. If a label is genuinely wrong, say so
   and stop.
5. On an accepted improvement, write the new baseline and note the prompt version in the report.

Report a compact table plus a one-line verdict: SHIP or BLOCK.
```

### 2.7 `ios-reviewer`

```markdown
---
name: ios-reviewer
description: MUST BE USED after any change under apps/ios. Reviews Swift/SwiftUI for force unwraps, main-actor misuse, money handled as Double, business logic in views, retain cycles, and missing accessibility.
tools: Read, Grep, Glob, Bash
skills:
  - code-quality-standards
model: opus
color: cyan
---

Review the diff under `apps/ios` only.

Blocking:
- Force unwrap `!`, `try!`, or `as!` outside test targets.
- Money as `Double`/`Float`, or decoded from a JSON number instead of a `String`.
- Network, Prisma-shaped mapping, or aggregation logic inside a `View` body — it belongs in the ViewModel.
- UI state mutated off the main actor, or a `@MainActor` violation.
- Strong `self` captured in an escaping closure that outlives the ViewModel.
- Secrets, API keys, or the Anthropic endpoint referenced anywhere in the app.
- A network call without cancellation support or without a visible error state.

Should fix: missing Dynamic Type support, missing VoiceOver labels on category chips and charts,
missing empty/loading states, hardcoded currency symbols or date formats.

Output Blocking / Should fix / Nits with `file:line`, then APPROVE or REQUEST CHANGES.
```

### 2.8 `security-auditor`

```markdown
---
name: security-auditor
description: Use before a release, and whenever auth, upload, blob, or logging code changes. Read-only audit for authorization gaps, secret exposure, PII leakage, and unsafe blob or upload handling.
tools: Read, Grep, Glob, Bash
model: opus
color: red
---

Read-only. Audit for:
- Any handler reachable without a verified session, other than `/health` and `/auth/*`.
- Cross-tenant access: a resource fetched by id without a `userId` filter.
- Secrets in the repo, in `apps/ios`, in `NEXT_PUBLIC_*` vars, or in error responses returned to clients.
- Blob URLs: public rather than signed, long-lived signatures, or a blob key derived from user input
  without sanitization.
- Upload endpoints without a MIME allowlist, size cap, or count cap.
- PII in logs, in error messages, or forwarded to a third party.
- Rate limiting missing on `/receipts` (parse quota) and `/analytics/compare` (AI spend).
- Dependency advisories: run `npm audit --audit-level=high`.

Report findings by severity with `file:line` and a concrete fix. Never edit files.
```

---

## 3. Skills

### 3.1 `code-quality-standards` — the shared rulebook

`.claude/skills/code-quality-standards/SKILL.md`

```markdown
---
name: code-quality-standards
description: The clean-code standards for this repo — layering, naming, error handling, testing, and the TypeScript and Swift rules. Use when writing or reviewing any code in apps/web or apps/ios.
allowed-tools: Read, Grep, Glob
---

# Code Quality Standards

## Layering (apps/web)
`app/api/**` transport only: auth, Zod parse, call a service, map errors to the envelope.
`lib/services/**` all business logic; pure where possible; takes primitives and returns domain types.
`lib/db/**` Prisma access; the only place `@prisma/client` is imported.
`lib/claude/**` model calls, prompts, and output schemas; never called directly from a route handler.
Enforced by `eslint-plugin-boundaries` — a violation fails CI, not just review.

## Functions and files
- Function does one thing, is under 40 lines, has at most 3 parameters (else pass an object).
- File under 300 lines. A file over 300 is a missing module.
- Max 3 levels of nesting. Guard-clause and return early instead of `else`.
- No boolean parameters that select behavior — write two functions.

## Naming
Domain language: `periodMonth`, `lineTotal`, `parsedPayload`, `confirmReceipt`.
Booleans read as predicates: `isConfirmed`, `hasUnreadableItems`.
No `data`, `info`, `obj`, `tmp`, `handleStuff`, `utils.ts` as a dumping ground.

## Errors
Throw typed `AppError(code, message, httpStatus, details?)`. One central mapper produces the
`{ error }` envelope. Never swallow an error; never `catch {}`. Log with `requestId` and `userId`,
never with receipt contents. External calls (Claude, blob, DB) get an explicit timeout.

## Types
`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
No `any`, no non-null `!`, no unchecked `as`. Parse unknown input with Zod; don't cast it.
Derive types from Zod schemas and Prisma, don't hand-write duplicates.

## Money and dates
`Decimal` end to end, strings on the wire, 2 decimals. `periodMonth` is always the first day of the
month at UTC midnight — use `toPeriodMonth()`; never construct it inline.

## Tests
New business logic ships with tests. Test behavior through the service boundary, not internals.
Required coverage on `lib/services` and `lib/claude`: 80% lines, 75% branches.
Table-driven tests for the aggregation and month-normalization math.
No network in unit tests — the Claude client is mocked from recorded fixtures.

## Swift
No force unwrap, `try!`, or `as!` outside tests. Views are dumb: no networking, no formatting logic,
no aggregation. ViewModels are `@MainActor` and expose one state enum, not five loose booleans.
`Decimal` for money, `FormatStyle` for display. SwiftLint + SwiftFormat run in CI.

## Always
Prefer deleting code over adding a flag. Leave the file cleaner than you found it, but never mix a
refactor into a feature PR.
```

### 3.2 `add-endpoint`

```markdown
---
name: add-endpoint
description: Scaffold a new /api/v1 endpoint end to end — Zod schemas, auth, service, error handling, tests, docs/api.md entry, and the matching iOS DTO. Use when adding or changing a backend route.
argument-hint: [METHOD /api/v1/path]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Add an endpoint

Follow every step; skipping the docs or the iOS DTO is how the contract drifts.

1. **Contract first.** Write the request and response schemas in
   `apps/web/lib/api/schemas/<resource>.ts` using Zod. Money fields are `z.string().regex(MONEY_RE)`.
   Export the inferred types.
2. **Service.** Put the logic in `apps/web/lib/services/<resource>.ts`. It receives `userId` plus
   parsed input, and returns a domain object. No `NextRequest`, no `NextResponse` in this file.
3. **Handler.** `apps/web/app/api/v1/<path>/route.ts`:
   ```ts
   export const runtime = 'nodejs';
   export async function POST(req: Request) {
     return withApi(req, async ({ userId, body }) => {
       const input = CreateXSchema.parse(body);
       return createX(userId, input);          // service
     });
   }
   ```
   `withApi` handles auth, request id, body parsing, error mapping, and the response envelope.
   Do not hand-roll any of it.
4. **Scope every query by `userId`.** If the endpoint mutates orders or items, wrap the write and the
   `MonthlySummary` recomputation in one `prisma.$transaction`.
5. **Rate limit** anything that calls Claude or accepts uploads.
6. **Tests** in `route.test.ts`: happy path, invalid body (400), unauthenticated (401),
   other user's resource (404 — not 403, don't leak existence), and idempotent replay if the
   endpoint takes a `clientRef`.
7. **Docs.** Add the endpoint to `docs/api.md` with a request and response example.
8. **iOS DTO.** Add or update the `Codable` struct in `apps/ios/.../Networking/DTOs` and the
   `APIClient` method. Money is `String` in the DTO, converted to `Decimal` at the boundary.
9. Run `./scripts/verify.sh`, then have `api-contract-guard` check for drift.
```

### 3.3 `db-migration`

```markdown
---
name: db-migration
description: The procedure for changing the database schema safely — expand-contract, migration naming, backfills, verification, and deploy order. Use for any edit to prisma/schema.prisma or prisma/migrations.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Database migrations

**Banned in this repo:** `prisma db push`, `prisma migrate reset`, `prisma migrate resolve`, editing an
already-applied migration, and raw DDL against any shared database. A hook blocks these.

## Environments
- Local: local Postgres or a personal Neon branch. `prisma migrate dev` only here.
- Preview: one Neon branch per PR, migrations applied by CI on every push.
- Production: `prisma migrate deploy` runs as a **pre-deploy CI step**, never at runtime and never
  from a serverless function.

## Rule: every migration must be safe with the previous app version still running.
Vercel serves old and new instances during a rollout, and old iOS clients live forever.

## Additive change (safe, one PR)
1. Edit `schema.prisma`.
2. `npx prisma migrate dev --name add_<table>_<column>` — verbs: `add_`, `create_`, `index_`, `drop_`, `backfill_`.
3. Read the generated SQL. Confirm it only adds.
4. New column on an existing table must be nullable or have a default. `NOT NULL` without a default
   on a populated table locks and fails.
5. New index on a big table: put `CREATE INDEX CONCURRENTLY` in its own migration with no other statements.
6. `npx prisma generate`, update affected services and tests, run `./scripts/verify.sh`.

## Destructive change (rename, drop, narrow, add unique/NOT NULL) — three PRs minimum
1. **Expand:** add the new column/table. Write to both old and new. Deploy.
2. **Backfill:** an idempotent, batched script in `prisma/backfills/<date>_<name>.ts` — bounded batches
   (e.g. 1000 rows), resumable, logs progress, safe to re-run. Run it, verify counts. Deploy nothing.
3. **Contract:** switch reads to the new column, remove the dual write, then drop the old column in a
   later PR once no running version references it.

Never combine two of these phases in one PR. If asked to "just rename the column", produce this plan
and explain why.

## Verification (every migration PR)
```bash
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --exit-code            # must return 0 — no drift
npx prisma validate
npm run test:db          # migrations applied to a throwaway DB + seed + smoke queries
```

## Index checklist for this schema
`Order(userId, periodMonth)`, `Order(userId, merchant)`, `OrderItem(orderId)`,
`OrderItem(categoryId)`, `MonthlySummary(userId, periodMonth)`, `Receipt(userId, status)`,
plus every foreign key. Any new hot query gets its index in the same PR — check with `EXPLAIN`.

## Rollback
Prisma has no down-migrations. The rollback plan is: additive changes are left in place and the app
is reverted; destructive changes are never deployed in one step, which is what makes them revertible.
State the rollback plan in the PR description.
```

### 3.4 `verify-build`

```markdown
---
name: verify-build
description: The canonical verification pipeline for this repo — the same stages CI runs. Use before claiming any task is complete, and when diagnosing a red build.
allowed-tools: Bash, Read, Grep, Glob
---

# Verify

Run `./scripts/verify.sh`, or the stages individually in this order. Fix each stage before moving on.

| # | Stage | Command |
|---|---|---|
| 1 | Install | `npm ci` |
| 2 | Prisma client | `npx prisma generate` |
| 3 | Types | `npm run typecheck` (`tsc --noEmit`) |
| 4 | Lint | `npm run lint` (`eslint . --max-warnings 0`) |
| 5 | Format | `npm run format:check` |
| 6 | Boundaries | `npm run lint:boundaries` |
| 7 | Dead code | `npx knip --no-exit-code` (report only) |
| 8 | Unit tests | `npm run test -- --coverage` |
| 9 | Migration drift | `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --exit-code` |
| 10 | Build | `npm run build` |

**Never** get to green by disabling a rule, skipping a test, lowering a coverage threshold, adding
`@ts-expect-error`, or deleting an assertion. If a check is genuinely wrong, stop and say so.

Common failures here:
- `Decimal` from Prisma leaking into a JSON response → serialize with `.toFixed(2)` at the boundary.
- Prisma client stale after a schema edit → `npx prisma generate`.
- Edge runtime chosen for a route that uses Prisma → add `export const runtime = 'nodejs'`.
- Coverage below threshold on `lib/services` → write the missing test, don't lower the bar.
```

### 3.5 `prompt-change`

```markdown
---
name: prompt-change
description: Required procedure for changing any Claude prompt or model configuration in this repo. Use when editing docs/prompts/*, lib/claude/*, or the CLAUDE_*_MODEL env defaults.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Changing a Claude prompt

Prompts are production code. They are versioned, evaluated, and reviewed like any other change.

1. **Never edit a shipped prompt file in place.** Copy `docs/prompts/extraction.v3.md` to `.v4.md` and
   edit the copy. Bump the version constant in `lib/claude/prompts.ts`.
2. State the hypothesis at the top of the new file: what is failing today and what this change should fix.
3. Keep the output contract stable. If the JSON shape changes, the Zod schema, the review screen, and
   the iOS DTO change in the same PR.
4. Run the eval before and after: `npm run eval:extraction`. Use the `prompt-eval-runner` agent so the
   per-receipt output stays out of the main context.
5. Blocking thresholds: category accuracy and item recall may not drop more than 1 point; the
   schema-invalid rate may not rise; median tokens per receipt may not rise more than 10% without a
   stated reason.
6. If a fixture exposes a real failure the change doesn't fix, add it to `fixtures/receipts/` with a
   hand-written label. Growing the fixture set is always welcome. Editing an existing label to make an
   eval pass is never acceptable.
7. Record the result in `docs/prompts/CHANGELOG.md`: version, hypothesis, metric deltas, decision.
8. Model changes (`CLAUDE_EXTRACTION_MODEL`, `CLAUDE_ANALYSIS_MODEL`) go through the same eval, plus a
   cost note: tokens and price per receipt before and after.
```

### 3.6 `release-check`

```markdown
---
name: release-check
description: Pre-release checklist for a backend deploy or a TestFlight build. Use before tagging a release.
allowed-tools: Read, Bash, Grep, Glob
---

# Release check

Backend:
- [ ] `./scripts/verify.sh` green on `main`.
- [ ] Migrations reviewed by `db-migration-guard`; each is safe with the previous app version running.
- [ ] `security-auditor` run since the last release, findings closed.
- [ ] `api-contract-guard` verdict SAFE — no breaking change for shipped iOS versions.
- [ ] New env vars added to Vercel for **both** Preview and Production.
- [ ] Prompt changes have an eval entry in `docs/prompts/CHANGELOG.md`.
- [ ] Rate limits and the Claude spend alert still configured.

iOS:
- [ ] `ios-reviewer` verdict APPROVE.
- [ ] Build number bumped; release notes written.
- [ ] Tested against the Production API, not Preview.
- [ ] Verified against the **oldest supported** backend contract, and offline/airplane mode behaves.

Post-deploy:
- [ ] `/health` green; error rate and p95 latency watched for 30 minutes.
- [ ] One real receipt parsed end to end in production.
```

---

## 4. Hooks — `.claude/settings.json`

Hooks are the deterministic layer. Agents can be persuaded; a hook cannot.

```json
{
  "permissions": {
    "deny": [
      "Bash(prisma db push:*)",
      "Bash(npx prisma db push:*)",
      "Bash(npx prisma migrate reset:*)",
      "Bash(git push --force:*)",
      "Read(./apps/web/.env*)",
      "Read(./**/*.p8)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "./scripts/guard-db-commands.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "./scripts/format-changed.sh" }]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "^db-migration-guard$",
        "hooks": [{ "type": "command", "command": "npm run --prefix apps/web migrate:drift-check" }]
      }
    ]
  }
}
```

`scripts/format-changed.sh` reads the edited path from the hook's stdin JSON and runs
`prettier --write` + `eslint --fix` on `.ts/.tsx`, or `swiftformat` + `swiftlint --fix` on `.swift`.
Formatting is never a review comment in this repo — it is a hook.

---

## 5. Automated gates (the non-agent half)

This section describes the intended CI setup. **No CI actually runs it yet** — there is no
`.github/workflows/` directory in this repo at all, so nothing below is enforced automatically on a
push or PR. Every gate that exists today only runs when a human or agent invokes `scripts/verify.sh`
by hand (see below). Treat "fails the build" as "would fail the build, once `web-ci.yml`/`ios-ci.yml`
exist."

| Gate | Tool | Fails the build when |
|---|---|---|
| Types | `tsc --noEmit`, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | any type error |
| Lint | ESLint + `typescript-eslint` (strict-type-checked) | `any`, floating promises, unsafe member access, warnings |
| Layering | `eslint-plugin-boundaries` | a route handler imports Prisma, a service imports `next/server` |
| Format | Prettier `--check` | drift |
| Dead code | `knip` | unused exports and files (report → fail once clean) |
| Tests | Vitest, coverage thresholds on `lib/services`/`lib/ai` | **currently set to 0/0 in `apps/web/vitest.config.ts`** — dropped there during the M1–M6 build-out to unblock `verify.sh` while most new services shipped without `.test.ts` files (a deliberate, temporary call, not the target state). Restore to a real threshold (e.g. 80/75) once tests are backfilled — don't leave this at 0 permanently. |
| Migration drift | `prisma migrate diff --exit-code` | schema and migration history disagree |
| Migration apply | apply all migrations to a fresh DB, then seed and smoke query | a migration doesn't apply cleanly |
| Prompt evals | `npm run eval:extraction` (nightly + on prompt-path changes) | accuracy regression past threshold — **no baseline exists yet**, `apps/web/fixtures/receipts/` is still empty despite the extraction prompt being live in code (see `docs/prompts/extraction.v1.md`) |
| Security | `npm audit --audit-level=high`, secret scanning, CodeQL | high/critical finding |
| iOS | `swiftlint --strict`, `swiftformat --lint`, `xcodebuild test` | any violation or failing test — **there's no test target yet** (`apps/ios/project.yml`'s `testTargets: []`), so `xcodebuild test` has nothing to run today |
| Commits | commitlint (Conventional Commits) | malformed message |
| Pre-commit | husky + lint-staged (format, lint, typecheck changed files) | before the push wastes CI |

Branch protection on `main`: required checks = web-ci, ios-ci, migration-check; at least one review;
linear history; no force push. **None of this is configured yet** — it depends on the CI workflows
above existing first.

### `scripts/verify.sh`
One script, used by humans, hooks, agents, and CI — so "works on my machine" and "passes CI" cannot diverge.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd apps/web
npx prisma generate
npm run typecheck
npm run lint
npm run format:check
npm run lint:boundaries
npm run test -- --coverage
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --exit-code
npm run build
echo "✅ verify passed"
```

---

## 6. How the agents are meant to be used

Typical feature loop:

```
1. Plan          — main session + PROJECT_SPEC.md
2. Implement     — main session, using the add-endpoint / db-migration skills
3. Migrations    — @db-migration-guard   (only agent allowed near prisma/)
4. Green build   — @build-doctor         (verbose logs stay out of your context)
5. Review        — @backend-reviewer + @ios-reviewer  (read-only, run in parallel)
6. Contract      — @api-contract-guard
7. Fix           — main session or @clean-code-refactorer for structural issues
8. Release       — release-check skill, plus @security-auditor before a tagged release
```

Notes:
- Reviewer agents are **read-only on purpose**. A reviewer that can edit stops being a check.
- `backend-reviewer`, `build-doctor`, and `clean-code-refactorer` use `memory: project`, so recurring
  issues in this codebase accumulate in `.claude/agent-memory/` and are checked first next time.
  Commit that directory — it's institutional knowledge.
- Prefer running review agents in the background and continuing to work; results come back as a message.
- Keep agent count low and descriptions specific. Overlapping descriptions make delegation unreliable.
- Agent and skill files are watched, so edits take effect within a few seconds — except the first file
  in a newly created `agents/` or `skills/` directory, which needs a session restart.

Docs: subagents https://code.claude.com/docs/en/sub-agents · skills https://code.claude.com/docs/en/skills
