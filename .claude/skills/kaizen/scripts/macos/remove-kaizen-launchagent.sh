#!/bin/bash
# Remove a Kaizen LaunchAgent installed by install-kaizen-launchagent.sh.
# Idempotent: unload + delete the plist, clear the scheduler field from
# LOCAL_STATE.json only when the plist was actually removed.
#
# usage: remove-kaizen-launchagent.sh <loop-id>
#
# Dry-run: KAIZEN_LAUNCHD_DRY_RUN=1 prints what would happen, touches nothing
# (no launchctl, no plist deletion, no LOCAL_STATE.json change).

set -euo pipefail

LOOP_ID="${1:?usage: remove-kaizen-launchagent.sh <loop-id>}"

if ! [[ "$LOOP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  echo "remove-kaizen-launchagent: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}" >&2
  exit 2
fi

DRY_RUN=0
[ "${KAIZEN_LAUNCHD_DRY_RUN:-0}" = "1" ] && DRY_RUN=1

SHORT_ID="$(printf '%s' "$LOOP_ID" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g' | cut -c1-32)"
LABEL="com.blackceo.kaizen.$SHORT_ID"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -f "$PLIST" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry-run"
    echo "nothing installed for $LOOP_ID (no $PLIST)"
    exit 0
  fi
  echo "remove-kaizen-launchagent: nothing installed for $LOOP_ID (no $PLIST)"
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "dry-run"
  echo "would-remove: $PLIST"
  echo "would-unload label: $LABEL"
  echo "would-clear-local-state scheduler"
  echo "loop: $LOOP_ID"
  exit 0
fi

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

# Clear the scheduler field from LOCAL_STATE.json only when the plist is gone.
# The node one-liner reads JSON from the file and rewrites atomically.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
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
  if ! "$NODE_BIN" -e '
const fs = require("fs");
const f = process.argv[1];
let j = {};
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
delete j.scheduler;
const t = f + ".tmp-" + process.pid;
fs.writeFileSync(t, JSON.stringify(j, null, 2) + "\n");
fs.renameSync(t, f);
' "$LOCAL_STATE" 2>/dev/null; then
    echo "remove-kaizen-launchagent: warning: could not clear LOCAL_STATE.json scheduler field: $LOCAL_STATE" >&2
  fi
fi

echo "removed: $PLIST"
echo "loop: $LOOP_ID"
