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
# a known-positive control, a known-negative control, and a leak proof that
# plants a sentinel value in every checked variable and requires the sentinel
# to appear ZERO times in the output. A detector whose known-positive comes
# back MISSING reports BROKEN INSTRUMENT — never "clean".
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

# --- Smoke test a GitHub token ---
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
  # Fallback: git ls-remote with token
  if [[ -n "${GITHUB_TOKEN:-}" ]] || [[ -n "${GH_TOKEN:-}" ]]; then
    local token="${GITHUB_TOKEN:-${GH_TOKEN}}"
    if git ls-remote "https://oauth2:${token}@github.com/blackceo/test.git" HEAD &>/dev/null 2>&1; then
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
  # Lightweight: list models (cheapest possible endpoint)
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${key}" \
    "https://api.deepseek.com/v1/models" 2>/dev/null)
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
  # Lightweight: get locations (read-only, cheap)
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${pit}" \
    "https://services.leadconnectorhq.com/locations/" 2>/dev/null)
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
      VERCEL_TOKEN="${sentinel}" \
      GOHIGHLEVEL_API_KEY="${sentinel}" \
      GOHIGHLEVEL_LOCATION_ID="${sentinel}" \
      GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN="${sentinel}" \
      bash "${self}" funnel 2>&1)"
  rc_pos=$?

  # --- Control 2: KNOWN-NEGATIVE. Nothing planted; must report MISSING.
  out_neg="$(env -i \
      HOME="${sandbox}" PATH="${PATH}" TMPDIR="${TMPDIR:-/tmp}" \
      SWEEP_NO_NETWORK=1 \
      bash "${self}" funnel 2>&1)"
  rc_neg=$?

  # --- Check 1: both runs exited clean.
  if [[ "${rc_pos}" -eq 0 && "${rc_neg}" -eq 0 ]]; then
    echo "  [PASS] both control runs exited 0 (positive=${rc_pos} negative=${rc_neg})"
  else
    echo "  [FAIL] a control run did not exit 0 (positive=${rc_pos} negative=${rc_neg})"
    fails=$((fails + 1))
  fi

  # --- Check 2: the known-positive is DETECTED (instrument proof).
  local pos_missing=0 k
  for k in GITHUB DEEPSEEK OLLAMA_CLOUD VERCEL GHL_PIT GHL_LOCATION_ID GHL_FIREBASE; do
    if printf '%s\n' "${out_pos}" | /usr/bin/grep -qE "^${k}: MISSING$"; then
      pos_missing=$((pos_missing + 1))
      echo "  [FAIL] known-positive control: ${k} reported MISSING with a value present"
    fi
  done
  if [[ "${pos_missing}" -eq 0 ]]; then
    echo "  [PASS] known-positive control: all 7 planted credentials detected"
  else
    echo "  [BROKEN INSTRUMENT] ${pos_missing} planted credential(s) read as MISSING — this sweep cannot be trusted to report a zero"
    fails=$((fails + 1))
  fi

  # --- Check 3: the known-negative is ABSENT (the detector discriminates).
  local neg_found=0
  for k in GITHUB DEEPSEEK OLLAMA_CLOUD VERCEL GHL_PIT GHL_LOCATION_ID GHL_FIREBASE; do
    if ! printf '%s\n' "${out_neg}" | /usr/bin/grep -qE "^${k}: MISSING$"; then
      neg_found=$((neg_found + 1))
      echo "  [FAIL] known-negative control: ${k} did not report MISSING in an empty environment"
    fi
  done
  if [[ "${neg_found}" -eq 0 ]]; then
    echo "  [PASS] known-negative control: all 7 report MISSING in an empty environment"
  else
    echo "  [BROKEN INSTRUMENT] the sweep does not discriminate — positive and negative read alike"
    fails=$((fails + 1))
  fi

  # --- Check 4: THE LEAK PROOF. The sentinel value must appear ZERO times.
  local leaks
  leaks="$(printf '%s\n' "${out_pos}" | /usr/bin/grep -c "${sentinel}")"
  if [[ "${leaks}" -eq 0 ]]; then
    echo "  [PASS] leak proof: 0 secret values printed (sentinel occurrences: 0)"
  else
    echo "  [FAIL] leak proof: the sweep printed the secret VALUE ${leaks} time(s)"
    fails=$((fails + 1))
  fi

  # --- Check 5: the report shape is intact (all 8 keys present).
  local keys_found
  keys_found="$(printf '%s\n' "${out_pos}" | /usr/bin/grep -cE '^(GITHUB|DEEPSEEK|OLLAMA_CLOUD|VERCEL|GHL_PIT|GHL_LOCATION_ID|GHL_FIREBASE|NINE_ROUTER): ')"
  if [[ "${keys_found}" -eq 8 ]]; then
    echo "  [PASS] report shape: all 8 report lines present"
  else
    echo "  [FAIL] report shape: expected 8 report lines, found ${keys_found}"
    fails=$((fails + 1))
  fi

  rm -rf "${sandbox}"
  echo
  if [[ "${fails}" -eq 0 ]]; then
    echo "SELFTEST: PASS (5/5) — instrument proven, 0 secret values printed"
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

# Phase 5: Check Vercel
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

# Phase 6: Check GHL (only for funnel/website targets)
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

# Phase 7: Check 9Router presence (for Claude-Nine detection)
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

# Phase 8: Output results as plain text
cat <<REPORT

ENVIRONMENT SWEEP — $(date '+%Y-%m-%d %H:%M:%S')
Target: ${TARGET_TYPE}

GITHUB: ${GITHUB_STATUS}
DEEPSEEK: ${DEEPSEEK_STATUS}
OLLAMA_CLOUD: ${OLLAMA_STATUS}
VERCEL: ${VERCEL_STATUS}
GHL_PIT: ${GHL_PIT_STATUS}
GHL_LOCATION_ID: ${GHL_LOCATION_STATUS}
GHL_FIREBASE: ${GHL_FIREBASE_STATUS}
NINE_ROUTER: ${NINE_ROUTER_FOUND}

Searched: ${SECRETS_ENV}, ${OPENCLAW_ENV}
Not searched: project .env / .env.local (${PROJECT_ENV}, ${PROJECT_ENV_LOCAL}) — a
MISSING above is a statement about the two stores named on the line before it.
Statuses report NAMES ONLY. No secret value is ever printed; prove it with
--selftest.
REPORT

exit 0
