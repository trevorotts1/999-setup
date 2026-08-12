#!/usr/bin/env bash
# check-update.sh — does this box have the latest spec-protocol?
#
# WHY THIS EXISTS. Before this file, a box had no way to answer that question.
# The skill carried no version marker of any kind, so "am I current?" could only
# be settled by hashing every file against the repo from the outside. A client
# machine running a stale skill had no way to know, and no way to say so. That
# blind spot is what let old copies of this skill sit undetected on client
# machines for days.
#
# WHY A HASH IS NOT ENOUGH. Hashing an individual tool does not discriminate:
# tools/ledger.sh is byte-identical across versions of this skill. A file that
# did not change between two releases proves nothing about which release you
# have. Version identity has to be stated explicitly, in its own file, or it is
# not knowable.
#
# THE CONTRACT. VERSION at the skill root holds one line: the semver of this
# tree. The same file exists in the repo. Newer version in the repo => update
# available. That is the whole mechanism. Every change to the skill bumps
# VERSION; nothing else is required for a box to notice.
#
# EXIT CODES
#   0  current (or newer than the repo — a local dev tree)
#   1  update available; the report names both versions and the command to take it
#   2  UNDETERMINED — could not read one side. NOT the same as "current".
#      A network failure is not evidence of being up to date.
#
# THE UNDETERMINED RULE IS THE POINT OF THIS SCRIPT. It would be trivial to
# collapse "I could not reach GitHub" into "you look current" and exit 0. That
# is the exact lie this file exists to refuse. A negative result — "no update
# for you" — is a claim, and it carries the same burden of proof as a positive
# one. If either side could not be read, this script says UNDETERMINED and
# names which side failed and why.
#
# Reads only. Writes nothing — no temp files, no config, no state. Safe to run
# on a client box at any time, including mid-workflow.

set -uo pipefail

# Honour an explicit override so the script can be exercised from anywhere
# (self-update.sh re-execs from a temp copy and passes this).
SKILL_DIR="${SPEC_PROTOCOL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)}"
LOCAL_VERSION_FILE="$SKILL_DIR/VERSION"
SELF_UPDATE="$SKILL_DIR/tools/self-update.sh"

# The published VERSION, served as a raw file. Kept on the same branch the
# tarball in self-update.sh is cut from, so the two can never disagree.
REMOTE_URL="${SPEC_PROTOCOL_VERSION_URL:-https://raw.githubusercontent.com/trevorotts1/999-setup/main/.claude/skills/spec-protocol/VERSION}"

say() { printf '%s\n' "$*"; }

# --------------------------------------------------------------- validation
# A version string is digits and dots, nothing else, with no empty field and no
# leading or trailing dot. Anything else is not an answer — it is an error page,
# a redirect body, a login wall, or a corrupted file. Written with `case` rather
# than `[[ =~ ]]` so it behaves identically on the bash 3.2 that ships with
# macOS and on modern bash elsewhere.
is_version() {
  local v="${1:-}"
  case "$v" in
    '')      return 1 ;;
    *[!0-9.]*) return 1 ;;   # any character that is not a digit or a dot
    .*|*.)   return 1 ;;     # leading or trailing dot
    *..*)    return 1 ;;     # empty field, e.g. 1..0
  esac
  # A real version is short. A body this long is a document, not a version.
  [ "${#v}" -le 32 ] || return 1
  return 0
}

# ----------------------------------------------------------------- comparison
# Numeric field-by-field compare. Sorting lexically would rank 1.10.0 BELOW
# 1.9.0 — which is precisely the silent-staleness bug this whole mechanism
# exists to prevent, so it is worth the extra lines to get right.
#
# Compares across the longer of the two field counts, defaulting a missing
# field to 0, so 1.8 and 1.8.0 compare equal and 1.8.1 beats 1.8.
# `10#` forces base-10 so a zero-padded field like 08 is not read as octal.
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

# ------------------------------------------------------------ instrument check
# If curl is missing, we have no instrument. That is UNDETERMINED — it is not a
# fact about whether an update exists. A broken instrument must never be
# reported as a clean reading.
if ! command -v curl >/dev/null 2>&1; then
  say "UNDETERMINED — curl is not available on this box"
  say ""
  say "  Without an HTTP client this script cannot read the published VERSION."
  say "  This says nothing about whether an update exists."
  exit 2
fi

# ---------------------------------------------------------------- local side
if [ ! -f "$LOCAL_VERSION_FILE" ]; then
  say "UNDETERMINED (leaning STALE) — no VERSION file at $LOCAL_VERSION_FILE"
  say ""
  say "  A skill tree with no VERSION predates this mechanism, which means it is"
  say "  almost certainly stale. It is NOT proof of being current — this script"
  say "  cannot name the installed version, so it cannot compare anything."
  say "  Resolve by installing the current skill, which carries a VERSION."
  exit 2
fi

LOCAL_VERSION="$(tr -d ' \t\r\n' < "$LOCAL_VERSION_FILE" 2>/dev/null)"
if [ -z "$LOCAL_VERSION" ]; then
  say "UNDETERMINED — VERSION file is present but empty at $LOCAL_VERSION_FILE"
  say "  A truncated or half-written install. Reinstall the skill."
  exit 2
fi

if ! is_version "$LOCAL_VERSION"; then
  say "UNDETERMINED — installed VERSION is not a version string"
  say "  file:     $LOCAL_VERSION_FILE"
  say "  contains: $(printf '%s' "$LOCAL_VERSION" | cut -c1-40)"
  say ""
  say "  Refusing to compare against a value this script cannot parse."
  exit 2
fi

# --------------------------------------------------------------- remote side
# Deliberately NOT using curl -f. With -f an HTTP error collapses into a single
# generic exit code and the status is lost, so a 404 (the file genuinely is not
# published at that path) reads identically to a dead network. Those are
# different facts and the operator needs to be told which one happened. So:
# take the body and the final status code together, and judge them separately.
#
# --max-filesize caps a hostile or wrong response so a large error document
# cannot be slurped into memory. -L follows redirects; the status captured is
# the FINAL one after following.
HTTP_BODY=""
HTTP_CODE=""
RESPONSE="$(curl -sS -L \
              --proto '=https' \
              --max-time 15 \
              --max-filesize 65536 \
              -w '\n%{http_code}' \
              "$REMOTE_URL" 2>/dev/null)"
CURL_RC=$?

if [ $CURL_RC -eq 0 ]; then
  # Last line is the status code; everything before it is the body.
  HTTP_CODE="$(printf '%s' "$RESPONSE" | tail -n 1)"
  HTTP_BODY="$(printf '%s' "$RESPONSE" | sed '$d')"
fi

# Transport failure: DNS, TLS, timeout, refused, no route. We never reached a
# verdict, so we do not report one.
if [ $CURL_RC -ne 0 ]; then
  say "UNDETERMINED — could not reach the published VERSION (curl rc=$CURL_RC)"
  say "  installed: $LOCAL_VERSION"
  say "  source:    $REMOTE_URL"
  say ""
  say "  This is a TRANSPORT failure — offline, DNS, TLS, proxy, or timeout."
  say "  It is NOT evidence that you are current. Re-run when the network is back."
  exit 2
fi

# Reached the server, but it did not hand us the file.
if [ "$HTTP_CODE" != "200" ]; then
  say "UNDETERMINED — the published VERSION could not be read (HTTP $HTTP_CODE)"
  say "  installed: $LOCAL_VERSION"
  say "  source:    $REMOTE_URL"
  say ""
  case "$HTTP_CODE" in
    404)
      say "  404 means the server answered but no VERSION exists at that path."
      say "  Either this release has not been pushed to the repo yet, or the"
      say "  branch/path moved. The network is fine; the file is not there."
      say "  Until it is published, staleness here is UNKNOWABLE, not absent."
      ;;
    401|403)
      say "  The server refused the request. A private repo, a rate limit, or a"
      say "  proxy sitting in front of it. Not a statement about versions."
      ;;
    5*)
      say "  The server failed. Transient on GitHub's side; re-run shortly."
      ;;
    000)
      say "  No status was returned at all — the connection did not complete."
      ;;
    *)
      say "  Unexpected status. Treating as unreadable rather than guessing."
      ;;
  esac
  exit 2
fi

REMOTE_VERSION="$(printf '%s' "$HTTP_BODY" | tr -d ' \t\r\n')"

# HTTP 200 is not proof the body is a version. A captive portal, a corporate
# proxy interstitial, and a repo's HTML 404 page all return 200 with a document
# in the body. Anything that is not digits-and-dots is not an answer.
if ! is_version "$REMOTE_VERSION"; then
  say "UNDETERMINED — the published VERSION is not a version string (HTTP 200)"
  say "  installed: $LOCAL_VERSION"
  say "  source:    $REMOTE_URL"
  say "  received:  $(printf '%s' "$REMOTE_VERSION" | cut -c1-40)"
  say ""
  say "  A 200 carrying a document rather than a version means something is"
  say "  answering for GitHub — a proxy, a captive portal, or an HTML error"
  say "  page. Refusing to compare against it."
  exit 2
fi

# ------------------------------------------------------------------- verdicts
if newer_than "$REMOTE_VERSION" "$LOCAL_VERSION"; then
  say "UPDATE AVAILABLE  $LOCAL_VERSION -> $REMOTE_VERSION"
  say ""
  if [ -r "$SELF_UPDATE" ]; then
    say "  Take it with:"
    say "    bash \"$SELF_UPDATE\""
    say ""
    say "  That script backs the whole skill tree up first, prints the backup"
    say "  path, verifies the fetched copy is genuinely newer before replacing"
    say "  anything, and restores the backup if any step fails."
  else
    say "  The companion installer is missing at:"
    say "    $SELF_UPDATE"
    say "  Reinstall the skill from the repo, or report this version to whoever"
    say "  maintains this machine."
  fi
  exit 1
fi

if newer_than "$LOCAL_VERSION" "$REMOTE_VERSION"; then
  say "current — installed $LOCAL_VERSION is AHEAD of published $REMOTE_VERSION"
  say "  (a local development tree, or a release that has not been pushed yet)"
  exit 0
fi

say "current — $LOCAL_VERSION"
exit 0
