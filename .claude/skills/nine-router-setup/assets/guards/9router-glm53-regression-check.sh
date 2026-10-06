#!/bin/bash
# 9router-glm53-regression-check.sh — fails loudly if a 9Router update (or anything
# else) has undone the GLM 5.3 Flash reasoning-effort repairs.
#
# It is deliberately NOT a grep for patch markers: it loads the real bundle modules
# and drives the real request pipeline, so it fails on a BEHAVIOUR regression even if
# the anchors survive, and on an anchor regression even if behaviour coincidentally
# matches. Four regression classes are reported by name:
#
#   CAPS      wrong glm-5.3-flash capability resolution (missing effort support, or a
#             reduced generic entry winning instead of the full Flash entry)
#   LEVELS    the max -> xhigh downgrade is back (or CodeBuddy's own rule was altered,
#             or the rule leaked to providers it was never scoped to)
#   OPENROUTER the OpenRouter request no longer carries reasoning:{effort:...}
#   OLLAMA    the Ollama request no longer carries a native top-level think
#   RESPONSE  a reasoning-visibility repair on the response path was lost
#   BLAST-RADIUS an unrelated provider/model stopped matching its stock behaviour
#
# Usage: 9router-glm53-regression-check.sh [--quiet] [9router_root]
# Exit: 0 all clear · 1 a regression was found · 2 could not run the check at all
#       (never reported as a pass).
set -uo pipefail

QUIET=0; ROOT=""
for a in "$@"; do
  case "$a" in
    --quiet) QUIET=1 ;;
    *) ROOT="$a" ;;
  esac
done
ROOT="${ROOT:-$HOME/.npm-global/lib/node_modules/9router}"
SUITE="$HOME/.9router/patches/glm-5.3-thinking/regression-v2.cjs"
GUARD="$HOME/.local/bin/9router-glm53-thinking-guard.sh"
[ -x "$GUARD" ] || GUARD="$HOME/.9router/patches/glm-5.3-thinking/9router-glm53-thinking-guard.sh"

[ -f "$SUITE" ] || { echo "REGRESSION-CHECK FAIL: suite not found at $SUITE"; exit 2; }
[ -d "$ROOT/app/.next-cli-build" ] || { echo "REGRESSION-CHECK FAIL: no bundle at $ROOT/app/.next-cli-build"; exit 2; }

NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "REGRESSION-CHECK FAIL: no node binary resolvable"; exit 2; }

OUT="$("$NODE" "$SUITE" "$ROOT" 2>&1)"; RC=$?
if [ $RC -eq 2 ]; then
  echo "REGRESSION-CHECK FAIL: the suite could not load the bundle at $ROOT"
  echo "$OUT" | tail -5
  exit 2
fi

[ "$QUIET" = "1" ] || echo "$OUT"

if [ $RC -eq 0 ]; then
  echo "REGRESSION-CHECK OK: GLM 5.3 Flash reasoning controls intact ($(echo "$OUT" | grep -c '^  PASS') assertions)."
  exit 0
fi

# Map the failing assertion ids onto the four named regression classes.
FAILED="$(echo "$OUT" | sed -n 's/^  FAIL  //p')"
CLASSES=""
echo "$FAILED" | grep -qE '^1\.' && CLASSES="$CLASSES CAPS"
echo "$FAILED" | grep -qE '^2\.' && CLASSES="$CLASSES LEVELS"
echo "$FAILED" | grep -qE '^(3\.|5\.[1235])' && CLASSES="$CLASSES OPENROUTER"
echo "$FAILED" | grep -qE '^(4\.|5\.4)'      && CLASSES="$CLASSES OLLAMA"
echo "$FAILED" | grep -qE '^(5\.[567]|6\.)'  && CLASSES="$CLASSES BLAST-RADIUS"
echo "$FAILED" | grep -qE '^7\.'            && CLASSES="$CLASSES RESPONSE"
[ -n "$CLASSES" ] || CLASSES=" UNCLASSIFIED"

echo
echo "REGRESSION-CHECK FAIL: regressed classes:$CLASSES"
echo "Failing assertions:"
echo "$FAILED" | sed 's/^/  - /'
echo
echo "Most likely cause: a 9router update replaced app/.next-cli-build."
echo "Re-apply the local override, then re-run this check:"
echo "  $GUARD"
echo "  $0"
echo "Rollback (per file, newest backup beside each file):"
echo "  ls -t $ROOT/app/.next-cli-build/server/chunks/*.pre-glm53-thinking-* | head"
echo "  cp <file>.pre-glm53-thinking-<stamp> <file>"
exit 1
