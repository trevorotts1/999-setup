#!/usr/bin/env bash
# ============================================================
# wire-ghl-env.sh — Skill 44 GHL credential env-wiring (single source)
# ============================================================
#
# HARNESS BINDING (Claude Code / 999 edition; ADAPTER.md seams 2 and 4).
# On the OpenClaw side this script wired the canonical GHL vars into
# openclaw.json `env.vars` (the block the gateway inherited at process
# start), with a docker-compose env_file step on the VPS and launchctl
# guidance on the Mac. None of that machinery exists in this harness:
# there is no gateway process and no openclaw.json. Here, the wiring
# target IS the harness session's own environment, provisioned from this
# install's secrets env. So this script now:
#
#   1. Resolves the 5 canonical GHL vars with ENGINE PARITY (below).
#   2. Emits them as `export` lines on stdout, for the caller to eval
#      (`eval "$(bash wire-ghl-env.sh)"`), OR, with `--write`, upserts
#      them into the env file named by $SECRETS_ENV (or the file given as
#      the argument to --write), REPLACING empty placeholder lines in
#      place: an empty `GOHIGHLEVEL_API_KEY=` line in a sourced env file
#      still masks the real value for any consumer that reads the
#      environment after sourcing, so placeholders are replaced, never
#      merely appended after (the VPS env-inheritance bug, 2026-06-11,
#      applies to any sourced env file, not just docker's).
#   3. Also resolves the FUNNEL + AUTOMATION matcher catalog vars
#      (GHL_FUNNEL_* / CAF_AUTOMATION_* / *_LINKS) against the sibling
#      Skill 6 copy in this repo (.claude/skills/ghl-install-pages) and
#      includes each var ONLY when its target exists.
#
# ENGINE PARITY (2026-09-07): the canonical secrets file WINS over the
# inherited process env for credentials, because the engine wrapper
# (tools/engine/caf) sources $SECRETS_ENV when it is set. Resolving any
# other way here would wire a value the engine will never use (the
# documented 47-day stale-placeholder failure on the OpenClaw side).
#
# The 5 canonical vars (engine wrapper maps GOHIGHLEVEL_* -> GHL_*):
#   GOHIGHLEVEL_API_KEY                 (PIT — required)
#   GOHIGHLEVEL_LOCATION_ID             (required)
#   GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN  (optional — workflow writes only)
#   GOHIGHLEVEL_ALLOWED_LOCATION_IDS    (write-location whitelist)
#   GOHIGHLEVEL_DRAFT_ONLY              (write-safety default)
#
# Plus the full PIT alias set (all wired so the wiring<->engine alias
# mismatch that caused the 2026-06 crash-loop cannot recur):
#   GHL_API_KEY, GHL_PIT, GHL_TOKEN, GHL_PRIVATE_INTEGRATION_TOKEN,
#   PRIVATE_INTEGRATION_TOKEN, GHL_PRIVATE_TOKEN, PIT_TOKEN,
#   GHL_PIT_TOKEN, GOHIGHLEVEL_LOCATION_PIT, GHL_LOCATION_PIT
#
# Inputs (read from process env OR the install's secrets env file):
#   GOHIGHLEVEL_API_KEY / GOHIGHLEVEL_LOCATION_ID / GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN
#   GOHIGHLEVEL_ALLOWED_LOCATION_IDS (defaults to GOHIGHLEVEL_LOCATION_ID)
#   GOHIGHLEVEL_DRAFT_ONLY (defaults to "true")
#
# Env overrides:
#   SECRETS_ENV       — path to this install's secrets env file
#   WIRE_ENV_FILE     — explicit file for --write (wins over SECRETS_ENV)
#
# Exit codes:
#   0 — resolved (and emitted / written) what was present; a missing
#       OPTIONAL var is not a failure
#   2 — a REQUIRED var (API_KEY or LOCATION_ID) was absent everywhere; the
#       caller should mark the skill installed-with-missing-prereqs.
# ============================================================

set -euo pipefail

log() { echo "[wire-ghl-env] $*" >&2; }

MODE="emit"
WRITE_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --write) MODE="write"
             if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then WRITE_FILE="$2"; shift 2
             else WRITE_FILE="${WIRE_ENV_FILE:-${SECRETS_ENV:-}}"; shift 1; fi ;;
    *) log "unknown argument: $1 (usage: wire-ghl-env.sh [--write [FILE]])"; exit 64 ;;
  esac
done

SECRETS_FILE="${SECRETS_ENV:-}"

# ─── Load values from the secrets env file if not already in env ─────────────
# We do NOT `set -a; source` the whole file (it may contain syntactically odd
# lines); we grep each var by name (last hit wins, like the engine wrapper).
read_secret() {
  local var="$1"
  [ -n "$SECRETS_FILE" ] && [ -f "$SECRETS_FILE" ] || { echo ""; return 0; }
  local out
  out="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${var}=" "$SECRETS_FILE" 2>/dev/null \
    | tail -1 | sed -E "s/^[[:space:]]*(export[[:space:]]+)?${var}=//" \
    | sed -E 's/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/' || true)"
  echo "$out"
  return 0
}

_file_first() {                      # file value if the secrets file defines it, else process env
  local _var="$1" _fromfile
  _fromfile="$(read_secret "$_var")"
  if [ -n "$_fromfile" ]; then printf '%s' "$_fromfile"; else printf '%s' "${!_var:-}"; fi
}

# ─── Full 11-alias PIT resolver (first match wins; covers all legacy alias names) ─
_resolve_any_pit() { for _v in GOHIGHLEVEL_API_KEY GHL_API_KEY GHL_PIT GHL_TOKEN GHL_PRIVATE_INTEGRATION_TOKEN PRIVATE_INTEGRATION_TOKEN GHL_PRIVATE_TOKEN PIT_TOKEN GHL_PIT_TOKEN GOHIGHLEVEL_LOCATION_PIT GHL_LOCATION_PIT; do local _val; _val="$(read_secret "$_v")"; [ -z "$_val" ] && _val="${!_v:-}"; [ -n "$_val" ] && printf '%s' "$_val" && return; done; return 0; }

API_KEY="$(_file_first GOHIGHLEVEL_API_KEY)"
[ -z "$API_KEY" ] && API_KEY="$(_resolve_any_pit)"
LOCATION_ID="$(_file_first GOHIGHLEVEL_LOCATION_ID)"
FIREBASE="$(_file_first GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN)"
ALLOWED="${GOHIGHLEVEL_ALLOWED_LOCATION_IDS:-$(read_secret GOHIGHLEVEL_ALLOWED_LOCATION_IDS)}"
DRAFT_ONLY="${GOHIGHLEVEL_DRAFT_ONLY:-$(read_secret GOHIGHLEVEL_DRAFT_ONLY)}"

# Sensible defaults: whitelist seeds from the client's own location; draft-only on.
[ -z "$ALLOWED" ] && ALLOWED="$LOCATION_ID"
[ -z "$DRAFT_ONLY" ] && DRAFT_ONLY="true"

# ─── Required-var gate ───────────────────────────────────────────────────────
MISSING=""
[ -z "$API_KEY" ]     && MISSING="$MISSING GOHIGHLEVEL_API_KEY"
[ -z "$LOCATION_ID" ] && MISSING="$MISSING GOHIGHLEVEL_LOCATION_ID"
if [ -n "$MISSING" ]; then
  log "MISSING-PREREQS: required var(s) absent everywhere:${MISSING}"
  log "  Skill 44 is installed-with-missing-prereqs. Add the value(s) to"
  log "  this install's secrets env (the file \$SECRETS_ENV names) or export"
  log "  them, then re-run this script before caf can reach GHL."
  exit 2
fi

# ─── Collect the var set to wire ─────────────────────────────────────────────
# Assoc-free (bash 3.2-safe): parallel arrays.
WIRE_VARS=()
WIRE_VALS=()
wire_var() { WIRE_VARS+=("$1"); WIRE_VALS+=("$2"); }

wire_var GOHIGHLEVEL_API_KEY                "$API_KEY"    # preferred canonical name
wire_var GHL_API_KEY                        "$API_KEY"    # legacy short alias
wire_var GHL_PIT                            "$API_KEY"    # short alias
wire_var GHL_TOKEN                          "$API_KEY"    # alternate alias
wire_var GHL_PRIVATE_INTEGRATION_TOKEN      "$API_KEY"    # explicit full-name alias
wire_var PRIVATE_INTEGRATION_TOKEN          "$API_KEY"    # bare PIT alias
wire_var GHL_PRIVATE_TOKEN                  "$API_KEY"    # shortened private-token alias
wire_var PIT_TOKEN                          "$API_KEY"    # short PIT alias
wire_var GHL_PIT_TOKEN                      "$API_KEY"    # combined PIT alias
wire_var GOHIGHLEVEL_LOCATION_PIT           "$API_KEY"    # explicit LOCATION-PIT name
wire_var GHL_LOCATION_PIT                   "$API_KEY"    # explicit LOCATION-PIT short alias
wire_var GOHIGHLEVEL_LOCATION_ID            "$LOCATION_ID"
wire_var GOHIGHLEVEL_ALLOWED_LOCATION_IDS   "$ALLOWED"
wire_var GOHIGHLEVEL_DRAFT_ONLY             "$DRAFT_ONLY"
[ -n "$FIREBASE" ] && wire_var GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN "$FIREBASE"

# ─── FUNNEL + AUTOMATION matcher catalog vars ────────────────────────────────
# Without these, the Skill-6 STEP-0 funnel matcher (v2_dispatcher) and the
# Skill-44 Step-0.4 automation matcher stay DARK (env-gated, never
# activated). Resolve relative to the installed skills: in this repo the
# pack skills are siblings under .claude/skills/ (ghl-install-pages is
# Skill 6; this skill is Skill 44). Wire each var ONLY when its target
# exists — a stale path would just be a safe no-op for the matchers, but
# the environment stays clean this way.
ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL44_DIR="$(cd "$ENGINE_DIR/../.." && pwd)"            # convert-and-flow-operator
SKILLS_ROOT="$(cd "$SKILL44_DIR/.." && pwd)"              # .claude/skills
SKILL06_DIR="$SKILLS_ROOT/ghl-install-pages"
FUNNEL_CATALOG="$SKILL06_DIR/funnel-templates"
FUNNEL_INDEX="$SKILL06_DIR/tools/catalog-index.json"
AUTO_CATALOG="$SKILL44_DIR/automation-templates"
AUTO_INDEX="$SKILL44_DIR/automation-templates/_matcher/catalog-index.json"
LINK_MAP="$SKILL44_DIR/automation-templates/_links/funnel-to-automation.json"

wire_var_if_exists() {  # $1=VAR  $2=path  ($3=dir|file, default file)
  local var="$1" path="$2" kind="${3:-file}"
  if { [ "$kind" = "dir" ] && [ -d "$path" ]; } || { [ "$kind" = "file" ] && [ -f "$path" ]; }; then
    wire_var "$var" "$path"
  else
    log "skip $var — target not present ($path)"
  fi
}

wire_var_if_exists GHL_FUNNEL_CATALOG            "$FUNNEL_CATALOG" dir
wire_var_if_exists GHL_FUNNEL_INDEX              "$FUNNEL_INDEX"   file
wire_var_if_exists GHL_FUNNEL_AUTOMATION_LINKS   "$LINK_MAP"       file
wire_var_if_exists CAF_AUTOMATION_CATALOG        "$AUTO_CATALOG"   dir
wire_var_if_exists CAF_AUTOMATION_INDEX          "$AUTO_INDEX"     file
wire_var_if_exists CAF_FUNNEL_AUTOMATION_LINKS   "$LINK_MAP"       file

# ─── Emit or write ───────────────────────────────────────────────────────────
_shell_quote() { # single-quote a value for safe eval / file storage
  local v="$1"
  v="${v//\'/\'\\\'\'}"
  printf "'%s'" "$v"
}

if [ "$MODE" = "write" ]; then
  if [ -z "$WRITE_FILE" ]; then
    log "ERROR: --write needs a target file (pass one, or set \$SECRETS_ENV or \$WIRE_ENV_FILE)."
    exit 64
  fi
  mkdir -p "$(dirname "$WRITE_FILE")"
  touch "$WRITE_FILE"
  i=0
  while [ $i -lt ${#WIRE_VARS[@]} ]; do
    var="${WIRE_VARS[$i]}"; val="${WIRE_VALS[$i]}"; i=$((i+1))
    [ -z "$val" ] && continue   # skip optional vars with no value
    # Replace any existing line (placeholder or stale) in place, else append.
    if grep -qE "^[[:space:]]*(export[[:space:]]+)?${var}=" "$WRITE_FILE"; then
      grep -vE "^[[:space:]]*(export[[:space:]]+)?${var}=" "$WRITE_FILE" > "$WRITE_FILE.tmp" && mv "$WRITE_FILE.tmp" "$WRITE_FILE"
      log "  replacing existing ${var}= line in $WRITE_FILE"
    fi
    printf '%s=%s\n' "$var" "$val" >> "$WRITE_FILE"
  done
  log "wired ${#WIRE_VARS[@]} vars into $WRITE_FILE"
else
  i=0
  while [ $i -lt ${#WIRE_VARS[@]} ]; do
    var="${WIRE_VARS[$i]}"; val="${WIRE_VALS[$i]}"; i=$((i+1))
    [ -z "$val" ] && continue   # skip optional vars with no value
    printf 'export %s=%s\n' "$var" "$(_shell_quote "$val")"
  done
  log "emitted ${#WIRE_VARS[@]} vars on stdout (eval them, or re-run with --write to upsert an env file)"
fi

log "DONE."
exit 0
