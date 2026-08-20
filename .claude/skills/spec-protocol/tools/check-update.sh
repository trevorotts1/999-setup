#!/usr/bin/env bash
# check-update.sh — are the five bundled skills current?
#
# WHY THIS EXISTS. Before this file, spec-protocol could only check ITSELF.
# The repo bundles five skills — nine-router-setup, spec-protocol, kaizen,
# eli5, bro — and a box with a stale kaizen or a two-week-old eli5 had no way
# to know. This script checks every bundled skill against the published repo in
# one pass, so a stale companion cannot sit undetected beside a current
# spec-protocol.
#
# WHAT IT CHECKS. Each skill carries a VERSION file at its root. The published
# copy lives in the 999-setup repo. This script reads the local one and the
# published one for every skill, compares them field-by-field, and reports the
# worst aggregate outcome.
#
# EXIT CODES (aggregate across all five skills)
#   0  every installed skill is current (or ahead of published)
#   1  at least one skill has an update available — even if others are
#      undetermined. The report names every stale skill and both versions.
#   2  no update available, but at least one skill could not be read. NEVER
#      exit 0 when any skill is undetermined — a check that could not reach its
#      source has proven nothing, and reporting "current" out of a failed
#      instrument is precisely the defect this file exists to stop.
#
# READS ONLY. Writes nothing — no temp files, no config, no state. Safe to run
# on a client box at any time, including mid-workflow.
#
# SELF-UPDATE. This script checks versions. The companion tools/self-update.sh
# installs the update for spec-protocol itself. The other four bundled skills
# refresh by re-running the nine-router-setup installer, which links them from
# the repo checkout.
#
# OVERRIDES (for testing and for self-update.sh's re-exec path)
#   SPEC_PROTOCOL_LOCAL_SKILLS_ROOT   local skills dir (default ~/.claude/skills)
#   SPEC_PROTOCOL_SKILLS_URL_BASE     published VERSION base URL
#   SPEC_PROTOCOL_VERSION_URL         full URL for spec-protocol's VERSION only
#                                     (backward compat — self-update.sh re-execs
#                                     with this set)
#   SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP  set to 1 to allow http://127.0.0.1 /
#                                      localhost (test harness only)

set -uo pipefail

# -------------------------------------------------------------- skill list
# Hardcoded. CONTROL/bundled-skills.txt may not exist on a client box, and the
# list changes only when a skill is added to or removed from the repo — which
# is a release-level event that updates this script anyway.
SKILLS=(nine-router-setup spec-protocol kaizen eli5 bro)

# ------------------------------------------------------- paths and overrides
LOCAL_SKILLS_ROOT="${SPEC_PROTOCOL_LOCAL_SKILLS_ROOT:-$HOME/.claude/skills}"
SKILLS_URL_BASE="${SPEC_PROTOCOL_SKILLS_URL_BASE:-https://raw.githubusercontent.com/trevorotts1/999-setup/main/.claude/skills}"

# Backward compat: SPEC_PROTOCOL_VERSION_URL is the full URL for spec-protocol's
# VERSION. self-update.sh re-execs with this and SPEC_PROTOCOL_DIR set. When
# present it overrides the constructed URL for spec-protocol only.
SPEC_PROTOCOL_URL="${SPEC_PROTOCOL_VERSION_URL:-}"

# Second config root. self-update.sh handles the dual-root case on install;
# this script mirrors it on the read side. When .claude-nine has its own
# .claude.json it is a genuinely separate config root, and its skills may be
# at a different version.
NINE_SKILLS_ROOT="$HOME/.claude-nine/skills"
HAS_NINE_ROOT=0
[ -f "$HOME/.claude-nine/.claude.json" ] && HAS_NINE_ROOT=1

SELF_UPDATE=""

say() { printf '%s\n' "$*"; }

# ---------------------------------------------------------- version helpers
# These two functions are carried forward VERBATIM from the original
# single-skill check-update.sh. They are bash-3.2-safe and the 10# base-10
# handling in newer_than prevents octal interpretation of zero-padded fields
# like 08.

is_version() {
  local v="${1:-}"
  case "$v" in
    '')      return 1 ;;
    *[!0-9.]*) return 1 ;;
    .*|*.)   return 1 ;;
    *..*)    return 1 ;;
  esac
  [ "${#v}" -le 32 ] || return 1
  return 0
}

newer_than() {
  local a="${1:-0}" b="${2:-0}" i n ai bi
  local -a A B
  IFS='.' read -r -a A <<< "$a"
  IFS='.' read -r -a B <<< "$b"
  n=${#A[@]}
  if [ "${#B[@]}" -gt "$n" ]; then n=${#B[@]}; fi
  i=0
  while [ "$i" -lt "$n" ]; do
    ai=$(( 10#${A[$i]:-0} ))
    bi=$(( 10#${B[$i]:-0} ))
    if [ "$ai" -gt "$bi" ]; then return 0; fi
    if [ "$ai" -lt "$bi" ]; then return 1; fi
    i=$(( i + 1 ))
  done
  return 1
}

# --------------------------------------------------------- instrument check
if ! command -v curl >/dev/null 2>&1; then
  say "UNDETERMINED — curl is not available on this box"
  say ""
  say "  Without an HTTP client this script cannot read the published VERSIONs."
  say "  This says nothing about whether an update exists."
  exit 2
fi

# -------------------------------------------------- remote URL for one skill
remote_url() {
  local skill="$1"
  if [ "$skill" = "spec-protocol" ] && [ -n "$SPEC_PROTOCOL_URL" ]; then
    printf '%s' "$SPEC_PROTOCOL_URL"
    return
  fi
  printf '%s/%s/VERSION' "$SKILLS_URL_BASE" "$skill"
}

# ---------------------------------------------------- check one skill+root pair
# Returns via globals: CHK_STATUS and CHK_MSG.
# CHK_STATUS is one of: current, ahead, update, undetermined.
check_one_skill() {
  local skill="$1"
  local local_file="$LOCAL_SKILLS_ROOT/$skill/VERSION"
  local local_ver="" nine_ver="" remote_ver=""
  local nine_file="$NINE_SKILLS_ROOT/$skill/VERSION"
  local nine_note=""

  # --- local side: primary root ---
  if [ ! -f "$local_file" ]; then
    CHK_STATUS="undetermined"
    CHK_MSG="UNDETERMINED $skill — no VERSION at $local_file"
    return
  fi
  local_ver="$(tr -d ' \t\r\n' < "$local_file" 2>/dev/null)"
  if [ -z "$local_ver" ]; then
    CHK_STATUS="undetermined"
    CHK_MSG="UNDETERMINED $skill — VERSION file empty at $local_file"
    return
  fi
  if ! is_version "$local_ver"; then
    CHK_STATUS="undetermined"
    CHK_MSG="UNDETERMINED $skill — installed VERSION is not a version string at $local_file: $(printf '%s' "$local_ver" | cut -c1-40)"
    return
  fi

  # --- local side: second root, when separate and differs ---
  nine_note=""
  if [ "$HAS_NINE_ROOT" -eq 1 ] && [ -f "$nine_file" ]; then
    nine_ver="$(tr -d ' \t\r\n' < "$nine_file" 2>/dev/null)"
    if [ -n "$nine_ver" ] && is_version "$nine_ver" && [ "$nine_ver" != "$local_ver" ]; then
      nine_note="  (also in ~/.claude-nine/skills: $nine_ver)"
    fi
  fi

  # --- remote side ---
  local url
  url="$(remote_url "$skill")"

  # Loopback guard: http:// is only permitted when explicitly opted in AND the
  # host is 127.0.0.1 or localhost. Any other http:// URL gets the proto guard
  # and curl will refuse it — which is the correct behaviour for a production
  # run where someone fat-fingered the override.
  local curl_opts=(-sS -L --max-time 15 --max-filesize 65536 -w '\n%{http_code}')
  case "$url" in
    https://*)
      curl_opts+=(--proto '=https')
      ;;
    http://127.0.0.1[:/]*|http://localhost[:/]*)
      if [ "${SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP:-0}" != "1" ]; then
        CHK_STATUS="undetermined"
        CHK_MSG="UNDETERMINED $skill — http:// loopback without SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP=1 (installed: $local_ver)$nine_note"
        return
      fi
      ;;
    http://*)
      curl_opts+=(--proto '=https')
      ;;
  esac

  local http_body="" http_code="" response="" curl_rc
  response="$(curl "${curl_opts[@]}" "$url" 2>/dev/null)"
  curl_rc=$?

  if [ $curl_rc -ne 0 ]; then
    CHK_STATUS="undetermined"
    CHK_MSG="UNDETERMINED $skill — could not reach published VERSION (curl rc=$curl_rc)  installed: $local_ver$nine_note"
    return
  fi

  http_code="$(printf '%s' "$response" | tail -n 1)"
  http_body="$(printf '%s' "$response" | sed '$d')"

  if [ "$http_code" != "200" ]; then
    CHK_STATUS="undetermined"
    CHK_MSG="UNDETERMINED $skill — published VERSION unreadable (HTTP $http_code)  installed: $local_ver$nine_note"
    return
  fi

  remote_ver="$(printf '%s' "$http_body" | tr -d ' \t\r\n')"
  if ! is_version "$remote_ver"; then
    CHK_STATUS="undetermined"
    CHK_MSG="UNDETERMINED $skill — published VERSION is not a version string (HTTP 200)  installed: $local_ver  received: $(printf '%s' "$remote_ver" | cut -c1-40)$nine_note"
    return
  fi

  # --- verdict ---
  if newer_than "$remote_ver" "$local_ver"; then
    CHK_STATUS="update"
    CHK_MSG="UPDATE AVAILABLE $skill  $local_ver -> $remote_ver$nine_note"
    return
  fi

  if newer_than "$local_ver" "$remote_ver"; then
    CHK_STATUS="ahead"
    CHK_MSG="current — $skill $local_ver (ahead of published $remote_ver)$nine_note"
    return
  fi

  CHK_STATUS="current"
  CHK_MSG="current — $skill $local_ver$nine_note"
}

# --------------------------------------------------------------------- main
UPDATE_COUNT=0
UNDETERMINED_COUNT=0
CURRENT_COUNT=0
SPEC_UPDATE=0

for skill in "${SKILLS[@]}"; do
  check_one_skill "$skill"
  say "$CHK_MSG"
  case "$CHK_STATUS" in
    current|ahead) CURRENT_COUNT=$((CURRENT_COUNT + 1)) ;;
    update)
      UPDATE_COUNT=$((UPDATE_COUNT + 1))
      [ "$skill" = "spec-protocol" ] && SPEC_UPDATE=1
      ;;
    undetermined) UNDETERMINED_COUNT=$((UNDETERMINED_COUNT + 1)) ;;
  esac
done

# --- self-update pointer (spec-protocol only) ---
if [ "$SPEC_UPDATE" -eq 1 ]; then
  SKILL_DIR="${SPEC_PROTOCOL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)}"
  SELF_UPDATE="$SKILL_DIR/tools/self-update.sh"
  say ""
  if [ -r "$SELF_UPDATE" ]; then
    say "To update spec-protocol itself:"
    say "  bash \"$SELF_UPDATE\""
    say ""
    say "The other bundled skills refresh by re-running the nine-router-setup"
    say "installer from the repo checkout."
  else
    say "The companion installer is missing at: $SELF_UPDATE"
    say "Reinstall spec-protocol from the repo."
  fi
fi

# --- aggregate exit code ---
if [ "$UPDATE_COUNT" -gt 0 ]; then
  exit 1
fi
if [ "$UNDETERMINED_COUNT" -gt 0 ]; then
  exit 2
fi
exit 0