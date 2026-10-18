#!/bin/bash
# WER-021 companion (999 side): Windows desktop launcher simulation tests.
# The simulation runs the production Windows launcher module on this host;
# native Windows execution is deferred to WER-027 and is not claimed here.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node "$REPO/launchers/tests/windows-launcher-simulation.mjs"
rc=$?
exit "$rc"
