#!/usr/bin/env bash
# test-skills-only.sh — behavior tests for `setup-macos.sh --skills-only [--check]`.
# Everything runs against a FAKE HOME in mktemp dirs; the real home is never read or
# written. Fails if ANY forbidden path (9Router, claude-nine, settings, state) changes,
# if CHECK mode writes anything at all, or if the full install path is reached
# (shim node/npm/brew/gh record a marker file if they are ever executed).
# macOS arm64 only (the script's own gate); elsewhere it prints SKIP and exits 0.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/setup-macos.sh"
BUNDLE="$(cd "$(dirname "$SCRIPT")/../.." && pwd)"
if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "SKIP: setup-macos.sh is macOS arm64 only"; exit 0
fi

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }

# Shims first on PATH: executing any of these means the install path was reached.
SHIMS="$ROOT/shims"; MARK="$ROOT/install-path-reached"
mkdir -p "$SHIMS"
for t in node npm brew gh pip3 npx; do
  printf '#!/bin/sh\necho "%s $*" >> "%s"\nexit 1\n' "$t" "$MARK" > "$SHIMS/$t"; chmod +x "$SHIMS/$t"
done

# snap <dir>: every path (type, mode, size, mtime, content hash) under <dir>.
snap() { if [ -f "$1" ] && [ ! -L "$1" ]; then printf '%s F %s %s\n' "$1" "$(stat -f '%Lp %z %m' "$1")" "$(shasum -a 256 < "$1" | cut -d' ' -f1)"; return; fi
  (cd "$1" && find . -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' p; do
  if [ -L "$p" ]; then printf '%s L %s\n' "$p" "$(readlink "$p")"
  elif [ -d "$p" ]; then printf '%s D %s\n' "$p" "$(stat -f '%Lp %m' "$p")"
  else printf '%s F %s %s\n' "$p" "$(stat -f '%Lp %z %m' "$p")" "$(shasum -a 256 < "$p" | cut -d' ' -f1)"; fi
done); }

# mkbox <home> — fake already-9Router box. Forbidden files hold a canary string.
mkbox() {
  local h="$1"
  mkdir -p "$h/.9router" "$h/.local/bin" "$h/.claude-nine/skills" "$h/.claude/skills/eli5" \
           "$h/.claude/skills/nine-router-setup" "$h/Library/Application Support/BlackCEO/999" "$h/.local/share/999"
  echo 'ROUTER-SETTINGS-CANARY' > "$h/.9router/db.json"
  echo 'LAUNCHER-CANARY' > "$h/.local/bin/claude-nine"
  echo '{"canary":true}' > "$h/.claude-nine/settings.json"
  echo 'ultracode' > "$h/.claude-nine/.last-effort"
  echo '{"canary":true}' > "$h/.claude/settings.json"
  echo '{"canary":true}' > "$h/Library/Application Support/BlackCEO/999/router-session.json"
  echo 'NODE-DIR-CANARY' > "$h/.local/share/999/node-path"
  echo 'OLD INSTALLER' > "$h/.claude/skills/nine-router-setup/SKILL.md"
  echo 'stale eli5' > "$h/.claude/skills/eli5/SKILL.md"
  mkdir -p "$ROOT/elsewhere" && cp -R "$BUNDLE/bro" "$ROOT/elsewhere/bro"
  ln -s "$ROOT/elsewhere/bro" "$h/.claude-nine/skills/bro"
}
run() { # run <home> <args...>  (stdout+stderr, rc in $RC)
  local h="$1"; shift
  OUT="$(env -u CLAUDE_CONFIG_DIR HOME="$h" NINEROUTER_PORT=1 PATH="$SHIMS:/usr/bin:/bin:/usr/sbin:/sbin" bash "$SCRIPT" "$@" 2>&1)"; RC=$?
}

# --- 1. CHECK mode on an already-9Router box: writes NOTHING, exit 0 -----------
H1="$ROOT/h1"; mkbox "$H1"; B1="$(snap "$H1")"
run "$H1" --skills-only --check
A1="$(snap "$H1")"
if [ "$RC" -eq 0 ] && [ "$B1" = "$A1" ] && [ ! -e "$H1/.claude-skill-backups" ]; then
  pass "check mode: exit 0, whole fake HOME byte/mtime identical before vs after"
else fail "check mode changed something or failed (rc=$RC)"; fi
case "$OUT" in *"already-9Router box: YES"*) pass "check mode: recognizes an already-9Router box";; *) fail "check mode: did not recognize 9Router box";; esac
case "$OUT" in *"WILL NOT touch"*"~/.9router"*"~/.local/bin/claude-nine"*) pass "check mode: prints the will/will-not touch list";; *) fail "check mode: touch list missing";; esac
case "$OUT" in *"WOULD NEW"*"eli5"*|*"WOULD CHANGED"*"eli5"*) pass "check mode: reports what it WOULD change";; *) fail "check mode: no WOULD lines for eli5";; esac
[ ! -e "$MARK" ] && pass "check mode: install path never reached (no node/npm/brew/gh executed)" || fail "check mode reached the install path: $(cat "$MARK")"

# --- 2. APPLY mode: skills updated, every forbidden path byte-identical --------
FORBID=".9router .local .claude-nine/settings.json .claude-nine/.last-effort .claude/settings.json Library .claude/skills/nine-router-setup"
fsnap() { for p in $FORBID; do (cd "$1" && [ -e "$p" ] && snap "$p" | sed "s|^|$p |"); done; }
F_BEFORE="$(fsnap "$H1")"
# Coverage control: every forbidden path must actually appear in the snapshot, and the
# comparison must DETECT a change (else a green apply result would prove nothing).
MISSING=""; for p in $FORBID; do case "$F_BEFORE" in *"$p "*) ;; *) MISSING="$MISSING $p";; esac; done
[ -z "$MISSING" ] && pass "control: every forbidden path is covered by the snapshot" || fail "control: forbidden path(s) not snapshotted:$MISSING"
echo tamper >> "$H1/.claude-nine/settings.json"
[ "$(fsnap "$H1")" != "$F_BEFORE" ] && pass "control: snapshot detects a single-file forbidden change" || fail "control: snapshot blind to settings.json change"
echo '{"canary":true}' > "$H1/.claude-nine/settings.json"; touch -r "$H1/.claude/settings.json" "$H1/.claude-nine/settings.json"
F_BEFORE="$(fsnap "$H1")"
run "$H1" --skills-only
F_AFTER="$(fsnap "$H1")"
if [ "$RC" -eq 0 ] && [ "$F_BEFORE" = "$F_AFTER" ] && [ -n "$F_BEFORE" ]; then
  pass "apply: 9Router, claude-nine launcher, settings, state and nine-router-setup byte-identical"
else fail "apply: forbidden path changed or failed (rc=$RC)"; fi
if cmp -s "$SCRIPT/../../../eli5/SKILL.md" "$H1/.claude/skills/eli5/SKILL.md" 2>/dev/null \
   || cmp -s "$(dirname "$SCRIPT")/../../eli5/SKILL.md" "$H1/.claude/skills/eli5/SKILL.md"; then
  pass "apply: eli5 refreshed to the clone's content"
else fail "apply: eli5 not refreshed"; fi
cmp -s "$BUNDLE/bro/SKILL.md" "$ROOT/elsewhere/bro/SKILL.md" && [ -L "$H1/.claude-nine/skills/bro" ] \
  && pass "apply: symlink to an identical tree left alone (target untouched)" || fail "apply: touched a foreign symlink"
[ ! -e "$H1/.claude-skill-backups" ] && [ ! -e "$MARK" ] && pass "apply: no backup dir, install path never reached" || fail "apply: backup dir created or install path reached"

# --- 3. idempotent: second APPLY changes nothing ------------------------------
B3="$(snap "$H1")"; run "$H1" --skills-only; A3="$(snap "$H1")"
[ "$RC" -eq 0 ] && [ "$B3" = "$A3" ] && pass "idempotent: second apply is a no-op" || fail "idempotent: second apply changed files (rc=$RC)"
case "$OUT" in *"0 new + 0 changed"*) pass "idempotent: reports 0 new + 0 changed";; *) fail "idempotent: summary not zero";; esac

# --- 4. a box that does NOT run 9Router: apply refuses, check reports NO -------
H4="$ROOT/h4"; mkdir -p "$H4/.claude/skills/eli5"; echo keep > "$H4/.claude/skills/eli5/SKILL.md"; B4="$(snap "$H4")"
run "$H4" --skills-only
[ "$RC" -ne 0 ] && [ "$B4" = "$(snap "$H4")" ] && pass "no-9Router box: apply refuses, nothing written" || fail "no-9Router box: apply did not refuse cleanly (rc=$RC)"
run "$H4" --skills-only --check
case "$OUT" in *"already-9Router box: NO"*) [ "$B4" = "$(snap "$H4")" ] && pass "no-9Router box: check says NO, nothing written" || fail "no-9Router check wrote";; *) fail "no-9Router check did not say NO";; esac

# --- 5. guard rails on flags ---------------------------------------------------
run "$H1" --check;                                    [ "$RC" -ne 0 ] && pass "guard: --check alone is refused" || fail "guard: --check alone accepted"
run "$H1" --skills-only --operator-remote-owner acme; [ "$RC" -ne 0 ] && pass "guard: --skills-only + --operator-remote-owner refused" || fail "guard: operator flag accepted"
[ ! -e "$MARK" ] && pass "guard: install path never reached by any run" || fail "install path reached: $(cat "$MARK")"

# --- 6. symlinked destinations: identical = OK, different = STALE exit 3 -------
# A symlinked skill/file is never overwritten, but a stale target must not read as
# success: it has to be reported and the run must exit 3 (content not delivered).
BUNDLE="$(cd "$(dirname "$SCRIPT")/../.." && pwd)"
okbox() { # okbox <home> — already-9Router markers only, no skills yet
  mkdir -p "$1/.9router" "$1/.local/bin" "$1/.claude/skills"
  echo 'ROUTER-SETTINGS-CANARY' > "$1/.9router/db.json"
  echo 'LAUNCHER-CANARY' > "$1/.local/bin/claude-nine"
}

# 6a. skill dir is a symlink to a STALE tree -> STALE + exit 3, target untouched
H6="$ROOT/h6"; okbox "$H6"; mkdir -p "$ROOT/elsewhere/stale-eli5"; echo 'stale eli5' > "$ROOT/elsewhere/stale-eli5/SKILL.md"
ln -s "$ROOT/elsewhere/stale-eli5" "$H6/.claude/skills/eli5"
run "$H6" --skills-only
case "$OUT" in *"STALE eli5"*) pass "stale symlink: reported STALE, not silent SKIP";; *) fail "stale symlink: not reported as STALE";; esac
[ "$RC" -eq 3 ] && pass "stale symlink: apply exits 3 (content not delivered)" || fail "stale symlink: expected rc 3, got $RC"
case "$OUT" in *"1 stale"*) pass "stale symlink: counted in the RESULT line";; *) fail "stale symlink: RESULT line does not count it";; esac
[ "$(cat "$ROOT/elsewhere/stale-eli5/SKILL.md")" = "stale eli5" ] && [ -L "$H6/.claude/skills/eli5" ] \
  && pass "stale symlink: target and link left untouched" || fail "stale symlink: touched the foreign target"
B6="$(snap "$H6")"
run "$H6" --skills-only --check
[ "$RC" -eq 3 ] && [ "$B6" = "$(snap "$H6")" ] && pass "stale symlink: check also exits 3, still read-only" || fail "stale symlink check: rc=$RC or wrote"

# 6b. skill dir is a symlink to an IDENTICAL tree -> OK, exit 0
H7="$ROOT/h7"; okbox "$H7"; cp -R "$BUNDLE/eli5" "$ROOT/elsewhere/eli5-same"
ln -s "$ROOT/elsewhere/eli5-same" "$H7/.claude/skills/eli5"
run "$H7" --skills-only
case "$OUT" in *"identical content"*) pass "identical symlink: reported as identical content";; *) fail "identical symlink: not recognized as identical";; esac
[ "$RC" -eq 0 ] && pass "identical symlink: exit 0 (nothing stale)" || fail "identical symlink: expected rc 0, got $RC"

# 6c. a destination FILE inside a real skill dir is a stale symlink -> STALE + exit 3
H8="$ROOT/h8"; okbox "$H8"; mkdir -p "$H8/.claude/skills/eli5" "$ROOT/elsewhere/file-target"
echo 'different content' > "$ROOT/elsewhere/file-target/SKILL.md"
ln -s "$ROOT/elsewhere/file-target/SKILL.md" "$H8/.claude/skills/eli5/SKILL.md"
run "$H8" --skills-only
case "$OUT" in *"STALE (destination file is a symlink to different content)"*"eli5/SKILL.md"*) pass "stale file symlink: reported STALE";; *) fail "stale file symlink: not reported";; esac
[ "$RC" -eq 3 ] && pass "stale file symlink: exit 3" || fail "stale file symlink: expected rc 3, got $RC"
[ "$(cat "$ROOT/elsewhere/file-target/SKILL.md")" = "different content" ] && [ -L "$H8/.claude/skills/eli5/SKILL.md" ] \
  && pass "stale file symlink: target and link left untouched" || fail "stale file symlink: touched the foreign target"
[ ! -e "$MARK" ] && pass "symlink cases: install path never reached" || fail "symlink cases reached the install path"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
