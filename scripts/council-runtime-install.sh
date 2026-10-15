#!/bin/bash
# Council of Wise Elders: runtime installer for 999-distributed installs
# (CWE-040; directive Section 25.2 steps 5 and 6, Section 16.1).
#
# What it does:
#   1. Finds the installed council skill folder (through a Claude config
#      root link) and reads its distribution identity (manifest.json
#      aggregate hash).
#   2. Stages the runtime payload into a versioned per-user prefix
#      OUTSIDE every config/discovery root:
#        macOS: ~/Library/Application Support/BlackCEO/WiseElders/runtime/<aggregate>
#        Linux: ${XDG_DATA_HOME:-$HOME/.local/share}/blackceo/wise-elders/runtime/<aggregate>
#      Node modules exist only inside that prefix, never in the shared
#      synchronized skill folder. The generated Claude-Nine host wrapper
#      is emitted into the staged dist from the CWE-010 template in the
#      vendored runtime (renderClaudeNineWrapper()).
#   3. Gates the staged prefix: the package doctor must pass on the
#      installed skill folder, and the staged CLI doctor (through the
#      generated wrapper and the bundle resolver) must exit 0.
#   4. Atomically swaps the prefix's `current` link to the gated build.
#      A failed gate leaves `current` exactly as it was.
#   5. Installs the blackceo-council executable (launchers/macos/
#      blackceo-council) into the bin dir. A foreign file at that path
#      is never overwritten; the install refuses and says why.
#
# Council state is created only inside the data profile (the CLI doctor
# opens the store there). The skill folder is never written to.
#
# Usage:
#   scripts/council-runtime-install.sh [--skill-dir DIR] [--data-dir DIR]
#                                      [--bin-dir DIR] [--offline] [--check]
# Exit codes: 0 ok; 4 preflight (node/npm/skill/manifest missing or a
# foreign executable); 5 dependency install failed; 6 build failed;
# 7 doctor gate failed.
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
DATA_DIR=""
BIN_DIR="$HOME/.local/bin"
OFFLINE=0
CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skill-dir) SKILL_DIR="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    --offline) OFFLINE=1; shift ;;
    --check) CHECK=1; shift ;;
    -h|--help) sed -n '2,40p' "$SELF"; exit 0 ;;
    *) echo "council-runtime-install: unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { echo "council-runtime-install: $*"; }
die() { say "ERROR $1: $2" >&2; exit "$3"; }

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
AGGREGATE="$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$SKILL_DIR/manifest.json" 2>/dev/null || true)"
[ -n "$AGGREGATE" ] \
  || die COUNCIL_SKILL_MANIFEST_INVALID "could not read aggregate_sha256 from $SKILL_DIR/manifest.json" 4
say "skill folder: $SKILL_DIR"
say "distribution aggregate: $AGGREGATE"

RUNTIME_DIR="$DATA_DIR/runtime"
PREFIX="$RUNTIME_DIR/$AGGREGATE"
CURRENT="$RUNTIME_DIR/current"

prefix_gates() {
  # $1 = prefix root to gate. Package doctor on the skill folder plus the
  # CLI doctor through the generated wrapper, against the real profile.
  "$NODE_BIN" "$SKILL_DIR/scripts/doctor.mjs" --root "$SKILL_DIR" >/dev/null 2>&1 || return 1
  [ -f "$1/run-council.mjs" ] || return 1
  "$NODE_BIN" "$1/run-council.mjs" doctor --data-dir "$DATA_DIR" >/dev/null 2>&1 || return 1
  return 0
}

if [ "$CHECK" -eq 1 ]; then
  if [ -L "$CURRENT" ] && [ "$(readlink "$CURRENT")" = "$AGGREGATE" ]; then
    say "current: $AGGREGATE (matches the installed skill)"
  elif [ -e "$CURRENT" ]; then
    say "current: $(readlink "$CURRENT" 2>/dev/null || echo '(not a link)') (does not match the installed skill aggregate)"
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
  cp -R "$SKILL_DIR/runtime" "$STAGE/runtime" \
    || die COUNCIL_STAGE_FAILED "could not copy the runtime payload from $SKILL_DIR" 5
  # Build outputs are regenerated below; never carried into the prefix.
  rm -rf "$STAGE/runtime/node_modules" "$STAGE/runtime/dist"
  cp "$SELF_DIR/council/run-council.mjs" "$STAGE/run-council.mjs" \
    || die COUNCIL_STAGE_FAILED "bundle entry run-council.mjs missing beside this script" 5
  cp "$SELF_DIR/council/bundle-native-resolver.mjs" "$STAGE/bundle-native-resolver.mjs" \
    || die COUNCIL_STAGE_FAILED "bundle resolver missing beside this script" 5

  NPM_FLAGS="--no-audit --no-fund"
  [ "$OFFLINE" -eq 1 ] && NPM_FLAGS="$NPM_FLAGS --offline"
  say "installing runtime dependencies (npm ci)..."
  if ! (cd "$STAGE/runtime" && "$NPM_BIN" ci $NPM_FLAGS >"$STAGE/npm-ci.log" 2>&1); then
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
  printf '{ "aggregate": "%s", "skill_dir": "%s", "node": "%s" }\n' \
    "$AGGREGATE" "$SKILL_DIR" "$("$NODE_BIN" --version)" > "$STAGE/install-record.json"

  say "gating the staged prefix (package doctor + CLI doctor)..."
  if ! prefix_gates "$STAGE"; then
    rm -rf "$STAGE"
    die COUNCIL_DOCTOR_FAILED "the staged runtime did not pass the doctor gates. Staging was removed; current is unchanged" 7
  fi
  printf 'ok\n' > "$STAGE/.install-complete"
  rm -rf "$PREFIX"
  mkdir -p "$RUNTIME_DIR"
  mv "$STAGE" "$PREFIX" || die COUNCIL_SWAP_FAILED "could not move the gated prefix into place" 7
  say "prefix installed: $PREFIX"
fi

# --- atomic current swap ---------------------------------------------------
mkdir -p "$RUNTIME_DIR"
TMP_LINK="$RUNTIME_DIR/.current.tmp.$$"
rm -f "$TMP_LINK"
ln -s "$AGGREGATE" "$TMP_LINK" || die COUNCIL_SWAP_FAILED "could not stage the current link" 7
mv -f "$TMP_LINK" "$CURRENT" || die COUNCIL_SWAP_FAILED "could not swap the current link" 7
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
