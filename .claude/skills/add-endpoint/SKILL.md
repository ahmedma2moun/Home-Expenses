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
