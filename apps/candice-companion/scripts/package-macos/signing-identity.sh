#!/usr/bin/env bash
# WS-23 — macOS Developer ID signing-identity probe (read-only).
#
# Owned lane: apps/candice-companion/scripts/package-macos/** (PROJECT-MANIFEST 9.2,
# WR-015 row, WS-23 glob). Pure detection — never writes, never prompts,
# never invents credentials (Master Spec 0.3/23: report the blocker, do not
# weaken security).
#
# Exit codes:
#   0  identity found -> prints "FOUND <sha256> <CN>" (one line, machine-parseable)
#   1  none found     -> prints diagnostic lines to stderr
#   2  tooling error  -> security(1) unavailable or not a macOS host

set -u

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "signing-identity: not a macOS host ($(uname -s)) — macOS signing is not applicable here" >&2
  exit 2
fi

if ! command -v security >/dev/null 2>&1; then
  echo "signing-identity: security(1) not found — cannot probe the keychain" >&2
  exit 2
fi

out=$(security find-identity -v -p codesigning 2>&1) || true

if ! printf '%s\n' "$out" | grep -q "valid identities found"; then
  echo "signing-identity: security(1) output unreadable — cannot enumerate identities" >&2
  printf '%s\n' "$out" >&2
  exit 2
fi

# The count line reads "N valid identities found" — a valid Developer ID
# Application certificate appears there. Anything non-zero is a real finding.
# Defaulted to 0 so an absent count line cannot crash the probe under set -u.
count=$(printf '%s\n' "$out" | sed -n 's/^ *\([0-9][0-9]*\) valid identities found.*/\1/p')
count=${count:-0}
if [[ "$count" == "0" ]]; then
  echo "signing-identity: no Developer ID identity in the login keychain (find-identity -p codesigning = $count)" >&2
  exit 1
fi

line=$(printf '%s\n' "$out" | grep 'Developer ID Application' | head -n 1)
if [[ -z "$line" ]]; then
  echo "signing-identity: $count identities found but none is a Developer ID Application certificate" >&2
  printf '%s\n' "$out" >&2
  exit 1
fi

# Real security(1) line shape (QC-FIX WS-23 2026-08-21, verified live):
#   1) ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789 "Developer ID Application: X (TEAM)"
# $1 is the "1)" index, NOT the hash — the SHA-256 is the space-delimited
# 64-hex field. Match it by shape, and take the CN as the quoted field.
sha=$(printf '%s\n' "$line" | sed -n 's/.* \([0-9A-Fa-f]\{64\}\) .*/\1/p')
cn=$(printf '%s\n' "$line" | sed -n 's/.*"\([^"]*\)".*/\1/p')
if [[ -z "$sha" || -z "$cn" ]]; then
  echo "signing-identity: Developer ID line found but unparseable: $line" >&2
  exit 2
fi
echo "FOUND $sha $cn"
exit 0
