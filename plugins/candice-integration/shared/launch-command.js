'use strict'

/**
 * Single owner of "where is the installed Candice Companion executable?".
 *
 * Two independent launch paths need that answer and must never disagree:
 *   - the hook dispatcher, `bin/wake-candice.mjs` (ESM), and
 *   - the MCP ask_user transport, `mcp/ask-user/local-companion-bridge.js`
 *     (CommonJS).
 * The resolution used to live in the dispatcher alone, so the bridge saw only
 * `process.env.CANDICE_COMPANION_CMD`. A fresh client install sets
 * `CANDICE_COMPANION_READY=1` and never `CANDICE_COMPANION_CMD`, which left
 * the bridge with no command at all: every ask_user call failed
 * `companion-not-configured` even with the app correctly installed.
 *
 * CommonJS on purpose — the ESM dispatcher can import this module, while the
 * CommonJS bridge could not have imported the dispatcher.
 */

const { existsSync } = require('node:fs')
const { join } = require('node:path')

/** Last-resort executable name, resolved through PATH by the OS. */
const DEFAULT_LAUNCH_COMMAND = 'candice-companion'

/**
 * The explicitly configured (`CANDICE_COMPANION_CMD`) or installed executable,
 * or `null` when neither is present. Callers that must tell "nothing is
 * installed" apart from "here it is" use this: it never invents a PATH name.
 */
function resolveConfiguredLaunchCommand({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (env.CANDICE_COMPANION_CMD) return env.CANDICE_COMPANION_CMD

  const candidates = []
  if (platform === 'darwin' && env.HOME) {
    candidates.push(join(
      env.HOME,
      'Library', 'Application Support', 'BlackCEO', '999', 'app',
      'Candice Companion.app', 'Contents', 'MacOS', 'candice-companion',
    ))
  }
  if (platform === 'win32' && env.LOCALAPPDATA) {
    candidates.push(join(
      env.LOCALAPPDATA, 'BlackCEO', '999', 'app',
      'Candice Companion', 'candice-companion.exe',
    ))
    candidates.push(join(
      env.LOCALAPPDATA, 'BlackCEO', '999', 'app',
      'Candice Companion.exe',
    ))
  }
  return candidates.find((candidate) => exists(candidate)) || null
}

/**
 * The command the hook dispatcher spawns: the configured/installed executable,
 * falling back to the bare PATH name so a non-canonical developer install
 * still wakes. Behavior is unchanged from the dispatcher's original copy.
 */
function resolveLaunchCommand(options = {}) {
  return resolveConfiguredLaunchCommand(options) || DEFAULT_LAUNCH_COMMAND
}

exports.DEFAULT_LAUNCH_COMMAND = DEFAULT_LAUNCH_COMMAND
exports.resolveConfiguredLaunchCommand = resolveConfiguredLaunchCommand
exports.resolveLaunchCommand = resolveLaunchCommand
