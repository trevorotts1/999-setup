#!/bin/bash
# Remove a Kaizen LaunchAgent installed by install-kaizen-launchagent.sh.
#
# usage: remove-kaizen-launchagent.sh <loop-id>

set -euo pipefail

LOOP_ID="${1:?usage: remove-kaizen-launchagent.sh <loop-id>}"

if ! [[ "$LOOP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  echo "remove-kaizen-launchagent: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}" >&2
  exit 2
fi

SHORT_ID="$(printf '%s' "$LOOP_ID" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g' | cut -c1-32)"
LABEL="com.blackceo.kaizen.$SHORT_ID"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -f "$PLIST" ]; then
  echo "remove-kaizen-launchagent: nothing installed for $LOOP_ID (no $PLIST)"
  exit 0
fi

if [ "${KAIZEN_LAUNCHD_DRY_RUN:-0}" != "1" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi
rm -f "$PLIST"
echo "removed: $PLIST"
echo "loop: $LOOP_ID"
