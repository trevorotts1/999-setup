#!/usr/bin/env bash
# Offline regression check: a STALE glm53 regression fixture must never read as a behavioural regression.
# A bundle the fixture cannot drive exits 2 and says FATAL; the installer must report that as STALE with the
# fixture identity, and must keep "behavioural regression suite FAILED" for a real exit-1 FAIL only.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUITE="$HERE/../assets/guards/patches/glm-5.3-thinking/regression-v2.cjs"
INST="$HERE/../scripts/macos/install-9router-guards.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }

# a 9Router package that exists but carries no bundle modules: the fixture cannot resolve anything from it
R="$T/prefix/lib/node_modules/9router"; mkdir -p "$R/app/.next-cli-build/server/chunks"
printf '{"name":"9router","version":"9.9.9"}\n' >"$R/package.json"

# 1. the fixture names itself and its own digest BEFORE it touches the bundle
o="$(node "$SUITE" "$R" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && ok "unloadable bundle exits 2, not 1" || bad "unloadable bundle rc=$rc (want 2)"
printf '%s\n' "$o" | grep -Eq '^fixture *: glm53-regression-v2@[0-9]{4}-[0-9]{2}-[0-9]{2}\+sha256:[0-9a-f]{12}' \
  && ok "fixture identity line names id, revision and digest" || bad "no fixture identity line: $(printf '%s\n' "$o" | head -2)"
printf '%s\n' "$o" | grep -q '^FATAL: suite cannot run against this bundle: ' \
  && ok "the failure is named FATAL with the reason" || bad "no FATAL line: $(printf '%s\n' "$o" | tail -3)"

# 2. the installer reports STALE, carries the fixture identity, and does not claim a behavioural FAIL
HOME="$T/home" bash "$INST" --check --root "$R" glm53-thinking >"$T/inst.out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "installer still exits 1 when the guard is not proven" || bad "installer rc=$rc (want 1)"
grep -Eq '^\[guards\] STALE glm53-thinking: regression fixture glm53-regression-v2@[0-9]{4}-[0-9]{2}-[0-9]{2}\+sha256:[0-9a-f]{12} cannot run against 9Router 9\.9\.9' "$T/inst.out" \
  && ok "installer reports STALE with the fixture identity and the router version" || bad "installer line: $(grep 'glm53-thinking' "$T/inst.out" | head -2)"
grep -q 'behavioural regression suite FAILED' "$T/inst.out" \
  && bad "a stale fixture is still reported as a behavioural regression" || ok "stale fixture is not reported as a behavioural regression"

# 2b. the standalone repair helper must draw the same line
CHK="$HERE/../assets/guards/9router-glm53-regression-check.sh"
o="$(GLM53_SUITE="$SUITE" bash "$CHK" "$R" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && printf '%s\n' "$o" | grep -q 'could not run against .* (fixture glm53-regression-v2@' \
  && printf '%s\n' "$o" | grep -q 'NOT a behavioural regression' \
  && ok "regression-check names the fixture and the stale class on exit 2" \
  || bad "regression-check rc=$rc: $(printf '%s\n' "$o" | head -3)"

# 3. on a real 9Router install the fixture passes and the pass line still carries its identity
real="$HOME/.npm-global/lib/node_modules/9router"
if [ -f "$real/package.json" ] && grep -q '"name": *"9router"' "$real/package.json"; then
  o="$(node "$SUITE" "$real" 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && printf '%s\n' "$o" | grep -q 'FAIL 0' \
    && ok "fixture passes on the installed 9Router ($(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$real/package.json" | head -1))" \
    || bad "fixture rc=$rc on the installed 9Router: $(printf '%s\n' "$o" | tail -3)"
  printf '%s\n' "$o" | grep -q '^fixture *: glm53-regression-v2' && ok "pass path carries the fixture identity" || bad "pass path lost the fixture identity"
else
  echo "SKIP no 9Router install at $real"
fi
exit $fail
