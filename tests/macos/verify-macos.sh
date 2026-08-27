#!/usr/bin/env bash
# verify-macos.sh — standalone macOS platform tests (spec §22 macOS platform tests).
# Safe to run repeatedly; makes no changes. Prints PASS/FAIL/BLOCKED per check.
#
# FIX-021 semantics: a required check that FAILED exits nonzero and the CI job
# must block on it (no continue-on-error). A required check that cannot run on
# this host class exits 0 as BLOCKED with a machine-readable reason and the
# release gate refuses evidence missing that BLOCKED row. A FAIL is never a
# silent skip and a BLOCKED is never a PASS.
#
# Bare-host mode (no --ci-root): provisions nothing; checks against the real
# home, keychain, and shell files. Unavailable checks record explicit SKIPs
# and exit 0 (spec 27 skip convention — a real provisioned Mac must pass them
# or the run is not a verification).
#
# CI mode (--ci-root <dir>): state-dependent checks run against provisioned
# fixture state under the scratch root instead of the bare runner home;
# host-class-impossible checks (Keychain, login-shell PATH, real shell
# startup files) record BLOCKED rows and exit 0.
set -uo pipefail

failures=0; passes=0; blocked=0
check() { if [ "$1" = "0" ]; then passes=$((passes+1)); echo "PASS  $2"; else failures=$((failures+1)); echo "FAIL  $2"; fi; }
block() { blocked=$((blocked+1)); echo "BLOCKED  $1"; }

CI_ROOT=""; MODE="bare"
while [ $# -gt 0 ]; do
  case "$1" in
    --ci-root) CI_ROOT="${2:-}"; MODE="ci"; shift 2 ;;
    *) shift ;;
  esac
done
if [ "$MODE" = "ci" ] && [ -z "$CI_ROOT" ]; then
  echo "verify-macos.sh: --ci-root requires a directory" >&2
  exit 2
fi

# Provision the fixture tree in CI mode (idempotent; makes no real-home changes).
if [ "$MODE" = "ci" ]; then
  mkdir -p "$CI_ROOT/.local/bin" "$CI_ROOT/Library/Application Support/BlackCEO/999"
  cp "$(dirname "$0")/fixtures/ci-launcher.sh" "$CI_ROOT/.local/bin/claude-nine"
  chmod 755 "$CI_ROOT/.local/bin/claude-nine"
  cp "$(dirname "$0")/fixtures/ci-router-session.json" \
     "$CI_ROOT/Library/Application Support/BlackCEO/999/router-session.json"
  chmod 600 "$CI_ROOT/Library/Application Support/BlackCEO/999/router-session.json"
fi

# 1. OS
[ "$(uname -s)" = "Darwin" ]; check $? "uname -s = Darwin"

# 2. Architecture
[ "$(uname -m)" = "arm64" ]; check $? "architecture is arm64"

# 3. Documents path resolution
DOCS="$(osascript -e 'POSIX path of (path to documents folder)' 2>/dev/null | sed 's:/*$::')"
[ -n "$DOCS" ] && [ -d "$DOCS" ]; check $? "resolved Documents path is valid ($DOCS)"

# 4. Launcher executable
if [ "$MODE" = "ci" ]; then
  "$(dirname "$0")/fixtures/ci-launcher.sh" "$CI_ROOT" >/dev/null 2>&1
  check $? "CI fixture launcher probe (ci-root $CI_ROOT/.local/bin/claude-nine)"
else
  [ -x "$HOME/.local/bin/claude-nine" ]; check $? "\$HOME/.local/bin/claude-nine exists and is executable"
fi

# 5. Login shell can resolve claude-nine — host-class check: a CI runner has
#    no provisioned PATH entry, so it is BLOCKED there, never skipped.
if [ "$MODE" = "ci" ]; then
  block "login shell resolves claude-nine (CI runner has no provisioned shell PATH; required on a real provisioned Mac)"
else
  zsh -lc 'command -v claude-nine' >/dev/null 2>&1 || bash -lc 'command -v claude-nine' >/dev/null 2>&1
  check $? "a login shell can resolve claude-nine"
fi

# 6. State file mode 600
STATE="$HOME/Library/Application Support/BlackCEO/999/router-session.json"
if [ "$MODE" = "ci" ]; then
  STATE="$CI_ROOT/Library/Application Support/BlackCEO/999/router-session.json"
fi
if [ -f "$STATE" ]; then
  MODE_BITS="$(stat -f '%Lp' "$STATE")"
  [ "$MODE_BITS" = "600" ]; check $? "route-state file permissions are 600 (got $MODE_BITS)"
else
  if [ "$MODE" = "ci" ]; then
    failures=$((failures+1)); echo "FAIL  route-state fixture missing at $STATE (provisioning step broken)"
  else
    echo "SKIP  route-state file permissions (state file not present)"
  fi
fi

# 7. Keychain token retrievable (account/service order must match how the
#    launcher and protect-local-state.sh actually store it: account
#    "9router-api-token", service "BlackCEO-999" — reversed here would fail
#    on every correctly provisioned Mac). A CI runner has no login keychain:
#    BLOCKED, required on a real provisioned Mac.
if [ "$MODE" = "ci" ]; then
  block "Keychain token retrievable (CI runner has no login keychain; required on a real provisioned Mac)"
elif security find-generic-password -a "9router-api-token" -s "BlackCEO-999" -w >/dev/null 2>&1; then
  passes=$((passes+1)); echo "PASS  Keychain token retrievable"
else
  failures=$((failures+1)); echo "FAIL  Keychain token retrievable"
fi

# 8. No router env in shell startup files — host-class check on the real
#    home's shell files; CI has none, so it is BLOCKED there.
if [ "$MODE" = "ci" ]; then
  block "no router ANTHROPIC_* vars in shell startup files (CI runner has no real shell startup files; required on a real provisioned Mac)"
elif grep -qE 'ANTHROPIC_BASE_URL|localhost:20128' "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.bashrc" 2>/dev/null; then
  failures=$((failures+1)); echo "FAIL  no router ANTHROPIC_* vars in shell startup files"
else
  passes=$((passes+1)); echo "PASS  no router ANTHROPIC_* vars in shell startup files"
fi

echo
echo "$passes passed, $failures failed, $blocked blocked ($MODE mode)"
exit $([ "$failures" = "0" ] && echo 0 || echo 1)
