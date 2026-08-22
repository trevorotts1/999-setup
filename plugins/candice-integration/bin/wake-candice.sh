#!/usr/bin/env bash
# wake-candice.sh — legacy POSIX wrapper for the Node dispatcher.
#
# Current packages register wake-candice.mjs directly, so native Windows hosts
# do not depend on Bash, WSL, or Git Bash. This retained wrapper only keeps an
# older package invocation fail-soft while it delegates to the same dispatcher.
#
# Current bounded contract: a legacy positional slash-command is translated to
# the Node dispatcher's explicit --command form. This wrapper never accepts or
# forwards a session or host identity; authenticated session activation belongs
# to the MCP bridge and must be acknowledged by its bounded local protocol.
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
case "${1-}" in
  /spec-protocol|/kaizen|/eli5|/bro)
    # Older package registrations invoked `wake-candice.sh /bro` directly.
    # Preserve that wire shape while the current native registration calls
    # wake-candice.mjs --command /bro.
    exec node "$SCRIPT_DIR/wake-candice.mjs" --command "$1" || exit 0
    ;;
  *)
    exec node "$SCRIPT_DIR/wake-candice.mjs" "$@" || exit 0
    ;;
esac
