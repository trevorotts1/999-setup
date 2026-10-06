#!/usr/bin/env bash
# spec-protocol enforcement tests. Exit 0 only when every suite passes; a missing prerequisite is a FAIL, never a skip.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SP="$HERE/.."; REPO="$SP/../../.."
command -v python3 >/dev/null || { echo "FAIL: python3 not found" >&2; exit 1; }
command -v node >/dev/null || { echo "FAIL: node not found (swarm-plan and width tests need Node.js 18+)" >&2; exit 1; }
rc=0
run() { echo "== $*"; "$@" >"${TMPDIR:-/tmp}/sp-test.out" 2>&1 && echo "   PASS" || { echo "   FAIL"; tail -30 "${TMPDIR:-/tmp}/sp-test.out"; rc=1; }; }
run node "$SP/tools/swarm-plan.mjs" --selftest
run python3 "$SP/tools/hooks/staffing.py" --selftest
run python3 "$SP/tools/hooks/dispatch-gate.py" --selftest
run python3 "$SP/tools/hooks/capacity_probe.py" --selftest
run python3 "$HERE/test_capacity_probe.py"
run python3 "$HERE/test_plan_validators_agree.py"
run python3 "$HERE/test_copies_identical.py"
run bash "$SP/tools/install-hooks.sh" --selftest
run bash "$SP/tools/width.sh" --selftest
run node "$SP/scripts/common/width.mjs" --selftest
run bash "$SP/tools/capacity-resolver.sh" --selftest
run bash "$SP/tools/dispatch-check.sh" --selftest
run node "$SP/scripts/common/dispatch-check.mjs" --selftest
run node "$REPO/tools/windows-parity/tests/parity-tests.mjs"
run bash "$SP/../nine-router-setup/scripts/macos/enable-agent-teams.sh" --selftest
find "$SP" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null
[ $rc = 0 ] && echo "ALL SPEC-PROTOCOL ENFORCEMENT TESTS PASSED" || echo "SPEC-PROTOCOL ENFORCEMENT TESTS FAILED"
exit $rc
