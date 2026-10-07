#!/usr/bin/env bash
# W3-03-U4: prove drama-song-ad-factory is registered in the registry the
# installer really reads, and that a CLEAN install lists/links the skill.
#
# Evidence, not source presence:
#   A. CONTROL/bundled-skills.txt (the registry both installers read) lists
#      drama-song-ad-factory — and every prior entry is still there.
#   B. The REAL bundled_skills() parse of that registry lists the skill.
#   C. A clean install (fresh fake HOME, real installer functions extracted
#      verbatim from setup-macos.sh) links the skill and reports it.
#   D. Negative control: same clean install against a manifest that omits the
#      skill does NOT link it — the registry drives the install, not the
#      source directory being on disk.
#
# stdlib/bash only; fixtures under /tmp (never the real $HOME, real repo is
# read-only here). Run: bash installer-registration/verify-registration.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SH="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
MANIFEST="$REPO_ROOT/CONTROL/bundled-skills.txt"
ENTRY_FILE="$REPO_ROOT/installer-registration/bundled-skills-entry.txt"
SKILL_NAME="drama-song-ad-factory"
PRIOR="nine-router-setup spec-protocol kaizen eli5 bro blackceo-signature-page hook-skill kiss motion-video-plus"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

# manifest_names <file> — same parse both installers apply (strip #, trim, drop blank).
manifest_names() {
  sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$1"
}

echo "== A. registry entry (CONTROL/bundled-skills.txt, read by both installers) =="
[ -f "$MANIFEST" ] && pass "registry file present: $MANIFEST" || fail "registry file missing: $MANIFEST"
if manifest_names "$MANIFEST" | grep -qx "$SKILL_NAME"; then
  pass "registry lists $SKILL_NAME"
else
  fail "registry does NOT list $SKILL_NAME"
fi
for s in $PRIOR; do
  manifest_names "$MANIFEST" | grep -qx "$s" && pass "prior entry retained: $s" \
    || fail "prior entry DROPPED: $s"
done

echo "== B. real bundled_skills() parse of the real registry =="
command -v mktemp >/dev/null 2>&1 || { echo "mktemp unavailable"; exit 2; }
BASE="${TMPDIR:-/tmp}/TrevelynsMini2-W3-03-U4-verify"
rm -rf "$BASE"; mkdir -p "$BASE"

# Extract the REAL installer skill-linking functions (bundled_skills() down to
# just before main()) — same technique as kaizen/tests/fix10-installer-tests.sh.
WRAPPER="$BASE/wrapper.sh"
{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n'
  awk '/^bundled_skills\(\) \{/ {f=1} /^main\(\) \{/ {exit} f {print}' "$SETUP_SH"
  printf '\n[ "${1:-}" != "" ] && "$@"\nexit 0\n'
} > "$WRAPPER"
bash -n "$SETUP_SH" && pass "setup-macos.sh parses" || fail "setup-macos.sh does not parse"
grep -q '^main()' "$WRAPPER" && fail "wrapper must not contain main()" \
  || pass "wrapper excludes main() (safe to dispatch)"

B_LIST="$(HOME="$BASE/home-b" REPO_ROOT="$REPO_ROOT" \
  REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" bundled_skills 2>&1)"
case "$B_LIST" in
  *"$SKILL_NAME"*) pass "bundled_skills() lists $SKILL_NAME" ;;
  *) fail "bundled_skills() does not list $SKILL_NAME (got: $B_LIST)" ;;
esac

echo "== C. clean install: fresh HOME, real installer links the skill =="
HOME_C="$BASE/home-c"; mkdir -p "$HOME_C"
OUT_C="$(HOME="$HOME_C" REPO_ROOT="$REPO_ROOT" \
  REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_C/.claude" 2>&1)"
RC_C=$?
[ "$RC_C" = "0" ] && pass "clean install exits 0" || fail "clean install exited $RC_C"
case "$OUT_C" in
  *"skill linked: $SKILL_NAME"*) pass "clean install reports linked: $SKILL_NAME" ;;
  *) fail "clean install did not report linking $SKILL_NAME" ;;
esac
[ -L "$HOME_C/.claude/skills/$SKILL_NAME" ] \
  && pass "clean install created skills/$SKILL_NAME link" \
  || fail "skills/$SKILL_NAME link absent after clean install"
[ -f "$HOME_C/.claude/skills/$SKILL_NAME/SKILL.md" ] \
  && pass "linked skill exposes SKILL.md (discoverable by both runtimes)" \
  || fail "linked skill has no SKILL.md"
[ -f "$HOME_C/.claude/skills/$SKILL_NAME/VERSION" ] \
  && pass "linked skill exposes VERSION" || fail "linked skill VERSION missing"

echo "== D. negative control: manifest WITHOUT the entry must not link it =="
SKEL="$BASE/skel-repo"
mkdir -p "$SKEL/CONTROL" "$SKEL/.claude/skills/nine-router-setup" \
  "$SKEL/.claude/skills/$SKILL_NAME"
printf -- '---\nname: %s\ndescription: fixture\n---\nSOURCE-PRESENT\n' "$SKILL_NAME" \
  > "$SKEL/.claude/skills/$SKILL_NAME/SKILL.md"
# Source IS present on disk; only the registry entry is withheld.
manifest_names "$MANIFEST" | grep -vx "$SKILL_NAME" > "$SKEL/CONTROL/bundled-skills.txt"
HOME_D="$BASE/home-d"; mkdir -p "$HOME_D"
OUT_D="$(HOME="$HOME_D" REPO_ROOT="$SKEL" \
  REPO_SKILL_DIR="$SKEL/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_D/.claude" 2>&1)"
[ ! -e "$HOME_D/.claude/skills/$SKILL_NAME" ] \
  && pass "without the registry entry the skill is NOT installed (source presence alone insufficient)" \
  || fail "skill installed despite missing registry entry — registry does not drive the install"

echo "== E. owned artifact carries the entry =="
if grep -qx "$SKILL_NAME" "$ENTRY_FILE" 2>/dev/null; then
  pass "installer-registration/bundled-skills-entry.txt carries '$SKILL_NAME'"
else
  fail "entry file missing or lacks '$SKILL_NAME'"
fi

rm -rf "$BASE"
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
