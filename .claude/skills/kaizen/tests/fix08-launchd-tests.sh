#!/bin/bash
# Fix 8 tests: macOS launchd repair.
# Fixtures only: mktemp homes, a fake launcher, and a fake launchctl shim.
# Never touches the real launchd, the real ~/.claude, or the real Downloads.
#
# usage: fix08-launchd-tests.sh [--verbose]
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MACOS_DIR="$SKILL_DIR/scripts/macos"
COMMON_DIR="$SKILL_DIR/scripts/common"
INSTALL_SH="$MACOS_DIR/install-kaizen-launchagent.sh"
REMOVE_SH="$MACOS_DIR/remove-kaizen-launchagent.sh"
RUN_SH="$MACOS_DIR/run-kaizen-cycle.sh"
CTL_SH="$MACOS_DIR/kaizen-launchagent-ctl.sh"
PLIST_ESC="$MACOS_DIR/plist-escape.sh"
STATE_MJS="$COMMON_DIR/kaizen-state.mjs"
NODE_BIN="${NODE_BIN:-node}"
PASS=0
FAIL=0
VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

ok()  { PASS=$((PASS+1)); [ "$VERBOSE" = "1" ] && echo "  ok: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
check_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi; }
check_contains() { case "$3" in *"$2"*) ok "$1";; *) bad "$1 (missing [$2] in [$3])";; esac; }
check_not_contains() { case "$3" in *"$2"*) bad "$1 (found [$2])";; *) ok "$1";; esac; }

# Fixture dirs. KAIZEN_DOWNLOADS points at a fake Downloads so the memory
# root resolution never sees the real one.
FIXROOT="$(mktemp -d)"
FAKE_DL="$FIXROOT/Downloads"
FAKE_HOME="$FIXROOT/home"
FAKE_HOME2="$FIXROOT/home2"
mkdir -p "$FAKE_DL" "$FAKE_HOME" "$FAKE_HOME2"
LAUNCHCTL_LOG="$FIXROOT/launchctl.log"
: > "$LAUNCHCTL_LOG"
LOOP_ID="test-loop-08"
MEM_ROOT="$FAKE_DL/Kaizen"
LOOP_DIR="$MEM_ROOT/$LOOP_ID"
mkdir -p "$LOOP_DIR/cycles"
cat > "$LOOP_DIR/STATE.json" <<'EOF'
{
  "schema_version": 1,
  "loop_id": "test-loop-08",
  "name": "Fix8 Fixture",
  "status": "active",
  "contract_version": 1,
  "target": {"type": "website"},
  "direction": {"user_goal": "test"},
  "scope": {"max_items_per_cycle": 5},
  "permission_mode": "improve-safe",
  "proof_strategy": ["tests"],
  "schedule": {"human": "daily", "mechanism": "launchd", "mechanism_id": null},
  "model": {"launcher": "claude-nine", "logical_lane": "opus", "resolved_route_snapshot": null},
  "last_cycle": {"id": "cycle-001", "completed_at": null, "result": null},
  "backup": {"repo": null, "status": "none"},
  "resume": {"friendly_session_name": "kaizen-test-loop-08"}
}
EOF
cat > "$LOOP_DIR/LOCAL_STATE.json" <<'EOF'
{
  "schema_version": 1,
  "loop_id": "test-loop-08",
  "local_target_path": "/tmp",
  "kaizen_root_path": "/tmp",
  "scheduler": {"mechanism": "none"},
  "claude_session_id": null,
  "worktree_path": null,
  "test_artifact_paths": []
}
EOF

# Fake launcher: records its "$@" to a file, exits with $FAKE_LAUNCHER_EXIT.
FAKE_LAUNCHER="$FIXROOT/bin/fake-launcher"
mkdir -p "$(dirname "$FAKE_LAUNCHER")"
cat > "$FAKE_LAUNCHER" <<'EOF'
#!/bin/bash
printf '%s\n' "$@" > "${FAKE_LAUNCHER_ARGS_FILE:?}"
exit "${FAKE_LAUNCHER_EXIT:-0}"
EOF
chmod +x "$FAKE_LAUNCHER"
export FAKE_LAUNCHER_ARGS_FILE="$FIXROOT/launcher-args.txt"
export FAKE_LAUNCHER_EXIT=0

# Fake launchctl shim on PATH: records load/unload/list and exits 0.
FAKE_BIN="$FIXROOT/bin"
cat > "$FAKE_BIN/launchctl" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "${KAIZEN_FAKE_LAUNCHCTL_LOG:?}"
exit 0
EOF
chmod +x "$FAKE_BIN/launchctl"

# Non-dry-run env: real temp HOME (so LOCAL_STATE.json writes are real) plus
# the fake launchctl shim.
RUN_ENV="HOME=$FAKE_HOME KAIZEN_DOWNLOADS=$FAKE_DL KAIZEN_NODE_BIN=$NODE_BIN KAIZEN_FAKE_LAUNCHCTL_LOG=$LAUNCHCTL_LOG PATH=$FAKE_BIN:$PATH"
DRY_ENV="HOME=$FAKE_HOME2 KAIZEN_DOWNLOADS=$FAKE_DL KAIZEN_NODE_BIN=$NODE_BIN KAIZEN_LAUNCHD_DRY_RUN=1"

cleanup() { rm -rf "$FIXROOT"; }
trap cleanup EXIT

echo "== fix08: plist escape self-test =="
OUT="$(bash "$PLIST_ESC")"
check_eq "plist-escape self-test" "OK: &amp; &lt; &gt; &quot; &apos;" "$OUT"
# 0x27 single-quote sanity, verified against the exact expected string
EXPECTED_27="OK: &amp; &lt; &gt; &quot; &apos;"
check_eq "plist-escape single quote (0x27) exact" "$EXPECTED_27" "$OUT"

echo "== fix08: install dry-run — StartInterval =="
env $DRY_ENV bash "$INSTALL_SH" "$LOOP_ID" daily > "$FIXROOT/inst1.out" 2>&1
check_eq "dry-run install exits 0" "0" "$?"
check_contains "dry-run prints dry-run" "dry-run" "$(cat "$FIXROOT/inst1.out")"
PLIST="$FAKE_HOME2/Library/LaunchAgents/com.blackceo.kaizen.test-loop-08.plist"
check_eq "plist written in fake HOME" "0" "$([ -f "$PLIST" ] && echo 0 || echo 1)"
check_contains "plist has StartInterval 86400" "86400" "$(cat "$PLIST")"
check_not_contains "dry-run has no StartCalendarInterval" "StartCalendarInterval" "$(cat "$PLIST")"
if command -v plutil >/dev/null 2>&1; then
  check_eq "plutil -lint passes (dry-run daily)" "0" "$(plutil -lint "$PLIST" >/dev/null 2>&1; echo $?)"
fi
# dry-run must NOT write the loop's LOCAL_STATE.json scheduler
check_eq "dry-run leaves LOCAL_STATE scheduler untouched" "none" "$("$NODE_BIN" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.scheduler.mechanism);' "$LOOP_DIR/LOCAL_STATE.json")"

echo "== fix08: install dry-run — calendar schedules =="
env $DRY_ENV bash "$INSTALL_SH" "$LOOP_ID" daily --calendar weekly >/dev/null 2>&1
P_W="$FAKE_HOME2/Library/LaunchAgents/com.blackceo.kaizen.test-loop-08.plist"
check_contains "weekly plist Weekday key" "<key>Weekday</key>" "$(cat "$P_W")"
check_contains "weekly plist Weekday=1" "<integer>1</integer>" "$(cat "$P_W")"
check_contains "weekly plist Hour key" "<key>Hour</key>" "$(cat "$P_W")"
check_contains "weekly plist Minute key" "<key>Minute</key>" "$(cat "$P_W")"
check_not_contains "weekly plist has no StartInterval" "<key>StartInterval</key>" "$(cat "$P_W")"
if command -v plutil >/dev/null 2>&1; then
  check_eq "plutil -lint passes (weekly)" "0" "$(plutil -lint "$P_W" >/dev/null 2>&1; echo $?)"
fi

env $DRY_ENV bash "$INSTALL_SH" "$LOOP_ID" daily --calendar monthly >/dev/null 2>&1
P_M="$FAKE_HOME2/Library/LaunchAgents/com.blackceo.kaizen.test-loop-08.plist"
check_contains "monthly plist Day=1" "<key>Day</key>" "$(cat "$P_M")"

env $DRY_ENV bash "$INSTALL_SH" "$LOOP_ID" daily --calendar quarterly >/dev/null 2>&1
P_Q="$FAKE_HOME2/Library/LaunchAgents/com.blackceo.kaizen.test-loop-08.plist"
check_contains "quarterly plist Month key" "<key>Month</key>" "$(cat "$P_Q")"
check_contains "quarterly plist Month 1" "<integer>1</integer>" "$(cat "$P_Q")"
check_contains "quarterly plist Month 4" "<integer>4</integer>" "$(cat "$P_Q")"
check_contains "quarterly plist Month 7" "<integer>7</integer>" "$(cat "$P_Q")"
check_contains "quarterly plist Month 10" "<integer>10</integer>" "$(cat "$P_Q")"

# 90days is an exact-elapsed keyword, NOT a calendar schedule
env $DRY_ENV bash "$INSTALL_SH" "$LOOP_ID" 90days >/dev/null 2>&1
P_90="$FAKE_HOME2/Library/LaunchAgents/com.blackceo.kaizen.test-loop-08.plist"
check_contains "90days keeps StartInterval" "StartInterval" "$(cat "$P_90")"
check_not_contains "90days has no StartCalendarInterval" "StartCalendarInterval" "$(cat "$P_90")"

# weekly as the interval keyword is a calendar schedule
env $DRY_ENV bash "$INSTALL_SH" "$LOOP_ID" weekly >/dev/null 2>&1
P_WK="$FAKE_HOME2/Library/LaunchAgents/com.blackceo.kaizen.test-loop-08.plist"
check_contains "weekly keyword maps to StartCalendarInterval" "StartCalendarInterval" "$(cat "$P_WK")"
check_contains "weekly keyword plist has Weekday" "<key>Weekday</key>" "$(cat "$P_WK")"

echo "== fix08: real HOME + fake launchctl — install, idempotency, state =="
: > "$LAUNCHCTL_LOG"
env $RUN_ENV bash "$INSTALL_SH" "$LOOP_ID" daily > "$FIXROOT/inst2.out" 2>&1
check_eq "real install exits 0" "0" "$?"
check_contains "launchctl load called" "load" "$(cat "$LAUNCHCTL_LOG")"
PLIST_R="$FAKE_HOME/Library/LaunchAgents/com.blackceo.kaizen.test-loop-08.plist"
check_eq "real plist exists" "0" "$([ -f "$PLIST_R" ] && echo 0 || echo 1)"
S1="$("$NODE_BIN" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(j.scheduler));' "$LOOP_DIR/LOCAL_STATE.json")"
check_contains "scheduler.interval stored" '"interval":"daily"' "$S1"
check_contains "scheduler.cadence stored" '"cadence":"exact_elapsed"' "$S1"
check_contains "scheduler.label stored" '"label":"com.blackceo.kaizen.test-loop-08"' "$S1"

# idempotent reinstall: second install unloads first, one plist, latest interval
: > "$LAUNCHCTL_LOG"
env $RUN_ENV bash "$INSTALL_SH" "$LOOP_ID" weekly >/dev/null 2>&1
check_contains "reinstall unloads old job" "unload" "$(cat "$LAUNCHCTL_LOG")"
COUNT="$(find "$FAKE_HOME/Library/LaunchAgents" -name 'com.blackceo.kaizen.test-loop-08.plist' | wc -l | tr -d ' ')"
check_eq "one plist after reinstall" "1" "$COUNT"
# weekly is a calendar schedule: the plist must reflect the calendar block
check_contains "plist reflects latest interval (weekly calendar)" "StartCalendarInterval" "$(cat "$PLIST_R")"
check_contains "weekly calendar plist has Weekday key" "<key>Weekday</key>" "$(cat "$PLIST_R")"

echo "== fix08: ctl status/disable/enable with fake launchctl =="
env $RUN_ENV bash "$CTL_SH" "$LOOP_ID" status > "$FIXROOT/status.out" 2>&1
check_eq "ctl status exits 0" "0" "$?"
ST="$(cat "$FIXROOT/status.out")"
check_contains "status installed:1" '"installed":1' "$ST"
check_contains "status has label" '"label":"com.blackceo.kaizen.test-loop-08"' "$ST"
check_contains "status has plist_path" '"plist_path":"' "$ST"
check_contains "status loaded field" '"loaded":' "$ST"
check_contains "status enabled field" '"enabled":' "$ST"
check_contains "status last_run_from_local_state" '"last_run_from_local_state":' "$ST"

: > "$LAUNCHCTL_LOG"
env $RUN_ENV bash "$CTL_SH" "$LOOP_ID" disable >/dev/null 2>&1
check_contains "disable calls unload -w" "unload -w" "$(cat "$LAUNCHCTL_LOG")"
EN="$("$NODE_BIN" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.scheduler.enabled));' "$LOOP_DIR/LOCAL_STATE.json")"
check_eq "disable sets scheduler.enabled=false" "false" "$EN"

: > "$LAUNCHCTL_LOG"
env $RUN_ENV bash "$CTL_SH" "$LOOP_ID" enable >/dev/null 2>&1
check_contains "enable calls load -w" "load -w" "$(cat "$LAUNCHCTL_LOG")"
EN="$("$NODE_BIN" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.scheduler.enabled));' "$LOOP_DIR/LOCAL_STATE.json")"
check_eq "enable sets scheduler.enabled=true" "true" "$EN"

env $DRY_ENV bash "$CTL_SH" "$LOOP_ID" disable > "$FIXROOT/ctl-dry.out" 2>&1
check_contains "ctl dry-run prints dry-run" "dry-run" "$(cat "$FIXROOT/ctl-dry.out")"
check_contains "ctl dry-run says would-launchctl" "would-launchctl" "$(cat "$FIXROOT/ctl-dry.out")"

env $RUN_ENV bash "$CTL_SH" "$LOOP_ID" reinstall >/dev/null 2>&1
check_eq "ctl reinstall exits 0" "0" "$?"
S2="$("$NODE_BIN" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(j.scheduler));' "$LOOP_DIR/LOCAL_STATE.json")"
check_contains "reinstall restores stored cadence interval" '"interval":"weekly"' "$S2"

echo "== fix08: remove — idempotent, clears state =="
env $RUN_ENV bash "$REMOVE_SH" "$LOOP_ID" > "$FIXROOT/rm1.out" 2>&1
check_eq "remove exits 0" "0" "$?"
check_eq "plist gone after remove" "1" "$([ -f "$PLIST_R" ] && echo 0 || echo 1)"
HAS_SCHED="$("$NODE_BIN" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.scheduler? "yes":"no");' "$LOOP_DIR/LOCAL_STATE.json")"
check_eq "remove clears LOCAL_STATE scheduler" "no" "$HAS_SCHED"
env $RUN_ENV bash "$REMOVE_SH" "$LOOP_ID" > "$FIXROOT/rm2.out" 2>&1
check_eq "second remove exits 0 (idempotent)" "0" "$?"
check_contains "second remove says nothing installed" "nothing installed" "$(cat "$FIXROOT/rm2.out")"

# dry-run remove touches nothing
env $RUN_ENV bash "$INSTALL_SH" "$LOOP_ID" daily >/dev/null 2>&1
env $DRY_ENV bash "$REMOVE_SH" "$LOOP_ID" > "$FIXROOT/rm3.out" 2>&1
check_contains "remove dry-run prints dry-run" "dry-run" "$(cat "$FIXROOT/rm3.out")"
check_eq "remove dry-run keeps real plist" "0" "$([ -f "$PLIST_R" ] && echo 0 || echo 1)"

echo "== fix08: run-kaizen-cycle — prompt, cwd, truthful exit, lock =="
: > "$FAKE_LAUNCHER_ARGS_FILE"
env HOME="$FAKE_HOME" KAIZEN_DOWNLOADS="$FAKE_DL" KAIZEN_NODE_BIN=$NODE_BIN PATH="$FAKE_BIN:$PATH" \
  bash "$RUN_SH" "$LOOP_ID" --launcher fake-launcher > "$FIXROOT/run1.out" 2>&1
check_eq "run success exits 0" "0" "$?"
ARGS="$(cat "$FAKE_LAUNCHER_ARGS_FILE")"
check_contains "prompt is natural-language" "Use the kaizen skill" "$ARGS"
check_not_contains "prompt is not a slash command" "/kaizen run" "$ARGS"
check_contains "prompt names the loop id" "$LOOP_ID" "$ARGS"
LAST_JSON="$(ls "$LOOP_DIR/cycles"/launchd-run-*.json | tail -1)"
RJ="$(cat "$LAST_JSON")"
check_contains "run json result ok" '"result":"ok"' "$RJ"
check_contains "run json exit_code 0" '"exit_code":0' "$RJ"
check_contains "run json names launcher" '"launcher":"fake-launcher"' "$RJ"
check_contains "run json has log path" '"log":"' "$RJ"
# cwd: fake launcher must be invoked from the target path (LOCAL_STATE local_target_path=/tmp)
: > "$FAKE_LAUNCHER_ARGS_FILE"
FAKE_LAUNCHER_CWD_FILE="$FIXROOT/cwd.txt"
cat > "$FAKE_LAUNCHER" <<'EOF'
#!/bin/bash
printf '%s\n' "$@" > "${FAKE_LAUNCHER_ARGS_FILE:?}"
pwd -P > "${FAKE_LAUNCHER_CWD_FILE:?}"
exit "${FAKE_LAUNCHER_EXIT:-0}"
EOF
chmod +x "$FAKE_LAUNCHER"
export FAKE_LAUNCHER_CWD_FILE
env HOME="$FAKE_HOME" KAIZEN_DOWNLOADS="$FAKE_DL" KAIZEN_NODE_BIN=$NODE_BIN PATH="$FAKE_BIN:$PATH" \
  bash "$RUN_SH" "$LOOP_ID" --launcher fake-launcher >/dev/null 2>&1
check_eq "cwd equals target_local_path" "$(cd /tmp && pwd -P)" "$(cat "$FAKE_LAUNCHER_CWD_FILE")"

# failure: truthful exit + run json failed + scheduler_failure entry
export FAKE_LAUNCHER_EXIT=7
env HOME="$FAKE_HOME" KAIZEN_DOWNLOADS="$FAKE_DL" KAIZEN_NODE_BIN=$NODE_BIN PATH="$FAKE_BIN:$PATH" \
  bash "$RUN_SH" "$LOOP_ID" --launcher fake-launcher > "$FIXROOT/run2.out" 2>&1
RC=$?
export FAKE_LAUNCHER_EXIT=0
check_eq "failure exit mirrors launcher (7)" "7" "$RC"
check_contains "failure prints log path only" "log:" "$(cat "$FIXROOT/run2.out")"
LAST_JSON="$(ls "$LOOP_DIR/cycles"/launchd-run-*.json | tail -1)"
RJ="$(cat "$LAST_JSON")"
check_contains "failure run json result failed" '"result":"failed"' "$RJ"
check_contains "failure run json exit_code 7" '"exit_code":7' "$RJ"
SF="$("$NODE_BIN" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const s=j.scheduler_failure||[];process.stdout.write(JSON.stringify(s));' "$LOOP_DIR/LOCAL_STATE.json")"
check_contains "scheduler_failure recorded" '"exit_code":7' "$SF"
check_contains "scheduler_failure has at" '"at":"' "$SF"
check_contains "scheduler_failure has log" '"log":"' "$SF"

# is-locked skip path: take the lock via kaizen-state.mjs (token-based),
# run, expect skip + exit 0, then release with the token.
LOCK_OUT="$(KAIZEN_DOWNLOADS="$FAKE_DL" "$NODE_BIN" "$STATE_MJS" lock "$LOOP_ID" 2>&1)"
LOCK_TOKEN="$(printf '%s' "$LOCK_OUT" | "$NODE_BIN" -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  try { const j = JSON.parse(s); process.stdout.write(j.token || ""); }
  catch (e) { process.stdout.write(""); }
});')"
env HOME="$FAKE_HOME" KAIZEN_DOWNLOADS="$FAKE_DL" KAIZEN_NODE_BIN=$NODE_BIN PATH="$FAKE_BIN:$PATH" \
  bash "$RUN_SH" "$LOOP_ID" --launcher fake-launcher > "$FIXROOT/run3.out" 2>&1
check_eq "locked run exits 0 (skipped)" "0" "$?"
check_contains "locked run prints skipped" "skipped" "$(cat "$FIXROOT/run3.out")"
if [ -n "$LOCK_TOKEN" ]; then
  KAIZEN_DOWNLOADS="$FAKE_DL" "$NODE_BIN" "$STATE_MJS" unlock "$LOOP_ID" --token "$LOCK_TOKEN" >/dev/null 2>&1
else
  rm -f "$LOOP_DIR/.cycle-lock.json"
fi

echo "== fix08: launcher not found path =="
env HOME="$FAKE_HOME" KAIZEN_DOWNLOADS="$FAKE_DL" KAIZEN_NODE_BIN=$NODE_BIN PATH="$FAKE_BIN:$PATH" \
  bash "$RUN_SH" "$LOOP_ID" --launcher no-such-launcher > "$FIXROOT/run4.out" 2>&1
check_eq "missing launcher exits 0 (no dispatch)" "0" "$?"
check_contains "missing launcher message" "launcher not found" "$(cat "$FIXROOT/run4.out")"

echo ""
echo "fix08: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
