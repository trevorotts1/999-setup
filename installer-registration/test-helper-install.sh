#!/usr/bin/env bash
# test-helper-install.sh — W3-03-U5 runnable check for helper dependency
# installation (directive 2.4). One process, stdlib only, no network, no
# secrets. Proves the acceptance contract:
#   1. a clean install places every pinned helper in the config root
#   2. preflight exits 0 when all helpers are present at their pinned hash
#   3. removing one helper makes preflight exit nonzero with an actionable
#      error naming that helper and the repair command
#   4. an altered helper makes preflight exit nonzero (hash mismatch)
#   5. re-running install restores the pinned state and preflight passes again
# Exits 0 only when every step passes.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"
DEP="$HERE/helper-deps.py"
TMP="$(mktemp -d "/tmp/999-setup-W3-03-U5-test.XXXXXX")" || exit 2
ROOT="$TMP/config-root"
BACKUP="$TMP/backups"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
step() { printf '== %s\n' "$1"; }
ok()   { printf 'ok: %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

run() { # run <expected_rc> <desc> <cmd...>
  local want="$1" desc="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [ "$rc" -eq "$want" ]; then
    ok "$desc (rc=$rc)"
  else
    bad "$desc — expected rc=$want got rc=$rc"
    printf '%s\n' "$out" | sed 's/^/    | /'
  fi
  LAST_OUT="$out"
  return 0
}

expect_line() { # expect_line <needle> <desc>
  if printf '%s\n' "$LAST_OUT" | grep -qF "$1"; then
    ok "$2"
  else
    bad "$2 — output lacks: $1"
    printf '%s\n' "$LAST_OUT" | sed 's/^/    | /'
  fi
}

step "1. clean install into a fresh config root"
run 0 "install copies every pinned helper" \
  "$PY" "$DEP" install --root "$ROOT" --backup-dir "$BACKUP"
for n in 66-kie-image 67-kie-video 68-kie-audio 74-kie-live-adapter 46-kie-callback-relay; do
  if [ -f "$ROOT/skills/$n/SKILL.md" ]; then
    ok "helper present after clean install: $n"
  else
    bad "helper absent after clean install: $n ($ROOT/skills/$n)"
  fi
done

step "2. preflight passes on a clean install"
run 0 "preflight exits 0 with all helpers present" \
  "$PY" "$DEP" preflight --root "$ROOT"

step "3. preflight is idempotent (install re-run converges)"
run 0 "second install is a no-op pass" \
  "$PY" "$DEP" install --root "$ROOT" --backup-dir "$BACKUP"

step "4. removing one helper fails preflight with an actionable error"
rm -rf "$ROOT/skills/67-kie-video"
run 1 "preflight exits 1 when 67-kie-video is missing" \
  "$PY" "$DEP" preflight --root "$ROOT"
expect_line "MISSING helper '67-kie-video'" "error names the missing helper"
expect_line "helper-deps.py install" "error carries the repair command"

step "5. reinstall restores the removed helper"
run 0 "install restores 67-kie-video" \
  "$PY" "$DEP" install --root "$ROOT" --backup-dir "$BACKUP"
run 0 "preflight passes again after repair" \
  "$PY" "$DEP" preflight --root "$ROOT"

step "6. an altered helper fails preflight (hash mismatch)"
printf '\n# altered\n' >> "$ROOT/skills/66-kie-image/SKILL.md"
run 1 "preflight exits 1 when a helper is altered" \
  "$PY" "$DEP" preflight --root "$ROOT"
expect_line "HASH MISMATCH helper '66-kie-image'" "error names the altered helper"

step "7. reinstall restores the altered helper"
run 0 "install restores 66-kie-image from the pin" \
  "$PY" "$DEP" install --root "$ROOT" --backup-dir "$BACKUP"
if [ -f "$BACKUP" ] || [ -d "$BACKUP" ]; then
  if find "$BACKUP" -mindepth 1 -maxdepth 1 -name '66-kie-image.*' | grep -q .; then
    ok "altered copy was backed up externally, not deleted"
  else
    bad "altered copy backup not found under $BACKUP"
  fi
fi
run 0 "final preflight passes" "$PY" "$DEP" preflight --root "$ROOT"

step "8. empty manifest root fails closed"
run 1 "preflight on an uninstalled root exits 1" \
  "$PY" "$DEP" preflight --root "$TMP/never-installed"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "ALL PASS"
exit 0
