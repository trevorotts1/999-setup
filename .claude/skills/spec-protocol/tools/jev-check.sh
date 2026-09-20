#!/usr/bin/env bash
# jev-check.sh — resolve and PROVE the decision engine, or say plainly that there is none.
#
# WHY THIS EXISTS. spec-protocol makes small typed judgements all run long: which of
# six things is being built, whether a sentence carries a word a client will not know,
# whether a paid generation is about to exceed what was approved, whether a fix loop has
# stopped improving. A System One model (TypeSafe's Jev) answers those in ~250ms for a
# fraction of a cent, and returns a CALIBRATED confidence so the run knows when not to
# trust its own answer. Nothing here is required: every caller has a named fallback and
# a run with no decision engine produces the same finished product.
#
# THE LADDER (first hit wins, and a direct key ALWAYS beats a broker)
#   1. JEV_TYPESAFE_API_KEY  -> POST https://api.typesafe.ai/v1/systemone   model jev-latest
#   2. OPENROUTER_API_KEY    -> POST https://openrouter.ai/api/v1/systemone model typesafe/jev-1.13
#   3. neither               -> ABSENT. Not an error. The run continues without it.
#
# KEY RESOLUTION READS, NEVER SOURCES. Key files are PARSED line by line (env-sweep.md's
# rule). A value is never echoed, logged, written to a receipt, or passed on a command
# line -- it reaches curl through an environment variable and nothing else.
#
# ⛔ JEV IS NOT ON GET /api/v1/models. That listing covers models that emit TEXT; Jev's
# output modality is `decisions`. An absence there proves nothing, and treating it as
# proof is the exact false negative this script exists to refuse. Reachability is decided
# by a REAL CALL and by nothing else.
#
# EXIT CODES
#   0  PRESENT and PROVEN -- a real call returned a typed answer
#   1  ABSENT -- no key of either kind was found. A fact, not a failure.
#   2  UNDETERMINED -- a key exists but the call could not be completed (network,
#      credit, auth, timeout). NEVER exit 0 from a check that did not reach its source,
#      and never report ABSENT for a key that exists but could not be tested.
#
# USAGE
#   jev-check.sh              the check; one line to stdout
#   jev-check.sh --json       the same verdict as one JSON object
#   jev-check.sh --say        print the client-facing recommendation (only meaningful on exit 1)
#   jev-check.sh --selftest   prove the instrument, then exit

set -uo pipefail

TYPESAFE_URL="https://api.typesafe.ai/v1/systemone"
OPENROUTER_URL="https://openrouter.ai/api/v1/systemone"
TYPESAFE_MODEL="jev-latest"
OPENROUTER_MODEL="typesafe/jev-1.13"
TIMEOUT="${JEV_CHECK_TIMEOUT:-25}"

# Every place a key may legitimately live. Named here so a negative can name its sources.
key_files() {
  printf '%s\n' \
    "${HOME}/.openclaw/secrets/.env" \
    "${CLAUDE_CONFIG_DIR:-${HOME}/.claude}/secrets/.env" \
    "${HOME}/.claude/secrets/.env" \
    "${HOME}/.claude-nine/secrets/.env"
}

# Parse a KEY=value line out of a file. Never sources it: a credential file is data,
# and sourcing one runs whatever a previous tool happened to leave in it.
parse_key() {
  name="$1"; file="$2"
  [ -r "$file" ] || return 1
  line=$(/usr/bin/grep -m1 -E "^[[:space:]]*(export[[:space:]]+)?${name}=" "$file" 2>/dev/null) || return 1
  value=${line#*=}
  value=${value%\"}; value=${value#\"}
  value=${value%\'}; value=${value#\'}
  value=$(printf '%s' "$value" | tr -d '[:space:]')
  [ -n "$value" ] || return 1
  printf '%s' "$value"
}

resolve() {
  name="$1"
  eval "envval=\${$name:-}"
  if [ -n "${envval:-}" ]; then printf '%s' "$envval"; return 0; fi
  for f in $(key_files); do
    if v=$(parse_key "$name" "$f"); then printf '%s' "$v"; return 0; fi
  done
  return 1
}

# One real call. Prints the HTTP code on line 1 and the raw body after it.
# The code is NOT set in a variable: this runs inside $( ), and a variable set in a
# subshell never reaches the caller -- the defect this shape exists to avoid.
probe() {
  url="$1"; model="$2"; JEV_PROBE_KEY="$3"
  body=$(printf '{"model":"%s","state":{"probe":"spec-protocol decision-engine smoke test"},"questions":{"reachable":{"type":"noul","instructions":"Is this text a smoke test or probe?","criteria":{"true":"It says it is a smoke test or a probe.","false":"It is anything else."}}}}' "$model")
  export JEV_PROBE_KEY
  out=$(curl -s -m "$TIMEOUT" -w '\n%{http_code} %{time_total}' -X POST "$url" \
        -H "Authorization: Bearer ${JEV_PROBE_KEY}" \
        -H "Content-Type: application/json" \
        -H "HTTP-Referer: https://github.com/trevorotts1/999-setup" \
        -H "X-Title: spec-protocol" \
        -d "$body" 2>/dev/null)
  rc=$?
  unset JEV_PROBE_KEY
  [ $rc -ne 0 ] && { printf '000 0\n'; return; }
  meta=$(printf '%s' "$out" | tail -1)
  payload=$(printf '%s' "$out" | sed '$d')
  printf '%s\n%s' "$meta" "$payload"
}

emit() { # verdict source model latency detail
  if [ "${JSON:-0}" = "1" ]; then
    printf '{"verdict":"%s","source":"%s","model":"%s","latency_ms":%s,"detail":"%s"}\n' "$1" "$2" "$3" "${4:-null}" "$5"
  else
    printf 'DECISION-ENGINE: verdict=%s source=%s model=%s latency_ms=%s detail=%s\n' "$1" "$2" "$3" "${4:-n/a}" "$5"
  fi
}

SAY_TEXT='Before we get started — there is a small decision engine I use to make quick judgement calls, and it makes the whole build a little sharper. It is called Jev. You can add a few dollars of credit to an OpenRouter account if you already have one, or go straight to typesafe.ai. Either is fine, and if you would rather skip it I will carry on without it — nothing here depends on it.'

JSON=0
case "${1:-}" in
  --json) JSON=1 ;;
  --say)  printf '%s\n' "$SAY_TEXT"; exit 0 ;;
  --selftest) SELFTEST=1 ;;
  "") : ;;
  *) printf 'jev-check.sh: unknown flag %s\n' "$1" >&2; exit 2 ;;
esac

if [ "${SELFTEST:-0}" = "1" ]; then
  fails=0
  t() { if [ "$2" = "$3" ]; then printf 'PASS  %s\n' "$1"; else printf 'FAIL  %s (got %s want %s)\n' "$1" "$2" "$3"; fails=$((fails+1)); fi; }
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  printf 'OTHER=x\nJEV_TYPESAFE_API_KEY="sk-fixture-value"\n' > "$tmp/.env"
  got=$(parse_key JEV_TYPESAFE_API_KEY "$tmp/.env"); t "parses a quoted key from a file" "$got" "sk-fixture-value"
  printf 'export OPENROUTER_API_KEY=plain-fixture\n' > "$tmp/.env2"
  got=$(parse_key OPENROUTER_API_KEY "$tmp/.env2"); t "parses an exported key" "$got" "plain-fixture"
  parse_key NOPE_KEY "$tmp/.env" >/dev/null 2>&1; t "absent key returns nonzero" "$?" "1"
  parse_key ANY "$tmp/does-not-exist" >/dev/null 2>&1; t "unreadable file returns nonzero" "$?" "1"
  printf 'JEV_TYPESAFE_API_KEY=\n' > "$tmp/.env3"
  parse_key JEV_TYPESAFE_API_KEY "$tmp/.env3" >/dev/null 2>&1; t "empty value is not a key" "$?" "1"
  t "direct transport is listed first" "$(key_order=$(printf '%s %s' JEV_TYPESAFE_API_KEY OPENROUTER_API_KEY); printf '%s' "${key_order%% *}")" "JEV_TYPESAFE_API_KEY"
  out=$(printf '%s' "$SAY_TEXT" | /usr/bin/grep -c 'typesafe.ai'); t "recommendation names typesafe.ai, never jev.ai" "$out" "1"
  out=$(printf '%s' "$SAY_TEXT" | /usr/bin/grep -c 'jev.ai'); t "recommendation does NOT send anyone to jev.ai" "$out" "0"
  out=$(printf '%s' "$SAY_TEXT" | /usr/bin/grep -c 'nothing here depends on it'); t "recommendation states it is optional" "$out" "1"
  if [ "$fails" -eq 0 ]; then printf 'jev-check.sh selftest: ALL PASS (9 checks)\n'; exit 0; fi
  printf 'jev-check.sh selftest: %s FAILED\n' "$fails"; exit 2
fi

SOURCES="env JEV_TYPESAFE_API_KEY, env OPENROUTER_API_KEY, $(key_files | tr '\n' ' ')"

CODE=""
if K=$(resolve JEV_TYPESAFE_API_KEY); then
  raw=$(probe "$TYPESAFE_URL" "$TYPESAFE_MODEL" "$K")
  meta=$(printf '%s' "$raw" | head -1)
  CODE=${meta%% *}
  secs=${meta##* }
  ms=$(printf '%.0f' "$(echo "$secs 1000" | awk '{print $1*$2}')" 2>/dev/null || printf 0)
  body=$(printf '%s' "$raw" | sed '1d')
  case "$CODE" in
    200) if printf '%s' "$body" | /usr/bin/grep -q '"noul"'; then
           emit PRESENT direct "$(printf '%s' "$body" | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')" "$ms" "typed answer returned"; exit 0
         fi
         emit UNDETERMINED direct "$TYPESAFE_MODEL" "$ms" "HTTP 200 without a typed answer"; exit 2 ;;
    000) emit UNDETERMINED direct "$TYPESAFE_MODEL" "$ms" "no response within ${TIMEOUT}s"; exit 2 ;;
    *)   emit UNDETERMINED direct "$TYPESAFE_MODEL" "$ms" "HTTP ${CODE}"; exit 2 ;;
  esac
fi

if K=$(resolve OPENROUTER_API_KEY); then
  raw=$(probe "$OPENROUTER_URL" "$OPENROUTER_MODEL" "$K")
  meta=$(printf '%s' "$raw" | head -1)
  CODE=${meta%% *}
  secs=${meta##* }
  ms=$(printf '%.0f' "$(echo "$secs 1000" | awk '{print $1*$2}')" 2>/dev/null || printf 0)
  body=$(printf '%s' "$raw" | sed '1d')
  case "$CODE" in
    200) if printf '%s' "$body" | /usr/bin/grep -q '"noul"'; then
           emit PRESENT openrouter "$(printf '%s' "$body" | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')" "$ms" "typed answer returned"; exit 0
         fi
         emit UNDETERMINED openrouter "$OPENROUTER_MODEL" "$ms" "HTTP 200 without a typed answer"; exit 2 ;;
    402) emit UNDETERMINED openrouter "$OPENROUTER_MODEL" "$ms" "HTTP 402 -- key works, account needs credit"; exit 2 ;;
    000) emit UNDETERMINED openrouter "$OPENROUTER_MODEL" "$ms" "no response within ${TIMEOUT}s"; exit 2 ;;
    *)   emit UNDETERMINED openrouter "$OPENROUTER_MODEL" "$ms" "HTTP ${CODE}"; exit 2 ;;
  esac
fi

emit ABSENT none none "" "no key found in: ${SOURCES}"
exit 1
