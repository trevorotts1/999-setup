#!/usr/bin/env bash
# Offline test: pristine 9router@latest-pinned copy in a throwaway HOME -> guards apply, every marker proven, second run is a no-op.
# Usage: test-9router-guards.sh [VERSION]   (default 0.5.95; needs npm + network once)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; VER="${1:-0.5.95}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
P="$HOME/.local/share/999/npm"; mkdir -p "$P"
npm install -g --prefix "$P" "9router@$VER" --no-audit --no-fund >/dev/null 2>&1 || { echo "FAIL: npm install"; exit 2; }
I="$HERE/../scripts/macos/install-9router-guards.sh"
"$I" --check >/dev/null 2>&1 && { echo "FAIL: pristine bundle read as patched"; exit 1; }
G="$HOME/.local/share/999/npm/lib/node_modules/9router/app/.next-cli-build/server/app/api/usage/stream/route.js"; H0="$(shasum "$G" | cut -d" " -f1)"
bash "$HERE/../assets/guards/9router-usage-stream-guard.sh" --check "$P/lib/node_modules/9router" | grep -q "WOULD PATCH" || { echo "FAIL: usage-stream --check did not report WOULD PATCH"; exit 1; }
[ "$H0" = "$(shasum "$G" | cut -d" " -f1)" ] || { echo "FAIL: usage-stream --check wrote"; exit 1; }
"$I" --no-restart >"$T/a.out" 2>&1 || { cat "$T/a.out"; echo "FAIL: apply"; exit 1; }
grep -q MISSING "$T/a.out" && { echo "FAIL: MISSING after apply"; exit 1; }
"$I" --no-restart 2>&1 | grep -q "bundle unchanged" || { echo "FAIL: second run not idempotent"; exit 1; }
echo "PASS: 9Router $VER guards apply, prove, and re-run clean"
