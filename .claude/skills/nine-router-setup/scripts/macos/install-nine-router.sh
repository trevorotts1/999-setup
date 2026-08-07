#!/usr/bin/env bash
# install-nine-router.sh — install/update 9Router into a user-local npm prefix on
# macOS, without sudo. Resolves the exact binary path. Idempotent.
set -euo pipefail

NPM_PREFIX="$HOME/.local/share/999/npm"
BIN="$NPM_PREFIX/bin/9router"
LOG_DIR="$HOME/Library/Logs/BlackCEO-999"

log() { printf '[install-nine-router] %s\n' "$*" >&2; }

main() {
  # 9Router needs Node 20+ and npm 10+ — the orchestrator guarantees this before
  # calling us, but double-check.
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "node/npm not available; run install-node.sh first." >&2
    exit 1
  fi

  mkdir -p "$NPM_PREFIX" "$LOG_DIR"

  log "installing 9router@latest into $NPM_PREFIX"
  if npm install -g --prefix "$NPM_PREFIX" 9router@latest; then
    log "9router installed."
  else
    # A retry can help with transient registry hiccups.
    log "first install attempt failed; retrying once."
    npm install -g --prefix "$NPM_PREFIX" 9router@latest
  fi

  if [ ! -x "$BIN" ]; then
    echo "Expected 9router binary not found at $BIN" >&2
    exit 1
  fi

  log "9router binary: $BIN"
  # Print version only (safe).
  "$BIN" --version 2>/dev/null || log "version check skipped"
  printf '%s' "$BIN"
}

main "$@"
