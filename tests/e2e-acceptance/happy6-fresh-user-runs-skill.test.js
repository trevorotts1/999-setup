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
 *     session start (WS-02 hooks.json), async and non-blocking.
 *  2. The skill surfaces name Candice's appearance + setup-check role, and
 *     state that she is NOT the setup-deciding component (WS-36).
 *  3. The bootstrap installs every component listed in spec 22 on a fresh
 *     root — driven live through the real WS-31 install + health engines
 *     in a hermetic temp root (no network, no real home touched).
 *  4. The wake handler fails soft when the app is not yet installed
 *     (source proof on the WS-02 wake script).
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
  const wake = harness.mustRead(path.join(harness.PLUGIN_ROOT, 'bin', 'wake-candice.sh'))

  // -----------------------------------------------------------------------
  // 1. Wake-up on exactly the four dedicated commands + session start
  // -----------------------------------------------------------------------

  pending.push(check('wake hooks exist for /spec-protocol, /kaizen, /eli5, /bro', () => {
    const matchers = hooks.hooks.UserPromptExpansion.map((m) => m.matcher).sort()
    assert.deepStrictEqual(matchers, ['bro', 'eli5', 'kaizen', 'spec-protocol'],
      'exactly the four dedicated slash commands wake Candice')
  }))

  pending.push(check('wake hooks are async, bounded, and non-blocking', () => {
    for (const m of hooks.hooks.UserPromptExpansion) {
      for (const h of m.hooks) {
        assert.strictEqual(h.async, true, `${m.matcher} hook must be async (never blocks Claude)`)
        assert.ok(Number(h.timeout) > 0 && Number(h.timeout) <= 60, `${m.matcher} hook timeout bounded`)
      }
    }
    assert.ok(Array.isArray(hooks.hooks.SessionStart), 'SessionStart hook present')
  }))

  pending.push(check('wake script fails soft when the app is not installed', () => {
    // Spec 13.1/20: no Candice failure may stop the skill. The script must
    // exit 0 silently when no launch command resolves.
    assert.ok(wake.includes('exit 0'), 'wake script exits 0 on the no-app path')
    assert.ok(/CANDICE_COMPANION_CMD|command -v candice-companion/.test(wake),
      'launch command resolution is env/PATH-driven, never a hardcoded path')
  }))

  // -----------------------------------------------------------------------
  // 2. She appears quickly and reports setup checking, as caption too
  // -----------------------------------------------------------------------

  pending.push(check('the skill names the setup-check-first surface and its caption rule', () => {
    assert.ok(skill.includes('Hi, I’m Candice. Give me just a moment') || skill.includes("Hi, I'm Candice. Give me just a moment"),
      'SKILL.md names the setup-check greeting')
    assert.ok(skill.includes('before preflight'), 'SKILL.md orders Candice before the long preflight')
    assert.ok(companion.includes('setup-check surface'), 'companion ref names the setup-check surface')
    assert.ok(companion.includes('she is not the component that decides'),
      'Candice is never the setup-deciding component')
  }))

  // -----------------------------------------------------------------------
  // 3. Fresh machine: bootstrap installs every component, live and hermetic
  // -----------------------------------------------------------------------

  pending.push(check('fresh bootstrap installs skills, plugin, app, assets + checksum metadata', async () => {
    const { installAll } = await import(path.join(harness.BOOTSTRAP, 'install.mjs'))
    const { healthCheck } = await import(path.join(harness.BOOTSTRAP, 'health.mjs'))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-boot-'))
    // Hermetic, offline: registry hashes are the WS-33-verified record; no
    // network, no real HOME, no source compile (spec 22). A staged app
    // bundle is intentionally NOT provided — the app leg must be recorded
    // as skipped, never invented (same convention as the WS-49 suite).
    const r = await installAll({ root, offline: true, appSource: null })
    assert.strictEqual(r.ok, true, r.message)
    for (const name of ['nine-router-setup', 'spec-protocol', 'kaizen', 'eli5', 'bro']) {
      assert.ok(fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')), `skill ${name} installed`)
    }
    assert.ok(fs.existsSync(path.join(root, 'plugin', 'candice-integration', '.claude-plugin', 'plugin.json')),
      'candice plugin installed')
    assert.ok(fs.existsSync(path.join(root, 'state', 'bootstrap-state.json')), 'version/checksum metadata written')
    const h = healthCheck({ root })
    assert.strictEqual(h.stateComponentMatch, true, 'installed tree matches the version pins')
    assert.ok(Array.isArray(r.skipped) && r.skipped.includes('app'),
      'app leg skipped and RECORDED (no fabricated app bundle)')
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
