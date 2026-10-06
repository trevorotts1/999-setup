#!/bin/bash
# Fleet-safety checks for the macOS claude-nine launcher. Fake HOME; touches nothing real.
set -u
R="$(cd "$(dirname "$0")/../../../.." && pwd)"
L="$R/launchers/macos"; I="$R/.claude/skills/nine-router-setup/scripts/macos/install-claude-nine.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.9router" "$HOME/.claude" "$T/prefix/bin" "$T/prefix/lib/node_modules/@anthropic-ai/claude-code/bin"
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }

# 1. key helper: file wins, no trailing newline, keychain never reached
printf 'TESTTOKEN\n' >"$HOME/.9router/gateway-key"
[ "$(sh "$L/get-9router-key.sh")" = "TESTTOKEN" ] && ok "key helper reads gateway-key file" || bad "key helper file"

# 2. launcher binds 127.0.0.1 on every direct start and never touches ~/.claude/settings.json
grep -q -- '--host 127.0.0.1' "$L/claude-nine" && ! grep -qE '^[^#]*nohup[^#]*"\$_nine_bin" -p "\$PORT" --no-browser' "$L/claude-nine" \
  && ok "9router start is loopback-bound" || bad "loopback bind"
! grep -q 'cc_scrub_router_settings' "$L/claude-code-lib.sh" && ok "lib does not edit ~/.claude/settings.json" || bad "lib settings edit"

# 3. lib finds claude-code under the node prefix (non-default, non-npm-global)
touch "$T/prefix/lib/node_modules/@anthropic-ai/claude-code/install.cjs"; : >"$T/prefix/bin/node"; chmod +x "$T/prefix/bin/node"
got="$(CC_NODE="$T/prefix/bin/node" bash -c ". '$L/claude-code-lib.sh'; cc_pkg_dir")"
[ "$got" = "$T/prefix/lib/node_modules/@anthropic-ai/claude-code" ] && ok "prefix detected from node location" || bad "prefix detect ($got)"

# 4. installer --check writes nothing; BIN_DIR install writes launcher+lib, key helper in ~/.local/bin, no profile/codex
before="$(find "$HOME" | sort | shasum)"
bash "$I" --check >/dev/null 2>&1; [ "$(find "$HOME" | sort | shasum)" = "$before" ] && ok "--check writes nothing" || bad "--check wrote"
CLAUDE_NINE_BIN_DIR="$HOME/bin" bash "$I" >/dev/null 2>&1
[ -x "$HOME/bin/claude-nine" ] && [ -f "$HOME/bin/claude-code-lib.sh" ] && [ -f "$HOME/.local/bin/get-9router-key.sh" ] \
  && [ ! -e "$HOME/bin/claude-codex" ] && [ ! -e "$HOME/.zprofile" ] && [ ! -e "$HOME/.claude/settings.json" ] \
  && ok "BIN_DIR install scoped correctly" || bad "BIN_DIR install"
exit $fail
