#!/usr/bin/env bash
# test-helper-install.sh — W3-03-U5 runnable check for helper dependency
# installation (directive 2.4). One process, stdlib only, no network, no
# secrets. Proves the acceptance contract:
#   1. a clean install places every pinned helper in the config root
#      (every helper, including 07-kie-setup and the shared-utils files)
#   2. preflight exits 0 when all helpers are present at their pinned hash
#   3. removing one helper makes preflight exit nonzero with an actionable
#      error naming that helper and the repair command
#   4. an altered helper makes preflight exit nonzero (hash mismatch)
#   5. re-running install restores the pinned state and preflight passes again
#   6. one install run lands every helper in BOTH config roots when the
#      machine has them (~/.claude and ~/.claude-nine) — KIE-U1 item d
#   7. CLAUDE_CONFIG_DIR still selects a single root on a single-root machine
# Exits 0 only when every step passes.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"
DEP="$HERE/helper-deps.py"
TMP="$(mktemp -d "/tmp/999-setup-W3-03-U5-test.XXXXXX")" || exit 2
ROOT="$TMP/config-root"
BACKUP="$TMP/backups"
trap 'rm -rf "$TMP"' EXIT

# Every helper the manifest pins — including 07 and shared-utils (KIE-U1).
ALL_HELPERS="$("$PY" -c '
import json,sys
for h in json.load(open(sys.argv[1]))["helpers"]:
    print(h["name"])
' "$HERE/helper-dependencies.json" 2>/dev/null)"
[ -n "$ALL_HELPERS" ] || { echo "cannot read helper list from the manifest" >&2; exit 2; }

PASS=0
FAIL=0
step() { printf '== %s\n' "$1"; }
ok()   { printf 'ok: %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

# every_pinned_helper_present <root> <desc>
every_pinned_helper_present() {
  local root="$1" desc="$2" n missing=""
  for n in $ALL_HELPERS; do
    if [ -d "$root/skills/$n" ] && [ -n "$(ls -A "$root/skills/$n" 2>/dev/null)" ]; then
      continue
    fi
    missing="$missing $n"
  done
  if [ -z "$missing" ]; then
    ok "$desc"
  else
    bad "$desc — absent:$missing"
  fi
}

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
every_pinned_helper_present "$ROOT" \
  "every pinned helper present after clean install (incl. 07 and shared-utils)"

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

step "9. one install run lands every helper in BOTH config roots (KIE-U1 d)"
# A machine with both roots: a fake HOME holding .claude and .claude-nine.
# No --root and no CLAUDE_CONFIG_DIR, exactly as a real client runs it.
DUAL_HOME="$TMP/dual-home"
mkdir -p "$DUAL_HOME/.claude" "$DUAL_HOME/.claude-nine"
run 0 "bare install covers both roots" \
  env -u CLAUDE_CONFIG_DIR HOME="$DUAL_HOME" \
  "$PY" "$DEP" install --backup-dir "$TMP/dual-backups"
every_pinned_helper_present "$DUAL_HOME/.claude" \
  "every pinned helper in the first config root (~/.claude)"
every_pinned_helper_present "$DUAL_HOME/.claude-nine" \
  "every pinned helper in the second config root (~/.claude-nine)"
if [ -f "$DUAL_HOME/.claude/skills/07-kie-setup/references/kie-common-rules.md" ] \
   && [ -f "$DUAL_HOME/.claude-nine/skills/07-kie-setup/references/kie-common-rules.md" ]; then
  ok "07-kie-setup common rules present in both roots"
else
  bad "07-kie-setup common rules missing from one of the two roots"
fi
if [ -f "$DUAL_HOME/.claude/skills/shared-utils/key_resolver.py" ] \
   && [ -f "$DUAL_HOME/.claude-nine/skills/shared-utils/key_resolver.py" ]; then
  ok "shared-utils files present in both roots"
else
  bad "shared-utils files missing from one of the two roots"
fi
run 0 "preflight passes across both roots" \
  env -u CLAUDE_CONFIG_DIR HOME="$DUAL_HOME" "$PY" "$DEP" preflight
expect_line "$DUAL_HOME/.claude" "preflight reports both roots"
expect_line "$DUAL_HOME/.claude-nine" "preflight reports both roots (nine)"

step "10. CLAUDE_CONFIG_DIR still selects a single root"
SINGLE_HOME="$TMP/single-home"
mkdir -p "$SINGLE_HOME/.claude" "$SINGLE_HOME/.claude-nine"
run 0 "install honors CLAUDE_CONFIG_DIR alone" \
  env CLAUDE_CONFIG_DIR="$SINGLE_HOME/.claude" HOME="$SINGLE_HOME" \
  "$PY" "$DEP" install --backup-dir "$TMP/single-backups"
every_pinned_helper_present "$SINGLE_HOME/.claude" \
  "helpers landed in the CLAUDE_CONFIG_DIR root"
if [ -e "$SINGLE_HOME/.claude-nine/skills" ]; then
  bad "CLAUDE_CONFIG_DIR was ignored — the second root was written anyway"
else
  ok "second root untouched when CLAUDE_CONFIG_DIR pins one root"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "ALL PASS"
exit 0
