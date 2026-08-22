#!/usr/bin/env bash
# wake-candice.sh — legacy POSIX wrapper for the Node dispatcher.
#
# Current packages register wake-candice.mjs directly, so native Windows hosts
# do not depend on Bash, WSL, or Git Bash. This retained wrapper only keeps an
# older package invocation fail-soft while it delegates to the same dispatcher.
#
# Current bounded contract (FIX-009): make a detached visual wake request
# only. This wrapper does not receive or forward a session identifier, bind to
# a terminal host, or raise an existing app instance. FIX-011 must provide an
# authenticated session/host boundary before any of those capabilities exist.
# FIX-009-CAPABILITIES-BEGIN
# session-binding=false
# terminal-host-binding=false
# bridge-delivery=false
# answer-routing=false
# existing-instance-routing=false
# FIX-009-CAPABILITIES-END
#
set -u

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || exit 0
exec node "$SCRIPT_DIR/wake-candice.mjs" "$@" || exit 0
