#!/bin/bash
# CWE-040: platform installation battery for council-of-wise-elders,
# fixture roots only (Section 25.5 edge tests, T112/T113/T128 legs).
#
# Legs:
#   1. Fresh dual-root link with the REAL installer functions; settings
#      and unrelated content byte-identical afterwards (T112 Mac leg,
#      launcher preservation).
#   2. sync-nine-skills.sh mirrors the council into the nine root.
#   3. Runtime install: versioned prefix outside every root, node
#      modules only inside the prefix, generated wrapper byte-identical
#      to a fresh render of the CWE-010 template, current swap, the
#      blackceo-council executable (T112/T128).
#   4. CLI through the installed executable: doctor, the full Section
#      25.3 command inventory, clean --json output, the golden sample
#      (A 6.0, B 7.6, C 6.6), council state in the data profile only.
#   5. Update path against a stale real directory: external backup,
#      converged link, idempotent runtime reinstall.
#   6. Custom config root and paths with spaces.
#   7. Offline install: warm cache succeeds; cold cache refuses with
#      COUNCIL_NPM_OFFLINE_CACHE_MISS and leaves no current.
#   8. Native dependency errors: broken node and failing npm surface as
#      named errors, never a partial install.
#
# Everything runs under a fixture HOME in ${TMPDIR:-/tmp}.
# Run: bash scripts/test-council-install.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SH="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
INSTALL_SH="$REPO_ROOT/scripts/council-runtime-install.sh"
SYNC_SH="$REPO_ROOT/scripts/sync-nine-skills.sh"
SKILL_NAME="council-of-wise-elders"
VENDORED="$REPO_ROOT/.claude/skills/$SKILL_NAME"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

BASE="${TMPDIR:-/tmp}/cwe040-install-battery"
rm -rf "$BASE"; mkdir -p "$BASE"
export npm_config_cache="$BASE/npm-cache"
AGG="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$VENDORED/manifest.json")"
[ -n "$AGG" ] && pass "vendored aggregate read: $AGG" || { echo "FAIL: cannot read vendored manifest"; exit 1; }

# Real installer functions, extracted verbatim (verify-registration method).
WRAPPER="$BASE/wrapper.sh"
{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n'
  awk '/^bundled_skills\(\) \{/ {f=1} /^main\(\) \{/ {exit} f {print}' "$SETUP_SH"
  printf '\n[ "${1:-}" != "" ] && "$@"\nexit 0\n'
} > "$WRAPPER"

link_root() { # $1 HOME, $2 root
  HOME="$1" REPO_ROOT="$REPO_ROOT" \
  REPO_SKILL_DIR="$REPO_ROOT/.claude/skills/nine-router-setup" \
  bash "$WRAPPER" link_skills_into_root "$2" >/dev/null 2>&1
}

echo "== 1. fresh dual-root link; preservation =="
H1="$BASE/home1"; mkdir -p "$H1/.claude/skills/sentinel-skill" "$H1/.claude-nine" "$H1/.local/bin"
printf -- '---\nname: sentinel-skill\n---\nSENTINEL\n' > "$H1/.claude/skills/sentinel-skill/SKILL.md"
printf '{ "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:20128/v1" }, "model": "fixture-pinned" }\n' \
  > "$H1/.claude-nine/settings.json"
printf '#!/bin/sh\n# fixture claude-nine launcher\n' > "$H1/.local/bin/claude-nine"
chmod 755 "$H1/.local/bin/claude-nine"
SETTINGS_HASH_BEFORE="$(sha256sum "$H1/.claude-nine/settings.json" | cut -d' ' -f1)"
NINE_HASH_BEFORE="$(sha256sum "$H1/.local/bin/claude-nine" | cut -d' ' -f1)"
SENTINEL_HASH_BEFORE="$(sha256sum "$H1/.claude/skills/sentinel-skill/SKILL.md" | cut -d' ' -f1)"
link_root "$H1" "$H1/.claude"; RC1=$?
link_root "$H1" "$H1/.claude-nine"; RC2=$?
[ "$RC1" = 0 ] && [ "$RC2" = 0 ] && pass "real linker exits 0 for both roots" \
  || fail "linker exits: claude=$RC1 nine=$RC2"
for root in ".claude" ".claude-nine"; do
  [ -L "$H1/$root/skills/$SKILL_NAME" ] && pass "$root: council linked" \
    || fail "$root: council link missing"
done
AGG_1="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$H1/.claude/skills/$SKILL_NAME/manifest.json")"
AGG_2="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$H1/.claude-nine/skills/$SKILL_NAME/manifest.json")"
[ "$AGG_1" = "$AGG" ] && [ "$AGG_2" = "$AGG" ] \
  && pass "both roots expose the vendored identity $AGG" \
  || fail "identity mismatch: claude=$AGG_1 nine=$AGG_2 vendored=$AGG"
[ "$(sha256sum "$H1/.claude-nine/settings.json" | cut -d' ' -f1)" = "$SETTINGS_HASH_BEFORE" ] \
  && pass "claude-nine settings.json byte-identical (routing unchanged)" \
  || fail "claude-nine settings.json changed"
[ ! -e "$H1/.claude/settings.json" ] && pass "no settings.json created in the normal Claude root" \
  || fail "a settings.json appeared in the normal Claude root"
[ "$(sha256sum "$H1/.claude/skills/sentinel-skill/SKILL.md" | cut -d' ' -f1)" = "$SENTINEL_HASH_BEFORE" ] \
  && pass "unrelated skill content untouched" || fail "unrelated skill content changed"

echo "== 2. sync-nine-skills.sh mirrors the council =="
rm -f "$H1/.claude-nine/skills/$SKILL_NAME"
cp "$SYNC_SH" "$H1/.local/bin/sync-nine-skills.sh"; chmod 755 "$H1/.local/bin/sync-nine-skills.sh"
HOME="$H1" bash "$H1/.local/bin/sync-nine-skills.sh" --quiet >/dev/null 2>&1
[ -L "$H1/.claude-nine/skills/$SKILL_NAME" ] \
  && pass "sync re-links the council into the nine root" \
  || fail "sync did not re-link the council into the nine root"

echo "== 3. runtime install: prefix, wrapper, current, executable =="
DATA1="$H1/.local/share/blackceo/wise-elders"
HOME="$H1" bash "$INSTALL_SH" > "$BASE/install1.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "runtime install exits 0" || { fail "runtime install exited $RC"; tail -5 "$BASE/install1.log"; }
PREFIX1="$DATA1/runtime/$AGG"
[ -f "$PREFIX1/.install-complete" ] && pass "versioned prefix installed at runtime/$AGG" \
  || fail "prefix missing: $PREFIX1"
[ -L "$DATA1/runtime/current" ] && [ "$(readlink "$DATA1/runtime/current")" = "$AGG" ] \
  && pass "current points at the installed aggregate" || fail "current link wrong"
[ -d "$PREFIX1/runtime/node_modules" ] && pass "node modules exist inside the prefix" \
  || fail "node modules missing inside the prefix"
[ -f "$PREFIX1/runtime/dist/migrations/0001-council-schema.sql" ] \
  && pass "built prefix carries the persistence schema asset (CWE-039 F-1 layout: dist/migrations)" \
  || fail "prefix dist/migrations/0001-council-schema.sql missing"
[ ! -e "$VENDORED/runtime/node_modules" ] && [ ! -e "$VENDORED/runtime/dist" ] \
  && pass "no node modules or dist in the synchronized skill folder" \
  || fail "build content leaked into the skill folder"
WRAP="$PREFIX1/runtime/dist/claude-nine-host-wrapper.mjs"
[ -f "$WRAP" ] && pass "generated host wrapper emitted into the prefix dist" \
  || fail "generated host wrapper missing"
RENDER="$BASE/wrapper-rerender.mjs"
EMIT="$BASE/emit-wrapper.mts"
printf '%s\n' "import { renderClaudeNineWrapper } from \"$PREFIX1/runtime/src/bridges/claude-nine.ts\";" \
  'process.stdout.write(renderClaudeNineWrapper());' > "$EMIT"
"$PREFIX1/runtime/node_modules/.bin/tsx" "$EMIT" > "$RENDER" 2>/dev/null
cmp -s "$WRAP" "$RENDER" && pass "emitted wrapper is byte-identical to the CWE-010 template render" \
  || fail "emitted wrapper differs from the CWE-010 template render"
[ -x "$H1/.local/bin/blackceo-council" ] && grep -q 'blackceo-council (CWE-040)' "$H1/.local/bin/blackceo-council" \
  && pass "blackceo-council executable installed" || fail "executable missing or foreign"
HOME="$H1" bash "$INSTALL_SH" --check > "$BASE/check1.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "install --check passes after install" || fail "install --check exited $RC"

echo "== 4. CLI through the installed executable =="
COUNCIL() { HOME="$H1" "$H1/.local/bin/blackceo-council" "$@"; }
COUNCIL doctor > "$BASE/cli-doctor.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "blackceo-council doctor exits 0" || { fail "doctor exited $RC"; tail -3 "$BASE/cli-doctor.log"; }
USAGE_OUT="$(COUNCIL 2>&1)"
for sig in 'doctor' 'models' 'probe' 'create --spec' 'create --sample' 'sample run' \
  'start SESSION' 'resume SESSION' 'status SESSION' 'pause SESSION' 'cancel SESSION' \
  'verdict SESSION' 'replay SESSION' 'export SESSION' \
  'authorization preview|approve|status|revoke'; do
  case "$USAGE_OUT" in *"$sig"*) pass "CLI inventory includes: $sig" ;;
    *) fail "CLI inventory missing: $sig" ;; esac
done
JSON_OUT="$(COUNCIL doctor --json 2>/dev/null)"
printf '%s' "$JSON_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.exit(j.ok===true?0:1)})' \
  && pass "doctor --json is clean machine JSON with ok=true" \
  || fail "doctor --json is not clean JSON with ok=true"
SCRATCH="$BASE/scratch-data"
SAMPLE_OUT="$(BLACKCEO_COUNCIL_DATA_DIR="$SCRATCH" COUNCIL sample run 2>&1)"
case "$SAMPLE_OUT" in *"SAMPLE"*) pass "sample run is labeled SAMPLE" ;; *) fail "sample run lacks the SAMPLE label" ;; esac
for v in '6.0' '7.6' '6.6'; do
  case "$SAMPLE_OUT" in *"$v"*) pass "golden sample value present: $v" ;;
    *) fail "golden sample value missing: $v" ;; esac
done
if find "$SCRATCH" -maxdepth 2 -name '*.db' -o -maxdepth 2 -name '*.sqlite*' | grep -q .; then
  pass "council state was created inside the data profile"
else
  fail "no council state file appeared in the data profile"
fi
if find "$VENDORED" -name '*.db' -o -name '*.sqlite*' | grep -q .; then
  fail "council state appeared inside the skill folder"
else
  pass "no council state inside the skill folder"
fi
COUNCIL doctor --data-dir "$VENDORED/state" > "$BASE/guard.log" 2>&1; RC=$?
[ "$RC" != 0 ] && grep -q 'inside the skill folder' "$BASE/guard.log" \
  && pass "a data directory inside the skill folder is refused (Section 16.1 guard)" \
  || fail "data directory inside the skill folder was not refused (rc=$RC)"
[ ! -e "$VENDORED/state" ] && pass "the refused data directory was never created" \
  || fail "the refused data directory was created inside the skill folder"

echo "== 5. update path: stale real directory, external backup, idempotence =="
H2="$BASE/home2"; mkdir -p "$H2/.claude/skills/$SKILL_NAME"
printf 'STALE\n' > "$H2/.claude/skills/$SKILL_NAME/SKILL.md"
link_root "$H2" "$H2/.claude"
[ -L "$H2/.claude/skills/$SKILL_NAME" ] && pass "stale directory converged to the link" \
  || fail "stale directory was not converged"
BK="$(ls -d "$H2/.claude-skill-backups/$SKILL_NAME."* 2>/dev/null | head -1)"
[ -n "$BK" ] && grep -q 'STALE' "$BK/SKILL.md" && pass "stale tree preserved in the external backup" \
  || fail "external backup missing or content lost"
HOME="$H2" bash "$INSTALL_SH" > "$BASE/install2.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "runtime install on the updated root exits 0" \
  || { fail "runtime install on the updated root exited $RC"; tail -3 "$BASE/install2.log"; }
HOME="$H2" bash "$INSTALL_SH" > "$BASE/install2b.log" 2>&1; RC=$?
[ "$RC" = 0 ] && grep -q 'already installed and gated' "$BASE/install2b.log" \
  && pass "repeat runtime install reuses the gated prefix (idempotent)" \
  || fail "repeat runtime install was not an idempotent reuse (rc=$RC)"

echo "== 6. custom root and paths with spaces =="
H3="$BASE/home with spaces"; mkdir -p "$H3"
CUSTOM="$H3/custom config root"
link_root "$H3" "$CUSTOM"
[ -L "$CUSTOM/skills/$SKILL_NAME" ] && pass "custom root with spaces linked" \
  || fail "custom root with spaces was not linked"
HOME="$H3" bash "$INSTALL_SH" --skill-dir "$CUSTOM/skills/$SKILL_NAME" \
  --data-dir "$H3/data profile" --bin-dir "$H3/bin dir" > "$BASE/install3.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "runtime install with spaced paths exits 0" \
  || { fail "runtime install with spaced paths exited $RC"; tail -3 "$BASE/install3.log"; }
HOME="$H3" BLACKCEO_COUNCIL_DATA_DIR="$H3/data profile" "$H3/bin dir/blackceo-council" doctor \
  > "$BASE/cli-doctor3.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "executable in a spaced path runs doctor" || fail "spaced-path doctor exited $RC"

echo "== 7. offline installs =="
H4="$BASE/home4"; mkdir -p "$H4/.claude"
link_root "$H4" "$H4/.claude"
HOME="$H4" bash "$INSTALL_SH" --offline > "$BASE/install4.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "offline install succeeds with a warm npm cache" \
  || { fail "offline install with warm cache exited $RC"; tail -3 "$BASE/install4.log"; }
H5="$BASE/home5"; mkdir -p "$H5/.claude"
link_root "$H5" "$H5/.claude"
HOME="$H5" npm_config_cache="$BASE/cold-cache" bash "$INSTALL_SH" --offline \
  --data-dir "$H5/data" > "$BASE/install5.log" 2>&1; RC=$?
[ "$RC" = 5 ] && grep -q 'COUNCIL_NPM_OFFLINE_CACHE_MISS' "$BASE/install5.log" \
  && pass "cold-cache offline install refuses with COUNCIL_NPM_OFFLINE_CACHE_MISS" \
  || fail "cold-cache offline install: rc=$RC (want 5 with the named error)"
[ ! -e "$H5/data/runtime/current" ] && pass "refused offline install leaves no current" \
  || fail "refused offline install left a current link"

echo "== 8. native dependency errors =="
STUB="$BASE/stubbin"; mkdir -p "$STUB"
printf '#!/bin/sh\nexit 1\n' > "$STUB/node"; chmod 755 "$STUB/node"
H6="$BASE/home6"; mkdir -p "$H6/.claude"
link_root "$H6" "$H6/.claude"
HOME="$H6" PATH="$STUB:/usr/bin:/bin" bash "$INSTALL_SH" > "$BASE/install6.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_NODE_MISSING' "$BASE/install6.log" \
  && pass "broken node surfaces as COUNCIL_NODE_MISSING (exit 4)" \
  || fail "broken node: rc=$RC (want 4 with COUNCIL_NODE_MISSING)"
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 10.0.0; exit 0; fi\nexit 1\n' > "$STUB/npm"
chmod 755 "$STUB/npm"; rm -f "$STUB/node"
H7="$BASE/home7"; mkdir -p "$H7/.claude"
link_root "$H7" "$H7/.claude"
HOME="$H7" PATH="$STUB:$PATH" bash "$INSTALL_SH" > "$BASE/install7.log" 2>&1; RC=$?
[ "$RC" = 5 ] && grep -q 'COUNCIL_NPM_CI_FAILED' "$BASE/install7.log" \
  && pass "failing npm ci surfaces as COUNCIL_NPM_CI_FAILED (exit 5)" \
  || fail "failing npm: rc=$RC (want 5 with COUNCIL_NPM_CI_FAILED)"
[ ! -e "$H7/.local/share/blackceo/wise-elders/runtime/current" ] \
  && pass "failed dependency install leaves no current" \
  || fail "failed dependency install left a current link"

echo "== preservation, after everything =="
[ "$(sha256sum "$H1/.claude-nine/settings.json" | cut -d' ' -f1)" = "$SETTINGS_HASH_BEFORE" ] \
  && pass "claude-nine settings.json still byte-identical" || fail "claude-nine settings.json changed"
[ "$(sha256sum "$H1/.local/bin/claude-nine" | cut -d' ' -f1)" = "$NINE_HASH_BEFORE" ] \
  && pass "existing claude-nine launcher byte-identical (preserved)" \
  || fail "existing claude-nine launcher changed"

rm -rf "$BASE"
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
