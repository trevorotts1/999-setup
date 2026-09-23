#!/bin/sh
# apiKeyHelper for claude-nine (set in ~/.claude-nine/settings.json). Prints the
# local 9Router API token from the macOS Keychain item nine-router-setup stores
# (scripts/macos/protect-local-state.sh set-token). Claude Code reads stdout;
# never run this where its output is logged or displayed.
exec /usr/bin/security find-generic-password -s "BlackCEO-999" -a "9router-api-token" -w
