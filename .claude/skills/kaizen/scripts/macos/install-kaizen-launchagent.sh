#!/bin/bash
# Install a LaunchAgent that runs one Kaizen cycle on an interval.
# This is the fallback path (Path D): used when /loop, Desktop tasks,
# and cloud Routines are all unavailable.
#
# usage: install-kaizen-launchagent.sh <loop-id> <interval> [--calendar weekly|monthly|quarterly] [--launcher claude-nine]
#         [--hour H] [--minute M] [--weekday W] [--day D]
#   interval: daily | weekly | monthly | quarterly | 90days | <seconds>
#   calendar default times (documented, override with --hour/--minute/...):
#     weekly    -> { Weekday: 1 (Monday), Hour: 9, Minute: 0 }
#     monthly   -> { Day: 1, Hour: 9, Minute: 0 }
#     quarterly -> { Month: [1,4,7,10], Day: 1, Hour: 9, Minute: 0 }
#
# Label: com.blackceo.kaizen.<short-loop-id>
# The Agent runs run-kaizen-cycle.sh, which invokes the headless launcher.
# Re-installing unloads any old job first (idempotent).
#
# Dry-run: KAIZEN_LAUNCHD_DRY_RUN=1 writes the plist into the (fake) HOME
# LaunchAgents dir, skips launchctl, prints "dry-run", and does NOT touch
# LOCAL_STATE.json.

set -euo pipefail

LOOP_ID="${1:?usage: install-kaizen-launchagent.sh <loop-id> <interval> [--calendar weekly|monthly|quarterly] [--launcher claude-nine]}"
INTERVAL_RAW="${2:?usage: install-kaizen-launchagent.sh <loop-id> <interval>}"
shift 2

CALENDAR=""
LAUNCHER="${KAIZEN_LAUNCHER:-claude-nine}"
CAL_HOUR=""
CAL_MINUTE=""
CAL_WEEKDAY=""
CAL_DAY=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --calendar) CALENDAR="${2:?--calendar needs a value}"; shift 2 ;;
    --launcher) LAUNCHER="$2"; shift 2 ;;
    --hour)     CAL_HOUR="$2"; shift 2 ;;
    --minute)   CAL_MINUTE="$2"; shift 2 ;;
    --weekday)  CAL_WEEKDAY="$2"; shift 2 ;;
    --day)      CAL_DAY="$2"; shift 2 ;;
    *) echo "install-kaizen-launchagent: unknown option: $1" >&2; exit 2 ;;
  esac
done

DRY_RUN=0
[ "${KAIZEN_LAUNCHD_DRY_RUN:-0}" = "1" ] && DRY_RUN=1

case "$INTERVAL_RAW" in
  daily)     SECONDS_VALUE=86400 ;;
  weekly)    SECONDS_VALUE=604800 ;;
  monthly)   SECONDS_VALUE=2592000 ;;
  quarterly) SECONDS_VALUE=7776000 ;;
  90days)    SECONDS_VALUE=7776000 ;;
  *)
    if ! [[ "$INTERVAL_RAW" =~ ^[0-9]+$ ]]; then
      echo "install-kaizen-launchagent: unknown interval: $INTERVAL_RAW" >&2
      exit 2
    fi
    SECONDS_VALUE="$INTERVAL_RAW"
    ;;
esac

if ! [[ "$LOOP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  echo "install-kaizen-launchagent: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}" >&2
  exit 2
fi

case "$CALENDAR" in
  "")
    ;;
  weekly|monthly|quarterly)
    ;;
  *)
    echo "install-kaizen-launchagent: --calendar must be weekly, monthly, or quarterly (got: $CALENDAR)" >&2
    exit 2
    ;;
esac

SHORT_ID="$(printf '%s' "$LOOP_ID" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g' | cut -c1-32)"
LABEL="com.blackceo.kaizen.$SHORT_ID"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
RUNNER="$SCRIPT_DIR/run-kaizen-cycle.sh"
ESCAPE_LIB="$SCRIPT_DIR/plist-escape.sh"

if [ ! -f "$RUNNER" ]; then
  echo "install-kaizen-launchagent: runner not found: $RUNNER" >&2
  exit 2
fi

# shellcheck source=plist-escape.sh
. "$ESCAPE_LIB"

XML_LABEL="$(plist_escape "$LABEL")"
XML_RUNNER="$(plist_escape "$RUNNER")"
XML_LOOP_ID="$(plist_escape "$LOOP_ID")"
XML_LAUNCHER="$(plist_escape "$LAUNCHER")"

DEFAULT_HOUR=9
DEFAULT_MINUTE=0
[ -n "$CAL_HOUR" ] && DEFAULT_HOUR="$CAL_HOUR"
[ -n "$CAL_MINUTE" ] && DEFAULT_MINUTE="$CAL_MINUTE"

mkdir -p "$AGENTS_DIR"

if [ -f "$PLIST" ] && [ "$DRY_RUN" != "1" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi

# weekly/monthly/quarterly as the interval are calendar schedules; so is any
# explicit --calendar. daily / 90days / <seconds> stay exact elapsed.
CAL_TYPE="$CALENDAR"
if [ -z "$CAL_TYPE" ]; then
  case "$INTERVAL_RAW" in
    weekly|monthly|quarterly) CAL_TYPE="$INTERVAL_RAW" ;;
  esac
fi

CAL_BLOCK=""
if [ -n "$CAL_TYPE" ]; then
  W="${CAL_WEEKDAY:-1}"
  H="$DEFAULT_HOUR"
  M="$DEFAULT_MINUTE"
  case "$CAL_TYPE" in
    weekly)
      CAL_BLOCK="  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>$W</integer>
    <key>Hour</key>
    <integer>$H</integer>
    <key>Minute</key>
    <integer>$M</integer>
  </dict>"
      ;;
    monthly)
      D="${CAL_DAY:-1}"
      CAL_BLOCK="  <key>StartCalendarInterval</key>
  <dict>
    <key>Day</key>
    <integer>$D</integer>
    <key>Hour</key>
    <integer>$H</integer>
    <key>Minute</key>
    <integer>$M</integer>
  </dict>"
      ;;
    quarterly)
      D="${CAL_DAY:-1}"
      CAL_BLOCK="  <key>StartCalendarInterval</key>
  <dict>
    <key>Month</key>
    <array>
      <integer>1</integer>
      <integer>4</integer>
      <integer>7</integer>
      <integer>10</integer>
    </array>
    <key>Day</key>
    <integer>$D</integer>
    <key>Hour</key>
    <integer>$H</integer>
    <key>Minute</key>
    <integer>$M</integer>
  </dict>"
      ;;
  esac
fi

TRIGGER_BLOCK="  <key>StartInterval</key>
  <integer>$SECONDS_VALUE</integer>"
[ -n "$CAL_BLOCK" ] && TRIGGER_BLOCK="$CAL_BLOCK"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$XML_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$XML_RUNNER</string>
    <string>$XML_LOOP_ID</string>
    <string>--launcher</string>
    <string>$XML_LAUNCHER</string>
  </array>
$TRIGGER_BLOCK
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
EOF

# Validate the generated plist. Skip only when plutil is missing AND dry-run.
if command -v plutil >/dev/null 2>&1; then
  if ! plutil -lint "$PLIST" >/dev/null 2>&1; then
    echo "install-kaizen-launchagent: generated plist failed plutil -lint: $PLIST" >&2
    rm -f "$PLIST"
    exit 2
  fi
elif [ "$DRY_RUN" != "1" ]; then
  echo "install-kaizen-launchagent: plutil not found; cannot validate the generated plist" >&2
  rm -f "$PLIST"
  exit 2
fi

CADENCE="exact_elapsed"
[ -n "$CAL_BLOCK" ] && CADENCE="calendar"

if [ "$DRY_RUN" = "1" ]; then
  echo "dry-run"
  echo "installed: $PLIST"
  echo "label: $LABEL"
  echo "cadence: $CADENCE"
  echo "launcher: $LAUNCHER"
  echo "loop: $LOOP_ID"
  echo "would-set-local-state scheduler:"
  printf '  %s\n' "{\"mechanism\":\"launchd\",\"label\":\"$LABEL\",\"plist_path\":\"$PLIST\",\"cadence\":\"$CADENCE\",\"interval\":\"$INTERVAL_RAW\",\"calendar\":\"$CALENDAR\"}"
  exit 0
fi

launchctl load "$PLIST"

# Record scheduler state into LOCAL_STATE.json (atomic node one-liner; the
# scheduler JSON is passed via stdin, never argv, so no shell injection).
STATE_MJS="$SCRIPT_DIR/../common/kaizen-state.mjs"
NODE_BIN="${KAIZEN_NODE_BIN:-node}"
LOCAL_STATE=""
REG_ROOT="$("$NODE_BIN" "$STATE_MJS" locate 2>/dev/null || true)"
if [ -n "$REG_ROOT" ] && [ -f "$REG_ROOT/$LOOP_ID/LOCAL_STATE.json" ]; then
  LOCAL_STATE="$REG_ROOT/$LOOP_ID/LOCAL_STATE.json"
else
  ROOT_DIR="$(bash "$SCRIPT_DIR/resolve-kaizen-root.sh")"
  [ -f "$ROOT_DIR/$LOOP_ID/LOCAL_STATE.json" ] && LOCAL_STATE="$ROOT_DIR/$LOOP_ID/LOCAL_STATE.json"
fi

if [ -n "$LOCAL_STATE" ]; then
  SCHED_JSON="{\"mechanism\":\"launchd\",\"label\":\"$LABEL\",\"plist_path\":\"$PLIST\",\"cadence\":\"$CADENCE\",\"interval\":\"$INTERVAL_RAW\",\"calendar\":\"$CALENDAR\"}"
  if ! printf '%s' "$SCHED_JSON" | "$NODE_BIN" -e '
const fs = require("fs");
const f = process.argv[1];
let j = {};
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
j.scheduler = JSON.parse(fs.readFileSync(0, "utf8"));
const t = f + ".tmp-" + process.pid;
fs.writeFileSync(t, JSON.stringify(j, null, 2) + "\n");
fs.renameSync(t, f);
' "$LOCAL_STATE" 2>/dev/null; then
    echo "install-kaizen-launchagent: warning: could not update LOCAL_STATE.json scheduler field: $LOCAL_STATE" >&2
  fi
fi

echo "installed: $PLIST"
echo "label: $LABEL"
echo "cadence: $CADENCE"
echo "launcher: $LAUNCHER"
echo "loop: $LOOP_ID"
