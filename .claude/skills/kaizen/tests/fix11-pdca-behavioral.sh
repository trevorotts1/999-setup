#!/bin/bash
# Fix 11 — two-cycle behavioral PDCA test.
# Fixtures only (mktemp + git init inside temp, fake KAIZEN_DOWNLOADS).
# Deterministic: no randomness, no model calls. The test drives the state
# transitions the skill instructs; kaizen-fingerprint.mjs and kaizen-state.mjs
# make the transitions deterministic and machine-checkable.
#
# Scope note (honesty): PLAN candidate selection is simulated here with a
# deterministic rule (first N candidates sorted by finding ID). The test
# asserts the LIMIT (scope=3 -> max 3 of 5 selected), not which candidates win.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FP_MJS="$SKILL_DIR/scripts/common/kaizen-fingerprint.mjs"
STATE_MJS="$SKILL_DIR/scripts/common/kaizen-state.mjs"
NODE_BIN="${NODE_BIN:-node}"
PDCA_DOC="$SKILL_DIR/references/pdca-cycle.md"

PASS=0; FAIL=0; VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1
ok() { PASS=$((PASS+1)); [ "$VERBOSE" = "1" ] && echo "  ok: $1"; return 0; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; return 0; }
check_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi; }
check_contains() { case "$3" in *"$2"*) ok "$1";; *) bad "$1 (missing [$2] in [$3])";; esac; }
check_not_contains() { case "$3" in *"$2"*) bad "$1 (found [$2] in [$3])";; *) ok "$1";; esac; }
json_field() { "$NODE_BIN" -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(String(d[process.argv[1]]))' "$1"; }

FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT
SITE="$FIX/site"
MEM="$FIX/Kaizen/demo-loop"
mkdir -p "$SITE" "$MEM/evidence"

# ---------------------------------------------------------------------------
# Fixture: tiny website with two seeded defects:
#   D1: mailto typo "user@exmaple.com"
#   D2: broken image src (missing asset)
# ---------------------------------------------------------------------------
cat > "$SITE/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Demo Site</title>
</head>
<body>
<h1>Welcome</h1>
<p>Contact us at <a href="mailto:user@exmaple.com">mail</a></p>
<img src="images/logo.png" alt="Logo">
</body>
</html>
HTML
git -C "$SITE" init -q
git -C "$SITE" checkout -q -b main
git -C "$SITE" config user.email "kaizen-test@example.invalid"
git -C "$SITE" config user.name "Kaizen Fixture"
git -C "$SITE" add index.html
git -C "$SITE" commit -qm "initial site"
MAIN_BEFORE="$(git -C "$SITE" rev-parse main)"

# Pristine reference copy of the target, taken BEFORE any cycle runs.
# Used in cycle 2 for the "fingerprint unchanged" reconsideration scenario.
REF="$(mktemp -d)"
trap 'rm -rf "$FIX" "$REF"' EXIT
cp -R "$SITE" "$REF/site"
FP_PRISTINE="$("$NODE_BIN" "$FP_MJS" compute "$REF/site" | json_field fingerprint)"

# Memory fixture: valid STATE.json matching templates/STATE.template.json.
cat > "$MEM/STATE.json" <<JSON
{
  "schema_version": 1,
  "loop_id": "demo-loop",
  "name": "Demo Site",
  "status": "active",
  "contract_version": 1,
  "approval": { "timestamp": "2026-08-20 09:00 UTC" },
  "target": { "type": "website", "repo_remote": null, "staging_url": null, "production_url": null },
  "direction": { "user_goal": "fix broken contact link", "open_discovery": true },
  "scope": { "max_items_per_cycle": 3 },
  "permission_mode": "improve-safe",
  "proof_strategy": ["grep-smoke"],
  "schedule": { "human": "every 7 days", "mechanism": "desktop-local", "mechanism_id": null },
  "model": { "launcher": "claude-nine", "logical_lane": "opus", "resolved_route_snapshot": null },
  "last_cycle": { "id": null, "completed_at": null, "result": null },
  "backup": { "repo": null, "status": "none" },
  "resume": { "friendly_session_name": "kaizen-demo-loop" }
}
JSON
cat > "$MEM/LOCAL_STATE.json" <<JSON
{ "schema_version": 1, "loop_id": "demo-loop", "local_target_path": "$SITE",
  "kaizen_root_path": "$FIX/Kaizen", "scheduler": { "mechanism": "none", "label": null, "wrapper_path": null },
  "claude_session_id": null, "worktree_path": null, "test_artifact_paths": [] }
JSON

# ===========================================================================
echo "== cycle 1: PLAN -> DO -> CHECK -> ACT =="
# ---------------------------------------------------------------------------
# PLAN — deterministic finder finds the seeded issues; scope limit enforced.
# ---------------------------------------------------------------------------
FIND_D1="$(grep -n "exmaple" "$SITE/index.html" || true)"
FIND_D2="$(grep -n 'src="images/logo.png"' "$SITE/index.html" || true)"
[ -n "$FIND_D1" ] && ok "finder locates seeded defect D1 (mailto typo)" || bad "finder misses seeded defect D1"
[ -n "$FIND_D2" ] && ok "finder locates seeded defect D2 (broken image)" || bad "finder misses seeded defect D2"

ID_D1="$("$NODE_BIN" "$FP_MJS" finding-id 'mailto:user@exmaple.com' cycle-001 | json_field id)"
ID_D2="$("$NODE_BIN" "$FP_MJS" finding-id 'broken image src images/logo.png' cycle-001 | json_field id)"
ID_C3="$("$NODE_BIN" "$FP_MJS" finding-id 'no meta description' cycle-001 | json_field id)"
ID_C4="$("$NODE_BIN" "$FP_MJS" finding-id 'heading hierarchy' cycle-001 | json_field id)"
ID_C5="$("$NODE_BIN" "$FP_MJS" finding-id 'missing favicon' cycle-001 | json_field id)"
check_eq "finding-id emits KZ-<cycle>-<n> format" "KZ-cycle-001-" "${ID_D1:0:13}"
[ "$(printf '%s\n' "$ID_D1" "$ID_D2" "$ID_C3" "$ID_C4" "$ID_C5" | LC_ALL=C sort -u | wc -l | tr -d ' ')" = "5" ] \
  && ok "5 distinct candidate IDs" || bad "candidate IDs not distinct"

# Deterministic selection: first N sorted by finding ID (scope = 3 of 5).
SELECTED="$(printf '%s\n' "$ID_D1" "$ID_D2" "$ID_C3" "$ID_C4" "$ID_C5" | LC_ALL=C sort | head -n 3)"
SEL_COUNT="$(printf '%s\n' "$SELECTED" | wc -l | tr -d ' ')"
check_eq "scope limit enforced: selected 3 of 5 candidates" "3" "$SEL_COUNT"
SELECTED_FIRST="$(printf '%s\n' "$SELECTED" | head -n 1)"
check_eq "selection deterministic (sorted by finding ID)" "$(printf '%s\n' "$ID_D1" "$ID_D2" "$ID_C3" "$ID_C4" "$ID_C5" | LC_ALL=C sort | head -n 1)" "$SELECTED_FIRST"

# ---------------------------------------------------------------------------
# DO 1 — one small change on an isolated branch (fix the typo).
# ---------------------------------------------------------------------------
git -C "$SITE" checkout -q -b "kaizen-fix-$SELECTED_FIRST"
sed -i '' 's/user@exmaple\.com/user@example.com/' "$SITE/index.html"
[ -n "$(grep -n 'mailto:user@example.com' "$SITE/index.html" || true)" ] \
  && ok "DO: typo fixed on isolated branch" || bad "DO: typo fix not applied"

# CHECK 1 — objective proof: old typo absent AND page smoke passes.
if grep -q "exmaple" "$SITE/index.html"; then
  bad "CHECK D1: old typo still present"
else
  ok "CHECK D1: old typo absent"
fi
if grep -q '<title>Demo Site</title>' "$SITE/index.html"; then
  ok "CHECK D1: page smoke grep passes"
else
  bad "CHECK D1: page smoke grep failed"
fi
git -C "$SITE" add index.html
git -C "$SITE" commit -qm "fix contact mailto typo ($SELECTED_FIRST)"
VERDICT_D1="KEEP"

# ---------------------------------------------------------------------------
# DO 2 — deliberately failing change: break a tag.
# ---------------------------------------------------------------------------
sed -i '' 's|<title>Demo Site</title>|<titleDemo Site</title>|' "$SITE/index.html"
if grep -q '<title>Demo Site</title>' "$SITE/index.html"; then
  bad "DO 2: tag break not applied"
else
  ok "DO 2: tag broken (failing change staged)"
fi

# CHECK 2 — proof fails -> revert the failing change, reject the idea.
if grep -q '<title>' "$SITE/index.html"; then
  bad "CHECK 2: broken tag should have failed the smoke grep"
else
  ok "CHECK 2: smoke grep correctly fails on broken tag"
fi
git -C "$SITE" checkout -q -- index.html
if grep -q '<title>Demo Site</title>' "$SITE/index.html"; then
  ok "CHECK 2: failing change reverted to last good state"
else
  bad "CHECK 2: revert did not restore the good state"
fi
if grep -q "exmaple" "$SITE/index.html"; then
  bad "CHECK 2: revert lost the KEEP change"
else
  ok "CHECK 2: KEEP change preserved after revert"
fi
VERDICT_D2="REVERTED"
ID_BROKEN_TAG="$("$NODE_BIN" "$FP_MJS" finding-id 'broken title tag experiment' cycle-001 | json_field id)"

# ---------------------------------------------------------------------------
# ACT — record everything: cycle record, STATE, BACKLOG, DECISIONS, evidence.
# ---------------------------------------------------------------------------
TODAY="$(date +%F)"
cat > "$MEM/CYCLE-001.md" <<EOF
# Kaizen Cycle 001 — $TODAY

## ACT

| ID | Decision | Reason |
|---|---|---|
| $SELECTED_FIRST | KEEP | typo absent, smoke grep passed |
| $ID_BROKEN_TAG | REVERTED | tag break failed smoke grep, restored |

## Approval boundary

- Merge required? no
- Deploy required? no
- Human decision needed: no
EOF
grep -q "| $SELECTED_FIRST | KEEP |" "$MEM/CYCLE-001.md" && ok "ACT: KEEP verdict recorded in CYCLE-001.md" || bad "ACT: KEEP verdict missing"
grep -q "| $ID_BROKEN_TAG | REVERTED |" "$MEM/CYCLE-001.md" && ok "ACT: REVERTED verdict recorded in CYCLE-001.md" || bad "ACT: REVERTED verdict missing"

# STATE.json last_cycle via the real state helper (bump-cycle).
KAIZEN_DOWNLOADS="$FIX" "$NODE_BIN" "$STATE_MJS" bump-cycle demo-loop >/dev/null 2>&1 \
  && ok "ACT: bump-cycle via kaizen-state.mjs succeeded" || bad "ACT: bump-cycle failed"
LAST_CYCLE="$(KAIZEN_DOWNLOADS="$FIX" "$NODE_BIN" "$STATE_MJS" status demo-loop | "$NODE_BIN" -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(d.last_cycle && (d.last_cycle.cycle_id||d.last_cycle.id))')"
check_eq "ACT: STATE.json last_cycle is cycle-001" "cycle-001" "$LAST_CYCLE"

# BACKLOG.md — reverted finding + unselected candidate, stable IDs, Last reconsidered.
cat > "$MEM/BACKLOG.md" <<EOF
# Kaizen Backlog — Demo Loop

| ID | Title | Why it matters | Discovered cycle | Priority | Status | Reason deferred | Last reconsidered |
|---|---|---|---|---|---|---|---|
| $ID_BROKEN_TAG | Broken title tag experiment | failed proof | cycle-001 | low | rejected | smoke grep failed | $TODAY |
| $ID_D2 | Broken image src images/logo.png | broken content | cycle-001 | high | open | outside scope | $TODAY |
EOF
grep -q "| $ID_BROKEN_TAG |" "$MEM/BACKLOG.md" && ok "ACT: reverted finding in BACKLOG.md with stable ID" || bad "ACT: reverted finding missing from BACKLOG.md"
grep -q "| $ID_D2 |" "$MEM/BACKLOG.md" && ok "ACT: unselected candidate in BACKLOG.md with stable ID" || bad "ACT: unselected candidate missing from BACKLOG.md"
grep -q "Last reconsidered" "$MEM/BACKLOG.md" && ok "ACT: BACKLOG.md has Last reconsidered column" || bad "ACT: Last reconsidered column missing"

# DECISIONS.md — decision entry.
cat > "$MEM/DECISIONS.md" <<EOF
# Kaizen Decisions — Demo Loop

- $TODAY — Agent: kept typo fix, reverted tag-break experiment after failed smoke proof.
EOF
grep -q "reverted tag-break experiment" "$MEM/DECISIONS.md" && ok "ACT: decision entry in DECISIONS.md" || bad "ACT: DECISIONS.md entry missing"

# evidence/manifest.json — CHECK evidence entries.
grep -c "exmaple" "$SITE/index.html" >/dev/null 2>&1; EC1=$?
echo "check: exmaple absent after fix (grep exit $EC1)" > "$MEM/evidence/check-$SELECTED_FIRST.txt"
echo "check: title tag intact after revert" > "$MEM/evidence/check-$ID_BROKEN_TAG.txt"
cat > "$MEM/evidence/manifest.json" <<EOF
{
  "entries": [
    { "id": "$SELECTED_FIRST", "cycle_id": "cycle-001", "kind": "grep-smoke", "file": "evidence/check-$SELECTED_FIRST.txt", "verdict": "KEEP" },
    { "id": "$ID_BROKEN_TAG", "cycle_id": "cycle-001", "kind": "grep-smoke", "file": "evidence/check-$ID_BROKEN_TAG.txt", "verdict": "REVERTED" }
  ]
}
EOF
"$NODE_BIN" -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(m.entries.length===2&&m.entries[0].cycle_id==="cycle-001"&&m.entries[0].kind)process.exit(0);process.exit(1)' "$MEM/evidence/manifest.json" \
  && ok "ACT: evidence manifest has {id, cycle_id, kind, file} entries" || bad "ACT: evidence manifest malformed"

# --- merge boundary: main untouched, no deploy markers. ---------------------
MAIN_AFTER="$(git -C "$SITE" rev-parse main)"
check_eq "no merge to main (main tip unchanged)" "$MAIN_BEFORE" "$MAIN_AFTER"
git -C "$SITE" log --oneline main | wc -l | grep -q '^ *1$' \
  && ok "main still has exactly the initial commit" || bad "main gained commits"
if grep -riE "deploying|deployed to|DEPLOYED" "$MEM" >/dev/null 2>&1; then
  bad "no deploy actions recorded in Memory"
else
  ok "no deploy actions recorded in Memory"
fi

# ===========================================================================
echo "== cycle 2: fingerprint, rediscovery guard, reconsideration =="
# ---------------------------------------------------------------------------
# PLAN — finder re-runs on the unchanged remaining seeded issue (D2).
# ---------------------------------------------------------------------------
FIND_D2B="$(grep -n 'src="images/logo.png"' "$SITE/index.html" || true)"
[ -n "$FIND_D2B" ] && ok "cycle 2 finder re-locates remaining seeded issue D2" || bad "cycle 2 finder misses D2"
ID_D2B="$("$NODE_BIN" "$FP_MJS" finding-id 'broken image src images/logo.png' cycle-001 | json_field id)"
check_eq "stable finding ID across cycles (same seed)" "$ID_D2" "$ID_D2B"

# Fingerprint unchanged scenario: pristine reference vs itself (the issue's
# discovery-time target state is unchanged).
FP_REF_NOW="$("$NODE_BIN" "$FP_MJS" compute "$REF/site" | json_field fingerprint)"
check_eq "fingerprint of unchanged target is stable" "$FP_PRISTINE" "$FP_REF_NOW"
CHANGED="$( "$NODE_BIN" "$FP_MJS" compare "$FP_PRISTINE" "$FP_REF_NOW" | json_field changed)"
check_eq "compare(unchanged, unchanged) -> changed:false" "false" "$CHANGED"

# Rediscovery guard: ID already in BACKLOG + fingerprint unchanged -> no
# reconsideration, must cite the old ID.
RECON="$( "$NODE_BIN" "$FP_MJS" reconsider-check --json "{\"finding_id\":\"$ID_D2\",\"current_fingerprint\":\"$FP_REF_NOW\",\"original_fingerprint\":\"$FP_PRISTINE\",\"target_changed\":false,\"conditions_met\":[]}" )"
check_eq "reconsider:false when target unchanged and ID already recorded" "false" "$(printf '%s' "$RECON" | json_field reconsider)"
check_contains "reason: never re-present an old idea as newly discovered" "no new evidence; never re-present an old idea as newly discovered" "$RECON"

# The cycle-2 record must cite the old ID, not present the finding as new.
cat > "$MEM/CYCLE-002.md" <<EOF
# Kaizen Cycle 002 — $TODAY

## PLAN

Broken image src previously recorded as $ID_D2 (BACKLOG.md, Last reconsidered $TODAY).
No new evidence; fingerprint unchanged; not reconsidered this cycle.
EOF
check_contains "cycle 2 record cites the old finding ID" "$ID_D2" "$(cat "$MEM/CYCLE-002.md")"
check_not_contains "cycle 2 record does not present the old idea as newly discovered" "newly discovered" "$(cat "$MEM/CYCLE-002.md")"

# Rejected idea remembered: BACKLOG still holds the cycle-1 REVERTED finding.
check_contains "BACKLOG still contains cycle-1 reverted finding" "$ID_BROKEN_TAG" "$(cat "$MEM/BACKLOG.md")"

# Stable IDs: same seed -> same ID, repeated.
ID_D1B="$("$NODE_BIN" "$FP_MJS" finding-id 'mailto:user@exmaple.com' cycle-001 | json_field id)"
check_eq "same seed -> same finding-id (repeat run)" "$ID_D1" "$ID_D1B"

# ---------------------------------------------------------------------------
# Target changed: fingerprint changes, but that alone is NOT enough.
# ---------------------------------------------------------------------------
FP_NOW="$("$NODE_BIN" "$FP_MJS" compute "$SITE" | json_field fingerprint)"
CHANGED2="$( "$NODE_BIN" "$FP_MJS" compare "$FP_PRISTINE" "$FP_NOW" | json_field changed)"
check_eq "compare(pristine, changed worktree) -> changed:true" "true" "$CHANGED2"

RECON2="$( "$NODE_BIN" "$FP_MJS" reconsider-check --json "{\"finding_id\":\"$ID_D2\",\"current_fingerprint\":\"$FP_NOW\",\"original_fingerprint\":\"$FP_PRISTINE\",\"target_changed\":true,\"conditions_met\":[]}" )"
check_eq "changed fingerprint alone (no named condition) -> reconsider:false" "false" "$(printf '%s' "$RECON2" | json_field reconsider)"
check_contains "reason names the missing condition" "no named reconsideration condition" "$RECON2"

RECON3="$( "$NODE_BIN" "$FP_MJS" reconsider-check --json "{\"finding_id\":\"$ID_D2\",\"current_fingerprint\":\"$FP_NOW\",\"original_fingerprint\":\"$FP_PRISTINE\",\"target_changed\":true,\"conditions_met\":[\"target changed materially\"]}" )"
check_eq "changed fingerprint + named condition -> reconsider:true" "true" "$(printf '%s' "$RECON3" | json_field reconsider)"

# All five documented reconsideration conditions recognized individually.
i=0
for cond in \
  "target changed materially" \
  "prior blocker disappeared" \
  "previous test became invalid" \
  "user changed the Contract" \
  "new evidence materially changes priority"; do
  i=$((i+1))
  R="$( "$NODE_BIN" "$FP_MJS" reconsider-check --json "{\"finding_id\":\"KZ-cycle-001-000\",\"current_fingerprint\":\"$FP_NOW\",\"original_fingerprint\":\"$FP_PRISTINE\",\"target_changed\":true,\"conditions_met\":[\"$cond\"]}" | json_field reconsider)"
  check_eq "condition $i recognized: $cond" "true" "$R"
done
# A non-named condition must NOT open reconsideration.
RN="$( "$NODE_BIN" "$FP_MJS" reconsider-check --json "{\"finding_id\":\"KZ-cycle-001-000\",\"current_fingerprint\":\"$FP_NOW\",\"original_fingerprint\":\"$FP_PRISTINE\",\"target_changed\":true,\"conditions_met\":[\"it seems worth another look\"]}" | json_field reconsider)"
check_eq "unnamed condition does not open reconsideration" "false" "$RN"

# Doc cross-check: the five conditions appear in pdca-cycle.md.
DOC_COND="$(grep -c "reconsidered only if" "$PDCA_DOC" || true)"
[ "$DOC_COND" -ge 1 ] 2>/dev/null && ok "pdca-cycle.md documents the reconsideration rule" || bad "pdca-cycle.md missing reconsideration rule"

echo
echo "fix11-pdca-behavioral: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
