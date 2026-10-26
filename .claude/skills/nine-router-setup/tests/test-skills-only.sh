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

# snap <dir>: every path (type, mode, size, mtime, symlink target) under <dir>,
# plus ONE aggregate SHA-256 over the ordered per-file content hashes. Equal
# snapshots still mean "not one byte, mode, mtime or path changed"; batching is
# what makes it affordable - a settled fake HOME carries the whole 15-skill
# bundle (~6.3k paths, 330 MB) and one stat+shasum spawn per path costs ~73 s
# per snapshot (~4 min across this suite), which is what blew the 300 s limit.
snap() { if [ -f "$1" ] && [ ! -L "$1" ]; then printf '%s F %s %s\n' "$1" "$(stat -f '%Lp %z %m' "$1")" "$(shasum -a 256 < "$1" | cut -d' ' -f1)"; return; fi
  (cd "$1" && find . -print0 | LC_ALL=C sort -z | xargs -0 stat -f '%N|%HT|%Lp|%z|%m|%Y'
  printf 'CONTENT %s\n' "$(find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"); }

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

# mkfake <dir> <skill...> — per-case source bundle whose manifest names exactly
# the skill(s) under test (the section 7/13 pattern). The 6a-11 cases exercise
# DESTINATION semantics (symlinks, mode drift), so a full 15-skill source only
# adds a 30-50 s bundle scan per run; the full-bundle cases above keep the real
# tree.
mkfake() {
  local d="$1" s; shift
  mkdir -p "$d/.claude/skills/nine-router-setup" "$d/CONTROL"
  ln -s "$BUNDLE/nine-router-setup/scripts" "$d/.claude/skills/nine-router-setup/scripts"
  : > "$d/CONTROL/bundled-skills.txt"
  for s in "$@"; do printf '%s\n' "$s" >> "$d/CONTROL/bundled-skills.txt"; cp -R "$BUNDLE/$s" "$d/.claude/skills/$s"; done
}
FE="$ROOT/fake-eli5"; mkfake "$FE" eli5
FD="$ROOT/fake-drama"; mkfake "$FD" drama-studio

# 6a. skill dir is a symlink to a STALE tree -> STALE + exit 3, target untouched
H6="$ROOT/h6"; okbox "$H6"; mkdir -p "$ROOT/elsewhere/stale-eli5"; echo 'stale eli5' > "$ROOT/elsewhere/stale-eli5/SKILL.md"
ln -s "$ROOT/elsewhere/stale-eli5" "$H6/.claude/skills/eli5"
FAKE_SCRIPTS="$FE/.claude/skills/nine-router-setup/scripts"
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
H7="$ROOT/h7"; okbox "$H7"; cp -R "$FE/.claude/skills/eli5" "$ROOT/elsewhere/eli5-same"
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
FAKE_SCRIPTS="$FE/.claude/skills/nine-router-setup/scripts"
H11="$ROOT/h11"; okbox "$H11"; mkdir -p "$ROOT/elsewhere/stale-eli5b"
printf 'stale eli5\n' > "$ROOT/elsewhere/stale-eli5b/SKILL.md"
ln -s "$ROOT/elsewhere/stale-eli5b" "$H11/.claude/skills/eli5"
TB="$(snap "$ROOT/elsewhere/stale-eli5b")"
run "$H11" --skills-only --repair-links
[ "$RC" -eq 0 ] && pass "repair-links: stale link repaired, exit 0 (delivered)" || fail "repair-links: rc=$RC"
[ -d "$H11/.claude/skills/eli5" ] && [ ! -L "$H11/.claude/skills/eli5" ] && cmp -s "$FE/.claude/skills/eli5/SKILL.md" "$H11/.claude/skills/eli5/SKILL.md" \
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
FAKE_SCRIPTS="$FD/.claude/skills/nine-router-setup/scripts"
H13="$ROOT/h13"; okbox "$H13"; cp -R "$FD/.claude/skills/drama-studio" "$H13/.claude/skills/drama-studio"
chmod -x "$H13/.claude/skills/drama-studio/studio.py"
run "$H13" --skills-only --check
case "$OUT" in *"MODE DRIFT"*"drama-studio/studio.py"*) pass "mode drift: +x difference reported";; *) fail "mode drift: not reported";; esac
case "$OUT" in *"mode drift"*) pass "mode drift: counted in the RESULT line";; *) fail "mode drift: not counted in RESULT";; esac
run "$H13" --skills-only
[ -x "$H13/.claude/skills/drama-studio/studio.py" ] && pass "mode drift: apply refreshes the executable bit" || fail "mode drift: apply left the +x difference"

# The same drift behind a symlinked tree: equivalence must NOT claim identical.
H14="$ROOT/h14"; okbox "$H14"; cp -R "$FD/.claude/skills/drama-studio" "$ROOT/elsewhere/drama-stale"
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
FAKE_SCRIPTS=""
F_U="$(fsnap "$H1")"
run "$H1" --skills-only --check
case "$OUT" in *"UPDATER_STALE"*"$H1/.claude/skills/nine-router-setup"*) pass "updater: stale installer reported with the exact path";; *) fail "updater: stale installer not reported";; esac
case "$OUT" in *"run the FULL install"*) pass "updater: human action (the full install) reported";; *) fail "updater: human action missing";; esac
case "$OUT" in *"updater-stale"*) pass "updater: counted in the RESULT line";; *) fail "updater: not counted in RESULT";; esac
[ "$RC" -eq 5 ] && [ "$F_U" = "$(fsnap "$H1")" ] && pass "updater: counted in the exit status (rc 5), installer untouched" || fail "updater: rc=$RC or installer touched"

# --- 13. --refresh-updater: opt-in self-refresh of the installed installer ----
# The --skills-only path never touches nine-router-setup unless the operator
# opts in. The refresh is in place and per-file atomic (temp + rename, so a
# file is always complete - old or new, never truncated); a foreign symlink is
# never followed or replaced; nothing is ever deleted (extra old entries are
# kept and reported); a second run is a no-op; a failure leaves the previous
# copy usable. When a safe in-place refresh cannot be guaranteed the whole
# refresh is refused BEFORE anything is written (BLOCKED + the full-install
# command) instead of half-updating. All cases run against a FAKE bundle whose
# manifest names only nine-router-setup (excluded from the sync loop), so only
# the updater path is exercised.
U="$ROOT/fake-upd"
mkdir -p "$U/.claude/skills/nine-router-setup/scripts/common" "$U/.claude/skills/nine-router-setup/tests" "$U/CONTROL"
printf 'nine-router-setup\n' > "$U/CONTROL/bundled-skills.txt"
# settings-lock.sh is sourced at script load, so the fake bundle must carry it.
cp "$BUNDLE/nine-router-setup/scripts/common/settings-lock.sh" "$U/.claude/skills/nine-router-setup/scripts/common/settings-lock.sh"
printf 'FAKE UPDATER v2 SKILL\n'  > "$U/.claude/skills/nine-router-setup/SKILL.md"
printf 'FAKE UPDATER v2 SCRIPT\n' > "$U/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
printf 'FAKE UPDATER v2 TEST\n'   > "$U/.claude/skills/nine-router-setup/tests/test-skills-only.sh"
FAKE_SCRIPTS="$U/.claude/skills/nine-router-setup/scripts"
upbox() { # upbox <home> — already-9Router box with a STALE installed updater copy
  okbox "$1"
  mkdir -p "$1/.claude/skills/nine-router-setup/scripts" "$1/.claude/skills/nine-router-setup/tests"
  printf 'OLD SKILL v1\n'  > "$1/.claude/skills/nine-router-setup/SKILL.md"
  printf 'OLD SCRIPT v1\n' > "$1/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
  printf 'OLD TEST v1\n'   > "$1/.claude/skills/nine-router-setup/tests/test-skills-only.sh"
}

# 13a. updater behind + NO flag -> unchanged and UPDATER_STALE (exit 5);
#      with the flag in CHECK mode -> WOULD REFRESH, still strictly read-only.
H15="$ROOT/h15"; upbox "$H15"; B15="$(snap "$H15")"
run "$H15" --skills-only
case "$OUT" in *"UPDATER_STALE"*"$H15/.claude/skills/nine-router-setup"*) pass "updater behind: reported UPDATER_STALE with the exact path (no flag)";; *) fail "updater behind: not reported";; esac
[ "$RC" -eq 5 ] && [ "$B15" = "$(snap "$H15")" ] && pass "updater behind: without the flag nothing is written (exit 5)" || fail "updater behind: rc=$RC or something was written"
run "$H15" --skills-only --check --refresh-updater
case "$OUT" in *"WOULD REFRESH nine-router-setup"*"$H15/.claude/skills/nine-router-setup"*) pass "refresh-updater check: reports WOULD REFRESH with the exact path";; *) fail "refresh-updater check: not reported";; esac
[ "$B15" = "$(snap "$H15")" ] && pass "refresh-updater check: still strictly read-only" || fail "refresh-updater check: wrote something"

# 13b. --refresh-updater refreshes in place; the second run is a no-op (exit 0)
H16="$ROOT/h16"; upbox "$H16"
run "$H16" --skills-only --refresh-updater
[ "$RC" -eq 0 ] && pass "refresh-updater: stale updater refreshed, exit 0" || fail "refresh-updater: rc=$RC"
case "$OUT" in *"REFRESHED nine-router-setup"*"$H16/.claude/skills/nine-router-setup"*) pass "refresh-updater: action and exact path reported";; *) fail "refresh-updater: not reported";; esac
cmp -s "$U/.claude/skills/nine-router-setup/SKILL.md" "$H16/.claude/skills/nine-router-setup/SKILL.md" \
  && cmp -s "$U/.claude/skills/nine-router-setup/scripts/setup-macos.sh" "$H16/.claude/skills/nine-router-setup/scripts/setup-macos.sh" \
  && cmp -s "$U/.claude/skills/nine-router-setup/tests/test-skills-only.sh" "$H16/.claude/skills/nine-router-setup/tests/test-skills-only.sh" \
  && pass "refresh-updater: installed copy carries this bundle's updater files" || fail "refresh-updater: content not delivered"
B16="$(snap "$H16")"; run "$H16" --skills-only --refresh-updater; A16="$(snap "$H16")"
[ "$RC" -eq 0 ] && [ "$B16" = "$A16" ] && pass "refresh-updater: second run is a no-op (exit 0)" || fail "refresh-updater: second run changed files (rc=$RC)"
case "$OUT" in *"UPDATER nine-router-setup: up to date"*) pass "refresh-updater: second run reports up to date";; *) fail "refresh-updater: second run not up to date";; esac

# 13c. installed updater is a SYMLINK elsewhere -> refused (BLOCKED, exit 4),
#      target byte-identical, link and whole HOME untouched.
H17="$ROOT/h17"; okbox "$H17"
mkdir -p "$ROOT/elsewhere/upd-target/scripts" "$ROOT/elsewhere/upd-target/tests"
printf 'OLD SKILL v1\n'  > "$ROOT/elsewhere/upd-target/SKILL.md"
printf 'OLD SCRIPT v1\n' > "$ROOT/elsewhere/upd-target/scripts/setup-macos.sh"
printf 'OLD TEST v1\n'   > "$ROOT/elsewhere/upd-target/tests/test-skills-only.sh"
ln -s "$ROOT/elsewhere/upd-target" "$H17/.claude/skills/nine-router-setup"
TU="$(snap "$ROOT/elsewhere/upd-target")"; B17="$(snap "$H17")"
run "$H17" --skills-only --refresh-updater
[ "$RC" -eq 4 ] && pass "updater symlink: refresh refused (BLOCKED), exit 4" || fail "updater symlink: rc=$RC"
case "$OUT" in *"BLOCKED"*"$H17/.claude/skills/nine-router-setup"*"symlink"*) pass "updater symlink: refused with a specific BLOCKED reason and the exact path";; *) fail "updater symlink: refusal not reported";; esac
case "$OUT" in *"run the FULL install"*) pass "updater symlink: full-install command printed instead of half-updating";; *) fail "updater symlink: full-install command missing";; esac
[ "$TU" = "$(snap "$ROOT/elsewhere/upd-target")" ] && [ -L "$H17/.claude/skills/nine-router-setup" ] && [ "$B17" = "$(snap "$H17")" ] \
  && pass "updater symlink: target byte-identical, link and HOME untouched" || fail "updater symlink: something was written"

# 13c2. a SYMLINKED DIRECTORY inside the installed updater -> refused too
# (a write there would follow a foreign link into another tree).
H17b="$ROOT/h17b"; upbox "$H17b"
mkdir -p "$ROOT/elsewhere/upd-parent"
printf 'FOREIGN TREE FILE\n' > "$ROOT/elsewhere/upd-parent/setup-macos.sh"
rm "$H17b/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
rmdir "$H17b/.claude/skills/nine-router-setup/scripts"
ln -s "$ROOT/elsewhere/upd-parent" "$H17b/.claude/skills/nine-router-setup/scripts"
TP="$(snap "$ROOT/elsewhere/upd-parent")"; B17b="$(snap "$H17b")"
run "$H17b" --skills-only --refresh-updater
[ "$RC" -eq 4 ] && pass "updater inner symlink dir: refresh refused (BLOCKED), exit 4" || fail "updater inner symlink dir: rc=$RC"
case "$OUT" in *"BLOCKED"*"scripts"*"symlink"*"foreign link"*) pass "updater inner symlink dir: refused with the exact path and reason";; *) fail "updater inner symlink dir: refusal not reported";; esac
[ "$TP" = "$(snap "$ROOT/elsewhere/upd-parent")" ] && [ -L "$H17b/.claude/skills/nine-router-setup/scripts" ] && [ "$B17b" = "$(snap "$H17b")" ] \
  && pass "updater inner symlink dir: foreign target byte-identical, nothing written" || fail "updater inner symlink dir: something was written"

# 13d. failure MID-REFRESH -> the previous copy is still usable
# The bundle's scripts/setup-macos.sh is made unreadable (the pre-scan does not
# read sources), so the copy fails after SKILL.md was already delivered:
# the refresh stops at the first error, every file stays complete (old or new),
# nothing is deleted, and this run's temp file is cleaned up.
H18="$ROOT/h18"; upbox "$H18"
chmod 000 "$U/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
run "$H18" --skills-only --refresh-updater
chmod 644 "$U/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
[ "$RC" -eq 1 ] && pass "mid-refresh failure: write error stops the refresh (exit 1)" || fail "mid-refresh failure: rc=$RC"
case "$OUT" in *"ERROR could not write"*"$H18/.claude/skills/nine-router-setup/scripts/setup-macos.sh"*) pass "mid-refresh failure: error names the exact path";; *) fail "mid-refresh failure: error not reported with its path";; esac
cmp -s "$U/.claude/skills/nine-router-setup/SKILL.md" "$H18/.claude/skills/nine-router-setup/SKILL.md" \
  && pass "mid-refresh failure: refresh had started (earlier file delivered)" || fail "mid-refresh failure: refresh never started"
[ "$(cat "$H18/.claude/skills/nine-router-setup/scripts/setup-macos.sh")" = "OLD SCRIPT v1" ] \
  && [ "$(cat "$H18/.claude/skills/nine-router-setup/tests/test-skills-only.sh")" = "OLD TEST v1" ] \
  && [ -d "$H18/.claude/skills/nine-router-setup" ] && [ ! -L "$H18/.claude/skills/nine-router-setup" ] \
  && pass "mid-refresh failure: previous copy still usable (complete old files, nothing deleted)" \
  || fail "mid-refresh failure: previous copy damaged"
[ -z "$(find "$H18/.claude/skills/nine-router-setup" -name '*.refresh-tmp*' -print 2>/dev/null)" ] \
  && pass "mid-refresh failure: no temp litter left in the tree" || fail "mid-refresh failure: temp file left in the tree"

# guard: --refresh-updater alone is refused
run "$H16" --refresh-updater
[ "$RC" -ne 0 ] && pass "guard: --refresh-updater alone is refused" || fail "guard: --refresh-updater alone accepted"
FAKE_SCRIPTS=""

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
