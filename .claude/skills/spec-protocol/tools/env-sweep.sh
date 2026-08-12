#!/usr/bin/env bash
# env-sweep.sh — Automated environment credential sweep
# Usage: env-sweep.sh [--target <app|website|funnel>]
#        env-sweep.sh <app|website|funnel>
#        env-sweep.sh --selftest
#
# Searches ALL env stores for required credentials and reports found/missing
# as a plain-text checklist. NEVER prints secret values.
#
# Output: a plain-text report with key, status (FOUND/MISSING/LIVE/
# NOT_VERIFIED) and the stores that were searched.
#
# --selftest proves the instrument before any run is believed (ground rule 11):
# a known-positive control, a known-negative control, a ~/.env STORE control
# (proving the tool reads the store it tells users to place a key in — not
# merely that it lists it), and a leak proof that plants a sentinel value in
# every checked variable and requires the sentinel to appear ZERO times in the
# output. A detector whose known-positive comes back MISSING reports BROKEN
# INSTRUMENT — never "clean".
#
# SWEEP_NO_NETWORK=1 makes every smoke test hermetic (no curl, no gh, no npx).
# The selftest sets it; a normal run does not.

set -o pipefail

# --- Argument parsing ---------------------------------------------------------
TARGET_TYPE="app"
SELFTEST=0
case "${1:-}" in
  --selftest) SELFTEST=1 ;;
  --target)   TARGET_TYPE="${2:-app}" ;;
  "")         ;;
  *)          TARGET_TYPE="$1" ;;
esac

# --- Where to look ---
SECRETS_ENV="${HOME}/.openclaw/secrets/.env"
OPENCLAW_ENV="${HOME}/.openclaw/.env"
# USER_ENV — the user-level env file. environment-sweep.md has listed it as a
# store since the file was written, but the tool never sourced it, so a key
# placed there was invisible to a re-detect and every guided key placement on a
# non-fleet box ended in "I still can't find it". It is the ONE universal,
# harmless placement target on a box that has no ~/.openclaw/ directory (never
# conjure that directory to hold a key — a fabricated fleet path is a false
# topology signal). Sourced in Phase 1, and proven read by the selftest's
# ~/.env store control.
USER_ENV="${HOME}/.env"
NINE_ROUTER_DIR="${HOME}/.config/9router"
PROJECT_ENV=".env"
PROJECT_ENV_LOCAL=".env.local"
SHELL_ENV_FILE="/dev/null"  # We source live env, not a file for this

NO_NET="${SWEEP_NO_NETWORK:-0}"

# --- Helper: check if env var is set (by name only, NEVER prints value) ---
check_env_var() {
  local var_name="$1"
  # Use indirect expansion — safe, never echoes the value
  if [[ -n "${!var_name:-}" ]]; then
    echo "FOUND"
  else
    echo "MISSING"
  fi
}

# --- Source an env file safely (never dump contents) ---
source_env_file() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    # shellcheck disable=SC1090
    source "${env_file}" 2>/dev/null
    return 0
  fi
  return 1
}

# --- Bearer-auth smoke helper: the ONE place the credential escaping lives ----
#
# CREDENTIAL SAFETY (references/environment-sweep.md RULE 1): the secret value
# NEVER reaches a command line. curl reads the Authorization header from a
# config file on STDIN, so the process table shows only "--config -"; printf is
# a shell builtin, so the value never becomes an argv entry of any process; and
# nothing is written to disk. Passing the secret as a shell-function argument is
# safe for the same reason a local variable is — no process is execed, so it
# cannot appear in `ps`.
#
# THE QUOTING TRAP, MEASURED: the curl config value MUST be quoted. An unquoted
# `header = ...` line was measured to be SILENTLY DROPPED — the request went out
# with no Authorization header at all and came back 401, which reads exactly
# like a dead key. Backslashes and double quotes are therefore escaped for
# curl's quoted form, proven byte-exact against a value containing \ " ` and $.
# This is the near-silent, escaping-dependent failure class documented in
# references/environment-sweep.md ("Prove the instrument before reporting any
# NOT SET"), which is why this logic lives in exactly one function.
#
# Prints the HTTP status code on stdout; RETURNS curl's exit code. A non-zero
# return is a BROKEN INSTRUMENT (curl absent -> 127 is a shell abort, DNS down,
# timeout) and is NEVER a fact about the credential — every caller must branch
# on it before interpreting the status.
curl_bearer_status() {
  local url="$1" secret="$2"
  local esc="${secret//\\/\\\\}"
  esc="${esc//\"/\\\"}"
  printf 'header = "Authorization: Bearer %s"\n' "${esc}" \
    | curl -s -o /dev/null -w "%{http_code}" --max-time 15 --config - "${url}" 2>/dev/null
}

# --- Smoke test a GitHub token ---
# The token is NEVER interpolated into a URL: a credential in a git remote URL
# is visible in the process table for the life of the request (and can be
# captured by git's own trace/credential machinery). The API's /user endpoint
# discriminates a live token from a revoked one, and it takes the header from
# STDIN via curl_bearer_status.
smoke_test_github() {
  if [[ "${NO_NET}" == "1" ]]; then
    echo "NOT_VERIFIED"
    return 0
  fi
  if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null 2>&1; then
      echo "LIVE"
      return 0
    fi
  fi
  # Fallback: authenticate the token against the API, header on STDIN.
  if [[ -n "${GITHUB_TOKEN:-}" ]] || [[ -n "${GH_TOKEN:-}" ]]; then
    local token="${GITHUB_TOKEN:-${GH_TOKEN}}"
    local resp rc
    resp="$(curl_bearer_status "https://api.github.com/user" "${token}")"
    rc=$?
    # rc != 0 is a broken instrument, never a fact about the token.
    if [[ "${rc}" -eq 0 && "${resp}" == "200" ]]; then
      echo "LIVE"
      return 0
    fi
  fi
  echo "NOT_VERIFIED"
}

# --- Smoke test a DeepSeek key ---
smoke_test_deepseek() {
  local key="${DEEPSEEK_API_KEY:-${DEEPSEEK_KEY:-${DEEPSEEK_DIRECT_API_KEY:-}}}"
  if [[ -z "${key}" ]]; then
    echo "MISSING"
    return 1
  fi
  if [[ "${NO_NET}" == "1" ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  # Lightweight: list models (cheapest possible endpoint). The key goes in on
  # STDIN via curl_bearer_status — never on the command line (RULE 1).
  local resp rc
  resp="$(curl_bearer_status "https://api.deepseek.com/v1/models" "${key}")"
  rc=$?
  # rc != 0 is a broken instrument, never a fact about the key.
  if [[ "${rc}" -ne 0 ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  if [[ "${resp}" == "200" ]]; then
    echo "LIVE"
    return 0
  fi
  echo "FOUND_NOT_LIVE"
}

# --- Smoke test an Ollama Cloud key ---
smoke_test_ollama() {
  local key="${OLLAMA_API_KEY:-${OLLAMA_CLOUD_KEY:-${OLLAMA_KEY:-}}}"
  if [[ -z "${key}" ]]; then
    echo "MISSING"
    return 1
  fi
  echo "FOUND"
}

# --- Smoke test an OpenRouter key ---
# capacity.md section 9 names OPENROUTER_API_KEY; the two extra aliases follow
# this file's house pattern of three accepted names per provider.
#
# Two measured facts govern the endpoint choice (both taken 2026-08-12, curl
# 8.7.1, no credential involved):
#   1. GET https://openrouter.ai/api/v1/models answers 200 with NO Authorization
#      header at all. It is PUBLIC, so it cannot tell a live key from a revoked
#      one — smoking it would stamp LIVE on a dead account.
#   2. GET https://openrouter.ai/api/v1/key answers 401 with no header and 401
#      with a bogus bearer token, and OpenRouter's own docs say 200 + key
#      metadata for a valid key. That endpoint discriminates; models does not.
#
# CREDENTIAL SAFETY: handled by curl_bearer_status above — the value never
# reaches a command line, and the measured quoting trap is documented there.
smoke_test_openrouter() {
  local key="${OPENROUTER_API_KEY:-${OPENROUTER_KEY:-${OPENROUTER_TOKEN:-}}}"
  if [[ -z "${key}" ]]; then
    echo "MISSING"
    return 1
  fi
  if [[ "${NO_NET}" == "1" ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  local resp rc
  resp="$(curl_bearer_status "https://openrouter.ai/api/v1/key" "${key}")"
  rc=$?
  # rc != 0 is a broken instrument (curl absent -> 127 is a shell abort, DNS
  # down, timeout), never a fact about the key. Report UNDETERMINED liveness.
  if [[ "${rc}" -ne 0 ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  case "${resp}" in
    200)     echo "LIVE" ;;
    401|403) echo "FOUND_NOT_LIVE" ;;
    *)       echo "FOUND_NOT_VERIFIED" ;;
  esac
}

# --- Smoke test a kie.ai key (media generation — images and video) ---
# Aliases follow this file's house pattern of three accepted names per
# provider: KIE_API_KEY and KIE_AI_API_KEY are the two the media contract
# names, and KIE_KEY is the house bare form (cf. DEEPSEEK_KEY, OLLAMA_KEY).
#
# Liveness endpoint: the account's credit endpoint, the cheapest authenticated
# call kie documents. THE BALANCE FIGURE IS NEVER READ OR PRINTED HERE:
# curl_bearer_status discards the body (-o /dev/null) and returns only the HTTP
# status code. A balance is a CAPACITY figure — it belongs to the burn table,
# measured at media-planning time — and a credential sweep that printed it
# would be reporting an account's money in a report about NAMES.
#
# CREDENTIAL SAFETY: handled by curl_bearer_status above — the value never
# reaches a command line, and the measured quoting trap is documented there.
smoke_test_kie() {
  local key="${KIE_API_KEY:-${KIE_AI_API_KEY:-${KIE_KEY:-}}}"
  if [[ -z "${key}" ]]; then
    echo "MISSING"
    return 1
  fi
  if [[ "${NO_NET}" == "1" ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  local resp rc
  resp="$(curl_bearer_status "https://api.kie.ai/api/v1/chat/credit" "${key}")"
  rc=$?
  # rc != 0 is a broken instrument (curl absent -> 127 is a shell abort, DNS
  # down, timeout), never a fact about the key. Report UNDETERMINED liveness.
  if [[ "${rc}" -ne 0 ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  case "${resp}" in
    200)     echo "LIVE" ;;
    401|403) echo "FOUND_NOT_LIVE" ;;
    *)       echo "FOUND_NOT_VERIFIED" ;;
  esac
}

# --- Smoke test a Vercel token ---
smoke_test_vercel() {
  local token="${VERCEL_TOKEN:-${VERCEL_API_TOKEN:-${VERCEL_ACCESS_TOKEN:-}}}"
  if [[ -z "${token}" ]]; then
    echo "MISSING"
    return 1
  fi
  if [[ "${NO_NET}" == "1" ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  if command -v npx &>/dev/null; then
    if npx --no-install vercel whoami --token "${token}" &>/dev/null 2>&1; then
      echo "LIVE"
      return 0
    fi
  fi
  echo "FOUND_NOT_VERIFIED"
}

# --- Smoke test a GHL PIT ---
smoke_test_ghl() {
  local pit="${GOHIGHLEVEL_API_KEY:-${GHL_API_KEY:-${GOHIGHLEVEL_LOCATION_PIT:-${GHL_LOCATION_PIT:-${CAF_API_KEY:-${PIT_TOKEN:-${GHL_PIT:-${GOHIGHLEVEL_PIT:-${CONVERTANDFLOW_API_KEY:-${CONVERTANDFLOW_PIT:-${CONVERT_AND_FLOW_API_KEY:-}}}}}}}}}}}"
  if [[ -z "${pit}" ]]; then
    echo "MISSING"
    return 1
  fi
  if [[ "${NO_NET}" == "1" ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  # Lightweight: get locations (read-only, cheap). The PIT goes in on STDIN via
  # curl_bearer_status — never on the command line (RULE 1).
  local resp rc
  resp="$(curl_bearer_status "https://services.leadconnectorhq.com/locations/" "${pit}")"
  rc=$?
  # rc != 0 is a broken instrument, never a fact about the PIT.
  if [[ "${rc}" -ne 0 ]]; then
    echo "FOUND_NOT_VERIFIED"
    return 0
  fi
  if [[ "${resp}" == "200" ]] || [[ "${resp}" == "401" ]]; then
    # 401 still means the key resolves (just may not have the right scopes)
    echo "FOUND"
    return 0
  fi
  echo "FOUND_NOT_VERIFIED"
}

# --- The selftest (runs the real script as a child, twice, in a sandbox HOME) --
run_selftest() {
  local self="$1"
  local sandbox sentinel out_pos out_neg rc_pos rc_neg fails
  sandbox="$(mktemp -d "${TMPDIR:-/tmp}/env-sweep-selftest.XXXXXX")" || {
    echo "SELFTEST: FAIL — could not create sandbox HOME" >&2
    return 1
  }
  # A value that exists nowhere else on the machine. If this string ever
  # appears in the output, the sweep leaks secret VALUES.
  sentinel="SENTINEL-SECRET-VALUE-9f3a7c21-DO-NOT-PRINT"
  fails=0

  echo "SELFTEST — env-sweep.sh"
  echo "  sandbox HOME: ${sandbox}"
  echo

  # --- Control 1: KNOWN-POSITIVE. Every credential planted; must be detected.
  out_pos="$(env -i \
      HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      SWEEP_NO_NETWORK=1 \
      GITHUB_TOKEN="${sentinel}" \
      DEEPSEEK_API_KEY="${sentinel}" \
      OLLAMA_API_KEY="${sentinel}" \
      OPENROUTER_API_KEY="${sentinel}" \
      VERCEL_TOKEN="${sentinel}" \
      GOHIGHLEVEL_API_KEY="${sentinel}" \
      GOHIGHLEVEL_LOCATION_ID="${sentinel}" \
      GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN="${sentinel}" \
      KIE_API_KEY="${sentinel}" \
      AGNES_AI_API_KEY="${sentinel}" \
      bash "${self}" funnel 2>&1)"
  rc_pos=$?

  # --- Control 2: KNOWN-NEGATIVE. Nothing planted; must report MISSING.
  out_neg="$(env -i \
      HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      SWEEP_NO_NETWORK=1 \
      bash "${self}" funnel 2>&1)"
  rc_neg=$?

  # --- Control 3: THE ~/.env STORE CONTROL.
  #
  # A key planted ONLY in the sandbox's ~/.env — with an otherwise EMPTY
  # environment — must come back detected. This is the control that proves the
  # tool genuinely SOURCES ~/.env rather than merely listing it in a report.
  # Without it, the whole guided key-placement flow fails by default: the user
  # is told to put a key in ~/.env, does exactly that, and is then told the key
  # cannot be found — a false negative that reads as the user's mistake.
  #
  # It runs in a SECOND sandbox HOME so that control 2's empty environment
  # stays genuinely empty; sharing one HOME would make the known-negative
  # control assert against a store this control had just populated.
  #
  # AGNES is deliberately left unplanted here: a run in which the new store is
  # read must still report MISSING for a key that is in no store at all. That
  # is what makes this a discriminating control rather than a run that says
  # FOUND to everything.
  local sandbox2 out_env rc_env
  sandbox2="$(mktemp -d "${TMPDIR:-/tmp}/env-sweep-selftest-userenv.XXXXXX")" || {
    echo "SELFTEST: FAIL — could not create the second sandbox HOME" >&2
    rm -rf "${sandbox}"
    return 1
  }
  # printf is a shell builtin: the planted value never becomes an argv entry of
  # any process, exactly as in curl_bearer_status.
  printf 'KIE_API_KEY=%s\n' "${sentinel}" > "${sandbox2}/.env"
  chmod 600 "${sandbox2}/.env" 2>/dev/null
  out_env="$(env -i \
      HOME="${sandbox2}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      SWEEP_NO_NETWORK=1 \
      bash "${self}" funnel 2>&1)"
  rc_env=$?

  # --- Check 1: both runs exited clean.
  if [[ "${rc_pos}" -eq 0 && "${rc_neg}" -eq 0 ]]; then
    echo "  [PASS] both control runs exited 0 (positive=${rc_pos} negative=${rc_neg})"
  else
    echo "  [FAIL] a control run did not exit 0 (positive=${rc_pos} negative=${rc_neg})"
    fails=$((fails + 1))
  fi

  # --- Check 2: the known-positive is DETECTED (instrument proof).
  local pos_missing=0 k
  for k in GITHUB DEEPSEEK OLLAMA_CLOUD OPENROUTER VERCEL GHL_PIT GHL_LOCATION_ID GHL_FIREBASE KIE AGNES; do
    if printf '%s\n' "${out_pos}" | /usr/bin/grep -qE "^${k}: MISSING$"; then
      pos_missing=$((pos_missing + 1))
      echo "  [FAIL] known-positive control: ${k} reported MISSING with a value present"
    fi
  done
  if [[ "${pos_missing}" -eq 0 ]]; then
    echo "  [PASS] known-positive control: all 10 planted credentials detected"
  else
    echo "  [BROKEN INSTRUMENT] ${pos_missing} planted credential(s) read as MISSING — this sweep cannot be trusted to report a zero"
    fails=$((fails + 1))
  fi

  # --- Check 3: the known-negative is ABSENT (the detector discriminates).
  local neg_found=0
  for k in GITHUB DEEPSEEK OLLAMA_CLOUD OPENROUTER VERCEL GHL_PIT GHL_LOCATION_ID GHL_FIREBASE KIE AGNES; do
    if ! printf '%s\n' "${out_neg}" | /usr/bin/grep -qE "^${k}: MISSING$"; then
      neg_found=$((neg_found + 1))
      echo "  [FAIL] known-negative control: ${k} did not report MISSING in an empty environment"
    fi
  done
  if [[ "${neg_found}" -eq 0 ]]; then
    echo "  [PASS] known-negative control: all 10 report MISSING in an empty environment"
  else
    echo "  [BROKEN INSTRUMENT] the sweep does not discriminate — positive and negative read alike"
    fails=$((fails + 1))
  fi

  # --- Check 4: THE LEAK PROOF, two surfaces.
  #
  # (a) THE OUTPUT surface: the sentinel value must appear ZERO times.
  #
  # (b) THE PROCESS-TABLE surface: the controls run with SWEEP_NO_NETWORK=1, so
  #     they never execute a single network call — the output scan alone can
  #     therefore NEVER see an argv leak, and a green (a) is not evidence about
  #     (b). A credential passed on a command line is visible in `ps` for the
  #     life of the request; that was PROVEN by inspection with
  #     `ps -p <pid> -o args=` (value visible with -H, absent with --config -,
  #     with a control confirming ps was not blind). Since the runtime path is
  #     unreachable under the hermetic controls, (b) is enforced STATICALLY:
  #     this source must contain no bearer credential on any command line, and
  #     no credential interpolated into a URL. Every network smoke test routes
  #     through curl_bearer_status, which puts the header on STDIN.
  #
  #     KNOWN EXCEPTION, deliberately not matched: smoke_test_vercel passes
  #     `--token` to the vercel CLI. It is the same exposure class and it is
  #     NOT fixed here — the CLI's only documented alternative is the
  #     VERCEL_TOKEN environment variable, and on macOS a child's environment is
  #     itself readable (`ps -E`), so that is a lateral move, not a fix. It is
  #     recorded as an open finding rather than silently passed.
  #
  #     THE SCAN COVERS EVERY CONTROL THAT CARRIES THE SENTINEL — the planted
  #     environment (control 1) AND the planted ~/.env store (control 3). A
  #     leak proof that scanned only one surface would pass while the other
  #     printed the value; a store the tool newly READS is a new surface it
  #     could newly PRINT from, so it is scanned here by construction.
  local leaks
  leaks="$(printf '%s\n%s\n' "${out_pos}" "${out_env}" | /usr/bin/grep -c "${sentinel}")"

  local argv_hits url_hits
  argv_hits="$(/usr/bin/grep -cE '^[^#]*-H[[:space:]]+.{0,3}Authorization' "${self}")"
  url_hits="$(/usr/bin/grep -cE '^[^#]*https?://[^"'"'"' ]*\$\{[A-Za-z_]' "${self}")"

  if [[ "${leaks}" -eq 0 && "${argv_hits}" -eq 0 && "${url_hits}" -eq 0 ]]; then
    echo "  [PASS] leak proof: 0 secret values printed; 0 bearer credentials on any command line; 0 credentials interpolated into a URL"
  else
    [[ "${leaks}" -ne 0 ]] && echo "  [FAIL] leak proof: the sweep printed the secret VALUE ${leaks} time(s)"
    [[ "${argv_hits}" -ne 0 ]] && echo "  [FAIL] leak proof: ${argv_hits} Authorization header(s) passed on a command line — visible in the process table (RULE 1). Use curl_bearer_status."
    [[ "${url_hits}" -ne 0 ]] && echo "  [FAIL] leak proof: ${url_hits} credential(s) interpolated into a URL — visible in the process table (RULE 1)."
    fails=$((fails + 1))
  fi

  # --- Check 5: the report shape is intact (all 11 keys present).
  local keys_found
  keys_found="$(printf '%s\n' "${out_pos}" | /usr/bin/grep -cE '^(GITHUB|DEEPSEEK|OLLAMA_CLOUD|OPENROUTER|VERCEL|GHL_PIT|GHL_LOCATION_ID|GHL_FIREBASE|KIE|AGNES|NINE_ROUTER): ')"
  if [[ "${keys_found}" -eq 11 ]]; then
    echo "  [PASS] report shape: all 11 report lines present"
  else
    echo "  [FAIL] report shape: expected 11 report lines, found ${keys_found}"
    fails=$((fails + 1))
  fi

  # --- Check 6: the ~/.env STORE IS ACTUALLY SOURCED (control 3).
  #
  # Two assertions in one verdict, because either alone would be worthless:
  #   (a) the key planted ONLY in ~/.env is DETECTED — the store is read;
  #   (b) a key planted NOWHERE still reports MISSING in that same run — the
  #       detection in (a) is a measurement, not a run that says FOUND to
  #       everything.
  # A tool that passes (a) and fails (b) is broken in the direction that hides
  # every future absence, so (b) is asserted here rather than inferred from the
  # other controls' separate runs.
  local userenv_pos=0 userenv_neg=0
  printf '%s\n' "${out_env}" | /usr/bin/grep -qE '^KIE: (FOUND|LIVE|FOUND_NOT_LIVE|FOUND_NOT_VERIFIED)$' && userenv_pos=1
  printf '%s\n' "${out_env}" | /usr/bin/grep -qE '^AGNES: MISSING$' && userenv_neg=1
  if [[ "${rc_env}" -eq 0 && "${userenv_pos}" -eq 1 && "${userenv_neg}" -eq 1 ]]; then
    echo "  [PASS] ~/.env store control: a key placed ONLY in \$HOME/.env is detected, and a key placed nowhere still reports MISSING in the same run — the store is read AND the detector still discriminates"
  else
    if [[ "${rc_env}" -ne 0 ]]; then
      echo "  [FAIL] ~/.env store control: the control run did not exit 0 (rc=${rc_env})"
    fi
    if [[ "${userenv_pos}" -ne 1 ]]; then
      echo "  [BROKEN INSTRUMENT] ~/.env store control: a key placed in \$HOME/.env read as MISSING — the tool does not source ~/.env, so every guided key placement there will be reported back to the user as a missing key. That is a false negative about the USER, and it is not permitted."
    fi
    if [[ "${userenv_neg}" -ne 1 ]]; then
      echo "  [BROKEN INSTRUMENT] ~/.env store control: a credential planted in NO store did not report MISSING — the sweep does not discriminate and its FOUND means nothing"
    fi
    fails=$((fails + 1))
  fi

  rm -rf "${sandbox}" "${sandbox2}"
  echo
  if [[ "${fails}" -eq 0 ]]; then
    echo "SELFTEST: PASS (6/6) — instrument proven, 0 secret values printed"
    return 0
  fi
  echo "SELFTEST: FAIL (${fails} check(s) failed)"
  return 1
}

if [[ "${SELFTEST}" -eq 1 ]]; then
  run_selftest "${BASH_SOURCE[0]}"
  exit $?
fi

# --- Main ---

# Phase 1: Source all env stores
#
# ORDER IS PRECEDENCE, and it is deliberate: a later source overwrites an
# earlier one, so ~/.env goes FIRST and the openclaw stores keep the last word.
# A stray user-level file must never shadow the canonical fleet secrets store.
# This costs the guided-placement flow nothing — that flow only reaches ~/.env
# when the openclaw stores DON'T carry the key, so there is no collision to
# lose. Presence detection is unaffected either way; only a same-name collision
# is decided here, and it is decided toward the authoritative store.
source_env_file "${USER_ENV}" || true
source_env_file "${SECRETS_ENV}" || true
source_env_file "${OPENCLAW_ENV}" || true

# Phase 2: Check GitHub
GITHUB_STATUS="MISSING"
GH_LOCATION=""
for var in GITHUB_TOKEN GH_TOKEN GITHUB_ACCESS_TOKEN; do
  if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
    GITHUB_STATUS="FOUND"
    GH_LOCATION="env"
    break
  fi
done
if [[ "${GITHUB_STATUS}" == "FOUND" ]]; then
  LIVE_CHECK=$(smoke_test_github)
  GITHUB_STATUS="${LIVE_CHECK}"
fi

# On fleet boxes, gh auth status works without an env var
if [[ "${GITHUB_STATUS}" != "LIVE" && "${NO_NET}" != "1" ]]; then
  if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
    GITHUB_STATUS="LIVE"
    GH_LOCATION="gh-cli"
  fi
fi

# Phase 3: Check DeepSeek
DEEPSEEK_STATUS="MISSING"
for var in DEEPSEEK_API_KEY DEEPSEEK_KEY DEEPSEEK_DIRECT_API_KEY; do
  if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
    DEEPSEEK_STATUS="FOUND"
    break
  fi
done
if [[ "${DEEPSEEK_STATUS}" == "FOUND" ]]; then
  DEEPSEEK_STATUS=$(smoke_test_deepseek)
fi

# Phase 4: Check Ollama Cloud
OLLAMA_STATUS="MISSING"
for var in OLLAMA_API_KEY OLLAMA_CLOUD_KEY OLLAMA_KEY; do
  if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
    OLLAMA_STATUS="FOUND"
    break
  fi
done

# Phase 5: Check OpenRouter
OPENROUTER_STATUS="MISSING"
for var in OPENROUTER_API_KEY OPENROUTER_KEY OPENROUTER_TOKEN; do
  if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
    OPENROUTER_STATUS="FOUND"
    break
  fi
done
if [[ "${OPENROUTER_STATUS}" == "FOUND" ]]; then
  OPENROUTER_STATUS=$(smoke_test_openrouter)
fi

# Phase 6: Check Vercel
VERCEL_STATUS="MISSING"
for var in VERCEL_TOKEN VERCEL_API_TOKEN VERCEL_ACCESS_TOKEN; do
  if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
    VERCEL_STATUS="FOUND"
    break
  fi
done
if [[ "${VERCEL_STATUS}" == "FOUND" ]]; then
  VERCEL_STATUS=$(smoke_test_vercel)
fi

# Phase 7: Check GHL (only for funnel/website targets)
GHL_PIT_STATUS="MISSING"
GHL_LOCATION_STATUS="MISSING"
GHL_FIREBASE_STATUS="MISSING"

if [[ "${TARGET_TYPE}" == "funnel" ]] || [[ "${TARGET_TYPE}" == "website" ]]; then
  # PIT
  for var in GOHIGHLEVEL_API_KEY GHL_API_KEY GOHIGHLEVEL_LOCATION_PIT GHL_LOCATION_PIT CAF_API_KEY PIT_TOKEN GHL_PIT GOHIGHLEVEL_PIT CONVERTANDFLOW_API_KEY CONVERTANDFLOW_PIT CONVERT_AND_FLOW_API_KEY; do
    if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
      GHL_PIT_STATUS="FOUND"
      break
    fi
  done
  if [[ "${GHL_PIT_STATUS}" == "FOUND" ]]; then
    GHL_PIT_STATUS=$(smoke_test_ghl)
  fi

  # Location ID
  for var in GOHIGHLEVEL_LOCATION_ID GHL_LOCATION_ID CAF_LOCATION_ID; do
    if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
      GHL_LOCATION_STATUS="FOUND"
      break
    fi
  done

  # Firebase token
  for var in GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN CAF_FIREBASE_REFRESH_TOKEN GHL_FIREBASE_REFRESH_TOKEN GOHIGHLEVEL_FIREBASE_TOKEN GHL_FIREBASE_TOKEN; do
    if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
      GHL_FIREBASE_STATUS="FOUND"
      break
    fi
  done
fi

# Phase 8: Check kie.ai (media generation — images and video)
# Checked on EVERY target, not just funnels: an app or a website needs hero art
# and screenshots as readily as a funnel does, and a media key that goes
# undetected sends the run down the ask-for-a-key path for no reason.
KIE_STATUS="MISSING"
for var in KIE_API_KEY KIE_AI_API_KEY KIE_KEY; do
  if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
    KIE_STATUS="FOUND"
    break
  fi
done
if [[ "${KIE_STATUS}" == "FOUND" ]]; then
  KIE_STATUS=$(smoke_test_kie)
fi

# Phase 9: Check Agnes-AI (media generation — images and video)
#
# PRESENCE ONLY, BY DESIGN — and the report says so. No cheap authenticated
# liveness endpoint is documented for Agnes: the wiki index, the quickstart and
# the FAQ were checked 2026-08-12 and none names one. Stamping LIVE off an
# undocumented guess would be exactly the fabricated positive this sweep exists
# to prevent, and stamping FOUND_NOT_LIVE off a 404 would be worse — it would
# read as a dead key when it is only an absent endpoint. So this phase resolves
# NAMES and stops there. A candidate probe (an authenticated GET on the
# OpenAI-compatible /v1/models path) is recorded as an open question in the
# media contract; until one is PROVEN, presence-only stands.
AGNES_STATUS="MISSING"
for var in AGNES_AI_API_KEY AGNES_API_KEY AGNES_KEY; do
  if check_env_var "${var}" | /usr/bin/grep -q "FOUND"; then
    AGNES_STATUS="FOUND"
    break
  fi
done

# Phase 10: Check 9Router presence (for Claude-Nine detection)
NINE_ROUTER_FOUND="MISSING"
if [[ -d "${HOME}/.claude-nine" ]]; then
  if [[ -f "${HOME}/.9router/db/data.sqlite" ]]; then
    NINE_ROUTER_FOUND="FOUND"
  elif /usr/bin/grep -q "ANTHROPIC_BASE_URL" "${HOME}/.claude-nine/settings.json" 2>/dev/null; then
    # Check if it's a loopback URL (don't print the value)
    if /usr/bin/grep -q "127.0.0.1\|localhost" "${HOME}/.claude-nine/settings.json" 2>/dev/null; then
      NINE_ROUTER_FOUND="FOUND"
    fi
  fi
fi

# Phase 11: Output results as plain text
cat <<REPORT

ENVIRONMENT SWEEP — $(date '+%Y-%m-%d %H:%M:%S')
Target: ${TARGET_TYPE}

GITHUB: ${GITHUB_STATUS}
DEEPSEEK: ${DEEPSEEK_STATUS}
OLLAMA_CLOUD: ${OLLAMA_STATUS}
OPENROUTER: ${OPENROUTER_STATUS}
VERCEL: ${VERCEL_STATUS}
GHL_PIT: ${GHL_PIT_STATUS}
GHL_LOCATION_ID: ${GHL_LOCATION_STATUS}
GHL_FIREBASE: ${GHL_FIREBASE_STATUS}
KIE: ${KIE_STATUS}
AGNES: ${AGNES_STATUS}
NINE_ROUTER: ${NINE_ROUTER_FOUND}

Searched: ${USER_ENV}, ${SECRETS_ENV}, ${OPENCLAW_ENV}
Not searched: project .env / .env.local (${PROJECT_ENV}, ${PROJECT_ENV_LOCAL}) — a
MISSING above is a statement about the three stores named on the line before it,
plus this process's inherited environment. Shell rc files (.zshrc/.bashrc/
.profile) are NOT read either: a key added to one of those is invisible here
until a new shell exports it, so never point anyone at an rc file to place a key
this sweep is expected to re-detect. ${USER_ENV} IS read live at every run, which
is what makes "put it there, then tell me, and I'll look again" work without a
session restart.
OPENROUTER names searched: OPENROUTER_API_KEY, OPENROUTER_KEY, OPENROUTER_TOKEN.
KIE names searched: KIE_API_KEY, KIE_AI_API_KEY, KIE_KEY.
AGNES names searched: AGNES_AI_API_KEY, AGNES_API_KEY, AGNES_KEY.
AGNES is PRESENCE-ONLY: no cheap authenticated liveness endpoint is documented
for it, so this sweep never reports LIVE for Agnes — FOUND means the NAME
resolved, and nothing more is claimed. KIE liveness, when tested, is GET
api.kie.ai/api/v1/chat/credit; the credit BALANCE is never read or printed here
— that figure is capacity, and it belongs to the burn table, not to a
credential sweep.
FOUND_NOT_VERIFIED = the name resolved but liveness was NOT tested (network
suppressed, curl absent, or the request failed) — never a claim about the
account. OPENROUTER liveness, when tested, is GET openrouter.ai/api/v1/key, not
/v1/models: the models endpoint answers 200 with no key at all and so cannot
tell a live key from a revoked one.
Statuses report NAMES ONLY. No secret value is ever printed; prove it with
--selftest.
REPORT

exit 0
