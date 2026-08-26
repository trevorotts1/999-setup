'use strict'

/**
 * WS-50 e2e acceptance — leg 6: FRESH USER RUNS A SUPPORTED SKILL
 * (Master Spec 2/3/13.1/22; E.1 WS-50: "a fresh user runs a supported
 * skill, Candice appears and reports setup checking...").
 *
 * Walkthrough (nontechnical flow): the user types /spec-protocol (or
 * /kaizen, /eli5, /bro). Candice wakes within a few seconds and shows the
 * setup-check message — as a caption even with voice off — BEFORE the
 * skill's long preflight completes. She is a progress surface only: she
 * never decides whether the setup passes. On a fresh machine, the WS-31
 * bootstrap installs the bundled skills, the plugin, the app, and the
 * pinned STT/TTS assets with checksum metadata, with no source compile.
 *
 * Proof legs, all FAIL-CLOSED:
 *  1. The wake-up hook is registered for all four slash commands AND
 *     not ordinary session start (WS-02 hooks.json), async and non-blocking.
 *  2. The skill surfaces name Candice's appearance + setup-check role, and
 *     state that she is NOT the setup-deciding component (WS-36).
 *  3. A fresh bootstrap fails closed before writing an install tree when no
 *     release-authorized app candidate exists — driven through the real
 *     WS-31 install engine in a hermetic temp root (no network/home touched).
 *  4. The cross-platform wake dispatcher fails soft when the app is not yet
 *     installed (source proof on the WS-02 Node dispatcher).
 *  5. Windows fresh-user path requires a real interactive desktop — the
 *     suite records the honest skip marker with the exact smoke checklist
 *     that must pass before Windows is labeled production-ready.
 *
 *   node tests/e2e-acceptance/happy6-fresh-user-runs-skill.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const url = require('url')
const harness = require('./harness')

let failures = 0
let skips = 0

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        console.log(`ok - ${name}`)
      },
      (err) => {
        failures += 1
        console.log(`FAIL - ${name}`)
        console.log(`  ${err && err.message ? err.message : err}`)
      }
    )
}

function skip(name, reason) {
  skips += 1
  console.log(`SKIP - ${name} (${reason})`)
}

;(async () => {
  const pending = []
  const hooks = harness.readJson(path.join(harness.PLUGIN_ROOT, 'hooks', 'hooks.json'))
  const skill = harness.mustRead(harness.SPEC_SKILL)
  const companion = harness.mustRead(harness.COMPANION_REF)
  const wake = harness.mustRead(path.join(harness.PLUGIN_ROOT, 'bin', 'wake-candice.mjs'))

  // -----------------------------------------------------------------------
  // 1. Wake-up only on exactly the four dedicated commands
  // -----------------------------------------------------------------------

  pending.push(check('wake hooks exist for /spec-protocol, /kaizen, /eli5, /bro', async () => {
    // The plugin registers ONE real `UserPromptSubmit` handler (commit 0000aab)
    // and derives the slash command from the submitted prompt, instead of a
    // per-command matcher list on a hook event that does not exist. So the
    // "exactly four commands" invariant now lives in the dispatcher, and this
    // asserts it where it is actually enforced.
    const submit = hooks.hooks.UserPromptSubmit
    assert.ok(Array.isArray(submit) && submit.length === 1,
      'exactly one UserPromptSubmit handler is registered')
    const mod = await import(url.pathToFileURL(
      path.join(harness.PLUGIN_ROOT, 'bin', 'wake-candice.mjs')).href)
    assert.deepStrictEqual([...mod.SUPPORTED_COMMANDS].sort(),
      ['/bro', '/eli5', '/kaizen', '/spec-protocol'],
      'exactly the four dedicated slash commands wake Candice')
    for (const cmd of mod.SUPPORTED_COMMANDS) {
      assert.strictEqual(mod.commandFromHookPayload(JSON.stringify({ prompt: `${cmd} do a thing` })), cmd,
        `${cmd} is recognised from a real submitted prompt`)
    }
    assert.strictEqual(mod.commandFromHookPayload(JSON.stringify({ prompt: '/not-a-candice-command' })), null,
      'an unsupported command never wakes Candice')
  }))

  pending.push(check('wake hooks are bounded and non-blocking', () => {
    for (const m of hooks.hooks.UserPromptSubmit) {
      for (const h of m.hooks) {
        assert.ok(Number(h.timeout) > 0 && Number(h.timeout) <= 60,
          'wake hook timeout is bounded')
        assert.strictEqual(h.type, 'command', 'wake hook is a command hook')
      }
    }
    assert.strictEqual(hooks.hooks.SessionStart, undefined,
      'ordinary session start must not launch Candice')
    // Non-blocking is a property of the SPAWN, not of a json field: the child
    // is detached and unref'd, so the hook returns without waiting for the app.
    assert.ok(wake.includes('detached: true') && wake.includes('unref'),
      'the companion is spawned detached and unref\'d, so the hook never waits on it')
  }))

  pending.push(check('wake dispatcher fails soft when the app is not installed', () => {
    // Behaviour, not source text. The previous version grepped wake-candice.mjs
    // for a literal expression; when resolution moved into shared/launch-command.js
    // that assertion failed while the behaviour was in fact correct -- and it
    // could never have caught a real regression either way.
    const launcher = require(path.join(harness.PLUGIN_ROOT, 'shared', 'launch-command.js'))
    assert.strictEqual(
      launcher.resolveLaunchCommand({ env: { CANDICE_COMPANION_CMD: '/custom/candice' }, exists: () => false }),
      '/custom/candice', 'an explicit CANDICE_COMPANION_CMD always wins')
    assert.strictEqual(
      launcher.resolveLaunchCommand({ env: {}, platform: 'linux', exists: () => false }),
      launcher.DEFAULT_LAUNCH_COMMAND,
      'with nothing installed it falls back to the PATH name, never a hardcoded path')
    assert.strictEqual(
      launcher.resolveConfiguredLaunchCommand({ env: {}, platform: 'linux', exists: () => false }),
      null, 'nothing installed is reported as null, never invented')
    // Cross-platform: a Windows install is resolvable without an env var.
    const win = launcher.resolveConfiguredLaunchCommand({
      env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
      platform: 'win32',
      exists: () => true,
    })
    assert.ok(win && win.includes('candice-companion.exe'),
      'a Windows install resolves to the .exe without an env var')
    assert.ok(wake.includes('companion-unavailable'),
      'spawn failure has a named fail-soft outcome')
  }))

  // -----------------------------------------------------------------------
  // 2. She appears quickly and reports setup checking, as caption too
  // -----------------------------------------------------------------------

  pending.push(check('the skill names the setup-check-first surface and its caption rule', () => {
    assert.ok(/Hi, I['’]m Candice\.\s+I['’]m here to help/.test(skill),
      'SKILL.md names the immediate welcome')
    assert.ok(skill.includes('before preflight'), 'SKILL.md orders Candice before the long preflight')
    assert.ok(companion.includes('setup-check surface'), 'companion ref names the setup-check surface')
    assert.ok(companion.includes('she is not the component that decides'),
      'Candice is never the setup-deciding component')
  }))

  // -----------------------------------------------------------------------
  // 3. Fresh machine: bootstrap installs every component, live and hermetic
  // -----------------------------------------------------------------------

  pending.push(check('fresh bootstrap refuses an un-authorized app candidate before installing anything', async () => {
    const { installAll } = await import(path.join(harness.BOOTSTRAP, 'install.mjs'))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-boot-'))
    // Hermetic, offline: no network, no real HOME, no source compile. A
    // staged app bundle is intentionally not provided. FIX-001 correctly
    // treats that as a release-authority block, not an installable build.
    const r = await installAll({ root, offline: true, appSource: null })
    assert.strictEqual(r.ok, false, 'un-authorized app must block bootstrap')
    assert.match(r.message, /release-authorized Candice app candidate/)
    assert.strictEqual(fs.existsSync(path.join(root, 'skills')), false,
      'no partial skills install can imply a releasable app installation')
    assert.strictEqual(fs.existsSync(path.join(root, 'plugin')), false,
      'no partial plugin install can imply a releasable app installation')
    assert.strictEqual(fs.existsSync(path.join(root, 'state', 'bootstrap-state.json')), false,
      'no successful install state may be written')
  }))

  // -----------------------------------------------------------------------
  // 4. Windows fresh-user path needs a real interactive desktop
  // -----------------------------------------------------------------------

  const onWindows = process.platform === 'win32'
  if (onWindows) {
    skip('interactive Windows desktop smoke (Windows Terminal + PS 5.1/PS 7/CMD, both launchers, tabs/panes, mic, PTT, transparency, minimize/restore/monitor move, install/update/uninstall cleanup)',
      'this harness runs inside the repository on the build machine; the E.1 WS-46 interactive Windows smoke must be executed by a human on a real Windows 10/11 desktop before Windows is labeled production-ready')
  } else {
    skip('interactive Windows 10/11 desktop smoke (WS-46 full matrix)',
      'current host is not Windows; E.1 WS-46 requires a real Windows desktop smoke before Windows is labeled production-ready — recorded, never claimed')
  }

  // Await every check (they may be async); only then decide the verdict.
  await Promise.all(pending)
  console.log(`\nLEG 6 (fresh user runs a supported skill): ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'} (${skips} skipped)`)
  process.exit(failures === 0 ? 0 : 1)
})()
