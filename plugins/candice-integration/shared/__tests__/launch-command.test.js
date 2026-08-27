'use strict'

/**
 * Where is the installed Candice Companion executable?
 *
 * This module is the single owner of that answer, and it was answering it
 * wrongly for anyone who installed the app the way the installers actually
 * install it. It probed only the operator-managed layout
 * (`~/Library/Application Support/BlackCEO/999/app/...` and its Windows
 * sibling). But the macOS DMG stages a symlink to `/Applications` and tells
 * the user to drag it there, and Tauri's NSIS installer defaults to
 * `%LOCALAPPDATA%\Candice Companion\` with nothing in installerHooks.nsh
 * redirecting it.
 *
 * A client who followed the instructions therefore got `null` here, which
 * degrades to the bare PATH name `candice-companion`, which is not on PATH,
 * so the spawn ENOENT'd -- and `wake-candice.mjs` swallows spawn errors by
 * design. Every wake did nothing and every ask_user returned
 * `companion-not-configured`, with the app installed correctly the whole time.
 *
 * Run: node plugins/candice-integration/shared/__tests__/launch-command.test.js
 */

const assert = require('assert')
const { join } = require('node:path')
const {
  DEFAULT_LAUNCH_COMMAND,
  resolveConfiguredLaunchCommand,
  resolveLaunchCommand,
} = require('../launch-command')

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL  ${name}: ${err.message}`)
  }
}

/** Pretend exactly one path exists on disk. */
const only = (wanted) => (candidate) => candidate === wanted

const MAC_APPLICATIONS = join(
  '/Applications', 'Candice Companion.app', 'Contents', 'MacOS', 'candice-companion',
)
const MAC_HOME_APPS = join(
  '/Users/x', 'Applications', 'Candice Companion.app', 'Contents', 'MacOS', 'candice-companion',
)
const MAC_OPERATOR = join(
  '/Users/x', 'Library', 'Application Support', 'BlackCEO', '999', 'app',
  'Candice Companion.app', 'Contents', 'MacOS', 'candice-companion',
)
const WIN_NSIS_DEFAULT = join('C:\\Users\\x\\AppData\\Local', 'Candice Companion', 'candice-companion.exe')
const WIN_OPERATOR = join(
  'C:\\Users\\x\\AppData\\Local', 'BlackCEO', '999', 'app',
  'Candice Companion', 'candice-companion.exe',
)
const WIN_PROGRAM_FILES = join('C:\\Program Files', 'Candice Companion', 'candice-companion.exe')

// ————————————————————————————————
// 1. The explicit override always wins
// ————————————————————————————————

check('CANDICE_COMPANION_CMD beats every probe', () => {
  const got = resolveConfiguredLaunchCommand({
    env: { CANDICE_COMPANION_CMD: '/custom/path/candice', HOME: '/Users/x' },
    platform: 'darwin',
    exists: () => true,
  })
  assert.strictEqual(got, '/custom/path/candice')
})

// ————————————————————————————————
// 2. macOS: the DMG's own instruction is /Applications
// ————————————————————————————————

check('macOS: finds an app dragged to /Applications (the DMG instruction)', () => {
  const got = resolveConfiguredLaunchCommand({
    env: { HOME: '/Users/x' },
    platform: 'darwin',
    exists: only(MAC_APPLICATIONS),
  })
  assert.strictEqual(got, MAC_APPLICATIONS)
})

check('macOS: finds an app in ~/Applications', () => {
  const got = resolveConfiguredLaunchCommand({
    env: { HOME: '/Users/x' },
    platform: 'darwin',
    exists: only(MAC_HOME_APPS),
  })
  assert.strictEqual(got, MAC_HOME_APPS)
})

check('macOS: the operator layout still wins when both exist', () => {
  const got = resolveConfiguredLaunchCommand({
    env: { HOME: '/Users/x' },
    platform: 'darwin',
    exists: (c) => c === MAC_APPLICATIONS || c === MAC_OPERATOR,
  })
  assert.strictEqual(got, MAC_OPERATOR, 'operator-managed install must take precedence')
})

// ————————————————————————————————
// 3. Windows: the NSIS default is where clients actually land
// ————————————————————————————————

check('windows: finds the NSIS per-user default install', () => {
  const got = resolveConfiguredLaunchCommand({
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
    platform: 'win32',
    exists: only(WIN_NSIS_DEFAULT),
  })
  assert.strictEqual(got, WIN_NSIS_DEFAULT)
})

check('windows: finds a per-machine Program Files install', () => {
  const got = resolveConfiguredLaunchCommand({
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files' },
    platform: 'win32',
    exists: only(WIN_PROGRAM_FILES),
  })
  assert.strictEqual(got, WIN_PROGRAM_FILES)
})

check('windows: the operator layout still wins when both exist', () => {
  const got = resolveConfiguredLaunchCommand({
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
    platform: 'win32',
    exists: (c) => c === WIN_NSIS_DEFAULT || c === WIN_OPERATOR,
  })
  assert.strictEqual(got, WIN_OPERATOR)
})

check('windows: PROGRAMFILES absent from env does not throw', () => {
  const got = resolveConfiguredLaunchCommand({
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
    platform: 'win32',
    exists: () => false,
  })
  assert.strictEqual(got, null)
})

// ————————————————————————————————
// 4. Honest null, and the documented PATH fallback
// ————————————————————————————————

check('nothing installed reports null, never a guess', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const got = resolveConfiguredLaunchCommand({
      env: { HOME: '/Users/x', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
      platform,
      exists: () => false,
    })
    assert.strictEqual(got, null, `${platform} must report null`)
  }
})

check('resolveLaunchCommand falls back to the bare PATH name', () => {
  const got = resolveLaunchCommand({
    env: {},
    platform: 'linux',
    exists: () => false,
  })
  assert.strictEqual(got, DEFAULT_LAUNCH_COMMAND)
})

check('CONTROL: the probe is actually consulted, not bypassed', () => {
  // If `exists` were ignored, every assertion above would pass vacuously by
  // returning the first candidate. Prove the resolver reads it.
  let asked = 0
  resolveConfiguredLaunchCommand({
    env: { HOME: '/Users/x' },
    platform: 'darwin',
    exists: () => {
      asked += 1
      return false
    },
  })
  assert.ok(asked >= 3, `expected several candidates to be probed, saw ${asked}`)
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
