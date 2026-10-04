#!/usr/bin/env bash
# test-skills-only.sh — behavior tests for `setup-macos.sh --skills-only [--check]`.
# Everything runs against a FAKE HOME in mktemp dirs; the real home is never read or
# written. Fails if ANY forbidden path (9Router, claude-nine, settings, state) changes,
# if CHECK mode writes anything at all, or if the full install path is reached
# (shim node/npm/brew/gh record a marker file if they are ever executed).
# macOS arm64 only (the script's own gate); elsewhere it prints SKIP and exits 0.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/setup-macos.sh"
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
  mkdir -p "$ROOT/elsewhere/bro" && echo 'someone else' > "$ROOT/elsewhere/bro/SKILL.md"
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
[ "$(cat "$ROOT/elsewhere/bro/SKILL.md")" = "someone else" ] && [ -L "$H1/.claude-nine/skills/bro" ] \
  && pass "apply: symlink to elsewhere left alone (target untouched)" || fail "apply: touched a foreign symlink"
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

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
