#!/usr/bin/env bash
# install-node.sh — install a user-local latest-LTS Node.js from the official
# Node.js distribution when the existing node/npm are missing or below minimum.
# Idempotent. Verifies SHA256 before extraction. Never uses Homebrew.
#
# Contract: on success, prints the ABSOLUTE path to a proven-working node
# binary on stdout (and ONLY that — all logging goes to stderr via log()).
# Callers must use that absolute path directly rather than relying on any
# PATH export made in here: this script normally runs as a separate child
# process of its caller, so a bare `export PATH=...` made here never survives
# past this process exiting. The caller is responsible for re-exporting PATH
# (in ITS OWN process) from the returned path if later steps need `node` to
# resolve via bare PATH lookup (e.g. a spawned binary's own shebang).
set -euo pipefail

MIN_NODE=20
MIN_NPM=10
REPO_NODE_DIR="${REPO_NODE_DIR:-$HOME/.local/share/999/node}"

log() { printf '[install-node] %s\n' "$*" >&2; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v
  v="$(node --version 2>/dev/null | sed 's/^v//')" || return 1
  local major
  major="${v%%.*}"
  [ "$major" -ge "$MIN_NODE" ] || return 1
  command -v npm >/dev/null 2>&1 || return 1
  local nv
  nv="$(npm --version 2>/dev/null)" || return 1
  local nmajor
  nmajor="${nv%%.*}"
  [ "$nmajor" -ge "$MIN_NPM" ] || return 1
  return 0
}

ensure_arm64() {
  local arch
  arch="$(uname -m)"
  if [ "$arch" != "arm64" ]; then
    echo "UNSUPPORTED: this Mac is $arch. This setup requires Apple Silicon (arm64)." >&2
    exit 1
  fi
}

main() {
  ensure_arm64

  if node_ok; then
    local existing
    existing="$(command -v node)"
    log "existing Node $(node --version) / npm $(npm --version) satisfies minimums; leaving it alone."
    printf '%s' "$existing"
    return 0
  fi

  log "Node/npm below minimum or missing; installing user-local latest-LTS."

  # If a repo-managed runtime already exists, reuse/update it.
  if [ -x "$REPO_NODE_DIR/current/bin/node" ] && node_ok2 "$REPO_NODE_DIR/current"; then
    log "repo-managed runtime already current."
    printf '%s' "$REPO_NODE_DIR/current/bin/node"
    return 0
  fi

  # Determine newest LTS dynamically from index.tab (first row with lts != '-').
  # NOTE: no `exit` inside the awk action — index.tab has hundreds of rows,
  # and an early `exit` closes awk's stdin while `printf` (the pipe's left
  # side) is still writing the rest of the in-memory $idx string. Under
  # `set -o pipefail` that SIGPIPEs printf (exit 141) and aborts the whole
  # script under `set -e` — a real, previously-latent failure on this exact
  # code path, confirmed by actually exercising it (missing-Node install).
  local idx version
  idx="$(curl -fsSL https://nodejs.org/dist/index.tab)" || { echo "Cannot reach nodejs.org"; exit 1; }
  version="$(printf '%s\n' "$idx" | awk -F'\t' 'NR>1 && $10 != "-" && !f { print $1; f=1 }')"
  if [ -z "$version" ]; then
    echo "Cannot determine the current LTS version from nodejs.org." >&2
    exit 1
  fi
  log "latest LTS: $version"

  local base="https://nodejs.org/dist/$version"
  local file="node-$version-darwin-arm64.tar.gz"
  local dir="$REPO_NODE_DIR/$version"
  local tarball="$HOME/.cache/999-node-$file"
  local sums="$HOME/.cache/999-SHASUMS256.txt"

  mkdir -p "$HOME/.cache" "$REPO_NODE_DIR"

  curl -fsSL "$base/$file" -o "$tarball"
  curl -fsSL "$base/SHASUMS256.txt" -o "$sums"

  # Verify SHA256 against the official SHASUMS256.txt (never against the download
  # itself — comparing shasum output to the local file is a false positive).
  # No `| head -1`: same early-exit-under-pipefail hazard as the LTS lookup
  # above — take the first match inside awk itself instead of relying on a
  # downstream consumer to close the pipe early.
  local expected actual
  expected="$(awk -v f="$file" '$2 == f && !p { print $1; p=1 }' "$sums")"
  if [ -z "$expected" ]; then
    rm -f "$tarball" "$sums"
    echo "NODE CHECKSUM: $file not found in official SHASUMS256.txt; download deleted." >&2
    exit 1
  fi
  actual="$(shasum -a 256 "$tarball" | awk '{ print $1 }')"
  if [ "$actual" != "$expected" ]; then
    rm -f "$tarball" "$sums"
    echo "NODE CHECKSUM MISMATCH: expected $expected, got $actual; download deleted; nothing extracted." >&2
    exit 1
  fi
  log "SHA256 verified ($expected)."

  mkdir -p "$dir"
  tar -xzf "$tarball" -C "$dir" --strip-components=1
  rm -f "$tarball" "$sums"

  # Repoint the current symlink.
  rm -f "$REPO_NODE_DIR/current"
  ln -s "$dir" "$REPO_NODE_DIR/current"

  # Prepend repo-managed bin to THIS process PATH for the orchestrator's remainder.
  export PATH="$REPO_NODE_DIR/current/bin:$PATH"

  if ! node_ok; then
    echo "Repo-managed Node install did not produce a working node on PATH." >&2
    exit 1
  fi
  log "installed Node $(node --version) / npm $(npm --version) at $REPO_NODE_DIR/current"
  printf '%s' "$REPO_NODE_DIR/current/bin/node"
}

# Check a specific prefix's node, not the PATH one.
node_ok2() {
  local prefix="$1"
  [ -x "$prefix/bin/node" ] || return 1
  local v major nv nmajor
  v="$("$prefix/bin/node" --version 2>/dev/null | sed 's/^v//')" || return 1
  major="${v%%.*}"
  [ "$major" -ge "$MIN_NODE" ] || return 1
  nv="$("$prefix/bin/npm" --version 2>/dev/null)" || return 1
  nmajor="${nv%%.*}"
  [ "$nmajor" -ge "$MIN_NPM" ] || return 1
  return 0
}

main "$@"
