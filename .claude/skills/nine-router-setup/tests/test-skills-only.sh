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
# FAKE_SCRIPTS: set to a fake NINE_SETUP_SCRIPT_DIR for the fake-bundle cases
# (blocked-outcome tests); empty means the real script's own tree.
FAKE_SCRIPTS=""
run() { # run <home> <args...>  (stdout+stderr, rc in $RC)
  local h="$1"; shift
  OUT="$(env -u CLAUDE_CONFIG_DIR HOME="$h" NINEROUTER_PORT=1 NINE_SETUP_SCRIPT_DIR="$FAKE_SCRIPTS" PATH="$SHIMS:/usr/bin:/bin:/usr/sbin:/sbin" bash "$SCRIPT" "$@" 2>&1)"; RC=$?
}

# --- 1. CHECK mode on an already-9Router box: writes NOTHING, exit 0 -----------
H1="$ROOT/h1"; mkbox "$H1"; B1="$(snap "$H1")"
run "$H1" --skills-only --check
A1="$(snap "$H1")"
# MODIFIED assertion (spec: UPDATER_STALE is "counted in the RESULT line and in
# the exit status"): mkbox installs an OLD nine-router-setup copy ('OLD
# INSTALLER') that differs from the bundle, so this run now exits 5
# (updater-stale) instead of 0. The write-check parts of the assertion are
# unchanged. See also the updater case in section 13.
if [ "$RC" -eq 5 ] && [ "$B1" = "$A1" ] && [ ! -e "$H1/.claude-skill-backups" ]; then
  pass "check mode: exit 5 (updater-stale), whole fake HOME byte/mtime identical before vs after"
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
# MODIFIED assertion (spec: UPDATER_STALE counts in the exit status): the
# fixture's old nine-router-setup copy makes this run exit 5 (updater-stale);
# the forbidden-path byte-identity check is unchanged.
if [ "$RC" -eq 5 ] && [ "$F_BEFORE" = "$F_AFTER" ] && [ -n "$F_BEFORE" ]; then
  pass "apply: exit 5 (updater-stale); 9Router, claude-nine launcher, settings, state and nine-router-setup byte-identical"
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
# MODIFIED assertion (spec: UPDATER_STALE counts in the exit status): same
# fixture updater as above, so rc is 5, not 0; the no-op check is unchanged.
[ "$RC" -eq 5 ] && [ "$B3" = "$A3" ] && pass "idempotent: second apply is a no-op (exit 5, updater-stale)" || fail "idempotent: second apply changed files (rc=$RC)"
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

# --- 7. blocked outcomes: incomplete delivery is never reported complete ------
# A bundled skill that cannot land as a skill directory at its destination is
# BLOCKED: reported with the exact path and reason, counted in the RESULT line,
# exit 4, and nothing is written for it. Both cases run against a FAKE bundle
# (NINE_SETUP_SCRIPT_DIR) whose manifest names exactly the skill under test.
FAKE="$ROOT/fake"
mkdir -p "$FAKE/.claude/skills/nine-router-setup" "$FAKE/CONTROL"
ln -s "$BUNDLE/nine-router-setup/scripts" "$FAKE/.claude/skills/nine-router-setup/scripts"
FAKE_SCRIPTS="$FAKE/.claude/skills/nine-router-setup/scripts"

# 7a. manifest skill with no source in the bundle -> BLOCKED, exit 4, nothing written
printf 'ghost-skill\n' > "$FAKE/CONTROL/bundled-skills.txt"
H9="$ROOT/h9"; okbox "$H9"; B9="$(snap "$H9")"
run "$H9" --skills-only
[ "$RC" -eq 4 ] && [ "$B9" = "$(snap "$H9")" ] && [ ! -e "$H9/.claude/skills/ghost-skill" ] \
  && pass "blocked: missing source exits 4, destination skill stays missing, nothing written" \
  || fail "blocked: missing source rc=$RC, or something was written"
case "$OUT" in *"BLOCKED ghost-skill"*"$H9/.claude/skills/ghost-skill"*) pass "blocked: missing source reported with the exact destination path";; *) fail "blocked: missing source not reported with its path";; esac
case "$OUT" in *"1 blocked"*) pass "blocked: counted in the RESULT line";; *) fail "blocked: RESULT line does not count it";; esac

# 7b. destination is a plain file where a skill directory is expected -> BLOCKED
cp -R "$BUNDLE/eli5" "$FAKE/.claude/skills/eli5"
printf 'eli5\n' > "$FAKE/CONTROL/bundled-skills.txt"
H10="$ROOT/h10"; okbox "$H10"; printf 'plain file here\n' > "$H10/.claude/skills/eli5"
B10="$(snap "$H10")"
run "$H10" --skills-only
[ "$RC" -eq 4 ] && [ "$B10" = "$(snap "$H10")" ] && [ -f "$H10/.claude/skills/eli5" ] \
  && pass "blocked: plain-file destination exits 4, nothing written, file intact" \
  || fail "blocked: plain-file rc=$RC, or something was written"
case "$OUT" in *"BLOCKED eli5"*"$H10/.claude/skills/eli5"*"not a directory"*) pass "blocked: plain-file destination reported with path and reason";; *) fail "blocked: plain-file destination not reported";; esac
FAKE_SCRIPTS=""

# --- 8. --repair-links: replace the stale symlink with the bundled tree -------
# Opt-in: the STALE SYMLINK ITSELF is unlinked and this bundle's tree is
# materialised at the destination path; the old target directory is reported
# and left completely untouched. Without the flag, case 6a's leave-alone stands.
H11="$ROOT/h11"; okbox "$H11"; mkdir -p "$ROOT/elsewhere/stale-eli5b"
printf 'stale eli5\n' > "$ROOT/elsewhere/stale-eli5b/SKILL.md"
ln -s "$ROOT/elsewhere/stale-eli5b" "$H11/.claude/skills/eli5"
TB="$(snap "$ROOT/elsewhere/stale-eli5b")"
run "$H11" --skills-only --repair-links
[ "$RC" -eq 0 ] && pass "repair-links: stale link repaired, exit 0 (delivered)" || fail "repair-links: rc=$RC"
[ -d "$H11/.claude/skills/eli5" ] && [ ! -L "$H11/.claude/skills/eli5" ] && cmp -s "$BUNDLE/eli5/SKILL.md" "$H11/.claude/skills/eli5/SKILL.md" \
  && pass "repair-links: destination is a real directory carrying the bundled tree" || fail "repair-links: destination not materialised"
[ "$TB" = "$(snap "$ROOT/elsewhere/stale-eli5b")" ] && pass "repair-links: old target left intact and untouched" || fail "repair-links: old target was touched"
case "$OUT" in *"REPAIRED eli5"*"$ROOT/elsewhere/stale-eli5b"*"left untouched"*) pass "repair-links: old target path reported";; *) fail "repair-links: old target not reported";; esac
run "$H11" --repair-links
[ "$RC" -ne 0 ] && pass "guard: --repair-links alone is refused" || fail "guard: --repair-links alone accepted"

# --- 9. repair idempotence: a second repair run is a no-op --------------------
B11="$(snap "$H11")"; run "$H11" --skills-only --repair-links; A11="$(snap "$H11")"
[ "$RC" -eq 0 ] && [ "$B11" = "$A11" ] && pass "repair-links: second run is a no-op" || fail "repair-links: second run changed files (rc=$RC)"
case "$OUT" in *"0 new + 0 changed"*) pass "repair-links: second run reports 0 new + 0 changed";; *) fail "repair-links: summary not zero";; esac

# --- 10. a symlink inside a destination tree is never overwritten -------------
# Even WITH --repair-links: a foreign symlink INSIDE a real skill dir stays
# untouched and reported (repair-links repairs a stale skill-level link only).
H12="$ROOT/h12"; okbox "$H12"; mkdir -p "$H12/.claude/skills/eli5" "$ROOT/elsewhere/file-target2"
printf 'different content\n' > "$ROOT/elsewhere/file-target2/SKILL.md"
ln -s "$ROOT/elsewhere/file-target2/SKILL.md" "$H12/.claude/skills/eli5/SKILL.md"
T12="$(snap "$ROOT/elsewhere/file-target2")"
run "$H12" --skills-only --repair-links
case "$OUT" in *"STALE (destination file is a symlink to different content)"*"eli5/SKILL.md"*) pass "inner symlink: differing link reported even with --repair-links";; *) fail "inner symlink: not reported";; esac
[ "$RC" -eq 3 ] && pass "inner symlink: exit 3 (content not delivered)" || fail "inner symlink: rc=$RC"
[ "$T12" = "$(snap "$ROOT/elsewhere/file-target2")" ] && [ -L "$H12/.claude/skills/eli5/SKILL.md" ] \
  && pass "inner symlink: link and foreign target untouched (never written through)" || fail "inner symlink: target or link touched"

# --- 11. executable mode drift is reported and never silently ignored --------
# The bundle ships +x scripts; a copy that lost the executable bit is drift.
H13="$ROOT/h13"; okbox "$H13"; cp -R "$BUNDLE/drama-studio" "$H13/.claude/skills/drama-studio"
chmod -x "$H13/.claude/skills/drama-studio/studio.py"
run "$H13" --skills-only --check
case "$OUT" in *"MODE DRIFT"*"drama-studio/studio.py"*) pass "mode drift: +x difference reported";; *) fail "mode drift: not reported";; esac
case "$OUT" in *"mode drift"*) pass "mode drift: counted in the RESULT line";; *) fail "mode drift: not counted in RESULT";; esac
run "$H13" --skills-only
[ -x "$H13/.claude/skills/drama-studio/studio.py" ] && pass "mode drift: apply refreshes the executable bit" || fail "mode drift: apply left the +x difference"

# The same drift behind a symlinked tree: equivalence must NOT claim identical.
H14="$ROOT/h14"; okbox "$H14"; cp -R "$BUNDLE/drama-studio" "$ROOT/elsewhere/drama-stale"
chmod -x "$ROOT/elsewhere/drama-stale/studio.py"
ln -s "$ROOT/elsewhere/drama-stale" "$H14/.claude/skills/drama-studio"
run "$H14" --skills-only
case "$OUT" in *"MODE DRIFT"*"drama-stale/studio.py"*) pass "mode drift: tree comparison reports it";; *) fail "mode drift: tree comparison silent";; esac
case "$OUT" in *"identical content"*) fail "mode drift: drifted tree falsely claimed identical";; *) pass "mode drift: drifted tree not claimed identical";; esac
[ "$RC" -eq 3 ] && pass "mode drift: drifted symlinked tree is stale, exit 3" || fail "mode drift: rc=$RC"

# --- 12. the installed updater is reported, never silently excluded ----------
# nine-router-setup is excluded from the sync, but an installed copy that
# differs from this bundle is UPDATER_STALE: exact path, human action (the full
# install), counted in the RESULT line AND in the exit status (rc 5).
F_U="$(fsnap "$H1")"
run "$H1" --skills-only --check
case "$OUT" in *"UPDATER_STALE"*"$H1/.claude/skills/nine-router-setup"*) pass "updater: stale installer reported with the exact path";; *) fail "updater: stale installer not reported";; esac
case "$OUT" in *"run the FULL install"*) pass "updater: human action (the full install) reported";; *) fail "updater: human action missing";; esac
case "$OUT" in *"updater-stale"*) pass "updater: counted in the RESULT line";; *) fail "updater: not counted in RESULT";; esac
[ "$RC" -eq 5 ] && [ "$F_U" = "$(fsnap "$H1")" ] && pass "updater: counted in the exit status (rc 5), installer untouched" || fail "updater: rc=$RC or installer touched"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
