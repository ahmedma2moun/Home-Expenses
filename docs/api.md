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
  envelope but returns `501 { error: { code: "NOT_IMPLEMENTED" } }`. `GET /health` is the one
  real implementation. Each row will get a full request/response example as its milestone lands.

| Method | Path | Auth | Milestone | Purpose |
|---|---|---|---|---|
| `POST` | `/auth/apple` | none | M0 (stub) | Exchange Apple identity token → JWT pair |
| `POST` | `/auth/refresh` | none | M0 (stub) | Rotate refresh token |
| `POST` | `/uploads/token` | required | M1 | `{ files: [{ mimeType, bytes }] }` → signed upload targets + blob keys |
| `POST` | `/receipts` | required | M1 | `{ clientRef, images: [{ blobKey, position, mimeType }] }` → creates receipt, starts parse |
| `GET` | `/receipts/:id` | required | M1 | Poll status + `parsedPayload` when `PARSED` |
| `POST` | `/receipts/:id/reparse` | required | M1 | Retry a `FAILED` parse (counts against quota) |
| `POST` | `/receipts/:id/confirm` | required | M2 | Body = final user-edited order + items + `periodMonth` → creates `Order` |
| `DELETE` | `/receipts/:id` | required | M1 | Discard an unconfirmed receipt (soft delete + blob cleanup job) |
| `GET` | `/orders?month=YYYY-MM&cursor=` | required | M3 | Paginated orders for a month |
| `POST` | `/orders` | required | M3 | Manual order entry (no receipt) |
| `GET` | `/orders/:id` | required | M3 | Order + items |
| `PATCH` | `/orders/:id` | required | M3 | Edit merchant/notes/**periodMonth**/items |
| `DELETE` | `/orders/:id` | required | M3 | Delete order (cascades items, recomputes summaries) |
| `GET` | `/categories` | required | M0/M3 | Taxonomy (cacheable, ETag) |
| `GET` | `/analytics/month/:month` | required | M4 | Totals, per-category breakdown, top merchants/items |
| `GET` | `/analytics/trends?months=12` | required | M4 | Series of monthly totals + per-category series |
| `POST` | `/analytics/compare` | required | M5 | `{ monthA, monthB, refresh? }` → cached or fresh AI narrative |
| `GET` | `/health` | none | M0 (live) | Liveness + DB + AI provider reachability |

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

## Error codes

| Code | HTTP status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed Zod validation, or wasn't valid JSON |
| `UNAUTHENTICATED` | 401 | Missing, invalid, or expired bearer token |
| `NOT_FOUND` | 404 | Resource doesn't exist, or belongs to another user (never 403 — don't leak existence) |
| `RATE_LIMITED` | 429 | Per-user or per-IP limit exceeded (parse quota, AI spend) |
| `NOT_IMPLEMENTED` | 501 | Route not built yet (M0 scaffold only) |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
