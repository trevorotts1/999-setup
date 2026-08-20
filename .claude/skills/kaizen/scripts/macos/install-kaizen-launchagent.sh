#!/bin/bash
# Install a LaunchAgent that runs one Kaizen cycle on an interval.
# This is the fallback path (Path D): used only when /loop, Desktop tasks,
# and cloud Routines are all unavailable.
#
# usage: install-kaizen-launchagent.sh <loop-id> <interval>
#   interval: daily | weekly | monthly | 90days | <seconds>
#
# Label: com.blackceo.kaizen.<short-loop-id>
# The Agent runs run-kaizen-cycle.sh, which invokes the headless launcher.
# Changing an interval re-installs (launchctl unload then load).

set -euo pipefail

LOOP_ID="${1:?usage: install-kaizen-launchagent.sh <loop-id> <interval>}"
INTERVAL_RAW="${2:?usage: install-kaizen-launchagent.sh <loop-id> <interval>}"

case "$INTERVAL_RAW" in
  daily)   SECONDS_VALUE=86400 ;;
  weekly)  SECONDS_VALUE=604800 ;;
  monthly) SECONDS_VALUE=2592000 ;;
  90days)  SECONDS_VALUE=7776000 ;;
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

SHORT_ID="$(printf '%s' "$LOOP_ID" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g' | cut -c1-32)"
LABEL="com.blackceo.kaizen.$SHORT_ID"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
RUNNER="$SCRIPT_DIR/run-kaizen-cycle.sh"
LAUNCHER="${KAIZEN_LAUNCHER:-claude-nine}"

if [ ! -f "$RUNNER" ]; then
  echo "install-kaizen-launchagent: runner not found: $RUNNER" >&2
  exit 2
fi

mkdir -p "$AGENTS_DIR"

if [ -f "$PLIST" ] && [ "${KAIZEN_LAUNCHD_DRY_RUN:-0}" != "1" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$RUNNER</string>
    <string>$LOOP_ID</string>
    <string>--launcher</string>
    <string>$LAUNCHER</string>
  </array>
  <key>StartInterval</key>
  <integer>$SECONDS_VALUE</integer>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
EOF

if [ "${KAIZEN_LAUNCHD_DRY_RUN:-0}" != "1" ]; then
  launchctl load "$PLIST"
else
  echo "dry-run: skipped launchctl load"
fi
echo "installed: $PLIST"
echo "label: $LABEL"
echo "interval seconds: $SECONDS_VALUE"
echo "launcher: $LAUNCHER"
echo "loop: $LOOP_ID"
