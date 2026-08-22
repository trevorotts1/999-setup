#!/usr/bin/env bash
# ci-launcher.sh — FIX-021 CI fixture probe for verify-macos.sh check 4.
# Exit 0 when the scratch fixture tree's launcher contract holds.
set -euo pipefail
root="${1:-}"
[ -n "$root" ] || { echo "usage: ci-launcher.sh <ci-root>" >&2; exit 2; }
[ -x "$root/.local/bin/claude-nine" ] || { echo "fixture launcher missing/not executable: $root/.local/bin/claude-nine" >&2; exit 1; }
echo "fixture claude-nine OK"
