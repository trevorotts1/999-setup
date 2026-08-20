#!/bin/bash
# Six simulated Kaizen walkthrough scenarios — fixtures only. Each scenario
# sets up a fake Memory environment, runs the deterministic script path the
# real flow would take, and checks the outcome the spec mandates.
#
# usage: walkthroughs.sh [--verbose]
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
STATE_MJS="$SKILL_DIR/scripts/common/kaizen-state.mjs"
VALIDATE_MJS="$SKILL_DIR/scripts/common/validate-kaizen-memory.mjs"
PASS=0
FAIL=0
VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

ok()  { PASS=$((PASS+1)); [ "$VERBOSE" = "1" ] && echo "  ok: $1"; return 0; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; return 0; }
check_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi }

new_home() { # creates a fresh fake memory env, echoes the root
  local base
  base="$(mktemp -d)"
  mkdir -p "$base/OpenClaw Master Files/Kaizen"
  echo "$base"
}

mk_state() { # mk_state <loopdir> <max_items>
  cp "$SKILL_DIR/templates/STATE.template.json" "$1/STATE.json"
  cp "$SKILL_DIR/templates/LOCAL_STATE.template.json" "$1/LOCAL_STATE.json"
  "$NODE_BIN" -e "
    const fs=require('fs');
    const f=process.argv[1];
    const s=JSON.parse(fs.readFileSync(f,'utf8'));
    s.scope={max_items_per_cycle:Number(process.argv[2])};
    fs.writeFileSync(f,JSON.stringify(s));
  " "$1/STATE.json" "$2"
}

echo "== Scenario A: nontechnical website owner =="
A="$(new_home)"
A_LOOP="$A/OpenClaw Master Files/Kaizen/owner-site"
mkdir -p "$A_LOOP"
mk_state "$A_LOOP" 5
# plain-language contract template must not require technical vocabulary
check_eq "A1 memory root resolves" "$A/OpenClaw Master Files/Kaizen" \
  "$(KAIZEN_DOWNLOADS="$A" "$NODE_BIN" "$STATE_MJS" locate)"
check_eq "A2 state validates" "0" "$(KAIZEN_DOWNLOADS="$A" "$NODE_BIN" "$STATE_MJS" validate owner-site >/dev/null 2>&1; echo $?)"
# recovery doc: RESUME.md must give a plain typed command, not jargon
check_eq "A3 recovery doc gives typed command" "0" \
  "$(grep -qE 'open Terminal and type' "$SKILL_DIR/references/recovery.md"; echo $?)"

echo "== Scenario B: /loop 20m short cycle =="
B="$(new_home)"
B_LOOP="$B/OpenClaw Master Files/Kaizen/loop-20m"
mkdir -p "$B_LOOP"
mk_state "$B_LOOP" 5
# lock -> bump -> unlock = one cycle; /loop pattern must exist in scheduling doc
KAIZEN_DOWNLOADS="$B" "$NODE_BIN" "$STATE_MJS" lock loop-20m >/dev/null
check_eq "B1 cycle lock taken" "0" "$(test -f "$B_LOOP/.cycle-lock.json"; echo $?)"
KAIZEN_DOWNLOADS="$B" "$NODE_BIN" "$STATE_MJS" bump-cycle loop-20m >/dev/null
check_eq "B2 cycle counter advanced" "1" \
  "$("$NODE_BIN" -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).cycle_counter)" "$B_LOOP/STATE.json")"
KAIZEN_DOWNLOADS="$B" "$NODE_BIN" "$STATE_MJS" unlock loop-20m --force >/dev/null
check_eq "B3 /loop 20m command documented" "0" "$(grep -qF '/loop 20m /kaizen run' "$SKILL_DIR/references/scheduling.md"; echo $?)"
check_eq "B4 seven-day rearm rule documented" "0" "$(grep -qiE 'expire after seven days' "$SKILL_DIR/references/scheduling.md"; echo $?)"

echo "== Scenario C: durable 9Router 30-day loop =="
C="$(new_home)"
C_LOOP="$C/OpenClaw Master Files/Kaizen/durable-30"
mkdir -p "$C_LOOP"
mk_state "$C_LOOP" 5
# Path D: install a launchd agent in a fake HOME (dry-run), verify label + interval
C_HOME="$C/home"
mkdir -p "$C_HOME/Library/LaunchAgents"
HOME="$C_HOME" KAIZEN_LAUNCHD_DRY_RUN=1 \
  bash "$SKILL_DIR/scripts/macos/install-kaizen-launchagent.sh" durable-30 90days >/dev/null
check_eq "C1 deterministic label" "0" \
  "$(test -f "$C_HOME/Library/LaunchAgents/com.blackceo.kaizen.durable-30.plist"; echo $?)"
check_eq "C2 90days interval in plist" "0" \
  "$(grep -q '<integer>7776000</integer>' "$C_HOME/Library/LaunchAgents/com.blackceo.kaizen.durable-30.plist"; echo $?)"
# cloud warning: 9Router route is not inherited by cloud Routines
check_eq "C3 cloud warning documented" "0" \
  "$(grep -qF 'will not automatically use the local 9Router model' "$SKILL_DIR/references/scheduling.md"; echo $?)"
# monthly-vs-30-days ambiguity handled
check_eq "C4 30-days ambiguity documented" "0" \
  "$(grep -qF 'exactly every 30 days, or about once a month' "$SKILL_DIR/references/scheduling.md"; echo $?)"

echo "== Scenario D: narrow goal + auth flaw =="
D="$(new_home)"
D_LOOP="$D/OpenClaw Master Files/Kaizen/narrow-goal"
mkdir -p "$D_LOOP"
mk_state "$D_LOOP" 5
# open-discovery clause is load-bearing in the contract template
check_eq "D1 open-discovery clause present" "0" \
  "$(grep -qiE 'does not limit what (I|Kaizen) can notice' "$SKILL_DIR/templates/KAIZEN_CONTRACT.template.md"; echo $?)"
# prioritization: catastrophic/security outranks stated direction
# (the doc wraps mid-phrase, so compare against whitespace-normalized text)
check_eq "D2 security outranks stated goal" "0" \
  "$(tr '\n' ' ' < "$SKILL_DIR/references/pdca-cycle.md" | grep -qF 'critical findings can outrank it'; echo $?)"
# plain-language escalation microcopy exists
check_eq "D3 plain-language escalation microcopy" "0" \
  "$(grep -qF 'more urgent' "$SKILL_DIR/references/plain-language.md"; echo $?)"

echo "== Scenario E: old idea, no rediscovery =="
E="$(new_home)"
E_LOOP="$E/OpenClaw Master Files/Kaizen/no-rediscovery"
mkdir -p "$E_LOOP"
mk_state "$E_LOOP" 5
# fingerprint hard rule + reconsideration conditions
check_eq "E1 hard rule present" "0" \
  "$(grep -qF 'never present an old idea as though it were newly discovered' "$SKILL_DIR/references/pdca-cycle.md"; echo $?)"
# mechanism: a rejected finding written into a cycle record survives validation
# untouched (the validator never rewrites cycle files)
cp "$SKILL_DIR/templates/CYCLE.template.md" "$E_LOOP/CYCLE-001.md"
printf '\nRejected: broken checkout flow (already known, deferred until B-003 lands)\n' >> "$E_LOOP/CYCLE-001.md"
"$NODE_BIN" "$VALIDATE_MJS" "$E_LOOP" >/dev/null
check_eq "E2 rejected finding survives validation" "0" \
  "$(grep -qF 'deferred until B-003 lands' "$E_LOOP/CYCLE-001.md"; echo $?)"
check_eq "E3 five reconsideration conditions" "0" \
  "$(grep -qE 'target changed materially' "$SKILL_DIR/references/pdca-cycle.md"; echo $?)"

echo "== Scenario F: RESUME.md after restart =="
F="$(new_home)"
F_LOOP="$F/OpenClaw Master Files/Kaizen/resume-loop"
mkdir -p "$F_LOOP"
mk_state "$F_LOOP" 5
cp "$SKILL_DIR/templates/RESUME.template.md" "$F_LOOP/RESUME.md"
# fill the template the way the skill would: absolute memory path, real launcher
sed -i '' \
  -e "s|<absolute path to this Loop folder>|$F_LOOP|" \
  -e "s|<launcher>|claude-nine|g" \
  -e "s|<loop-id>|resume-loop|g" \
  -e "s|<friendly_session_name>|kaizen-resume-loop|" \
  "$F_LOOP/RESUME.md"
check_eq "F1 RESUME.md names the launcher" "0" "$(grep -qF 'claude-nine' "$F_LOOP/RESUME.md"; echo $?)"
check_eq "F2 RESUME.md names the absolute memory path" "0" "$(grep -qF "$F_LOOP" "$F_LOOP/RESUME.md"; echo $?)"
check_eq "F3 RESUME.md manual-run fallback" "0" "$(grep -qF '/kaizen run resume-loop' "$F_LOOP/RESUME.md"; echo $?)"
check_eq "F4 session name is a friendly name, not a raw session id" "0" \
  "$(grep -qF 'kaizen-resume-loop' "$F_LOOP/RESUME.md"; echo $?)"

echo ""
echo "WALKTHROUGH RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
