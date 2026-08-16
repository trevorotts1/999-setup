#!/usr/bin/env bash
# verify-research-gate.sh — Issue 5 FIX step 3 verification (RESEARCH-READY gate).
#
# Proves the behavioral contract on a sandbox project, in the master fix spec's
# own words (Issue 5 FIX step 3): "attempt a research dispatch before capture in
# a test run — it is refused with the named gate; after capture it proceeds."
#
# The gate (SKILL.md step 3.5, the RESEARCH-READY gate): research may not run
# until BOTH ledger lines exist in the project ledger (CONTROL/LEDGER.md,
# references/documents.md line 203) — BUILD-TARGET: <taxonomy> and
# INPUT-CAPTURED: <path>. A refused dispatch names the missing condition(s)
# (SKILL.md step 3.5 wording).
#
# Safe to run repeatedly; touches only a sandbox directory under $TMPDIR and
# never a live project. Ledger lines are written with the skill's own
# ledger.sh so the test exercises the same write primitive a run uses.
# Prints PASS/FAIL per check; exits 0 only when every check passes.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL="$ROOT/.claude/skills/spec-protocol/SKILL.md"
INTERVIEW="$ROOT/.claude/skills/spec-protocol/references/interview.md"
LEDGER_TOOL="$ROOT/.claude/skills/spec-protocol/tools/ledger.sh"

failures=0; passes=0
check() { if [ "$1" = "0" ]; then passes=$((passes+1)); echo "PASS  $2"; else failures=$((failures+1)); echo "FAIL  $2"; fi; }

# --- Doctrine guards: the named gate must exist before the contract can run ---
grep -q "RESEARCH-READY gate" "$SKILL"; check $? "SKILL.md carries the RESEARCH-READY gate (step 3.5)"
grep -q 'BUILD-TARGET: <taxonomy>' "$SKILL"; check $? "SKILL.md names the BUILD-TARGET ledger line"
grep -q 'INPUT-CAPTURED: <path>' "$SKILL"; check $? "SKILL.md names the INPUT-CAPTURED ledger line"
grep -q "RESEARCH-READY gate" "$INTERVIEW"; check $? "interview.md Step 1c-bis binds the dispatch to the gate"

# --- Sandbox project ---
SB="$(mktemp -d "${TMPDIR:-/tmp}/wf2e-research-gate.XXXXXX")"
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/CONTROL" "$SB/00-INPUT"
: > "$SB/CONTROL/LEDGER.md"
LEDGER="$SB/CONTROL/LEDGER.md"

# gate predicate — research allowed iff BOTH ledger lines exist; a refusal names
# the missing condition(s). Same contract as SKILL.md step 3.5.
gate_missing() {
  local missing=""
  grep -sq '^BUILD-TARGET:' "$LEDGER" || missing="${missing} BUILD-TARGET"
  grep -sq '^INPUT-CAPTURED:' "$LEDGER" || missing="${missing} INPUT-CAPTURED"
  printf '%s' "$missing"
}

attempt_dispatch() {
  local missing; missing="$(gate_missing)"
  if [ -n "$missing" ]; then
    echo "REFUSED: research dispatch blocked by RESEARCH-READY gate — missing ledger line(s):$missing"
    return 1
  fi
  echo "DISPATCH-OK: research reader dispatched — gate satisfied"
  return 0
}

# --- Scenario A: no capture yet — dispatch refused, refusal names BOTH ---
OUT_A="$(attempt_dispatch)" && RC_A=0 || RC_A=1
check $((RC_A == 1 ? 0 : 1)) "dispatch before any capture is REFUSED"
case "$OUT_A" in
  *REFUSED*) check 0 "refusal carries the RESEARCH-READY gate name" ;;
  *)         check 1 "refusal carries the RESEARCH-READY gate name" ;;
esac
case "$OUT_A" in
  *BUILD-TARGET*INPUT-CAPTURED*|*INPUT-CAPTURED*BUILD-TARGET*) check 0 "refusal names BUILD-TARGET and INPUT-CAPTURED" ;;
  *) check 1 "refusal names BUILD-TARGET and INPUT-CAPTURED" ;;
esac
case "$OUT_A" in
  *DISPATCH-OK*) check 1 "no dispatch happened before capture" ;;
  *)             check 0 "no dispatch happened before capture" ;;
esac

# --- Scenario B: target named, capture missing — refusal names only capture ---
"$LEDGER_TOOL" "$SB" "CONTROL/LEDGER.md" "BUILD-TARGET: WEB_APP" >/dev/null 2>&1
check $? "ledger.sh writes the BUILD-TARGET line"
OUT_B="$(attempt_dispatch)" && RC_B=0 || RC_B=1
check $((RC_B == 1 ? 0 : 1)) "dispatch with target but no capture is REFUSED"
case "$OUT_B" in
  *INPUT-CAPTURED*) check 0 "refusal names INPUT-CAPTURED" ;;
  *)                check 1 "refusal names INPUT-CAPTURED" ;;
esac
case "$OUT_B" in
  *BUILD-TARGET*) check 1 "refusal does not name the satisfied BUILD-TARGET" ;;
  *)              check 0 "refusal does not name the satisfied BUILD-TARGET" ;;
esac

# --- Scenario C: capture lands — dispatch PROCEEDS ---
"$LEDGER_TOOL" "$SB" "CONTROL/LEDGER.md" "INPUT-CAPTURED: 00-INPUT/" >/dev/null 2>&1
check $? "ledger.sh writes the INPUT-CAPTURED line"
OUT_C="$(attempt_dispatch)" && RC_C=0 || RC_C=1
check $((RC_C == 0 ? 0 : 1)) "dispatch after capture PROCEEDS"
case "$OUT_C" in
  *DISPATCH-OK*) check 0 "proceeding dispatch reports DISPATCH-OK" ;;
  *)             check 1 "proceeding dispatch reports DISPATCH-OK" ;;
esac
case "$OUT_C" in
  *REFUSED*) check 1 "no refusal once both ledger lines exist" ;;
  *)         check 0 "no refusal once both ledger lines exist" ;;
esac

echo
echo "$passes passed, $failures failed"
exit $([ "$failures" = "0" ] && echo 0 || echo 1)
