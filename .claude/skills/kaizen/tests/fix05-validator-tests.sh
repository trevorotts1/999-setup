#!/usr/bin/env bash
# Fix 5: strict memory validation tests for validate-kaizen-memory.mjs.
# Self-contained fixtures under mktemp. Never touches real ~/.claude, ~/Downloads, launchd.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAL="${SCRIPT_DIR}/../scripts/common/validate-kaizen-memory.mjs"
PASS=0; FAIL=0; FAILED_TESTS=""

t() { # t <name> <expected-exit> <actual-exit>
  local name="$1" want="$2" got="$3"
  if [ "$want" -eq "$got" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILED_TESTS="${FAILED_TESTS} ${name}"; echo "FAIL: ${name} (want exit ${want}, got ${got})"; fi
}

assert_contains() { # <name> <haystack> <needle>
  local name="$1" hay="$2" needle="$3"
  if printf '%s' "$hay" | grep -qF -- "$needle"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILED_TESTS="${FAILED_TESTS} ${name}"; echo "FAIL: ${name} (output missing: ${needle})"; fi
}

assert_not_contains() { # <name> <haystack> <needle>
  local name="$1" hay="$2" needle="$3"
  if printf '%s' "$hay" | grep -qF -- "$needle"; then FAIL=$((FAIL+1)); FAILED_TESTS="${FAILED_TESTS} ${name}"; echo "FAIL: ${name} (output should NOT contain: ${needle})"; else PASS=$((PASS+1)); fi
}

# --- fixture builder ---------------------------------------------------------
# build_fixture <dir> builds a complete, valid memory folder.
build_fixture() {
  local d="$1"
  mkdir -p "$d/cycles" "$d/evidence"
  printf '# Kaizen Contract — My Website\n\n- **Contract version:** 1\n- **Loop ID:** loop-abc123\n' > "$d/KAIZEN_CONTRACT.md"
  printf '# Kaizen Memory\n' > "$d/KAIZEN_MEMORY.md"
  printf '# Resume\n' > "$d/RESUME.md"
  printf '# Backlog\n' > "$d/BACKLOG.md"
  printf '# Decisions\n' > "$d/DECISIONS.md"
  printf '# Cycle 001\n\n- **loop_id:** loop-abc123\n- **loop-id:** loop-abc123\n' > "$d/cycles/2026-08-20-cycle-001.md"
  cat > "$d/STATE.json" <<'EOF'
{
  "schema_version": 1,
  "loop_id": "loop-abc123",
  "status": "active",
  "contract_version": 1,
  "target": {"type": "website", "repo_remote": "https://github.com/example/repo"},
  "direction": {"user_goal": "Make it easier to use", "open_discovery": true},
  "scope": {"max_items_per_cycle": 5},
  "permission_mode": "B",
  "proof_strategy": ["tests", "build"],
  "schedule": {"human": "every 7 days", "mechanism": "desktop-task", "mechanism_id": null},
  "model": {"launcher": "claude-nine", "logical_lane": "opus"},
  "last_cycle": {"id": "cycle-001", "completed_at": null, "result": null},
  "backup": {"repo": null, "status": "none"},
  "approval": {"timestamp": "2026-08-20 10:00 UTC", "approved_by": "owner"},
  "some_unknown_field": {"keep": "me"}
}
EOF
  cat > "$d/LOCAL_STATE.json" <<'EOF'
{
  "schema_version": 1,
  "loop_id": "loop-abc123",
  "local_target_path": "/tmp/example-target",
  "kaizen_root_path": "/tmp/example-kaizen-root",
  "scheduler": {"mechanism": "launchd", "label": "com.blackceo.kaizen.abc123", "plist_path": "/tmp/com.blackceo.kaizen.abc123.plist", "cadence": "7d", "requested_cadence": "7d"},
  "claude_session_id": null,
  "worktree_path": null,
  "test_artifact_paths": []
}
EOF
  cat > "$d/evidence/manifest.json" <<'EOF'
{"schema_version": 1, "entries": []}
EOF
}

run_val() { # run_val <dir> [extra-arg...]  → sets OUT and RC
  OUT="$(node "$VAL" "$@" 2>&1)"; RC=$?
}

# --- T01: empty dir fails naming all missing ----------------------------------
FIX="$(mktemp -d)"; trap 'rm -rf "$FIX"' EXIT
EMPTY="$FIX/empty"; mkdir -p "$EMPTY"
run_val "$EMPTY"; t "T01 empty dir exit" 1 $RC
for f in KAIZEN_CONTRACT.md KAIZEN_MEMORY.md STATE.json LOCAL_STATE.json RESUME.md BACKLOG.md DECISIONS.md evidence/manifest.json; do
  assert_contains "T01 names ${f}" "$OUT" "$f"
done
assert_contains "T01 names cycles/" "$OUT" "cycles/"
assert_contains "T01 names evidence/" "$OUT" "evidence/"

# --- T02: notes.json only fails naming missing files ---------------------------
N="$FIX/notesonly"; mkdir -p "$N"
printf '{}\n' > "$N/notes.json"
run_val "$N"; t "T02 notes-only exit" 1 $RC
assert_contains "T02 names STATE.json" "$OUT" "STATE.json"
assert_contains "T02 names KAIZEN_CONTRACT.md" "$OUT" "KAIZEN_CONTRACT.md"
assert_contains "T02 not ok" "$OUT" '"ok":false'

# --- T03: complete valid memory passes -----------------------------------------
V="$FIX/valid"; build_fixture "$V"
BEFORE="$(cksum "$V/STATE.json")"
run_val "$V"; t "T03 valid exit" 0 $RC
AFTER="$(cksum "$V/STATE.json")"
[ "$BEFORE" = "$AFTER" ]; t "T03 STATE.json byte-identical" 0 $?
# unknown field preserved byte-for-byte
assert_contains "T03 unknown field survives" "$(cat "$V/STATE.json")" '"some_unknown_field"'
assert_contains "T03 ok" "$OUT" '"ok":true'

# --- T04: broken JSON reported with file + reason ------------------------------
B="$FIX/badjson"; build_fixture "$B"
printf '{ "loop_id": "loop-abc123", \n' > "$B/STATE.json"
run_val "$B"; t "T04 bad json exit" 1 $RC
assert_contains "T04 names STATE.json" "$OUT" "STATE.json"
assert_contains "T04 reason" "$OUT" "invalid JSON"

# --- T05: loop-id mismatch STATE vs LOCAL_STATE --------------------------------
M="$FIX/mismatch"; build_fixture "$M"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));s.loop_id="loop-wrong";fs.writeFileSync(p+"/STATE.json",JSON.stringify(s));' "$M"
run_val "$M"; t "T05 mismatch exit" 1 $RC
assert_contains "T05 mismatch local" "$OUT" "LOCAL_STATE.json"
assert_contains "T05 mismatch detail" "$OUT" "does not match"

# --- T06: contract loop-id mismatch --------------------------------------------
C="$FIX/contractmismatch"; build_fixture "$C"
printf '# Kaizen Contract — My Website\n\n- **Contract version:** 1\n- **Loop ID:** loop-other-999\n' > "$C/KAIZEN_CONTRACT.md"
run_val "$C"; t "T06 contract mismatch exit" 1 $RC
assert_contains "T06 names contract" "$OUT" "KAIZEN_CONTRACT.md"
assert_contains "T06 detail" "$OUT" "does not match STATE.json"

# --- T07: cycle record loop-id mismatch ----------------------------------------
Y="$FIX/cyclemismatch"; build_fixture "$Y"
printf '# Cycle 002\n\n- **loop_id:** loop-wrong-777\n' > "$Y/cycles/2026-08-20-cycle-002.md"
run_val "$Y"; t "T07 cycle mismatch exit" 1 $RC
assert_contains "T07 names cycle" "$OUT" "cycles/2026-08-20-cycle-002.md"

# --- T08: registry loop-id mismatch + escape -----------------------------------
R="$FIX/regroot/My Website"; mkdir -p "$R"; build_fixture "$R"
cat > "$FIX/regroot/REGISTRY.json" <<'EOF'
{"schema_version": 1, "loops": [{"loop_id": "loop-abc123", "name": "My Website", "memory_dir": "My Website", "status": "active"}]}
EOF
run_val "$R"; t "T08 registry matching loop exit" 0 $RC
node -e 'const fs=require("fs");const p=process.argv[1];const r=JSON.parse(fs.readFileSync(p+"/REGISTRY.json","utf8"));r.loops[0].loop_id="loop-wrong-555";fs.writeFileSync(p+"/REGISTRY.json",JSON.stringify(r));' "$FIX/regroot"
run_val "$R"; t "T08 registry mismatch exit" 1 $RC
assert_contains "T08 names REGISTRY.json" "$OUT" "REGISTRY.json"
cat > "$FIX/regroot/REGISTRY.json" <<'EOF'
{"schema_version": 1, "loops": [{"loop_id": "loop-abc123", "name": "My Website", "memory_dir": "../../escape-me", "status": "active"}]}
EOF
run_val "$R"; t "T08 registry escape exit" 1 $RC
assert_contains "T08 escape detail" "$OUT" "escapes the Kaizen root"

# --- T09: scope bounds 2 and 8 fail, 3 and 7 pass -------------------------------
for n in 2 8; do
  S="$FIX/scope$n"; build_fixture "$S"
  node -e 'const fs=require("fs");const p=process.argv[1];const n=Number(process.argv[2]);const s=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));s.scope.max_items_per_cycle=n;fs.writeFileSync(p+"/STATE.json",JSON.stringify(s));' "$S" "$n"
  run_val "$S"; t "T09 scope ${n} exit" 1 $RC
  assert_contains "T09 scope ${n} names STATE" "$OUT" "scope.max_items_per_cycle"
done
for n in 3 7; do
  S="$FIX/scopepass$n"; build_fixture "$S"
  node -e 'const fs=require("fs");const p=process.argv[1];const n=Number(process.argv[2]);const s=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));s.scope.max_items_per_cycle=n;fs.writeFileSync(p+"/STATE.json",JSON.stringify(s));' "$S" "$n"
  run_val "$S"; t "T09 scope ${n} pass exit" 0 $RC
done

# --- T10: permission_mode D fails ----------------------------------------------
P="$FIX/permD"; build_fixture "$P"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));s.permission_mode="D";fs.writeFileSync(p+"/STATE.json",JSON.stringify(s));' "$P"
run_val "$P"; t "T10 perm D exit" 1 $RC
assert_contains "T10 names STATE" "$OUT" "permission_mode must be A, B, or C"
assert_contains "T10 shows value" "$OUT" 'D'

# --- T11: schedule before approval fails; manual/none pass ----------------------
S="$FIX/schedpre"; build_fixture "$S"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));delete s.approval;delete s.status;s.schedule.mechanism="launchd";fs.writeFileSync(p+"/STATE.json",JSON.stringify(s));' "$S"
run_val "$S"; t "T11 active schedule pre-approval exit" 1 $RC
assert_contains "T11 detail" "$OUT" "may not be active before approval"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));s.schedule.mechanism="none";fs.writeFileSync(p+"/STATE.json",JSON.stringify(s));' "$S"
run_val "$S"; t "T11 none pre-approval exit" 0 $RC
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));s.schedule.mechanism="manual";fs.writeFileSync(p+"/STATE.json",JSON.stringify(s));' "$S"
run_val "$S"; t "T11 manual pre-approval exit" 0 $RC

# --- T12: status active without approval fails ---------------------------------
A="$FIX/activenoapproval"; build_fixture "$A"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));delete s.approval;s.schedule.mechanism="manual";fs.writeFileSync(p+"/STATE.json",JSON.stringify(s));' "$A"
run_val "$A"; t "T12 active-no-approval exit" 1 $RC
assert_contains "T12 detail" "$OUT" "status active requires approval.timestamp"

# --- T13: contract version mismatch --------------------------------------------
V2="$FIX/ver"; build_fixture "$V2"
printf '# Kaizen Contract — My Website\n\n- **Contract version:** 7\n- **Loop ID:** loop-abc123\n' > "$V2/KAIZEN_CONTRACT.md"
run_val "$V2"; t "T13 version mismatch exit" 1 $RC
assert_contains "T13 names contract" "$OUT" "KAIZEN_CONTRACT.md"
assert_contains "T13 detail" "$OUT" "contract version 7 does not match STATE.json contract_version 1"

# --- T14: placeholder in RESUME.md ---------------------------------------------
PH="$FIX/placeholder"; build_fixture "$PH"
printf '# Resume\n\nNext: <do the thing>\n' > "$PH/RESUME.md"
run_val "$PH"; t "T14 placeholder exit" 1 $RC
assert_contains "T14 names RESUME.md" "$OUT" "RESUME.md"
assert_contains "T14 placeholder text" "$OUT" "unresolved template placeholder"

# --- T15: bad manifest ---------------------------------------------------------
BM="$FIX/badmanifest"; build_fixture "$BM"
printf '{"schema_version": 2, "entries": "nope"}\n' > "$BM/evidence/manifest.json"
run_val "$BM"; t "T15 bad manifest exit" 1 $RC
assert_contains "T15 names manifest" "$OUT" "evidence/manifest.json"
assert_contains "T15 schema detail" "$OUT" "schema_version must be 1"
assert_contains "T15 entries detail" "$OUT" "entries must be an array"

# --- T16: symlink escaping root -------------------------------------------------
SL="$FIX/symlink"; build_fixture "$SL"
OUTSIDE="$FIX/outside"; mkdir -p "$OUTSIDE"
printf '# Outside\n' > "$OUTSIDE/notes.md"
ln -s "$OUTSIDE" "$SL/cycles/evil-link"
run_val "$SL"; t "T16 symlink escape exit" 1 $RC
assert_contains "T16 names link" "$OUT" "evil-link"
assert_contains "T16 detail" "$OUT" "symlink escapes memory root"

# --- T17: bad LOCAL_STATE mechanism --------------------------------------------
LM="$FIX/badmech"; build_fixture "$LM"
node -e 'const fs=require("fs");const p=process.argv[1];const l=JSON.parse(fs.readFileSync(p+"/LOCAL_STATE.json","utf8"));l.scheduler.mechanism="cron-bad";fs.writeFileSync(p+"/LOCAL_STATE.json",JSON.stringify(l));' "$LM"
run_val "$LM"; t "T17 bad mechanism exit" 1 $RC
assert_contains "T17 names LOCAL_STATE" "$OUT" "LOCAL_STATE.json"
assert_contains "T17 detail" "$OUT" "scheduler.mechanism must be one of"

# --- T18: no args → usage exit 2 -----------------------------------------------
node "$VAL" >/dev/null 2>&1; t "T18 usage exit" 2 $?
node "$VAL" /nonexistent-folder-xyz >/dev/null 2>&1; t "T18 bad folder exit" 2 $?

echo ""
echo "fix05: PASS=${PASS} FAIL=${FAIL}"
if [ "$FAIL" -gt 0 ]; then echo "failed tests:${FAILED_TESTS}"; fi
exit "$FAIL"
