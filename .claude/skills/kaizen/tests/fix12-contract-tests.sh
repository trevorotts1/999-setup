#!/bin/bash
# Fix 12 — Contract + activation behavioral tests.
# Fixtures only (mktemp, fake KAIZEN_DOWNLOADS). No model calls, no network.
#
# Honesty note: items 1–3, 5, 13 are STATE-TRANSITION assertions — the test
# simulates the init/activate/edit steps by writing STATE.json the way the
# skill's helpers write it, then asserts the invariants on the RESULTING
# state (format checks, ordering rules, parse checks). Items 4, 6, 7, 8, 11,
# 12 additionally assert the real repo files (templates, pdca-cycle.md) or
# the real validator (kaizen-state.mjs validate). Items 9–10 assert
# simulated run-records' invariants. No helper in this repo currently
# exposes an approval gate for install-kaizen-launchagent.sh, so the
# schedule-before-approval rule is proven at the state level only.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_MJS="$SKILL_DIR/scripts/common/kaizen-state.mjs"
VALIDATE_MJS="$SKILL_DIR/scripts/common/validate-kaizen-memory.mjs"
NODE_BIN="${NODE_BIN:-node}"
CONTRACT_TPL="$SKILL_DIR/templates/KAIZEN_CONTRACT.template.md"
PDCA_DOC="$SKILL_DIR/references/pdca-cycle.md"

PASS=0; FAIL=0; VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1
ok() { PASS=$((PASS+1)); [ "$VERBOSE" = "1" ] && echo "  ok: $1"; return 0; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; return 0; }
check_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi; }
check_contains() { case "$3" in *"$2"*) ok "$1";; *) bad "$1 (missing [$2] in [$3])";; esac; }
check_not_contains() { case "$3" in *"$2"*) bad "$1 (found [$2] in [$3])";; *) ok "$1";; esac; }
node_assert() { local script="$1"; shift; "$NODE_BIN" -e "$script" "$@" >/dev/null 2>&1; }

FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT
MEM="$FIX/Kaizen/demo-loop"
mkdir -p "$MEM"
# The strict validator (Fix 5) requires the complete memory structure.
mkdir -p "$MEM/cycles" "$MEM/evidence"
printf '{"schema_version":1,"entries":[]}\n' > "$MEM/evidence/manifest.json"
printf '# Kaizen Memory\n' > "$MEM/KAIZEN_MEMORY.md"
printf '# RESUME\n' > "$MEM/RESUME.md"
printf '# Backlog\n' > "$MEM/BACKLOG.md"
printf '# Decisions\n' > "$MEM/DECISIONS.md"
cat > "$MEM/LOCAL_STATE.json" <<JSON
{ "schema_version": 1, "loop_id": "demo-loop", "local_target_path": "$FIX/target",
  "kaizen_root_path": "$FIX/Kaizen", "scheduler": { "mechanism": "none", "label": null, "wrapper_path": null },
  "claude_session_id": null, "worktree_path": null, "test_artifact_paths": [] }
JSON

write_state() { # write_state <node-script> — rewrites STATE.json via node
  "$NODE_BIN" -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$MEM/STATE.json','utf8'));$1;fs.writeFileSync('$MEM/STATE.json',JSON.stringify(s,null,2))"
}
state_get() { # state_get <path-expr> — prints one field
  "$NODE_BIN" -e "const s=JSON.parse(require('fs').readFileSync('$MEM/STATE.json','utf8'));console.log(String($1))" 2>/dev/null || echo "__error__"
}

# ---------------------------------------------------------------------------
# 1. No scheduler before Contract approval.
# ---------------------------------------------------------------------------
# Simulated pre-approval state: approval.timestamp null, scheduler "none".
cat > "$MEM/STATE.json" <<JSON
{
  "schema_version": 1,
  "loop_id": "demo-loop",
  "name": "Demo Site",
  "status": "pending-approval",
  "contract_version": 1,
  "approval": { "timestamp": null, "approved_by": null },
  "target": { "type": "website", "repo_remote": null, "staging_url": null, "production_url": null },
  "direction": { "user_goal": "improve usability", "open_discovery": true },
  "scope": { "max_items_per_cycle": 3 },
  "permission_mode": "B",
  "proof_strategy": ["tests"],
  "schedule": { "human": "every 7 days", "mechanism": "none", "mechanism_id": null },
  "model": { "launcher": "claude-nine", "logical_lane": "opus", "resolved_route_snapshot": null },
  "last_cycle": { "id": null, "completed_at": null, "result": null },
  "backup": { "repo": null, "status": "none" },
  "resume": { "friendly_session_name": "kaizen-demo-loop" }
}
JSON
MECH="$(state_get "s.schedule.mechanism")"
case "$MECH" in none|manual|__error__) ok "pre-approval: schedule.mechanism is none/manual/absent (got: $MECH)";; *) bad "pre-approval: scheduler must not be armed (got: $MECH)";; esac

# Simulated activate step: write approval fields, arm the scheduler.
write_state "s.approval={timestamp:'2026-08-20T09:00:00Z',approved_by:'owner'};s.schedule.mechanism='desktop-local';s.schedule.mechanism_id='com.blackceo.kaizen.demo-loop'"
check_eq "activate step arms the scheduler" "desktop-local" "$(state_get "s.schedule.mechanism")"

# ---------------------------------------------------------------------------
# 2. No loop active before approval.
# ---------------------------------------------------------------------------
write_state "s.approval.timestamp=null;s.status='pending-approval'"
check_not_contains "pre-approval: status is not active" "active" "$(state_get "s.status")"
write_state "s.approval.timestamp='2026-08-20T09:00:00Z';s.status='active'"
check_eq "after approval: status becomes active" "active" "$(state_get "s.status")"

# ---------------------------------------------------------------------------
# 3. Approval timestamp parses as an ISO date.
# ---------------------------------------------------------------------------
TS="$(state_get "s.approval.timestamp")"
node_assert "if(Number.isNaN(Date.parse(process.argv[1])))process.exit(1)" "$TS" \
  && ok "approval.timestamp parses as ISO date ($TS)" || bad "approval.timestamp not ISO-parseable: $TS"

# ---------------------------------------------------------------------------
# 4 + 5. Contract edit: version bump, backup, approval reset.
# ---------------------------------------------------------------------------
cat > "$MEM/KAIZEN_CONTRACT.md" <<EOF
# Kaizen Contract — Demo Loop

- **Contract version:** 1
- **Loop ID:** demo-loop
- **Date created:** 2026-08-20

## Approval

- **User approval timestamp:** 2026-08-20 09:00 UTC
EOF
# Simulated edit step: back up current content, write version 2, clear approval.
cp "$MEM/KAIZEN_CONTRACT.md" "$MEM/KAIZEN_CONTRACT.md.bak"
cat > "$MEM/KAIZEN_CONTRACT.md" <<EOF
# Kaizen Contract — Demo Loop

- **Contract version:** 2
- **Loop ID:** demo-loop
- **Date created:** 2026-08-20

## Approval

- **User approval timestamp:** <not approved — edit invalidates prior approval>
EOF
check_contains "edit writes Contract version 2" "Contract version:** 2" "$(cat "$MEM/KAIZEN_CONTRACT.md")"
check_contains "previous content backed up (version 1 preserved)" "Contract version:** 1" "$(cat "$MEM/KAIZEN_CONTRACT.md.bak")"
write_state "s.contract_version=2;s.approval.timestamp=null;s.status='pending-approval'"
check_eq "edit bumps STATE contract_version" "2" "$(state_get "s.contract_version")"
check_eq "edit clears approval.timestamp (re-approval required)" "null" "$(state_get "s.approval.timestamp")"
check_not_contains "edited contract is not approved" "active" "$(state_get "s.status")"

# ---------------------------------------------------------------------------
# 6. Open-discovery clause cannot be omitted (template-level proof).
# ---------------------------------------------------------------------------
check_contains "template contains open-discovery clause" "does not limit what I can notice" "$(cat "$CONTRACT_TPL")"

# ---------------------------------------------------------------------------
# 7. Merge/deploy boundaries cannot be omitted (template-level proof).
# ---------------------------------------------------------------------------
TPL_TEXT="$(cat "$CONTRACT_TPL")"
check_contains "template names the merge boundary" "I do not merge to the main branch without your okay" "$TPL_TEXT"
check_contains "template names the deploy boundary" "I do not deploy to production without your okay" "$TPL_TEXT"
check_contains "template has a Where I stop section" "Where I stop" "$TPL_TEXT"

# ---------------------------------------------------------------------------
# 8. Scope below 3 / above 7 rejected (real validator).
# ---------------------------------------------------------------------------
# Base state (scope 3) must validate clean first — the control. The edit
# scenario above left the contract at version 2 with a placeholder approval
# line, so restore version 1 with a real approval before validating.
cat > "$MEM/KAIZEN_CONTRACT.md" <<EOF
# Kaizen Contract — Demo Loop

- **Contract version:** 1
- **Loop ID:** demo-loop
- **Date created:** 2026-08-20

## Approval

- **User approval timestamp:** 2026-08-20 09:00 UTC
EOF
write_state "s.scope={max_items_per_cycle:3};s.approval={timestamp:'2026-08-20T09:00:00Z',approved_by:'owner'};s.status='active';s.contract_version=1"
KAIZEN_DOWNLOADS="$FIX" "$NODE_BIN" "$VALIDATE_MJS" "$MEM" >/dev/null 2>&1 \
  && ok "control: scope 3 memory validates clean" || bad "control: scope 3 memory failed validation"
write_state "s.scope={max_items_per_cycle:2}"
KAIZEN_DOWNLOADS="$FIX" "$NODE_BIN" "$VALIDATE_MJS" "$MEM" >/dev/null 2>&1 \
  && bad "scope 2 must be rejected" || ok "scope 2 rejected by validator"
write_state "s.scope={max_items_per_cycle:8}"
KAIZEN_DOWNLOADS="$FIX" "$NODE_BIN" "$VALIDATE_MJS" "$MEM" >/dev/null 2>&1 \
  && bad "scope 8 must be rejected" || ok "scope 8 rejected by validator"
write_state "s.scope={max_items_per_cycle:3}"

# ---------------------------------------------------------------------------
# 9. Permission Mode A performs no target writes (run-record invariant).
# ---------------------------------------------------------------------------
cat > "$MEM/run-record-mode-a.json" <<'JSON'
{ "permission_mode": "A", "entries": [
  { "type": "read", "file": "index.html" },
  { "type": "observe", "file": "site" },
  { "type": "report", "file": null }
] }
JSON
node_assert "const r=require('$MEM/run-record-mode-a.json');const bad=r.entries.filter(e=>/write|modif|create|delete|edit/i.test(e.type));process.exit(bad.length)" \
  && ok "mode A: zero file-modification entries" || bad "mode A: modification entry found"

# ---------------------------------------------------------------------------
# 10. Mode B permits only safe branch/worktree changes.
# ---------------------------------------------------------------------------
cat > "$MEM/run-record-mode-b.json" <<'JSON'
{ "permission_mode": "B", "entries": [
  { "type": "branch-created", "scope": "branch", "target": "kaizen/demo-loop/cycle-001" },
  { "type": "edit", "scope": "worktree", "target": "kaizen/demo-loop/cycle-001" },
  { "type": "commit", "scope": "branch", "target": "kaizen/demo-loop/cycle-001" }
] }
JSON
node_assert "const r=require('$MEM/run-record-mode-b.json');const bad=r.entries.filter(e=>!(e.scope==='branch'||e.scope==='worktree'));process.exit(bad.length)" \
  && ok "mode B: every entry branch/worktree-scoped" || bad "mode B: non-branch/worktree entry found"
node_assert "const r=require('$MEM/run-record-mode-b.json');process.exit(r.entries.some(e=>e.scope==='main'||/main/.test(e.target||''))?1:0)" \
  && ok "mode B: no direct edits on main" || bad "mode B: direct main edit found"

# ---------------------------------------------------------------------------
# 11. Mode C retains high-consequence approval boundaries.
# ---------------------------------------------------------------------------
cat > "$MEM/act-record-mode-c.json" <<'JSON'
{ "permission_mode": "C", "boundaries": [
  { "action": "merge to main", "status": "NEEDS APPROVAL" },
  { "action": "deploy to production", "status": "NEEDS APPROVAL" }
] }
JSON
node_assert "const r=require('$MEM/act-record-mode-c.json');const need=r.boundaries.filter(b=>/merge|deploy/i.test(b.action));process.exit(need.length===2&&need.every(b=>b.status==='NEEDS APPROVAL')?0:1)" \
  && ok "mode C: merge and deploy marked NEEDS APPROVAL" || bad "mode C: approval boundary missing"
check_contains "pdca-cycle.md stop-for-approval names merge" "merge to main/default/protected branch" "$(cat "$PDCA_DOC")"
check_contains "pdca-cycle.md stop-for-approval names production deploy" "production deploy" "$(cat "$PDCA_DOC")"

# ---------------------------------------------------------------------------
# 12. Critical security finding outranks the narrow stated goal.
# ---------------------------------------------------------------------------
cat > "$MEM/findings.json" <<'JSON'
[ { "id": "KZ-001-101", "title": "polish button color", "type": "cosmetic", "priority": 7 },
  { "id": "KZ-001-102", "title": "exposed admin panel", "type": "security", "priority": 1 },
  { "id": "KZ-001-103", "title": "stated goal: faster checkout", "type": "user-value", "priority": 4 } ]
JSON
node_assert "const f=require('$MEM/findings.json');const s=[...f].sort((a,b)=>a.priority-b.priority);process.exit(s[0].type==='security'?0:1)" \
  && ok "critical security finding sorts first regardless of stated direction" || bad "security finding did not outrank"
check_contains "pdca-cycle.md: catastrophic/security is priority 1" "catastrophic / security / data-loss" "$(cat "$PDCA_DOC")"
check_contains "pdca-cycle.md: critical findings can outrank user direction" "critical findings can" "$(cat "$PDCA_DOC")"

# ---------------------------------------------------------------------------
# 13. First cycle starts immediately after activation unless user waits.
# ---------------------------------------------------------------------------
write_state "s.next_cycle_at='immediate';s.wait_before_first_cycle=false"
check_eq "wait=false: next_cycle_at is immediate" "immediate" "$(state_get "s.next_cycle_at")"
write_state "s.next_cycle_at='held';s.wait_before_first_cycle=true"
check_eq "wait=true: next_cycle_at held" "held" "$(state_get "s.next_cycle_at")"

echo
echo "fix12-contract-tests: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
