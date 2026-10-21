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
#   9. Canonical prerequisite probe (WER-004): a node that runs but is
#      below the canonical 22.13+/24+ floor (or lacks node:sqlite) is
#      refused with COUNCIL_NODE_PREREQ_FAILED at exit 4 BEFORE any
#      npm ci or build work, and the previous release stays installed
#      and usable.
#  10. Canonical-source resolution (WER-004): a copied council folder
#      that drifted (or never was the registered 999 distribution) is
#      refused with COUNCIL_NOT_CANONICAL_SOURCE at exit 4, and the
#      previous release stays installed and usable.
#  11. PowerShell counterpart (WER-004, parity check — native Windows
#      host execution is DEFERRED to WER-027): run under pwsh on the
#      999-distribution identity gate and the canonical probe gate,
#      with a native Windows-shaped path containing spaces and a
#      non-ASCII character. No WSL, no Bash shebang, no symlink
#      assumption: the .ps1 is parsed and its pure-PowerShell gates are
#      exercised through a real pwsh interpreter.
#
# Everything runs under a fixture HOME in ${TMPDIR:-/tmp}.
# Run: bash scripts/test-council-install.sh
set -uo pipefail

# Session-environment isolation (WER-004): the battery must never see a
# real operator config root through CLAUDE_CONFIG_DIR (a claude-nine
# session exports it) or a real data profile through
# BLACKCEO_COUNCIL_DATA_DIR. Fixture HOME alone decides every path.
unset CLAUDE_CONFIG_DIR BLACKCEO_COUNCIL_DATA_DIR COUNCIL_RUNTIME_PREFIX || true
# Empty-override probe: each INSTALLER invocation below carries
# BLACKCEO_COUNCIL_DATA_DIR="" explicitly (the installers reject an empty
# value and fall back to HOME). It is never exported globally: the CLI
# legs of this battery must never see an empty override, because the
# canonical runtime's resolveDataDir treats "" as set and would resolve
# the data directory to the process CWD, writing council.db into the
# worktree root (the CWD-relative stray-state failure).
install_sh() {
  HOME="$1" BLACKCEO_COUNCIL_DATA_DIR="" bash "$INSTALL_SH" "${@:2}"
}
install_sh_check() {
  HOME="$1" BLACKCEO_COUNCIL_DATA_DIR="" bash "$INSTALL_SH" --check "${@:2}"
}

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
CLAUDE_CONFIG_DIR="" HOME="$H1" bash "$H1/.local/bin/sync-nine-skills.sh" --quiet >/dev/null 2>&1
[ -L "$H1/.claude-nine/skills/$SKILL_NAME" ] \
  && pass "sync re-links the council into the nine root" \
  || fail "sync did not re-link the council into the nine root"

echo "== 3. runtime install: prefix, wrapper, current, executable =="
# Data profile default is platform-split (Darwin: ~/Library/Application
# Support/BlackCEO/WiseElders; XDG elsewhere) — never assume XDG.
case "$(uname -s)" in
  Darwin) DATA1="$H1/Library/Application Support/BlackCEO/WiseElders" ;;
  *)      DATA1="$H1/.local/share/blackceo/wise-elders" ;;
esac
install_sh "$H1" > "$BASE/install1.log" 2>&1; RC=$?
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
install_sh_check "$H1" > "$BASE/check1.log" 2>&1; RC=$?
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
install_sh "$H2" > "$BASE/install2.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "runtime install on the updated root exits 0" \
  || { fail "runtime install on the updated root exited $RC"; tail -3 "$BASE/install2.log"; }
install_sh "$H2" > "$BASE/install2b.log" 2>&1; RC=$?
[ "$RC" = 0 ] && grep -q 'already installed and gated' "$BASE/install2b.log" \
  && pass "repeat runtime install reuses the gated prefix (idempotent)" \
  || fail "repeat runtime install was not an idempotent reuse (rc=$RC)"

echo "== 6. custom root and paths with spaces =="
H3="$BASE/home with spaces"; mkdir -p "$H3"
CUSTOM="$H3/custom config root"
link_root "$H3" "$CUSTOM"
[ -L "$CUSTOM/skills/$SKILL_NAME" ] && pass "custom root with spaces linked" \
  || fail "custom root with spaces was not linked"
install_sh "$H3" --skill-dir "$CUSTOM/skills/$SKILL_NAME" \
  --data-dir "$H3/data profile" --bin-dir "$H3/bin dir" > "$BASE/install3.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "runtime install with spaced paths exits 0" \
  || { fail "runtime install with spaced paths exited $RC"; tail -3 "$BASE/install3.log"; }
HOME="$H3" BLACKCEO_COUNCIL_DATA_DIR="$H3/data profile" "$H3/bin dir/blackceo-council" doctor \
  > "$BASE/cli-doctor3.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "executable in a spaced path runs doctor" || fail "spaced-path doctor exited $RC"

echo "== 7. offline installs =="
H4="$BASE/home4"; mkdir -p "$H4/.claude"
link_root "$H4" "$H4/.claude"
install_sh "$H4" --offline > "$BASE/install4.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "offline install succeeds with a warm npm cache" \
  || { fail "offline install with warm cache exited $RC"; tail -3 "$BASE/install4.log"; }
H5="$BASE/home5"; mkdir -p "$H5/.claude"
link_root "$H5" "$H5/.claude"
HOME="$H5" npm_config_cache="$BASE/cold-cache" install_sh "$H5" --offline \
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
HOME="$H6" PATH="$STUB:/usr/bin:/bin" install_sh "$H6" > "$BASE/install6.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_NODE_MISSING' "$BASE/install6.log" \
  && pass "broken node surfaces as COUNCIL_NODE_MISSING (exit 4)" \
  || fail "broken node: rc=$RC (want 4 with COUNCIL_NODE_MISSING)"
printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 10.0.0; exit 0; fi\nexit 1\n' > "$STUB/npm"
chmod 755 "$STUB/npm"; rm -f "$STUB/node"
H7="$BASE/home7"; mkdir -p "$H7/.claude"
link_root "$H7" "$H7/.claude"
HOME="$H7" PATH="$STUB:$PATH" install_sh "$H7" > "$BASE/install7.log" 2>&1; RC=$?
[ "$RC" = 5 ] && grep -q 'COUNCIL_NPM_CI_FAILED' "$BASE/install7.log" \
  && pass "failing npm ci surfaces as COUNCIL_NPM_CI_FAILED (exit 5)" \
  || fail "failing npm: rc=$RC (want 5 with COUNCIL_NPM_CI_FAILED)"
[ ! -e "$H7/.local/share/blackceo/wise-elders/runtime/current" ] \
  && pass "failed dependency install leaves no current" \
  || fail "failed dependency install left a current link"

echo "== 8b. native dependency errors leave NO state behind =="
[ ! -e "$H7/.local/share/blackceo/wise-elders" ] && [ ! -e "$H7/Library/Application Support/BlackCEO/WiseElders" ] \
  && pass "failed npm on a clean profile created no profile tree" \
  || fail "failed npm created a profile tree on a clean HOME"

echo "== 9. canonical prerequisite probe refuses an unsupported node =="
# A real Node 20 runs and reports a version but is below the canonical
# 22.13+/24+ floor (and lacks node:sqlite). The pre-repair installer
# accepted it and died only at the doctor gate AFTER a full npm ci +
# tsc + esbuild (minutes of wasted work); the repaired installer must
# refuse it at exit 4 with COUNCIL_NODE_PREREQ_FAILED, write nothing,
# and leave the previous release installed and usable.
# Build the previous release first with the real node.
H8="$BASE/home8"; mkdir -p "$H8/.claude"
link_root "$H8" "$H8/.claude"
DATA8="$BASE/data8"; BIN8="$BASE/bin8"
install_sh "$H8" --data-dir "$DATA8" --bin-dir "$BIN8" > "$BASE/install8.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "previous release installed into the shared profile" \
  || { fail "previous release install exited $RC"; tail -3 "$BASE/install8.log"; }
[ -L "$DATA8/runtime/current" ] && pass "previous release is current" || fail "no current after the previous release install"
# Find an older real node to stage the unsupported-executable shape. If
# none exists, synthesize one from the real node whose --version lies.
N20=""
for d in "$HOME/.nvm/versions/node"/v20.* "$HOME/.nvm/versions/node"/v18.*; do
  [ -x "$d/bin/node" ] && N20="$d/bin/node" && break
done
if [ -z "$N20" ]; then
  REAL_NODE="$(command -v node)"
  STUB20="$BASE/stub-node20"; mkdir -p "$STUB20"
  printf '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v20.11.0; exit 0; fi\nexec "%s" "$@"\n' "$REAL_NODE" > "$STUB20/node"
  chmod 755 "$STUB20/node"
  N20="$STUB20/node"
fi
HOME="$H8" PATH="$(dirname "$N20"):$PATH" install_sh "$H8" --data-dir "$DATA8" --bin-dir "$BIN8" \
  > "$BASE/install8b.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_NODE_PREREQ_FAILED' "$BASE/install8b.log" \
  && pass "unsupported node refused with COUNCIL_NODE_PREREQ_FAILED (exit 4)" \
  || { fail "unsupported node: rc=$RC (want 4 with COUNCIL_NODE_PREREQ_FAILED)"; tail -3 "$BASE/install8b.log"; }
grep -q 'npm ci' "$BASE/install8b.log" && grep -q 'installing runtime dependencies' "$BASE/install8b.log" \
  && fail "unsupported node ran dependency work before refusing" \
  || pass "refusal happened BEFORE any npm ci or build work"
[ -L "$DATA8/runtime/current" ] \
  && pass "previous release stays current after the probe refusal" \
  || fail "probe refusal damaged the previous release"
install_sh_check "$H8" --data-dir "$DATA8" --bin-dir "$BIN8" > "$BASE/check8.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "previous release still passes --check after the probe refusal" \
  || { fail "previous release --check exited $RC after the probe refusal"; tail -3 "$BASE/check8.log"; }

echo "== 10. canonical-source resolution refuses a drifted copy =="
# A copied council folder is not separately editable product. Edit one
# content byte of the runtime source in a copy and the install must
# refuse it with COUNCIL_NOT_CANONICAL_SOURCE at exit 4, write nothing,
# and leave the previous release installed and usable.
DRIFT="$BASE/drift-copy"
cp -R "$VENDORED" "$DRIFT"
printf '\n' >> "$DRIFT/runtime/src/paths.ts"
H9="$BASE/home9"; mkdir -p "$H9/.claude"
install_sh "$H9" --skill-dir "$DRIFT" --data-dir "$DATA8" --bin-dir "$BIN8" \
  > "$BASE/install9.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_NOT_CANONICAL_SOURCE' "$BASE/install9.log" \
  && pass "drifted copy refused with COUNCIL_NOT_CANONICAL_SOURCE (exit 4)" \
  || { fail "drifted copy: rc=$RC (want 4 with COUNCIL_NOT_CANONICAL_SOURCE)"; tail -3 "$BASE/install9.log"; }
# A foreign folder wearing the name (no canonical identity at all).
FOREIGN="$BASE/foreign-copy"
mkdir -p "$FOREIGN"
printf '{ "aggregate_sha256": "%s", "source_commit": "0000000000000000000000000000000000000000", "canonical_aggregate_sha256": "0000000000000000000000000000000000000000" }\n' "$(printf 'a%.0s' $(seq 1 64))" > "$FOREIGN/manifest.json"
mkdir -p "$FOREIGN/runtime/src"
install_sh "$H9" --skill-dir "$FOREIGN" --data-dir "$DATA8" --bin-dir "$BIN8" \
  > "$BASE/install9b.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_NOT_CANONICAL_SOURCE' "$BASE/install9b.log" \
  && pass "foreign folder refused with COUNCIL_NOT_CANONICAL_SOURCE (exit 4)" \
  || { fail "foreign folder: rc=$RC (want 4 with COUNCIL_NOT_CANONICAL_SOURCE)"; tail -3 "$BASE/install9b.log"; }
[ -L "$DATA8/runtime/current" ] \
  && pass "previous release stays current after the identity refusals" \
  || fail "identity refusal damaged the previous release"

echo "== 11. PowerShell counterpart: parse + gates under pwsh (spaces + Unicode) =="
# WER-027 deferral: this is NOT a native Windows host execution. It is
# the parity check the base can prove on this box: the .ps1 parses under
# a real PowerShell interpreter, its canonical probe and identity gates
# behave identically to the .sh, and native Windows-shaped paths with
# spaces and a non-ASCII character resolve correctly. Requires pwsh
# (PowerShell 7+) on PATH; skipped (not failed) when absent.
PWSH_BIN="$(command -v pwsh 2>/dev/null || true)"
if [ -z "$PWSH_BIN" ]; then
  echo "  SKIP: pwsh not on PATH; PowerShell parity legs deferred to WER-027 (native Windows host)"
else
  PS1_INSTALL="$REPO_ROOT/scripts/council-runtime-install.ps1"
  # Parse + parameter contract: -WhatIf-style dry parse via [scriptblock].
  PARSE_OUT="$(pwsh -NoProfile -Command "
    \$ErrorActionPreference='Stop'
    \$tokens=\$null; \$errors=\$null
    [System.Management.Automation.Language.Parser]::ParseFile('$PS1_INSTALL', [ref]\$tokens, [ref]\$errors) | Out-Null
    if (\$errors.Count -gt 0) { \$errors | ForEach-Object { Write-Error \$\_.Message }; exit 1 }
    exit 0" 2>&1)"; RC=$?
  [ "$RC" = 0 ] && pass "council-runtime-install.ps1 parses clean under pwsh" \
    || { fail "ps1 parse errors: $PARSE_OUT"; }
  # Canonical probe gate parity: run the .ps1 in -Check mode (the pure
  # PowerShell gates: probe, identity, path resolution, not-installed
  # state) with a Windows-shaped root whose name contains spaces AND a
  # non-ASCII character. Full .ps1 install execution is DEFERRED to
  # WER-027 (native Windows host); it is never claimed to pass here.
  PSW="$BASE/winroot with spaces and Ünïcödé"
  mkdir -p "$PSW"
  CLAUDE_CONFIG_DIR="" HOME="$PSW" USERPROFILE="$PSW" LOCALAPPDATA="$PSW" \
    BLACKCEO_COUNCIL_DATA_DIR="" pwsh -NoProfile -File "$PS1_INSTALL" -DataDir "$PSW/data profile" -Check \
    > "$BASE/ps1-check.log" 2>&1; RC=$?
  grep -q 'canonical Node prerequisite probe: PASS' "$BASE/ps1-check.log" \
    && pass "ps1 runs the canonical Node prerequisite probe (spaces + Unicode path)" \
    || { fail "ps1 did not report the canonical probe pass"; tail -5 "$BASE/ps1-check.log"; }
  grep -q 'canonical-source identity: registered 999 distribution' "$BASE/ps1-check.log" \
    && pass "ps1 enforces the canonical-source identity gate" \
    || { fail "ps1 did not report the canonical identity gate"; tail -5 "$BASE/ps1-check.log"; }
  grep -q 'distribution aggregate: 0c11' "$BASE/ps1-check.log" \
    && pass "ps1 resolved and read the manifest through the spaced/Unicode profile root" \
    || { fail "ps1 manifest resolution broke under the spaced/Unicode profile root"; tail -5 "$BASE/ps1-check.log"; }
  grep -q 'current: not installed' "$BASE/ps1-check.log" \
    && pass "ps1 -Check reports not-installed for a clean profile (exit $RC)" \
    || { fail "ps1 -Check did not report the expected not-installed state"; tail -5 "$BASE/ps1-check.log"; }
  # Refusal parity: the drifted copy must be refused by the .ps1 too,
  # with the same error name, before anything is written.
  CLAUDE_CONFIG_DIR="" HOME="$PSW" BLACKCEO_COUNCIL_DATA_DIR="" pwsh -NoProfile -File "$PS1_INSTALL" -SkillDir "$DRIFT" \
    -DataDir "$PSW/data profile" > "$BASE/ps1-drift.log" 2>&1; RC=$?
  [ "$RC" = 4 ] && grep -q 'COUNCIL_NOT_CANONICAL_SOURCE' "$BASE/ps1-drift.log" \
    && pass "ps1 refuses the drifted copy with COUNCIL_NOT_CANONICAL_SOURCE (exit 4)" \
    || { fail "ps1 drifted copy: rc=$RC (want 4 with COUNCIL_NOT_CANONICAL_SOURCE)"; tail -3 "$BASE/ps1-drift.log"; }
  # Unsupported-node refusal parity through the .ps1 (stub node first on PATH).
  if [ -n "$N20" ]; then
    CLAUDE_CONFIG_DIR="" HOME="$PSW" PATH="$(dirname "$N20"):$PATH" BLACKCEO_COUNCIL_DATA_DIR="" \
      pwsh -NoProfile -File "$PS1_INSTALL" -DataDir "$PSW/data profile" > "$BASE/ps1-node20.log" 2>&1; RC=$?
    [ "$RC" = 4 ] && grep -q 'COUNCIL_NODE_PREREQ_FAILED' "$BASE/ps1-node20.log" \
      && pass "ps1 refuses the unsupported node with COUNCIL_NODE_PREREQ_FAILED (exit 4)" \
      || { fail "ps1 unsupported node: rc=$RC (want 4 with COUNCIL_NODE_PREREQ_FAILED)"; tail -3 "$BASE/ps1-node20.log"; }
  fi
  [ ! -e "$PSW/data profile/runtime" ] \
    && pass "refused ps1 installs wrote nothing into the data profile" \
    || fail "a refused ps1 install wrote into the data profile"
fi

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
