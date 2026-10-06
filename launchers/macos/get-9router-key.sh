#!/bin/sh
# apiKeyHelper for claude-nine (set in ~/.claude-nine/settings.json). Prints the
# local 9Router API token on stdout; Claude Code reads it. Never run this where
# its output is logged or displayed.
#
# Order: the 0600 file ~/.9router/gateway-key first (headless-safe: a locked login
# keychain makes `security` fail or prompt, which breaks cron/ssh launches), then the
# macOS Keychain item nine-router-setup stores (scripts/macos/protect-local-state.sh
# set-token). A box that has no gateway-key file behaves exactly as before.
KEY_FILE="$HOME/.9router/gateway-key"
if [ -s "$KEY_FILE" ]; then
  exec /usr/bin/tr -d '\n' < "$KEY_FILE"
fi
exec /usr/bin/security find-generic-password -s "BlackCEO-999" -a "9router-api-token" -w
