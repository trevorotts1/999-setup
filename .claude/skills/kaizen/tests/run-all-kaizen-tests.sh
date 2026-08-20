#!/bin/bash
# Run every Kaizen test suite and report a combined result.
# Suites: core (7.1-7.13), fix01..fix14. Any suite missing is reported as
# "SKIPPED (missing)" and the run fails: a skipped suite is a gap, not a pass.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TESTS_DIR="$SKILL_DIR/tests"
PASS_SUITES=0
FAILED_SUITES=""
SKIPPED_SUITES=""

say() { printf '%s\n' "$*"; }

run_suite() {
  local name="$1" script="$2"
  if [ ! -f "$script" ]; then
    SKIPPED_SUITES="$SKIPPED_SUITES $name"
    say "== $name: SKIPPED (missing $script) =="
    return
  fi
  say "== $name =="
  if bash "$script" >/dev/null 2>&1; then
    PASS_SUITES=$((PASS_SUITES+1))
    say "   PASS"
  else
    FAILED_SUITES="$FAILED_SUITES $name"
    say "   FAIL"
    bash "$script" 2>&1 | grep -E '^\s*FAIL|RESULT:' || true
  fi
}

run_suite "core (7.1-7.13)" "$TESTS_DIR/run-kaizen-tests.sh"
run_suite "walkthroughs (A-F)" "$TESTS_DIR/walkthroughs.sh"
run_suite "fix01 memory-root" "$TESTS_DIR/fix01-resolver-tests.sh"
run_suite "fix02 init" "$TESTS_DIR/fix02-init-tests.sh"
run_suite "fix03 registry" "$TESTS_DIR/fix03-registry-tests.sh"
run_suite "fix04 lock" "$TESTS_DIR/fix04-lock-tests.sh"
run_suite "fix05 validator" "$TESTS_DIR/fix05-validator-tests.sh"
run_suite "fix06 secrets" "$TESTS_DIR/fix06-secret-tests.sh"
run_suite "fix07 scheduler" "$TESTS_DIR/fix07-schedule-tests.sh"
run_suite "fix08 launchd" "$TESTS_DIR/fix08-launchd-tests.sh"
run_suite "fix09 windows-structural" "$TESTS_DIR/fix09-windows-notes.sh"
run_suite "fix10 installer" "$TESTS_DIR/fix10-installer-tests.sh"
run_suite "fix11 pdca-behavioral" "$TESTS_DIR/fix11-pdca-behavioral.sh"
run_suite "fix12 contract" "$TESTS_DIR/fix12-contract-tests.sh"
run_suite "fix13 provenance" "$TESTS_DIR/fix13-provenance-tests.sh"
run_suite "fix14 static" "$TESTS_DIR/fix14-static-tests.sh"

say ""
say "SUITES: $PASS_SUITES passed${FAILED_SUITES:+, failed:$FAILED_SUITES}${SKIPPED_SUITES:+, skipped:$SKIPPED_SUITES}"
if [ -n "$FAILED_SUITES$SKIPPED_SUITES" ]; then
  exit 1
fi
exit 0
