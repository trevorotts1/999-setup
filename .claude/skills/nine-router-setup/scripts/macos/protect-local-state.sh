#!/usr/bin/env bash
# protect-local-state.sh — store the local 9Router API token in the macOS Keychain
# and write the mode-600 route-state file. Idempotent (no duplicate Keychain items).
set -euo pipefail

STATE_DIR="$HOME/Library/Application Support/BlackCEO/999"
STATE_FILE="$STATE_DIR/router-session.json"
KEYCHAIN_SERVICE="BlackCEO-999"
KEYCHAIN_ACCOUNT="9router-api-token"

log() { printf '[protect-local-state] %s\n' "$*" >&2; }

# Usage: protect-local-state.sh set-token <token>
#   Stores the token in Keychain. Never prints it.
set_token() {
  local token="$1"
  if [ -z "$token" ]; then
    echo "set-token requires a token argument." >&2
    exit 2
  fi
  mkdir -p "$STATE_DIR"
  # No trailing keychain-path argument: `security` then targets the user's
  # default (login) keychain deterministically. Passing a directory here is
  # ambiguous and must not be relied on. -U updates in place; never duplicates.
  if security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" \
       -w "$token" -U -T "" >/dev/null 2>&1; then
    log "Keychain item stored in the default login keychain."
  else
    # Surface the real error this time (no stderr suppression) so the caller
    # gets one precise Keychain blocker instead of a silent failure.
    security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" \
         -w "$token" -U -T ""
  fi
  # Drop the token from the environment immediately.
  unset token
}

# Usage: protect-local-state.sh get-token
#   Prints the token to stdout — used by the launcher ONLY. Caller must not echo it.
#   stderr is captured (never silently suppressed) so a real Keychain error is
#   distinguishable from an absent item: exit 44 is `security`'s own
#   "item not found" code — never treat it as evidence of anything else, and
#   never conflate a genuine access-denial (user clicked Deny / non-interactive
#   session with no consent UI) with a plain "not set up yet".
get_token() {
  local out rc=0
  out="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '%s' "$out"
    return 0
  fi
  if [ "$rc" -eq 44 ]; then
    echo "protect-local-state: Keychain item not found (service $KEYCHAIN_SERVICE, account $KEYCHAIN_ACCOUNT). Re-run /nine-router-setup." >&2
  else
    echo "protect-local-state: Keychain access denied or another error (exit $rc): $out" >&2
  fi
  return "$rc"
}

# Usage: protect-local-state.sh ensure-600
ensure_600() {
  mkdir -p "$STATE_DIR"
  if [ -f "$STATE_FILE" ]; then
    chmod 600 "$STATE_FILE"
  fi
  chmod 700 "$STATE_DIR"
  log "state dir $STATE_DIR mode 700; state file mode 600"
}

case "${1:-}" in
  set-token)
    [ -n "${2:-}" ] || { echo "missing token"; exit 2; }
    set_token "$2"
    ;;
  get-token)
    get_token
    ;;
  ensure-600)
    ensure_600
    ;;
  *)
    echo "usage: protect-local-state.sh {set-token <token>|get-token|ensure-600}" >&2
    exit 2
    ;;
esac
