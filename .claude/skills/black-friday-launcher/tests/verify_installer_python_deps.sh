#!/usr/bin/env bash
# Prove the 999 installer installs the Launcher's Python requirement and that
# the Launcher dependency preflight then reports runtime-jsonschema PRESENT
# from an ISOLATED interpreter.
#
# Method: a clean HOME plus a fresh venv; the installer's own ensure_jsonschema
# function is extracted verbatim from setup-macos.sh (the same technique
# installer-registration/verify-registration.sh uses) and run with the venv's
# python3 first on PATH. Nothing is written outside a temp directory.
#
# Control: the identical preflight runs BEFORE the install and must report
# MISSING, so a PRESENT result afterwards is the install, not the host.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SETUP_SH="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
INSTALLER_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup"
LAUNCHER="$REPO_ROOT/.claude/skills/black-friday-launcher"
BASE="${TMPDIR:-/tmp}/lane-b-installer-jsonschema"
rm -rf "$BASE"; mkdir -p "$BASE/home"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

[ -f "$SETUP_SH" ] || { echo "installer not found: $SETUP_SH" >&2; exit 2; }
bash -n "$SETUP_SH" && pass "setup-macos.sh parses" || fail "setup-macos.sh does not parse"

# --- Windows installer: static proof (no PowerShell on this host) ---------
SETUP_PS1="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-windows.ps1"
grep -q '^function Ensure-Jsonschema {' "$SETUP_PS1" \
  && pass "setup-windows.ps1 defines Ensure-Jsonschema" \
  || fail "setup-windows.ps1 does not define Ensure-Jsonschema"
grep -q 'jsonschema      \$(Ensure-Jsonschema)' "$SETUP_PS1" \
  && pass "setup-windows.ps1 calls Ensure-Jsonschema in the dependency step" \
  || fail "setup-windows.ps1 never calls Ensure-Jsonschema"
grep -q "black-friday-launcher\\\\requirements.txt" "$SETUP_PS1" \
  && pass "Ensure-Jsonschema reads the Launcher's requirements.txt" \
  || fail "Ensure-Jsonschema does not name the Launcher's requirements.txt"

# --- the installer's own Python path, extracted verbatim ------------------
WRAPPER="$BASE/installer-python-path.sh"
{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n\n'
  printf 'DEP_SUMMARY=()\n'
  printf 'log() { printf "[setup-macos] %%s\\n" "$*" >&2; }\n'
  printf 'fail() { printf "BLOCKER: %%s\\n" "$*" >&2; exit 1; }\n\n'
  awk '/^ensure_jsonschema\(\) \{/ {f=1} f {print} f && /^\}/ {exit}' "$SETUP_SH"
  printf '\nensure_jsonschema\nprintf "%%s\\n" "${DEP_SUMMARY[@]}"\n'
} > "$WRAPPER"
grep -q '^ensure_jsonschema() {' "$WRAPPER" \
  && pass "extracted the real ensure_jsonschema() from setup-macos.sh" \
  || fail "ensure_jsonschema() is not in setup-macos.sh"

# --- clean HOME + fresh venv ----------------------------------------------
export HOME="$BASE/home"
python3 -m venv "$BASE/venv" || { echo "venv creation failed" >&2; exit 2; }
PY="$BASE/venv/bin/python3"
"$PY" -c 'import sys; assert sys.prefix != sys.base_prefix' \
  && pass "venv interpreter is isolated from the host (clean HOME=$HOME)" \
  || fail "venv interpreter is not isolated"

# preflight_isolation — the real Launcher preflight, run under -I.
preflight() {
  "$PY" -I -c '
import json, sys
sys.path.insert(0, sys.argv[1])
from launcher_core import dependencies
report = dependencies.check()
entry = next(e for e in report["entries"] if e["id"] == "runtime-jsonschema")
print(json.dumps({"status": entry["status"], "evidence": entry["evidence"]}))
' "$LAUNCHER" 2>&1
}

# --- control: BEFORE the install ------------------------------------------
BEFORE="$(preflight)"
case "$BEFORE" in
  *'"status": "missing"'*'isolated_interpreter=True'*)
    pass "control: runtime-jsonschema MISSING before the install (isolated_interpreter=True)" ;;
  *) fail "control did not report missing+isolated before install (got: $BEFORE)" ;;
esac

# --- first run: installs ---------------------------------------------------
OUT1="$(PATH="$BASE/venv/bin:$PATH" SKILL_DIR="$INSTALLER_SKILL_DIR" \
  bash "$WRAPPER" 2>&1)"
RC1=$?
[ "$RC1" -eq 0 ] && pass "installer python path exits 0 (install run)" \
  || fail "installer python path exited $RC1: $OUT1"
case "$OUT1" in
  *jsonschema*OK*) pass "installer records jsonschema OK in the dependency summary" ;;
  *) fail "installer summary does not record jsonschema OK (got: $OUT1)" ;;
esac
"$PY" -I -c 'import jsonschema' \
  && pass "jsonschema imports in the clean venv after the install" \
  || fail "jsonschema still not importable after the install"

# --- second run: idempotent -----------------------------------------------
OUT2="$(PATH="$BASE/venv/bin:$PATH" SKILL_DIR="$INSTALLER_SKILL_DIR" \
  bash "$WRAPPER" 2>&1)"
RC2=$?
[ "$RC2" -eq 0 ] && pass "installer python path exits 0 (second, idempotent run)" \
  || fail "second installer run exited $RC2: $OUT2"
case "$OUT2" in
  *"already importable"*)
    pass "second run short-circuits on the import check (no reinstall)" ;;
  *) fail "second run did not short-circuit (got: $OUT2)" ;;
esac

# --- after: the Launcher preflight itself ---------------------------------
AFTER="$(preflight)"
case "$AFTER" in
  *'"status": "present"'*'isolated_interpreter=True'*)
    pass "preflight: runtime-jsonschema PRESENT with isolated_interpreter=True" ;;
  *) fail "preflight did not report present+isolated after install (got: $AFTER)" ;;
esac

rm -rf "$BASE"
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
