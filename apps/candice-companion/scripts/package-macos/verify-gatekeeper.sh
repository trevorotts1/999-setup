#!/usr/bin/env bash
# WS-23 — Gatekeeper acceptance verification for a built artifact.
#
# Owned lane: apps/candice-companion/scripts/package-macos/** (PROJECT-MANIFEST 9.2,
# WR-015 row, WS-23 glob). Proves spec 23's "verify Gatekeeper acceptance"
# with the same mechanism Gatekeeper uses (spctl assessment), never by
# disabling or weakening security.

set -u

APP="${1:-dist/Candice Companion.app}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "verify-gatekeeper: not a macOS host ($(uname -s)) — Gatekeeper assessment is not applicable here" >&2
  exit 2
fi
if ! command -v spctl >/dev/null 2>&1; then
  echo "verify-gatekeeper: spctl not found" >&2
  exit 2
fi
if [[ ! -d "$APP" ]]; then
  echo "verify-gatekeeper: $APP not found — run scripts/package-macos/build-macos-bundle.sh prod first" >&2
  exit 1
fi

# Same assessment Gatekeeper performs at launch (spec 23). A missing or
# unsigned bundle yields rc 3 with an explanation; only a notarized
# Developer ID-signed artifact with a valid ticket can pass.
spctl --assess --type execute --verbose=4 "$APP"
