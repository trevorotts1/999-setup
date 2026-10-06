#!/usr/bin/env bash
# Lock-aware settings writes (shell path). Temp files only. On macOS the lock is the real chflags uchg flag;
# elsewhere it is the read-only mode bit (the weaker lock). Exit 0 only when every check passes.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SP="$HERE/.."; NR="$SP/../nine-router-setup"
LIB="$SP/tools/settings-lock.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/settings-lock-test.XXXXXX")"
unlock_all() { find "$T" -type f -exec sh -c 'chflags nouchg "$1" 2>/dev/null; chmod u+w "$1" 2>/dev/null' _ {} \; ; }
trap 'unlock_all; rm -rf "$T"' EXIT
FAILS=0
ok() { echo "PASS  $1"; }
no() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
is_locked() { # file -> 0 when locked
  if [ "$(uname -s)" = "Darwin" ]; then /usr/bin/stat -f %Sf "$1" | grep -q uchg; else [ ! -w "$1" ]; fi
}
lock_it() { if [ "$(uname -s)" = "Darwin" ]; then chflags uchg "$1"; else chmod a-w "$1"; fi; }

# 0. the two shipped copies of the helper are byte-identical
cmp -s "$LIB" "$NR/scripts/common/settings-lock.sh" && ok "0. settings-lock.sh is identical in spec-protocol and nine-router-setup" || no "0. settings-lock.sh copies differ"

# 1. a locked file is unlocked, one line is printed, and it is re-locked
f="$T/a.json"; echo '{}' > "$f"; lock_it "$f"
out="$(bash -c '. "$1"; sl_unlock "$2" && echo "{\"x\":1}" > "$2" && sl_relock_all' _ "$LIB" "$f" 2>&1)"; rc=$?
if [ $rc -eq 0 ] && is_locked "$f" && [ "$(printf '%s\n' "$out" | grep -c 'settings-lock: .* was locked')" = 1 ] && grep -q '"x":1' "$f" 2>/dev/null; then ok "1. locked file: unlocked, written, re-locked, one line"; else no "1. locked file round trip (rc=$rc out=$out)"; fi
unlock_all

# 2. a file that was NOT locked is never locked, and prints nothing
f="$T/b.json"; echo '{}' > "$f"
out="$(bash -c '. "$1"; sl_unlock "$2"; echo "{}" > "$2"; sl_relock_all' _ "$LIB" "$f" 2>&1)"
if [ -z "$out" ] && ! is_locked "$f"; then ok "2. an unlocked file stays unlocked and silent"; else no "2. unlocked file was touched (out=$out)"; fi

# 3. the lock comes back even when the script dies (exit 3), and a pre-existing EXIT trap still runs
f="$T/c.json"; echo '{}' > "$f"; lock_it "$f"
bash -c 'trap "echo prev-trap-ran > \"$3\"" EXIT; . "$1"; sl_unlock "$2" >/dev/null; echo "{}" > "$2"; exit 3' _ "$LIB" "$f" "$T/prev" >/dev/null 2>&1; rc=$?
if [ $rc -eq 3 ] && is_locked "$f" && [ -f "$T/prev" ]; then ok "3. exit/failure still re-locks; the caller's own EXIT trap is chained"; else no "3. re-lock on failure (rc=$rc)"; fi
unlock_all

# 4. invalid JSON after the write is warned about and the file is STILL re-locked
f="$T/d.json"; echo '{}' > "$f"; lock_it "$f"
out="$(bash -c '. "$1"; sl_unlock "$2" >/dev/null; echo "{broken" > "$2"; sl_relock_all' _ "$LIB" "$f" 2>&1)"
if is_locked "$f" && printf '%s' "$out" | grep -q 'not valid JSON'; then ok "4. invalid JSON warned, file re-locked"; else no "4. invalid JSON handling (out=$out)"; fi
unlock_all

# 5. install-hooks.sh merges through a locked settings file and leaves it locked
if command -v python3 >/dev/null; then
  r="$T/root"; mkdir -p "$r/hooks/workflow-guard"   # a real box has Hook Skill's guard beside the gate
  cp "$SP/../hook-skill/hooks/workflow-guard/guard.py" "$r/hooks/workflow-guard/"
  echo '{"model":"keep"}' > "$r/settings.json"; lock_it "$r/settings.json"
  out="$(bash "$SP/tools/install-hooks.sh" --root "$r" 2>&1)"; rc=$?
  if [ $rc -eq 0 ] && is_locked "$r/settings.json" && printf '%s' "$out" | grep -q 'settings-lock: .* was locked' \
     && python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));assert d["model"]=="keep" and "hooks" in d' "$r/settings.json"; then
    ok "5. install-hooks.sh wrote through the lock and re-locked"
  else no "5. install-hooks.sh over a locked file (rc=$rc)"; fi
  unlock_all
fi

[ "$FAILS" = 0 ] && echo "settings-lock shell tests: ALL PASSED" || echo "settings-lock shell tests: $FAILS FAILED"
[ "$FAILS" = 0 ]
