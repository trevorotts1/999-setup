#!/usr/bin/env bash
# install-nine-router.sh — install/update 9Router into a user-local npm prefix on
# macOS, without sudo. Resolves the exact binary path. Idempotent.
#
# Contract: on success, prints the ABSOLUTE path to a 9router binary that has
# been PROVEN to execute (real `--version` run, not just a file-exists check)
# on stdout only. All logging goes to stderr.
set -euo pipefail

NPM_PREFIX="${NINE_ROUTER_NPM_PREFIX:-$HOME/.local/share/999/npm}"
BIN="$NPM_PREFIX/bin/9router"
LOG_DIR="$HOME/Library/Logs/BlackCEO-999"

log() { printf '[install-nine-router] %s\n' "$*" >&2; }

main() {
  # 9Router needs Node 20+ and npm 10+ — the orchestrator guarantees this before
  # calling us (and re-verifies with an absolute path, not bare PATH), but a
  # real-execution double-check here costs nothing.
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "node/npm not available on PATH; run install-node.sh first (or the caller failed to export its resolved PATH)." >&2
    exit 1
  fi
  if ! node --version >/dev/null 2>&1 || ! npm --version >/dev/null 2>&1; then
    echo "node/npm are on PATH but do not execute; the caller's dependency preflight should have caught this." >&2
    exit 1
  fi

  mkdir -p "$NPM_PREFIX" "$LOG_DIR"

  # Prove npm can actually reach the registry before attempting the install —
  # a registry-unreachable failure buried inside `npm install -g` output is a
  # confusing way to learn there is no network.
  if ! npm ping --registry https://registry.npmjs.org/ >/dev/null 2>&1; then
    echo "npm cannot reach the npm registry (https://registry.npmjs.org/); check network connectivity, then re-run." >&2
    exit 1
  fi

  log "installing 9router@latest into $NPM_PREFIX"
  # >&2: npm's own install summary ("added N packages in Xs") prints to
  # stdout by default. This script's stdout contract is EXACTLY ONE thing —
  # the final resolved binary path — so npm's chatter must never land there;
  # redirect it to our stderr instead (still visible to the user, never
  # captured by the caller). Windows' Install-NineRouter.ps1 already does the
  # PowerShell equivalent of this via `| Out-Host`; this brings macOS to
  # parity with a real, previously-uncaught asymmetry between the two.
  if npm install -g --prefix "$NPM_PREFIX" 9router@latest >&2; then
    log "9router installed."
  else
    # A retry can help with transient registry hiccups.
    log "first install attempt failed; retrying once."
    npm install -g --prefix "$NPM_PREFIX" 9router@latest >&2
  fi

  if [ ! -x "$BIN" ]; then
    echo "Expected 9router binary not found at $BIN" >&2
    exit 1
  fi

  log "9router binary: $BIN"
  # Real-execution proof, never silently skipped: a binary that exists on disk
  # but does not run is not "installed" in any sense that matters downstream.
  local ver rc
  ver="$("$BIN" --version 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "9router installed at $BIN but '$BIN --version' failed (exit $rc): $ver" >&2
    exit 1
  fi
  log "9router version: $ver"
  printf '%s' "$BIN"
}

main "$@"
