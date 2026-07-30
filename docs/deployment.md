# Deploying the backend to Vercel

`apps/web` is the only deployable app in this repo (`apps/ios` is not deployed to Vercel). This
guide walks through a first-time deploy and the steady-state deploy flow. See also:
`README.md` §1–5 for local setup, `AI_PROVIDER.md` for the AI provider design, and the
`db-migration` skill in `AGENTS_AND_SKILLS.md` for migration safety rules referenced below.

---

## 1. Prerequisites

Before you start, have these provisioned (README.md §1, §3, §4 walk through each):

- A GitHub repo with this code pushed.
- A Postgres database — pooled + direct connection strings (Neon recommended; gives per-PR branch
  databases for Preview almost for free).
- An AI provider key — `GEMINI_API_KEY` by default (see `AI_PROVIDER.md`).

That's it. There's no blob storage to provision and no Sign in with Apple credentials to gather —
neither is implemented yet (see the callout in §3). Ignore any older guidance that lists
`BLOB_READ_WRITE_TOKEN` or `APPLE_*`/`JWT_*` variables as prerequisites here.

---

## 2. First-time Vercel project setup

1. **Add New → Project** in the Vercel dashboard and import the GitHub repo.
2. **Root Directory:** set it to `apps/web`. This is the single most important setting — Vercel
   defaults to the repo root, which has no `package.json` and won't build.
3. **Framework Preset:** should auto-detect as Next.js once Root Directory is `apps/web`. Confirm
   it actually says **Next.js**, not "Other" — `apps/web/vercel.json` also pins this explicitly
   (`"framework": "nextjs"`) so a wrong dashboard setting can't silently override it, but check
   anyway. Leave the default Output Directory (don't set it to `public` or anything else).
4. **Build Command:** override to `npm run vercel-build` (or leave the framework default and rely
   on `apps/web/vercel.json`, which already sets `"buildCommand": "npm run vercel-build"` — see §5).
5. **Node.js Version:** 20.x or newer (matches `README.md` prerequisites).
6. Don't deploy yet — add environment variables first (§3), or the first build will fail on a
   missing `DATABASE_URL`.

---

## 3. Environment variables

Add every variable below under **Settings → Environment Variables**, for **both** the Production
and Preview environments. Use **separate credentials per environment** (a different
`GEMINI_API_KEY`/`ANTHROPIC_API_KEY`) so you can revoke one without breaking the other. If you
provisioned Postgres through Vercel's own Storage tab, those variables are injected automatically —
you only need to add the rest. This table is the full list — there is nothing else the running app
reads.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Pooled connection string (Neon: the one with `-pooler` in the host) |
| `DIRECT_URL` | yes | Direct (non-pooled) connection string, used for migrations |
| `SHADOW_DATABASE_URL` | CI only | Not needed for the Vercel build itself — only for the `migrate diff` drift check, which you'd run from your own machine or a CI workflow today (see §6 caveat; no such workflow exists yet in this repo) |
| `EXTRACTION_PROVIDER` | yes | `gemini` (default) or `anthropic` — these are the only two providers implemented |
| `ANALYSIS_PROVIDER` | yes | `gemini` (default) or `anthropic` |
| `EXTRACTION_MODEL` | yes | e.g. `gemini-3.5-flash` |
| `ANALYSIS_MODEL` | yes | e.g. `gemini-3.5-flash` |
| `GEMINI_API_KEY` | if using gemini | from aistudio.google.com |
| `ANTHROPIC_API_KEY` | if using anthropic | from platform.claude.com |
| `DEBUG_API_TOKEN` | recommended | Enables `POST /api/v1/echo`, the deploy smoke test in §9. Leave unset to disable that endpoint entirely. |

Full reference with example values: `apps/web/.env.example`.

> **Not implemented, don't set these:** `BLOB_READ_WRITE_TOKEN` (no blob storage — images travel as
> base64 in the request body, see `docs/api.md`), `JWT_SECRET`/`JWT_REFRESH_SECRET`/`APPLE_TEAM_ID`/
> `APPLE_KEY_ID`/`APPLE_CLIENT_ID`/`APPLE_PRIVATE_KEY` (no auth — every request resolves to one
> seeded dev user, `lib/api/devUser.ts`), `RATE_LIMIT_PARSES_PER_DAY` (declared in `.env.example` for
> forward-compat but not read by any code path yet). None of these are wired to anything today; if
> you set them nothing breaks, but nothing reads them either.

> **Never** put any of these in a `NEXT_PUBLIC_*` variable — the security-auditor agent checks for
> exactly that. AI provider keys are server-only.

---

## 4. Deploy

Click **Deploy**. Vercel will:

1. Run the build command (`npm run vercel-build` = `prisma generate && prisma migrate deploy &&
   npm run seed && next build`) — this applies any pending migrations and re-seeds the category
   taxonomy *before* building, so the deployed code, schema, and reference data are always in sync.
2. Build the Next.js app and register the `/api/v1/**` route handlers as serverless functions.

Because seeding is now part of `vercel-build`, the first deploy already has its 19 categories —
see §7 for when you'd still run the seed script by hand (e.g. pointing it at a database outside the
normal Vercel build, or re-seeding after adding a category to `prisma/seed.ts` without a redeploy).

---

## 5. `vercel.json` — what it controls

```json
{
  "buildCommand": "npm run vercel-build"
}
```

- `buildCommand` is the same override you'd otherwise set in the dashboard — checked into the
  repo so it can't drift from what CI expects.
- **Per-route duration is set in the route file itself, not in `vercel.json`.** An earlier version
  of this file used `vercel.json`'s `functions` glob-matching key
  (`"app/api/v1/receipts/route.ts": { "maxDuration": 60 }`), but that key's path matching doesn't
  reliably resolve against Next.js App Router output in a monorepo — it failed with *"The
  specified pattern ... doesn't match any Serverless Functions inside the `api` directory"* even
  with a correct Root Directory. The routes that call an AI provider (`/receipts`,
  `/receipts/:id/reparse`, `/analytics/compare`, `/echo`) instead export Next.js's own [route
  segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config)
  directly:

  ```ts
  export const runtime = "nodejs";
  export const maxDuration = 60;
  ```

  **Confirm your plan supports the value you set** — Hobby caps at 60s, Pro allows up to 300s
  (800s with Fluid Compute). If a route starts timing out under real receipt volume, raise its
  `maxDuration` in that file, not globally.
- Every route handler that touches Prisma or long-running calls sets
  `export const runtime = 'nodejs'` in the file itself (not Edge) — that's enforced by the
  `verify-build` skill's common-failures list, not by `vercel.json`.

---

## 6. Migrations on deploy

`prisma migrate deploy` runs as a **pre-build step**, never at runtime and never from inside a
route handler. Because of that:

- A migration that fails leaves the **previous** deployment live — Vercel won't promote a build
  that failed. You're never left with half-migrated schema serving traffic.
- Every migration must be safe with the **previous** application version still running, because
  Vercel keeps old serverless instances warm for a while during a rollout, and old iOS clients live
  forever. This is the whole reason destructive schema changes go through the expand → backfill →
  contract procedure in the `db-migration` skill — never ship a single migration that drops or
  renames a populated column.
- `prisma db push` and `prisma migrate reset` are banned in this repo (a `PreToolUse` hook blocks
  them for Claude Code; they're also just wrong for a deployed environment — they don't produce a
  reviewable migration file).

**Caveat discovered while scaffolding this repo:** `npx prisma migrate diff --from-migrations`
(the drift check in `scripts/verify.sh` and CI) always requires `--shadow-database-url` passed
explicitly on the command line — the `shadowDatabaseUrl` field in `schema.prisma` is not read by
`migrate diff`, only by `migrate dev`. This doesn't affect the Vercel build itself (`migrate
deploy` doesn't need a shadow database), but if you wire the drift check into a CI workflow, pass
`--shadow-database-url "$SHADOW_DATABASE_URL"` on that line or it will fail immediately.

### Using Supabase instead of Neon

This repo's guidance defaults to Neon, but Supabase Postgres works too — with one gotcha. Supabase
exposes three different connection strings, and picking the wrong one for `DIRECT_URL` hangs the
Vercel build indefinitely (it connects, then never completes — no error, just stuck):

| Type (Supabase dashboard → Project Settings → Database) | Port | Host | IPv4 from Vercel? |
|---|---|---|---|
| Direct connection | 5432 | `db.<ref>.supabase.co` | **No — IPv6 only** unless you buy the add-on |
| Transaction pooler | 6543 | `aws-0-<region>.pooler.supabase.com` | Yes |
| Session pooler | 5432 | `aws-0-<region>.pooler.supabase.com` | Yes |

Vercel's build environment has no outbound IPv6, so pointing `DIRECT_URL` at the Direct connection
(or leaving it unset, which can fall back to it) makes `prisma migrate deploy` try to reach a host
it can never route to — it hangs rather than failing fast. Use:

- `DATABASE_URL` = **Transaction pooler** string (port `6543`) — the app's normal runtime queries.
- `DIRECT_URL` = **Session pooler** string (port `5432`, same pooler host, different port from
  Transaction pooler) — migrations need session-level Postgres features that the transaction
  pooler doesn't support, but the session pooler still routes over IPv4.

Never use the Direct connection string for either variable on Vercel unless you've paid for
Supabase's IPv4 add-on.

---

## 7. Seed the category taxonomy (and the dev user)

The 19 categories in `PROJECT_SPEC.md` §6 aren't part of the migration — they're seeded
separately, and the app is non-functional without them (every `OrderItem.categoryId` is a foreign
key into this table). `prisma/seed.ts` also seeds the single hardcoded `User` row
(`id: "dev-user"`) that every request currently resolves to, since there's no real auth to create
one (§3's callout). **This now runs automatically as the last step of `vercel-build`** (§4), so a
normal deploy needs nothing further. Run it by hand only if you need to seed a database outside that
flow:

```bash
# from your machine, pointed at the target database
DATABASE_URL="<target DATABASE_URL>" DIRECT_URL="<target DIRECT_URL>" \
  npm --prefix apps/web run seed
```

`prisma/seed.ts` uses `upsert`, so it's safe to re-run — it won't duplicate rows if you run it
again after adding a category later.

---

## 8. How environments map

| Git action | Vercel environment | Database | URL |
|---|---|---|---|
| Merge to `main` | **Production** | production DB | your production domain |
| Open / push a PR | **Preview** | isolated Neon branch DB (if using Neon's Vercel integration) | unique per-PR URL |

Preview deployments get a fresh, isolated database per PR when you use Neon's Vercel integration
(Storage → Neon → enable "Create a branch for each preview"). Without it, all Previews share
whatever `DATABASE_URL` you set on the Preview environment — fine for early development, risky
once real data matters, since two open PRs would then be migrating and writing to the same DB.

---

## 9. Post-deploy verification

1. Hit `https://<your-app>.vercel.app/api/v1/health`. Expected on a healthy deploy:

   ```json
   { "data": { "status": "ok", "db": { "ok": true }, "ai": { "ok": true } } }
   ```

   `db.ok: false` means `DATABASE_URL`/`DIRECT_URL` are wrong or migrations didn't apply.
   `ai.ok: false` means the credential for whichever provider `EXTRACTION_PROVIDER` names isn't
   set — see the table in §3. Note that `/health` only checks the key is *present*, not that a
   call to the provider actually succeeds — for that, use step 2.
2. **Actually call the model** with `POST /api/v1/echo` (requires `DEBUG_API_TOKEN`, §3):

   ```bash
   curl -X POST "https://<your-app>.vercel.app/api/v1/echo" \
     -H "X-Debug-Token: $DEBUG_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"question": "Reply with the single word: ok"}'
   ```

   A `200` with a real `answer` confirms the deployed backend can reach the configured provider —
   auth, network egress, model name, and quota are all exercised end to end, not just the env var
   presence check `/health` does. `401` means the header is missing/wrong; `501` means
   `DEBUG_API_TOKEN` isn't set on this environment; a `500`/`error` payload from the provider
   itself usually means a bad model name or an unfunded/rate-limited key — see `docs/api.md` for
   the full response shape and `README.md` §10 for provider-specific error codes.
3. Confirm the categories are seeded: any endpoint that reads `Category` will 500 on a foreign-key
   violation otherwise (once order creation is implemented — in M0 this only matters once you've
   run §7).
4. Watch error rate and p95 latency in the Vercel dashboard for the first 30 minutes, per the
   `release-check` skill's post-deploy checklist.

---

## 10. Rollback

Prisma has no down-migrations, so the rollback plan is decided by how the migration was written,
not by tooling:

- **Additive changes** (the common case): just revert the application code / redeploy the
  previous commit. The extra column/table sitting unused in the schema is harmless.
- **Destructive changes**: never deployed in one step to begin with (see §6) — that's what makes
  them revertible. If you're ever tempted to roll back mid-way through an expand/backfill/contract
  sequence, stop at the phase you're in; don't run the next phase against the old app version.

State the rollback plan in the PR description for every migration, per the `db-migration` skill.

---

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails immediately, "no package.json found" | Root Directory isn't set to `apps/web` (check for typos — `app/web` ≠ `apps/web`) |
| Every route 404s with Vercel's own `NOT_FOUND` page (not your app's response) | Root Directory is wrong; the "build" completed in under a second with no real build steps in the logs — that's the tell |
| `No Output Directory named "public" found` | Framework Preset in the dashboard is set to "Other" instead of "Next.js" — `vercel.json`'s `"framework": "nextjs"` should prevent this, but check Settings → General → Build & Development Settings if it recurs |
| "The specified pattern ... doesn't match any Serverless Functions inside the `api` directory" | Leftover `functions` key in `vercel.json` — remove it and set `export const maxDuration` in the route file instead (see §5) |
| Build fails on `prisma migrate deploy` | Bad `DATABASE_URL`/`DIRECT_URL`, or a migration file was hand-edited after being applied elsewhere |
| `prisma migrate deploy` hangs indefinitely (no error, just stuck) | On Supabase: `DIRECT_URL` is pointed at the IPv6-only Direct connection. Use the Session pooler string instead — see §6 |
| Route 500s with a Prisma "Edge Runtime" error | That route is missing `export const runtime = 'nodejs'` |
| Route times out on receipt upload/reparse/compare | Raise `export const maxDuration` in that route file — check your plan's ceiling first |
| `/api/v1/health` shows `ai.ok: false` | The env var for the configured provider (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) isn't set on this environment |
| `/api/v1/echo` returns `501` | `DEBUG_API_TOKEN` isn't set on this environment |
| `/api/v1/echo` returns `401` | `X-Debug-Token` header missing or doesn't match `DEBUG_API_TOKEN` |
| `/api/v1/echo` returns `500` from the provider | Bad `EXTRACTION_MODEL`/`ANALYSIS_MODEL` name, or the key is unfunded/rate-limited — check the provider's own console |
| Preview PRs stomping on each other's data | Enable Neon's per-branch Preview integration, or give Preview its own dedicated `DATABASE_URL` |
| `NEXT_PUBLIC_*` var flagged in review | It shouldn't hold a secret — only the client bundle should ever read `NEXT_PUBLIC_*` |
