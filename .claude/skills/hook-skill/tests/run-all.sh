#!/usr/bin/env bash
# Hook Skill test runner. Exit 0 only when every suite passes. A missing prerequisite is a FAIL, never a skip.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; HOOKS="$HERE/../hooks"
command -v python3 >/dev/null || { echo "FAIL: python3 not found" >&2; exit 1; }
command -v node >/dev/null || { echo "FAIL: node not found (workflow-guard tests need Node.js 18+)" >&2; exit 1; }
rc=0
run() { echo "== $*"; "$@" >"${TMPDIR:-/tmp}/hookskill-test.out" 2>&1 && echo "   PASS" || { echo "   FAIL"; tail -25 "${TMPDIR:-/tmp}/hookskill-test.out"; rc=1; }; }
for t in test_guard.py test_generator.py test_smart_guard.py test_a46_running_at_once.py; do
  (cd "$HOOKS/workflow-guard" && run python3 "$t")
done
# test_stop_omission.py is a pytest file (fixtures); install pytest when it is missing rather than skipping the suite.
python3 -c 'import pytest' 2>/dev/null || python3 -m pip install -q pytest 2>/dev/null || python3 -m pip install -q --break-system-packages pytest 2>/dev/null
(cd "$HOOKS/workflow-guard" && run python3 -m pytest -q test_stop_omission.py test_enforcement.py test_enforcement_v22.py test_final_pass.py test_final_staffing.py test_validate_hardening.py)
(cd "$HOOKS/workflow-guard" && run python3 staffing.py --selftest)
(cd "$HOOKS/workflow-guard" && run python3 capacity_probe.py --selftest)
for t in test_hygiene.py test_disk_cleanup.py test_gates.py test_settings_merge.py test_capacity.py; do run python3 "$HERE/$t"; done
run bash "$HERE/smoke-install.sh"
find "$HOOKS" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null
[ $rc = 0 ] && echo "ALL HOOK SKILL TESTS PASSED" || echo "HOOK SKILL TESTS FAILED"
exit $rc
