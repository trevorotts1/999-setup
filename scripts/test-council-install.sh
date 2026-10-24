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
#   7. Offline install: warm cache succeeds (including a spaced cache
#      path), cold cache refuses with COUNCIL_NPM_OFFLINE_CACHE_MISS and
#      leaves no current.
#   8. Native dependency errors: broken node and failing npm surface as
#      named errors, never a partial install.
#   9. WER-004 prerequisite probe: a resolved Node that fails the canonical
#      probe refuses with COUNCIL_NODE_PREREQ_FAILED and leaves the
#      previous release current, complete and gated.
#  10. WER-004 source identity: a hand-edited copy of the portable source
#      refuses with COUNCIL_SOURCE_INTEGRITY_FAILED and writes nothing.
#  11. WER-004 PowerShell path: a source path with spaces and non-ASCII
#      characters resolves through the PowerShell installer path. Runs
#      when pwsh is present; otherwise reported SKIP (native Windows host
#      execution is deferred to WER-027, never claimed as a pass).
#  12. Doctor mode derivation: the vendored tree derives distribution at
#      both installer call sites, never a hardcoded mode.
#  13. Doctor mode battery (scripts/test-council-doctor-mode.sh): the
#      canonical source still passes source mode with the archive binding,
#      and a masked distribution is refused.
#  14. --refresh-record reconciliation: the record is rewritten to the
#      given source, a second run is a byte-identical no-op, a wrong
#      recorded aggregate refuses without --source-dir (and reconciles
#      with one), the bare flag refuses without --skill-dir, and a failed
#      integrity check leaves the record untouched. Nondestructive: the
#      runtime, .install-complete, current and the executable are never
#      touched.
#
# Everything runs under a fixture HOME in ${TMPDIR:-/tmp}.
# Run: bash scripts/test-council-install.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The fixture HOMEs below define the discovery roots; an inherited
# CLAUDE_CONFIG_DIR would silently redirect discovery at the operator's
# live install and make this battery non-reproducible. The same rule
# governs the source resolver: an inherited COUNCIL_CANONICAL_SOURCE
# would redirect SOURCE_DIR away from the fixtures.
unset CLAUDE_CONFIG_DIR COUNCIL_CANONICAL_SOURCE
SETUP_SH="$REPO_ROOT/.claude/skills/nine-router-setup/scripts/setup-macos.sh"
INSTALL_SH="$REPO_ROOT/scripts/council-runtime-install.sh"
INSTALL_PS1="$REPO_ROOT/scripts/council-runtime-install.ps1"
PREFLIGHT="$REPO_ROOT/scripts/council-runtime-preflight.mjs"
SYNC_SH="$REPO_ROOT/scripts/sync-nine-skills.sh"
SKILL_NAME="council-of-wise-elders"
VENDORED="$REPO_ROOT/.claude/skills/$SKILL_NAME"

PASS=0; FAIL=0; SKIP=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
skip() { SKIP=$((SKIP + 1)); echo "  SKIP: $1"; }

# Unique per-invocation fixture root so concurrent runs never share state.
BASE="$(mktemp -d "${TMPDIR:-/tmp}/cwe040-install-battery.XXXXXX")" || { echo "FAIL: cannot create fixture dir"; exit 1; }
trap 'rm -rf "$BASE"' EXIT
trap 'exit 1' INT TERM HUP
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
HOME="$H1" bash "$INSTALL_SH" --data-dir "$DATA1" > "$BASE/install1.log" 2>&1; RC=$?
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
[ ! -e "$VENDORED/runtime/node_modules" ] && [ -f "$VENDORED/runtime/dist/blackceo-council.mjs" ] \
  && pass "skill folder ships the built entry and no node modules" \
  || fail "skill folder missing runtime/dist/blackceo-council.mjs or carrying node_modules"
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
HOME="$H1" bash "$INSTALL_SH" --data-dir "$DATA1" --check > "$BASE/check1.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "install --check passes after install" || fail "install --check exited $RC"

echo "== 4. CLI through the installed executable =="
COUNCIL() { HOME="$H1" "$H1/.local/bin/blackceo-council" "$@"; }
COUNCIL doctor > "$BASE/cli-doctor.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "blackceo-council doctor exits 0" || { fail "doctor exited $RC"; tail -3 "$BASE/cli-doctor.log"; }
USAGE_OUT="$(COUNCIL 2>&1)"
# The entry contract, not the legacy grant surface: v1.0.51 convening is
# the approval (no grant to resolve, no approval step), so `start`,
# `resume` and the `authorization` workflow are gone by design and the
# inventory below is what the shipped CLI must expose.
for sig in 'doctor' 'models' 'probe' 'create --spec' 'create --sample' 'sample run' \
  'status SESSION' 'pause SESSION' 'cancel SESSION' \
  'verdict SESSION' 'replay SESSION' 'export SESSION' \
  'routes' 'convene'; do
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
# Regression: the npm cache must reach npm as ONE argument. $NPM_FLAGS is
# expanded unquoted, so a cache path with spaces used to split into garbage
# --cache values and every offline install died on a cache miss.
H5B="$BASE/home5b"; mkdir -p "$H5B/.claude"
link_root "$H5B" "$H5B/.claude"
cp -R "$BASE/npm-cache" "$BASE/npm cache"
HOME="$H5B" npm_config_cache="$BASE/npm cache" bash "$INSTALL_SH" --offline \
  --data-dir "$H5B/data" > "$BASE/install5b.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "offline install succeeds with a spaced npm cache path" \
  || { fail "spaced-cache offline install exited $RC"; tail -3 "$BASE/install5b.log"; }

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
HOME="$H7" PATH="$STUB:$PATH" bash "$INSTALL_SH" --data-dir "$H7/data" > "$BASE/install7.log" 2>&1; RC=$?
[ "$RC" = 5 ] && grep -q 'COUNCIL_NPM_CI_FAILED' "$BASE/install7.log" \
  && pass "failing npm ci surfaces as COUNCIL_NPM_CI_FAILED (exit 5)" \
  || fail "failing npm: rc=$RC (want 5 with COUNCIL_NPM_CI_FAILED)"
[ ! -e "$H7/data/runtime/current" ] \
  && pass "failed dependency install leaves no current" \
  || fail "failed dependency install left a current link"

echo "== 9. WER-004 prerequisite failure preserves the previous release =="
[ -f "$PREFLIGHT" ] && pass "shared prerequisite probe exists" \
  || fail "shared prerequisite probe missing: $PREFLIGHT"
H8="$BASE/home8"; mkdir -p "$H8/.claude"
link_root "$H8" "$H8/.claude"
DATA8="$H8/.local/share/blackceo/wise-elders"
HOME="$H8" bash "$INSTALL_SH" --data-dir "$DATA8" > "$BASE/install8.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "baseline install exits 0" \
  || { fail "baseline install exited $RC"; tail -5 "$BASE/install8.log"; }
AGG8="$(readlink "$DATA8/runtime/current" 2>/dev/null || true)"
[ -n "$AGG8" ] && pass "baseline current points at $AGG8" || fail "baseline current missing"
REAL_NODE="$(command -v node)"
STUB2="$BASE/probe-stub"; mkdir -p "$STUB2"
cat > "$STUB2/node" <<EOF
#!/bin/sh
if [ "\$2" = "--probe" ]; then
  echo "FAIL preflight: simulated sqlite failure" >&2
  exit 1
fi
exec "$REAL_NODE" "\$@"
EOF
chmod 755 "$STUB2/node"
HOME="$H8" PATH="$STUB2:$PATH" bash "$INSTALL_SH" --source-dir "$VENDORED" --data-dir "$DATA8" \
  > "$BASE/install8b.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_NODE_PREREQ_FAILED' "$BASE/install8b.log" \
  && pass "a failed prerequisite probe refuses with COUNCIL_NODE_PREREQ_FAILED (exit 4)" \
  || fail "failed prerequisite probe: rc=$RC (want 4 with COUNCIL_NODE_PREREQ_FAILED)"
[ "$(readlink "$DATA8/runtime/current" 2>/dev/null || true)" = "$AGG8" ] \
  && pass "current still points at the previous release after the refused probe" \
  || fail "current changed after the refused probe"
[ -f "$DATA8/runtime/$AGG8/.install-complete" ] \
  && pass "previous prefix is still complete after the refused probe" \
  || fail "previous prefix is incomplete after the refused probe"
HOME="$H8" bash "$INSTALL_SH" --data-dir "$DATA8" --check > "$BASE/check8.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "previous release still passes --check after the refused probe" \
  || fail "previous release failed --check after the refused probe (rc=$RC)"

echo "== 10. WER-004 hand-edited source is refused =="
H9="$BASE/home9"; mkdir -p "$H9/.claude"
link_root "$H9" "$H9/.claude"
TAMPERED="$BASE/tampered portable source"
cp -R "$VENDORED" "$TAMPERED"
printf '\nhand edit\n' >> "$TAMPERED/SKILL.md"
HOME="$H9" bash "$INSTALL_SH" --source-dir "$TAMPERED" --data-dir "$H9/data" > "$BASE/install9.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_SOURCE_INTEGRITY_FAILED' "$BASE/install9.log" \
  && pass "a hand-edited source refuses with COUNCIL_SOURCE_INTEGRITY_FAILED (exit 4)" \
  || fail "hand-edited source: rc=$RC (want 4 with COUNCIL_SOURCE_INTEGRITY_FAILED)"
[ ! -e "$H9/data/runtime/current" ] \
  && pass "the refused source created no current link" \
  || fail "the refused source created a current link"
HOME="$H9" bash "$INSTALL_SH" --data-dir "$H9/data" --check > "$BASE/check9.log" 2>&1; RC=$?
[ "$RC" != 0 ] && pass "--check reports the refused source as not installed" \
  || fail "--check reported success for a refused source"

echo "== 11. WER-004 PowerShell path with spaces and non-ASCII =="
if command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -File "$REPO_ROOT/scripts/test-council-install.ps1" -RepoRoot "$REPO_ROOT" \
    > "$BASE/ps-test.log" 2>&1; RC=$?
  [ "$RC" = 0 ] && pass "PowerShell path test passes (spaces + non-ASCII)" \
    || { fail "PowerShell path test exited $RC"; tail -10 "$BASE/ps-test.log"; }
else
  skip "pwsh is not installed on this host; PowerShell path test not executed (native Windows execution deferred to WER-027)"
fi

echo "== 12. doctor mode DERIVATION (CWE: no hardcoded --distribution) =="
# The installer derives the doctor's verification mode from the resolved
# tree (scripts/council-doctor-mode.mjs). The vendored tree is an extracted
# distribution; leg 3 above already installed against it, so a regression
# that hardcodes source mode reappears there as COUNCIL_SOURCE_DOCTOR_FAILED
# and this leg names the cause. Legs 3, 5, 8 and 9 also cover the wrapped
# copy of the installer, so --check and the post-build gate are re-exercised.
MODE_TOOL="$REPO_ROOT/scripts/council-doctor-mode.mjs"
[ -f "$MODE_TOOL" ] && pass "doctor mode derivation tool exists" \
  || fail "doctor mode derivation tool missing: $MODE_TOOL"
MODE_V="$(node "$MODE_TOOL" --root "$VENDORED" 2>&1)"
[ "$MODE_V" = "distribution" ] && pass "vendored tree derives distribution" \
  || fail "vendored tree derived '$MODE_V' (want distribution)"
HOME="$H1" bash "$INSTALL_SH" --data-dir "$DATA1" > "$BASE/install12.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "reinstall against the vendored tree exits 0 at source-doctor gate" \
  || { fail "reinstall exited $RC"; grep 'ERROR' "$BASE/install12.log" | head -2; }

echo "== 13. doctor mode derivation: canonical source and masked negative =="
bash "$REPO_ROOT/scripts/test-council-doctor-mode.sh" > "$BASE/doctor-mode.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "canonical source still passes source mode; masked distribution refused" \
  || { fail "doctor mode battery exited $RC"; grep 'FAIL' "$BASE/doctor-mode.log" | head -8; }

echo "== 14. --refresh-record: record reconciliation (nondestructive) =="
# The live defect: the prefix is installed and gated, the tree lives at a
# new path with the same aggregate, and install-record.json keeps pointing
# at the old skill_dir with no supported way to reconcile it. Each case
# snapshots the record and cmp's it afterwards: every refusal must leave
# the record byte-identical, and only the record is ever rewritten.
NEWSRC="$BASE/new source tree"
cp -R "$VENDORED" "$NEWSRC" || fail "could not copy the portable source"
NEWSRC_ABS="$(cd "$NEWSRC" && pwd -P)"
PREFIX14="$DATA1/runtime/$AGG"
RECORD14="$PREFIX14/install-record.json"
rec_field() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]])' "$RECORD14" "$1" 2>/dev/null; }
[ -f "$RECORD14" ] && pass "installed record present at runtime/$AGG" \
  || fail "installed record missing: $RECORD14"
[ "$(rec_field skill_dir)" != "$NEWSRC_ABS" ] && pass "record starts out pointing at the old skill_dir" \
  || fail "record already points at the new source"
cp "$RECORD14" "$BASE/record14.baseline"
cmp -s "$H1/.local/bin/blackceo-council" "$REPO_ROOT/launchers/macos/blackceo-council" \
  && pass "executable baseline matches the launcher template" \
  || fail "executable baseline drifted"

# 14.1 refresh rewrites the record to the given source
HOME="$H1" bash "$INSTALL_SH" --refresh-record --skill-dir "$NEWSRC" --source-dir "$NEWSRC" \
  --data-dir "$DATA1" > "$BASE/refresh1.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "--refresh-record exits 0" \
  || { fail "--refresh-record exited $RC"; tail -3 "$BASE/refresh1.log"; }
[ "$(rec_field skill_dir)" = "$NEWSRC_ABS" ] && pass "record skill_dir rewritten to the given source" \
  || fail "record skill_dir is '$(rec_field skill_dir)' (want $NEWSRC_ABS)"
[ "$(rec_field source_dir)" = "$NEWSRC_ABS" ] && pass "record source_dir rewritten to the given source" \
  || fail "record source_dir is '$(rec_field source_dir)' (want $NEWSRC_ABS)"
[ "$(rec_field aggregate)" = "$AGG" ] && pass "record aggregate is the verified aggregate" \
  || fail "record aggregate is '$(rec_field aggregate)' (want $AGG)"
[ -f "$PREFIX14/.install-complete" ] && pass ".install-complete still present after refresh" \
  || fail ".install-complete disappeared after refresh"
[ "$(readlink "$DATA1/runtime/current" 2>/dev/null || true)" = "$AGG" ] \
  && pass "current link untouched by refresh" || fail "current link changed"
cmp -s "$H1/.local/bin/blackceo-council" "$REPO_ROOT/launchers/macos/blackceo-council" \
  && pass "executable untouched by refresh" || fail "executable changed"
if find "$PREFIX14" -maxdepth 1 -name '.install-record.json.tmp.*' | grep -q .; then
  fail "stale record temp files left inside the prefix"
else
  pass "no record temp files left inside the prefix"
fi

# 14.2 second run is a byte-identical no-op
cp "$RECORD14" "$BASE/record14.first"
HOME="$H1" bash "$INSTALL_SH" --refresh-record --skill-dir "$NEWSRC" --source-dir "$NEWSRC" \
  --data-dir "$DATA1" > "$BASE/refresh2.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "second --refresh-record exits 0 (idempotent)" \
  || fail "second --refresh-record exited $RC"
cmp -s "$RECORD14" "$BASE/record14.first" && pass "second run leaves the record byte-identical" \
  || fail "second run changed the record"

# 14.3 wrong recorded aggregate: refuse without --source-dir, reconcile with one
printf '{ "aggregate": "not-the-verified-aggregate", "skill_dir": "%s", "source_dir": "%s", "node": "v0.0.0" }\n' \
  "$NEWSRC_ABS" "$NEWSRC_ABS" > "$RECORD14"
cp "$RECORD14" "$BASE/record14.corrupt"
HOME="$H1" bash "$INSTALL_SH" --refresh-record --skill-dir "$NEWSRC" --data-dir "$DATA1" \
  > "$BASE/refresh3.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_RECORD_AGGREGATE_MISMATCH' "$BASE/refresh3.log" \
  && pass "wrong recorded aggregate without --source-dir refuses (exit 4)" \
  || fail "wrong aggregate: rc=$RC (want 4 with COUNCIL_RECORD_AGGREGATE_MISMATCH)"
cmp -s "$RECORD14" "$BASE/record14.corrupt" && pass "refused refresh left the record untouched" \
  || fail "refused refresh changed the record"
HOME="$H1" bash "$INSTALL_SH" --refresh-record --skill-dir "$NEWSRC" --source-dir "$NEWSRC" \
  --data-dir "$DATA1" > "$BASE/refresh3b.log" 2>&1; RC=$?
[ "$RC" = 0 ] && [ "$(rec_field aggregate)" = "$AGG" ] \
  && pass "an explicit --source-dir reconciles the wrong aggregate" \
  || fail "explicit --source-dir refresh exited $RC with aggregate '$(rec_field aggregate)'"

# 14.4 the flag without --skill-dir refuses
cp "$RECORD14" "$BASE/record14.before4"
HOME="$H1" bash "$INSTALL_SH" --refresh-record --data-dir "$DATA1" > "$BASE/refresh4.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_REFRESH_SKILL_DIR_REQUIRED' "$BASE/refresh4.log" \
  && pass "--refresh-record without --skill-dir refuses (exit 4)" \
  || fail "bare flag: rc=$RC (want 4 with COUNCIL_REFRESH_SKILL_DIR_REQUIRED)"
cmp -s "$RECORD14" "$BASE/record14.before4" && pass "bare-flag refusal left the record untouched" \
  || fail "bare-flag refusal changed the record"

# 14.5 a failed integrity check leaves the record untouched
TAMPERED2="$BASE/tampered refresh source"
cp -R "$VENDORED" "$TAMPERED2"
printf '\nhand edit\n' >> "$TAMPERED2/SKILL.md"
cp "$RECORD14" "$BASE/record14.before5"
HOME="$H1" bash "$INSTALL_SH" --refresh-record --skill-dir "$TAMPERED2" --source-dir "$TAMPERED2" \
  --data-dir "$DATA1" > "$BASE/refresh5.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_SOURCE_INTEGRITY_FAILED' "$BASE/refresh5.log" \
  && pass "hand-edited source refuses at the integrity gate (exit 4)" \
  || fail "tampered refresh: rc=$RC (want 4 with COUNCIL_SOURCE_INTEGRITY_FAILED)"
cmp -s "$RECORD14" "$BASE/record14.before5" && pass "failed integrity check leaves the record untouched" \
  || fail "failed integrity check changed the record"

echo "== preservation, after everything =="
[ "$(sha256sum "$H1/.claude-nine/settings.json" | cut -d' ' -f1)" = "$SETTINGS_HASH_BEFORE" ] \
  && pass "claude-nine settings.json still byte-identical" || fail "claude-nine settings.json changed"
[ "$(sha256sum "$H1/.local/bin/claude-nine" | cut -d' ' -f1)" = "$NINE_HASH_BEFORE" ] \
  && pass "existing claude-nine launcher byte-identical (preserved)" \
  || fail "existing claude-nine launcher changed"

rm -rf "$BASE"
echo
echo "RESULT: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
