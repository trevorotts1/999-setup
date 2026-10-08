#!/usr/bin/env bash
# KEF001 K2: DeepSeek V4 Pro no longer exists. Fail if its model id appears in any
# tracked file except CHANGELOG.md history. Use deepseek-v4.1-flash instead.
# (the id is split below so this file never matches itself)
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
needle="deepseek-v4-""pro"
hits="$(git grep -n -i -I -e "$needle" -- . ':!CHANGELOG.md' || true)"
if [ -n "$hits" ]; then
  echo "FAIL: retired model id present (use deepseek-v4.1-flash):" >&2
  printf '%s\n' "$hits" | cut -c1-160 >&2
  exit 1
fi
echo "OK: no retired DeepSeek V4 Pro id outside CHANGELOG history"
