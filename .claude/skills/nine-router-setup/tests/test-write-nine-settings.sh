#!/usr/bin/env bash
# test-write-nine-settings.sh — the EXISTING-file branch of write_nine_settings.
# A settings.json that already exists must KEEP every value it carries and gain
# the routing keys it is missing (permissions.defaultMode, apiKeyHelper,
# env.ANTHROPIC_BASE_URL). Before this test existed the branch printed "kept"
# and exited 0 with both routing keys absent, so the box stayed unroutable for
# ever; the full install is the only path that writes this file.
#
# Everything runs against REAL fixture files in a throwaway HOME, driving the
# function extracted verbatim from setup-macos.sh. Fixtures carry placeholders
# only: nothing here reads, writes or prints a credential, and the test asserts
# the run never echoes a settings value.
#
# Run: bash .claude/skills/nine-router-setup/tests/test-write-nine-settings.sh
set -uo pipefail

SETUP="$(cd "$(dirname "$0")/.." && pwd)/scripts/setup-macos.sh"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "SKIP: node is not on PATH"; exit 0; fi
[ -f "$SETUP" ] || { echo "FAIL: $SETUP not found"; exit 1; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }

awk '/^write_nine_settings\(\) \{/,/^\}/' "$SETUP" > "$ROOT/fn.sh"
if ! grep -q 'apiKeyHelper' "$ROOT/fn.sh" || ! grep -q 'ANTHROPIC_BASE_URL' "$ROOT/fn.sh"; then
  fail "extraction: write_nine_settings was not found in setup-macos.sh"
  echo "FAILED: $FAIL"; exit 1
fi

# The stubs write_nine_settings calls; log() is the script's own reporter.
cat > "$ROOT/harness.sh" <<'EOF'
set -uo pipefail
log() { printf '%s\n' "$*"; }
sl_unlock() { return 0; }
sl_relock_all() { :; }
. "$FN"
write_nine_settings 2
EOF

# node assertion helper: prints one FAIL line per unmet condition.
cat > "$ROOT/assert.js" <<'EOF'
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = [];
const want = (ok, what) => { if (!ok) out.push("" + what); };
want(j.model === "user-pin", "the user's model pin was overwritten");
want(j.env && j.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS === "9000",
     "the user's CLAUDE_CODE_MAX_OUTPUT_TOKENS was overwritten");
want(typeof j.apiKeyHelper === "string" && j.apiKeyHelper.length > 0,
     "apiKeyHelper is still absent");
want(j.env && j.env.ANTHROPIC_BASE_URL === "http://127.0.0.1:20128/v1",
     "env.ANTHROPIC_BASE_URL is wrong or absent: " + JSON.stringify(j.env && j.env.ANTHROPIC_BASE_URL));
want(j.permissions && j.permissions.defaultMode === "bypassPermissions",
     "permissions.defaultMode is absent");
console.log(out.join("\n"));
EOF

run_case() { # run_case <name> <initial settings.json>
  local name="$1" initial="$2" home="$ROOT/$1"
  mkdir -p "$home/.claude-nine"
  printf '%s\n' "$initial" > "$home/.claude-nine/settings.json"
  HOME="$home" FN="$ROOT/fn.sh" NODE_BIN="$NODE" PORT=20128 \
    bash "$ROOT/harness.sh" > "$ROOT/$name.out" 2>&1
  local rc=$?

  [ "$rc" = 0 ] && pass "$name: exits 0" || fail "$name: exit $rc (see $(cat "$ROOT/$name.out"))"

  local problems
  problems="$("$NODE" "$ROOT/assert.js" "$home/.claude-nine/settings.json" 2>&1)"
  if [ -z "$problems" ]; then pass "$name: routing keys repaired, user values kept"
  else fail "$name: $problems"; fi

  grep -q 'added ' "$ROOT/$name.out" \
    && pass "$name: reports the keys it added" \
    || fail "$name: did not report which keys it added ($(cat "$ROOT/$name.out"))"
  grep -q 'apiKeyHelper' "$ROOT/$name.out" \
    && pass "$name: names apiKeyHelper in the report" \
    || fail "$name: report does not name apiKeyHelper"
  if grep -q 'get-9router-key.sh' "$ROOT/$name.out"; then
    fail "$name: the report echoed a settings VALUE (helper path)"
  else
    pass "$name: report carries key names only, never a value"
  fi

  local before; before="$(cat "$home/.claude-nine/settings.json")"
  local backups; backups="$(ls "$home/.claude-nine" | grep -c '^settings\.json\.bak-' || true)"
  HOME="$home" FN="$ROOT/fn.sh" NODE_BIN="$NODE" PORT=20128 \
    bash "$ROOT/harness.sh" > "$ROOT/$name.again" 2>&1
  [ "$(cat "$home/.claude-nine/settings.json")" = "$before" ] \
    && pass "$name: second run changes nothing" \
    || fail "$name: second run rewrote the file"
  grep -q 'kept' "$ROOT/$name.again" \
    && pass "$name: second run reports it is already complete" \
    || fail "$name: second run did not report 'kept'"
  [ "$backups" -le 1 ] && pass "$name: at most one backup minted" \
    || fail "$name: minted $backups backups"
}

# Variant A: permissions.defaultMode already present (the old code printed
# "kept" here and left the routing keys absent).
run_case "keeps-defaultmode" '{"model":"user-pin","permissions":{"defaultMode":"bypassPermissions"},"env":{"CLAUDE_CODE_MAX_OUTPUT_TOKENS":"9000"}}'
# Variant B: no permissions object at all (the old code added ONLY defaultMode).
run_case "no-permissions" '{"model":"user-pin","env":{"CLAUDE_CODE_MAX_OUTPUT_TOKENS":"9000"}}'

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
