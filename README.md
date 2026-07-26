# Home Expenses Tracker

Track household spending from receipt screenshots. You photograph a receipt, a vision AI model extracts
and categorizes the line items, you review and confirm, and the order is saved to a month. A dashboard
shows per-category totals, trends, and an AI comparison between any two months.

- **`apps/web`** — Next.js 15 (App Router) on Vercel. Backend API only (`/api/v1`) — no web
  dashboard UI in this repo; the iOS app is the client.
- **`apps/ios`** — native SwiftUI app (iOS 17+), source-only so far (no `.xcodeproj` yet — see
  `apps/ios/README.md`).

The AI layer sits behind a **provider interface** — the default and only configured provider is
**Google Gemini**, with **Claude** available as a drop-in paid provider. See **`AI_PROVIDER.md`**
for the design and trade-offs.

See **`PROJECT_SPEC.md`** for the full spec and **`AGENTS_AND_SKILLS.md`** for the code-quality
agents, skills, and CI gates.

## Status (M0 — foundations)

- **Backend:** Prisma schema + seed taxonomy + initial migration, `/api/v1` route handlers wired
  for auth/envelope but stubbed `501` except `GET /health` (live: DB + configured AI provider key
  check). The AI provider layer (`lib/ai/`) is wired for Gemini (default) and Claude, with
  timeout/retry/telemetry — no extraction/comparison prompt logic yet. Verified end to end against
  a throwaway local Postgres: migration applies, seed runs, drift check is clean.
- **iOS:** source tree matches PROJECT_SPEC.md §2 (App/Features/Core/Resources) with a minimal
  APIClient, DTOs, and placeholder screens. Type-checks clean under Swift 6 strict concurrency.
  No Xcode project file yet.
- **Not done yet:** CI workflows (`.github/workflows/*`), the web dashboard, extraction/comparison
  logic, and everything past M0 in PROJECT_SPEC.md §15.

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
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \
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

Then apply the schema and seed the category taxonomy:

```bash
npx prisma migrate dev     # creates tables from prisma/schema.prisma
npm run seed               # seeds the 19 categories (see PROJECT_SPEC.md §6)
```

> Migrations are managed with `prisma migrate` only. `prisma db push` and `migrate reset` are
> **banned** in this repo (a hook blocks them) — see the `db-migration` skill in `AGENTS_AND_SKILLS.md`.

---

## 4. Provision blob storage (receipt images)

Receipt images are uploaded directly from the client to private blob storage via short-lived signed
tokens — they don't pass through the API function body.

**Vercel Blob (default):** in the Vercel dashboard, **Storage → Create → Blob**, then copy the
`BLOB_READ_WRITE_TOKEN`. (S3 or Cloudflare R2 also work if you'd rather; swap the storage adapter.)

---

## 5. Configure environment variables

Copy the example file and fill it in:

```bash
cp .env.example .env.local
```

`.env.local` (never committed):

```bash
# Database
DATABASE_URL="postgres://...-pooler.../db?sslmode=require"   # pooled
DIRECT_URL="postgres://.../db?sslmode=require"               # direct, for migrations
SHADOW_DATABASE_URL="postgres://.../db_shadow?sslmode=require"  # prisma migrate dev + CI drift check

# AI provider — server only, NEVER in the iOS app. See AI_PROVIDER.md.
EXTRACTION_PROVIDER="gemini"                 # gemini | anthropic
ANALYSIS_PROVIDER="gemini"
EXTRACTION_MODEL="gemini-2.5-flash"          # vision model for receipts
ANALYSIS_MODEL="gemini-2.5-flash"            # text model for month-vs-month
GEMINI_API_KEY="AIza..."                     # if any provider is 'gemini'
# ANTHROPIC_API_KEY="sk-ant-..."             # if any provider is 'anthropic'

# Blob storage
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."

# Auth (Sign in with Apple → app JWT)
JWT_SECRET="<openssl rand -base64 32>"
JWT_REFRESH_SECRET="<openssl rand -base64 32>"
APPLE_TEAM_ID="..."
APPLE_KEY_ID="..."
APPLE_CLIENT_ID="com.yourorg.homeexpenses"   # your Services ID / bundle id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Guardrails
RATE_LIMIT_PARSES_PER_DAY="50"               # cap AI extraction calls / spend per user
```

Generate the JWT secrets with `openssl rand -base64 32`. The provider and model are env-driven, so you
can switch between Gemini and Claude without a code change — set only the credential the provider you
chose actually needs. Model values per provider are listed in `AI_PROVIDER.md` §5.

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

### First-time setup

1. Push the repo to GitHub.
2. In Vercel, **Add New → Project** and import the GitHub repo.
3. Set the **Root Directory** to `apps/web` (this is the deployable app; `apps/ios` is not deployed).
4. Framework preset auto-detects as **Next.js**. Leave build/output defaults.
5. Add **every** variable from §5 under **Settings → Environment Variables**, for both the
   **Production** and **Preview** environments. Use a **different AI provider key** (e.g.
   `GEMINI_API_KEY`) per environment so you can revoke independently. If you created the DB/Blob through
   Vercel Storage, those variables are injected for you.
6. **Deploy.**

### Migrations on deploy

Migrations run as a **pre-deploy step in CI**, never at runtime and never from a serverless function.
The build command applies pending migrations before building:

```
prisma migrate deploy && next build
```

Set that as the **Build Command** in Vercel (or keep it in the CI workflow — see
`.github/workflows/web-ci.yml`). Every migration must be safe with the *previous* app version still
running, because Vercel serves old and new instances during a rollout and old iOS clients live
forever. The expand → backfill → contract procedure in the `db-migration` skill enforces this.

### How environments map

| Git action | Vercel environment | Database |
|---|---|---|
| Merge to `main` | **Production** | production DB |
| Open / push a PR | **Preview** (unique URL per PR) | isolated Neon branch DB |

After the first deploy, check `https://<your-app>.vercel.app/api/v1/health` — it reports DB and AI
provider reachability.

---

## 8. Build and run the iOS app

1. Open `apps/ios/HomeExpenses.xcodeproj` in Xcode 16+.
2. Set `API_BASE_URL` in the xcconfig to your backend (local, Preview, or Production URL).
3. Configure **Sign in with Apple**: add the capability, and register the Services ID / key that match
   the `APPLE_*` backend env vars.
4. Select a simulator or device and **Run**.
5. Distribution to testers is via **TestFlight** (Fastlane lane on tagged releases — see
   `.github/workflows/ios-ci.yml`).

> The iOS app never contains the AI provider key or any secret. It authenticates with Sign in with
> Apple and calls only your backend.

---

## 9. Cost & safety notes

- **The default Gemini free tier is $0 within rate limits.** But free-tier inputs may be used by Google
  for training — receipts are PII, so for anything real use a **paid** Gemini or Claude tier (paid
  inputs aren't used for training). See `AI_PROVIDER.md` §3.
- The biggest cost/quota lever is **image size** — the client downscales receipts before upload.
- `RATE_LIMIT_PARSES_PER_DAY` caps extraction calls per user; the month-comparison endpoint caches
  results so re-opening a comparison costs nothing and stays within free-tier limits.
- Token usage is logged per call (when the provider reports it); an internal usage view is at
  `/api/v1/admin/usage`.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Gemini call `400`/`403` | Key missing, mistyped, or **unrestricted** — restrict it to the Gemini API in AI Studio. |
| Gemini `429` | Above the free-tier rate limit. Retry with backoff, cache, or enable billing for higher limits. |
| EEA/UK/CH: free calls rejected | Google requires billing enabled in those regions even for free models. |
| Bad model ID | Confirm `EXTRACTION_MODEL` matches the provider (e.g. `gemini-2.5-flash`, `claude-sonnet-5`). See `AI_PROVIDER.md` §5. |
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
├── docs/              # api.md, versioned prompts (provider-agnostic)
├── PROJECT_SPEC.md
├── AGENTS_AND_SKILLS.md
├── AI_PROVIDER.md     # AI provider design & change record
└── README.md
```

## Docs

- **AI provider design & options — `AI_PROVIDER.md`**
- Gemini API key — https://aistudio.google.com/app/apikey
- Gemini pricing & free-tier limits — https://ai.google.dev/gemini-api/docs/pricing
- Claude API (optional provider) — https://docs.claude.com/en/api/overview
- Vercel + Next.js deployment — https://vercel.com/docs
- Prisma Migrate — https://www.prisma.io/docs/orm/prisma-migrate
