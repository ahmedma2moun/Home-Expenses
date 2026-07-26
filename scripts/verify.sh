#!/usr/bin/env bash
set -euo pipefail
cd apps/web
npx prisma generate
npm run typecheck
npm run lint
npm run format:check
npm run lint:boundaries
npm run test -- --coverage
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --exit-code
npm run build
echo "✅ verify passed"
