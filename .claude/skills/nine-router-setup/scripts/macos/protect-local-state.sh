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
  # -U updates in place; never creates a duplicate.
  if security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" \
       -w "$token" -U -T "" "$STATE_DIR" >/dev/null 2>&1; then
    log "Keychain item updated in place."
  else
    log "Keychain add/update via security returned non-zero."
    # Retry with an explicit update path.
    security add-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" \
         -w "$token" -U -T "" "$STATE_DIR"
  fi
  # Drop the token from the environment immediately.
  unset token
}

# Usage: protect-local-state.sh get-token
#   Prints the token to stdout — used by the launcher ONLY. Caller must not echo it.
get_token() {
  security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null
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
