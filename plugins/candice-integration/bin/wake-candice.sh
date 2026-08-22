#!/usr/bin/env bash
# wake-candice.sh — Candice immediate wake-up handler (WS-02).
#
# Registered from hooks/hooks.json on UserPromptExpansion (matchers:
# spec-protocol, kaizen, eli5, bro) and on SessionStart. Invoked with one
# argument: the triggering slash command ("/spec-protocol", "/kaizen",
# "/eli5", "/bro") or "session-start".
#
# Contract (Master Spec section 13.1): be fast, launch/raise the app, bind
# to the current Claude session identifier where available, bind to the
# foreground command-window/terminal host, and never block skill execution
# if Candice fails. Hook runs async (hooks.json "async": true): a nonzero
# exit or a slow start must never block or delay Claude Code.
#
# The companion binary is intentionally not a hard dependency of this
# workstream. The launch command is resolved from the plugin environment;
# when the app is not installed yet (fresh repo, pre-install), the handler
# exits 0 silently so the skill proceeds normally and the bootstrap install
# (WS-31) provisions the app.
#
# Master Spec sections 13/13.1: do NOT rename the slash commands; do NOT
# inject hidden prompts; never message anyone; no secret values are read,
# printed, or logged by this script.

set -u

COMMAND="${1:-session-start}"

# Hook input arrives as JSON on stdin; ignore it. Drain stdin so the runner
# does not wait on EOF before continuing.
cat >/dev/null 2>&1 || true

# Launch command resolution order (1 = explicit env, 2 = PATH shims, 3 = skip).
LAUNCH_CMD=""
if [ -n "${CANDICE_COMPANION_CMD:-}" ]; then
  LAUNCH_CMD="$CANDICE_COMPANION_CMD"
elif command -v candice-companion >/dev/null 2>&1; then
  LAUNCH_CMD="$(command -v candice-companion)"
fi

if [ -z "$LAUNCH_CMD" ]; then
  exit 0
fi

# Launch detached. Output is discarded: nothing from Candice wake-up is ever
# attached to Claude's context, so a chatty companion cannot pollute the
# session. `--wake` is currently only a validated native wake request; it is
# NOT a session binding and does not make the MCP bridge available. FIX-011
# must add authenticated same-session bridge delivery before this hook may
# claim anything stronger.
"$LAUNCH_CMD" --wake "$COMMAND" >/dev/null 2>&1 &

exit 0
