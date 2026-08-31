# API Reference — `/api/v1`

Backend: `apps/web` (Next.js Route Handlers), deployed on Vercel. This is the only API the iOS and
web clients talk to.

## Conventions

- **Envelope.** Every response is `{ "data": ... }` on success or
  `{ "error": { "code", "message", "details?" } }` on failure. See `lib/api/envelope.ts`.
- **Auth — not implemented yet.** There is no verification of any `Authorization` header anywhere
  in this codebase. `lib/auth/` is an empty directory, `POST /auth/apple` and `POST /auth/refresh`
  are both `501` stubs, and every route resolves `userId` to one hardcoded seeded user
  (`lib/api/devUser.ts`'s `DEV_USER_ID`, via `withApi.ts`). The "Auth" column below describes what
  each route will require once auth is built, not what's enforced today — right now nothing is
  enforced, and a fresh DB has exactly one user, so there is no cross-user isolation to test.
- **Money** is always a string with two decimals, e.g. `"45.00"`. Never a JSON number.
- **Dates** are ISO-8601. **Months** are `"YYYY-MM"`.
- **No blob storage.** Receipt images travel as base64 inside the request body of `POST /receipts`
  and `POST /receipts/:id/reparse` — there is no `/uploads/token` route and no blob keys anywhere in
  this API. See `POST /receipts` below.
- **Status.** Most routes are real, working implementations, not stubs — see the table's "Status"
  column. `POST /orders` (manual entry) and both `/auth/*` routes are still `501` stubs.

| Method | Path | Auth (planned) | Status | Purpose |
|---|---|---|---|---|
| `POST` | `/auth/apple` | none | **stub (501)** | Exchange Apple identity token → JWT pair — not implemented |
| `POST` | `/auth/refresh` | none | **stub (501)** | Rotate refresh token — not implemented |
| `POST` | `/receipts` | required | **live** | `{ clientRef, images: [{ base64, position, mimeType }] }` → creates receipt, starts parse. See below |
| `GET` | `/receipts/:id` | required | **live** | Poll status + `parsedPayload` when `PARSED`. See below |
| `POST` | `/receipts/:id/reparse` | required | **live** | Retry a `FAILED` parse — client must resend the images (see below) |
| `POST` | `/receipts/:id/confirm` | required | **live** | Body = final user-edited order + items + `periodMonth`/`periodWeek` → creates `Order`. `merchant` is required but may be an empty string — it is trimmed, and a blank one is stored as `"Unknown merchant"`. `periodMonth` may be any month, past or future (BR-4); `periodWeek` (1-5) defaults to 1 |
| `DELETE` | `/receipts/:id` | required | **live** | Discard an unconfirmed receipt (soft delete — sets `status = DISCARDED`; there's no blob to clean up) |
| `GET` | `/orders?month=YYYY-MM&cursor=&limit=` | required | **live** | Paginated orders for a month; `month` omitted lists every month |
| `POST` | `/orders` | required | **stub (501)** | Manual order entry (no receipt) — not implemented |
| `GET` | `/orders/:id` | required | **live** | Order + items |
| `PATCH` | `/orders/:id` | required | **live** | Edit merchant/notes/**periodMonth**/**periodWeek**/items |
| `DELETE` | `/orders/:id` | required | **live** | Delete order (cascades items, recomputes summaries) |
| `GET` | `/orders/by-category?month=&categoryId=` | required | **live** | Every item in one month/category, grouped by order. See below |
| `GET` | `/categories` | required | **live** | Taxonomy, active categories only |
| `GET` | `/items/price-history?name=` | required | **live** | Every past purchase of one item, its cheapest store, and whether the price jumped last time. See below |
| `POST` | `/items/price-check` | required | **live** | Batch price-creep/cheapest-store check for a receipt's unconfirmed draft items. See below |
| `GET` | `/analytics/month/:month` | required | **live** | Totals, per-category breakdown, per-week breakdown, protein spend, and budget/remaining for one month. See below |
| `GET` | `/analytics/trends?months=12` | required | **live** | Series of monthly totals + per-category series |
| `GET` | `/analytics/price-watch?month=` | required | **live** | Items bought this month whose price jumped at the same merchant. See below |
| `POST` | `/analytics/compare` | required | **live** | `{ monthA?, monthB, refresh? }` → cached or fresh AI narrative. Omitting `monthA` compares against a trailing 3-month baseline instead of a second real month. See below |
| `GET` | `/budgets/:month` | required | **live** | This month's budget targets, spend, and remaining — same `budget` shape embedded in `GET /analytics/month/:month`. See below |
| `PUT` | `/budgets/:month` | required | **live** | Sets some or all of a month's weekly budgets plus its protein budget. See below |
| `GET` | `/health` | none | **live** | Liveness + DB + AI provider reachability |
| `POST` | `/echo` | debug token | **live** | Deploy smoke test — round-trips a question through the configured AI provider (not part of the product API) |

## `GET /health`

The only endpoint with real behavior in M0. Checks the database with `SELECT 1` and whether the
configured AI provider (`EXTRACTION_PROVIDER`, default `gemini`) has its API key set — see
`AI_PROVIDER.md`.

Request: none.

Response `200`:

```json
{
  "data": {
    "status": "ok",
    "db": { "ok": true },
    "ai": { "ok": true }
  }
}
```

Response `503` (degraded — db or AI provider check failed):

```json
{
  "data": {
    "status": "degraded",
    "db": { "ok": false, "error": "connection refused" },
    "ai": { "ok": true }
  }
}
```

## `POST /echo`

Not part of the product API — a deploy smoke test that actually calls the configured AI provider
(`/health` only checks that a credential is *set*, not that it *works*). Gated by a shared secret,
not user auth, since `/auth/apple` may not be wired up yet when you need this. Disabled entirely
(`501`) when `DEBUG_API_TOKEN` isn't configured. See `docs/deployment.md` §9.

Request — header `X-Debug-Token: <DEBUG_API_TOKEN>`, body:

```json
{ "question": "Reply with the single word: ok" }
```

Response `200`:

```json
{
  "data": {
    "answer": "ok",
    "provider": "gemini",
    "model": "gemini-3.5-flash",
    "latencyMs": 842,
    "inputTokens": 12,
    "outputTokens": 3
  }
}
```

`inputTokens`/`outputTokens` are omitted when the provider doesn't report them. `401` if the
header is missing or wrong; `501` if `DEBUG_API_TOKEN` isn't configured; `400` if `question` is
empty or over 2000 characters.

## `GET /categories`

The category taxonomy — active rows only, ordered by `sortOrder`. No query parameters.

Response `200`:

```json
{
  "data": [
    { "id": "produce", "name": "Produce", "emoji": "🥦", "sortOrder": 2 },
    { "id": "dairy_eggs", "name": "Dairy & Eggs", "emoji": "🥛", "sortOrder": 3 }
  ]
}
```

## `POST /receipts`

Creates a `Receipt` and kicks off extraction. There is no blob storage: `images[].base64` carries
the actual image bytes in the request body (raw JPEG/PNG/WebP, base64-encoded — capped at 3,000,000
base64 chars, roughly 2.2 MB raw, per image; max 6 images per receipt). The server uses the bytes
once, in memory, for the vision call and never persists them — the `ReceiptImage` rows it creates
keep only `position`, `mimeType`, and a computed `bytes` count for bookkeeping.

`clientRef` is a client-generated idempotency key: calling this twice with the same `clientRef`
returns the existing receipt rather than creating a second one (no duplicate parses on a retried
request). Each image's `position` must be unique within the request — duplicates are a `400`.

Request:

```json
{
  "clientRef": "a1b2c3d4-...-uuid",
  "images": [
    { "base64": "<base64 JPEG bytes>", "position": 0, "mimeType": "image/jpeg" }
  ]
}
```

Response `202` (extraction runs asynchronously after this response is sent):

```json
{ "data": { "id": "clx1receipt", "status": "PARSING" } }
```

`maxDuration` on this route is 120s — it covers the vision call plus one Zod-validation-failure
correction retry, both happening inside the same invocation via Next's `after()`.

## `GET /receipts/:id`

Poll this until `status` leaves `PARSING`. Returns the raw parsed payload once available — the
client (iOS Review screen) is responsible for turning it into an editable order before confirming.

Response `200`:

```json
{
  "data": {
    "id": "clx1receipt",
    "status": "PARSED",
    "parsedPayload": {
      "isReceipt": true,
      "merchant": "Carrefour",
      "currency": "EGP",
      "items": [
        {
          "name": "Full Cream Milk",
          "brand": "Milkman",
          "quantity": 1,
          "unit": "L",
          "unitPrice": "45.00",
          "lineTotal": "45.00",
          "category": "dairy_eggs",
          "confidence": 0.94
        },
        {
          "name": "Tomatoes",
          "brand": null,
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
      "warnings": [],
      "overallConfidence": 0.88
    },
    "parseError": null,
    "images": [{ "position": 0, "mimeType": "image/jpeg" }]
  }
}
```

`status` is one of `UPLOADED | PARSING | PARSED | FAILED | CONFIRMED | DISCARDED` (see
`PROJECT_SPEC.md` §5). When `status` is `FAILED`, `parseError` holds a user-facing message and
`parsedPayload` is `null`. A category slug the model invented is coerced server-side to `other`
before this response is built, so the client never sees an unknown `categoryId` here.

## `POST /receipts/:id/reparse`

Retries a `FAILED` parse. **The client must resend the same images** — the server never retained
them from the original `POST /receipts` call, so the request body shape is identical (`images`
only, no `clientRef`). `400` if the receipt isn't currently `FAILED`. Response `202`, same shape as
`POST /receipts`.

## `POST /receipts/:id/confirm`

BR-2/BR-3: creates the `Order` + `OrderItem[]` from the **client's final, user-edited payload** —
the backend trusts this payload's arithmetic, it does not re-derive it from `parsedPayload`. Idempotent:
confirming an already-`CONFIRMED` receipt returns the existing order rather than erroring or
duplicating. `400` if the receipt is in a status that can't be confirmed (e.g. still `PARSING`).

`aiCategoryId` on each item, when present, is compared against the final `categoryId` to record a
correction in `ItemCategoryOverride` for the learning loop — omit it for items the user added by
hand that never came from a parse.

**Single currency only.** `currency` must equal the account's configured currency (`User.currency`,
`"EGP"` by default) — there's no multi-currency support (`MonthlySummary` has no currency
dimension), so a mismatched currency is a `400 VALIDATION_ERROR` naming the field `currency`, not a
silent accept. `PATCH /orders/:id` enforces the same rule whenever `currency` is included in the body.

Request:

```json
{
  "merchant": "Carrefour",
  "periodMonth": "2026-07",
  "periodWeek": 2,
  "currency": "EGP",
  "subtotal": "612.00",
  "tax": "38.00",
  "discount": "0.00",
  "total": "650.00",
  "actualPaid": null,
  "notes": null,
  "items": [
    {
      "name": "Full Cream Milk",
      "brand": "Milkman",
      "quantity": 1,
      "unit": "L",
      "unitPrice": "45.00",
      "lineTotal": "45.00",
      "categoryId": "dairy_eggs",
      "aiCategoryId": "dairy_eggs",
      "position": 0,
      "isProtein": false
    }
  ]
}
```

`brand` is optional/nullable on every item shape — most produce, bakery, and unbranded items
legitimately have none. It is display-only and does not affect price-history matching (see
`GET /items/price-history` below), which stays keyed on `name` alone.

`periodWeek` (1-5, week within `periodMonth`) defaults to `1` when omitted — an order with no week
opinion just reads as week 1, same as an order created before this field existed. `isProtein`
defaults to `false` on every item. A protein-flagged item counts normally toward
`GET /analytics/month/:month`'s `totalAmount`/`categories` (same as any other item) **and** toward
that response's separate `protein` total — it is excluded only from `weeks`, regardless of the
item's `categoryId` or the order's `periodWeek`.

`actualPaid` is optional, nullable, and non-negative — what actually left the wallet (tip, rounding,
a register discount) when it differs from `total`. Omit or send `null` when it's the same as `total`.
Clients display `actualPaid ?? total` wherever an order's total appears (order list, order detail);
`total` itself is never overwritten, so the original receipt figure stays visible. It also feeds
`GET /analytics/month/:month`'s `budget` block — see below.

Response `200`:

```json
{ "data": { "orderId": "clx1order" } }
```

## `DELETE /receipts/:id`

Soft-discards an unconfirmed receipt (`status = DISCARDED`). `400` if the receipt is already
`CONFIRMED` — a confirmed receipt is the thing an order exists for; it can't be discarded from
under it. There's no blob storage, so there's no cleanup job to trigger.

Response `200`:

```json
{ "data": { "id": "clx1receipt", "discarded": true } }
```

## `GET /analytics/month/:month`

BR-5 month detail: total spend, order/item counts, per-category breakdown, per-week breakdown, and
protein spend for one month. Reads only the materialized `MonthlySummary`/`WeeklySummary`/
`ProteinMonthlySummary` tables, never `OrderItem` (§12). Categories are sorted by that month's
total, descending.

Response `200`:

```json
{
  "data": {
    "month": "2026-07",
    "currency": "EGP",
    "totalAmount": "1830.00",
    "orderCount": 12,
    "itemCount": 64,
    "categories": [
      {
        "categoryId": "produce",
        "name": "Produce",
        "emoji": "🥦",
        "totalAmount": "420.00",
        "itemCount": 18,
        "orderCount": 6
      }
    ],
    "weeks": [
      { "week": 1, "totalAmount": "500.00", "itemCount": 20, "orderCount": 4 },
      { "week": 2, "totalAmount": "0.00", "itemCount": 0, "orderCount": 0 },
      { "week": 3, "totalAmount": "830.00", "itemCount": 30, "orderCount": 5 },
      { "week": 4, "totalAmount": "0.00", "itemCount": 0, "orderCount": 0 },
      { "week": 5, "totalAmount": "500.00", "itemCount": 14, "orderCount": 3 }
    ],
    "protein": { "totalAmount": "310.00", "itemCount": 9, "orderCount": 5 },
    "budget": {
      "weeks": [
        { "week": 1, "budgetAmount": "600.00", "spentAmount": "520.00", "remaining": "80.00" },
        { "week": 2, "budgetAmount": null, "spentAmount": "0.00", "remaining": null },
        { "week": 3, "budgetAmount": "600.00", "spentAmount": "805.00", "remaining": "-205.00" },
        { "week": 4, "budgetAmount": null, "spentAmount": "0.00", "remaining": null },
        { "week": 5, "budgetAmount": "600.00", "spentAmount": "515.00", "remaining": "85.00" }
      ],
      "protein": { "budgetAmount": "350.00", "spentAmount": "310.00", "remaining": "40.00" },
      "month": { "budgetAmount": null, "spentAmount": "1840.00", "remaining": null }
    }
  }
}
```

`categories` is empty (not absent) for a month with no orders. Top merchants/items from
PROJECT_SPEC.md §4's BR-5 aren't in this response — only what's shown above is implemented.

`currency` is the account's one configured currency (`User.currency`) — there's no per-order
currency breakdown here because there's no multi-currency support (see the confirm/update note
below). Every amount in this response is in this currency.

**`totalAmount` and `categories` include items flagged `OrderItem.isProtein` normally** — a protein
item counts toward the month total and its category's total exactly like any other item. `weeks` is
the one exception: it **excludes** protein items, so `sum(weeks[].totalAmount) + protein.totalAmount
≈ totalAmount` (protein spend isn't dropped, it's just never split across weeks — see BR-2's protein
ask). `protein` is a separate lens on spend already counted above, not a subtraction from it.

`weeks` always has exactly 5 entries (week 1-5), zero-filled for any week with no (non-protein)
spending — the month total split by `Order.periodWeek`, total-only (no per-category breakdown per
week), excluding protein items. `protein` is a single month-level total of every
`OrderItem.isProtein = true` line, zero-filled when none exist — it is unaffected by category or
`periodWeek` (an order's week doesn't affect whether its protein items count, and they count here
regardless of category).

`budget` carries whatever the user has set via `PUT /budgets/:month`, plus what's actually been
spent against it and what's left. `weeks[].spentAmount` and `month.spentAmount` are **actual cash
out** — `Σ(order.actualPaid ?? order.total)` — not the item-based `totalAmount`/`categories` above:
they include tax and discount (baked into `total`) and reflect `actualPaid` overrides, neither of
which the item-based figures do. They can legitimately differ from `totalAmount` for that reason.
`protein.spentAmount` is the exception — it reuses the item-based `protein.totalAmount` above, since
`actualPaid` is an order-level fact with no principled way to attribute it to just the protein items
in an order.

`budgetAmount` is `null` for any week (or `protein`) with no budget set — `remaining` is `null` too in
that case, since there's nothing to compare spend against.

`month.budgetAmount` is `Σ(weeks[].budgetAmount)` — **and only that**, `protein.budgetAmount` is
deliberately left out of it, even though it's a monthly target too. Protein isn't separate money:
every protein purchase already sits inside whichever week's order it was bought in, so it's already
counted in that week's `spentAmount`. Adding `protein.budgetAmount` on top of the week budgets would
size the month target for cash that was never actually free to spend a second time, which silently
inflates `month.remaining` by the whole protein budget. Protein stays visible as its own line
(`protein`) — a second, overlapping lens on the same cash, not additional cash. `month.budgetAmount`
is also `null` unless **every** week (1-5) has a budget set — comparing a partial target (say, only
one week budgeted) against the whole month's spend would read as "over/under budget" against money
three other weeks never had a target for. It's computed on every read, never stored, so it can't
drift from its parts.

## `GET /budgets/:month`

Prefill for a budgets-editing screen. Returns exactly the `budget` object described above, on its own:

```json
{
  "data": {
    "weeks": [
      { "week": 1, "budgetAmount": "600.00", "spentAmount": "520.00", "remaining": "80.00" },
      { "week": 2, "budgetAmount": null, "spentAmount": "0.00", "remaining": null },
      { "week": 3, "budgetAmount": "600.00", "spentAmount": "805.00", "remaining": "-205.00" },
      { "week": 4, "budgetAmount": null, "spentAmount": "0.00", "remaining": null },
      { "week": 5, "budgetAmount": "600.00", "spentAmount": "515.00", "remaining": "85.00" }
    ],
    "protein": { "budgetAmount": "350.00", "spentAmount": "310.00", "remaining": "40.00" },
    "month": { "budgetAmount": null, "spentAmount": "1840.00", "remaining": null }
  }
}
```

## `PUT /budgets/:month`

Sets some or all of a month's weekly budgets plus its protein budget in one call — a partial update:
an omitted `weeks`/`protein` leaves that budget untouched, and a `weeks` entry only upserts the weeks
named in it (the other weeks in the month are left alone). A week's own `amount: null` deletes just
that week's budget (back to unset), same convention as `protein: null` for the protein budget.
Omitting `weeks`/`protein` leaves each untouched; at least one of the two is required. `weeks` holds
1-5 entries, one per week number (1-5) — a duplicate week in the same request is a `400`.

Every amount (`weeks[].amount`, `protein`) must be non-negative — a negative budget is rejected as a
`400`, unlike `total`/`discount`/an adjustment line item, none of which have that restriction.

Request:

```json
{
  "weeks": [
    { "week": 1, "amount": "600.00" },
    { "week": 3, "amount": null }
  ],
  "protein": "350.00"
}
```

`week: 3` above clears that week's budget; `week: 1` sets/updates it.

Response `200`: the updated `budget` object, same shape as `GET /budgets/:month` — lets the client
show the new `remaining` figures without a second round trip.

## `GET /orders`

The month list behind the app's Orders screen. Query parameters: `month` (`YYYY-MM`, omitted =
every month), `cursor` (the `nextCursor` of the previous page), `limit` (1–100, default 50).

Orders come back newest-created first (`Order.createdAt` descending). There is no separate receipt
date on the wire — extraction no longer parses one (docs/prompts/extraction.v3.md), so `createdAt`
(when the order was saved) is the only date an order carries. Rows carry an item count rather than
the items themselves — fetch `GET /orders/:id` for those.

Response `200`:

```json
{
  "data": {
    "orders": [
      {
        "id": "clx1order",
        "merchant": "Carrefour",
        "periodMonth": "2026-07",
        "periodWeek": 2,
        "currency": "EGP",
        "total": "650.00",
        "actualPaid": null,
        "itemCount": 12,
        "source": "receipt",
        "createdAt": "2026-07-14T19:02:11.412Z"
      }
    ],
    "nextCursor": "clx1order"
  }
}
```

`nextCursor` is `null` on the last page. A `cursor` that isn't one of the caller's own order ids is
a `400` — it is a keyset anchor, not an opaque token, so it has to resolve within their orders.

`actualPaid` is `null` unless the user recorded a different amount actually paid (tip, rounding, a
register discount) — see `POST /receipts/:id/confirm` above. Display `actualPaid ?? total`.

## `GET /orders/:id`

Response `200` — the order with its line items, in `position` order:

```json
{
  "data": {
    "id": "clx1order",
    "receiptId": "clx1receipt",
    "merchant": "Carrefour",
    "periodMonth": "2026-07",
    "periodWeek": 2,
    "currency": "EGP",
    "subtotal": "612.00",
    "tax": "38.00",
    "discount": "0.00",
    "total": "650.00",
    "actualPaid": null,
    "notes": null,
    "source": "receipt",
    "itemCount": 1,
    "createdAt": "2026-07-14T19:02:11.412Z",
    "updatedAt": "2026-07-14T19:02:11.412Z",
    "items": [
      {
        "id": "clx1item",
        "name": "Full Cream Milk",
        "brand": "Milkman",
        "quantity": 1,
        "unit": "L",
        "unitPrice": "45.00",
        "lineTotal": "45.00",
        "categoryId": "dairy_eggs",
        "aiCategoryId": "dairy_eggs",
        "position": 0,
        "isProtein": false
      }
    ]
  }
}
```

`quantity` is a JSON **number** — it is a count or weight, not an amount. Every money field beside
it is a string.

`404` when the id doesn't exist *or* belongs to another user.

## `GET /orders/by-category`

The Home screen's "expand a category" drill-down (PROJECT_SPEC.md §10, screen 1): every item in
one month that falls under one category, grouped by the order it was bought in. Query parameters:
`month` (`YYYY-MM`, **required**), `categoryId` (required, one of the taxonomy slugs from
`GET /categories`).

Unlike `GET /orders`, `month` isn't optional — this reads `OrderItem` rows directly rather than the
materialized `MonthlySummary`, and an unscoped scan across every month a user owns isn't a query
this endpoint offers. It doesn't paginate: a month's items in one category is bounded enough that a
cursor would be premature.

Orders come back newest-created first, same ordering as `GET /orders`; items within an order come
back in `position` order. An order with no items in the requested category is simply absent from
the list.

Response `200`:

```json
{
  "data": {
    "month": "2026-07",
    "categoryId": "dairy_eggs",
    "orders": [
      {
        "orderId": "clx1order",
        "merchant": "Carrefour",
        "createdAt": "2026-07-14T19:02:11.412Z",
        "currency": "EGP",
        "items": [
          {
            "id": "clx1item",
            "name": "Full Cream Milk",
            "brand": "Milkman",
            "quantity": 2,
            "unit": "L",
            "unitPrice": "60.00",
            "lineTotal": "120.00",
            "categoryId": "dairy_eggs",
            "aiCategoryId": "dairy_eggs",
            "position": 0,
            "isProtein": false
          }
        ]
      }
    ]
  }
}
```

`categoryId` that isn't a known taxonomy slug is a `400`.

## `GET /items/price-history`

Every past purchase of one item (matched by `OrderItem.normalizedName` — the same
`trim().toLowerCase()` key the confirm/edit flows already write), its cheapest store, and whether
the most recent purchase was a price jump over the one before it. Backs the item-history sheet
opened from the Review screen's badges, the Analytics "Price Watch" section, and the Home teaser.

Query: `name` (**required**) — sent as the raw item name; the server normalizes it the same way
`OrderItem.normalizedName` is written, so the client doesn't need to duplicate that rule.

`priceCreep` only ever compares two purchases at the **same merchant** (matched case-insensitively)
**and the same `unit`** — a cheaper price at a *different* store is what `cheapest` is for, never
treated as a price drop/rise for this item, and a per-kg price is never compared against a per-item
price for the same item name. `priceCreep` is `null` when there's no matching prior purchase, or
when the increase is below the 15% threshold. `cheapest` is scoped to the most recent purchase's
unit for the same reason.

Response `200`:

```json
{
  "data": {
    "itemName": "Full Cream Milk",
    "history": [
      { "orderId": "clx3order", "merchant": "Carrefour", "brand": "Milkman", "unitPrice": "24.00", "createdAt": "2026-07-14T19:02:11.412Z", "periodMonth": "2026-07" },
      { "orderId": "clx2order", "merchant": "Metro", "brand": "Almarai", "unitPrice": "18.00", "createdAt": "2026-06-02T10:15:00.000Z", "periodMonth": "2026-06" },
      { "orderId": "clx1order", "merchant": "Carrefour", "brand": "Milkman", "unitPrice": "20.00", "createdAt": "2026-05-01T09:20:00.000Z", "periodMonth": "2026-05" }
    ],
    "cheapest": { "orderId": "clx2order", "merchant": "Metro", "brand": "Almarai", "unitPrice": "18.00", "createdAt": "2026-06-02T10:15:00.000Z", "periodMonth": "2026-06" },
    "priceCreep": {
      "previousMerchant": "Carrefour",
      "previousUnitPrice": "20.00",
      "latestUnitPrice": "24.00",
      "changeRatio": 0.2
    }
  }
}
```

An item never bought before returns `history: []`, `cheapest: null`, `priceCreep: null` — not a 404.
`brand` on each history entry is that purchase's own stored brand — matching stays on item name
alone, so entries for the same item can carry different brands (a store-brand swap doesn't drop out
of history the way a different `name` would).

## `POST /items/price-check`

One-shot batch lookup for the Review screen's unconfirmed draft items, fired once when the screen
loads rather than per row. `items` accepts at most 50 entries and each `name` at most 200
characters — over either limit is a `400 VALIDATION_ERROR` for the whole batch, not a partial
result. `merchant` is the receipt's own (not-yet-saved) merchant, matched
case-insensitively against history; each draft item's own (not-yet-saved) `unitPrice` — not any
value already in the database — is what gets compared.

Request:

```json
{
  "merchant": "Carrefour",
  "items": [
    { "name": "Tomatoes 1kg", "unitPrice": "24.00", "unit": "kg" },
    { "name": "Kombucha" }
  ]
}
```

`unitPrice` and `unit` are both optional — a draft row the user hasn't priced yet still gets a
`cheapest` lookup, just no `priceCreep`. A draft with no `unit` only matches history rows that also
have no `unit` recorded (a per-kg price and a per-item price for the same item name are never
compared). Response `200`, one result per **unique** normalized item name in the request
(duplicates in `items` collapse to one entry):

```json
{
  "data": [
    {
      "name": "tomatoes 1kg",
      "cheapest": { "orderId": "clx2order", "merchant": "Metro", "brand": null, "unitPrice": "18.00", "createdAt": "2026-06-02T10:15:00.000Z", "periodMonth": "2026-06" },
      "priceCreep": {
        "previousMerchant": "Carrefour",
        "previousUnitPrice": "20.00",
        "latestUnitPrice": "24.00",
        "changeRatio": 0.2
      }
    },
    { "name": "kombucha", "cheapest": null, "priceCreep": null }
  ]
}
```

## `PATCH /orders/:id`

Edits a saved order (BR-4). Every field is optional; an omitted field is left untouched, so
`"notes": null` clears the notes while omitting `notes` keeps them. A body with no fields at all is
a `400`.

`items` replaces the **whole** line-item list — the client owns the list, and the ids of rows the
user just added don't exist server-side yet. Because that changes what the order is worth,
`subtotal` and `total` are required whenever `items` is present; their arithmetic is trusted, not
checked (BR-2). Each item needs a distinct `position`. A `categoryId` that is unknown *or retired*
comes back as a field-level `400` (`details.issues[].path` = `items.<n>.categoryId`), not a 500.
`isProtein` defaults to `false` per item when omitted.

`periodWeek` (1-5) can be changed independently of `periodMonth` — moving only the week still
recomputes that month's `WeeklySummary` rows (a full-month recompute covers every week in it), but
doesn't trigger the two-month recompute that a `periodMonth` change does.

Echo `aiCategoryId` back for rows that came from a parse — it is what lets a re-categorization be
recorded in `ItemCategoryOverride` for the learning loop (§11). Only categories that changed in
*this* edit are recorded, so re-saving an order doesn't file the same correction twice. Omit the
field for rows the user added by hand.

Moving an order to another month recomputes the summaries for **both** months and drops any cached
`MonthComparison` referencing either one.

`actualPaid` follows the same absent/null convention as `notes`: omit it to leave it untouched,
`null` to clear it back to "same as `total`". Changing it (or `total`) shifts `GET
/analytics/month/:month`'s `budget.weeks[].spentAmount`/`budget.month.spentAmount` for whichever
week(s) the order falls in — those are computed live from `Order`, not a materialized summary, so
there's nothing else to recompute or invalidate for it.

Request:

```json
{
  "merchant": "Carrefour City",
  "periodMonth": "2026-08",
  "periodWeek": 1,
  "subtotal": "45.00",
  "tax": "0.00",
  "discount": "0.00",
  "total": "45.00",
  "actualPaid": "50.00",
  "items": [
    {
      "name": "Tomatoes",
      "brand": null,
      "quantity": 2,
      "unit": "kg",
      "unitPrice": "22.50",
      "lineTotal": "45.00",
      "categoryId": "produce",
      "aiCategoryId": "produce",
      "position": 0,
      "isProtein": false
    }
  ]
}
```

Response `200`: the updated order, in the same shape as `GET /orders/:id`.

## `DELETE /orders/:id`

Deletes the order, cascades its items, and recomputes that month's summary. If the order came from
a receipt, the receipt is released from `CONFIRMED` back to `PARSED` — `Order.receiptId` is unique,
so a receipt left at `CONFIRMED` with its order gone could never produce one again.

Response `200`:

```json
{ "data": { "id": "clx1order" } }
```

`404` when the id doesn't exist or belongs to another user.

## `GET /analytics/trends`

Series of monthly totals plus a per-category series, for the rolling window of `months` months
ending at the current month (BR-5). Reads the materialized `MonthlySummary` table — never scans
`OrderItem`. Every month in the window appears in the response, even with no spending, so a client
can plot a continuous x-axis. `categories` is sorted by each category's total across *this*
window, descending, with a `categoryId` tiebreak for a deterministic order — that ordering is not
comparable across two different `GET /analytics/trends` calls with different `months`, nor with
`GET /analytics/month/:month` (which sorts by that single month's total instead). Key any client-side
color assignment by `categoryId`, not by array position, if it needs to stay stable across requests.

Query: `months` (optional, integer 1–24, default 6). Out of that range, or non-integer, is a `400
VALIDATION_ERROR`.

Response `200`:

```json
{
  "data": {
    "months": ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"],
    "currency": "EGP",
    "totals": [
      { "month": "2026-02", "totalAmount": "812.40" },
      { "month": "2026-03", "totalAmount": "930.10" }
      // … one entry per month in "months"
    ],
    "categories": [
      {
        "categoryId": "produce",
        "name": "Produce",
        "emoji": "🥦",
        "totalAmount": "540.00",
        "series": [
          { "month": "2026-02", "totalAmount": "80.00" },
          { "month": "2026-03", "totalAmount": "95.00" }
          // … one entry per month in "months"
        ]
      }
    ]
  }
}
```

## `GET /analytics/price-watch`

Every item bought in `month` whose unit price jumped at least 15% over the last purchase of that
item at the **same merchant and unit** — the same rule as `priceCreep` in `GET /items/price-history`,
so a store switch or a unit change is never counted as a price rise. "Last purchase" can be an
earlier purchase within `month` itself, not only a strictly earlier month. Backs the Home teaser
(client just reads the array length) and the Analytics "Price Watch" section. Sorted by the sharpest
increase first, capped at 20 items.

Query: `month` (**required**, `YYYY-MM`).

Response `200`:

```json
{
  "data": [
    {
      "itemName": "Full Cream Milk",
      "brand": "Milkman",
      "normalizedName": "full cream milk",
      "merchant": "Spinneys",
      "previousMerchant": "Spinneys",
      "previousUnitPrice": "24.00",
      "latestUnitPrice": "30.00",
      "changeRatio": 0.25,
      "periodMonth": "2026-07"
    }
  ]
}
```

An empty array means nothing crossed the threshold this month — not an error.

## `POST /analytics/compare`

An AI-generated narrative comparing two months' spending (BR-5). Reads only the materialized
`MonthlySummary` aggregates and each month's top merchants from `Order` — never raw `OrderItem`
rows or receipt images (PROJECT_SPEC.md §7.3). Manually triggered only; nothing calls this route
automatically.

Body:

```json
{ "monthB": "2026-07", "monthA": "2026-06", "refresh": false }
```

- `monthB` (**required**, `YYYY-MM`).
- `monthA` (optional, `YYYY-MM`). Omit it to compare `monthB` against a synthetic baseline: the
  per-category average of the 3 months immediately before `monthB`, built server-side into the same
  shape as a real month so the prompt never needs to know the difference.
- `refresh` (optional, default `false`). Set `true` to bypass the `MonthComparison` cache and force
  a fresh AI call — any other order write that touches either month already invalidates the cache
  automatically (`invalidateMonthComparisons`), so `refresh` is only for "I want a new take on the
  same numbers."

Response `200`:

```json
{
  "data": {
    "payload": {
      "headline": "Dining drove the increase, up 61% on more takeout orders.",
      "drivers": [
        { "category": "dining", "direction": "up", "amount": "1300.00", "explanation": "…" }
      ],
      "anomalies": [],
      "suggestions": ["Set a dining budget for next month.", "…"],
      "confidence": 0.85
    },
    "model": "gemini-3.5-flash",
    "cached": true,
    "currency": "EGP"
  }
}
```

`currency` is the account's one configured currency (`User.currency`) — every amount in `payload`
is in it; there's no per-driver currency to mix. `drivers[].category` is always a slug that appears in `monthA` or `monthB`'s aggregate — any
category the model invents is dropped server-side, never surfaced. `cached: true` means this exact
`(userId, monthA, monthB, dataVersion)` combination was already generated; `dataVersion` is a hash
of both months' aggregates, so it changes whenever the underlying numbers do.

## Stub error shape (`POST /orders`, `POST /auth/apple`, `POST /auth/refresh`)

Response `501`:

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "POST /api/v1/orders is not implemented yet."
  }
}
```

`400` (Zod rejected the body, or the body wasn't valid JSON). `details.issues` names the offending
fields — clients should show these rather than the generic `message`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request failed validation.",
    "details": {
      "issues": [{ "path": "items.0.lineTotal", "message": "Money must be a string like \"45.00\"." }]
    }
  }
}
```

`404` (resource doesn't exist, or belongs to another user — every business route scopes its Prisma
query by `userId` and returns `NOT_FOUND` rather than a 403, so existence is never leaked):

```json
{ "error": { "code": "NOT_FOUND", "message": "Order not found." } }
```

## Error codes

| Code | HTTP status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed Zod validation, or wasn't valid JSON |
| `UNAUTHENTICATED` | 401 | Reserved for bearer-token auth once it exists. Today the only route that ever throws it is `POST /echo`'s debug-token check (missing/wrong `X-Debug-Token`) — no route checks an `Authorization` header yet |
| `NOT_FOUND` | 404 | Resource doesn't exist, or belongs to another user (never 403 — don't leak existence) |
| `RATE_LIMITED` | 429 | Defined for future per-user/per-IP limits (parse quota, AI spend) — no code path throws it yet |
| `NOT_IMPLEMENTED` | 501 | Route not built yet: `POST /orders`, `POST /auth/apple`, `POST /auth/refresh` |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

`POST /echo` also uses a bare `502` (not one of the codes above, and not in `docs/api.md`'s error
envelope convention) when the configured AI provider itself returns an error — see that section.
