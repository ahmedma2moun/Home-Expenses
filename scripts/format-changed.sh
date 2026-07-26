#!/usr/bin/env bash
# PostToolUse hook: format + lint whichever file Edit/Write just touched.
set -uo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0
[ -f "$FILE_PATH" ] || exit 0

case "$FILE_PATH" in
  *.ts|*.tsx)
    if [ -d "apps/web" ]; then
      npx --prefix apps/web prettier --write "$FILE_PATH" >/dev/null 2>&1
      npx --prefix apps/web eslint --fix "$FILE_PATH" >/dev/null 2>&1
    fi
    ;;
  *.swift)
    command -v swiftformat >/dev/null 2>&1 && swiftformat "$FILE_PATH" >/dev/null 2>&1
    command -v swiftlint >/dev/null 2>&1 && swiftlint --fix --path "$FILE_PATH" >/dev/null 2>&1
    ;;
esac

exit 0
