# Home Expenses Tracker

Track household spending from receipt screenshots. You photograph a receipt, a vision AI model extracts
and categorizes the line items, you review and confirm, and the order is saved to a month. A dashboard
shows per-category totals, trends, and an AI comparison between any two months.

- **`apps/web`** — Next.js 15 (App Router) on Vercel. Backend API only (`/api/v1`) — no web
  dashboard UI in this repo; the iOS app is the client.
- **`apps/ios`** — native SwiftUI app (iOS 17+), source-only so far (no `.xcodeproj` yet — see
  `apps/ios/README.md`).

The AI layer sits behind a **provider interface** — the default and only configured provider is
**Google Gemini**, with **Claude (Anthropic)** available as a drop-in paid provider. Only these two
providers are actually implemented in code; the self-hosted Ollama option described in
`AI_PROVIDER.md` is a documented future option, not built. See **`AI_PROVIDER.md`** for the design
and trade-offs.

See **`PROJECT_SPEC.md`** for the original spec and **`AGENTS_AND_SKILLS.md`** for the code-quality
agents, skills, and CI gates. **PROJECT_SPEC.md describes the original vision and has drifted from
what's actually built in several places (auth, image upload, iOS screens) — this README and
`docs/api.md` describe current reality; where they disagree with PROJECT_SPEC.md, trust these.**

## Status (M1–M4 backend, no auth yet)

- **Backend:** almost all of `/api/v1` is real and working, not stubbed — receipts upload/parse/
  confirm/reparse/discard, orders list/detail/edit/delete + category drill-down, categories, and
  month/trend analytics all read and write real data. Still stubbed `501`: `POST /orders` (manual
  entry), `POST /analytics/compare` (AI month-vs-month narrative), `POST /auth/apple`,
  `POST /auth/refresh`. See `docs/api.md` for the full, accurate route table.
  - **No authentication is implemented.** `lib/auth/` is an empty directory and both auth routes are
    stubs. Every request is resolved to one hardcoded seeded user (`lib/api/devUser.ts`,
    `DEV_USER_ID`) regardless of any `Authorization` header — there is nothing to bypass because
    nothing checks it yet. Don't point this backend at the public internet with real data.
  - **No blob storage.** Receipt images are sent as base64 inside the `POST /receipts` /
    `POST /receipts/:id/reparse` JSON body, used once in memory for the vision call, and never
    persisted — `ReceiptImage` only stores position/mimeType/byte-count bookkeeping.
    `BLOB_READ_WRITE_TOKEN` and the direct-to-blob signed-upload flow in PROJECT_SPEC.md are not
    implemented (`/uploads/token` doesn't exist).
  - **No rate limiting.** `RATE_LIMIT_PARSES_PER_DAY` is not read anywhere in the code yet.
- **iOS:** a real Xcode project (`apps/ios/HomeExpenses.xcodeproj`, generated via `xcodegen` from
  `apps/ios/project.yml`) with three tabs — **Home** (month summary + category drill-down),
  **Orders** (month-paged list, edit, delete), **Analytics** (month-over-month category comparison)
  — plus a Capture → Parsing → Review modal flow reached from Home's "+" button. No Settings tab,
  no Swift Charts trend view, no AI comparison UI, no SwiftData offline cache, and no auth — the app
  talks to the single dev user the backend currently resolves everything to.
- **Not done yet:** CI workflows (there is no `.github/` directory in this repo at all), the web
  dashboard UI, Sign in with Apple (either side), blob storage, rate limiting, the AI month
  comparison feature, and iOS Settings/offline support.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS or newer | for `apps/web` |
| npm | 10+ | or pnpm/yarn if you prefer |
| Git | any | GitHub account for the repo |
| Xcode | 16+ | macOS only, for `apps/ios` |
| A Postgres database | — | Neon or Vercel Postgres (see below) |
| An AI provider key | — | Gemini free tier by default — see below and `AI_PROVIDER.md` |
| A Vercel account | — | for deployment |

You can run and develop the whole backend without a Mac. Xcode is only needed for the iOS app.

---

## 1. Get an AI provider key

The AI layer is behind a provider interface. **Default is Google Gemini's free tier** (native vision,
no credit card on most models). Full trade-offs and the Claude paid option are in
**`AI_PROVIDER.md`**.

### Gemini (default, free)

1. Go to **[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)** and sign in with a
   Google account. AI Studio is the developer surface — not the consumer Gemini app.
2. Click **Create API key** and let it create (or pick) a Google Cloud project.
3. Copy the key — it starts with `AIza`. AI Studio keeps it **visible**, so you can re-copy it later
   (unlike Anthropic, which shows keys once).
4. **Restrict the key:** on the API keys page, if it's tagged "unrestricted", click
   **Restrict to Gemini API** — Google blocks unrestricted keys as of mid-2026.
5. Put it in `GEMINI_API_KEY`.

> **EEA / UK / Switzerland:** Google requires billing enabled even for free-eligible models. It costs
> nothing until you make paid calls — and it also stops your inputs being used for training, which
> matters for receipt PII (see below).

> **Security:** any provider key is a server-side secret — it lives only in `apps/web` env vars
> (locally `.env.local`, in Vercel for deploys), **never** in the iOS app. The phone only talks to your
> backend, which holds the key. Never commit it; `.env.local` is gitignored. Create separate keys for
> local, Preview, and Production so you can revoke one without breaking the others.

### Verify the Gemini key works

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Reply with the single word: ok"}]}]}'
```

A JSON reply means you're set. Common errors: `400`/`403` = key missing, mistyped, or unrestricted;
`429` = above the free-tier rate limit (retry with backoff, or enable billing for higher limits).

---

## 2. Clone and install

```bash
git clone https://github.com/<you>/home-expenses.git
cd home-expenses/apps/web
npm ci
```

---

## 3. Provision the database (Postgres)

Any Postgres works. The simplest path with Vercel is **Neon** (serverless Postgres with per-branch
databases, which the Preview environment uses).

**Option A — Neon (recommended):**
1. Create a project at [neon.tech](https://neon.tech) (or via the Vercel Storage tab).
2. Copy the **pooled** connection string (host contains `-pooler`) → this is `DATABASE_URL`.
3. Copy the **direct** (non-pooled) connection string → this is `DIRECT_URL`, used for migrations.

**Option B — Vercel Postgres:** create it from the Vercel dashboard **Storage** tab; Vercel injects the
connection strings into the project automatically.

**Option C — local Postgres** for offline dev: `DATABASE_URL` and `DIRECT_URL` can both point at your
local instance.

**Option D — Supabase:** works, but pick the right connection string for `DIRECT_URL` or
`prisma migrate deploy` hangs forever on Vercel (IPv6-only Direct connection, no route from
Vercel's build environment) — use the **Session pooler** string instead. Full details:
[`docs/deployment.md`](docs/deployment.md) §6.

Then apply the schema and seed the category taxonomy:

```bash
npx prisma migrate dev     # creates tables from prisma/schema.prisma
npm run seed               # seeds the 19 categories (see PROJECT_SPEC.md §6)
```

> Migrations are managed with `prisma migrate` only. `prisma db push` and `migrate reset` are
> **banned** in this repo (a hook blocks them) — see the `db-migration` skill in `AGENTS_AND_SKILLS.md`.

---

## 4. Blob storage — not currently needed

PROJECT_SPEC.md's original design uploads receipt images directly from the client to blob storage
via a signed token, so they never pass through the API function body. **That path isn't built.**
Today, receipt images travel as base64 inside the `POST /api/v1/receipts` JSON body, are used once
in memory for the vision call, and are never persisted server-side (`ReceiptImage` rows only keep
position/mimeType/byte-count). There is no `BLOB_READ_WRITE_TOKEN` read anywhere in the code and no
`/uploads/token` route — you can skip provisioning blob storage entirely for local dev or a
from-scratch deploy. If the direct-to-blob flow gets built later, this section should come back.

---

## 5. Configure environment variables

Copy the example file and fill it in:

```bash
cp .env.example .env.local
```

`.env.local` (never committed) — this mirrors `apps/web/.env.example`, the actual source of truth:

```bash
# Database
DATABASE_URL="postgres://...-pooler.../db?sslmode=require"   # pooled
DIRECT_URL="postgres://.../db?sslmode=require"               # direct, for migrations
SHADOW_DATABASE_URL="postgres://.../db_shadow?sslmode=require"  # prisma migrate dev + CI drift check

# AI provider — server only, NEVER in the iOS app. See AI_PROVIDER.md.
EXTRACTION_PROVIDER="gemini"                 # gemini | anthropic (only these two are implemented)
ANALYSIS_PROVIDER="gemini"
EXTRACTION_MODEL="gemini-3.5-flash"          # vision model for receipts
ANALYSIS_MODEL="gemini-3.5-flash"            # text model for month-vs-month
GEMINI_API_KEY="AIza..."                     # if any provider is 'gemini'
# ANTHROPIC_API_KEY="sk-ant-..."             # if any provider is 'anthropic'

# Guardrails
RATE_LIMIT_PARSES_PER_DAY="50"               # declared for future use — not yet enforced in code

# Deploy smoke test — POST /api/v1/echo, gated by this shared secret, not user auth.
# Leave unset to disable that endpoint entirely. See docs/deployment.md §9.
DEBUG_API_TOKEN="<openssl rand -base64 32>"
```

There is no blob storage variable and no JWT/Apple auth variables to set — those parts of the
original design (§8 auth, direct-to-blob upload) aren't implemented yet, so nothing reads them. The
provider and model are env-driven, so you can switch between Gemini and Claude without a code
change — set only the credential the provider you chose actually needs. Model values per provider
are listed in `AI_PROVIDER.md` §5.

---

## 6. Run locally

```bash
npm run dev        # http://localhost:3000  (web app + /api/v1)
```

Point the iOS app at your machine by setting `API_BASE_URL` in its xcconfig (e.g.
`http://localhost:3000` on the simulator, or your LAN IP on a device).

Before you call anything done, run the one verification pipeline (the same one CI runs):

```bash
./scripts/verify.sh   # typecheck, lint, tests, migration-drift check, build
```

---

## 7. Deploy the backend to Vercel

> Full walkthrough with the complete env var table, `vercel.json` explained, migration-on-deploy
> behavior, and rollback guidance: **[`docs/deployment.md`](docs/deployment.md)**. Quick version
> below.

### First-time setup

1. Push the repo to GitHub.
2. In Vercel, **Add New → Project** and import the GitHub repo.
3. Set the **Root Directory** to `apps/web` (this is the deployable app; `apps/ios` is not deployed).
4. Framework preset auto-detects as **Next.js**. Leave build/output defaults.
5. Add **every** variable from §5 under **Settings → Environment Variables**, for both the
   **Production** and **Preview** environments. Use a **different AI provider key** (e.g.
   `GEMINI_API_KEY`) per environment so you can revoke independently. If you created the DB through
   Vercel Storage, those variables are injected for you.
6. **Deploy.**

### Migrations on deploy

Migrations run as a **pre-build step of the Vercel build itself**, never at runtime and never from
a serverless function — there is no separate CI workflow doing this (see the CI caveat below).
`apps/web/package.json`'s `vercel-build` script is:

```
prisma generate && prisma migrate deploy && npm run seed && next build
```

That's also the **Build Command** Vercel runs (set in `apps/web/vercel.json`). The seed step is why
a from-scratch deploy already has its categories on first boot — see `docs/deployment.md` §7 for
when you'd still want to run it by hand. Every migration must be safe with the *previous* app
version still running, because Vercel serves old and new instances during a rollout and old iOS
clients live forever. The expand → backfill → contract procedure in the `db-migration` skill
enforces this.

> **No CI workflows exist in this repo yet** — there is no `.github/` directory at all. Typecheck,
> lint, tests, the migration-drift check, and the build only run when you invoke
> `./scripts/verify.sh` yourself (or an agent does). Treat any doc passage that mentions
> `web-ci.yml`/`ios-ci.yml` as aspirational until those workflow files actually exist.

### How environments map

| Git action | Vercel environment | Database |
|---|---|---|
| Merge to `main` | **Production** | production DB |
| Open / push a PR | **Preview** (unique URL per PR) | isolated Neon branch DB |

After the first deploy, check `https://<your-app>.vercel.app/api/v1/health` — it reports DB and AI
provider reachability.

---

## 8. Build and run the iOS app

The Xcode project is generated, not hand-authored: `apps/ios/project.yml` (xcodegen) describes the
`HomeExpenses` target, and `apps/ios/HomeExpenses.xcodeproj` is the checked-in output. If you change
`project.yml`, regenerate with `xcodegen generate` from `apps/ios/` before opening Xcode again.

1. Open `apps/ios/HomeExpenses.xcodeproj` in Xcode 16+.
2. Set `API_BASE_URL` in `Resources/Debug.xcconfig` / `Release.xcconfig` to your backend (local,
   Preview, or Production URL).
3. Select a simulator or device and **Run**.
4. Distribution to testers via TestFlight isn't wired up yet — there's no Fastlane lane or CI
   workflow in this repo (§7's CI caveat applies here too).

> There's no sign-in of any kind yet on either side. The app calls the backend directly, and the
> backend currently resolves every request to a single seeded dev user (see the Status section
> above) — everyone running the app locally shares that one user's data. The iOS app never contains
> the AI provider key or any secret regardless: it only ever reads `API_BASE_URL` from its xcconfig.

---

## 9. Cost & safety notes

- **The default Gemini free tier is $0 within rate limits.** But free-tier inputs may be used by Google
  for training — receipts are PII, so for anything real use a **paid** Gemini or Claude tier (paid
  inputs aren't used for training). See `AI_PROVIDER.md` §3.
- The biggest cost/quota lever is **image size** — the client downscales receipts before upload.
- `RATE_LIMIT_PARSES_PER_DAY` is declared in `.env.example` but **not enforced by any code yet** —
  don't rely on it to cap spend. The month-comparison endpoint (`POST /analytics/compare`) that
  would cache narrative results is itself still a `501` stub, so there's no comparison cost to cache
  against either.
- Token usage (`inputTokens`/`outputTokens`/`latencyMs`) is persisted per receipt on the `Receipt`
  row when the provider reports it. There is no `/api/v1/admin/usage` endpoint — that's aspirational.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Gemini call `400`/`403` | Key missing, mistyped, or **unrestricted** — restrict it to the Gemini API in AI Studio. |
| Gemini `429` | Above the free-tier rate limit. Retry with backoff, cache, or enable billing for higher limits. |
| EEA/UK/CH: free calls rejected | Google requires billing enabled in those regions even for free models. |
| Bad model ID | Confirm `EXTRACTION_MODEL` matches the provider (e.g. `gemini-3.5-flash`, `claude-sonnet-5`). See `AI_PROVIDER.md` §5. |
| Claude provider 401 / billing | Using `anthropic`? Key or billing issue — set up at platform.claude.com. |
| Prisma errors after editing the schema | Run `npx prisma generate`. |
| Route fails on Vercel with a Prisma/edge error | The route needs Node — ensure `export const runtime = 'nodejs'`. |
| Migration blocked by a hook | Intentional — use `prisma migrate dev`, not `db push`/`reset`. See the `db-migration` skill. |
| `/api/v1/health` shows DB down | Check `DATABASE_URL`/`DIRECT_URL` and that migrations were applied. |
| `migrate diff --from-migrations` errors "you must pass --shadow-database-url" | Expected — that mode always needs it explicitly, `schema.prisma`'s `shadowDatabaseUrl` datasource field isn't read for `diff`. CI must pass `--shadow-database-url "$SHADOW_DATABASE_URL"` on the `verify.sh` migration-drift line. |

---

## Project structure

```
home-expenses/
├── apps/
│   ├── web/            # Next.js 15 + Prisma — deployed to Vercel (root dir)
│   └── ios/            # SwiftUI app
├── .claude/           # agents, skills, hooks (AGENTS_AND_SKILLS.md)
├── scripts/           # verify.sh + guard/format hooks
├── docs/              # api.md, deployment.md, versioned prompts (provider-agnostic)
├── PROJECT_SPEC.md
├── AGENTS_AND_SKILLS.md
├── AI_PROVIDER.md     # AI provider design & change record
└── README.md
```

## Docs

- **Vercel deployment guide — [`docs/deployment.md`](docs/deployment.md)**
- **AI provider design & options — `AI_PROVIDER.md`**
- Gemini API key — https://aistudio.google.com/app/apikey
- Gemini pricing & free-tier limits — https://ai.google.dev/gemini-api/docs/pricing
- Claude API (optional provider) — https://docs.claude.com/en/api/overview
- Vercel + Next.js deployment — https://vercel.com/docs
- Prisma Migrate — https://www.prisma.io/docs/orm/prisma-migrate
