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
