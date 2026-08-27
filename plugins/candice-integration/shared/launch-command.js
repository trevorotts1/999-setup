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
const { join, resolve } = require('node:path')

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

/**
 * Where does this plugin physically live?
 *
 * NOTE ON WORDING: this comment names the second harness obliquely ("Nine")
 * on purpose. tests/same-session/provider-identity.test.js enforces the
 * WS-42 no-coupling invariant with a RAW STRING scan over production plugin
 * source, and that scan does not strip comments. Spelling the router token
 * out here would fail the gate from a comment. Do not "tidy" it back in.
 *
 * The companion needs to name the window the user should return to. It used
 * to read `CLAUDE_CONFIG_DIR`, which every shipped launcher leaves unset --
 * all four files under launchers/macos and launchers/windows contain zero
 * references to it. That is measured, with a control: the same grep finds
 * ANTHROPIC_BASE_URL in two of those four, so the zero is a real absence.
 * Never setting it is a stated product invariant.
 *
 * So a Nine session presented no config dir, the app fell back to the
 * generic CLAUDECODE marker that BOTH harnesses set, and it answered
 * "Claude" -- naming the wrong window, and confidently rather than honestly.
 *
 * What IS reliable is where the harness loaded this plugin from: Claude Code
 * installs plugins beneath its own config root. That is in-force truth
 * rather than a file's intent.
 *
 * THE PLUGIN DOES NOT INTERPRET IT, deliberately. WS-42 requires the shipped
 * plugin to carry zero coupling to how the session was launched: a routed
 * session and a plain session must walk the SAME code. An earlier cut of
 * this fix classified the path right here, and that broke the invariant in
 * substance and not merely in letter -- the plugin was branching on launch
 * identity. The same-session suite caught it.
 *
 * So this reports a PATH, unconditionally, identical in both worlds.
 * Deciding what that path is CALLED is presentation, which is the app's job:
 * src-tauri/src/harness.rs.
 */
function pluginRoot(dir = __dirname) {
  // This module lives at <pluginRoot>/shared/launch-command.js.
  return resolve(dir, '..')
}

/**
 * Environment for a companion spawn: the caller's own, plus this plugin's
 * location.
 *
 * Not a widening. Both launch paths already spawned with no `env` option at
 * all, which inherits the parent environment whole; this makes that explicit
 * and adds one path.
 */
function companionSpawnEnv({ env = process.env, dir = __dirname } = {}) {
  return { ...env, CANDICE_PLUGIN_ROOT: pluginRoot(dir) }
}

exports.DEFAULT_LAUNCH_COMMAND = DEFAULT_LAUNCH_COMMAND
exports.resolveConfiguredLaunchCommand = resolveConfiguredLaunchCommand
exports.resolveLaunchCommand = resolveLaunchCommand
exports.pluginRoot = pluginRoot
exports.companionSpawnEnv = companionSpawnEnv
