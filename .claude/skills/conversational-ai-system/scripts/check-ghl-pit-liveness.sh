#!/usr/bin/env bash
# check-ghl-pit-liveness.sh — Daily RUNTIME GHL Private-Integration-Token (PIT)
# liveness check for Skill 38 (Conversational AI System).
#
# WHY THIS EXISTS
# ---------------
# Skill 38's conversational brain SENDS/READS every GHL reply on a Private
# Integration Token. If that token dies after handoff, EVERY conversational op
# 401s — the agent cannot send the reply. Skill 44 already watches the FIREBASE
# build token (check-ghl-token-liveness.sh); this is its RUNTIME-PIT twin.
#
# WHAT WAS WRONG BEFORE (this monitor had NEVER once passed — verified live)
# -------------------------------------------------------------------------
#   1. CREDENTIAL RESOLUTION PICKED A DOCUMENTATION PLACEHOLDER. The candidate
#      list took `GHL_PRIVATE_INTEGRATION_TOKEN` first no matter WHERE it came
#      from, and on a real box that name is present in the harness config's
#      env block carrying the documentation placeholder `pit-abc123` (10
#      characters). THREE of the five candidate names hold that same
#      placeholder there. Meanwhile the box's REAL tokens sat in the secrets
#      env file and tested HTTP 200 the same day. The monitor therefore
#      probed a fake token, got 401, and announced the client's live
#      credential was expired — a false alarm the operator had to
#      personally challenge.
#      FIX: placeholder-shaped values are SKIPPED (shorter than 20 characters, or
#      beginning `pit-abc`, or a known dummy word), and a value that came from
#      the install's SECRETS ENV-FILE outranks one that came from the process
#      environment, because config-injected env values are placeholders BY
#      DESIGN on a real box. (999 harness form: the canonical source is the
#      secrets env file designated by $SECRETS_ENV; there is no gateway
#      config file to read values from.)
#
#   2. A BARE 401 WAS REPORTED AS "DEAD/EXPIRED". GoHighLevel returns 401 for
#      SCOPE failures on perfectly live tokens — proven: live agency PITs returned
#      401 "not authorized for this scope" against the location endpoint.
#      FIX: the 401 BODY is inspected. "Invalid Private Integration token" (and
#      friends) = a CREDENTIAL problem. A scope / not-authorized / not-accessible
#      message = a CONFIGURATION problem, reported as such and NEVER as "expired".
#      An unrecognised 401 is UNCLASSIFIED — operator-triage, never a client alert.
#
#   3. TOKEN AND ENDPOINT WERE MISMATCHED. Candidate #2 is an AGENCY token, and it
#      was pointed at a LOCATION endpoint with no `/oauth/locationToken` exchange —
#      which per this skill's own GHL reference (§1/§7) can never work, so a
#      healthy agency token was guaranteed to look dead.
#      FIX: the token's CLASS decides the probe. An agency-class token is tested
#      against the AGENCY endpoint (GET /locations/search?companyId=…, Version
#      2021-07-28); a location endpoint is only ever probed with an actual location
#      PIT (or an exchanged location token).
#
#   4. THE OPERATOR ALERT NAMED THE WRONG VARIABLE. It hardcoded
#      `GHL_PRIVATE_INTEGRATION_TOKEN` regardless of which variable was actually
#      selected. FIX: it reports the variable that was really used, and where it
#      came from.
#
#   5. "NO USABLE CREDENTIAL" WAS INDISTINGUISHABLE FROM "EXPIRED". FIX: it is now
#      its own honest status — a CONFIG problem, operator-only, never a client
#      "your token expired" message.
#
# THE TOKEN VALUE IS NEVER PRINTED, LOGGED OR SENT — only the variable NAME, its
# source, and a length bucket.
#
# IDEMPOTENT / ONCE-PER-DAY
# -------------------------
# A daily state file ($STATE_DIR/ghl-pit-liveness-<UTC-date>.ok) short-circuits
# repeat PASS runs; a .notified stamp prevents notifying more than once per day.
# Delete the state file to force a re-check.
#
# NOTIFICATION TARGET
# -------------------
# A client-facing refresh message is SURFACED only on a confirmed CREDENTIAL
# failure: written as a dated artifact in the state dir and printed, for the
# session/scheduler to deliver via the client's configured channel (this
# harness has no gateway send). It is addressed to the CLIENT only (operator
# ids are hard-excluded). CONFIG problems are operator-logged and NEVER
# reach the client.
#
# bash-not-zsh: always invoke via `bash`, never `zsh`.
#
# EXIT CODES
#   0  PIT VALID, or already-passed-today, or no credential configured at all
#   1  CREDENTIAL FAILURE — the token itself is invalid/expired (client notified
#      once per day, or the operator warned when no client chat resolves)
#   2  CONFIGURATION PROBLEM — operator triage, client NEVER notified: every
#      candidate value was a placeholder, a required company/location id is
#      missing, the 401 was a scope/accessibility refusal, the 401 was
#      unclassified, or the probe returned an ambiguous/transient status
#
set -euo pipefail

GHL_API_BASE="${GHL_API_BASE:-https://services.leadconnectorhq.com}"
# Version header is PER MODULE. conversations = 2021-04-15; the agency
# locations/search endpoint = 2021-07-28. Sending the wrong one is itself a 401
# source, so each probe carries its own.
GHL_API_VERSION="${GHL_API_VERSION:-2021-04-15}"            # conversations module
GHL_AGENCY_API_VERSION="${GHL_AGENCY_API_VERSION:-2021-07-28}"  # locations module

# Notification target resolution — PII-free (mirrors 22-notify-client-doc.sh);
# a UNIVERSAL skill carries NO hardcoded chat ids:
#   CLIENT_TELEGRAM_CHAT_ID    optional; the preferred CLIENT target (skips lookup)
#   OPERATOR_TELEGRAM_CHAT_ID  optional (default empty); a chat id to EXCLUDE so a
#                              refresh notice never lands on the operator instead
#                              of the client. Set it in the environment/config.
CLIENT_TELEGRAM_CHAT_ID="${CLIENT_TELEGRAM_CHAT_ID:-}"
OPERATOR_TELEGRAM_CHAT_ID="${OPERATOR_TELEGRAM_CHAT_ID:-}"

_log() { echo "[ghl-pit-liveness] $*"; }

# ---------------------------------------------------------------------------
# State dir (999 harness): inside this skill's own tree by default
# (tools/state/ghl-pit-liveness); override with SKILL38_LIVENESS_STATE_DIR.
# The OpenClaw side kept state under its workspace dir.
# ---------------------------------------------------------------------------
SKILL38_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${SKILL38_LIVENESS_STATE_DIR:-$SKILL38_ROOT/tools/state/ghl-pit-liveness}"
mkdir -p "$STATE_DIR"
TODAY=$(date -u +%Y-%m-%d)
PASS_STAMP="${STATE_DIR}/ghl-pit-liveness-${TODAY}.ok"
NOTIFIED_STAMP="${STATE_DIR}/ghl-pit-liveness-${TODAY}.notified"

# ---------------------------------------------------------------------------
# Once-per-day PASS guard.
# ---------------------------------------------------------------------------
if [[ -f "$PASS_STAMP" ]]; then
  _log "PASS already confirmed today (${TODAY}) — skipping. Delete ${PASS_STAMP} to force recheck."
  exit 0
fi

# ---------------------------------------------------------------------------
# Resolve creds: the install's secrets env file (designated by $SECRETS_ENV)
# first, then the process environment. The file outranks the process env
# because config-injected env values are placeholders by design (defect 1).
# ---------------------------------------------------------------------------
# Values from the file are loaded into NAMESPACED variables, never straight
# into the candidate names, so the resolver below can tell WHERE each value
# came from.
_load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  # Defensive tightening of a credential store that may pre-date the 0600 rule.
  chmod 600 "$f" 2>/dev/null || true
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    if [[ "$line" =~ ^(export[[:space:]]+)?([A-Z_][A-Z0-9_]*)=(.*)$ ]]; then
      local k="${BASH_REMATCH[2]}" v="${BASH_REMATCH[3]}"
      v="${v#\'}" ; v="${v%\'}"
      v="${v#\"}" ; v="${v%\"}"
      # FIRST file wins (search order is priority order); never clobber.
      if [[ -z "$(eval "printf '%s' \"\${FILEVAL_${k}:-}\"")" ]]; then
        eval "FILEVAL_${k}=\$v"
      fi
    fi
  done < "$f"
}

if [[ -n "${SECRETS_ENV:-}" ]]; then
  _load_env_file "$SECRETS_ENV" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Placeholder detection — the single reason this monitor could never pass.
#
# A documentation placeholder is not a credential. Treating one as a credential
# produced a 401 and then a "your token expired, re-issue it" alert about a token
# the client had never set. Three independent shapes are rejected:
#   * anything shorter than 20 characters (a real PIT is far longer)
#   * anything beginning `pit-abc` (the literal value shipped in the docs)
#   * a known dummy word
# The VALUE is never printed — only its length.
# ---------------------------------------------------------------------------
_is_placeholder() {
  local v="$1"
  [[ -z "$v" ]] && return 0
  if (( ${#v} < 20 )); then return 0; fi
  case "$v" in
    pit-abc*|PIT-ABC*)          return 0 ;;
    changeme*|CHANGEME*)        return 0 ;;
    xxx*|XXX*)                  return 0 ;;
    your-*|YOUR-*|your_*|YOUR_*) return 0 ;;
    *_HERE|*-here|*_here)       return 0 ;;
    "<"*">")                    return 0 ;;
  esac
  return 1
}

# ---------------------------------------------------------------------------
# Resolve the token. Candidate names are tried in priority order, the
# secrets env file before the process env, and any placeholder-shaped
# value is SKIPPED rather than selected.
# ---------------------------------------------------------------------------
PIT=""
PIT_VAR=""
PIT_SOURCE=""
PIT_CLASS=""
SAW_PLACEHOLDER=0
PLACEHOLDER_VARS=""

CANDIDATE_VARS="GHL_PRIVATE_INTEGRATION_TOKEN GOHIGHLEVEL_PRIVATE_INTEGRATION_TOKEN GHL_LOCATION_PIT GOHIGHLEVEL_LOCATION_PIT GOHIGHLEVEL_AGENCY_PIT GHL_AGENCY_PIT GHL_PIT_TOKEN GOHIGHLEVEL_API_KEY GHL_API_KEY"

_consider() { # <var-name> <value> <source-label>
  local var="$1" val="$2" src="$3"
  [[ -n "$val" ]] || return 1
  if _is_placeholder "$val"; then
    SAW_PLACEHOLDER=1
    case " $PLACEHOLDER_VARS " in
      *" ${var}(${src}) "*) : ;;
      *) PLACEHOLDER_VARS="${PLACEHOLDER_VARS}${PLACEHOLDER_VARS:+ }${var}(${src})" ;;
    esac
    return 1
  fi
  PIT="$val"; PIT_VAR="$var"; PIT_SOURCE="$src"
  return 0
}

for VAR in $CANDIDATE_VARS; do
  _consider "$VAR" "$(eval "printf '%s' \"\${FILEVAL_${VAR}:-}\"")" "secrets-env-file" && break
  _consider "$VAR" "${!VAR:-}" "process-env" && break
done

# Token CLASS decides which endpoint may legitimately be probed (defect 3).
case "$PIT_VAR" in
  *AGENCY*) PIT_CLASS="agency" ;;
  *)        PIT_CLASS="location" ;;
esac

# Ids — same source preference.
_resolve_id() { # <var-name...> -> prints the first non-empty value (file first)
  local var val
  for var in "$@"; do
    val="$(eval "printf '%s' \"\${FILEVAL_${var}:-}\"")"
    [[ -n "$val" ]] || val="${!var:-}"
    if [[ -n "$val" ]]; then printf '%s' "$val"; return 0; fi
  done
  printf ''
}
LOCATION_ID="$(_resolve_id GOHIGHLEVEL_LOCATION_ID GHL_LOCATION_ID)"
COMPANY_ID="$(_resolve_id GOHIGHLEVEL_COMPANY_ID GHL_COMPANY_ID GOHIGHLEVEL_AGENCY_ID GHL_AGENCY_ID)"

# ---------------------------------------------------------------------------
# CONFIG-PROBLEM exits (defect 5). None of these is a dead token, so none of them
# may ever reach the client with a "your token expired" message.
# ---------------------------------------------------------------------------
if [[ -z "$PIT" && "$SAW_PLACEHOLDER" -eq 1 ]]; then
  _log "CONFIG PROBLEM: no USABLE GHL credential is configured on this box."
  _log "  Every candidate that exists holds a documentation PLACEHOLDER, not a credential: ${PLACEHOLDER_VARS}"
  _log "  This is NOT an expired token and the client has NOT been notified."
  _log "  Operator action: put the real Private Integration Token in the install"
  _log "  secrets env file (the one designated by the SECRETS_ENV env var) under one of: ${CANDIDATE_VARS}."
  exit 2
fi

if [[ -z "$PIT" ]]; then
  _log "SKIP no GHL credential configured at all (checked: ${CANDIDATE_VARS}). Nothing to check."
  exit 0
fi

_log "resolved credential: var=${PIT_VAR} source=${PIT_SOURCE} class=${PIT_CLASS} length=${#PIT} (value never printed)"

if [[ "$PIT_CLASS" == "agency" && -z "$COMPANY_ID" ]]; then
  _log "CONFIG PROBLEM: ${PIT_VAR} is an AGENCY-class token but no company id is configured"
  _log "  (checked GOHIGHLEVEL_COMPANY_ID / GHL_COMPANY_ID / GOHIGHLEVEL_AGENCY_ID / GHL_AGENCY_ID)."
  _log "  An agency token cannot be validated against a LOCATION endpoint without an"
  _log "  /oauth/locationToken exchange, so probing one would report a healthy token as dead."
  _log "  This is NOT an expired token and the client has NOT been notified."
  exit 2
fi

if [[ "$PIT_CLASS" == "location" && -z "$LOCATION_ID" ]]; then
  _log "CONFIG PROBLEM: ${PIT_VAR} is a LOCATION-class token but no location id is configured"
  _log "  (checked GOHIGHLEVEL_LOCATION_ID / GHL_LOCATION_ID)."
  _log "  This is NOT an expired token and the client has NOT been notified."
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  _log "WARN curl not found — cannot probe the credential. Skipping."
  exit 0
fi

# ---------------------------------------------------------------------------
# Probe — the endpoint MUST match the token class (defect 3).
#   location PIT -> GET /conversations/search?locationId=...  Version 2021-04-15
#   agency  PIT -> GET /locations/search?companyId=...        Version 2021-07-28
# A valid token returns 2xx even with zero results.
# ---------------------------------------------------------------------------
if [[ "$PIT_CLASS" == "agency" ]]; then
  PROBE_URL="${GHL_API_BASE}/locations/search?companyId=${COMPANY_ID}&limit=1"
  PROBE_VERSION="$GHL_AGENCY_API_VERSION"
  PROBE_DESC="agency locations read"
else
  PROBE_URL="${GHL_API_BASE}/conversations/search?locationId=${LOCATION_ID}&limit=1"
  PROBE_VERSION="$GHL_API_VERSION"
  PROBE_DESC="location conversations read"
fi

PROBE_RAW="$(curl -s -w $'\n%{http_code}' --max-time 15 \
  -H "Authorization: Bearer ${PIT}" \
  -H "Version: ${PROBE_VERSION}" \
  -H "Content-Type: application/json" \
  "$PROBE_URL" 2>/dev/null || printf '\n000')"
HTTP_CODE="$(printf '%s' "$PROBE_RAW" | tail -n1)"
PROBE_BODY="$(printf '%s' "$PROBE_RAW" | sed '$d')"
# Never echo a body wholesale — it can carry account data. One trimmed line only.
BODY_EXCERPT="$(printf '%s' "$PROBE_BODY" | tr '\n' ' ' | cut -c1-300)"

case "$HTTP_CODE" in
  2??)
    _log "PASS ${PIT_VAR} is VALID — ${PROBE_DESC} (${PROBE_URL%%\?*}) returned HTTP ${HTTP_CODE}."
    touch "$PASS_STAMP"
    exit 0
    ;;
  401)
    # DEFECT 2: a bare 401 is NOT proof of a dead token. GHL returns 401 for SCOPE
    # refusals on perfectly live credentials. Read the body before judging.
    BODY_LC="$(printf '%s' "$BODY_EXCERPT" | tr '[:upper:]' '[:lower:]')"
    case "$BODY_LC" in
      *"invalid private integration token"*|*"invalid token"*|*"invalid jwt"*|*"token expired"*|*"jwt expired"*|*"invalid access token"*|*"malformed"*)
        _log "FAIL CREDENTIAL problem — ${PIT_VAR} (source ${PIT_SOURCE}) was REJECTED as invalid/expired (HTTP 401)."
        _log "  API said: ${BODY_EXCERPT}"
        ;;
      *"scope"*|*"not authorized"*|*"unauthorized for"*|*"does not have access"*|*"not accessible"*|*"forbidden"*|*"permission"*)
        _log "CONFIG PROBLEM: ${PIT_VAR} (source ${PIT_SOURCE}, class ${PIT_CLASS}) is LIVE but is not"
        _log "  authorized for this ${PROBE_DESC}. HTTP 401 here is a SCOPE/ACCESS refusal, NOT an"
        _log "  expired token — the credential itself is fine."
        _log "  API said: ${BODY_EXCERPT}"
        _log "  Operator action: grant the missing scope on that integration, or point this check at"
        _log "  the endpoint the token is actually entitled to. The client has NOT been notified."
        exit 2
        ;;
      *)
        _log "CONFIG PROBLEM (unclassified 401): ${PIT_VAR} (source ${PIT_SOURCE}, class ${PIT_CLASS})"
        _log "  got HTTP 401 from the ${PROBE_DESC}, but the response does not identify it as an"
        _log "  invalid credential. Refusing to tell the client their token expired on a guess."
        _log "  API said: ${BODY_EXCERPT:-<empty body>}"
        _log "  Operator triage required. The client has NOT been notified."
        exit 2
        ;;
    esac
    ;;
  *)
    # 400 / 403 / 5xx / 000 network — ambiguous or transient. Operator-log only.
    _log "CONFIG PROBLEM (ambiguous): ${PROBE_DESC} returned HTTP ${HTTP_CODE} for ${PIT_VAR}"
    _log "  (source ${PIT_SOURCE}, class ${PIT_CLASS}) — not a clean 2xx and not a 401."
    _log "  API said: ${BODY_EXCERPT:-<empty body>}"
    _log "  Operator: verify the token's scopes and the ${PIT_CLASS} id. The client has NOT been notified."
    exit 2
    ;;
esac

_log "Confirmed credential failure — surfacing the client notification..."

# ---------------------------------------------------------------------------
# 401 path: surface the client notification ONCE PER DAY (the .notified
# stamp). 999 harness form: there is no gateway send here. The notification
# is written as a dated artifact in the state dir and printed, for the
# session/scheduler to deliver via the client's configured channel. The
# target is the CLIENT's own configured chat (env CLIENT_TELEGRAM_CHAT_ID
# when the channel is Telegram); an id equal to the operator's is refused.
# ---------------------------------------------------------------------------
if [[ -f "$NOTIFIED_STAMP" ]]; then
  _log "already surfaced the notification today (${TODAY}) — not re-surfacing. Delete ${NOTIFIED_STAMP} to force."
  exit 1
fi

CLIENT_CHAT_ID=""
if [[ -n "$CLIENT_TELEGRAM_CHAT_ID" ]] && \
   { [[ -z "$OPERATOR_TELEGRAM_CHAT_ID" ]] || [[ "$CLIENT_TELEGRAM_CHAT_ID" != "$OPERATOR_TELEGRAM_CHAT_ID" ]]; }; then
  CLIENT_CHAT_ID="$CLIENT_TELEGRAM_CHAT_ID"
fi

if [[ -n "$OPERATOR_TELEGRAM_CHAT_ID" && -n "$CLIENT_TELEGRAM_CHAT_ID" && "$CLIENT_TELEGRAM_CHAT_ID" == "$OPERATOR_TELEGRAM_CHAT_ID" ]]; then
  _log "WARN the configured client chat id matches the excluded operator id (OPERATOR_TELEGRAM_CHAT_ID) — refusing to address the client notice there."
  _log "     Operator action required: the runtime credential ${PIT_VAR} (source ${PIT_SOURCE}, class ${PIT_CLASS}) is expired/invalid (HTTP 401)."
  exit 1
fi

# ---------------------------------------------------------------------------
# The client-facing refresh message (plain English, no jargon). VERBATIM.
# ---------------------------------------------------------------------------
NOTIFICATION_MSG="Hi — a quick heads-up from your AI agent.

My connection to your GoHighLevel / Convert and Flow account needs a quick refresh, so I can keep sending replies to your leads. The secure key (your Private Integration Token) has stopped working — this is normal and only takes a couple of minutes to fix.

Here is how to refresh it:

1. Log into GoHighLevel / Convert and Flow, then open Settings -> Private Integrations (or API Keys).

2. Re-issue (or copy) your Private Integration Token. Make sure it still has the messaging, calendars, and invoices permissions it started with.

3. Send it to me like this:
   Here is my updated GoHighLevel Private Integration Token: [paste here] — please update my settings.

That is it — once you send it, I will update your settings and confirm replies are flowing again. If anything looks different from your original setup, just reply and I will walk you through it."

NOTIFICATION_FILE="${STATE_DIR}/ghl-pit-liveness-${TODAY}.notification.txt"
{
  printf 'CLIENT NOTIFICATION — SURFACED, NOT SENT by this script.\n'
  printf 'Deliver via the client configured channel (Telegram chat id on file: %s).\n\n' "${CLIENT_CHAT_ID:-none}"
  printf '%s\n' "$NOTIFICATION_MSG"
} > "$NOTIFICATION_FILE"
_log "notification surfaced at ${NOTIFICATION_FILE} (client chat id on file: ${CLIENT_CHAT_ID:-none}) — deliver via the client configured channel:"
printf '%s\n' "$NOTIFICATION_MSG"
touch "$NOTIFIED_STAMP"

exit 1
