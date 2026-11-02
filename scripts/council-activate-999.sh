#!/usr/bin/env bash
# Council of Wise Elders: activate the 999 front door and chamber on a
# claude-nine / Claude Code host that has NO OpenClaw gateway.
#
# CTR-195. The 999 distribution already ships the runtime and the skill, but
# the supported front door (`council-ask`) and the Roast Room chamber helper
# were only installed by the OpenClaw `wire.sh`. On a sole CLI host there is no
# gateway, no Telegram binding and therefore no OpenClaw plugin to install:
# the 999 service is the authority, `council-ask` is the front door and
# `chamber-visual.sh` is the one chamber link. This script wires exactly that,
# and it never copies the interceptor package or writes openclaw.json.
#
# On a machine that DOES have the OpenClaw CLI, the official wiring
# (`77-council-of-wise-elders/wire.sh`) owns the service, the front door and
# the plugin. This script then runs that same official path and reports
# DEFERRED_OPENCLAW; it never duplicates the gateway's job.
#
# Usage:
#   council-activate-999.sh --prefix <data-profile/runtime> --release-id <id>
#     --skill-dir <installed skill> --bin-dir <bin> --node <node>
#     --data-dir <data profile> [--port 8787]
#
# Prints one line:
#   COUNCIL_999_FRONT_DOOR: READY|NOOP|ADOPTED_EXISTING|DEFERRED_OPENCLAW|DEFERRED_NO_GUI|NOT_READY <code> <detail>
# Exit 0 for every typed state (a not-ready box is reported, never faked).
set -u

say() { printf 'COUNCIL_999_FRONT_DOOR: %s\n' "$*"; }
die() { say "NOT_READY $1 $2"; exit 0; }

PREFIX=""; REL_ID=""; SKILL=""; BIN=""; NODE=""; DATA_DIR=""; PORT="${COUNCIL_SERVICE_PORT:-8787}"
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --release-id) REL_ID="${2:-}"; shift 2 ;;
    --skill-dir) SKILL="${2:-}"; shift 2 ;;
    --bin-dir) BIN="${2:-}"; shift 2 ;;
    --node) NODE="${2:-}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) die USAGE "unknown argument: $1" ;;
  esac
done
[ -n "$PREFIX" ] && [ -n "$REL_ID" ] && [ -n "$SKILL" ] && [ -n "$BIN" ] && [ -n "$NODE" ] && [ -n "$DATA_DIR" ] \
  || die USAGE "prefix, release-id, skill-dir, bin-dir, node and data-dir are required"
[ -x "$NODE" ] || die NODE_MISSING "$NODE is not executable"

# ---- OpenClaw present: use the one official wiring, never a second one ----
OC_CLI="$(command -v openclaw 2>/dev/null || true)"
if [ -n "$OC_CLI" ]; then
  if [ -f "$SKILL/wire.sh" ]; then
    _out="$(bash "$SKILL/wire.sh" --idempotent 2>&1)"
    printf '%s\n' "$_out" | sed -n '/^COUNCIL_/p'
    say "DEFERRED_OPENCLAW official wire.sh owns the service, front door and plugin (no sole-CLI plugin install)"
  else
    say "NOT_READY OFFICIAL_WIRING_MISSING $SKILL/wire.sh"
  fi
  exit 0
fi

# ---- durable front door copy (outlives this checkout) ---------------------
ASK_ENTRY=""
if [ -f "$SKILL/scripts/install-front-door.sh" ]; then
  ASK_ENTRY="$(bash "$SKILL/scripts/install-front-door.sh" "$PREFIX" "$REL_ID" "$SKILL" "$NODE" 2>&1)" || ASK_ENTRY=""
fi
[ -n "$ASK_ENTRY" ] && [ -f "$ASK_ENTRY" ] \
  || die FRONTDOOR_INSTALL_FAILED "durable council-entry.mjs + chamber-visual.sh not installed from $SKILL/scripts"

# ---- the immutable release the service launches --------------------------
REL_PATH="$PREFIX/current"
[ -e "$REL_PATH" ] || REL_PATH="$PREFIX/$REL_ID"
[ -f "$REL_PATH/scripts/service-launch.mjs" ] \
  || die SERVICE_LAUNCHER_MISSING "$REL_PATH/scripts/service-launch.mjs"
[ -f "$REL_PATH/node_modules/tsx/dist/cli.mjs" ] \
  || die SERVICE_RUNTIME_MISSING "$REL_PATH/node_modules/tsx/dist/cli.mjs"

ORIGIN="http://127.0.0.1:$PORT"
LAUNCHER="$PREFIX/bin/council-service"
mkdir -p "$PREFIX/bin" "$BIN" || die SERVICE_LAUNCHER_MISSING "cannot create $PREFIX/bin or $BIN"

# The launcher carries only this box's paths; no credential, model or route.
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
_tmp="$LAUNCHER.tmp.$$"
{
  printf '#!/bin/sh\n# managed-by: 77-council-of-wise-elders/council-activate-999.sh\n'
  printf 'HOME=%s; export HOME\n' "$(sq "$HOME")"
  printf 'COUNCIL_SERVICE_DATA_DIR=%s; export COUNCIL_SERVICE_DATA_DIR\n' "$(sq "${DATA_DIR:-$PREFIX}")"
  printf 'COUNCIL_SERVICE_PORT=%s; export COUNCIL_SERVICE_PORT\n' "$(sq "$PORT")"
  printf 'cd %s 2>/dev/null || true\n' "$(sq "${DATA_DIR:-$PREFIX}")"
  printf 'exec %s %s %s\n' "$(sq "$NODE")" \
    "$(sq "$REL_PATH/node_modules/tsx/dist/cli.mjs")" \
    "$(sq "$REL_PATH/scripts/service-launch.mjs")"
} > "$_tmp" && chmod 755 "$_tmp" && mv -f "$_tmp" "$LAUNCHER" \
  || { rm -f "$_tmp"; die SERVICE_LAUNCHER_MISSING "cannot write $LAUNCHER"; }
LSHA="$("$NODE" -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$LAUNCHER" 2>/dev/null || true)"

# ---- public origin: only this box's own verified https address ------------
# No operator host is hardcoded. Sources are the box env and the box's own
# Command Center record, exactly as wire.sh derives the chamber host.
envget() { # <file> <KEY>
  "$NODE" -e 'try{let r="";for(const l of require("fs").readFileSync(process.argv[1],"utf8").split(/\r?\n/)){const m=l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);if(m&&m[1]===process.argv[2])r=m[2].trim().replace(/^(["'\''])(.*)\1$/,"$2")}process.stdout.write(r)}catch(e){}' "$1" "$2" 2>/dev/null
}
CC_URL="${CC_PUBLIC_URL:-${MC_TENANT_PUBLIC_URL:-}}"
CC_APP="${CC_APP_DIR:-$HOME/projects/command-center}"
[ -n "$CC_URL" ] || CC_URL="$(envget "$CC_APP/.env.local" CC_PUBLIC_URL)"
[ -n "$CC_URL" ] || CC_URL="$(envget "$CC_APP/.env.local" MC_TENANT_PUBLIC_URL)"
[ -n "$CC_URL" ] || CC_URL="$("$NODE" -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(typeof s.commandCenterUrl==="string")process.stdout.write(s.commandCenterUrl)}catch(e){}' "$HOME/.openclaw/workspace/.workforce-build-state.json" 2>/dev/null)"
PUBLIC="${COUNCIL_PUBLIC_ORIGIN:-${WISE_ELDERS_PUBLIC_ORIGIN:-}}"
if [ -z "$PUBLIC" ] && [ -n "$CC_URL" ]; then
  _h="${CC_URL#*://}"; _h="${_h%%/*}"; _h="${_h%%:*}"
  case "$_h" in
    ''|localhost|localhost.*|'['*|*[!0-9.]*) case "$_h" in *.*) [ -n "$_h" ] && PUBLIC="https://${_h%%.*}-council.${_h#*.}" ;; esac ;;
  esac
fi
case "$PUBLIC" in
  https://*) _code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$PUBLIC/status" 2>/dev/null || true)"
    case "$_code" in 302|303) ;; *) PUBLIC="" ;; esac ;;
  *) PUBLIC="" ;;
esac

write_service_json() { # <manager> <name>
  S_PORT="$PORT" S_ORIGIN="$ORIGIN" S_PUBLIC="$PUBLIC" S_MANAGER="$1" S_NAME="$2" \
  S_REL="$REL_ID" S_SHA="$LSHA" S_OUT="$PREFIX/service.json" \
  "$NODE" -e '
    const e=process.env,fs=require("fs");
    const o={schema:"council-service/v1",port:Number(e.S_PORT),origin:e.S_ORIGIN,public_origin:e.S_PUBLIC||null,
      manager:e.S_MANAGER,name:e.S_NAME,release_id:e.S_REL,launcher_sha256:e.S_SHA,updated_at:new Date().toISOString()};
    const t=e.S_OUT+".tmp."+process.pid;fs.writeFileSync(t,JSON.stringify(o,null,2)+"\n");fs.renameSync(t,e.S_OUT);' \
    || return 1
}

write_front_door_shims() {
  local q="$PREFIX/service.json" ask="$BIN/council-ask" cli="$BIN/blackceo-council" envf="$BIN/blackceo-council.env"
  {
    printf '#!/bin/sh\n# managed-by: 77-council-of-wise-elders/council-activate-999.sh\n'
    printf 'WISE_ELDERS_SERVICE_ORIGIN=%s; export WISE_ELDERS_SERVICE_ORIGIN\n' "$(sq "$ORIGIN")"
    printf 'WISE_ELDERS_SERVICE_JSON=%s; export WISE_ELDERS_SERVICE_JSON\n' "$(sq "$q")"
    printf 'WISE_ELDERS_OPENCLAW_ROOT=%s; export WISE_ELDERS_OPENCLAW_ROOT\n' "$(sq "$PREFIX")"
    printf 'COUNCIL_CLI=%s; export COUNCIL_CLI\n' "$(sq "$cli")"
    [ -n "$PUBLIC" ] && printf 'WISE_ELDERS_PUBLIC_ORIGIN=%s; export WISE_ELDERS_PUBLIC_ORIGIN\n' "$(sq "$PUBLIC")"
    printf 'exec %s %s "$@"\n' "$(sq "$NODE")" "$(sq "$ASK_ENTRY")"
  } > "$ask.tmp.$$" && chmod 755 "$ask.tmp.$$" && mv -f "$ask.tmp.$$" "$ask"
  {
    printf 'WISE_ELDERS_SERVICE_ORIGIN=%s\n' "$ORIGIN"
    printf 'WISE_ELDERS_SERVICE_JSON=%s\n' "$q"
    printf 'WISE_ELDERS_OPENCLAW_ROOT=%s\n' "$PREFIX"
    [ -n "$PUBLIC" ] && printf 'WISE_ELDERS_PUBLIC_ORIGIN=%s\n' "$PUBLIC"
  } > "$envf.tmp.$$" && chmod 600 "$envf.tmp.$$" && mv -f "$envf.tmp.$$" "$envf"
}

council_roundtrip() { # a Council answers on the loopback port
  curl -fsS -m 3 "$ORIGIN/healthz" 2>/dev/null | grep -q '"api_version"'
}
wait_health() { # <seconds>
  local i=0
  while [ "$i" -lt "$1" ]; do
    council_roundtrip && return 0
    sleep 1; i=$((i+1))
  done
  return 1
}

# ---- an existing Council on the port is adopted, never replaced -----------
if council_roundtrip; then
  write_service_json external external || die SERVICE_JSON_WRITE_FAILED "$PREFIX/service.json"
  write_front_door_shims || die FRONTDOOR_SHIM_FAILED "$BIN/council-ask"
  say "ADOPTED_EXISTING a Council already answers at $ORIGIN; service left untouched, front door installed"
  exit 0
fi

# ---- start the 999-owned service -----------------------------------------
case "$(uname -s 2>/dev/null)" in
  Darwin)
    LABEL=ai.blackceo.council-service-999
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    mkdir -p "$(dirname "$PLIST")"
    _p="$PLIST.tmp.$$"
    cat > "$_p" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$LAUNCHER</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>WorkingDirectory</key><string>${DATA_DIR:-$PREFIX}</string>
</dict>
</plist>
PL
    plutil -lint "$_p" >/dev/null 2>&1 || { rm -f "$_p"; die SERVICE_PLIST_INVALID "$PLIST"; }
    if [ -f "$PLIST" ] && cmp -s "$_p" "$PLIST"; then rm -f "$_p"; else mv -f "$_p" "$PLIST"; fi
    UID_N="$(id -u)"
    if ! launchctl print "gui/$UID_N" >/dev/null 2>&1; then
      write_service_json launchd "$LABEL"
      write_front_door_shims
      say "DEFERRED_NO_GUI LaunchAgent $LABEL is written and loads at the next login (front door installed)"
      exit 0
    fi
    if ! launchctl print "gui/$UID_N/$LABEL" >/dev/null 2>&1; then
      launchctl bootstrap "gui/$UID_N" "$PLIST" >/dev/null 2>&1 || die SERVICE_START_FAILED "launchctl bootstrap $LABEL"
    else
      launchctl kickstart -k "gui/$UID_N/$LABEL" >/dev/null 2>&1 || true
    fi
    MANAGER=launchd; NAME="$LABEL" ;;
  Linux)
    PM2="$(command -v pm2 2>/dev/null || true)"
    [ -n "$PM2" ] || die NO_PM2 "pm2 is not on PATH; the Council service cannot be kept running on this host"
    if "$PM2" pid council-of-wise-elders-999 >/dev/null 2>&1; then
      "$PM2" restart council-of-wise-elders-999 --update-env >/dev/null 2>&1 || true
    else
      "$PM2" start "$LAUNCHER" --name council-of-wise-elders-999 --interpreter /bin/sh --time \
        --cwd "${DATA_DIR:-$PREFIX}" >/dev/null 2>&1 || die SERVICE_START_FAILED "pm2 start council-of-wise-elders-999"
    fi
    "$PM2" save >/dev/null 2>&1 || true
    MANAGER=pm2; NAME=council-of-wise-elders-999 ;;
  *)
    die UNSUPPORTED_PLATFORM "$(uname -s 2>/dev/null) is not macOS or Linux" ;;
esac

if ! wait_health 45; then
  write_service_json "$MANAGER" "$NAME"
  die SERVICE_UNHEALTHY "$ORIGIN/healthz did not answer within 45s"
fi
write_service_json "$MANAGER" "$NAME" || die SERVICE_JSON_WRITE_FAILED "$PREFIX/service.json"
write_front_door_shims || die FRONTDOOR_SHIM_FAILED "$BIN/council-ask"
say "READY service=$MANAGER/$NAME origin=$ORIGIN public_origin=${PUBLIC:-none} front_door=$ASK_ENTRY"
exit 0
