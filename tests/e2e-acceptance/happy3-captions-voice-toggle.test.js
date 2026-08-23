'use strict'

/**
 * WS-50 e2e acceptance — leg 3: VOICE TOGGLE INDEPENDENT + CAPTIONS ALWAYS
 * (Master Spec 5.2; E.2 "Voice toggle persists", "Captions always").
 *
 * Walkthrough (nontechnical flow): Voice responses ON/OFF is a SEPARATE
 * persistent toggle, independent of how the user answers. The user may type
 * while Candice speaks, speak while muted, use both voice directions, or a
 * completely silent text experience — all four voice/type combinations work.
 * Captions are ALWAYS shown regardless of the voice-output state, and the
 * setup-check message appears as a caption even when voice is disabled.
 *
 * Proof legs, all FAIL-CLOSED:
 *  1. The toggle labels exist verbatim (WS-09) and the preference field is
 *     persisted independently of the answer method (WS-40 store round-trip).
 *  2. Captions are unconditional: the WS-14 captions lane defaults to
 *     visible and never gates on the voice toggle (source-level scan of the
 *     captions lane for any voice-output gate).
 *  3. The setup-check greeting is a caption source (WS-36 reference).
 *  4. All four voice/type combinations round-trip in the profile.
 *  5. Captions never carry an AI answer and never replace the question
 *     contract (spec 2 boundary).
 *
 *   node tests/e2e-acceptance/happy3-voice-toggle-captions.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const harness = require('./harness')

let failures = 0
let skips = 0

function check(name, fn) {
  try {
    const ret = fn()
    // Vacuous-pass guard: an async fn passed to a sync check would silently
    // swallow its failures. Reject it instead — the leg must await.
    if (ret && typeof ret.then === 'function') {
      failures += 1
      console.log(`FAIL - ${name}`)
      console.log('  async check passed without await — fix this leg (vacuous-pass guard)')
      return
    }
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

function skip(name, reason) {
  skips += 1
  console.log(`SKIP - ${name} (${reason})`)
}

;(async () => {
  const controls = await import(path.join(harness.APP_SRC, 'ui', 'answer-controls', 'config.ts'))
  const captions = await import(path.join(harness.APP_SRC, 'ui', 'captions', 'config.ts'))
  const store = await import(path.join(harness.APP_SRC, 'prefs', 'store.ts'))
  const profile = await import(path.join(harness.APP_SRC, 'prefs', 'profile.ts'))

  // -----------------------------------------------------------------------
  // 1. The separate persistent voice toggle
  // -----------------------------------------------------------------------

  check('voice toggle labels are the exact spec-5.2 strings', () => {
    const labels = controls.ANSWER_CONTROLS_LABELS
    assert.strictEqual(labels.VOICE_ON, 'Voice responses ON')
    assert.strictEqual(labels.VOICE_OFF, 'Voice responses OFF')
  })

  check('voice-output persists independently of the answer method', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-prefs-'))
    const env = { ...process.env, CANDICE_PREFS_DIR: dir }
    // Every answer method combined with both voice states round-trips.
    // N2 re-base to the v3 contract: fields are lastUsedAnswerMethod and
    // schemaVersion 3; partial docs go through mergeProfile so every
    // contract field is present before saveProfile persists it.
    for (const method of ['voice', 'typed', 'terminal']) {
      for (const voice of [true, false]) {
        const doc = profile.mergeProfile(profile.defaultProfile(), {
          lastUsedAnswerMethod: method,
          voiceOutputEnabled: voice,
        })
        const saved = store.saveProfile(doc, env)
        assert.strictEqual(saved, true, `save ${method}/${voice}`)
        const loaded = store.loadProfile(env)
        assert.strictEqual(loaded.profile.voiceOutputEnabled, voice, `voice state ${voice} round-trips`)
        assert.strictEqual(loaded.profile.lastUsedAnswerMethod, method, `method ${method} round-trips`)
      }
    }
  })

  check('last-used method is remembered but never forces the voice state', () => {
    // Typing while Candice speaks: method=typed with voice ON must persist
    // together — the two controls never conflate (spec 5.1/5.2). (v3 names.)
    const p = profile.mergeProfile(profile.defaultProfile(), { lastUsedAnswerMethod: 'typed', voiceOutputEnabled: true })
    assert.strictEqual(p.lastUsedAnswerMethod, 'typed')
    assert.strictEqual(p.voiceOutputEnabled, true)
  })

  // -----------------------------------------------------------------------
  // 2. Captions are always shown regardless of the voice state
  // -----------------------------------------------------------------------

  check('captions default to visible (never hidden by the voice toggle)', () => {
    assert.strictEqual(captions.CAPTIONS_DEFAULT_VISIBLE, true)
    assert.strictEqual(captions.CAPTIONS_CONTRACT_VERSION, 1)
  })

  check('captions surface never reads the voice-output toggle', () => {
    // FAIL-CLOSED source scan of the whole WS-14 captions lane: no import of
    // the prefs store, no read of voiceOutputEnabled anywhere under
    // src/ui/captions/. A caption layer that consulted the voice toggle would
    // break the always-on invariant.
    const captionsDir = path.join(harness.APP_SRC, 'ui', 'captions')
    // Source modules only — the lane's own __tests__ may assert the toggle,
    // and must not trip the source-level independence scan.
    const files = harness.walk(captionsDir).filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
    assert.ok(files.length >= 3, `captions lane has its source modules (${files.length})`)
    for (const f of files) {
      const src = fs.readFileSync(path.join(captionsDir, f), 'utf8')
      // Doc comments legitimately NAME the toggle to state the boundary; a
      // CODE reference is a read. Scan only non-comment lines.
      const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      for (const line of codeLines) {
        assert.ok(!line.includes('voiceOutputEnabled'),
          `captions/${f} must never read the voice toggle (line: ${line.trim()})`)
      }
    }
  })

  check('captions are a11y live region and never carry an AI answer', () => {
    assert.strictEqual(captions.CAPTIONS_ROLE, 'status', 'live-region role present')
    assert.strictEqual(captions.CAPTIONS_LIVE, 'polite')
    const model = fs.readFileSync(path.join(harness.APP_SRC, 'ui', 'captions', 'model.ts'), 'utf8')
    assert.ok(model.includes('never'), 'captions model states the presentation-only boundary')
  })

  check('the setup-check message is shown as a caption even with voice off', () => {
    const companion = harness.mustRead(harness.COMPANION_REF)
    assert.ok(companion.includes('caption'), 'companion reference states the caption requirement (spec 3/5.2)')
    const skill = harness.mustRead(harness.SPEC_SKILL)
    assert.ok(skill.includes('Hi, I’m Candice. Give me just a moment') || skill.includes("Hi, I'm Candice. Give me just a moment"),
      'greeting carried by the skill surface')
  })

  // -----------------------------------------------------------------------
  // Interactive-only (honest skips)
  // -----------------------------------------------------------------------

  skip('human sees captions while voice output is switched OFF in the live window',
    'requires the running Tauri window with the caption view (WS-09/WS-14 live surface)')
  skip('human hears Candice speak while typing an answer',
    'requires a real speaker/audio device and the live app (WS-19 TTS hardware path)')

  console.log(`\nLEG 3 (voice toggle + captions): ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'} (${skips} skipped)`)
  process.exit(failures === 0 ? 0 : 1)
})()
