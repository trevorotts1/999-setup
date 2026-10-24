#!/bin/bash
# Council of Wise Elders: runtime installer for 999-distributed installs
# (CWE-040; directive Section 25.2 steps 5 and 6, Section 16.1).
#
# What it does:
#   1. Finds the installed council skill folder (through a Claude config
#      root link) and reads its distribution identity (manifest.json
#      aggregate hash). Resolves the portable source that actually feeds
#      the install: --source-dir, then COUNCIL_CANONICAL_SOURCE, then the
#      installed skill folder. The resolved tree must recompute to its own
#      manifest and carry canonical provenance; a hand-edited copy is
#      refused instead of being treated as a separately editable product.
#   2. Runs the canonical Node/SQLite prerequisite probe through the exact
#      resolved Node executable (install-runtime.mjs --check-prereqs when
#      the source publishes it, else node-runtime-preflight.mjs). A failed
#      probe stops before staging and the previous release is untouched.
#   3. Stages the runtime payload into a versioned per-user prefix
#      OUTSIDE every config/discovery root:
#        macOS: ~/Library/Application Support/BlackCEO/WiseElders/runtime/<aggregate>
#        Linux: ${XDG_DATA_HOME:-$HOME/.local/share}/blackceo/wise-elders/runtime/<aggregate>
#      Node modules exist only inside that prefix, never in the shared
#      synchronized skill folder. The generated Claude-Nine host wrapper
#      is emitted into the staged dist from the CWE-010 template in the
#      vendored runtime (renderClaudeNineWrapper()).
#   4. Gates the staged prefix: the package doctor must pass on the
#      installed skill folder, and the staged CLI doctor (through the
#      generated wrapper and the bundle resolver) must exit 0.
#   5. Atomically swaps the prefix's `current` link to the gated build.
#      A failed gate leaves `current` exactly as it was; a failed prefix
#      replacement restores the previous prefix before dying.
#   6. Installs the blackceo-council executable (launchers/macos/
#      blackceo-council) into the bin dir. A foreign file at that path
#      is never overwritten; the install refuses and says why.
#
# Council state is created only inside the data profile (the CLI doctor
# opens the store there). The skill folder is never written to.
#
# Usage:
#   scripts/council-runtime-install.sh [--skill-dir DIR] [--source-dir DIR]
#                                      [--data-dir DIR] [--bin-dir DIR]
#                                      [--offline] [--check]
#   scripts/council-runtime-install.sh --refresh-record --skill-dir DIR
#                                      [--source-dir DIR] [--data-dir DIR]
# Nondestructive record reconciliation: --refresh-record re-runs the
# source-integrity and doctor gates above, then rewrites ONLY the installed
# prefix's install-record.json (temp + rename in the same directory) to
# {aggregate, skill_dir, source_dir, node} pointing at the resolved source.
# It requires an explicit --skill-dir, refuses when the record's aggregate
# is not the verified aggregate unless --source-dir was explicitly given,
# and never deletes the runtime, removes .install-complete, or touches the
# current symlink or the executable.
# Exit codes: 0 ok; 4 preflight (node/npm/skill/manifest/source integrity,
# prerequisite probe, foreign executable, or a refused record refresh);
# 5 dependency install failed; 6 build failed; 7 doctor gate failed.
set -uo pipefail

SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
  _t="$(readlink "$SELF")"
  case "$_t" in /*) SELF="$_t" ;; *) SELF="$(dirname "$SELF")/$_t" ;; esac
done
SELF_DIR="$(cd "$(dirname "$SELF")" && pwd -P)"
REPO_ROOT="$(cd "$SELF_DIR/.." && pwd -P)"
unset _t

SKILL_DIR=""
SKILL_DIR_OPT=""
SOURCE_DIR_OPT=""
DATA_DIR=""
BIN_DIR="$HOME/.local/bin"
OFFLINE=0
CHECK=0
REFRESH_RECORD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skill-dir) SKILL_DIR="$2"; SKILL_DIR_OPT="$2"; shift 2 ;;
    --source-dir) SOURCE_DIR_OPT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    --offline) OFFLINE=1; shift ;;
    --check) CHECK=1; shift ;;
    --refresh-record) REFRESH_RECORD=1; shift ;;
    -h|--help) sed -n '2,54p' "$SELF"; exit 0 ;;
    *) echo "council-runtime-install: unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { echo "council-runtime-install: $*"; }
die() { say "ERROR $1: $2" >&2; exit "$3"; }

# --refresh-record reconciles an existing prefix record; it is meaningless
# without the install context an explicit --skill-dir names, so refuse the
# bare form instead of silently reconciling against a discovered tree.
if [ "$REFRESH_RECORD" -eq 1 ] && [ -z "$SKILL_DIR_OPT" ]; then
  die COUNCIL_REFRESH_SKILL_DIR_REQUIRED "--refresh-record requires an explicit --skill-dir; refusing to reconcile the record of a discovered install" 4
fi

# Doctor verification mode for a resolved skill tree: prints "source" or
# "distribution", prints ERROR and returns 1 when neither applies. The rule
# and its anti-spoof argument live in scripts/council-doctor-mode.mjs.
council_doctor_mode() {
  [ -f "$DOCTOR_MODE_TOOL" ] || { echo "ERROR doctor mode derivation missing: $DOCTOR_MODE_TOOL" >&2; return 1; }
  "$NODE_BIN" "$DOCTOR_MODE_TOOL" --root "$1" 2>/dev/null
}

# --- data profile (mirrors runtime/src/cli/paths.ts Section 16.1) -------
if [ -z "$DATA_DIR" ]; then
  if [ -n "${BLACKCEO_COUNCIL_DATA_DIR:-}" ]; then
    DATA_DIR="$BLACKCEO_COUNCIL_DATA_DIR"
  elif [ "$(uname -s)" = "Darwin" ]; then
    DATA_DIR="$HOME/Library/Application Support/BlackCEO/WiseElders"
  else
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/blackceo/wise-elders"
  fi
fi

# --- preflight: prove node and npm by execution, never by lookup --------
NODE_BIN="$(command -v node 2>/dev/null || true)"
[ -n "$NODE_BIN" ] && "$NODE_BIN" --version >/dev/null 2>&1 \
  || die COUNCIL_NODE_MISSING "Node.js is not runnable on PATH; the council runtime cannot install or run" 4
NPM_BIN="$(command -v npm 2>/dev/null || true)"
[ -n "$NPM_BIN" ] && "$NPM_BIN" --version >/dev/null 2>&1 \
  || die COUNCIL_NPM_MISSING "npm is not runnable on PATH; the council runtime dependencies cannot be installed" 4

# --- locate the installed skill folder -----------------------------------
if [ -z "$SKILL_DIR" ]; then
  for cand in \
    "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/council-of-wise-elders" \
    "$HOME/.claude/skills/council-of-wise-elders" \
    "$HOME/.claude-nine/skills/council-of-wise-elders" \
    "$REPO_ROOT/.claude/skills/council-of-wise-elders"; do
    if [ -f "$cand/manifest.json" ]; then SKILL_DIR="$cand"; break; fi
  done
fi
[ -n "$SKILL_DIR" ] && [ -f "$SKILL_DIR/manifest.json" ] \
  || die COUNCIL_SKILL_NOT_FOUND "no installed council-of-wise-elders skill folder with manifest.json was found" 4
SKILL_DIR="$(cd "$SKILL_DIR" && pwd -P)"
say "skill folder: $SKILL_DIR"

# --- resolve the canonical portable source --------------------------------
# The runtime payload is never taken from an unverified copy. The resolved
# tree must be the canonical portable source (or the distribution bundle
# generated from it): its files must recompute to its own manifest and it
# must carry canonical provenance. An edited copy therefore stops here.
if [ -n "$SOURCE_DIR_OPT" ]; then
  SOURCE_DIR="$SOURCE_DIR_OPT"
elif [ -n "${COUNCIL_CANONICAL_SOURCE:-}" ]; then
  SOURCE_DIR="$COUNCIL_CANONICAL_SOURCE"
else
  SOURCE_DIR="$SKILL_DIR"
fi
[ -n "$SOURCE_DIR" ] && [ -d "$SOURCE_DIR" ] \
  || die COUNCIL_SOURCE_NOT_FOUND "portable source directory not found: ${SOURCE_DIR:-<empty>}" 4
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd -P)"
[ -f "$SOURCE_DIR/manifest.json" ] \
  || die COUNCIL_SOURCE_NOT_FOUND "portable source has no manifest.json: $SOURCE_DIR" 4

PREFLIGHT="$SELF_DIR/council-runtime-preflight.mjs"
[ -f "$PREFLIGHT" ] \
  || die COUNCIL_PREFLIGHT_MISSING "prerequisite probe missing beside this script: $PREFLIGHT" 4
DOCTOR_MODE_TOOL="$SELF_DIR/council-doctor-mode.mjs"
[ -f "$DOCTOR_MODE_TOOL" ] \
  || die COUNCIL_DOCTOR_MODE_TOOL_MISSING "doctor mode derivation missing beside this script: $DOCTOR_MODE_TOOL" 4

"$NODE_BIN" "$PREFLIGHT" --verify-source "$SOURCE_DIR" \
  || die COUNCIL_SOURCE_INTEGRITY_FAILED "the portable source at $SOURCE_DIR does not recompute to its own manifest, or carries no canonical provenance. A copied or hand-edited folder is not an install source; the previous release was not touched" 4

"$NODE_BIN" "$PREFLIGHT" --probe --source "$SOURCE_DIR" \
  || die COUNCIL_NODE_PREREQ_FAILED "the resolved Node executable $NODE_BIN failed the canonical Council prerequisite probe (Node ^22.13.0 || >=24 with node:sqlite). Nothing was staged; the previous release is unchanged" 4

# The doctor's verification mode is derived from the resolved tree, not
# hardcoded and not read from the manifest's own status alone: a source
# package (archive present, status generated) keeps the archive SHA-256
# binding; an extracted distribution (no archive, status
# extracted_distribution) is checked as one. Anything else is refused here
# with COUNCIL_SOURCE_MODE_UNDETERMINED, because no mode would be a true
# statement about that tree. Derived once and reused by prefix_gates().
DOCTOR_MODE_SOURCE="$(council_doctor_mode "$SOURCE_DIR")" || true
case "$DOCTOR_MODE_SOURCE" in
  source|distribution) ;;
  *)
    die COUNCIL_SOURCE_MODE_UNDETERMINED "the portable source at $SOURCE_DIR is neither a source package (archive present, archive.status \"generated\") nor an extracted distribution (no archive, archive.status \"extracted_distribution\"); refusing to guess a doctor mode. The previous release was not touched" 4 ;;
esac
say "source doctor mode: $DOCTOR_MODE_SOURCE"
"$NODE_BIN" "$SOURCE_DIR/scripts/doctor.mjs" --root "$SOURCE_DIR" --"$DOCTOR_MODE_SOURCE" >/dev/null 2>&1 \
  || die COUNCIL_SOURCE_DOCTOR_FAILED "the portable source at $SOURCE_DIR does not pass its own package doctor ($DOCTOR_MODE_SOURCE mode); the previous release was not touched" 4

AGGREGATE="$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$SOURCE_DIR/manifest.json" 2>/dev/null || true)"
[ -n "$AGGREGATE" ] \
  || die COUNCIL_SKILL_MANIFEST_INVALID "could not read aggregate_sha256 from $SOURCE_DIR/manifest.json" 4
say "portable source: $SOURCE_DIR"
say "distribution aggregate: $AGGREGATE"

RUNTIME_DIR="$DATA_DIR/runtime"
PREFIX="$RUNTIME_DIR/$AGGREGATE"
CURRENT="$RUNTIME_DIR/current"

# --- --refresh-record: reconcile the installed prefix record ---------------
# The supported way to repoint install-record.json after the resolver
# selects a tree at a new path: the source-integrity and doctor gates above
# already ran and any failure stopped before here. Only the record is
# rewritten, atomically (temp + rename in the same directory); the runtime,
# .install-complete, the current link and the executable are never touched.
if [ "$REFRESH_RECORD" -eq 1 ]; then
  RECORD="$PREFIX/install-record.json"
  [ -d "$PREFIX" ] \
    || die COUNCIL_REFRESH_TARGET_MISSING "no installed prefix for the verified aggregate at $PREFIX; nothing to refresh" 4
  RECORDED_AGGREGATE=""
  if [ -f "$RECORD" ]; then
    RECORDED_AGGREGATE="$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate)' "$RECORD" 2>/dev/null || true)"
  fi
  if [ "$RECORDED_AGGREGATE" != "$AGGREGATE" ] && [ -z "$SOURCE_DIR_OPT" ]; then
    die COUNCIL_RECORD_AGGREGATE_MISMATCH "the installed record $RECORD carries aggregate '${RECORDED_AGGREGATE:-<none>}' but the verified source is $AGGREGATE; pass an explicit --source-dir to reconcile deliberately" 4
  fi
  TMP_RECORD="$PREFIX/.install-record.json.tmp.$$"
  rm -f "$TMP_RECORD"
  printf '{ "aggregate": "%s", "skill_dir": "%s", "source_dir": "%s", "node": "%s" }\n' \
    "$AGGREGATE" "$SOURCE_DIR" "$SOURCE_DIR" "$("$NODE_BIN" --version)" > "$TMP_RECORD" \
    || { rm -f "$TMP_RECORD"; die COUNCIL_RECORD_WRITE_FAILED "could not stage the refreshed install record in $PREFIX" 4; }
  mv "$TMP_RECORD" "$RECORD" \
    || { rm -f "$TMP_RECORD"; die COUNCIL_RECORD_WRITE_FAILED "could not move the refreshed install record into place" 4; }
  say "install-record refreshed: $RECORD"
  exit 0
fi

prefix_gates() {
  # $1 = prefix root to gate. Package doctor on the skill folder plus the
  # CLI doctor through the generated wrapper, against the real profile.
  # Gated at exit too: this function serves --check and drives the swap
  # decision, so a refused derivation must return 1, never fall through.
  # The doctor mode is derived from the SKILL folder, the tree being gated.
  local skill_mode
  skill_mode="$(council_doctor_mode "$SKILL_DIR")" || return 1
  case "$skill_mode" in source|distribution) ;; *) return 1 ;; esac
  "$NODE_BIN" "$SKILL_DIR/scripts/doctor.mjs" --root "$SKILL_DIR" --"$skill_mode" >/dev/null 2>&1 || return 1
  [ -f "$1/run-council.mjs" ] || return 1
  "$NODE_BIN" "$1/run-council.mjs" doctor --data-dir "$DATA_DIR" >/dev/null 2>&1 || return 1
  return 0
}

if [ "$CHECK" -eq 1 ]; then
  if [ -L "$CURRENT" ] && [ "$(readlink "$CURRENT")" = "$AGGREGATE" ]; then
    say "current: $AGGREGATE (matches the resolved source)"
  elif [ -e "$CURRENT" ]; then
    say "current: $(readlink "$CURRENT" 2>/dev/null || echo '(not a link)') (does not match the resolved source aggregate)"
  else
    say "current: not installed"
    exit 1
  fi
  prefix_gates "$PREFIX" && { say "doctor gates: PASS"; exit 0; } || { say "doctor gates: FAIL"; exit 1; }
fi

# --- reuse a complete gated prefix ----------------------------------------
if [ -f "$PREFIX/.install-complete" ] && prefix_gates "$PREFIX"; then
  say "prefix already installed and gated: $PREFIX"
else
  STAGE="$RUNTIME_DIR/.staging-$AGGREGATE-$$"
  rm -rf "$STAGE"
  mkdir -p "$STAGE" || die COUNCIL_STAGE_FAILED "could not create staging dir $STAGE" 5
  cp -R "$SOURCE_DIR/runtime" "$STAGE/runtime" \
    || die COUNCIL_STAGE_FAILED "could not copy the runtime payload from $SOURCE_DIR" 5
  # Build outputs are regenerated below; never carried into the prefix.
  rm -rf "$STAGE/runtime/node_modules" "$STAGE/runtime/dist"
  cp "$SELF_DIR/council/run-council.mjs" "$STAGE/run-council.mjs" \
    || die COUNCIL_STAGE_FAILED "bundle entry run-council.mjs missing beside this script" 5
  cp "$SELF_DIR/council/bundle-native-resolver.mjs" "$STAGE/bundle-native-resolver.mjs" \
    || die COUNCIL_STAGE_FAILED "bundle resolver missing beside this script" 5

  NPM_FLAGS="--no-audit --no-fund"
  # The cache rides as its own quoted argument, never inside $NPM_FLAGS:
  # that string is expanded unquoted and a spaced cache path (fixture roots
  # with spaces) would split into garbage --cache values.
  NPM_CACHE_ARG=""
  # npm ci --offline must be provable offline. npm reads a userconfig ABOVE
  # an exported npm_config_cache, and a fixture HOME's cache is cold, so the
  # one reliable pin is the command line: --cache=<dir> when the caller set
  # one (the test batteries do), else the operator cache. When the target
  # cache is cold and a warm operator cache exists, carry the warm one into
  # it first. A copy failure is not fatal: npm then reports the real miss.
  if [ "$OFFLINE" -eq 1 ]; then
    NPM_CACHE_DIR="${npm_config_cache:-}"
    if [ -z "$NPM_CACHE_DIR" ] && [ -n "${HOME:-}" ]; then
      NPM_CACHE_DIR="$HOME/.npm"
    fi
    NPM_FLAGS="$NPM_FLAGS --offline"
    if [ -n "$NPM_CACHE_DIR" ]; then
      NPM_CACHE_ARG="$NPM_CACHE_DIR"
      if [ ! -d "$NPM_CACHE_DIR/_cacache" ] && [ -n "${HOME:-}" ] \
        && [ -d "$HOME/.npm/_cacache" ] && [ "$HOME/.npm" != "$NPM_CACHE_DIR" ]; then
        mkdir -p "$NPM_CACHE_DIR" 2>/dev/null \
          && cp -R "$HOME/.npm/_cacache" "$NPM_CACHE_DIR/" 2>/dev/null || true
      fi
    fi
  fi
  say "installing runtime dependencies (npm ci)..."
  if ! (cd "$STAGE/runtime" && "$NPM_BIN" ci $NPM_FLAGS ${NPM_CACHE_ARG:+--cache="$NPM_CACHE_ARG"} >"$STAGE/npm-ci.log" 2>&1); then
    tail -5 "$STAGE/npm-ci.log" >&2 || true
    if [ "$OFFLINE" -eq 1 ]; then
      rm -rf "$STAGE"
      die COUNCIL_NPM_OFFLINE_CACHE_MISS "npm ci --offline failed: a pinned dependency is not in the local npm cache, and this install was asked to stay offline. Re-run without --offline on a connected machine. Staging was removed; current is unchanged" 5
    fi
    rm -rf "$STAGE"
    die COUNCIL_NPM_CI_FAILED "npm ci failed for the pinned runtime dependencies (log tail above). Staging was removed; current is unchanged" 5
  fi
  say "building the runtime (tsc + esbuild bundle)..."
  if ! (cd "$STAGE/runtime" && "$NPM_BIN" run build >"$STAGE/build.log" 2>&1); then
    tail -5 "$STAGE/build.log" >&2 || true
    rm -rf "$STAGE"
    die COUNCIL_BUILD_FAILED "the runtime build failed (log tail above). Staging was removed; current is unchanged" 6
  fi
  # The canonical bundle step (copy-runtime-assets.mjs, CWE-039 F-1)
  # copies the persistence schema SQL into dist at build time; the
  # persistence layer loads it relative to its module, so its absence
  # would only surface when the store first opens. Assert it landed.
  [ -f "$STAGE/runtime/dist/migrations/0001-council-schema.sql" ] \
    || { rm -rf "$STAGE"; die COUNCIL_BUILD_FAILED "the built runtime is missing dist/migrations/0001-council-schema.sql (the canonical copy-runtime-assets step did not run). Staging was removed; current is unchanged" 6; }
  # Emit the generated Claude-Nine host wrapper from the CWE-010 template.
  # The render runs through the staged runtime's own tsx: the canonical
  # contracts package uses extensionless import specifiers, which plain
  # Node ESM cannot resolve from source or tsc output.
  printf '%s\n' 'import { renderClaudeNineWrapper } from "./runtime/src/bridges/claude-nine.ts";' \
    'process.stdout.write(renderClaudeNineWrapper());' > "$STAGE/emit-wrapper.mts"
  if ! "$STAGE/runtime/node_modules/.bin/tsx" "$STAGE/emit-wrapper.mts" \
      > "$STAGE/runtime/dist/claude-nine-host-wrapper.mjs" 2>"$STAGE/wrapper.log"; then
    tail -5 "$STAGE/wrapper.log" >&2 || true
    rm -rf "$STAGE"
    die COUNCIL_BUILD_FAILED "emitting the generated host wrapper from the CWE-010 template failed. Staging was removed; current is unchanged" 6
  fi
  rm -f "$STAGE/emit-wrapper.mts"
  grep -q "createClaudeNineBridge" "$STAGE/runtime/dist/claude-nine-host-wrapper.mjs" \
    || { rm -rf "$STAGE"; die COUNCIL_BUILD_FAILED "the generated host wrapper does not compose createClaudeNineBridge. Staging was removed; current is unchanged" 6; }
  # Bundle the runnable entry with the runtime's own esbuild (the same
  # mechanism as the package's own blackceo-council bin): the entry
  # composes the emitted wrapper with the bundle native resolver.
  printf '%s\n' 'import { readFileSync } from "node:fs";' \
    'import { createClaudeNineHost, main } from "./dist/claude-nine-host-wrapper.mjs";' \
    'import { runCli } from "./dist/cli/dispatcher.js";' \
    'import { bundleNativeResolver } from "../bundle-native-resolver.mjs";' \
    'let skillRoot = null;' \
    'try { skillRoot = JSON.parse(readFileSync(new URL("../../install-record.json", import.meta.url), "utf8")).skill_dir ?? null; } catch {}' \
    'if (skillRoot) {' \
    '  process.exitCode = await runCli(process.argv.slice(2), undefined, {' \
    '    createHost: (opts) => createClaudeNineHost(bundleNativeResolver, { ...opts, skillRoot }),' \
    '  });' \
    '} else {' \
    '  process.exitCode = await main(process.argv.slice(2), bundleNativeResolver, undefined);' \
    '}' \
    > "$STAGE/runtime/bundle-entry.mjs"
  if ! "$STAGE/runtime/node_modules/.bin/esbuild" "$STAGE/runtime/bundle-entry.mjs" \
      --bundle --platform=node --format=esm --target=node20 \
      --outfile="$STAGE/runtime/dist/council-entry.mjs" >"$STAGE/entry.log" 2>&1; then
    tail -5 "$STAGE/entry.log" >&2 || true
    rm -rf "$STAGE"
    die COUNCIL_BUILD_FAILED "bundling the council entry failed. Staging was removed; current is unchanged" 6
  fi
  rm -f "$STAGE/runtime/bundle-entry.mjs"
  printf '{ "aggregate": "%s", "skill_dir": "%s", "source_dir": "%s", "node": "%s" }\n' \
    "$AGGREGATE" "$SKILL_DIR" "$SOURCE_DIR" "$("$NODE_BIN" --version)" > "$STAGE/install-record.json"

  say "gating the staged prefix (package doctor + CLI doctor)..."
  if ! prefix_gates "$STAGE"; then
    rm -rf "$STAGE"
    die COUNCIL_DOCTOR_FAILED "the staged runtime did not pass the doctor gates. Staging was removed; current is unchanged" 7
  fi
  printf 'ok\n' > "$STAGE/.install-complete"
  mkdir -p "$RUNTIME_DIR"
  # Replace the prefix without ever leaving the previous release absent:
  # move the old tree aside, move the gated tree in, and restore the old
  # tree if the move fails. The old tree is deleted only after success.
  OLD_PREFIX="$RUNTIME_DIR/.previous-$AGGREGATE-$$"
  rm -rf "$OLD_PREFIX"
  if [ -e "$PREFIX" ] || [ -L "$PREFIX" ]; then
    mv "$PREFIX" "$OLD_PREFIX" \
      || die COUNCIL_SWAP_FAILED "could not move the previous prefix aside; it is unchanged" 7
  fi
  if ! mv "$STAGE" "$PREFIX"; then
    [ -e "$OLD_PREFIX" ] && mv "$OLD_PREFIX" "$PREFIX"
    die COUNCIL_SWAP_FAILED "could not move the gated prefix into place; the previous release was restored" 7
  fi
  rm -rf "$OLD_PREFIX"
  say "prefix installed: $PREFIX"
fi

# --- atomic current swap ---------------------------------------------------
# F-046-2 (CWE-048): the swap must replace the current symlink itself,
# atomically. mv -f onto a symlink-to-directory follows the link and
# drops the staged link inside the old prefix instead (the mini-swap
# defect: stray .current.tmp links left inside the previous prefix and
# current still pointing at the old tree). rename(2) replaces the link
# itself without following it; it runs through the preflighted node
# binary so the semantics are identical on Linux and macOS, and no new
# platform dependency enters the install path.
mkdir -p "$RUNTIME_DIR"
TMP_LINK="$RUNTIME_DIR/.current.tmp.$$"
rm -f "$TMP_LINK"
ln -s "$AGGREGATE" "$TMP_LINK" || die COUNCIL_SWAP_FAILED "could not stage the current link" 7
if ! "$NODE_BIN" -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$TMP_LINK" "$CURRENT"; then
  rm -f "$TMP_LINK"
  die COUNCIL_SWAP_FAILED "could not swap the current link" 7
fi
say "current -> $AGGREGATE"

# --- the blackceo-council executable ---------------------------------------
EXEC_DEST="$BIN_DIR/blackceo-council"
EXEC_SRC="$REPO_ROOT/launchers/macos/blackceo-council"
[ -f "$EXEC_SRC" ] || die COUNCIL_LAUNCHER_MISSING "launcher template missing: $EXEC_SRC" 4
if [ -e "$EXEC_DEST" ] && ! grep -q 'blackceo-council (CWE-040)' "$EXEC_DEST" 2>/dev/null; then
  die COUNCIL_EXECUTABLE_FOREIGN "$EXEC_DEST exists and is not the council executable; refusing to overwrite it. Move it aside and re-run" 4
fi
mkdir -p "$BIN_DIR"
cp "$EXEC_SRC" "$EXEC_DEST" && chmod 755 "$EXEC_DEST" \
  || die COUNCIL_EXECUTABLE_FAILED "could not install the executable at $EXEC_DEST" 4
printf '%s\n' "$DATA_DIR" > "$BIN_DIR/blackceo-council.profile" \
  || die COUNCIL_EXECUTABLE_FAILED "could not record the profile root beside the executable" 4
say "executable: $EXEC_DEST"

say "OK: council runtime $AGGREGATE is current; data profile $DATA_DIR"
exit 0
