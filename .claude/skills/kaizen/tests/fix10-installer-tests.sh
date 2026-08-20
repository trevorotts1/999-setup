#!/usr/bin/env bash
# Fix 10: bundled-skill installer idempotency tests.
#
# Fixtures only: every test runs inside mktemp fixtures with a fake HOME and a
# fake repo copy. Never touches the real ~/.claude, ~/.claude-nine, ~/.local/bin,
# or the real Downloads folder, and never runs the full installer — only the
# skill-linking functions, extracted verbatim from the REAL setup-macos.sh
# (from bundled_skills() down to just before main()) into a fixture wrapper
# that dispatches a function by name: bash wrapper.sh link_skills_into_root <root>
#
# Design notes:
#  - REPO_SKILL_DIR follows the real installer's convention: it is the
#    nine-router-setup skill dir, and sources resolve as REPO_SKILL_DIR/../<s>.
#  - KAIZEN_DOWNLOADS is preserved verbatim through every fixture (nothing
#    here unsets it).
#  - Windows parity: setup-windows.ps1 gets structural checks (grep for
#    Get-BundledSkills presence, the backup-path pattern, and the junction
#    re-point removal). A pwsh parse runs when pwsh exists on this host.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SETUP_SH="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
SETUP_PS1="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-windows.ps1"
MANIFEST="$REPO_ROOT/CONTROL/bundled-skills.txt"

PASS=0
FAIL=0

say()  { printf '%s\n' "$*"; }
pass() { PASS=$((PASS + 1)); say "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); say "  FAIL: $1"; }

# check_eq <name> <expected> <actual>
check_eq() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected [$2], got [$3])"; fi
}

# make_skel <root> [extra-manifest-entry...] — fake repo with CONTROL + skills.
# The nine-router-setup dir itself must exist (as it does in the real repo):
# REPO_SKILL_DIR is the installer's own skill dir and sources resolve as
# REPO_SKILL_DIR/../<s>, so the intermediate path component must be real.
make_skel() {
  local skel="$1"; shift
  mkdir -p "$skel/CONTROL" "$skel/.claude/skills/nine-router-setup"
  local i
  for i in 1 2 3 4 5; do
    mkdir -p "$skel/.claude/skills/skill$i"
    printf -- '---\nname: skill%s\ndescription: fixture skill %s\n---\nMARKER-REPO-%s\n' "$i" "$i" "$i" \
      > "$skel/.claude/skills/skill$i/SKILL.md"
  done
  {
    printf 'skill1\nskill2\nskill3\nskill4\nskill5\n'
    for extra in "$@"; do printf '%s\n' "$extra"; done
  } > "$skel/CONTROL/bundled-skills.txt"
}

# make_wrapper <wrapper-path> — extract the REAL setup-macos.sh skill-linking
# functions verbatim (bundled_skills() through just before main()) and append a
# dispatch: `bash wrapper.sh <function> <args...>` runs that function.
make_wrapper() {
  local wrapper="$1"
  {
    cat <<'EOF'
#!/usr/bin/env bash
# Fixture wrapper: contains ONLY the real setup-macos.sh skill-linking
# functions, extracted verbatim by fix10-installer-tests.sh from
# bundled_skills() down to just before main(). main() is never defined, so
# nothing runs unless a function is dispatched below.
set -euo pipefail
EOF
    awk '/^bundled_skills\(\) \{/ {f=1} /^main\(\) \{/ {exit} f {print}' "$SETUP_SH"
    cat <<'EOF'

# Dispatch: run the function named by $1 with the remaining args (the test
# entry point). A nonzero function return becomes the wrapper's exit status.
[ "${1:-}" != "" ] && "$@"
exit 0
EOF
  } > "$wrapper"
}

# norm <path> — physical absolute path (follows symlinks).
norm() { (cd -P "$1" 2>/dev/null && pwd -P) 2>/dev/null || true; }

# ---------------------------------------------------------------------------
say "== 10.0 harness sanity: real functions present, main() not extracted =="
for f in bundled_skills resolve_skill_source link_one_skill link_skills_into_root; do
  grep -q "^$f()" "$SETUP_SH" && pass "10.0A $f defined in setup-macos.sh" \
    || fail "10.0A $f missing from setup-macos.sh"
done
TMP_HARNESS="$(mktemp -d)"
make_skel "$TMP_HARNESS/repo"
make_wrapper "$TMP_HARNESS/wrapper.sh"
grep -q '^main()' "$TMP_HARNESS/wrapper.sh" \
  && fail "10.0B wrapper must not contain main()" \
  || pass "10.0B wrapper excludes main() (safe to run)"
grep -q 'main "\$@"' "$TMP_HARNESS/wrapper.sh" \
  && fail "10.0C wrapper must not contain the main call" \
  || pass "10.0C wrapper excludes the main call"
bash -n "$SETUP_SH" && pass "10.0D bash -n setup-macos.sh" || fail "10.0D bash -n setup-macos.sh"
bash -n "$TMP_HARNESS/wrapper.sh" && pass "10.0E wrapper parses" || fail "10.0E wrapper parses"
# The wrapper must be able to run a real function end to end.
OUT_H="$(HOME="$TMP_HARNESS/home" REPO_ROOT="$TMP_HARNESS/repo" REPO_SKILL_DIR="$TMP_HARNESS/repo/.claude/skills/nine-router-setup" bash "$TMP_HARNESS/wrapper.sh" bundled_skills 2>&1)"
case "$OUT_H" in
  *skill1*skill5*) pass "10.0F wrapper dispatches bundled_skills" ;;
  *) fail "10.0F wrapper dispatch broken (got: $OUT_H)" ;;
esac

# ---------------------------------------------------------------------------
say "== 10.1 fresh install: all five manifest skills linked, repo markers present =="
F1="$(mktemp -d)"
make_skel "$F1/repo"
make_wrapper "$F1/wrapper.sh"
HOME_1="$F1/home"
mkdir -p "$HOME_1"
ROOT_1="$HOME_1/.claude"
OUT_1="$(
  HOME="$HOME_1" REPO_ROOT="$F1/repo" REPO_SKILL_DIR="$F1/repo/.claude/skills/nine-router-setup" \
    bash "$F1/wrapper.sh" link_skills_into_root "$ROOT_1" 2>&1
)"
RC_1=$?
check_eq "10.1A linker exit 0" "0" "$RC_1"
LINKED_1=0
for i in 1 2 3 4 5; do
  if [ -L "$ROOT_1/skills/skill$i" ] \
     && [ "$(norm "$ROOT_1/skills/skill$i")" = "$(norm "$F1/repo/.claude/skills/skill$i")" ]; then
    LINKED_1=$((LINKED_1 + 1))
  else
    fail "10.1B skill$i not a link to repo source"
  fi
done
check_eq "10.1B all five linked to repo source" "5" "$LINKED_1"
for i in 1 2 3 4 5; do
  grep -q "MARKER-REPO-$i" "$ROOT_1/skills/skill$i/SKILL.md" \
    && pass "10.1C skill$i dest SKILL.md has repo marker" \
    || fail "10.1C skill$i dest SKILL.md missing repo marker"
done
[ -e "$ROOT_1/skills/skill1/skill1" ] && fail "10.1D nested skill1/skill1 exists" \
  || pass "10.1D no nested skill1/skill1"

# ---------------------------------------------------------------------------
say "== 10.2 rerun converges: all up to date, link count unchanged, no nesting =="
OUT_2="$(
  HOME="$HOME_1" REPO_ROOT="$F1/repo" REPO_SKILL_DIR="$F1/repo/.claude/skills/nine-router-setup" \
    bash "$F1/wrapper.sh" link_skills_into_root "$ROOT_1" 2>&1
)"
RC_2=$?
check_eq "10.2A rerun exit 0" "0" "$RC_2"
UPTODATE_2=0
for i in 1 2 3 4 5; do
  case "$OUT_2" in *"skill up to date: skill$i"*) UPTODATE_2=$((UPTODATE_2 + 1));; esac
done
check_eq "10.2B all five reported up to date" "5" "$UPTODATE_2"
LINK_COUNT_2="$(find "$ROOT_1/skills" -maxdepth 1 -type l | wc -l | tr -d ' ')"
check_eq "10.2C link count unchanged (5)" "5" "$LINK_COUNT_2"
NESTED_2="$(find "$ROOT_1/skills" -name skill1 -type d | wc -l | tr -d ' ')"
check_eq "10.2D no nested skill1 dirs anywhere" "0" "$NESTED_2"

# ---------------------------------------------------------------------------
say "== 10.3 existing correct link: up to date, no rewrite (inode/mtime unchanged) =="
F3="$(mktemp -d)"
make_skel "$F3/repo"
make_wrapper "$F3/wrapper.sh"
HOME_3="$F3/home"
mkdir -p "$HOME_3/.claude/skills"
ln -s "$(norm "$F3/repo/.claude/skills/skill1")" "$HOME_3/.claude/skills/skill1"
INODE_BEFORE="$(stat -f '%i' "$HOME_3/.claude/skills/skill1")"
MTIME_BEFORE="$(stat -f '%m' "$HOME_3/.claude/skills/skill1")"
OUT_3="$(
  HOME="$HOME_3" REPO_ROOT="$F3/repo" REPO_SKILL_DIR="$F3/repo/.claude/skills/nine-router-setup" \
    bash "$F3/wrapper.sh" link_skills_into_root "$HOME_3/.claude" 2>&1
)"
case "$OUT_3" in
  *"skill up to date: skill1"*) pass "10.3A existing correct link reported up to date" ;;
  *) fail "10.3A existing correct link not reported up to date (got: $OUT_3)" ;;
esac
INODE_AFTER="$(stat -f '%i' "$HOME_3/.claude/skills/skill1")"
MTIME_AFTER="$(stat -f '%m' "$HOME_3/.claude/skills/skill1")"
check_eq "10.3B inode unchanged" "$INODE_BEFORE" "$INODE_AFTER"
check_eq "10.3C mtime unchanged" "$MTIME_BEFORE" "$MTIME_AFTER"

# ---------------------------------------------------------------------------
say "== 10.4 stale link to OLD dir: re-pointed to repo, old dir untouched =="
F4="$(mktemp -d)"
make_skel "$F4/repo"
make_wrapper "$F4/wrapper.sh"
HOME_4="$F4/home"
OLD_DIR="$F4/old/skill1"
mkdir -p "$HOME_4/.claude/skills" "$OLD_DIR"
printf 'OLD-CONTENT\n' > "$OLD_DIR/SKILL.md"
ln -s "$(norm "$OLD_DIR")" "$HOME_4/.claude/skills/skill1"
HOME="$HOME_4" REPO_ROOT="$F4/repo" REPO_SKILL_DIR="$F4/repo/.claude/skills/nine-router-setup" \
  bash "$F4/wrapper.sh" link_skills_into_root "$HOME_4/.claude" >/dev/null 2>&1
[ "$(norm "$HOME_4/.claude/skills/skill1")" = "$(norm "$F4/repo/.claude/skills/skill1")" ] \
  && pass "10.4A stale link re-pointed at repo source" \
  || fail "10.4A stale link still points at $(readlink "$HOME_4/.claude/skills/skill1")"
grep -q 'OLD-CONTENT' "$OLD_DIR/SKILL.md" \
  && pass "10.4B old source dir untouched" \
  || fail "10.4B old source dir was modified or deleted"

# ---------------------------------------------------------------------------
say "== 10.5 existing real dir: external backup, fresh link, no nested path =="
F5="$(mktemp -d)"
make_skel "$F5/repo"
make_wrapper "$F5/wrapper.sh"
HOME_5="$F5/home"
mkdir -p "$HOME_5/.claude/skills/skill1"
printf -- '---\nname: skill1\ndescription: stale\n---\nSTALE-CONTENT\n' \
  > "$HOME_5/.claude/skills/skill1/SKILL.md"
OUT_5="$(
  HOME="$HOME_5" REPO_ROOT="$F5/repo" REPO_SKILL_DIR="$F5/repo/.claude/skills/nine-router-setup" \
    bash "$F5/wrapper.sh" link_skills_into_root "$HOME_5/.claude" 2>&1
)"
[ -L "$HOME_5/.claude/skills/skill1" ] \
  && [ "$(norm "$HOME_5/.claude/skills/skill1")" = "$(norm "$F5/repo/.claude/skills/skill1")" ] \
  && pass "10.5A dest is now a link to repo source" \
  || fail "10.5A dest is not a link to repo source"
BACKUP_5="$(find "$HOME_5/.claude-skill-backups" -maxdepth 1 -name 'skill1.*' -type d 2>/dev/null | head -1)"
[ -n "$BACKUP_5" ] && [ -d "$BACKUP_5" ] \
  && pass "10.5B backup exists: $BACKUP_5" \
  || fail "10.5B no timestamped backup under $HOME_5/.claude-skill-backups"
[ -f "$BACKUP_5/SKILL.md" ] && grep -q 'STALE-CONTENT' "$BACKUP_5/SKILL.md" \
  && pass "10.5C backup contains the stale content" \
  || fail "10.5C backup missing or lacks STALE-CONTENT"
[ ! -d "$HOME_5/.claude/skills/skill1/skill1" ] \
  && pass "10.5D no nested skills/skill1/skill1" \
  || fail "10.5D nested skills/skill1/skill1 exists"
NESTED_ANY_5="$(find "$HOME_5/.claude" -path '*/skills/*/*' -type d 2>/dev/null | wc -l | tr -d ' ')"
check_eq "10.5E no nested skill dirs anywhere under config root" "0" "$NESTED_ANY_5"
grep -q 'MARKER-REPO-1' "$HOME_5/.claude/skills/skill1/SKILL.md" \
  && pass "10.5F dest SKILL.md has fresh repo marker (real content refreshed)" \
  || fail "10.5F dest SKILL.md lacks repo marker"
# The backup must live OUTSIDE any Claude config root (.claude/ or .claude-nine).
case "$BACKUP_5" in
  "$HOME_5/.claude/"*|"$HOME_5/.claude-nine"*) fail "10.5G backup is inside a Claude config root" ;;
  *) pass "10.5G backup is external to any Claude config root" ;;
esac

# ---------------------------------------------------------------------------
say "== 10.6 two real-dir installs at different times -> two timestamped backups =="
F6="$(mktemp -d)"
make_skel "$F6/repo"
make_wrapper "$F6/wrapper.sh"
HOME_6="$F6/home"
mkdir -p "$HOME_6/.claude/skills/skill1"
printf 'STALE-ONE\n' > "$HOME_6/.claude/skills/skill1/SKILL.md"
HOME="$HOME_6" REPO_ROOT="$F6/repo" REPO_SKILL_DIR="$F6/repo/.claude/skills/nine-router-setup" \
  bash "$F6/wrapper.sh" link_skills_into_root "$HOME_6/.claude" >/dev/null 2>&1
sleep 1
# Replace the link with a REAL dir again to simulate a second generation of
# pre-existing content.
rm -f "$HOME_6/.claude/skills/skill1"
mkdir -p "$HOME_6/.claude/skills/skill1"
printf 'STALE-TWO\n' > "$HOME_6/.claude/skills/skill1/SKILL.md"
HOME="$HOME_6" REPO_ROOT="$F6/repo" REPO_SKILL_DIR="$F6/repo/.claude/skills/nine-router-setup" \
  bash "$F6/wrapper.sh" link_skills_into_root "$HOME_6/.claude" >/dev/null 2>&1
BACKUPS_6="$(find "$HOME_6/.claude-skill-backups" -maxdepth 1 -name 'skill1.*' -type d | sort)"
COUNT_6="$(printf '%s\n' "$BACKUPS_6" | grep -c 'skill1\.' || true)"
check_eq "10.6A two distinct backups" "2" "$COUNT_6"
FIRST_6="$(printf '%s\n' "$BACKUPS_6" | head -1)"
SECOND_6="$(printf '%s\n' "$BACKUPS_6" | tail -1)"
[ -n "$FIRST_6" ] && [ -n "$SECOND_6" ] && [ "$FIRST_6" != "$SECOND_6" ] \
  && pass "10.6B backup names differ" \
  || fail "10.6B backup names identical"
grep -q 'STALE-ONE' "$FIRST_6/SKILL.md" && grep -q 'STALE-TWO' "$SECOND_6/SKILL.md" \
  && pass "10.6C each backup holds its own generation" \
  || fail "10.6C backup contents do not match their generations"

# ---------------------------------------------------------------------------
say "== 10.7 missing source: per-skill error, others continue, nonzero return =="
F7="$(mktemp -d)"
make_skel "$F7/repo" "ghost-skill"
make_wrapper "$F7/wrapper.sh"
HOME_7="$F7/home"
mkdir -p "$HOME_7"
OUT_7="$(
  HOME="$HOME_7" REPO_ROOT="$F7/repo" REPO_SKILL_DIR="$F7/repo/.claude/skills/nine-router-setup" \
    bash "$F7/wrapper.sh" link_skills_into_root "$HOME_7/.claude" 2>&1
)"
RC_7=$?
case "$OUT_7" in
  *"skill ERROR: ghost-skill"*"no source found"*) pass "10.7A per-skill error names ghost-skill" ;;
  *) fail "10.7A per-skill error missing (got: $OUT_7)" ;;
esac
check_eq "10.7B linker returns nonzero on any failure" "1" "$RC_7"
LINKED_7=0
for i in 1 2 3 4 5; do
  [ -L "$HOME_7/.claude/skills/skill$i" ] \
    && [ "$(norm "$HOME_7/.claude/skills/skill$i")" = "$(norm "$F7/repo/.claude/skills/skill$i")" ] \
    && LINKED_7=$((LINKED_7 + 1))
done
check_eq "10.7C other five skills still linked" "5" "$LINKED_7"

# ---------------------------------------------------------------------------
say "== 10.8 fake HOME path with spaces =="
F8="$(mktemp -d)"
SKEL_8="$F8/fake home with spaces/repo"
HOME_8="$F8/fake home with spaces/home"
make_skel "$SKEL_8"
make_wrapper "$F8/fake home with spaces/wrapper.sh"
mkdir -p "$HOME_8"
OUT_8="$(
  HOME="$HOME_8" REPO_ROOT="$SKEL_8" REPO_SKILL_DIR="$SKEL_8/.claude/skills/nine-router-setup" \
    bash "$F8/fake home with spaces/wrapper.sh" link_skills_into_root "$HOME_8/.claude" 2>&1
)"
RC_8=$?
check_eq "10.8A exit 0 with spaces in paths" "0" "$RC_8"
LINKED_8=0
for i in 1 2 3 4 5; do
  [ "$(norm "$HOME_8/.claude/skills/skill$i")" = "$(norm "$SKEL_8/.claude/skills/skill$i")" ] \
    && LINKED_8=$((LINKED_8 + 1))
done
check_eq "10.8B all five linked" "5" "$LINKED_8"
# Real-dir replacement under spaces too.
rm -f "$HOME_8/.claude/skills/skill1"
mkdir -p "$HOME_8/.claude/skills/skill1"
printf 'STALE\n' > "$HOME_8/.claude/skills/skill1/SKILL.md"
HOME="$HOME_8" REPO_ROOT="$SKEL_8" REPO_SKILL_DIR="$SKEL_8/.claude/skills/nine-router-setup" \
  bash "$F8/fake home with spaces/wrapper.sh" link_skills_into_root "$HOME_8/.claude" >/dev/null 2>&1
grep -q 'MARKER-REPO-1' "$HOME_8/.claude/skills/skill1/SKILL.md" \
  && pass "10.8C real dir replaced by fresh link under spaces" \
  || fail "10.8C real dir not replaced under spaces"
[ -d "$HOME_8/.claude/skills/skill1/skill1" ] \
  && fail "10.8D nested dir under spaces" \
  || pass "10.8D no nested dir under spaces"

# ---------------------------------------------------------------------------
say "== 10.9 all manifest skills installed (count == manifest entries) =="
MANIFEST_COUNT="$(sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$MANIFEST" | wc -l | tr -d ' ')"
F9="$(mktemp -d)"
make_wrapper "$F9/wrapper.sh"
HOME_9="$F9/home"
mkdir -p "$HOME_9"
# Run the real installer functions against the REAL repo manifest + skills,
# landing only in the fake HOME (the real repo is read-only here).
HOME="$HOME_9" REPO_ROOT="$REPO_ROOT" REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$F9/wrapper.sh" link_skills_into_root "$HOME_9/.claude" >/dev/null 2>&1
INSTALLED_9="$(find "$HOME_9/.claude/skills" -maxdepth 1 -type l | wc -l | tr -d ' ')"
check_eq "10.9A installed link count == manifest entries ($MANIFEST_COUNT)" "$MANIFEST_COUNT" "$INSTALLED_9"

# ---------------------------------------------------------------------------
say "== 10.10 Windows: structural parity checks (setup-windows.ps1) =="
PS_TXT="$(cat "$SETUP_PS1")"
case "$PS_TXT" in
  *"function Get-BundledSkills"*) pass "10.10A Get-BundledSkills present" ;;
  *) fail "10.10A Get-BundledSkills missing" ;;
esac
case "$PS_TXT" in
  *"'.claude-skill-backups'"*) pass "10.10B external backup path pattern present" ;;
  *) fail "10.10B backup path pattern missing" ;;
esac
case "$PS_TXT" in
  *"Get-Date -Format 'yyyyMMddTHHmmss'"*) pass "10.10C timestamp pattern present" ;;
  *) fail "10.10C timestamp pattern missing" ;;
esac
case "$PS_TXT" in
  *"Move-Item"*) pass "10.10D Move-Item backup present" ;;
  *) fail "10.10D Move-Item backup missing" ;;
esac
case "$PS_TXT" in
  *"New-Item -ItemType Junction"*) pass "10.10E junction creation present" ;;
  *) fail "10.10E junction creation missing" ;;
esac
case "$PS_TXT" in
  *"LinkType -eq 'Junction'"*) pass "10.10F junction detection present" ;;
  *) fail "10.10F junction detection missing" ;;
esac
case "$PS_TXT" in
  *"Remove-Item -LiteralPath \$dst -Force"*) pass "10.10G junction-only removal present" ;;
  *) fail "10.10G junction-only removal missing" ;;
esac
case "$PS_TXT" in
  *"skill up to date"*) pass "10.10H up-to-date path present" ;;
  *) fail "10.10H up-to-date path missing" ;;
esac
case "$PS_TXT" in
  *"skill ERROR"*) pass "10.10I per-skill error path present" ;;
  *) fail "10.10I per-skill error path missing" ;;
esac
case "$PS_TXT" in
  *"backup verification failed"*) pass "10.10J backup verification present" ;;
  *) fail "10.10J backup verification missing" ;;
esac
if command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -Command \
    "\$null = [System.Management.Automation.Language.Parser]::ParseFile('$SETUP_PS1', [ref]\$null, [ref]\$null); if (\$?) { exit 0 } else { exit 1 }" \
    >/dev/null 2>&1 \
    && pass "10.10K pwsh parse of setup-windows.ps1" \
    || fail "10.10K pwsh parse of setup-windows.ps1"
else
  say "  pwsh absent on this host - PS1 syntax parse deferred"
fi

# ---------------------------------------------------------------------------
say "== 10.11 KAIZEN_DOWNLOADS preserved through fixtures =="
KZ_11="$F1/home/KaizenDownloads"
mkdir -p "$KZ_11"
KAIZEN_DOWNLOADS="$KZ_11" HOME="$HOME_1" REPO_ROOT="$F1/repo" REPO_SKILL_DIR="$F1/repo/.claude/skills/nine-router-setup" \
  bash "$F1/wrapper.sh" link_skills_into_root "$ROOT_1" >/dev/null 2>&1
RC_11=$?
check_eq "10.11A link run with KAIZEN_DOWNLOADS set exits 0" "0" "$RC_11"
[ -d "$KZ_11" ] && pass "10.11B KAIZEN_DOWNLOADS dir untouched" || fail "10.11B KAIZEN_DOWNLOADS dir gone"

# ---------------------------------------------------------------------------
say "== 10.12 verify each installed SKILL.md exists (per-skill visibility) =="
VIS_12=""
for i in 1 2 3 4 5; do
  if [ -f "$HOME_1/.claude/skills/skill$i/SKILL.md" ]; then
    VIS_12="${VIS_12}OK "
  else
    VIS_12="${VIS_12}MISSING "
    fail "10.12 skill$i SKILL.md missing at destination"
  fi
done
check_eq "10.12 all five SKILL.md visible at dest" "OK OK OK OK OK " "$VIS_12"

# ---------------------------------------------------------------------------
say "== 10.13 direct link_one_skill calls (sourced-subfunction contract) =="
F13="$(mktemp -d)"
make_skel "$F13/repo"
make_wrapper "$F13/wrapper.sh"
HOME_13="$F13/home"
mkdir -p "$HOME_13/.claude/skills"
SRC_13="$(norm "$F13/repo/.claude/skills/skill1")"
DST_13="$HOME_13/.claude/skills/skill1"
# a) correct link already in place -> up to date, exit 0
ln -s "$SRC_13" "$DST_13"
ONE_OUT="$(
  HOME="$HOME_13" REPO_ROOT="$F13/repo" REPO_SKILL_DIR="$F13/repo/.claude/skills/nine-router-setup" \
    bash "$F13/wrapper.sh" link_one_skill "$SRC_13" "$DST_13" "skill1" 2>&1
)"
ONE_RC=$?
check_eq "10.13A direct up-to-date call exit 0" "0" "$ONE_RC"
case "$ONE_OUT" in
  *"skill up to date: skill1"*) pass "10.13A2 direct call reports up to date" ;;
  *) fail "10.13A2 direct call up-to-date message missing (got: $ONE_OUT)" ;;
esac
# b) stale link -> re-pointed, old target untouched, exit 0
rm -f "$DST_13"
mkdir -p "$F13/old"
printf 'OLD\n' > "$F13/old/SKILL.md"
ln -s "$(norm "$F13/old")" "$DST_13"
ONE_OUT2="$(
  HOME="$HOME_13" REPO_ROOT="$F13/repo" REPO_SKILL_DIR="$F13/repo/.claude/skills/nine-router-setup" \
    bash "$F13/wrapper.sh" link_one_skill "$SRC_13" "$DST_13" "skill1" 2>&1
)"
ONE_RC2=$?
check_eq "10.13B direct stale-link call exit 0" "0" "$ONE_RC2"
[ "$(norm "$DST_13")" = "$SRC_13" ] && pass "10.13B2 direct call re-pointed the link" \
  || fail "10.13B2 direct call did not re-point"
grep -q 'OLD' "$F13/old/SKILL.md" && pass "10.13B3 old target untouched" \
  || fail "10.13B3 old target touched"
# c) missing source -> SKILL.md assertion fails, exit 1
ONE_OUT3="$(
  HOME="$HOME_13" REPO_ROOT="$F13/repo" REPO_SKILL_DIR="$F13/repo/.claude/skills/nine-router-setup" \
    bash "$F13/wrapper.sh" link_one_skill "$F13/nosuch" "$DST_13" "skill1" 2>&1
)"
ONE_RC3=$?
check_eq "10.13C direct missing-source call exit 1" "1" "$ONE_RC3"
case "$ONE_OUT3" in
  *"skill ERROR: skill1"*) pass "10.13C2 missing source reports error" ;;
  *) fail "10.13C2 missing-source error missing (got: $ONE_OUT3)" ;;
esac

# ---------------------------------------------------------------------------
# Cleanup fixtures (never touches real state).
rm -rf "$TMP_HARNESS" "$F1" "$F3" "$F4" "$F5" "$F6" "$F7" "$F8" "$F9" "$F13"

say ""
say "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
