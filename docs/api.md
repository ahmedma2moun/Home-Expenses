# API Reference — `/api/v1`

Backend: `apps/web` (Next.js Route Handlers), deployed on Vercel. This is the only API the iOS and
web clients talk to.

## Conventions

- **Envelope.** Every response is `{ "data": ... }` on success or
  `{ "error": { "code", "message", "details?" } }` on failure. See `lib/api/envelope.ts`.
- **Auth.** `Authorization: Bearer <access token>` (a short-lived app JWT, §8 of PROJECT_SPEC.md).
  `userId` is taken from the verified token only, never from the body/params/query.
- **Money** is always a string with two decimals, e.g. `"45.00"`. Never a JSON number.
- **Dates** are ISO-8601. **Months** are `"YYYY-MM"`.
- **Status.** Every route below is currently a scaffolded stub: it is wired for auth and the
  envelope but returns `501 { error: { code: "NOT_IMPLEMENTED" } }`. `GET /health` and
  `POST /echo` are the real implementations. Each row will get a full request/response example as
  its milestone lands.

| Method | Path | Auth | Milestone | Purpose |
|---|---|---|---|---|
| `POST` | `/auth/apple` | none | M0 (stub) | Exchange Apple identity token → JWT pair |
| `POST` | `/auth/refresh` | none | M0 (stub) | Rotate refresh token |
| `POST` | `/uploads/token` | required | M1 | `{ files: [{ mimeType, bytes }] }` → signed upload targets + blob keys |
| `POST` | `/receipts` | required | M1 | `{ clientRef, images: [{ blobKey, position, mimeType }] }` → creates receipt, starts parse |
| `GET` | `/receipts/:id` | required | M1 | Poll status + `parsedPayload` when `PARSED` |
| `POST` | `/receipts/:id/reparse` | required | M1 | Retry a `FAILED` parse (counts against quota) |
| `POST` | `/receipts/:id/confirm` | required | M2 | Body = final user-edited order + items + `periodMonth` → creates `Order`. `merchant` is required but may be an empty string — it is trimmed, and a blank one is stored as `"Unknown merchant"`. `periodMonth` may be any month, past or future (BR-4) |
| `DELETE` | `/receipts/:id` | required | M1 | Discard an unconfirmed receipt (soft delete + blob cleanup job) |
| `GET` | `/orders?month=YYYY-MM&cursor=&limit=` | required | M3 (live) | Paginated orders for a month; `month` omitted lists every month |
| `POST` | `/orders` | required | M3 | Manual order entry (no receipt) |
| `GET` | `/orders/:id` | required | M3 (live) | Order + items |
| `PATCH` | `/orders/:id` | required | M3 (live) | Edit merchant/notes/**periodMonth**/items |
| `DELETE` | `/orders/:id` | required | M3 (live) | Delete order (cascades items, recomputes summaries) |
| `GET` | `/categories` | required | M0/M3 | Taxonomy (cacheable, ETag) |
| `GET` | `/analytics/month/:month` | required | M4 | Totals, per-category breakdown, top merchants/items |
| `GET` | `/analytics/trends?months=12` | required | M4 | Series of monthly totals + per-category series |
| `POST` | `/analytics/compare` | required | M5 | `{ monthA, monthB, refresh? }` → cached or fresh AI narrative |
| `GET` | `/health` | none | M0 (live) | Liveness + DB + AI provider reachability |
| `POST` | `/echo` | debug token | M0 (live) | Deploy smoke test — round-trips a question through the configured AI provider (not part of the product API) |

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

## `GET /orders`

The month list behind the app's Orders screen. Query parameters: `month` (`YYYY-MM`, omitted =
every month), `cursor` (the `nextCursor` of the previous page), `limit` (1–100, default 50).

Orders come back newest purchase first; orders with no readable receipt date sort last. Rows carry
an item count rather than the items themselves — fetch `GET /orders/:id` for those.

Response `200`:

```json
{
  "data": {
    "orders": [
      {
        "id": "clx1order",
        "merchant": "Carrefour",
        "purchasedAt": "2026-07-14T18:32:00.000Z",
        "periodMonth": "2026-07",
        "currency": "EGP",
        "total": "650.00",
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

## `GET /orders/:id`

Response `200` — the order with its line items, in `position` order:

```json
{
  "data": {
    "id": "clx1order",
    "receiptId": "clx1receipt",
    "merchant": "Carrefour",
    "purchasedAt": "2026-07-14T18:32:00.000Z",
    "periodMonth": "2026-07",
    "currency": "EGP",
    "subtotal": "612.00",
    "tax": "38.00",
    "discount": "0.00",
    "total": "650.00",
    "notes": null,
    "source": "receipt",
    "itemCount": 1,
    "createdAt": "2026-07-14T19:02:11.412Z",
    "updatedAt": "2026-07-14T19:02:11.412Z",
    "items": [
      {
        "id": "clx1item",
        "name": "Tomatoes 1kg",
        "quantity": 2,
        "unit": "kg",
        "unitPrice": "22.50",
        "lineTotal": "45.00",
        "categoryId": "produce",
        "aiCategoryId": "produce",
        "position": 0
      }
    ]
  }
}
```

`quantity` is a JSON **number** — it is a count or weight, not an amount. Every money field beside
it is a string.

`404` when the id doesn't exist *or* belongs to another user.

## `PATCH /orders/:id`

Edits a saved order (BR-4). Every field is optional; an omitted field is left untouched, so
`"notes": null` clears the notes while omitting `notes` keeps them. A body with no fields at all is
a `400`.

`items` replaces the **whole** line-item list — the client owns the list, and the ids of rows the
user just added don't exist server-side yet. Because that changes what the order is worth,
`subtotal` and `total` are required whenever `items` is present; their arithmetic is trusted, not
checked (BR-2). Each item needs a distinct `position`. A `categoryId` that is unknown *or retired*
comes back as a field-level `400` (`details.issues[].path` = `items.<n>.categoryId`), not a 500.

Echo `aiCategoryId` back for rows that came from a parse — it is what lets a re-categorization be
recorded in `ItemCategoryOverride` for the learning loop (§11). Only categories that changed in
*this* edit are recorded, so re-saving an order doesn't file the same correction twice. Omit the
field for rows the user added by hand.

Moving an order to another month recomputes the summaries for **both** months and drops any cached
`MonthComparison` referencing either one.

Request:

```json
{
  "merchant": "Carrefour City",
  "periodMonth": "2026-08",
  "subtotal": "45.00",
  "tax": "0.00",
  "discount": "0.00",
  "total": "45.00",
  "items": [
    {
      "name": "Tomatoes 1kg",
      "quantity": 2,
      "unit": "kg",
      "unitPrice": "22.50",
      "lineTotal": "45.00",
      "categoryId": "produce",
      "aiCategoryId": "produce",
      "position": 0
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

## Stub error shape (every other route, until its milestone)

Response `501`:

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "POST /api/v1/receipts is not implemented yet."
  }
}
```

`401` (missing/invalid bearer token, all routes except `/auth/*` and `/health`):

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Missing bearer token."
  }
}
```

`400` (Zod rejected the body). `details.issues` names the offending fields — clients should show
these rather than the generic `message`:

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

## Error codes

| Code | HTTP status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed Zod validation, or wasn't valid JSON |
| `UNAUTHENTICATED` | 401 | Missing, invalid, or expired bearer token |
| `NOT_FOUND` | 404 | Resource doesn't exist, or belongs to another user (never 403 — don't leak existence) |
| `RATE_LIMITED` | 429 | Per-user or per-IP limit exceeded (parse quota, AI spend) |
| `NOT_IMPLEMENTED` | 501 | Route not built yet (M0 scaffold only) |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
