#!/usr/bin/env bash
# CON-12: setup-macos.sh --skills-only must provision (APPLY) and report (--check)
# jsonschema, the Black Friday Launcher's one runtime dependency. Runs against a
# throwaway HOME and a fresh venv that has no jsonschema; needs network for pip.
# Fails before the fix (check never mentions jsonschema; apply never installs it).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP="$HERE/../.claude/skills/nine-router-setup/scripts/setup-macos.sh"
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || { echo "SKIP: setup-macos.sh is Apple-Silicon-macOS only"; exit 0; }

T="$(mktemp -d "${TMPDIR:-/tmp}/skills-only-jsonschema.XXXXXX")" || exit 2
trap 'rm -rf "$T"' EXIT
FAILS=0
ok()  { printf 'ok   - %s\n' "$1"; }
bad() { printf 'FAIL - %s\n' "$1"; FAILS=$((FAILS + 1)); }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

python3 -m venv "$T/venv" || { echo "cannot create venv"; exit 2; }
export PATH="$T/venv/bin:$PATH" HOME="$T/home" NINEROUTER_PORT=1
mkdir -p "$HOME/.9router" "$HOME/.claude/skills"
# The installer puts jsonschema in $HOME/.claude/pydeps/py<X.Y> (pip --target), not in
# the python itself. The skills do not read that folder yet: they will once the onboarding
# launch-family sync lands and puts it first on sys.path. js_plain is the bare interpreter
# (precondition), js is the interpreter with that folder first, as the skills will have it.
DEPS="$HOME/.claude/pydeps/py$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
js_plain() { python3 -c 'import jsonschema' >/dev/null 2>&1; }
js() { python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import jsonschema' "$DEPS" >/dev/null 2>&1; }
run() { bash "$SETUP" --skills-only "$@" 2>&1; }

js_plain && { echo "precondition broken: venv already has jsonschema"; exit 2; }

out="$(run --check)"; rc=$?
[ "$rc" -eq 0 ] && has "$out" "jsonschema: WOULD INSTALL" && ok "--check reports missing jsonschema" || bad "--check reports missing jsonschema (rc=$rc)"
js && bad "--check must not install" || ok "--check is read-only"

out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && has "$out" "jsonschema: INSTALLED" && js && ok "apply installs jsonschema (importable afterwards)" || bad "apply installs jsonschema (rc=$rc)"

out="$(run --check)"; rc=$?
[ "$rc" -eq 0 ] && has "$out" "jsonschema: OK" && ok "--check reports present jsonschema" || bad "--check reports present jsonschema (rc=$rc)"

out="$(run)"; rc=$?
[ "$rc" -eq 0 ] && has "$out" "jsonschema: OK (already importable" && ! has "$out" "Installing the Black Friday" && ok "second apply is a no-op for jsonschema" || bad "second apply is a no-op (rc=$rc)"

[ "$FAILS" -eq 0 ] && echo "PASS" || { echo "$FAILS failure(s)"; exit 1; }
