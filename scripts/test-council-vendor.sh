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
#      reconciliation report itself).
#   C. Zero residual private references (dropped item ids and the private
#      evidence id prefix) anywhere in the vendored tree.
#   D. The canonical doctor passes on the vendored tree.
#   E. No node_modules, no runtime/dist, no state files inside the
#      vendored skill folder (dependencies live in the per-user runtime
#      prefix, state lives in the per-user data profile).
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
  .filter(([p]) => p !== "manifest.json" && !p.endsWith(".skill"))
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
let accounted = 0;
for (const [rel, h] of hashes) {
  const canonical = record.canonical_files[rel];
  if (canonical === h) { accounted += 1; continue; }
  if (declaredChanged.has(rel)) { accounted += 1; continue; }
  bad(`unaccounted file difference: ${rel}`);
}
if (accounted === hashes.size) ok(`all ${hashes.size} vendored files accounted for by the record`);
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
let dirt = 0;
for (const rel of files) {
  if (rel.includes("node_modules/") || rel.startsWith("runtime/dist/")
    || rel.endsWith(".skill") || /\.(sqlite3?|db)$/i.test(rel)
    || /^(state|sessions|data)\//.test(rel)) { dirt += 1; bad(`vendored tree carries build/state content: ${rel}`); }
}
if (dirt === 0) ok("no node_modules, dist, archives, or state files inside the vendored skill folder");
process.exit(fails === 0 ? 0 : 1);
EOF
[ $? -eq 0 ] && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))

echo "== D. doctor on the vendored tree =="
DOCTOR_OUT="$(node "$VENDORED/scripts/doctor.mjs" --root "$VENDORED" 2>&1)"
case "$DOCTOR_OUT" in
  *"DOCTOR: PASS"*) pass "doctor PASS on the vendored tree" ;;
  *) fail "doctor did not pass on the vendored tree"; echo "$DOCTOR_OUT" ;;
esac

echo "== E. pinned canonical prerequisite probe =="
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
