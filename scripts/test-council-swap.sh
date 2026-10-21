#!/bin/bash
# CWE-048 closeout, F-046-2 regression: the installer's atomic
# current-link replacement across an aggregate change.
#
# The defect (canary re-run evidence, mini-swap-defect.log): the
# installer staged the new current link as .current.tmp.$$ and ran
# mv -f onto `current`. When `current` is a symlink to a directory,
# mv follows the link and drops the staged link INSIDE the old prefix
# instead of replacing the link, so `current` kept pointing at the old
# tree and stray .current.tmp links accumulated inside it. The old
# install battery never caught it because its reinstall leg reuses
# the SAME aggregate, where the wrong target still reads as correct.
#
# This test performs the scenario the defect needs: two installs into
# one data profile whose aggregates DIFFER, in the exact production
# update shape. The first install uses the PREVIOUS vendored bundle,
# extracted from this repository's own git history (the vendored
# folder as of the parent of the latest commit that touched it); the
# second install uses the current vendored bundle. Both are real,
# doctor-passing shipped trees.
#
# Assertions after the second install:
#   1. `current` is a symlink whose target is the SECOND aggregate,
#      and the second prefix is installed and complete.
#   2. The installer's own --check passes against the swapped state.
#   3. No .current.tmp.* entry exists anywhere under the runtime
#      directory (in particular not inside the first prefix).
#
# Everything runs under a fixture root in ${TMPDIR:-/tmp}.
# Run: bash scripts/test-council-swap.sh
set -uo pipefail

# Session-environment isolation (WER-004): never let a real operator
# config root (CLAUDE_CONFIG_DIR from a claude-nine session) or data
# profile leak into the battery's installs.
unset CLAUDE_CONFIG_DIR BLACKCEO_COUNCIL_DATA_DIR COUNCIL_RUNTIME_PREFIX || true

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_SH="$REPO_ROOT/scripts/council-runtime-install.sh"
SKILL_NAME="council-of-wise-elders"
VENDORED="$REPO_ROOT/.claude/skills/$SKILL_NAME"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

BASE="${TMPDIR:-/tmp}/cwe048-swap-battery"
rm -rf "$BASE"; mkdir -p "$BASE"
export npm_config_cache="$BASE/npm-cache"

read_agg() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$1/manifest.json"; }

AGG2="$(read_agg "$VENDORED")"
[ -n "$AGG2" ] && pass "current vendored aggregate read: $AGG2" || { echo "FAIL: cannot read vendored manifest"; exit 1; }

echo "== extract the previous vendored bundle from git history =="
LAST_VENDOR_COMMIT="$(git -C "$REPO_ROOT" log -1 --format=%H -- ".claude/skills/$SKILL_NAME")"
[ -n "$LAST_VENDOR_COMMIT" ] || { echo "FAIL: no vendoring commit found in git history"; exit 1; }
SKILL1="$BASE/skill-previous"
mkdir -p "$SKILL1"
git -C "$REPO_ROOT" archive "$LAST_VENDOR_COMMIT^" ".claude/skills/$SKILL_NAME" | tar -x -C "$BASE" \
  || { echo "FAIL: could not extract the previous vendored bundle"; exit 1; }
mv "$BASE/.claude/skills/$SKILL_NAME" "$SKILL1/bundle"
SKILL1="$SKILL1/bundle"
AGG1="$(read_agg "$SKILL1")"
[ -n "$AGG1" ] && [ "$AGG1" != "$AGG2" ] && pass "previous bundle aggregate differs: $AGG1" \
  || fail "previous bundle aggregate did not differ (agg1=$AGG1 agg2=$AGG2)"
node "$SKILL1/scripts/doctor.mjs" --root "$SKILL1" > "$BASE/skill1-doctor.log" 2>&1
[ $? -eq 0 ] && pass "previous bundle passes the package doctor" || fail "previous bundle doctor failed"

H="$BASE/home"; mkdir -p "$H"
DATA="$H/data"
BIN="$H/bin"

echo "== install 1: the previous bundle aggregate =="
HOME="$H" bash "$INSTALL_SH" --skill-dir "$SKILL1" --data-dir "$DATA" --bin-dir "$BIN" \
  > "$BASE/install1.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "first install exits 0" || { fail "first install exited $RC"; tail -5 "$BASE/install1.log"; }
[ -L "$DATA/runtime/current" ] && [ "$(readlink "$DATA/runtime/current")" = "$AGG1" ] \
  && pass "current points at the first aggregate" || fail "current wrong after first install"

echo "== install 2: the current bundle aggregate into the same data profile =="
HOME="$H" bash "$INSTALL_SH" --skill-dir "$VENDORED" --data-dir "$DATA" --bin-dir "$BIN" \
  > "$BASE/install2.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "second install exits 0" || { fail "second install exited $RC"; tail -5 "$BASE/install2.log"; }
[ -L "$DATA/runtime/current" ] && pass "current is still a symlink" || fail "current is not a symlink after the swap"
TARGET="$(readlink "$DATA/runtime/current" 2>/dev/null || true)"
[ "$TARGET" = "$AGG2" ] && pass "current now points at the SECOND aggregate" \
  || fail "current points at '$TARGET', expected the second aggregate $AGG2 (the F-046-2 defect shape)"
[ -f "$DATA/runtime/$AGG2/.install-complete" ] && pass "second prefix is installed and complete" \
  || fail "second prefix missing or incomplete"
STRAY="$(find "$DATA/runtime" -name '.current.tmp.*' -print 2>/dev/null)"
[ -z "$STRAY" ] && pass "no stray .current.tmp links anywhere under the runtime directory" \
  || fail "stray staged links left behind: $STRAY"
STRAY_OLD="$(find "$DATA/runtime/$AGG1" -name '.current.tmp.*' -print 2>/dev/null)"
[ -z "$STRAY_OLD" ] && pass "no stray staged link inside the first prefix" \
  || fail "stray staged link inside the first prefix: $STRAY_OLD"
HOME="$H" bash "$INSTALL_SH" --skill-dir "$VENDORED" --data-dir "$DATA" --bin-dir "$BIN" --check \
  > "$BASE/check2.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "install --check passes after the swap" || fail "install --check exited $RC after the swap"

rm -rf "$BASE"
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
