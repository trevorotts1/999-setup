#!/bin/bash
# Skill 82 (signature-thank-you) distribution integrity, proven from this
# repository alone.
#
#   A. The vendored tree recomputes to the recorded aggregate and version.
#   B. The delivered files the S82-01 consumer contract needs are present.
#   C. The vendored purchase-event adapter accepts schema 1.0, 1.1 and 1.2
#      (the versions that ship) and refuses an unknown version.
#   D. The vendored adapter's own pair-matrix tests pass.
#
# Run: bash scripts/test-signature-thank-you-vendor.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDORED="$REPO_ROOT/.claude/skills/signature-thank-you"

# Recorded identity of the canonical source (openclaw-onboarding
# origin/main 0d5caca80a66e29eadb240f8570c36889236b393,
# 82-signature-thank-you v0.3.1), distribution tree after the S82-01
# purchase-event 1.0/1.1/1.2 acceptance change.
EXPECTED_VERSION="0.3.1"
EXPECTED_FILE_COUNT=47
EXPECTED_AGGREGATE="e58a436bcc5f512469c3758e6a910750aa281971fc8cbe05232cddbb96fa72aa"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

[ -d "$VENDORED" ] || { echo "FAIL: vendored skill 82 tree missing: $VENDORED"; exit 1; }

echo "== A. tree aggregate and version =="
VERSION="$(cat "$VENDORED/skill-version.txt" 2>/dev/null)"
[ "$VERSION" = "$EXPECTED_VERSION" ] \
  && pass "skill-version.txt is $EXPECTED_VERSION" \
  || fail "skill-version.txt is ${VERSION:-<missing>}, expected $EXPECTED_VERSION"
AGG_OUT="$(node - "$VENDORED" <<'EOF'
const { createHash } = require("node:crypto");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");
const root = process.argv[2];
function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === "__pycache__") continue;  // runtime artifact, never delivered bytes
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p).split("\\").join("/"));
  }
  return acc;
}
const entries = walk(root)
  .filter((p) => p !== "manifest.json" && !p.endsWith(".skill")
    && !p.endsWith(".pyc"))
  .sort()
  .map((p) => `${createHash("sha256").update(readFileSync(join(root, p))).digest("hex")}  ${p}`);
process.stdout.write(`${entries.length} ${createHash("sha256").update(Buffer.from(entries.join("\n") + "\n", "utf8")).digest("hex")}`);
EOF
)" || AGG_OUT=""
[ "$AGG_OUT" = "$EXPECTED_FILE_COUNT $EXPECTED_AGGREGATE" ] \
  && pass "tree recomputes to $EXPECTED_AGGREGATE ($EXPECTED_FILE_COUNT files)" \
  || fail "tree recomputes to ${AGG_OUT:-<failed>}, expected $EXPECTED_FILE_COUNT $EXPECTED_AGGREGATE"

echo "== B. delivered S82-01 files present =="
for rel in SKILL.md skill-version.txt scripts/purchase_event_adapter.py \
           fixtures/purchase-event-pair-matrix.json \
           tests/test_event_adapter_pair_matrix.py; do
  [ -f "$VENDORED/$rel" ] && pass "$rel present" || fail "$rel missing"
done

echo "== C. adapter accepts schema 1.0 / 1.1 / 1.2 =="
ACCEPT_OUT="$(python3 -I - "$VENDORED" <<'EOF'
import importlib.util, sys
from pathlib import Path
root = Path(sys.argv[1])
scripts = root / "scripts"
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location(
    "vendored_purchase_event_adapter", scripts / "purchase_event_adapter.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
accepted = tuple(mod.ACCEPTED_SCHEMA_VERSIONS)
print("accepted=" + ",".join(accepted))
print("parent_ref_version=" + mod.PARENT_ORDER_REF_VERSION)
raise SystemExit(0 if accepted == ("1.0", "1.1", "1.2") else 1)
EOF
)"; RC=$?
if [ $RC -eq 0 ]; then
  pass "adapter ACCEPTED_SCHEMA_VERSIONS is 1.0, 1.1, 1.2"
else
  fail "adapter version acceptance is not 1.0/1.1/1.2: $ACCEPT_OUT"
fi

echo "== D. vendored pair-matrix tests =="
PACKET_REF="$REPO_ROOT/.claude/skills/signature-order-form/fixtures/packet"
if [ -f "$PACKET_REF/launch-example.json" ] && [ -f "$PACKET_REF/acceptance-cases.json" ]; then
  OUTPUT="$( cd "$VENDORED" && S82_PACKET_REFERENCE="$PACKET_REF" \
    PYTHONDONTWRITEBYTECODE=1 \
    python3 -I -m unittest discover -s tests -p 'test_event_adapter_pair_matrix.py' 2>&1 )"
  RC=$?
  [ $RC -eq 0 ] && pass "test_event_adapter_pair_matrix.py passes" \
    || { fail "test_event_adapter_pair_matrix.py failed (rc=$RC)"; printf '%s\n' "$OUTPUT" | tail -20; }
else
  fail "packet reference for the pair-matrix tests is missing: $PACKET_REF"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
