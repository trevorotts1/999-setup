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
#   Plus W1-claude-skill-U5: the same battery for drama-studio — registry line,
#   bundled_skills() parse, clean-install link (SKILL.md frontmatter name and
#   studio.py, what AGENT_INSTALL step 5.4 runs), and the withheld-registry
#   negative control.
#
# stdlib/bash only; fixtures under /tmp (never the real $HOME, real repo is
# read-only here). Run: bash installer-registration/verify-registration.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SH="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
MANIFEST="$REPO_ROOT/CONTROL/bundled-skills.txt"
ENTRY_FILE="$REPO_ROOT/installer-registration/bundled-skills-entry.txt"
SKILL_NAME="drama-song-ad-factory"
STUDIO="drama-studio"
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
if manifest_names "$MANIFEST" | grep -qx "$STUDIO"; then
  pass "registry lists $STUDIO"
else
  fail "registry does NOT list $STUDIO"
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
case "$B_LIST" in
  *"$STUDIO"*) pass "bundled_skills() lists $STUDIO" ;;
  *) fail "bundled_skills() does not list $STUDIO (got: $B_LIST)" ;;
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

# Same battery for drama-studio (W1-claude-skill-U5): registry-driven, in the
# same clean install.
[ -L "$HOME_C/.claude/skills/$STUDIO" ] \
  && pass "clean install created skills/$STUDIO link" \
  || fail "skills/$STUDIO link absent after clean install"
STUDIO_MD="$HOME_C/.claude/skills/$STUDIO/SKILL.md"
if [ -f "$STUDIO_MD" ] && grep -q "name:[[:space:]]*$STUDIO" "$STUDIO_MD"; then
  pass "linked $STUDIO exposes SKILL.md with frontmatter name $STUDIO"
else
  fail "linked $STUDIO has no SKILL.md named $STUDIO (got: ${STUDIO_MD:-absent})"
fi
[ -f "$HOME_C/.claude/skills/$STUDIO/studio.py" ] \
  && pass "linked $STUDIO exposes studio.py (the pair/link command AGENT_INSTALL step 5.4 runs)" \
  || fail "linked $STUDIO has no studio.py — the pairing step cannot run"

echo "== D. negative control: manifest WITHOUT the entry must not link it =="
SKEL="$BASE/skel-repo"
mkdir -p "$SKEL/CONTROL" "$SKEL/.claude/skills/nine-router-setup" \
  "$SKEL/.claude/skills/$SKILL_NAME"
printf -- '---\nname: %s\ndescription: fixture\n---\nSOURCE-PRESENT\n' "$SKILL_NAME" \
  > "$SKEL/.claude/skills/$SKILL_NAME/SKILL.md"
# Source IS present on disk; only the registry entry is withheld.
manifest_names "$MANIFEST" | grep -vx "$SKILL_NAME" | grep -vx "$STUDIO" > "$SKEL/CONTROL/bundled-skills.txt"
HOME_D="$BASE/home-d"; mkdir -p "$HOME_D"
OUT_D="$(HOME="$HOME_D" REPO_ROOT="$SKEL" \
  REPO_SKILL_DIR="$SKEL/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_D/.claude" 2>&1)"
[ ! -e "$HOME_D/.claude/skills/$SKILL_NAME" ] \
  && pass "without the registry entry the skill is NOT installed (source presence alone insufficient)" \
  || fail "skill installed despite missing registry entry — registry does not drive the install"
[ ! -e "$HOME_D/.claude/skills/$STUDIO" ] \
  && pass "without the registry entry $STUDIO is NOT installed either" \
  || fail "$STUDIO installed despite missing registry entry — registry does not drive the install"

echo "== E. owned artifact carries the entry =="
if grep -qx "$SKILL_NAME" "$ENTRY_FILE" 2>/dev/null; then
  pass "installer-registration/bundled-skills-entry.txt carries '$SKILL_NAME'"
else
  fail "entry file missing or lacks '$SKILL_NAME'"
fi

echo "== F. bare-slug skill registers and links (black-friday-launcher) =="
# 999 names skills by bare slug (the Launcher is
# .claude/skills/black-friday-launcher, not 83-black-friday-launcher). The
# registration check must accept that convention, and the real installer
# (setup-macos.sh, driven by CONTROL/bundled-skills.txt) must link it. Both
# are asserted here; the directory is NOT renamed.
LAUNCHER="black-friday-launcher"
LAUNCHER_TREE="$REPO_ROOT/.claude/skills/$LAUNCHER"
FRONT_NAME="$(awk '
  NR == 1 { if ($0 != "---") exit; next }
  $0 == "---" { exit }
  /^name:/ { sub(/^name:[ \t]*/, ""); print; exit }
' "$LAUNCHER_TREE/SKILL.md" 2>/dev/null)"
[ "$FRONT_NAME" = "$LAUNCHER" ] \
  && pass "bare-slug tree exposes SKILL.md frontmatter name $LAUNCHER" \
  || fail "bare-slug tree frontmatter name is '${FRONT_NAME:-absent}', expected $LAUNCHER"
manifest_names "$MANIFEST" | grep -qx "$LAUNCHER" \
  && pass "registry lists bare slug $LAUNCHER" \
  || fail "registry does not list bare slug $LAUNCHER"

HOME_F="$BASE/home-f"; mkdir -p "$HOME_F"
OUT_F="$(HOME="$HOME_F" REPO_ROOT="$REPO_ROOT" \
  REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_F/.claude" 2>&1)"
RC_F=$?
[ "$RC_F" = "0" ] && pass "clean install with bare-slug skill exits 0" \
  || fail "clean install with bare-slug skill exited $RC_F"
case "$OUT_F" in
  *"skill linked: $LAUNCHER"*) pass "real installer links bare-slug $LAUNCHER" ;;
  *) fail "real installer did not link bare-slug $LAUNCHER (got: $OUT_F)" ;;
esac
[ -L "$HOME_F/.claude/skills/$LAUNCHER" ] \
  && pass "clean install created skills/$LAUNCHER link" \
  || fail "skills/$LAUNCHER link absent after clean install"

# The Launcher's own registration check reads the SKILL.md frontmatter and must
# agree: a matching bare slug passes, a mismatched one fails closed.
REG_STATUS="$(cd "$LAUNCHER_TREE" && python3 - "$REPO_ROOT" <<'PY'
import sys
from pathlib import Path
from launcher_core import dependencies

skill_md = dependencies.resolve_ref(
    "83-black-friday-launcher/SKILL.md", Path(sys.argv[1]))
print("present" if dependencies.installer_registration_status(skill_md)["ok"]
      else "missing")
PY
)"
[ "$REG_STATUS" = "present" ] \
  && pass "launcher registration check accepts the bare slug in this repo" \
  || fail "launcher registration check rejected the bare slug (got '${REG_STATUS:-empty}')"

SKEL_F="$BASE/skel-bare"
mkdir -p "$SKEL_F/.claude/skills/$LAUNCHER"
printf -- '---\nname: some-other-skill\ndescription: fixture\n---\n' \
  > "$SKEL_F/.claude/skills/$LAUNCHER/SKILL.md"
REG_NEG="$(cd "$LAUNCHER_TREE" && python3 - "$SKEL_F" <<'PY'
import sys
from pathlib import Path
from launcher_core import dependencies

skill_md = dependencies.resolve_ref(
    "83-black-friday-launcher/SKILL.md", Path(sys.argv[1]))
print("present" if dependencies.installer_registration_status(skill_md)["ok"]
      else "missing")
PY
)"
[ "$REG_NEG" = "missing" ] \
  && pass "launcher registration check rejects a bare slug whose frontmatter name differs" \
  || fail "launcher registration check accepted a mismatched frontmatter name (got '${REG_NEG:-empty}')"

rm -rf "$BASE"
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
