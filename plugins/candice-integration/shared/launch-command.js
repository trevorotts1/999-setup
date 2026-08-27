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

/**
 * Which harness is this plugin installed under -- Claude, or Claude-Nine?
 *
 * ## Why this is derived from a PATH and not from the environment
 *
 * The obvious signal is `CLAUDE_CONFIG_DIR`, and that is what the companion
 * originally read. It was wrong on every client machine. The launchers this
 * repo SHIPS -- launchers/macos/claude-nine, launchers/macos/claude-codex,
 * launchers/windows/claude-nine.cmd and launchers/windows/claude-nine.ps1 --
 * contain ZERO references to that variable. That is measured, not assumed:
 * the same grep finds ANTHROPIC_BASE_URL in two of those four files, so the
 * instrument works and the zero is a real absence. Never setting it is a
 * deliberate product invariant, not an oversight.
 *
 * So on a client box a Claude-Nine session presented no config dir and only
 * the generic `CLAUDECODE` marker, and the companion answered "Claude" --
 * the exact wrong-window failure this lane exists to prevent, and WRONG
 * rather than merely unknown.
 *
 * What IS reliable is where the harness loaded this plugin from. Claude Code
 * installs plugins beneath its own config root, so this file's own path
 * physically sits under `.claude-nine/` or `.claude/`. That is in-force
 * truth -- where the running harness actually looked -- rather than what
 * some file intends. It needs no launcher change and no cooperation from the
 * environment.
 *
 * Deliberately NOT a signal: a loopback `ANTHROPIC_BASE_URL`. The shipped
 * Nine launcher does export one, but so does any other local proxy, so it
 * would misname a LiteLLM user as Claude-Nine. Guessing wrong is the failure
 * being fixed here, so an unrecognised layout returns null and the companion
 * renders that as "your terminal".
 */

const HARNESS_NINE = 'Claude-Nine'
const HARNESS_CLAUDE = 'Claude'

/** Path components, separator-agnostic so one code path covers Windows. */
function pathComponents(dir) {
  return String(dir).split(/[\\/]+/).filter(Boolean)
}

/**
 * `'Claude-Nine'`, `'Claude'`, or `null` when the layout does not say.
 *
 * `dir` defaults to this module's own location, which is the whole point --
 * see the note above.
 */
function resolveHarnessName({ dir = __dirname, env = process.env } = {}) {
  // An explicit value wins. It is the only signal a caller can state
  // outright, and it is how the companion is told across a spawn.
  const explicit = env.CANDICE_HARNESS
  if (explicit === HARNESS_NINE || explicit === HARNESS_CLAUDE) return explicit

  // EXACT component match, never a substring. `'.claude-nine'` CONTAINS
  // `'.claude'`, so a substring test stays correct only while someone keeps
  // the two checks in the right order forever; and `.claude-nineteen` would
  // classify as Nine. A config root is a path component, so compare it as
  // one.
  for (const source of [dir, env.CLAUDE_CONFIG_DIR]) {
    if (!source) continue
    const parts = pathComponents(source)
    if (parts.includes('.claude-nine')) return HARNESS_NINE
    if (parts.includes('.claude')) return HARNESS_CLAUDE
  }

  // `CLAUDECODE` is deliberately not consulted. Both harnesses are the same
  // binary and both set it, so it can never tell them apart -- deriving
  // "Claude" from it was precisely the bug. Unknown is a correct answer.
  return null
}

/**
 * Environment for a companion spawn: the caller's own, plus the harness name
 * when it is known.
 *
 * This does not widen what the child sees. Both launch paths already spawned
 * with no `env` option at all, which inherits the parent environment whole;
 * this makes that inheritance explicit and adds one variable. When the
 * harness is unknown the variable is left ABSENT rather than set to a
 * placeholder, so "we were not told" and "we do not know" stay the same
 * thing on the far side.
 */
function companionSpawnEnv({ env = process.env, dir = __dirname } = {}) {
  const name = resolveHarnessName({ dir, env })
  return name === null ? { ...env } : { ...env, CANDICE_HARNESS: name }
}

exports.DEFAULT_LAUNCH_COMMAND = DEFAULT_LAUNCH_COMMAND
exports.resolveConfiguredLaunchCommand = resolveConfiguredLaunchCommand
exports.resolveLaunchCommand = resolveLaunchCommand
exports.HARNESS_CLAUDE = HARNESS_CLAUDE
exports.HARNESS_NINE = HARNESS_NINE
exports.resolveHarnessName = resolveHarnessName
exports.companionSpawnEnv = companionSpawnEnv
