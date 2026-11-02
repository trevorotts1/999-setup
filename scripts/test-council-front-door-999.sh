#!/bin/bash
# CTR-195 regression contract: the 999 install path activates the Council
# front door and chamber on a claude-nine-only host, and it does NOT install
# the OpenClaw interceptor package there.
#
# CREATED, NOT RUN in the CTR-195 lane (the lane was barred from test suites).
# Run it manually:
#   bash scripts/test-council-front-door-999.sh
#
# It is offline, reads repo files only and writes nothing. It locks:
#   1. `council-runtime-install.sh --activate` calls the 999 activation step.
#   2. The activation step installs the durable front door + chamber helper,
#      writes `council-ask`, and starts the 999 service on the box's own
#      service.json/port.
#   3. An OpenClaw host is handed to the skill's official wire.sh; the 999
#      path never copies the plugin package or writes openclaw.json itself.
#   4. No operator chamber host or operator model is hardcoded.
#   5. AGENT_INSTALL documents the activation step.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
INSTALLER="$ROOT/scripts/council-runtime-install.sh"
ACTIVATE="$ROOT/scripts/council-activate-999.sh"
AGENT="$ROOT/AGENT_INSTALL.md"
LAUNCHER="$ROOT/launchers/macos/blackceo-council"
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok: %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL: %s\n' "$1"; }
has() { grep -qF -- "$2" "$1"; }

for f in "$INSTALLER" "$ACTIVATE" "$AGENT" "$LAUNCHER"; do
  [ -f "$f" ] && ok "present: ${f#$ROOT/}" || bad "missing: ${f#$ROOT/}"
done

has "$INSTALLER" "--activate" && ok "installer exposes --activate" || bad "installer has no --activate"
has "$INSTALLER" "council-activate-999.sh" && ok "installer calls the 999 activation step" || bad "installer does not call the 999 activation step"

has "$ACTIVATE" "install-front-door.sh" && ok "activation installs the durable front door" || bad "activation does not use install-front-door.sh"
has "$ACTIVATE" "council-ask" && ok "activation writes the council-ask front door" || bad "activation never writes council-ask"
has "$ACTIVATE" "service-launch.mjs" && ok "activation launches the canonical Council service" || bad "activation does not launch service-launch.mjs"
has "$ACTIVATE" "service.json" && ok "activation records the box's own service.json" || bad "activation does not record service.json"
has "$ACTIVATE" "chamber" && ok "activation carries the chamber protocol" || bad "activation never names the chamber"

# On an OpenClaw host the one official wiring owns the service and plugin.
has "$ACTIVATE" "command -v openclaw" && ok "activation detects the OpenClaw CLI" || bad "activation does not detect OpenClaw"
has "$ACTIVATE" "wire.sh" && ok "activation defers to the official wire.sh" || bad "activation does not use wire.sh"
if has "$ACTIVATE" "install-council-plugin.mjs" || has "$ACTIVATE" "plugins.entries"; then
  bad "activation installs the OpenClaw plugin instead of deferring"
else
  ok "activation never installs the OpenClaw plugin on a sole CLI host"
fi

# One front door, one chamber, resolved from the box; never an operator host.
if grep -Eq 'trevor|blackceo\.com|zerohumanworkforce' "$ACTIVATE"; then
  bad "activation hardcodes an operator identity or host"
else
  ok "activation hardcodes no operator identity or chamber host"
fi
has "$ACTIVATE" "COUNCIL_PUBLIC_ORIGIN" && ok "public origin is box-configurable" || bad "public origin is not configurable"

has "$AGENT" "--activate" && ok "AGENT_INSTALL documents --activate" || bad "AGENT_INSTALL does not document --activate"
has "$AGENT" "COUNCIL_999_FRONT_DOOR" && ok "AGENT_INSTALL documents the activation result line" || bad "AGENT_INSTALL hides the activation result"
has "$LAUNCHER" "blackceo-council.env" && ok "CLI launcher reads the box's front-door env" || bad "CLI launcher ignores the front-door env"

printf '\nRESULT: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
