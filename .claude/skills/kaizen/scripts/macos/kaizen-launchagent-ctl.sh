#!/bin/bash
# Control a Kaizen LaunchAgent: status / disable / enable / reinstall.
#
# usage: kaizen-launchagent-ctl.sh <loop-id> <status|disable|enable|reinstall>
#
# status    -> JSON {installed, label, plist_path, loaded, last_run_from_local_state, enabled}
# disable   -> launchctl unload -w; LOCAL_STATE scheduler.enabled=false
# enable    -> launchctl load -w;   LOCAL_STATE scheduler.enabled=true
# reinstall -> call install-kaizen-launchagent.sh with the stored cadence
#
# Dry-run: KAIZEN_LAUNCHD_DRY_RUN=1 skips launchctl and does NOT touch
# LOCAL_STATE.json (status still reports; mutations print what would happen).

set -euo pipefail

LOOP_ID="${1:?usage: kaizen-launchagent-ctl.sh <loop-id> <status|disable|enable|reinstall>}"
OP="${2:?usage: kaizen-launchagent-ctl.sh <loop-id> <status|disable|enable|reinstall>}"

case "$OP" in
  status|disable|enable|reinstall) ;;
  *) echo "kaizen-launchagent-ctl: unknown op: $OP" >&2; exit 2 ;;
esac

if ! [[ "$LOOP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  echo "kaizen-launchagent-ctl: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}" >&2
  exit 2
fi

DRY_RUN=0
[ "${KAIZEN_LAUNCHD_DRY_RUN:-0}" = "1" ] && DRY_RUN=1

SHORT_ID="$(printf '%s' "$LOOP_ID" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g' | cut -c1-32)"
LABEL="com.blackceo.kaizen.$SHORT_ID"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
INSTALL_SH="$SCRIPT_DIR/install-kaizen-launchagent.sh"
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

ls_json() {
  if [ -n "$LOCAL_STATE" ]; then
    "$NODE_BIN" -e '
const fs = require("fs");
const f = process.argv[1];
let j = {};
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
process.stdout.write(JSON.stringify((j && j.scheduler) || null));
' "$LOCAL_STATE"
  else
    printf 'null'
  fi
}

mutate_enabled() { # <true|false>
  local val="$1"
  if [ "$DRY_RUN" = "1" ]; then
    echo "dry-run"
    echo "would-launchctl: unload -w / load -w $PLIST"
    echo "would-set scheduler.enabled=$val in $LOCAL_STATE"
    return 0
  fi
  if [ "$val" = "false" ]; then
    [ -f "$PLIST" ] && launchctl unload -w "$PLIST" 2>/dev/null || true
  else
    [ -f "$PLIST" ] && launchctl load -w "$PLIST" 2>/dev/null || true
  fi
  if [ -n "$LOCAL_STATE" ]; then
    if ! "$NODE_BIN" -e '
const fs = require("fs");
const f = process.argv[1];
let j = {};
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
j.scheduler = j.scheduler || {};
j.scheduler.enabled = JSON.parse(fs.readFileSync(0, "utf8"));
const t = f + ".tmp-" + process.pid;
fs.writeFileSync(t, JSON.stringify(j, null, 2) + "\n");
fs.renameSync(t, f);
' "$LOCAL_STATE" <<<"$val" 2>/dev/null; then
      echo "kaizen-launchagent-ctl: warning: could not update LOCAL_STATE.json scheduler.enabled: $LOCAL_STATE" >&2
    fi
  fi
  echo "ok"
}

case "$OP" in
  status)
    INSTALLED=0
    [ -f "$PLIST" ] && INSTALLED=1
    LOADED="not-checked"
    if [ -f "$PLIST" ]; then
      if [ "$DRY_RUN" = "1" ]; then
        LOADED="dry-run-skipped"
      elif launchctl list "$LABEL" >/dev/null 2>&1; then
        LOADED="true"
      else
        LOADED="false"
      fi
    fi
    SCHED_JSON="$(ls_json)"
    printf '{"installed":%s,"label":"%s","plist_path":"%s","loaded":"%s","last_run_from_local_state":%s,"enabled":%s}\n' \
      "$INSTALLED" "$LABEL" "$PLIST" "$LOADED" "$SCHED_JSON" \
      "$(printf '%s' "$SCHED_JSON" | "$NODE_BIN" -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  try { const j = JSON.parse(s || "null"); process.stdout.write(j && j.enabled === false ? "false" : (j && j.enabled === true ? "true" : "null")); }
  catch (e) { process.stdout.write("null"); }
});')"
    ;;
  disable)
    mutate_enabled "false"
    ;;
  enable)
    mutate_enabled "true"
    ;;
  reinstall)
    if [ "$DRY_RUN" = "1" ]; then
      echo "dry-run"
      echo "would-reinstall via: $INSTALL_SH $LOOP_ID <stored-cadence>"
      exit 0
    fi
    SCHED_JSON="$(ls_json)"
    CADENCE="$(printf '%s' "$SCHED_JSON" | "$NODE_BIN" -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  try { const j = JSON.parse(s || "null"); process.stdout.write((j && j.interval) || (j && j.cadence) || ""); }
  catch (e) { process.stdout.write(""); }
});')"
    CALFLAG="$(printf '%s' "$SCHED_JSON" | "$NODE_BIN" -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  try { const j = JSON.parse(s || "null"); process.stdout.write((j && j.calendar) || ""); }
  catch (e) { process.stdout.write(""); }
});')"
    if [ -z "$CADENCE" ]; then
      echo "kaizen-launchagent-ctl: no stored scheduler cadence for $LOOP_ID (LOCAL_STATE.json: ${LOCAL_STATE:-not found})" >&2
      exit 2
    fi
    if [ -n "$CALFLAG" ]; then
      exec "$INSTALL_SH" "$LOOP_ID" "$CADENCE" --calendar "$CALFLAG"
    else
      exec "$INSTALL_SH" "$LOOP_ID" "$CADENCE"
    fi
    ;;
esac
