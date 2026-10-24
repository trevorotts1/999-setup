#!/bin/bash
# Council runtime install: doctor mode derivation, all three directions.
#
# The installer derives the doctor's verification mode from the resolved
# tree (scripts/council-doctor-mode.mjs); it never hardcodes
# --distribution and never reads the mode from the manifest status alone.
#
# Legs:
#   A. VENDORED: the shipped tree (no archive, status extracted_distribution)
#      derives distribution, passes the doctor, and the FULL installer
#      completes offline against it (the 43-failure cascade). --check passes.
#   B. CANONICAL: a tree built the way scripts/build-bundles.mjs writes one
#      (real archive + status generated, archive SHA-256 bound) derives
#      source, passes the doctor, and the FULL installer completes against
#      it with the archive binding intact. A stale archive is REFUSED.
#   C. NEGATIVE: an extracted distribution with the archive removed and
#      status relabelled is refused by the derivation and by the installer
#      with COUNCIL_SOURCE_MODE_UNDETERMINED, before any write. The refusal
#      is also proven on the gated-skill arm that --check uses.
#   D. Both installers derive the mode at every former hardcoded call site.
#
# Everything runs under a fixture HOME in ${TMPDIR:-/tmp}. Offline only.
# Run: bash scripts/test-council-doctor-mode.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unset CLAUDE_CONFIG_DIR
INSTALL_SH="$REPO_ROOT/scripts/council-runtime-install.sh"
MODE_TOOL="$REPO_ROOT/scripts/council-doctor-mode.mjs"
VENDORED="$REPO_ROOT/.claude/skills/council-of-wise-elders"
ARCHIVE_NAME="council-of-wise-elders.skill"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

# Unique per-invocation fixture root so concurrent runs never share state.
BASE="$(mktemp -d "${TMPDIR:-/tmp}/cwe-doctor-mode.XXXXXX")" || { echo "FAIL: cannot create fixture dir"; exit 1; }
trap 'rm -rf "$BASE"' EXIT
trap 'exit 1' INT TERM HUP
# Warm the fixture cache from the operator cache if present, else install
# reads it as-is; --offline means no network either way. A cold cache is a
# leg result, never mistaken for a mode-derivation failure.
mkdir -p "$BASE/npm-cache"
for cache in "${npm_config_cache:-}" "$HOME/.npm"; do
  if [ -n "$cache" ] && [ -d "$cache/_cacache" ] && [ "$cache" != "$BASE/npm-cache" ]; then
    cp -R "$cache/_cacache" "$BASE/npm-cache/"
    break
  fi
done
export npm_config_cache="$BASE/npm-cache"
NPM_CACHE_WARM=0
[ -d "$BASE/npm-cache/_cacache" ] && NPM_CACHE_WARM=1
AGG="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aggregate_sha256)' "$VENDORED/manifest.json")"

# Discovered skill folder for a fixture HOME: the vendored tree linked in.
make_home() { # $1 home
  mkdir -p "$1/.claude/skills"
  ln -s "$VENDORED" "$1/.claude/skills/council-of-wise-elders"
}

derive() { node "$MODE_TOOL" --root "$1" 2>&1; }

echo "== A. vendored/extracted source =="
OUT="$(derive "$VENDORED")"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "distribution" ] \
  && pass "vendored tree derives distribution" || fail "vendored derive: rc=$RC out=$OUT"
node "$VENDORED/scripts/doctor.mjs" --root "$VENDORED" --distribution > "$BASE/a-doctor.log" 2>&1
[ $? = 0 ] && pass "doctor passes on the vendored tree in derived mode" \
  || { fail "doctor failed on the vendored tree"; tail -3 "$BASE/a-doctor.log"; }
HA="$BASE/homeA"; make_home "$HA"; DATAA="$HA/data"
HOME="$HA" bash "$INSTALL_SH" --offline --data-dir "$DATAA" > "$BASE/a-install.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "offline install against the vendored tree exits 0 (cascade cleared)" \
  || { fail "offline vendored install exited $RC"; tail -5 "$BASE/a-install.log"; }
grep -q '^council-runtime-install: source doctor mode: distribution$' "$BASE/a-install.log" \
  && pass "installer derived distribution for the vendored source" \
  || fail "installer did not derive distribution for the vendored source"
[ -L "$DATAA/runtime/current" ] && [ "$(readlink "$DATAA/runtime/current")" = "$AGG" ] \
  && pass "current points at the installed aggregate" || fail "current link wrong"
HOME="$HA" bash "$INSTALL_SH" --offline --data-dir "$DATAA" --check > "$BASE/a-check.log" 2>&1; RC=$?
[ "$RC" = 0 ] && grep -q 'doctor gates: PASS' "$BASE/a-check.log" \
  && pass "--check derives distribution on the gated skill folder and passes" \
  || { fail "--check exited $RC"; tail -3 "$BASE/a-check.log"; }

echo "== B. canonical source with a real archive =="
CANON="$BASE/canonical"
node -e '
const fs = require("node:fs");
const { join, relative } = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const [src, out] = process.argv.slice(1);
const skip = (rel) => rel.endsWith(".skill")
  || rel === "runtime/dist" || rel.startsWith("runtime/dist/")
  || rel === "runtime/node_modules" || rel.startsWith("runtime/node_modules/");
const relOf = (base, p) => relative(base, p).split("\\").join("/");
fs.cpSync(src, out, { recursive: true, filter: (p) => {
  const rel = relOf(src, p);
  if (!rel) return true;
  return !p.endsWith(".skill") && !skip(rel);
} });
fs.writeFileSync(join(out, "council-of-wise-elders.skill"),
  Buffer.concat([randomBytes(4096), Buffer.from("canonical archive fixture")]));
const walk = (dir, base, acc = []) => {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = join(dir, name);
    const rel = relOf(base, p);
    if (rel === "manifest.json" || skip(rel)) continue;
    if (fs.lstatSync(p).isDirectory()) walk(p, base, acc); else acc.push(p);
  }
  return acc;
};
const entries = walk(out, out).sort().map((p) => {
  const bytes = fs.readFileSync(p);
  return { path: relOf(out, p), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
});
const hashLines = (list) => createHash("sha256").update(list.map((e) => e.sha256 + "  " + e.path).join("\n") + "\n", "utf8").digest("hex");
const m = JSON.parse(fs.readFileSync(join(out, "manifest.json"), "utf8"));
m.files = entries;
m.file_count = entries.length;
m.aggregate_sha256 = hashLines(entries);
// A canonical source package (build-bundles.mjs shape) records no
// runtime_entry: the built entry is a distribution artifact. The fixture
// strips runtime/dist above, so the copied distribution record must go
// with it.
delete m.runtime_entry;
m.archive = { ...m.archive, status: "generated", sha256: createHash("sha256").update(fs.readFileSync(join(out, "council-of-wise-elders.skill"))).digest("hex") };
fs.writeFileSync(join(out, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
console.log("canonical fixture:", entries.length, "files, aggregate", m.aggregate_sha256);
' "$VENDORED" "$CANON" || fail "canonical fixture build failed"
OUT="$(derive "$CANON")"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "source" ] \
  && pass "canonical tree derives source" || fail "canonical derive: rc=$RC out=$OUT"
node "$CANON/scripts/doctor.mjs" --root "$CANON" --source > "$BASE/b-doctor.log" 2>&1
[ $? = 0 ] && grep -q 'source archive SHA-256 matches the source manifest' "$BASE/b-doctor.log" \
  && pass "doctor passes in source mode with the archive binding intact" \
  || { fail "doctor failed in source mode"; grep '^FAIL' "$BASE/b-doctor.log"; }
HB="$BASE/homeB"; make_home "$HB"; DATAB="$HB/data"
# The canonical tree supplies the runtime payload; the discovered vendored
# tree supplies the gated skill folder. Two derivations in one run, both
# passing: source for the payload, distribution for the gated tree.
HOME="$HB" bash "$INSTALL_SH" --offline --source-dir "$CANON" --data-dir "$DATAB" > "$BASE/b-install.log" 2>&1; RC=$?
[ "$RC" = 0 ] && pass "offline install against the canonical source exits 0" \
  || { fail "canonical install exited $RC"; tail -5 "$BASE/b-install.log"; }
grep -q '^council-runtime-install: source doctor mode: source$' "$BASE/b-install.log" \
  && pass "installer derived source for the canonical source" \
  || fail "installer did not derive source for the canonical source"
[ -L "$DATAB/runtime/current" ] && [ "$(readlink "$DATAB/runtime/current")" = "$AGG" ] \
  && pass "canonical install swapped current to the installed aggregate" \
  || fail "canonical install left no current link"
# A stale archive in the canonical tree must be refused. The skill folder
# is still the vendored tree (distribution), so only the source arm can
# refuse this.
printf 'stale\n' >> "$CANON/$ARCHIVE_NAME"
HOME="$HB" bash "$INSTALL_SH" --offline --source-dir "$CANON" --data-dir "$DATAB" > "$BASE/b-stale.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_SOURCE_DOCTOR_FAILED' "$BASE/b-stale.log" \
  && pass "a canonical tree with a stale archive is refused (COUNCIL_SOURCE_DOCTOR_FAILED, exit 4)" \
  || fail "stale archive: rc=$RC (want 4 with COUNCIL_SOURCE_DOCTOR_FAILED)"
[ "$(readlink "$DATAB/runtime/current" 2>/dev/null || true)" = "$AGG" ] \
  && pass "the previous release stayed current after the refused canonical source" \
  || fail "the refused canonical source changed current"

echo "== C. NEGATIVE: archive stripped and status relabelled =="
MASK="$BASE/masked"
cp -R "$VENDORED" "$MASK"
rm -f "$MASK/$ARCHIVE_NAME"
node -e '
const fs = require("node:fs");
const f = process.argv[1];
const m = JSON.parse(fs.readFileSync(f, "utf8"));
m.archive.status = "generated";
delete m.archive.sha256;
fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
' "$MASK/manifest.json"
OUT="$(derive "$MASK")"; RC=$?
[ "$RC" = 1 ] && printf '%s' "$OUT" | grep -q 'neither a source package' \
  && pass "derivation refuses a distribution with the archive stripped and status relabelled" \
  || fail "masked tree was not refused by derivation: rc=$RC out=$OUT"
node "$MODE_TOOL" --root "$MASK" >/dev/null 2>/dev/null; RC=$?
[ "$RC" = 1 ] && pass "derivation exits 1 (no mode printed to stdout)" \
  || fail "derivation exit was $RC (want 1)"
HC="$BASE/homeC"; make_home "$HC"
HOME="$HC" bash "$INSTALL_SH" --offline --source-dir "$MASK" --data-dir "$HC/data" > "$BASE/c-install.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_SOURCE_MODE_UNDETERMINED' "$BASE/c-install.log" \
  && pass "installer refuses the masked source (COUNCIL_SOURCE_MODE_UNDETERMINED, exit 4)" \
  || fail "masked install: rc=$RC (want 4 with COUNCIL_SOURCE_MODE_UNDETERMINED)"
[ ! -e "$HC/data/runtime/current" ] && [ ! -e "$HC/data/runtime" ] \
  && pass "the masked source created no runtime directory" \
  || fail "the masked source wrote to the data profile"
# The gated-skill arm that --check serves: discovery finds the masked tree.
# The source arm (the vendored tree) derives distribution and passes in the
# same run, so the refusal can only come from the gated skill folder, and
# --check must refuse before it ever touches the installed prefix.
HD="$BASE/homeD"; mkdir -p "$HD/.claude/skills"; ln -s "$MASK" "$HD/.claude/skills/council-of-wise-elders"
HOME="$HD" bash "$INSTALL_SH" --offline --data-dir "$HD/data" > "$BASE/d-install.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_SOURCE_MODE_UNDETERMINED: the portable source' "$BASE/d-install.log" \
  && pass "an install whose discovered skill folder is masked is refused at the source gate" \
  || fail "masked discovered skill: rc=$RC (want 4 with COUNCIL_SOURCE_MODE_UNDETERMINED)"
mkdir -p "$HD/data/runtime/$AGG" && printf 'ok\n' > "$HD/data/runtime/$AGG/.install-complete" \
  && ln -s "$AGG" "$HD/data/runtime/current"
HOME="$HD" bash "$INSTALL_SH" --offline --data-dir "$HD/data" --check > "$BASE/d-check.log" 2>&1; RC=$?
[ "$RC" = 4 ] && grep -q 'COUNCIL_SOURCE_MODE_UNDETERMINED: the portable source' "$BASE/d-check.log" \
  && pass "--check refuses a masked skill folder before touching the prefix" \
  || { fail "--check on a masked skill folder: rc=$RC"; tail -3 "$BASE/d-check.log"; }
# And the masked tree cannot pass the doctor under EITHER name, so no
# static flag hardcoded by a future caller silently accepts it.
node "$MASK/scripts/doctor.mjs" --root "$MASK" >/dev/null 2>&1; R1=$?
node "$MASK/scripts/doctor.mjs" --root "$MASK" --distribution >/dev/null 2>&1; R2=$?
node "$MASK/scripts/doctor.mjs" --root "$MASK" --source >/dev/null 2>&1; R3=$?
[ "$R1" != 0 ] && [ "$R2" != 0 ] && [ "$R3" != 0 ] \
  && pass "masked tree fails the doctor in every mode (default=$R1 distribution=$R2 source=$R3)" \
  || fail "masked tree passed the doctor in a mode: default=$R1 distribution=$R2 source=$R3"

echo "== D. both installers derive the mode at every former call site =="
SH="$INSTALL_SH"; PS1="$REPO_ROOT/scripts/council-runtime-install.ps1"
for f in "$SH" "$PS1"; do
  n="$(grep -c 'doctor\.mjs' "$f")"
  hard="$(grep -c 'doctor\.mjs"* *--root [^|]*--distribution\|doctor\.mjs --root" *--distribution' "$f" || true)"
  [ "$hard" = 0 ] && pass "$(basename "$f"): no doctor.mjs call hardcodes --distribution" \
    || fail "$(basename "$f"): $hard hardcoded --distribution call(s)"
  [ "$n" = 2 ] && pass "$(basename "$f"): both doctor call sites present" \
    || fail "$(basename "$f"): expected 2 doctor call sites, found $n"
  grep -q 'council-doctor-mode.mjs' "$f" && pass "$(basename "$f"): derives through council-doctor-mode.mjs" \
    || fail "$(basename "$f"): does not derive through council-doctor-mode.mjs"
done
# Shell: both call sites pass the derived mode (the doctor never gets a
# static flag); PowerShell: both call sites interpolate a derived variable.
grep -q '\-\-"\$DOCTOR_MODE_SOURCE"' "$SH" \
  && pass "sh source call passes the derived source mode" \
  || fail "sh source call does not pass the derived source mode"
grep -q '\-\-"\$skill_mode"' "$SH" \
  && pass "sh prefix-gates call passes the derived skill mode (serves --check)" \
  || fail "sh prefix-gates call does not pass a derived skill mode"
command grep -qF -e '--root "$SourceDir" "--$sourceMode"' -e '--root "$SourceDir" "--$DOCTOR_MODE_SOURCE"' -- "$PS1" \
  && pass "ps1 source call passes the derived source mode" \
  || fail "ps1 source call does not pass a derived source mode"
command grep -qF -e '--root "$SkillDir" "--$skillMode"' -e '--root "$SkillDir" "--$DOCTOR_MODE_SKILL"' -- "$PS1" \
  && pass "ps1 Test-PrefixGates passes the derived skill mode (serves -Check)" \
  || fail "ps1 Test-PrefixGates does not pass a derived skill mode"

echo "== E. ps1 resolves the doctor only after SkillDir discovery =="
# $SkillDir defaults to '' and is discovered near the end of preflight. A
# $skillDoctor computed before that tests "\scripts\doctor.mjs", fails, and
# dies COUNCIL_SKILL_DOCTOR_MISSING before discovery ever runs. Static
# ordering check: discovery assignment < $skillDoctor assignment < Die guard.
disc="$(grep -n '^\$SkillDir = (Resolve-Path' "$PS1" | head -1 | cut -d: -f1)"
sd="$(grep -n '^\$skillDoctor = Join-Path' "$PS1" | head -1 | cut -d: -f1)"
guard="$(grep -n "Die 'COUNCIL_SKILL_DOCTOR_MISSING'" "$PS1" | head -1 | cut -d: -f1)"
[ -n "$disc" ] && [ -n "$sd" ] && [ -n "$guard" ] \
  && pass "ps1: discovery ($disc), \$skillDoctor ($sd), guard ($guard) all present" \
  || fail "ps1: missing discovery/$skillDoctor/guard line (disc=$disc sd=$sd guard=$guard)"
[ -n "$disc" ] && [ -n "$sd" ] && [ -n "$guard" ] && [ "$disc" -lt "$sd" ] && [ "$sd" -lt "$guard" ] \
  && pass "ps1: \$skillDoctor and its Die guard follow SkillDir discovery" \
  || fail "ps1: \$skillDoctor/guard resolve before SkillDir discovery (disc=$disc sd=$sd guard=$guard)"

echo "== F. CLI entry guard works when the path has a space or a symlink =="
# The CLI only runs when argv[1] names this module. A guard that compared
# argv[1] to the percent-encoded URL pathname (or skipped realpath) was
# false on "/Volumes/External Drive/..." and under a symlinked temp dir:
# exit 0, EMPTY stdout, and every install leg then died with
# COUNCIL_SOURCE_MODE_UNDETERMINED.
SP="$BASE/dir with space"; mkdir -p "$SP"
cp "$MODE_TOOL" "$SP/council-doctor-mode.mjs"
OUT="$(cd "$SP" && node ./council-doctor-mode.mjs --root "$VENDORED" 2>&1)"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "distribution" ] \
  && pass "CLI run from a spaced directory prints distribution" \
  || fail "spaced-directory CLI: rc=$RC out='$OUT' (want rc=0 out=distribution)"
OUT="$(node "$SP/council-doctor-mode.mjs" --root "$VENDORED" 2>&1)"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "distribution" ] \
  && pass "CLI invoked by absolute spaced path prints distribution" \
  || fail "spaced absolute-path CLI: rc=$RC out='$OUT'"
ln -s "$SP" "$BASE/link-to-spaced"
OUT="$(node "$BASE/link-to-spaced/council-doctor-mode.mjs" --root "$VENDORED" 2>&1)"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "distribution" ] \
  && pass "CLI invoked through a symlinked directory prints distribution" \
  || fail "symlinked-directory CLI: rc=$RC out='$OUT'"

echo
echo "RESULT: $PASS passed, $FAIL failed"
rm -rf "$BASE"
[ "$FAIL" -eq 0 ]
