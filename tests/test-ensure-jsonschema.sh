#!/usr/bin/env bash
# ensure_jsonschema (setup-macos.sh) and Ensure-Jsonschema (setup-windows.ps1):
# the 999 install step that makes jsonschema importable BEFORE any skill runs.
# Offline: a throwaway venv, a throwaway HOME, and hand-built local wheels named
# jsonschema (pip reads them with PIP_NO_INDEX + PIP_FIND_LINKS, never the
# network). The function is extracted verbatim from setup-macos.sh, so this
# fails if the installer's real code stops doing any of:
#   missing -> install    too old (3.x) -> upgrade    good -> no pip at all
#   installs ONLY with `pip install --target $HOME/.claude/pydeps/py<X.Y>` (the
#   one form a PEP 668 Homebrew python accepts; never --user or
#   --break-system-packages)    OC_PYDEPS_DIR override    loud failure
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$HERE/.."
SETUP_SH="$REPO/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
SETUP_PS1="$REPO/.claude/skills/nine-router-setup/scripts/setup-windows.ps1"

T="$(mktemp -d "${TMPDIR:-/tmp}/ensure-jsonschema.XXXXXX")" || exit 2
trap 'rm -rf "$T"' EXIT
FAILS=0
ok()  { printf 'ok   - %s\n' "$1"; }
bad() { printf 'FAIL - %s\n' "$1"; FAILS=$((FAILS + 1)); }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# --- local wheels: jsonschema 3.2.0 (below the floor) and 4.1.0 (above it) ---
mkwheel() { # <dir> <version>
  python3 - "$1" "$2" <<'PYEOF'
import sys, zipfile
d, v = sys.argv[1:3]
di = "jsonschema-%s.dist-info" % v
with zipfile.ZipFile("%s/jsonschema-%s-py3-none-any.whl" % (d, v), "w") as z:
    z.writestr("jsonschema/__init__.py", "")
    z.writestr(di + "/METADATA", "Metadata-Version: 2.1\nName: jsonschema\nVersion: %s\n" % v)
    z.writestr(di + "/WHEEL", "Wheel-Version: 1.0\nGenerator: t\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
    z.writestr(di + "/RECORD", "")
PYEOF
}
mkdir -p "$T/good" "$T/oldonly"
mkwheel "$T/good" 3.2.0 && mkwheel "$T/good" 4.1.0 && mkwheel "$T/oldonly" 3.2.0 || { echo "cannot build wheels"; exit 2; }

# --- fixture skill dir: <skill>/../black-friday-launcher/requirements.txt ----
mkdir -p "$T/skills/nine-router-setup" "$T/skills/black-friday-launcher"
printf '# fixture\njsonschema>=4.0\n' > "$T/skills/black-friday-launcher/requirements.txt"

# --- the installer's own function, extracted verbatim -------------------------
{
  printf '#!/usr/bin/env bash\nset -euo pipefail\nDEP_SUMMARY=()\n'
  printf 'log() { printf "[setup-macos] %%s\\n" "$*" >&2; }\n'
  printf 'fail() { printf "BLOCKER: %%s\\n" "$*" >&2; exit 1; }\n'
  awk '/^ensure_jsonschema\(\) \{/ {f=1} f {print} f && /^\}/ {exit}' "$SETUP_SH"
  printf '\nensure_jsonschema "$@" && rc=0 || rc=$?\nprintf "%%s\\n" "${DEP_SUMMARY[@]:-}"\nexit $rc\n'
} > "$T/wrapper.sh"
grep -q '^ensure_jsonschema() {' "$T/wrapper.sh" && ok "extracted ensure_jsonschema() from setup-macos.sh" \
  || { bad "ensure_jsonschema() not found in setup-macos.sh"; exit 1; }

python3 -m venv "$T/venv" || { echo "cannot create venv"; exit 2; }
export HOME="$T/home" PIP_NO_INDEX=1 PIP_FIND_LINKS="$T/good" PIP_DISABLE_PIP_VERSION_CHECK=1
mkdir -p "$HOME"
PY="$T/venv/bin/python3"
PYVER="$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
DEPS="$HOME/.claude/pydeps/py$PYVER"
# js_sys: version in the venv itself.  js_deps <dir>: version loaded with <dir> first on sys.path.
js_sys() { "$PY" -I -c 'import importlib.metadata as m; print(m.version("jsonschema"))' 2>/dev/null; }
js_deps() { "$PY" -I -c 'import sys; sys.path.insert(0, sys.argv[1]); import jsonschema, importlib.metadata as m; print(m.version("jsonschema"))' "$1" 2>/dev/null; }
run() { PATH="$T/venv/bin:$PATH" SKILL_DIR="$T/skills/nine-router-setup" bash "$T/wrapper.sh" "$@" 2>&1; }

# 1. missing everywhere -> --check reports it and creates nothing; apply installs
#    4.1.0 into the pydeps folder and leaves the python itself untouched
out="$(run --check)"; rc=$?
[ "$rc" -ne 0 ] && has "$out" "ModuleNotFoundError" && [ ! -e "$DEPS" ] && ok "--check: missing jsonschema reported, nothing created (rc=$rc)" || bad "--check missing (rc=$rc: $out)"
out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(js_deps "$DEPS")" = "4.1.0" ] && [ -z "$(js_sys)" ] && has "$out" "pip install --target $DEPS" \
  && ok "apply: missing -> 4.1.0 installed into the py$PYVER pydeps folder, python site-packages untouched" || bad "apply missing (rc=$rc: $out)"

# 2. good -> idempotent, pip never runs
out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && has "$out" "already importable (4.1.0)" && ! has "$out" "Installing" && ok "apply: good version is a no-op" || bad "apply good (rc=$rc: $out)"
out="$(run --check)"; rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "4.1.0" ] && ok "--check: prints the version when good" || bad "--check good (rc=$rc: $out)"

# 3. too old on the python (3.2.0 imports fine) and nothing in pydeps -> the floor
#    catches it and apply installs 4.1.0 into pydeps without touching the python
rm -rf "$HOME/.claude"
"$PY" -m pip install -q "$T/good/jsonschema-3.2.0-py3-none-any.whl" >/dev/null 2>&1
[ "$(js_sys)" = "3.2.0" ] || { echo "precondition: could not seed 3.2.0"; exit 2; }
out="$(run --check)"; rc=$?
[ "$rc" -ne 0 ] && has "$out" "older than the required 4.0" && ok "--check: 3.2.0 rejected by the 4.0 floor" || bad "--check floor (rc=$rc: $out)"
out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(js_deps "$DEPS")" = "4.1.0" ] && [ "$(js_sys)" = "3.2.0" ] && ok "apply: too-old 3.2.0 shadowed by 4.1.0 in pydeps, python left alone" || bad "apply upgrade (rc=$rc: $out)"

# 4. nothing satisfies the floor -> loud one-line BLOCKER, non-zero
rm -rf "$HOME/.claude"
out="$(PIP_FIND_LINKS="$T/oldonly" run)"; rc=$?
[ "$rc" -ne 0 ] && has "$out" "BLOCKER: Python package jsonschema>=4.0 could not be installed into $DEPS" && ok "apply: unsatisfiable -> BLOCKER, rc=$rc" || bad "apply failure path (rc=$rc: $out)"

# 5. PEP 668 python: pip refuses every install that is not --target. Exactly one
#    pip call, --target <folder>, no --user, no --break-system-packages.
"$PY" -m pip uninstall -q -y jsonschema >/dev/null 2>&1; rm -rf "$HOME/.claude"
mkdir -p "$T/shim"; : > "$T/pip.log"
cat > "$T/shim/python3" <<SHIMEOF
#!/bin/sh
case "\$*" in
  *"-m pip install"*)
    echo "\$*" >> "$T/pip.log"
    case "\$*" in *--target*) ;; *) echo "error: externally-managed-environment" >&2; exit 1 ;; esac ;;
esac
exec "$PY" "\$@"
SHIMEOF
chmod +x "$T/shim/python3"
out="$(PATH="$T/shim:$T/venv/bin:$PATH" SKILL_DIR="$T/skills/nine-router-setup" bash "$T/wrapper.sh" 2>&1)"; rc=$?
calls="$(wc -l < "$T/pip.log" | tr -d ' ')"; line="$(cat "$T/pip.log")"
[ "$rc" -eq 0 ] && [ "$calls" = 1 ] && has "$line" "--target $DEPS" && has "$line" "--upgrade" && has "$line" "jsonschema>=4.0" \
  && ! has "$line" "--user" && ! has "$line" "break-system-packages" && [ "$(js_deps "$DEPS")" = "4.1.0" ] \
  && ok "PEP 668 python: one 'pip install --target' call (no --user, no --break-system-packages) installed 4.1.0" \
  || bad "PEP 668 path (rc=$rc, pip calls=$calls: $line: $out)"

# 6. OC_PYDEPS_DIR overrides the folder (used as the folder itself)
"$PY" -m pip uninstall -q -y jsonschema >/dev/null 2>&1; rm -rf "$HOME/.claude"
[ -z "$(js_sys)" ] || { echo "precondition: python still has jsonschema"; exit 2; }
out="$(OC_PYDEPS_DIR="$T/custom" run)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(js_deps "$T/custom")" = "4.1.0" ] && [ ! -e "$HOME/.claude" ] && ok "OC_PYDEPS_DIR is honored" || bad "OC_PYDEPS_DIR (rc=$rc: $out)"

# 7. wiring: the update path (--skills-only) goes through the same function; neither
#    installer body carries --user or --break-system-packages; Windows has the contract
grep -q 'ensure_jsonschema --check' "$SETUP_SH" && grep -q '( ensure_jsonschema )' "$SETUP_SH" \
  && ok "setup-macos.sh --skills-only check and apply both go through ensure_jsonschema" || bad "--skills-only not wired to ensure_jsonschema"
body_sh="$(awk '/^ensure_jsonschema\(\) \{/ {f=1} f {print} f && /^\}/ {exit}' "$SETUP_SH")"
body_ps="$(awk '/^function Ensure-Jsonschema/ {f=1} f {print} f && /^\}/ {exit}' "$SETUP_PS1")"
! has "$body_sh$body_ps" "--user" && ! has "$body_sh$body_ps" "break-system-packages" && ok "neither installer function uses --user or --break-system-packages" || bad "a forbidden pip flag is in an installer function"
has "$body_ps" "--target" && has "$body_ps" "pydeps" && has "$body_ps" "OC_PYDEPS_DIR" \
  && grep -q 'jsonschema      \$(Ensure-Jsonschema)' "$SETUP_PS1" && grep -q '^function Test-JsonschemaOk' "$SETUP_PS1" \
  && ok "setup-windows.ps1 Ensure-Jsonschema: --target into pydeps, floor probe, wired into the dependency step" || bad "setup-windows.ps1 wiring"

[ "$FAILS" -eq 0 ] && echo "PASS" || { echo "$FAILS failure(s)"; exit 1; }
