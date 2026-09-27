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
