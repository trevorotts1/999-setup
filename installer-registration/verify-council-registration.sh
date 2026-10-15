#!/usr/bin/env bash
# CWE-040: prove council-of-wise-elders is registered in the registry the
# installers really read, and that a CLEAN install links it into both Mac
# config roots with the real installer functions.
#
# Evidence, not source presence (same method as verify-registration.sh):
#   A. CONTROL/bundled-skills.txt lists council-of-wise-elders EXACTLY ONCE,
#      every prior entry is retained, and every manifest entry has a skill
#      directory in this bundle.
#   B. The REAL bundled_skills() parse of that registry lists the council.
#   C. A clean install (fresh fake HOME, real installer functions extracted
#      verbatim from setup-macos.sh) links the council into a normal Claude
#      root AND a Claude-Nine root; both links resolve to the one vendored
#      source and expose the same distribution manifest identity.
#   D. Backup law (T113): a pre-existing REAL directory at the target is
#      moved to an external timestamped backup under
#      $HOME/.claude-skill-backups (never inside a config root), the backup
#      content is intact, and a repeat run creates no second backup and no
#      phantom registration.
#   E. Negative control: a manifest WITHOUT the council entry does not
#      link it, even though the source directory is on disk.
#
# stdlib/bash only; fixtures under ${TMPDIR:-/tmp} (never the real $HOME).
# Run: bash installer-registration/verify-council-registration.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SH="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
MANIFEST="$REPO_ROOT/CONTROL/bundled-skills.txt"
SKILL_NAME="council-of-wise-elders"
VENDORED="$REPO_ROOT/.claude/skills/$SKILL_NAME"
PRIOR="nine-router-setup spec-protocol kaizen eli5 bro blackceo-signature-page hook-skill kiss motion-video-plus drama-song-ad-factory drama-studio"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

manifest_names() {
  sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$1"
}

echo "== A. registry entry and bundle completeness =="
[ -f "$MANIFEST" ] && pass "registry file present" || fail "registry file missing: $MANIFEST"
COUNT="$(manifest_names "$MANIFEST" | grep -cx "$SKILL_NAME" || true)"
[ "$COUNT" = "1" ] && pass "registry lists $SKILL_NAME exactly once" \
  || fail "registry lists $SKILL_NAME $COUNT times (want exactly 1)"
for s in $PRIOR; do
  manifest_names "$MANIFEST" | grep -qx "$s" && pass "prior entry retained: $s" \
    || fail "prior entry DROPPED: $s"
done
for s in $(manifest_names "$MANIFEST"); do
  [ -f "$REPO_ROOT/.claude/skills/$s/SKILL.md" ] \
    && pass "manifest entry has a bundled skill directory: $s" \
    || fail "manifest entry has NO bundled skill directory: $s"
done
[ -f "$VENDORED/manifest.json" ] && pass "vendored council carries manifest.json" \
  || fail "vendored council manifest.json missing"
if sed -n '1,5p' "$VENDORED/SKILL.md" | grep -qx 'name: council-of-wise-elders'; then
  pass "vendored SKILL.md frontmatter name is council-of-wise-elders"
else
  fail "vendored SKILL.md frontmatter name is not council-of-wise-elders"
fi

echo "== B. real bundled_skills() parse of the real registry =="
command -v mktemp >/dev/null 2>&1 || { echo "mktemp unavailable"; exit 2; }
BASE="${TMPDIR:-/tmp}/cwe040-verify-council-registration"
rm -rf "$BASE"; mkdir -p "$BASE"
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
  *) fail "bundled_skills() does not list $SKILL_NAME" ;;
esac

echo "== C. clean install: both roots, one identity =="
HOME_C="$BASE/home-c"; mkdir -p "$HOME_C/.claude-nine"
printf '{ "fixture": "claude-nine root marker" }\n' > "$HOME_C/.claude-nine/settings.json"
OUT_C="$(HOME="$HOME_C" REPO_ROOT="$REPO_ROOT" \
  REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_C/.claude" 2>&1)"
RC_C=$?
[ "$RC_C" = "0" ] && pass "clean install (.claude) exits 0" || fail "clean install (.claude) exited $RC_C"
OUT_C9="$(HOME="$HOME_C" REPO_ROOT="$REPO_ROOT" \
  REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_C/.claude-nine" 2>&1)"
RC_C9=$?
[ "$RC_C9" = "0" ] && pass "clean install (.claude-nine) exits 0" || fail "clean install (.claude-nine) exited $RC_C9"
for root in ".claude" ".claude-nine"; do
  LINK="$HOME_C/$root/skills/$SKILL_NAME"
  [ -L "$LINK" ] && pass "$root: skills/$SKILL_NAME is a link" || fail "$root: skills/$SKILL_NAME is not a link"
  TARGET="$(cd "$LINK" 2>/dev/null && pwd -P || true)"
  [ "$TARGET" = "$(cd "$VENDORED" && pwd -P)" ] \
    && pass "$root: link resolves to the one vendored source" \
    || fail "$root: link resolves to $TARGET, not the vendored source"
  [ -f "$LINK/SKILL.md" ] && pass "$root: linked skill exposes SKILL.md" \
    || fail "$root: linked skill has no SKILL.md"
  # exactly one council entry in the root, no nested duplicate
  N="$(ls "$HOME_C/$root/skills" | grep -cx "$SKILL_NAME" || true)"
  [ "$N" = "1" ] && pass "$root: exactly one $SKILL_NAME entry" || fail "$root: $N council entries"
  [ ! -e "$LINK/$SKILL_NAME" ] && pass "$root: no nested $SKILL_NAME/$SKILL_NAME" \
    || fail "$root: nested council directory exists"
done
AGG_CLAUDE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$HOME_C/.claude/skills/$SKILL_NAME/manifest.json" 2>/dev/null || true)"
AGG_NINE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$HOME_C/.claude-nine/skills/$SKILL_NAME/manifest.json" 2>/dev/null || true)"
AGG_VENDORED="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$VENDORED/manifest.json" 2>/dev/null || true)"
[ -n "$AGG_CLAUDE" ] && [ "$AGG_CLAUDE" = "$AGG_NINE" ] && [ "$AGG_CLAUDE" = "$AGG_VENDORED" ] \
  && pass "both roots expose the same canonical identity (aggregate $AGG_CLAUDE)" \
  || fail "identity mismatch: claude=$AGG_CLAUDE nine=$AGG_NINE vendored=$AGG_VENDORED"

echo "== D. update path: real directory backed up outside the roots (T113) =="
HOME_D="$BASE/home-d"; mkdir -p "$HOME_D/.claude/skills/$SKILL_NAME"
printf 'STALE FIXTURE SKILL\n' > "$HOME_D/.claude/skills/$SKILL_NAME/SKILL.md"
OUT_D="$(HOME="$HOME_D" REPO_ROOT="$REPO_ROOT" \
  REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_D/.claude" 2>&1)"
[ -L "$HOME_D/.claude/skills/$SKILL_NAME" ] && pass "stale real directory replaced by the link" \
  || fail "stale real directory was not replaced by a link"
BACKUPS="$(ls -d "$HOME_D/.claude-skill-backups/$SKILL_NAME."* 2>/dev/null | wc -l | tr -d ' ')"
[ "$BACKUPS" = "1" ] && pass "exactly one external backup created" \
  || fail "expected 1 external backup, found $BACKUPS"
BACKUP_DIR="$(ls -d "$HOME_D/.claude-skill-backups/$SKILL_NAME."* 2>/dev/null | head -1)"
[ -f "$BACKUP_DIR/SKILL.md" ] && grep -q 'STALE FIXTURE SKILL' "$BACKUP_DIR/SKILL.md" \
  && pass "backup content intact (the stale tree survives in the backup)" \
  || fail "backup content missing or altered"
case "$BACKUP_DIR" in
  "$HOME_D/.claude"|"$HOME_D/.claude/"*|"$HOME_D/.claude-nine"|"$HOME_D/.claude-nine/"*)
    fail "backup landed INSIDE a config root: $BACKUP_DIR" ;;
  *) pass "backup is outside every config root: $BACKUP_DIR" ;;
esac
# Repeat run: converged link, no second backup, no phantom.
OUT_D2="$(HOME="$HOME_D" REPO_ROOT="$REPO_ROOT" \
  REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_D/.claude" 2>&1)"
BACKUPS2="$(ls -d "$HOME_D/.claude-skill-backups/$SKILL_NAME."* 2>/dev/null | wc -l | tr -d ' ')"
[ "$BACKUPS2" = "1" ] && pass "repeat run creates no second backup" \
  || fail "repeat run created $BACKUPS2 backups (want 1)"
N_D="$(ls "$HOME_D/.claude/skills" | grep -cx "$SKILL_NAME" || true)"
[ "$N_D" = "1" ] && pass "repeat run leaves exactly one council registration" \
  || fail "repeat run left $N_D council registrations"

echo "== E. negative control: manifest WITHOUT the entry must not link it =="
SKEL="$BASE/skel-repo"
mkdir -p "$SKEL/CONTROL" "$SKEL/.claude/skills/nine-router-setup"
cp -R "$VENDORED" "$SKEL/.claude/skills/$SKILL_NAME"
manifest_names "$MANIFEST" | grep -vx "$SKILL_NAME" > "$SKEL/CONTROL/bundled-skills.txt"
HOME_E="$BASE/home-e"; mkdir -p "$HOME_E"
OUT_E="$(HOME="$HOME_E" REPO_ROOT="$SKEL" \
  REPO_SKILL_DIR="$SKEL/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$HOME_E/.claude" 2>&1)"
[ ! -e "$HOME_E/.claude/skills/$SKILL_NAME" ] \
  && pass "without the registry entry the council is NOT installed (registry drives the install)" \
  || fail "council installed despite missing registry entry"

rm -rf "$BASE"
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
