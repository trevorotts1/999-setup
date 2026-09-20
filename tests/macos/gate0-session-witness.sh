#!/usr/bin/env bash
# Regression test for spec-protocol GATE 0 signal 4 (`gate0.sh --check-session`).
#
# Why this exists: the Claude Code binary models ultracode as `xhigh` PLUS a
# separate session-only boolean, and exports only the LEVEL to child processes.
# So `CLAUDE_EFFORT` can never hold the string "ultracode", and a check that
# tested for it could never pass -- a real ultracode session still hit the hard
# stop. These cases pin the two witnesses that can actually fire, and pin the
# dead one as dead.
set -uo pipefail

GATE0="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.claude/skills/spec-protocol/tools/gate0.sh"
[ -r "$GATE0" ] || { echo "FATAL: gate0.sh not found at $GATE0"; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0

run_case() {
  # run_case <name> <expected_exit> <settings_json_or_-> [env assignments...]
  local name="$1" want="$2" body="$3"; shift 3
  local dir="$TMP/$name"; mkdir -p "$dir"
  [ "$body" = "-" ] || printf '%s' "$body" > "$dir/settings.json"
  local out rc
  out="$(env -u CLAUDE_NINE_ULTRACODE -u CLAUDE_EFFORT -u CLAUDE_CODE_EFFORT_LEVEL \
         CLAUDE_CONFIG_DIR="$dir" "$@" bash "$GATE0" --check-session 2>&1)"; rc=$?
  if [ "$rc" = "$want" ]; then
    pass=$((pass+1)); printf 'ok   %-34s exit=%s\n' "$name" "$rc"
  else
    fail=$((fail+1)); printf 'FAIL %-34s exit=%s want=%s\n     %s\n' "$name" "$rc" "$want" "$out"
  fi
}

# --- witness 1: launcher marker (what claude-nine exports beside the flag) ---
run_case marker-set          0 '{"model":"x"}'                CLAUDE_NINE_ULTRACODE=1
run_case marker-absent       1 '{"model":"x"}'
run_case marker-not-one      1 '{"model":"x"}'                CLAUDE_NINE_ULTRACODE=0

# --- witness 2: ultracode key in the config root's settings.json ---
run_case config-key-true     0 '{"ultracode": true}'
run_case config-key-spaced   0 '{"ultracode"   :   true}'
run_case config-key-false    1 '{"ultracode": false}'
run_case config-key-missing  1 '{"model":"x"}'

# --- the dead channel: CLAUDE_EFFORT can never say "ultracode". A real
#     ultracode session looks exactly like xhigh, so xhigh alone must NOT pass,
#     and the legacy env value must NOT be treated as proof. ---
run_case effort-xhigh-only   1 '{"model":"x"}'                CLAUDE_EFFORT=xhigh
run_case effort-legacy-str   1 '{"model":"x"}'                CLAUDE_EFFORT=ultracode

# --- both witnesses together still pass ---
run_case marker-and-key      0 '{"ultracode": true}'          CLAUDE_NINE_ULTRACODE=1

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
