#!/bin/bash
# CWE-040: vendored council bundle integrity, proven from this repository
# alone (the canonical source tree is not needed at test time).
#
#   A. The vendored tree recomputes to the distribution aggregate recorded
#      in installer-registration/council-vendoring.json and in its own
#      manifest.json (identical value in both places).
#   B. Every vendored file is accounted for by the record: byte-identical
#      to the recorded canonical hash, or carrying exactly the digest the
#      RELEASE CONTRACT records (record.distribution.files, written from the
#      canonical manifest.distribution — the declared differences are derived
#      from it, never listed in this file), or manifest.json / a declared
#      added path, or a declared local_divergence file matching its recorded
#      hash and patch artifact. The shipped build is proven the same way
#      against record.distribution.runtime_dist.
#   C. Zero residual private references (dropped item ids and the private
#      evidence id prefix) anywhere in the vendored tree.
#   D. The canonical doctor passes on the vendored tree.
#   E. STRICT ENTRY-POINT GATE: the vendored tree MUST ship the built
#      executable runtime/dist/blackceo-council.mjs, bound to the
#      runtime_entry {path, sha256, bytes} recorded in manifest.json and
#      the vendoring record, and it must pass `node --check`. A source-only
#      shape (the stale pre-fix package: sources without runtime/dist)
#      FAILS here. No node_modules and no state files inside the vendored
#      skill folder (dependencies are bundled into the executable; state
#      lives in the per-user data profile). runtime/dist is excluded from
#      the tree aggregate (the canonical hash method) but present in the
#      package.
#   F. The pinned canonical prerequisite probe and the shared driver pass.
#   G. REGRESSION (contract-driven strip): a fixture release whose contract
#      strips a profile file is vendored, and the tree gate must accept the
#      produced distribution as the same release. A hand-kept strip list that
#      happens to match the current release fails here on the next one.
#
# Run: bash scripts/test-council-vendor.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDORED="$REPO_ROOT/.claude/skills/council-of-wise-elders"
RECORD="$REPO_ROOT/installer-registration/council-vendoring.json"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

[ -d "$VENDORED" ] || { echo "FAIL: vendored council tree missing: $VENDORED"; exit 1; }
[ -f "$RECORD" ] || { echo "FAIL: vendoring record missing: $RECORD"; exit 1; }

echo "== A/B/C/E. tree, record, residuals (node, canonical hash method) =="
node - "$VENDORED" "$RECORD" <<'EOF'
const { createHash } = require("node:crypto");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");
const [root, recordPath] = process.argv.slice(2);
let fails = 0;
const ok = (m) => console.log(`  ok: ${m}`);
const bad = (m) => { fails += 1; console.log(`  FAIL: ${m}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");
// The canonical hash method excludes manifest.json, any .skill archive and
// the generated runtime/dist + runtime/node_modules trees (the built entry
// point is bound through runtime_entry instead).
const isGen = (p) => p === "runtime/dist" || p.startsWith("runtime/dist/")
  || p === "runtime/node_modules" || p.startsWith("runtime/node_modules/");
function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p).split("\\").join("/"));
  }
  return acc;
}
const record = JSON.parse(readFileSync(recordPath, "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const files = walk(root);
const hashes = new Map(files.map((rel) => [rel, sha(readFileSync(join(root, rel)))]));
const entries = [...hashes.entries()]
  .filter(([p]) => p !== "manifest.json" && !p.endsWith(".skill") && !isGen(p))
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([p, h]) => `${h}  ${p}`);
const aggregate = sha(Buffer.from(entries.join("\n") + "\n", "utf8"));
if (aggregate === record.distribution.distribution_aggregate_sha256
  && aggregate === manifest.aggregate_sha256
  && entries.length === record.distribution.distribution_file_count
  && entries.length === manifest.file_count) {
  ok(`tree recomputes to the recorded distribution aggregate ${aggregate} (${entries.length} files)`);
} else {
  bad(`aggregate mismatch: tree=${aggregate}/${entries.length} record=${record.distribution.distribution_aggregate_sha256}/${record.distribution.distribution_file_count} manifest=${manifest.aggregate_sha256}/${manifest.file_count}`);
}
if (manifest.canonical_aggregate_sha256 === record.canonical_source.canonical_aggregate_sha256
  && manifest.source_commit === record.canonical_source.source_commit) {
  ok(`manifest carries the canonical identity: source ${manifest.source_commit}, canonical aggregate ${manifest.canonical_aggregate_sha256}`);
} else {
  bad("manifest canonical identity does not match the vendoring record");
}
// The release contract the vendoring record carries: every distributed file
// with the digest the canonical release records. Declared differences are
// DERIVED from it, never listed here — a hand-kept list can match today's
// release and silently miss the file the next release starts stripping.
const contract = new Map((record.distribution?.files ?? []).map((f) => [f.path, f.sha256]));
const runtimeDist = new Map((record.distribution?.runtime_dist ?? []).map((f) => [f.path, f.sha256]));
const addedPaths = new Set(record.distribution?.added_paths ?? []);
if (contract.size === 0) {
  bad("the vendoring record carries no distribution contract (distribution.files): no declared difference can be established");
}
const declaredChanged = new Set([
  ...[...contract.keys()].filter((p) => record.canonical_files[p] !== contract.get(p)),
  ...addedPaths,
  "manifest.json",
  "DISTRIBUTION-RECONCILIATION.json",
]);
// 999-only changes are declared separately from canonical_files: each one
// must match its recorded distribution hash, differ from (or be absent in)
// the canonical record, and be covered by a patch artifact whose hash matches.
const local = (record.intentional_distribution_differences || []).find((d) => d.kind === "local_divergence");
const localFiles = new Map((local ? local.files : []).map((f) => [f.path, f]));
for (const [rel, f] of localFiles) {
  if (record.canonical_files[rel] !== f.canonical_sha256 && !(f.canonical_sha256 === null && !(rel in record.canonical_files))) {
    bad(`local divergence ${rel} does not carry the recorded canonical hash`);
  }
  if (f.sha256 === f.canonical_sha256) bad(`local divergence ${rel} is identical to canonical`);
}
const repoRoot = join(root, "..", "..", "..");
for (const a of (local ? local.patch_artifacts : [])) {
  let actual = null;
  try { actual = sha(readFileSync(join(repoRoot, a.path))); } catch { /* reported below */ }
  if (actual !== a.sha256) bad(`patch artifact ${a.path} missing or its hash drifted`);
}
let accounted = 0;
for (const [rel, h] of hashes) {
  if (isGen(rel)) continue; // bound through runtime_entry (gate E), never hashed
  const canonical = record.canonical_files[rel];
  if (canonical === h) { accounted += 1; continue; }
  // A declared difference is only declared if it carries the contract's bytes.
  if (contract.has(rel) && contract.get(rel) === h) { accounted += 1; continue; }
  if (declaredChanged.has(rel) && !contract.has(rel)) { accounted += 1; continue; }
  if (localFiles.has(rel) && localFiles.get(rel).sha256 === h) { accounted += 1; continue; }
  bad(`unaccounted file difference: ${rel}`);
}
const sealedCount = [...hashes.keys()].filter((p) => !isGen(p)).length;
if (accounted === sealedCount) ok(`all ${sealedCount} vendored files accounted for by the record`);
let contractDrift = 0;
for (const [rel, want] of contract) {
  if (!hashes.has(rel)) { contractDrift += 1; bad(`contract file missing from the distribution tree: ${rel}`); }
  else if (hashes.get(rel) !== want) {
    contractDrift += 1;
    bad(`contract drift: ${rel} is ${hashes.get(rel)}, the release records ${want}`);
  }
}
if (contractDrift === 0 && contract.size) {
  ok(`all ${contract.size} files match the release contract per file`);
}
// The shipped build is the release's build: every recorded built file present
// and byte-identical, and nothing under runtime/dist the release never built.
// This replaces the retired runtime/.gitignore guard (a dist file that exists
// but was never committed, or a rebuild, fails here).
let buildDrift = 0;
for (const [rel, want] of runtimeDist) {
  if (!hashes.has(rel)) { buildDrift += 1; bad(`recorded build file missing from the distribution tree: ${rel}`); }
  else if (hashes.get(rel) !== want) { buildDrift += 1; bad(`recorded build drift: ${rel} is ${hashes.get(rel)}, the release built ${want}`); }
}
for (const rel of hashes.keys()) {
  if (rel.startsWith("runtime/dist/") && !runtimeDist.has(rel)) {
    buildDrift += 1;
    bad(`unrecorded build file in the distribution tree: ${rel}`);
  }
}
if (buildDrift === 0 && runtimeDist.size) {
  ok(`all ${runtimeDist.size} recorded build files present and byte-identical`);
} else if (runtimeDist.size === 0) {
  bad("the vendoring record carries no distribution.runtime_dist: the shipped build cannot be proven");
}
for (const rel of Object.keys(record.canonical_files)) {
  if (!hashes.has(rel) && (contract.size === 0 || contract.has(rel))) {
    bad(`canonical file missing from the distribution tree: ${rel}`);
  }
}
const tokens = ["fw-epiphany-bridge-and-demo", "fw-one-client-one-funnel",
  "fp-technobabble", "ev-russell-brunson-network-marketing-secrets-"];
let residual = 0;
for (const rel of files) {
  const text = readFileSync(join(root, rel), "utf8");
  for (const t of tokens) if (text.includes(t)) { residual += 1; bad(`residual private reference ${t} in ${rel}`); }
}
if (residual === 0) ok("zero residual private references in the vendored tree");
// STRICT ENTRY-POINT GATE: the distribution ships the built executable,
// bound to manifest.runtime_entry. A source-only shape FAILS here.
const entry = manifest.runtime_entry ?? null;
if (!entry || typeof entry.path !== "string" || typeof entry.sha256 !== "string"
  || typeof entry.bytes !== "number") {
  bad("manifest records no runtime_entry {path, sha256, bytes}: source-only shape, the executable would not ship");
} else if (!hashes.has(entry.path)) {
  bad(`runtime entry missing from the tree: ${entry.path} (source-only shape)`);
} else if (hashes.get(entry.path) !== entry.sha256) {
  bad(`runtime entry hash drift: ${entry.path} is ${hashes.get(entry.path)}, manifest records ${entry.sha256}`);
} else if (statSync(join(root, entry.path)).size !== entry.bytes) {
  bad(`runtime entry byte-count drift: ${entry.path}`);
} else {
  ok(`runtime entry shipped and matches runtime_entry: ${entry.path} ${entry.bytes} bytes, sha256 ${entry.sha256}`);
}
const recordEntry = record.runtime_entry ?? null;
if (entry && recordEntry && (recordEntry.path !== entry.path || recordEntry.sha256 !== entry.sha256
  || recordEntry.bytes !== entry.bytes)) {
  bad("vendoring record runtime_entry disagrees with the distribution manifest");
} else if (entry && recordEntry) {
  ok("vendoring record runtime_entry matches the distribution manifest");
}
let dirt = 0;
for (const rel of files) {
  if (rel.includes("node_modules/") || rel.endsWith(".skill") || /\.(sqlite3?|db)$/i.test(rel)
    || /^(state|sessions|data)\//.test(rel)) { dirt += 1; bad(`vendored tree carries build/state content: ${rel}`); }
}
if (dirt === 0) ok("no node_modules, archives, or state files inside the vendored skill folder");
process.exit(fails === 0 ? 0 : 1);
EOF
[ $? -eq 0 ] && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))

# Entry syntax gate: the shipped executable must at least parse.
ENTRY_REL="$(node -e 'const f=require("node:fs");const e=JSON.parse(f.readFileSync(process.argv[1],"utf8")).runtime_entry;process.stdout.write(e&&e.path?e.path:"")' "$VENDORED/manifest.json")"
if [ -n "$ENTRY_REL" ] && node --check "$VENDORED/$ENTRY_REL" >/dev/null 2>&1; then
  pass "shipped runtime entry passes node --check: $ENTRY_REL"
else
  fail "shipped runtime entry missing or fails node --check: ${ENTRY_REL:-"(none recorded)"}"
fi

echo "== D. doctor on the vendored tree =="
# The vendored folder is an extracted distribution (no .skill archive), so
# the canonical doctor must run in distribution mode.
DOCTOR_OUT="$(node "$VENDORED/scripts/doctor.mjs" --root "$VENDORED" --distribution 2>&1)"
case "$DOCTOR_OUT" in
  *"DOCTOR: PASS"*) pass "doctor PASS on the vendored tree" ;;
  *) fail "doctor did not pass on the vendored tree"; echo "$DOCTOR_OUT" ;;
esac

echo "== F. pinned canonical prerequisite probe =="
PINNED="$REPO_ROOT/scripts/council-node-runtime-preflight.mjs"
DRIVER="$REPO_ROOT/scripts/council-runtime-preflight.mjs"
[ -f "$DRIVER" ] && pass "shared prerequisite driver exists" \
  || fail "shared prerequisite driver missing: $DRIVER"
if [ -f "$PINNED" ]; then
  PINNED_SHA="$(node -e 'const c=require("node:crypto"),f=require("node:fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$PINNED")"
  [ "$PINNED_SHA" = "3b7e6169eb39b53f5caa004c1157540391f4dc5f34444d117601d3a4287e7b1f" ] \
    && pass "pinned probe is byte-identical to the canonical node-runtime-preflight.mjs" \
    || fail "pinned probe hash drifted: $PINNED_SHA"
else
  fail "pinned prerequisite probe missing: $PINNED"
fi
node "$DRIVER" --verify-source "$VENDORED" >/dev/null 2>&1 \
  && pass "vendored tree verifies as a canonical-origin portable source" \
  || fail "vendored tree failed canonical source verification"
node "$DRIVER" --probe --source "$VENDORED" >/dev/null 2>&1 \
  && pass "canonical Node/SQLite prerequisite probe passes" \
  || fail "canonical Node/SQLite prerequisite probe failed"

echo "== G. contract-driven strip regression (a release whose contract strips a profile file) =="
# The defect this covers: the strip list was a hand-kept literal, so a release
# that started stripping one more file (v1.0.59's
# advisors/russell-brunson/profile.json) produced a distribution the tree gate
# refused, while the vendoring tool still reported PASS. The fixture's contract
# strips a profile file and drops a pack item; the produced distribution must
# be accepted by the same gate as the same release.
G_FIX="$(mktemp -d "${TMPDIR:-/tmp}/council-vendor-fixture.XXXXXX")"
if [ -z "$G_FIX" ] || [ ! -d "$G_FIX" ]; then
  fail "could not create a fixture directory"
else
  G_REPO="$G_FIX/repo"
  G_SKILL="$G_REPO/77-council-of-wise-elders"
  G_HOME="$G_FIX/home"
  G_OUT="$G_FIX/dist"
  mkdir -p "$G_SKILL" "$G_HOME/.agents/skills"
  HASH_METHOD="$(node -e 'const f=require("node:fs");process.stdout.write(JSON.parse(f.readFileSync(process.argv[1],"utf8")).hash_method)' "$VENDORED/manifest.json")"
  if node - "$G_SKILL" "$HASH_METHOD" <<'EOF'
const { createHash } = require("node:crypto");
const { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { dirname, join, relative } = require("node:path");
const [root, hashMethod] = process.argv.slice(2);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const write = (rel, text) => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};
const isGenerated = (rel) => rel === "runtime/dist" || rel.startsWith("runtime/dist/")
  || rel === "runtime/node_modules" || rel.startsWith("runtime/node_modules/");
function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p).split("\\").join("/"));
  }
  return acc;
}
const SEAT = "advisors/fixture-seat";
const PROFILE = `${SEAT}/profile.json`;
const FRAMEWORKS = `${SEAT}/frameworks.json`;
const entry = "#!/usr/bin/env node\n// fixture executable\nprocess.exit(0);\n";
write("version", "9.9.9\n");
write("skill-version.txt", "v9.9.9\n");
write("SKILL.md", "---\nname: council-of-wise-elders\nversion: 9.9.9\n---\n\nConvening is the approval: there is no grant to resolve.\n");
write("scripts/doctor.mjs", "#!/usr/bin/env node\nconsole.log(\"DOCTOR: PASS (fixture)\");\nprocess.exit(0);\n");
write("runtime/dist/blackceo-council.mjs", entry);
write(FRAMEWORKS, JSON.stringify({
  // The seat's item file carries the user_private source record too, so the
  // private evidence prefix is derived from data the contract actually changes
  // — exactly how the real release carries it.
  records: [{ export_source_id: "src-fixture-private", allowed_scope: "user_private" }],
  items: [
    { id: "fw-shared", scope: "shared", text: "A shared framework." },
    { id: "fw-fixture-private", scope: "private_scope", text: "A private framework." },
  ],
}) + "\n");
write(PROFILE, JSON.stringify({
  name: "Fixture Seat",
  note: "Claims stay checkable. Cross-checked in ev-fixture-private-1.",
  role: "offers",
}) + "\n");
// What the release's distribution copy is: the private item dropped, the
// sentence naming the private evidence removed, everything else untouched.
const expectedFrameworks = JSON.stringify({
  records: [{ export_source_id: "src-fixture-private", allowed_scope: "user_private" }],
  items: [{ id: "fw-shared", scope: "shared", text: "A shared framework." }],
});
const expectedProfile = JSON.stringify({
  name: "Fixture Seat",
  note: "Claims stay checkable.",
  role: "offers",
});
const canonicalFiles = walk(root).filter((p) => p !== "manifest.json" && !p.endsWith(".skill") && !isGenerated(p));
const canonicalMap = new Map(canonicalFiles.map((p) => [p, sha(readFileSync(join(root, p)))]));
const contractFiles = new Map(canonicalMap);
contractFiles.set(FRAMEWORKS, sha(Buffer.from(expectedFrameworks, "utf8")));
contractFiles.set(PROFILE, sha(Buffer.from(expectedProfile, "utf8")));
const entries = [...canonicalMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const aggregate = sha(Buffer.from(entries.map(([p, h]) => `${h}  ${p}`).join("\n") + "\n", "utf8"));
const entryBytes = readFileSync(join(root, "runtime/dist/blackceo-council.mjs"));
writeFileSync(join(root, "manifest.json"), JSON.stringify({
  skill: "council-of-wise-elders",
  skill_version: "9.9.9",
  generated_by: "scripts/test-council-vendor.sh fixture",
  source_commit: null,
  file_count: entries.length,
  aggregate_sha256: aggregate,
  hash_method: hashMethod,
  runtime_entry: { path: "runtime/dist/blackceo-council.mjs", sha256: sha(entryBytes), bytes: entryBytes.length },
  files: entries.map(([path, sha256]) => ({ path, sha256, bytes: statSync(join(root, path)).size })),
  distribution: {
    kinds: ["private_scope_items_dropped", "sentences_scrubbed", "generated_archive_not_vendored", "file_added", "manifest_regenerated"],
    files: [...contractFiles.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([path, sha256]) => ({ path, sha256 })),
    runtime_dist: [{ path: "runtime/dist/blackceo-council.mjs", sha256: sha(entryBytes), bytes: entryBytes.length }],
    added_paths: ["DISTRIBUTION-RECONCILIATION.json"],
  },
}, null, 2) + "\n");
EOF
  then
    git -C "$G_REPO" init -q \
      && git -C "$G_REPO" add -A \
      && git -C "$G_REPO" -c user.name="council fixture" -c user.email="fixture@example.invalid" \
        -c commit.gpgsign=false commit -q -m "fixture: 9.9.9 canonical tree with a distribution contract"
    G_COMMIT="$(git -C "$G_REPO" rev-parse HEAD 2>/dev/null)"
    if [ -z "$G_COMMIT" ]; then
      fail "could not commit the fixture tree"
    elif node "$REPO_ROOT/scripts/vendor-council-bundle.mjs" --source "$G_SKILL" --source-commit "$G_COMMIT" \
      --out "$G_OUT" --record "$G_FIX/record.json" > "$G_FIX/vendor.log" 2>&1; then
      cp -R "$G_OUT" "$G_HOME/.agents/skills/council-of-wise-elders"
      node "$VENDORED/scripts/selected-tree-gate.mjs" --skill-dir "$G_SKILL" \
        --home "$G_HOME" --agent-selected "$G_HOME/.agents/skills/council-of-wise-elders" \
        --agent-source "vendor fixture" --no-load > "$G_FIX/gate.log" 2>&1
      G_RC=$?
      case "$(cat "$G_FIX/gate.log" 2>/dev/null)" in
        *"SAME RELEASE:"*)
          if [ "$G_RC" -eq 0 ]; then
            pass "a contract that strips a profile file produces a distribution the tree gate accepts"
          else
            fail "the gate reported SAME RELEASE but exited $G_RC"
            sed 's/^/    /' "$G_FIX/gate.log"
          fi
          ;;
        *)
          fail "the tree gate refused the vendored fixture distribution (exit $G_RC)"
          sed 's/^/    /' "$G_FIX/gate.log"
          ;;
      esac
    else
      fail "vendoring the fixture tree failed"
      sed 's/^/    /' "$G_FIX/vendor.log"
    fi
  else
    fail "could not build the fixture tree"
  fi
  rm -rf "$G_FIX"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
