#!/bin/bash
# Council of Wise Elders: runtime installer for 999-distributed installs
# (CWE-040; directive Section 25.2 steps 5 and 6, Section 16.1).
#
# What it does:
#   0. Runs the canonical installer's exact Node prerequisite probe
#      (openclaw-onboarding 77-council-of-wise-elders
#      scripts/install-runtime.mjs probeRuntime) against the resolved
#      node executable: the 22.13+/24+ version gate plus the
#      node:sqlite in-memory read/write and persistent reopen probe.
#      A failed probe refuses the install before anything is written.
#   0b. Resolves the installed council skill folder to the CANONICAL
#      portable source: a discovered folder must be the registered
#      999 distribution of openclaw-onboarding/77-council-of-wise-elders
#      (installer-registration/council-vendoring.json). A copied folder
#      is not separately editable product; a drifted copy is refused
#      with the re-vendor instruction. An explicitly passed --skill-dir
#      is an operator override of this gate (the doctor still gates
#      it structurally).
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
#      A failed gate leaves `current` exactly as it was; the previous
#      release tree is never removed before the new prefix is in place.
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
# Exit codes: 0 ok; 4 preflight (node/npm/skill/manifest/probe/canonical
# identity missing or a foreign executable); 5 dependency install failed;
# 6 build failed; 7 doctor gate failed.
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
NODE_BIN="$(readlink -f "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")"

# --- canonical Node prerequisite probe (WER-004) --------------------------
# The canonical installer's exact gate (openclaw-onboarding
# 77-council-of-wise-elders scripts/node-runtime-preflight.mjs), run
# against the RESOLVED executable: the 22.13+/24+ version gate and the
# node:sqlite in-memory create/insert/read/close plus persistent
# create/close/reopen probe. A failed probe refuses the install before
# anything is written; the previous release stays usable untouched.
# The module is distributed with the 999 installer beside this script
# (scripts/council/node-runtime-preflight.mjs, byte-identical copy of
# the canonical file); the vendored skill folder's own copy is
# preferred when the distribution carries one, so a newer re-vendored
# distribution's gate always wins.
CANONICAL_PROBE="$REPO_ROOT/.claude/skills/council-of-wise-elders/scripts/node-runtime-preflight.mjs"
[ -f "$CANONICAL_PROBE" ] || CANONICAL_PROBE="$SELF_DIR/council/node-runtime-preflight.mjs"
if [ ! -f "$CANONICAL_PROBE" ]; then
  die COUNCIL_PROBE_MISSING "the canonical Node prerequisite probe is missing: neither the vendored distribution nor scripts/council/node-runtime-preflight.mjs carries it. Re-vendor the council bundle with scripts/vendor-council-bundle.mjs" 4
fi
PROBE_RC=0
probe_out="$("$NODE_BIN" --input-type=module -e '
const { isSupportedCouncilRuntimeNode, verifyCouncilSqlite } = await import(process.argv[1]);
const { spawnSync } = await import("node:child_process");
const versionRun = spawnSync(process.execPath, ["--version"], { encoding: "utf8" });
if (versionRun.status !== 0) { console.error("COUNCIL_NODE_VERSION_UNREADABLE"); process.exit(1); }
const version = `${versionRun.stdout || ""}`.trim();
if (!isSupportedCouncilRuntimeNode(version)) { console.error(`COUNCIL_NODE_UNSUPPORTED ${version}`); process.exit(1); }
await verifyCouncilSqlite();
console.log(`COUNCIL-NODE-PROBE: PASS ${version}`);
' "$CANONICAL_PROBE" 2>&1)" || PROBE_RC=$?
if [ "$PROBE_RC" -ne 0 ] || ! printf '%s' "$probe_out" | grep -q "COUNCIL-NODE-PROBE: PASS"; then
  die COUNCIL_NODE_PREREQ_FAILED "the canonical Node prerequisite probe failed for $NODE_BIN: ${probe_out:-no output}. Council requires Node 22.13+ or 24+ with a working node:sqlite; nothing was written and the previous release is unchanged" 4
fi
say "canonical Node prerequisite probe: PASS ($("$NODE_BIN" --version 2>/dev/null || echo node))"

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

# --- canonical-source resolution (WER-004) --------------------------------
# The council is NOT separately editable product: a resolved skill
# folder must be a REGISTERED 999 distribution of the canonical
# openclaw-onboarding/77-council-of-wise-elders source. Registered
# means: its manifest carries the canonical identity (source_commit +
# canonical_aggregate_sha256) of a release this repository produced
# through scripts/vendor-council-bundle.mjs — either the live vendored
# release (recorded in installer-registration/council-vendoring.json)
# or a historical release proven from this repository's own git
# history. A copied folder that drifted, or a foreign folder wearing
# the name, is refused with the re-vendor instruction. --skill-dir is
# the operator override, and the same gate applies to it: the swap
# battery's historical releases are themselves registered releases.
VENDORING_RECORD="$REPO_ROOT/installer-registration/council-vendoring.json"
[ -f "$VENDORING_RECORD" ] \
  || die COUNCIL_REGISTRATION_MISSING "the vendoring registration is missing: $VENDORING_RECORD. Re-vendor the council bundle with scripts/vendor-council-bundle.mjs" 4
IDENTITY_RC=0
identity="$("$NODE_BIN" - "$SKILL_DIR/manifest.json" "$VENDORING_RECORD" "$REPO_ROOT" <<'EOF' 2>&1
const [manifestPath, recordPath, repoRoot] = process.argv.slice(2);
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const record = JSON.parse(readFileSync(recordPath, "utf8"));
const problems = [];
const isLiveRelease = manifest.source_commit === record.canonical_source.source_commit
  && manifest.canonical_aggregate_sha256 === record.canonical_source.canonical_aggregate_sha256
  && manifest.aggregate_sha256 === record.distribution.distribution_aggregate_sha256;
// A registered 999 distribution is either the LIVE vendored release
// (the registration record) or a HISTORICAL release this repository
// itself produced: every field of its manifest (distribution aggregate,
// source_commit, canonical_aggregate_sha256) matches a manifest.json
// that exists in this repository's own git history of the vendored
// folder. The swap battery installs exactly such historical releases.
if (!isLiveRelease) {
  let known = false;
  try {
    const log = execFileSync("git", ["-C", repoRoot, "log", "--format=%H",
      "--", ".claude/skills/council-of-wise-elders/manifest.json"], { encoding: "utf8" });
    for (const sha of log.split("\n")) {
      if (!sha) continue;
      try {
        const historical = JSON.parse(execFileSync("git",
          ["-C", repoRoot, "show", `${sha}:.claude/skills/council-of-wise-elders/manifest.json`],
          { encoding: "utf8" }));
        if (historical.aggregate_sha256 === manifest.aggregate_sha256
          && historical.source_commit === manifest.source_commit
          && historical.canonical_aggregate_sha256 === manifest.canonical_aggregate_sha256) {
          known = true;
          break;
        }
      } catch {}
    }
  } catch {}
  if (!known) {
    if (manifest.source_commit !== record.canonical_source.source_commit) {
      problems.push(`source_commit ${manifest.source_commit ?? "(absent)"} is not the registered canonical ${record.canonical_source.source_commit}`);
    }
    if (manifest.canonical_aggregate_sha256 !== record.canonical_source.canonical_aggregate_sha256) {
      problems.push(`canonical_aggregate_sha256 ${manifest.canonical_aggregate_sha256 ?? "(absent)"} is not the registered canonical ${record.canonical_source.canonical_aggregate_sha256}`);
    }
    problems.push(`distribution aggregate ${manifest.aggregate_sha256} is not the live release or any registered release in this repository's vendoring history`);
  }
}
if (problems.length) {
  console.error(`COUNCIL_NOT_CANONICAL_SOURCE: ${problems.join("; ")}. The council skill is the canonical openclaw-onboarding/77-council-of-wise-elders distribution vendored into this repository, never separately editable product. Re-vendor with scripts/vendor-council-bundle.mjs --source <canonical tree> --source-commit <sha>`);
  process.exit(1);
}
// Byte-identity: the tree must recompute to its own claimed aggregate
// (the canonical hash method). A copied folder that was edited in
// place — the separately-editable-product failure — is refused here,
// with the previous release untouched.
{
  const { createHash } = require("node:crypto");
  const { readdirSync, statSync } = require("node:fs");
  const skillDir = require("node:path").dirname(manifestPath);
  const pairs = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = require("node:path").join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const rel = require("node:path").relative(skillDir, p).split("\\").join("/");
        if (rel === "manifest.json" || rel.endsWith(".skill")) continue;
        pairs.push({ path: rel, hash: createHash("sha256").update(readFileSync(p)).digest("hex") });
      }
    }
  };
  walk(skillDir);
  pairs.sort((a, b) => (a.path < b.path ? -1 : 1));
  const entries = pairs.map((x) => `${x.hash}  ${x.path}`);
  const aggregate = createHash("sha256").update(Buffer.from(entries.join("\n") + "\n", "utf8")).digest("hex");
  if (aggregate !== manifest.aggregate_sha256 || entries.length !== manifest.file_count) {
    console.error(`COUNCIL_NOT_CANONICAL_SOURCE: the skill folder does not recompute to its own manifest (computed ${aggregate} over ${entries.length} files, manifest claims ${manifest.aggregate_sha256} over ${manifest.file_count}); it has been edited since the registered release and is not valid product. Re-vendor with scripts/vendor-council-bundle.mjs`);
    process.exit(1);
  }
}
console.log("COUNCIL-CANONICAL: OK");
EOF
)" || IDENTITY_RC=$?
if [ "$IDENTITY_RC" -ne 0 ]; then
  printf '%s\n' "$identity" >&2
  die COUNCIL_NOT_CANONICAL_SOURCE "the resolved skill folder is not a registered canonical council distribution; see the error above. Nothing was written and the previous release is unchanged" 4
fi
say "canonical-source identity: registered 999 distribution of openclaw-onboarding/77-council-of-wise-elders"

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
  # A failed staged build must leave NO skeleton behind on a clean
  # profile: remember whether the runtime dir already existed, and
  # remove it again if this install created it and the stage failed.
  RUNTIME_DIR_EXISTED=0
  [ -d "$RUNTIME_DIR" ] && RUNTIME_DIR_EXISTED=1
  cleanup_stage() {
    rm -rf "$STAGE"
    if [ "$RUNTIME_DIR_EXISTED" -eq 0 ]; then
      rmdir "$RUNTIME_DIR" 2>/dev/null || true
      rmdir "$(dirname "$RUNTIME_DIR")" 2>/dev/null || true
    fi
  }
  mkdir -p "$STAGE" || { cleanup_stage; die COUNCIL_STAGE_FAILED "could not create staging dir $STAGE" 5; }
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
    cleanup_stage
    die COUNCIL_NPM_CI_FAILED "npm ci failed for the pinned runtime dependencies (log tail above). Staging was removed; current is unchanged" 5
  fi
  say "building the runtime (tsc + esbuild bundle)..."
  if ! (cd "$STAGE/runtime" && "$NPM_BIN" run build >"$STAGE/build.log" 2>&1); then
    tail -5 "$STAGE/build.log" >&2 || true
    cleanup_stage
    die COUNCIL_BUILD_FAILED "the runtime build failed (log tail above). Staging was removed; current is unchanged" 6
  fi
  # The canonical bundle step (copy-runtime-assets.mjs, CWE-039 F-1)
  # copies the persistence schema SQL into dist at build time; the
  # persistence layer loads it relative to its module, so its absence
  # would only surface when the store first opens. Assert it landed.
  [ -f "$STAGE/runtime/dist/migrations/0001-council-schema.sql" ] \
    || { cleanup_stage; die COUNCIL_BUILD_FAILED "the built runtime is missing dist/migrations/0001-council-schema.sql (the canonical copy-runtime-assets step did not run). Staging was removed; current is unchanged" 6; }
  # Emit the generated Claude-Nine host wrapper from the CWE-010 template.
  # The render runs through the staged runtime's own tsx: the canonical
  # contracts package uses extensionless import specifiers, which plain
  # Node ESM cannot resolve from source or tsc output.
  printf '%s\n' 'import { renderClaudeNineWrapper } from "./runtime/src/bridges/claude-nine.ts";' \
    'process.stdout.write(renderClaudeNineWrapper());' > "$STAGE/emit-wrapper.mts"
  if ! "$STAGE/runtime/node_modules/.bin/tsx" "$STAGE/emit-wrapper.mts" \
      > "$STAGE/runtime/dist/claude-nine-host-wrapper.mjs" 2>"$STAGE/wrapper.log"; then
    tail -5 "$STAGE/wrapper.log" >&2 || true
    cleanup_stage
    die COUNCIL_BUILD_FAILED "emitting the generated host wrapper from the CWE-010 template failed. Staging was removed; current is unchanged" 6
  fi
  rm -f "$STAGE/emit-wrapper.mts"
  grep -q "createClaudeNineBridge" "$STAGE/runtime/dist/claude-nine-host-wrapper.mjs" \
    || { cleanup_stage; die COUNCIL_BUILD_FAILED "the generated host wrapper does not compose createClaudeNineBridge. Staging was removed; current is unchanged" 6; }
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
    cleanup_stage
    die COUNCIL_BUILD_FAILED "bundling the council entry failed. Staging was removed; current is unchanged" 6
  fi
  rm -f "$STAGE/runtime/bundle-entry.mjs"
  printf '{ "aggregate": "%s", "skill_dir": "%s", "node": "%s" }\n' \
    "$AGGREGATE" "$SKILL_DIR" "$("$NODE_BIN" --version)" > "$STAGE/install-record.json"

  say "gating the staged prefix (package doctor + CLI doctor)..."
  if ! prefix_gates "$STAGE"; then
    cleanup_stage
    die COUNCIL_DOCTOR_FAILED "the staged runtime did not pass the doctor gates. Staging was removed; current is unchanged" 7
  fi
  printf 'ok\n' > "$STAGE/.install-complete"
  # Prior-release safety: never remove the prefix that `current` points
  # at before its replacement is in place. If this aggregate is already
  # current (a rebuild of the same aggregate), move the old prefix aside
  # first; if the move-in then fails, move it back so the previous
  # release stays usable.
  if [ "$(readlink "$CURRENT" 2>/dev/null)" = "$AGGREGATE" ] && [ -d "$PREFIX" ]; then
    OLD_PREFIX="$RUNTIME_DIR/.old-prefix.$$"
    rm -rf "$OLD_PREFIX"
    if ! mv "$PREFIX" "$OLD_PREFIX"; then
      die COUNCIL_SWAP_FAILED "could not stage the replacement of the current prefix $PREFIX; current is unchanged" 7
    fi
    if mv "$STAGE" "$PREFIX"; then
      rm -rf "$OLD_PREFIX"
    else
      mv "$OLD_PREFIX" "$PREFIX" || true
      die COUNCIL_SWAP_FAILED "could not move the gated prefix into place; the previous release was restored and current is unchanged" 7
    fi
  else
    rm -rf "$PREFIX"
    mkdir -p "$RUNTIME_DIR"
    mv "$STAGE" "$PREFIX" || die COUNCIL_SWAP_FAILED "could not move the gated prefix into place" 7
  fi
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
