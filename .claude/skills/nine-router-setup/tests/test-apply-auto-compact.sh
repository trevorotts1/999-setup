#!/usr/bin/env bash
# test-apply-auto-compact.sh — behavior tests for apply-auto-compact.mjs.
# Fixtures live in mktemp dirs ONLY (a fake HOME for the default-path cases).
# Requires node (CI has node 20). Prints PASS/FAIL per case and a summary;
# exits non-zero on any failure.
set -uo pipefail

HELPER="$(cd "$(dirname "$0")/.." && pwd)/scripts/common/apply-auto-compact.mjs"
FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }

run_helper() { # run_helper <fixture-home> <args...>
  local home="$1"; shift
  HOME="$home" node "$HELPER" "$@"
}

json_keys() { # json_keys <file> <key> — prints the value of a top-level key
  node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(o[process.argv[2]]))' "$1" "$2"
}

# --- 1. fresh path -> file created with both keys, exit 0 -------------------
F1="$(mktemp -d)"
OUT1="$(run_helper "$F1" --settings "$F1/.claude/settings.json")"
RC1=$?
if [ "$RC1" -eq 0 ] && [ -f "$F1/.claude/settings.json" ] \
   && [ "$(json_keys "$F1/.claude/settings.json" autoCompactEnabled)" = "true" ] \
   && [ "$(json_keys "$F1/.claude/settings.json" autoCompactWindow)" = "500000" ] \
   && [ "$OUT1" = "set: $F1/.claude/settings.json" ]; then
  pass "fresh path: file created with both keys, exit 0"
else
  fail "fresh path: rc=$RC1 out='$OUT1'"
fi

# --- 2. existing JSON with extra keys -> merged, extras preserved, backup ---
F2="$(mktemp -d)"
mkdir -p "$F2/.claude"
printf '{"permissions":{"allow":[]},"model":"x"}' > "$F2/.claude/settings.json"
OUT2="$(run_helper "$F2" --settings "$F2/.claude/settings.json")"
RC2=$?
BAKS2="$(find "$F2/.claude" -name 'settings.json.bak-pre-autocompact-*' | wc -l | tr -d ' ')"
if [ "$RC2" -eq 0 ] \
   && [ "$(json_keys "$F2/.claude/settings.json" autoCompactEnabled)" = "true" ] \
   && [ "$(json_keys "$F2/.claude/settings.json" autoCompactWindow)" = "500000" ] \
   && [ "$(json_keys "$F2/.claude/settings.json" permissions)" = '{"allow":[]}' ] \
   && [ "$(json_keys "$F2/.claude/settings.json" model)" = '"x"' ] \
   && [ "$BAKS2" = "1" ]; then
  pass "existing JSON: merged, extra keys preserved verbatim, backup exists"
else
  fail "existing JSON: rc=$RC2 baks=$BAKS2"
fi
# Backup content must equal the ORIGINAL (pre-merge) file exactly.
BAK2="$(find "$F2/.claude" -name 'settings.json.bak-pre-autocompact-*' | head -1)"
if [ "$(cat "$BAK2")" = '{"permissions":{"allow":[]},"model":"x"}' ]; then
  pass "existing JSON: backup is a byte-exact copy of the original"
else
  fail "existing JSON: backup content mismatch"
fi

# --- 3. already set -> exit 0, mtime unchanged, NO backup ------------------
F3="$(mktemp -d)"
mkdir -p "$F3/.claude"
printf '{\n  "permissions": {"allow": []},\n  "autoCompactEnabled": true,\n  "autoCompactWindow": 500000\n}\n' > "$F3/.claude/settings.json"
MT3_BEFORE="$(stat -f %m "$F3/.claude/settings.json")"
OUT3="$(run_helper "$F3" --settings "$F3/.claude/settings.json")"
RC3=$?
MT3_AFTER="$(stat -f %m "$F3/.claude/settings.json")"
BAKS3="$(find "$F3/.claude" -name 'settings.json.bak-pre-autocompact-*' | wc -l | tr -d ' ')"
if [ "$RC3" -eq 0 ] && [ "$MT3_BEFORE" = "$MT3_AFTER" ] && [ "$BAKS3" = "0" ] \
   && [ "$OUT3" = "already set: $F3/.claude/settings.json" ]; then
  pass "already set: exit 0, mtime unchanged, no backup"
else
  fail "already set: rc=$RC3 mtime=$MT3_BEFORE/$MT3_AFTER baks=$BAKS3 out='$OUT3'"
fi

# --- 4. invalid JSON -> exit 1, file byte-identical -------------------------
F4="$(mktemp -d)"
mkdir -p "$F4/.claude"
printf '{not valid json' > "$F4/.claude/settings.json"
HASH4_BEFORE="$(shasum -a 256 "$F4/.claude/settings.json" | awk '{print $1}')"
OUT4="$(run_helper "$F4" --settings "$F4/.claude/settings.json")"
RC4=$?
HASH4_AFTER="$(shasum -a 256 "$F4/.claude/settings.json" | awk '{print $1}')"
if [ "$RC4" -eq 1 ] && [ "$HASH4_BEFORE" = "$HASH4_AFTER" ] \
   && [ "$OUT4" = "refusing: $F4/.claude/settings.json is not valid JSON (nothing changed)" ]; then
  pass "invalid JSON: exit 1, file byte-identical, no backup"
else
  fail "invalid JSON: rc=$RC4 hash=$HASH4_BEFORE/$HASH4_AFTER out='$OUT4'"
fi

# --- 5. --dry-run on fresh path -> no file created, exit 0 -----------------
F5="$(mktemp -d)"
OUT5="$(run_helper "$F5" --dry-run --settings "$F5/.claude/settings.json")"
RC5=$?
if [ "$RC5" -eq 0 ] && [ ! -e "$F5/.claude/settings.json" ] \
   && [ "$OUT5" = "would set: $F5/.claude/settings.json" ]; then
  pass "dry-run fresh path: would set, nothing created, exit 0"
else
  fail "dry-run fresh path: rc=$RC5 out='$OUT5'"
fi

# --- 6. missing --settings + --dry-run -> default resolves inside fixture ---
F6="$(mktemp -d)"
OUT6="$(run_helper "$F6" --dry-run)"
RC6=$?
if [ "$RC6" -eq 0 ] && [ "$OUT6" = "would set: $F6/.claude/settings.json" ] \
   && [ ! -e "$F6/.claude/settings.json" ]; then
  pass "default path under fake HOME: would set, nothing created"
else
  fail "default path under fake HOME: rc=$RC6 out='$OUT6'"
fi

# --- 7. bad flag -> exit 2 --------------------------------------------------
F7="$(mktemp -d)"
OUT7="$(run_helper "$F7" --nope --settings "$F7/.claude/settings.json" 2>&1)"
RC7=$?
if [ "$RC7" -eq 2 ]; then
  pass "bad flag: exit 2"
else
  fail "bad flag: rc=$RC7 out='$OUT7'"
fi

# --- 8. --window honored (merge writes the requested value) -----------------
F8="$(mktemp -d)"
OUT8="$(run_helper "$F8" --window 250000 --settings "$F8/.claude/settings.json")"
RC8=$?
if [ "$RC8" -eq 0 ] \
   && [ "$(json_keys "$F8/.claude/settings.json" autoCompactWindow)" = "250000" ] \
   && [ "$(json_keys "$F8/.claude/settings.json" autoCompactEnabled)" = "true" ]; then
  pass "custom --window 250000 written"
else
  fail "custom --window: rc=$RC8 out='$OUT8'"
fi

# --- summary ----------------------------------------------------------------
printf '\nSUMMARY: %d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
