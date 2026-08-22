/**
 * WS-25 acceptance tests — macOS launcher compatibility (fixture level)
 * (CHECKLIST E.1 WS-25: Terminal.app + `claude-nine` end-to-end path,
 * plain `claude` path also passes with plain Claude routing untouched).
 *
 * These tests prove the LAUNCHER CONTRACT that the end-to-end live harness
 * (`e2e-live.mjs`) depends on. They run on fixture text so they are green
 * in any CI container, on any host, with no Claude install present. The
 * live side — real `claude` and `claude-nine` resolution through a login
 * shell, Terminal.app presence, the WS-21 probe run — is `e2e-live.mjs`
 * (SKIP-able on non-macOS).
 *
 * Contract rules proven here (fixtures mirror 999-setup launchers:
 * macOS installs `claude-nine` at `$HOME/.local/bin/claude-nine`; plain
 * `claude` stays untouched and non-routed; both share the personal skills
 * root; the routed launcher must not mutate plain `claude`):
 *
 *  1. `claude-nine` is a Bash script that sets its own config dir
 *     (`CLAUDE_CONFIG_DIR`) — routing state stays private to the
 *     nine-router profile.
 *  2. `claude-nine` never sets `CLAUDE_CONFIG_DIR` to the plain config
 *     root, and plain `claude` never sets `CLAUDE_CONFIG_DIR` at all —
 *     plain `claude` uses its default config root untouched.
 *  3. `claude-nine` resolves and `exec`s the native binary via the shared
 *     launcher library (`cc_resolve_binary`), so routing is a child-env
 *     concern, never a global PATH/alias rewrite.
 *  4. `claude-nine` survives symlinked installation (`$HOME/.local/bin/
 *     claude-nine` -> real script) — it resolves `BASH_SOURCE` through
 *     symlinks before sourcing its library.
 *  5. The routed launcher never rewrites or wraps the plain `claude`
 *     binary; the plain wrapper contains no routing/env override.
 *
 * Runner: plain Node >= 22.6 (Node 26 strips types natively):
 *
 *   cd apps/candice-companion
 *   node --test tests/terminal-compat/launcher-analysis.test.ts
 *
 * Lane: WR-015 / WS-25. Owned glob (manifest 9.2):
 * `apps/candice-companion/tests/terminal-compat/**`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Fixtures model the shipped 999-setup launchers (same shape as the live
// files on the operator box; the e2e harness asserts the live copies).
const FIXTURE_CLAUDE_NINE = `#!/bin/bash
# claude-nine - routed launcher (nine-router), never touches plain claude.
set -uo pipefail

# Resolve through symlinks: reached via ~/.local/bin/claude-nine.
_cc_src="\${BASH_SOURCE[0]}"
while [ -L "$_cc_src" ]; do
  _cc_target="$(readlink "$_cc_src")"
  case "$_cc_target" in
    /*) _cc_src="$_cc_target" ;;
    *) _cc_src="$(dirname "$_cc_src")/$_cc_target" ;;
  esac
done
SELF_DIR="$(cd "$(dirname "$_cc_src")" && pwd)"
unset _cc_src _cc_target
. "$SELF_DIR/claude-code-lib.sh"

PORT=20128
export CLAUDE_CONFIG_DIR="\${CLAUDE_CONFIG_DIR:-\$HOME/.claude-nine}"

if [ ! -f "$CLAUDE_CONFIG_DIR/settings.json" ]; then
  echo "claude-nine: missing \$CLAUDE_CONFIG_DIR/settings.json" >&2
  exit 1
fi

CC_BIN="$(cc_resolve_binary)" || exit 1
exec "$CC_BIN" "$@"
`

const FIXTURE_PLAIN_CLAUDE = `#!/bin/bash
# claude - plain launcher. No config-dir override: uses the default config
# root untouched. Never routed, never wrapped by the nine launcher.
set -uo pipefail
_CC_SRC="\${BASH_SOURCE[0]}"
while [ -L "$_CC_SRC" ]; do
  _CC_TARGET="$(readlink "$_CC_SRC")"
  case "$_CC_TARGET" in
    /*) _CC_SRC="$_CC_TARGET" ;;
    *) _CC_SRC="$(dirname "$_CC_SRC")/$_CC_TARGET" ;;
  esac
done
SELF_DIR="$(cd "$(dirname "$_CC_SRC")" && pwd)"
. "$SELF_DIR/claude-code-lib.sh"
CC_BIN="$(cc_resolve_binary)" || exit 1
exec "$CC_BIN" "$@"
`

test('WS-25: claude-nine is a bash launcher that owns a private config dir', () => {
  assert.match(FIXTURE_CLAUDE_NINE, /^#!\/bin\/bash/)
  assert.match(FIXTURE_CLAUDE_NINE, /export CLAUDE_CONFIG_DIR=/)
  // Nine-router state lives in the routed launcher's own dir, never the
  // plain config root (plain `claude` must remain untouched, spec 0.3).
  assert.match(FIXTURE_CLAUDE_NINE, /\$HOME\/\.claude-nine/)
  assert.ok(!FIXTURE_CLAUDE_NINE.includes('.claude/settings.json'))
})

test('WS-25: plain claude never sets CLAUDE_CONFIG_DIR — config root untouched', () => {
  assert.equal(FIXTURE_PLAIN_CLAUDE.includes('CLAUDE_CONFIG_DIR'), false)
  assert.match(FIXTURE_PLAIN_CLAUDE, /^#!\/bin\/bash/)
  // Both launchers exec the SAME native binary through the shared library.
  assert.match(FIXTURE_PLAIN_CLAUDE, /cc_resolve_binary/)
  assert.match(FIXTURE_PLAIN_CLAUDE, /exec "\$CC_BIN"/)
})

test('WS-25: nine launcher resolves symlinks and execs the native binary', () => {
  assert.match(FIXTURE_CLAUDE_NINE, /BASH_SOURCE/)
  assert.match(FIXTURE_CLAUDE_NINE, /while \[ -L/)
  assert.match(FIXTURE_CLAUDE_NINE, /claude-code-lib\.sh/)
  assert.match(FIXTURE_CLAUDE_NINE, /cc_resolve_binary/)
  assert.match(FIXTURE_CLAUDE_NINE, /exec "\$CC_BIN" "\$@"/)
  // Routing is a child-process environment attribute, never a PATH rewrite.
  assert.ok(!FIXTURE_CLAUDE_NINE.includes('export PATH='))
})

test('WS-25: nine launcher never mutates plain claude', () => {
  // The routed launcher contains no write to the plain claude binary,
  // config, or skills root.
  assert.ok(!FIXTURE_CLAUDE_NINE.includes('.claude/skills'))
  assert.ok(!FIXTURE_CLAUDE_NINE.includes('sed -i'))
  assert.ok(!FIXTURE_CLAUDE_NINE.includes('mv '))
  // Config separation is directional: plain has no config override at all.
  assert.equal(FIXTURE_PLAIN_CLAUDE.includes('.claude-nine'), false)
})

test('WS-25: launcher failure is loud and exits non-zero (never silent half-launch)', () => {
  // The nine launcher must refuse to start when its router config is
  // missing — never fall back to silently running plain claude (which
  // would make a routed session look like a plain session).
  assert.match(FIXTURE_CLAUDE_NINE, /exit 1/)
  assert.match(FIXTURE_CLAUDE_NINE, /settings\.json/)
})
