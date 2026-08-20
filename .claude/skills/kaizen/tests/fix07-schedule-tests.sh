#!/bin/bash
# Fix 7 tests: kaizen-schedule.mjs decision engine.
# Fixtures only: no filesystem writes beyond mktemp, no network, no secrets.
#
# usage: fix07-schedule-tests.sh [--verbose]
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCHED="$SKILL_DIR/scripts/common/kaizen-schedule.mjs"
NODE_BIN="${NODE_BIN:-node}"
PASS=0
FAIL=0
VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

ok()  { PASS=$((PASS+1)); [ "$VERBOSE" = "1" ] && echo "  ok: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
check_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi; }
check_contains() { case "$3" in *"$2"*) ok "$1";; *) bad "$1 (missing [$2] in [$3])";; esac; }

field() { # field <json> <path...>  -> value
  printf '%s' "$1" | "$NODE_BIN" -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  let v;
  try { v = JSON.parse(s || "null"); } catch (e) { process.stdout.write("<bad-json>"); return; }
  for (const k of process.argv.slice(2)) {
    if (v === null || v === undefined) break;
    v = v[k];
  }
  process.stdout.write(v === undefined ? "<undefined>" : JSON.stringify(v));
});
' "$@"
}

run_engine() { # run_engine <input> [context-json] -> stdout json, exit code via $?
  local input="$1" ctx="${2:-}"
  if [ -n "$ctx" ]; then
    "$NODE_BIN" "$SCHED" "$input" --json-context "$ctx"
  else
    "$NODE_BIN" "$SCHED" "$input"
  fi
}

SESS='{"session_will_stay_open":true}'
ALL_TRUE='{"user_accepts_cloud":true,"target_available_from_cloud_clone":true,"no_local_only_files":true,"kaizen_available_in_cloud":true,"requires_local_9router":false}'

echo "== fix07: I/O table (12 inputs) =="

O="$(run_engine "5m")"; check_eq "5m exit 0" "0" "$?"
check_eq "5m normalized.value" "5" "$(field "$O" normalized_interval value)"
check_eq "5m normalized.unit" '"m"' "$(field "$O" normalized_interval unit)"
check_eq "5m cadence" '"exact_elapsed"' "$(field "$O" cadence)"
check_eq "5m mechanism (no session ctx)" '"launchd"' "$(field "$O" recommended_mechanism)"

O="$(run_engine "20m")"; check_eq "20m exit 0" "0" "$?"
check_eq "20m mechanism (no session ctx)" '"launchd"' "$(field "$O" recommended_mechanism)"
check_eq "20m expires_after_seven_days" "false" "$(field "$O" expires_after_seven_days)"

O="$(run_engine "20m" "$SESS")"
check_eq "20m+session mechanism" '"/loop"' "$(field "$O" recommended_mechanism)"
check_eq "20m+session open_session_required" "true" "$(field "$O" open_session_required)"
check_eq "20m+session machine_on_required" "true" "$(field "$O" machine_on_required)"
check_eq "20m+session expiry_days" "7" "$(field "$O" expiry_days)"
check_eq "20m+session expires_after_seven_days" "true" "$(field "$O" expires_after_seven_days)"

O="$(run_engine "1h")"; check_eq "1h exit 0" "0" "$?"
check_eq "1h normalized.value" "1" "$(field "$O" normalized_interval value)"
check_eq "1h normalized.unit" '"h"' "$(field "$O" normalized_interval unit)"
check_eq "1h mechanism (no session)" '"launchd"' "$(field "$O" recommended_mechanism)"

O="$(run_engine "3d")"; check_eq "3d exit 0" "0" "$?"
check_eq "3d normalized.unit" '"d"' "$(field "$O" normalized_interval unit)"
check_eq "3d mechanism (never /loop)" '"launchd"' "$(field "$O" recommended_mechanism)"
check_eq "3d cadence" '"exact_elapsed"' "$(field "$O" cadence)"
check_eq "3d clarification" "false" "$(field "$O" clarification_required)"

O="$(run_engine "every week")"; check_eq "every week exit 0" "0" "$?"
check_eq "every week cadence" '"calendar"' "$(field "$O" cadence)"
check_eq "every week mechanism" '"launchd"' "$(field "$O" recommended_mechanism)"
check_eq "every week weekday" "1" "$(field "$O" calendar_spec weekday)"

O="$(run_engine "weekly")"; check_eq "weekly exit 0" "0" "$?"
check_eq "weekly cadence" '"calendar"' "$(field "$O" cadence)"

O="$(run_engine "every 30 days")"; check_eq "every 30 days exit 0" "0" "$?"
check_eq "30d normalized.value" "30" "$(field "$O" normalized_interval value)"
check_eq "30d cadence" '"exact_elapsed"' "$(field "$O" cadence)"
check_eq "30d clarification" "true" "$(field "$O" clarification_required)"
check_eq "30d question" '"Exactly every 30 days, or once each calendar month?"' "$(field "$O" clarification_question)"
check_eq "30d mechanism (durable)" '"launchd"' "$(field "$O" recommended_mechanism)"

O="$(run_engine "monthly")"; check_eq "monthly exit 0" "0" "$?"
check_eq "monthly cadence" '"calendar"' "$(field "$O" cadence)"
check_eq "monthly clarification" "true" "$(field "$O" clarification_required)"
check_eq "monthly question" '"Exactly every 30 days, or once each calendar month?"' "$(field "$O" clarification_question)"
check_eq "monthly mechanism" '"launchd"' "$(field "$O" recommended_mechanism)"
check_eq "monthly day" "1" "$(field "$O" calendar_spec day)"
check_contains "monthly actual cadence says calendar" "calendar monthly" "$(field "$O" actual_cadence)"

O="$(run_engine "every 90 days")"; check_eq "every 90 days exit 0" "0" "$?"
check_eq "90d cadence" '"exact_elapsed"' "$(field "$O" cadence)"
check_eq "90d clarification" "true" "$(field "$O" clarification_required)"
check_eq "90d question" '"Exactly every 90 days, or once each calendar quarter?"' "$(field "$O" clarification_question)"

O="$(run_engine "quarterly")"; check_eq "quarterly exit 0" "0" "$?"
check_eq "quarterly cadence" '"calendar"' "$(field "$O" cadence)"
check_eq "quarterly clarification" "true" "$(field "$O" clarification_required)"
check_eq "quarterly months" "[1,4,7,10]" "$(field "$O" calendar_spec months)"

O="$(run_engine "first day of every month")"; check_eq "first day exit 0" "0" "$?"
check_eq "first day cadence" '"calendar"' "$(field "$O" cadence)"
check_eq "first day clarification (none)" "false" "$(field "$O" clarification_required)"
check_eq "first day day" "1" "$(field "$O" calendar_spec day)"

O="$(run_engine "every Monday at 9 AM")"; check_eq "monday 9am exit 0" "0" "$?"
check_eq "monday 9am cadence" '"calendar"' "$(field "$O" cadence)"
check_eq "monday 9am weekday" "1" "$(field "$O" calendar_spec weekday)"
check_eq "monday 9am hour" "9" "$(field "$O" calendar_spec hour)"
check_eq "monday 9am minute" "0" "$(field "$O" calendar_spec minute)"
check_eq "monday 9am machine_on_required" "true" "$(field "$O" machine_on_required)"

# case-insensitivity
O="$(run_engine "EVERY WEEK")"; check_eq "case-insensitive EVERY WEEK" '"calendar"' "$(field "$O" cadence)"
O="$(run_engine "5M")"; check_eq "case-insensitive 5M" '"exact_elapsed"' "$(field "$O" cadence)"

echo "== fix07: cloud eligibility matrix =="

O="$(run_engine "weekly" "$ALL_TRUE")"
check_eq "all-true cloud_eligible" "true" "$(field "$O" cloud_eligible)"
check_eq "all-true requested_cadence preserved" '"weekly"' "$(field "$O" requested_cadence)"
check_eq "all-true preserves_9router" "true" "$(field "$O" preserves_9router)"

BASE='{"user_accepts_cloud":true,"target_available_from_cloud_clone":true,"no_local_only_files":true,"kaizen_available_in_cloud":true,"requires_local_9router":false}'
# each single false -> ineligible + reason
mktest() { # mktest <name> <field> <false-value>
  local name="$1" fld="$2" val="$3"
  local ctx
  ctx="$("$NODE_BIN" -e "const b=JSON.parse(process.argv[1]);b[process.argv[2]]=JSON.parse(process.argv[3]);process.stdout.write(JSON.stringify(b));" "$BASE" "$fld" "$val")"
  local O
  O="$(run_engine "weekly" "$ctx")"
  check_eq "$name eligible=false" "false" "$(field "$O" cloud_eligible)"
  check_contains "$name reason names field" "$fld" "$(field "$O" cloud_ineligible_reason)"
  check_eq "$name mechanism not cloud" '"launchd"' "$(field "$O" recommended_mechanism)"
}
mktest "user_accepts_cloud=false" "user_accepts_cloud" "false"
mktest "target_available_from_cloud_clone=false" "target_available_from_cloud_clone" "false"
mktest "no_local_only_files=false" "no_local_only_files" "false"
mktest "kaizen_available_in_cloud=false" "kaizen_available_in_cloud" "false"
mktest "requires_local_9router=true" "requires_local_9router" "true"

# no context -> not eligible
O="$(run_engine "weekly")"
check_eq "no-context cloud_eligible" "false" "$(field "$O" cloud_eligible)"

# rule 5: never recommend cloud when kaizen not available in cloud
KAIZEN_MISSING='{"user_accepts_cloud":true,"target_available_from_cloud_clone":true,"no_local_only_files":true,"kaizen_available_in_cloud":false,"requires_local_9router":false}'
O="$(run_engine "weekly" "$KAIZEN_MISSING")"
check_contains "kaizen-missing reason says skill not found" "skill not found" "$(field "$O" cloud_ineligible_reason)"

# rule 4: asked for cloud but ineligible -> not cloud-schedule + clarification
ASKED_CLOUD_BAD='{"requested_mechanism":"cloud","user_accepts_cloud":true,"target_available_from_cloud_clone":false,"no_local_only_files":true,"kaizen_available_in_cloud":true,"requires_local_9router":false}'
O="$(run_engine "weekly" "$ASKED_CLOUD_BAD")"
check_eq "asked-cloud-ineligible mechanism" '"launchd"' "$(field "$O" recommended_mechanism)"
check_eq "asked-cloud-ineligible clarification" "true" "$(field "$O" clarification_required)"

echo "== fix07: 9Router clarification trigger =="

NINE_CTX='{"uses_claude_nine":true,"user_accepts_cloud":true,"target_available_from_cloud_clone":true,"no_local_only_files":true,"kaizen_available_in_cloud":true,"requires_local_9router":false}'
O="$(run_engine "weekly" "$NINE_CTX")"
check_eq "9router cloud-eligible clarification" "true" "$(field "$O" clarification_required)"
check_contains "9router question text" "local 9Router or cloud" "$(field "$O" clarification_question)"
check_eq "9router mechanism stays local" '"launchd"' "$(field "$O" recommended_mechanism)"
check_eq "9router preserves_9router" "true" "$(field "$O" preserves_9router)"

echo "== fix07: /loop never for multi-day =="
for IN in "3d" "weekly" "monthly" "quarterly"; do
  O="$(run_engine "$IN")"
  check_eq "/loop never for $IN" '"launchd"' "$(field "$O" recommended_mechanism)"
done

echo "== fix07: rounding disclosure =="
O="$(run_engine "monthly")"
check_contains "monthly reason discloses calendar mapping" "calendar" "$(field "$O" reason)"
O="$(run_engine "quarterly")"
check_contains "quarterly reason discloses calendar mapping" "calendar" "$(field "$O" reason)"

echo "== fix07: unparseable -> exit 2 with error JSON =="
OUT="$(run_engine "whenever the wind blows" 2>/dev/null)"; RC=$?
check_eq "unparseable exit code" "2" "$RC"
check_eq "unparseable ok:false" "false" "$(field "$OUT" ok)"
check_eq "unparseable error field" '"unparseable interval"' "$(field "$OUT" error)"

echo "== fix07: every-field presence =="
O="$(run_engine "5m")"
for F in requested_cadence normalized_interval cadence clarification_required recommended_mechanism reason machine_on_required open_session_required local_file_support cloud_eligible preserves_9router skill_availability_required actual_cadence explain expires_after_seven_days; do
  V="$(field "$O" "$F")"
  case "$V" in "<undefined>"|"<bad-json>") bad "field missing: $F";; *) ok "field present: $F";; esac
done

echo ""
echo "fix07: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
