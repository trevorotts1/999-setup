#!/bin/bash
# CWE-040: vendored council bundle integrity, proven from this repository
# alone (the canonical source tree is not needed at test time).
#
#   A. The vendored tree recomputes to the distribution aggregate recorded
#      in installer-registration/council-vendoring.json and in its own
#      manifest.json (identical value in both places).
#   B. Every vendored file is accounted for by the record: byte-identical
#      to the recorded canonical hash, or one of the declared distribution
#      differences (the three Brunson pack files, manifest.json, and the
#      reconciliation report itself), or a declared local_divergence file
#      (999-only patch) matching its recorded hash and patch artifact.
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
const declaredChanged = new Set([
  "advisors/russell-brunson/frameworks.json",
  "advisors/russell-brunson/failure-patterns.json",
  "advisors/russell-brunson/decision-rules.json",
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
  if (declaredChanged.has(rel)) { accounted += 1; continue; }
  if (localFiles.has(rel) && localFiles.get(rel).sha256 === h) { accounted += 1; continue; }
  bad(`unaccounted file difference: ${rel}`);
}
const sealedCount = [...hashes.keys()].filter((p) => !isGen(p)).length;
if (accounted === sealedCount) ok(`all ${sealedCount} vendored files accounted for by the record`);
for (const rel of Object.keys(record.canonical_files)) {
  if (!hashes.has(rel)) bad(`canonical file missing from the distribution tree: ${rel}`);
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

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
