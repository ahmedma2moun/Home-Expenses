#!/usr/bin/env bash
# Blocks destructive DB commands. Exit 2 = block and tell Claude why.
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

if echo "$CMD" | grep -qiE 'prisma (db push|migrate reset|migrate resolve)'; then
  echo "Blocked: use 'prisma migrate dev' (see the db-migration skill). db push / reset / resolve are banned." >&2
  exit 2
fi

if echo "$CMD" | grep -qiE '\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b'; then
  echo "Blocked: raw destructive DDL. Generate a reviewed migration instead." >&2
  exit 2
fi

# Never point a migration/seed command at production
if echo "$CMD" | grep -qiE 'prisma (migrate|db seed)' && echo "$CMD" | grep -qiE 'PROD|production'; then
  echo "Blocked: migrations against production run only in CI." >&2
  exit 2
fi
exit 0
