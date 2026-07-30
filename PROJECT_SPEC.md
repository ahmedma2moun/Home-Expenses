# Home Expenses Tracker — Project Specification

> Source-of-truth document for scaffolding the project. Feed this file to a coding agent
> (Claude Code / Cursor) as the initial context, or use it as the repo's `PROJECT_SPEC.md`.

---

## Implementation status — read this first

This file is the **original vision and scaffolding spec**. The build has since diverged from it in
several places, mostly to move faster before auth/blob-storage/AI-comparison were needed. The
sections below are annotated where they've drifted, but the accurate, current pictures live
elsewhere — trust these over this file when they disagree:

- **`README.md`**'s Status section — what's actually built, backend and iOS.
- **`docs/api.md`** — the real route table and request/response shapes (§9 below is stale).
- **`AI_PROVIDER.md`** — the AI layer already documents itself as superseding this file's §7.

Headline deviations: **there is no authentication** (§8) — every request resolves to one hardcoded
seeded user; **there is no blob storage** — receipt images travel as base64 in the request body
instead of the signed-upload flow in §2/§9; the AI **month-comparison feature doesn't exist**
(`POST /analytics/compare` is a stub, no `MonthComparison` logic is implemented); and the iOS app's
actual screens (§10) differ from what's below — no Settings screen, no Swift Charts trend view, no
offline/SwiftData cache.

---

## 1. Product Overview

A personal/family expense tracker built around **receipt screenshots**. The user photographs or
screenshots order receipts, the system uses the **Claude API vision + structured output** to extract
line items and categorize them, the user reviews and confirms the parse, and the confirmed order is
persisted. A monthly analytics surface shows spending per category, trends over time, and an
**AI-generated comparison between any two months**.

**Primary client:** native iOS app.
**Secondary client:** Next.js web app (dashboard + analytics), deployed on Vercel, which also hosts the backend API.

### Goals
- Zero manual data entry — the receipt is the input.
- Human-in-the-loop: nothing is written to the DB until the user confirms the parse.
- Item-level granularity (not just receipt totals) so category analytics are meaningful.
- Month-scoped bookkeeping: every order belongs to exactly one accounting month.

### Non-goals (v1)
- Multi-user households with shared budgets (schema is user-scoped and ready for it, UI is not).
- Bank/card integrations, OCR fallback engines, budgets & alerts, recurring bill detection.
- Android client.

---

## 2. Architecture

```
┌──────────────────┐         ┌───────────────────────────────────────┐
│  iOS App         │  HTTPS  │  Next.js on Vercel                    │
│  (SwiftUI)       │────────▶│  ├── /app  (web dashboard, RSC)       │
│                  │  JSON   │  └── /api  (Route Handlers = backend) │
│  - capture       │         │        │                              │
│  - review/confirm│         │        ├──▶ Claude API (vision+text)  │
│  - month picker  │         │        ├──▶ Postgres (Prisma)         │
│  - analytics     │         │        └──▶ Blob storage (images)     │
└──────────────────┘         └───────────────────────────────────────┘
        │                                        ▲
        └──── direct upload (signed URL) ────────┘
```

**Key decision — image upload path:** images are uploaded **directly from the iOS client to blob
storage** using a short-lived signed upload token issued by the backend. They do *not* pass through
a serverless function body. Vercel serverless functions have a request-body size ceiling (~4.5 MB)
and per-invocation duration limits; multi-image receipt uploads would breach both. The backend only
ever receives blob **URLs/keys**.

### Repository layout (single repo, `apps/` split)

```
home-expenses/
├── apps/
│   ├── web/                      # Next.js 15 (App Router) — API only today. Vercel root dir.
│   │   ├── app/
│   │   │   └── api/v1/...        # route handlers (the mobile API) — no (dashboard)/ web UI yet
│   │   ├── lib/
│   │   │   ├── ai/                # provider interface + gemini/anthropic subfolders (renamed
│   │   │   │                      # from the originally-planned lib/claude/ — see AI_PROVIDER.md)
│   │   │   ├── api/               # envelope, withApi, Zod schemas — not in the original plan
│   │   │   ├── services/          # business logic (receipts, orders, analytics, ...) — new layer
│   │   │   ├── db/                # prisma client, queries
│   │   │   └── auth/              # exists, but is empty — no auth is implemented (§8)
│   │   ├── prisma/schema.prisma
│   │   └── vercel.json
│   └── ios/                      # Xcode project — HomeExpenses (xcodegen-generated, checked in)
│       └── HomeExpenses/
│           ├── App/                                    # RootView: Home/Orders/Analytics tabs
│           ├── Features/{Capture,Parsing,Review,Orders,Analytics,Summary}   # see §10 — no Settings
│           └── Core/{Networking,DesignSystem,Media}     # no Persistence/ — no offline cache yet
├── docs/
│   ├── api.md                    # the accurate, current API reference — read this over §9 below
│   └── prompts/                  # versioned AI prompt files (provider-agnostic)
├── .claude/
│   ├── settings.json             # hooks + permission denies
│   ├── agents/                   # subagents — see AGENTS_AND_SKILLS.md
│   └── skills/                   # skills — see AGENTS_AND_SKILLS.md
├── scripts/
│   ├── verify.sh                 # the one verification pipeline (humans, agents; no CI yet)
│   ├── guard-db-commands.sh
│   └── format-changed.sh
├── CLAUDE.md                     # standing engineering rules
└── README.md
```

**No `.github/workflows/` directory exists in this repo** — `web-ci.yml`/`ios-ci.yml` were planned
but never created. `scripts/verify.sh` is the only place the verification pipeline runs today; it
has to be invoked by hand (or by an agent), not triggered by CI.

---

## 3. Technical Requirements

| Area | Choice | Notes |
|---|---|---|
| Source control | GitHub, single repo | Trunk-based, PR + required CI checks, protected `main` |
| Backend host | Vercel | Next.js Route Handlers under `/api/v1`, Node runtime (not Edge — needs Prisma + long Claude calls) |
| Web app | Next.js 15, App Router, TypeScript, Tailwind + shadcn/ui | RSC for read pages, client components for interactive charts |
| Charts | Recharts | Category breakdown, month-over-month trend |
| Database | PostgreSQL (Neon / Vercel Postgres) | Serverless driver + connection pooling; Prisma as ORM |
| Migrations | `prisma migrate` | Applied via CI on deploy, never `db push` in prod |
| Blob storage | Vercel Blob (alt: S3/R2) | Private blobs, signed client upload tokens, signed read URLs |
| AI | Claude API (`/v1/messages`) | Vision for extraction, text for month-vs-month analysis |
| iOS | Swift 5.9+, SwiftUI, iOS 17+ | MVVM, `async/await`, `PhotosUI`, `VisionKit` document scanner |
| iOS local cache | SwiftData | Offline read of orders/summaries; drafts pending confirmation |
| Auth | Sign in with Apple → backend-issued JWT | See §8 |
| Observability | Vercel logs + a structured logger; optional Sentry both sides | Log `requestId`, `userId`, `receiptId`, token usage, latency |

---

## 4. Business Requirements → Functional Spec

### BR-1 — Upload one or more screenshots per receipt
- A **Receipt** is a container of 1..N images representing a single order (long receipts split across
  screenshots, or receipt + payment confirmation).
- iOS sources: camera, `VisionKit` document scan, photo library multi-select, share extension (v1.1).
- Client-side pre-processing before upload: downscale to max 1568 px on the long edge, re-encode to
  JPEG q≈0.8, strip EXIF GPS. This materially reduces Claude image tokens and upload time.
- Accepted: `image/jpeg`, `image/png`, `image/webp`, HEIC (converted client-side to JPEG).
- Limits: max 10 images per receipt, max 5 MB per image after compression.
- Ordering matters: the client sends a `position` per image so multi-part receipts are read in order.

### BR-2 — Send to Claude, extract + categorize, user reviews and confirms
1. Client requests upload tokens → uploads images → calls `POST /api/v1/receipts` with blob keys.
2. Backend creates `Receipt` with `status = PARSING` and triggers extraction.
3. Extraction call: **all images of the receipt in a single Claude request**, in `position` order,
   with a strict JSON output contract (§6).
4. Result stored as `Receipt.parsedPayload` (raw JSON) + `status = PARSED`; also persist
   `model`, `inputTokens`, `outputTokens`, `latencyMs` for cost tracking.
5. Client renders a **review screen**: editable merchant, date, currency, per-item name / qty /
   unit price / line total / **category**, plus subtotal, tax, total.
6. Low-confidence fields are visually flagged and require a tap-through before confirming.
7. Client validates: `Σ line totals + tax − discount ≈ grand total` (tolerance 1% or 1 currency unit).
   Mismatch shows a non-blocking warning and offers an "adjustment" line item.
8. **Nothing is written to `orders` until the user confirms.** Confirmation posts the *final,
   user-edited* payload — the backend trusts the client payload, not the parse.

### BR-3 — Persist order + items + category per item
- Confirmation creates `Order` + `OrderItem[]` in a single transaction.
- Category is stored **per item** (`OrderItem.categoryId`), never only at order level.
- The order's dominant category is derived, not stored.
- Every user edit made on the review screen is recorded in `ItemCategoryOverride` (original AI
  category vs. final category). This gives a labelled dataset for prompt tuning and a future
  merchant/item → category memory (see §11 "Learning loop").

### BR-4 — User chooses the accounting month
- `Order.periodMonth` is a `DATE` normalized to the first day of the month (`YYYY-MM-01`).
- Default suggestion: month of the extracted receipt date; if no date extracted, current month.
- The review screen always shows a month picker so the user can reassign (e.g. a receipt from the
  31st charged to the next month's budget).
- A saved order can be moved to another month later; moving invalidates cached summaries/analyses
  for both the old and new month.

### BR-5 — Monthly analysis, trends, and AI month-vs-month comparison
- **Month detail:** total spend, order count, item count, per-category totals + share, top merchants,
  top items, average order value, daily spend sparkline.
- **Trends:** last 6/12 months total spend line chart, and a per-category stacked view; MoM % delta.
- **AI comparison:** user selects month A and month B → backend builds a compact numeric diff
  (per-category totals, deltas, new/dropped categories, merchant shifts, order counts) and asks
  Claude to produce a short narrative: what drove the change, notable spikes, and 2–4 concrete
  suggestions. **The model receives aggregates, not raw items** — cheaper, faster, and less
  sensitive data leaves the system.
- AI comparison results are cached in `MonthComparison` keyed by `(userId, monthA, monthB, dataVersion)`
  so re-opening the page costs nothing. `dataVersion` = hash of the two months' summary rows.

---

## 5. Data Model (Prisma)

```prisma
// apps/web/prisma/schema.prisma

model User {
  id            String    @id @default(cuid())
  appleUserId   String    @unique
  email         String?
  displayName   String?
  currency      String    @default("EGP")   // default display currency
  createdAt     DateTime  @default(now())
  receipts      Receipt[]
  orders        Order[]
}

model Category {
  id        String       @id            // stable slug, e.g. "produce"
  name      String
  emoji     String
  sortOrder Int
  isActive  Boolean      @default(true)
  items     OrderItem[]
}

enum ReceiptStatus {
  UPLOADED
  PARSING
  PARSED
  FAILED
  CONFIRMED
  DISCARDED
}

model Receipt {
  id             String         @id @default(cuid())
  userId         String
  status         ReceiptStatus  @default(UPLOADED)
  images         ReceiptImage[]
  parsedPayload  Json?          // raw Claude extraction result
  parseError     String?
  model          String?
  inputTokens    Int?
  outputTokens   Int?
  latencyMs      Int?
  parseAttempts  Int            @default(0)
  clientRef      String?        // client-generated idempotency key
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  order          Order?

  user           User           @relation(fields: [userId], references: [id])
  @@unique([userId, clientRef])
  @@index([userId, status])
}

model ReceiptImage {
  id        String   @id @default(cuid())
  receiptId String
  position  Int
  bytes     Int?
  mimeType  String

  receipt   Receipt  @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  @@unique([receiptId, position])
}
// `blobKey`, `width`, `height` were dropped (migration
// 20260727010000_drop_receipt_image_blob_key) — there's no blob storage (§2/§9 note), so this row
// is bookkeeping only: position, mimeType, and a computed byte count. The actual image bytes are
// never persisted; they're used once in memory for the extraction call and discarded.

model Order {
  id            String      @id @default(cuid())
  userId        String
  receiptId     String?     @unique
  merchant      String
  purchasedAt   DateTime?               // actual receipt date/time, nullable
  periodMonth   DateTime                // normalized YYYY-MM-01 — BR-4
  currency      String
  subtotal      Decimal     @db.Decimal(12, 2)
  tax           Decimal     @db.Decimal(12, 2) @default(0)
  discount      Decimal     @db.Decimal(12, 2) @default(0)
  total         Decimal     @db.Decimal(12, 2)
  notes         String?
  source        String      @default("receipt")  // receipt | manual
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  items         OrderItem[]
  user          User        @relation(fields: [userId], references: [id])
  receipt       Receipt?    @relation(fields: [receiptId], references: [id])

  @@index([userId, periodMonth])
  @@index([userId, merchant])
}

model OrderItem {
  id           String   @id @default(cuid())
  orderId      String
  name         String
  normalizedName String?             // lowercased/trimmed, for merchant-item memory
  quantity     Decimal  @db.Decimal(10, 3) @default(1)
  unit         String?              // kg, L, pcs
  unitPrice    Decimal? @db.Decimal(12, 2)
  lineTotal    Decimal  @db.Decimal(12, 2)
  categoryId   String
  aiCategoryId String?              // what Claude proposed, before user edit
  confidence   Float?
  position     Int

  order        Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  category     Category @relation(fields: [categoryId], references: [id])

  @@index([orderId])
  @@index([categoryId])
}

model MonthlySummary {                 // materialized aggregate, recomputed on order write
  userId       String
  periodMonth  DateTime
  categoryId   String
  totalAmount  Decimal  @db.Decimal(12, 2)
  itemCount    Int
  orderCount   Int
  updatedAt    DateTime @updatedAt

  @@id([userId, periodMonth, categoryId])
  @@index([userId, periodMonth])
}

model MonthComparison {                // cached AI narrative
  id          String   @id @default(cuid())
  userId      String
  monthA      DateTime
  monthB      DateTime
  dataVersion String              // hash of both months' summaries
  payload     Json                // { headline, drivers[], anomalies[], suggestions[] }
  model       String
  createdAt   DateTime @default(now())

  @@unique([userId, monthA, monthB, dataVersion])
}

model ItemCategoryOverride {           // learning loop / eval dataset
  id           String   @id @default(cuid())
  userId       String
  merchant     String
  itemName     String
  aiCategoryId String?
  finalCategoryId String
  createdAt    DateTime @default(now())

  @@index([userId, merchant, itemName])
}
```

**Money:** always `Decimal(12,2)`; never `Float`. In TypeScript use `decimal.js` via Prisma's
`Decimal`; in Swift use `Decimal`, decoded from a **string** in JSON (the API serializes money as
strings to avoid float drift).

---

## 6. Category Taxonomy

Seeded into `Category` and used verbatim in the extraction prompt. The model must return one of
these slugs — anything else is coerced to `other` server-side.

| Slug | Emoji | Name |
|---|---|---|
| `meat_seafood` | 🥩 | Meat & Seafood |
| `produce` | 🥦 | Produce |
| `dairy_eggs` | 🥛 | Dairy & Eggs |
| `bakery` | 🍞 | Bakery & Bread |
| `pantry` | 🥫 | Pantry & Dry Goods |
| `beverages` | 🧃 | Beverages |
| `snacks_sweets` | 🍫 | Snacks & Sweets |
| `frozen` | 🧊 | Frozen Foods |
| `prepared_deli` | 🍔 | Prepared & Deli |
| `household_cleaning` | 🧹 | Household & Cleaning |
| `personal_care` | 🧴 | Personal Care |
| `health_medicine` | 💊 | Health & Medicine |
| `pet_supplies` | 🐾 | Pet Supplies |
| `electronics` | 📱 | Electronics |
| `clothing` | 👕 | Clothing |
| `hardware_tools` | 🔧 | Hardware & Tools |
| `books_stationery` | 📚 | Books & Stationery |
| `dining` | 🍽️ | Restaurants & Dining |
| `other` | 💼 | Other / Miscellaneous |

Adding a category later = new seed row + prompt regeneration; never renumber or reuse slugs.

---

## 7. Claude API Integration

### 7.1 Client setup
- `@anthropic-ai/sdk` in `apps/web/lib/claude/client.ts`.
- `ANTHROPIC_API_KEY` lives only in Vercel env vars — **never shipped to the iOS app**. The phone
  talks only to our backend.
- Model selection via env so it can be changed without a code deploy:
  - `CLAUDE_EXTRACTION_MODEL` — default `claude-sonnet-5` (vision + strong structured output).
    `claude-haiku-4-5` is a valid cost-optimized fallback for clean, printed receipts.
  - `CLAUDE_ANALYSIS_MODEL` — default `claude-sonnet-5`; `claude-opus-5` if the narrative quality
    matters more than cost.
  - All current Claude models accept image input, so either tier works for extraction.
- Every call wrapped with: timeout, 2 retries with exponential backoff + jitter on 429/5xx,
  and token-usage logging.

### 7.2 Extraction call (BR-2)

Request shape: one `user` message whose content array is `[image, image, …, text]`, images in
`position` order, sent as base64 with the correct `media_type`.

System prompt (versioned in `docs/prompts/extraction.v1.md`):

> You extract structured data from retail receipt images. The images provided are pages/parts of a
> **single** receipt, in order. Read every line item. Return **only** a JSON object matching the
> schema — no prose, no markdown fences. Never invent a price you cannot read: set the value to
> `null` and lower the confidence. Assign each item exactly one category slug from the allowed list.
> Prefer the most specific matching category; use `other` only when nothing fits. Currency is read
> from the receipt symbol/text; if absent, infer from merchant/locale and mark low confidence.

Output contract:

```json
{
  "isReceipt": true,
  "merchant": "Carrefour",
  "purchasedAt": "2026-07-14T18:32:00",
  "currency": "EGP",
  "items": [
    {
      "name": "Tomatoes 1kg",
      "quantity": 2,
      "unit": "kg",
      "unitPrice": "22.50",
      "lineTotal": "45.00",
      "category": "produce",
      "confidence": 0.94
    }
  ],
  "subtotal": "612.00",
  "tax": "38.00",
  "discount": "0.00",
  "total": "650.00",
  "warnings": ["Line 12 price is cropped and was not read"],
  "overallConfidence": 0.88
}
```

Server-side hardening:
- Validate with **Zod**; on validation failure retry once with the validation error appended as a
  follow-up user turn ("Your output failed validation: … Return corrected JSON only.").
- Coerce unknown category slugs → `other`, clamp negative amounts, recompute `subtotal` if missing.
- `isReceipt: false` → `status = FAILED` with a user-facing message; don't burn a retry.
- Store the raw text response alongside the parsed object for debugging.

### 7.3 Month comparison call (BR-5)

Input = compact aggregate JSON only:

```json
{
  "currency": "EGP",
  "monthA": { "label": "2026-05", "total": "18240.00", "orders": 21,
              "byCategory": { "produce": "2100.00", "dining": "3400.00" },
              "topMerchants": [{ "name": "Carrefour", "total": "6100.00" }] },
  "monthB": { "label": "2026-06", "total": "21980.00", "orders": 26, "...": "..." },
  "deltas": { "totalPct": 20.5, "byCategoryPct": { "dining": 61.2, "produce": -4.1 } }
}
```

System prompt (`docs/prompts/comparison.v1.md`) instructs: return JSON with
`headline` (≤ 20 words), `drivers[]` (category, direction, amount, one-sentence explanation),
`anomalies[]`, `suggestions[]` (2–4, concrete and tied to the numbers), `confidence`.
The model must not invent categories or amounts not present in the input, and must not moralize
about the user's spending.

### 7.4 Cost & latency controls
- Downscale images client-side (biggest single lever on image token cost).
- Cache comparisons via `MonthComparison.dataVersion`.
- Per-user daily quota on extraction calls (`RATE_LIMIT_PARSES_PER_DAY`, default 50) to cap spend.
- Persist token counts per call; expose a simple internal `/api/v1/admin/usage` view.
- Consider the Batch API for any future bulk re-processing of historical receipts.

Reference: https://docs.claude.com/en/api/overview

---

## 8. Authentication & Authorization

> **Not implemented.** `POST /auth/apple` and `POST /auth/refresh` are both `501` stubs, `lib/auth/`
> is an empty directory, and every backend route resolves `userId` to one hardcoded seeded user
> (`lib/api/devUser.ts`'s `DEV_USER_ID`) regardless of any request header. The iOS app has no
> Sign in with Apple, JWT storage, Keychain, or refresh logic either. What follows is the design to
> build against, not current behavior — see README.md's Status section.

- **Sign in with Apple** on iOS → identity token posted to `POST /api/v1/auth/apple`.
- Backend verifies the token against Apple's public keys, upserts `User` by `sub`, and returns an
  app JWT (15 min access) + opaque refresh token (30 days, rotating, stored hashed).
- Web app uses the same session model (Auth.js with the Apple provider, or a magic link for v1).
- Every query is scoped by `userId` from the verified JWT — **never** from a request body/param.
- Blob reads go through short-lived signed URLs generated per request; blobs are private.

---

## 9. API Contract (`/api/v1`)

> **This table is the original design and no longer matches the implemented API in several rows —
> see `docs/api.md` for the accurate, current contract.** In short: `/uploads/token` was never
> built (there's no blob storage — images ride as base64 in the `POST /receipts` body instead, see
> §2/§8); `/auth/*` and `POST /analytics/compare`/`POST /orders` (manual entry) are still `501`
> stubs; every other row below is real and live, including several (`GET /categories`,
> `GET /analytics/month/:month`, the whole `/receipts/*` family) that this table doesn't do justice
> to with full request/response shapes — `docs/api.md` has those.

All responses envelope: `{ "data": … }` or `{ "error": { "code", "message", "details?" } }`.
Money fields are **strings**. Dates are ISO-8601. Months are `"YYYY-MM"`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/apple` | Exchange Apple identity token → JWT pair — **stub, not implemented** |
| `POST` | `/auth/refresh` | Rotate refresh token — **stub, not implemented** |
| ~~`POST`~~ | ~~`/uploads/token`~~ | **Not implemented — no blob storage exists.** Images are sent as base64 directly in the `POST /receipts` body instead (see §2/§8, `docs/api.md`) |
| `POST` | `/receipts` | Body: `{ clientRef, images: [{ base64, position, mimeType }] }` → creates receipt, starts parse. **Live.** |
| `GET` | `/receipts/:id` | Poll status + `parsedPayload` when `PARSED` |
| `POST` | `/receipts/:id/reparse` | Retry a `FAILED` parse (counts against quota) |
| `POST` | `/receipts/:id/confirm` | Body = final user-edited order + items + `periodMonth` → creates `Order` |
| `DELETE` | `/receipts/:id` | Discard an unconfirmed receipt (soft delete + blob cleanup job) |
| `GET` | `/orders?month=YYYY-MM&cursor=` | Paginated orders for a month |
| `GET` | `/orders/:id` | Order + items |
| `PATCH` | `/orders/:id` | Edit merchant/notes/**periodMonth**/items |
| `DELETE` | `/orders/:id` | Delete order (cascades items, recomputes summaries) |
| `POST` | `/orders` | Manual order entry (no receipt) |
| `GET` | `/categories` | Taxonomy (cacheable, ETag) |
| `GET` | `/analytics/month/:month` | Totals, per-category breakdown, top merchants/items |
| `GET` | `/analytics/trends?months=12` | Series of monthly totals + per-category series |
| `POST` | `/analytics/compare` | Body: `{ monthA, monthB, refresh?: boolean }` → cached or fresh AI narrative |
| `GET` | `/health` | Liveness + DB + Claude reachability |

**Parsing is asynchronous-by-polling in v1:** `POST /receipts` returns `202` immediately with
`status: PARSING`; the client polls `GET /receipts/:id` every 2 s (max 60 s) or receives an APNs
push when done. This avoids holding a serverless function open for the whole vision call and keeps
the app responsive on flaky mobile networks. Confirm your Vercel plan's function `maxDuration` and
set it explicitly in `vercel.json` for the parse route.

**Idempotency:** `clientRef` (a client-side UUID) on receipt creation and confirmation prevents
duplicate orders from retries on poor connectivity.

---

## 10. iOS App Specification

**Target:** iOS 17+, SwiftUI, MVVM, `async/await`, no third-party networking dependency (URLSession).

> **Current build vs. this spec:** the app has three tabs — **Home** (`Features/Summary`, not a
> separate top-level screen split out the way §2 implied), **Orders**, **Analytics** — plus
> Capture → Parsing → Review as a modal flow launched from Home's "+" button, not tabs of their
> own. No **Settings** screen exists at all. **Analytics** is a month-over-month category comparison
> with a drill-down, not the "totals, category bars, Swift Charts trend + AI compare sheet" screen
> described below — there's no Swift Charts import anywhere and no AI comparison UI (the backend
> endpoint it would call, `POST /analytics/compare`, is itself unimplemented). **Orders** has no
> search or category filter. There's no Sign in with Apple, no JWT/401-refresh handling (there's no
> auth at all — see §8), and no SwiftData/offline cache — `Core/Persistence/` doesn't exist. The
> image pipeline (downscale/JPEG-encode/EXIF-strip) *is* implemented, in `Core/Media/`. See
> README.md's Status section for the up-to-date picture.

### Screens / flow
1. **Home** — current month total, category donut, recent orders, prominent "Add receipt" FAB.
2. **Capture** — camera / `VisionKit` scanner / photo picker (multi-select). Thumbnails are
   reorderable (position matters), each removable. "Analyze" starts upload.
3. **Parsing** — progress state with cancel; polls receipt status; handles failure with retry.
4. **Review & Confirm** — the core screen:
   - Header: merchant, receipt date, currency, **month picker** (BR-4), grand total.
   - Item list: inline-editable name, qty, unit price, line total; tap the category chip to change it.
   - Low-confidence rows highlighted; a banner shows `Σ items + tax ≠ total` mismatches.
   - Swipe to delete an item; "+ Add item" for anything the parse missed.
   - Sticky footer with live recomputed total and **Confirm & Save**.
5. **Orders** — month-segmented list, search by merchant/item, filter by category, order detail.
6. **Analytics** — month picker; totals, category bars, trend chart (Swift Charts);
   **"Compare months"** sheet → pick A and B → AI narrative card (headline, drivers, suggestions)
   with a manual refresh.
7. **Settings** — account, default currency, default month behaviour, sign out, delete account.

### Client concerns
- **Offline:** SwiftData caches orders + monthly summaries for read; captured-but-unsent receipts are
  queued as drafts and uploaded when connectivity returns. *(Not implemented — no SwiftData usage
  anywhere in the app today.)*
- **Image pipeline:** downscale + JPEG encode off the main actor before upload; show per-image upload progress.
- **Networking:** one `APIClient` actor, typed `Codable` DTOs, automatic 401 → refresh → retry once.
  *(The actor and typed DTOs exist; there's no 401/refresh handling since there's no auth yet.)*
- **Money:** decode as `Decimal` from strings; format with `Locale`-aware `FormatStyle`.
- **Accessibility:** Dynamic Type throughout, VoiceOver labels on category chips and chart summaries.
- **Privacy:** `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`; state clearly in the
  onboarding that receipt images are sent to the configured AI provider (Gemini by default, not
  Claude — see `AI_PROVIDER.md`) for processing.

---

## 11. Web App (Next.js) Specification

> **Not built.** `apps/web` today is API-only — there's no `(dashboard)/` route group, no pages
> under `app/`, nothing described below. README.md's own Status section already says as much; the
> iOS app is the only client. This section stays as the design for whenever the web UI gets built.

- `/` dashboard: current month KPIs, category breakdown, recent orders.
- `/orders`: table with month filter, inline category correction, CSV export.
- `/analytics`: trend charts + the month-vs-month AI comparison panel.
- `/receipts/[id]`: same review/confirm flow as iOS (useful for bulk desktop entry).
- Server Components for reads (direct Prisma access), Route Handlers for mutations shared with iOS.
- **Learning loop (v1.1):** before calling Claude, look up `ItemCategoryOverride` for
  `(merchant, normalizedName)`; if a confident user-corrected mapping exists, inject it into the
  prompt as few-shot hints so the same item is categorized correctly next time.

---

## 12. Aggregation & Consistency

- `MonthlySummary` is recomputed inside the same transaction as any order create/update/delete.
- Moving an order between months recomputes **both** affected months and invalidates
  `MonthComparison` rows referencing either month.
- Analytics endpoints read `MonthlySummary` only — never scan `OrderItem` at request time.
- A nightly cron (`vercel.json` crons) reconciles summaries from source rows and logs drift; this is
  the safety net for any missed invalidation. *(Not implemented — `apps/web/vercel.json` has no
  `crons` entry today, just `framework` and `buildCommand`.)*

---

## 13. Non-Functional Requirements

- **Security:** all traffic HTTPS; JWT with short TTL; private blobs; no API key on device; rate
  limits per user and per IP; input size caps; SQL via Prisma only.
- **Privacy:** receipts may contain names/card last-4 — never log `parsedPayload` at info level;
  account deletion hard-deletes orders, receipts, and blobs within 30 days.
- **Reliability:** parse failures are recoverable and never lose the uploaded images; confirmation is
  idempotent; all writes transactional.
- **Performance targets:** parse round-trip p50 < 12 s for a 2-image receipt; analytics endpoints
  p95 < 400 ms; app cold start to Home < 1.5 s from cache.
- **Cost:** track token spend per user per month; alert if the monthly Claude spend exceeds a threshold.
- **Testing:** Vitest for backend units (Zod parsing, aggregation math, month normalization) with a
  fixture set of ~20 real receipt JSONs; Playwright for the web review flow; XCTest + snapshot tests
  for the review screen; a prompt-eval script that runs the extraction prompt over a labelled
  fixture folder and reports item-level and category-level accuracy before any prompt change ships.

---

## 14. Environments & Deployment

> This table is the original plan. **`docs/deployment.md` §3 has the accurate, current variable
> list** — the AI provider vars are named differently (`EXTRACTION_PROVIDER`/`EXTRACTION_MODEL`/
> `ANALYSIS_PROVIDER`/`ANALYSIS_MODEL`, not `CLAUDE_*`, see `AI_PROVIDER.md`), and
> `BLOB_READ_WRITE_TOKEN`/`JWT_*`/`APPLE_*`/`RATE_LIMIT_PARSES_PER_DAY` are all unread by any code
> path today (no blob storage, no auth, no rate limiting implemented — see the callout at the top of
> this file).

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Vercel | pooled + direct (for migrations) |
| `ANTHROPIC_API_KEY` | Vercel | server only — one of two implemented providers |
| `CLAUDE_EXTRACTION_MODEL` | Vercel | superseded by `EXTRACTION_MODEL` — see `docs/deployment.md` §3 |
| `CLAUDE_ANALYSIS_MODEL` | Vercel | superseded by `ANALYSIS_MODEL` — see `docs/deployment.md` §3 |
| `BLOB_READ_WRITE_TOKEN` | Vercel | not read anywhere — no blob storage exists |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Vercel | not read anywhere — no auth exists |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CLIENT_ID` | Vercel | not read anywhere — no auth exists |
| `RATE_LIMIT_PARSES_PER_DAY` | Vercel | declared in `.env.example`, not enforced by any code path yet |

- Vercel projects: **Production** (`main`) and **Preview** (every PR, isolated Neon branch DB).
- `web-ci.yml` / `ios-ci.yml`: planned, described here, but **no `.github/workflows/` directory
  exists in this repo** — nothing runs these gates automatically yet; `scripts/verify.sh` is invoked
  by hand today.
- iOS points at the Preview or Production API via an xcconfig-driven `API_BASE_URL`.

---

## 15. Milestones

| # | Milestone | Deliverable |
|---|---|---|
| M0 | Foundations | Repo, CI, Prisma schema + seed taxonomy, auth, `/health` |
| M1 | Upload & parse | Signed uploads, `POST /receipts`, extraction prompt + Zod validation, polling |
| M2 | Review & save | Confirm endpoint, order/item persistence, iOS review screen |
| M3 | Months & orders | Month assignment, orders list/detail/edit/move, summaries |
| M4 | Analytics | Month detail, trends, charts on both clients |
| M5 | AI comparison | Aggregate diff builder, comparison prompt, caching, UI panel |
| M6 | Hardening | Prompt evals, rate limits, offline queue, error states, TestFlight beta |

---

## 16. Open Questions

1. Single-user or shared household from day one? (Schema supports it; UI cost is real.)
2. Multi-currency: store an FX rate per order and report in a base currency, or keep months
   single-currency? Affects `MonthlySummary` design.
3. Should orders be assignable to more than one month (split bills), or is one month sufficient?
4. Push notification on parse completion in v1, or is polling acceptable?
5. Retention policy for receipt images after confirmation — keep indefinitely, or purge after N months?

---

## 17. Engineering Agents, Skills & Quality Gates

Code quality, backend build health, migration safety, and clean-code enforcement are specified in
**`AGENTS_AND_SKILLS.md`**. Summary:

- **`CLAUDE.md`** — standing rules always in context (money as Decimal, `userId` from the JWT only,
  Zod on every handler, one response envelope, no `db push`, no PII in logs).
- **Subagents** (`.claude/agents/`) — `backend-reviewer`, `ios-reviewer`, `security-auditor`, and
  `api-contract-guard` are read-only checks; `db-migration-guard`, `build-doctor`,
  `clean-code-refactorer`, and `prompt-eval-runner` do bounded work in their own context.
- **Skills** (`.claude/skills/`) — `code-quality-standards`, `add-endpoint`, `db-migration`,
  `verify-build`, `prompt-change`, `release-check`.
- **Hooks** — a `PreToolUse` guard blocks `prisma db push` / `migrate reset` / raw destructive DDL;
  a `PostToolUse` hook formats and lints every edited file.
- **CI gates** — strict TS, ESLint + layering boundaries, Prettier, knip, Vitest coverage thresholds,
  `prisma migrate diff --exit-code`, migration apply on a fresh DB, prompt-eval regression, `npm audit`,
  SwiftLint/SwiftFormat. `scripts/verify.sh` is the single pipeline humans, agents, and CI all run.

M0 includes creating these files; the reviewer agents are expected to run on every PR from M1 onward.

---

## 18. First Task for the Coding Agent

Scaffold M0: create the repo structure in §2, initialize the Next.js app with TypeScript and
Tailwind, add the Prisma schema from §5 with a seed script for the §6 taxonomy, stub the `/api/v1`
route handlers from §9 returning `501`, wire the Claude client from §7.1 with the model env vars,
and add both CI workflows. Also create `CLAUDE.md`, the `.claude/agents/` and `.claude/skills/` files,
`.claude/settings.json`, and the three scripts exactly as written in `AGENTS_AND_SKILLS.md`, and wire
the CI gates from §5 of that document. Do not implement extraction logic yet.
