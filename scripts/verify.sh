#!/usr/bin/env bash
set -euo pipefail
cd apps/web
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi
npx prisma generate
npm run typecheck
npm run lint
npm run format:check
npm run lint:boundaries
npm run test -- --coverage
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code
npm run build
echo "✅ verify passed"
