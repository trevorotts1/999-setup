#!/usr/bin/env bash
# verify-macos.sh — standalone macOS platform tests (spec §22 macOS platform tests).
# Safe to run repeatedly; makes no changes. Prints PASS/FAIL per check.
set -uo pipefail

failures=0; passes=0
check() { if [ "$1" = "0" ]; then passes=$((passes+1)); echo "PASS  $2"; else failures=$((failures+1)); echo "FAIL  $2"; fi; }

# 1. OS
[ "$(uname -s)" = "Darwin" ]; check $? "uname -s = Darwin"

# 2. Architecture
[ "$(uname -m)" = "arm64" ]; check $? "architecture is arm64"

# 3. Documents path resolution
DOCS="$(osascript -e 'POSIX path of (path to documents folder)' 2>/dev/null | sed 's:/*$::')"
[ -n "$DOCS" ] && [ -d "$DOCS" ]; check $? "resolved Documents path is valid ($DOCS)"

# 4. Launcher executable
[ -x "$HOME/.local/bin/claude-nine" ]; check $? "\$HOME/.local/bin/claude-nine exists and is executable"

# 5. Login shell can resolve claude-nine
zsh -lc 'command -v claude-nine' >/dev/null 2>&1 || bash -lc 'command -v claude-nine' >/dev/null 2>&1
check $? "a login shell can resolve claude-nine"

# 6. State file mode 600
STATE="$HOME/Library/Application Support/BlackCEO/999/router-session.json"
if [ -f "$STATE" ]; then
  MODE="$(stat -f '%Lp' "$STATE")"
  [ "$MODE" = "600" ]; check $? "route-state file permissions are 600 (got $MODE)"
else
  echo "SKIP  route-state file permissions (state file not present)"
fi

# 7. Keychain token retrievable (account/service order must match how the
#    launcher and protect-local-state.sh actually store it: account
#    "9router-api-token", service "BlackCEO-999" — reversed here would fail
#    on every correctly provisioned Mac).
if security find-generic-password -a "9router-api-token" -s "BlackCEO-999" -w >/dev/null 2>&1; then
  passes=$((passes+1)); echo "PASS  Keychain token retrievable"
else
  failures=$((failures+1)); echo "FAIL  Keychain token retrievable"
fi

# 8. No router env in shell startup files
if grep -qE 'ANTHROPIC_BASE_URL|localhost:20128' "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.bashrc" 2>/dev/null; then
  failures=$((failures+1)); echo "FAIL  no router ANTHROPIC_* vars in shell startup files"
else
  passes=$((passes+1)); echo "PASS  no router ANTHROPIC_* vars in shell startup files"
fi

echo
echo "$passes passed, $failures failed"
exit $([ "$failures" = "0" ] && echo 0 || echo 1)
