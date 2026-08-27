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

  // Ordered by confidence: the operator-managed layout first, then the
  // locations the SHIPPED INSTALLERS actually use. Those were missing, and a
  // client who installs the normal way lands in one of them -- so every
  // ask_user returned `companion-not-configured` and every wake spawned
  // nothing, with the app sitting correctly installed on disk the whole time.
  const candidates = []
  if (platform === 'darwin' && env.HOME) {
    candidates.push(join(
      env.HOME,
      'Library', 'Application Support', 'BlackCEO', '999', 'app',
      'Candice Companion.app', 'Contents', 'MacOS', 'candice-companion',
    ))
    // The DMG stages a symlink to /Applications and tells the user to drag
    // there, which is the only instruction a client ever sees.
    candidates.push(join(
      '/Applications',
      'Candice Companion.app', 'Contents', 'MacOS', 'candice-companion',
    ))
    // Per-user drag target, equally normal on macOS.
    candidates.push(join(
      env.HOME, 'Applications',
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
    // Tauri's NSIS per-user default. Nothing in installerHooks.nsh redirects
    // InstallDir to the BlackCEO layout, so this is where a Windows client
    // actually ends up.
    candidates.push(join(
      env.LOCALAPPDATA, 'Candice Companion', 'candice-companion.exe',
    ))
  }
  if (platform === 'win32') {
    // Per-machine NSIS/MSI default.
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)']]) {
      if (base) {
        candidates.push(join(base, 'Candice Companion', 'candice-companion.exe'))
      }
    }
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
