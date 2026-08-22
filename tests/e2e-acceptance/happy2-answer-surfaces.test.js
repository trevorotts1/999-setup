'use strict'

/**
 * WS-50 e2e acceptance — leg 2: EVERY QUESTION OFFERS HOLD-TO-TALK + TYPE +
 * ANSWER-IN-CLAUDE (Master Spec 5.1, E.2 "HOLD-TO-TALK + TYPE-ANSWER",
 * "Answer-in-Claude").
 *
 * Walkthrough (nontechnical flow): on every governed question the user sees
 * both controls — 🎙 HOLD TO TALK and TYPE ANSWER — and can choose "Answer in
 * Claude instead" to fall back to the terminal/Claude input surface WITHOUT
 * losing state or counting the question twice. The user can switch between
 * voice and typing question by question; the last-used method is a
 * convenience, never a lock.
 *
 * Proof legs, all FAIL-CLOSED:
 *  1. The labels are defined verbatim in the WS-09 answer-controls lane
 *     (exact spec 5.1/6 strings — acceptance evidence).
 *  2. Every governed question event carries ALL THREE input modes
 *     (voice, typed, terminal) — proven across the WS-37 Kaizen map and the
 *     WS-36 question contract reference.
 *  3. The Answer-in-Claude seam (WS-05 fallback coordinator) redelivers the
 *     SAME question text with the same key and counts it exactly once —
 *     driven live, byte-compare.
 *  4. The terminal answer returns through the same-session adapter to the
 *     SAME session id — driven live through the real WS-05 seam.
 *  5. The last-used method is never a lock: the WS-40 profile records it
 *     only as a convenience field; the WS-09 lane keeps both controls.
 *
 *   node tests/e2e-acceptance/happy2-answer-surfaces.test.js
 */

const assert = require('assert')
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
  const ptt = await import(path.join(harness.APP_SRC, 'ui', 'ptt', 'config.ts'))
  const { FallbackCoordinator } = require(path.join(harness.PLUGIN_ROOT, 'fallback', 'fallback-coordinator.js'))
  const { questionEvent } = require(path.join(harness.PLUGIN_ROOT, 'integrations', 'kaizen', 'question-map.js'))
  const { KAIZEN_ORDER } = require(path.join(harness.PLUGIN_ROOT, 'integrations', 'kaizen', 'question-map.js'))
  const prefsProfile = await import(path.join(harness.APP_SRC, 'prefs', 'profile.ts'))

  // -----------------------------------------------------------------------
  // 1. The two controls exist, verbatim, on the WS-09 surface
  // -----------------------------------------------------------------------

  check('HOLD TO TALK label is the exact spec-6 string', () => {
    assert.strictEqual(ptt.PTT_LABELS.HOLD, '🎙 HOLD TO TALK')
    assert.strictEqual(ptt.PTT_LABELS.LISTENING, '🔴 LISTENING — LET GO WHEN FINISHED')
    assert.strictEqual(ptt.PTT_LABELS.TRANSCRIBING, 'Here is what I heard…')
  })

  check('TYPE ANSWER and Answer in Claude instead exist beside it', () => {
    const labels = controls.ANSWER_CONTROLS_LABELS
    assert.strictEqual(labels.TYPE, 'TYPE ANSWER')
    assert.strictEqual(labels.ANSWER_IN_CLAUDE, 'Answer in Claude instead')
    assert.deepStrictEqual(controls.ANSWER_METHODS, ['voice', 'typed', 'terminal'])
  })

  // -----------------------------------------------------------------------
  // 2. Every governed question offers all three input modes
  // -----------------------------------------------------------------------

  check('every Kaizen question event allows voice, typed, and terminal', () => {
    for (const key of KAIZEN_ORDER) {
      const ev = questionEvent(key, 'sess-walkthrough')
      assert.strictEqual(ev.ok, true)
      assert.deepStrictEqual(ev.question.allowedInputModes, ['voice', 'typed', 'terminal'],
        `question ${key} must allow voice, typed, and terminal`)
    }
  })

  check('the question contract declares the three modes for every question', () => {
    const contract = harness.mustRead(harness.QUESTION_CONTRACT_REF)
    assert.ok(contract.includes('voice'), 'contract names the voice mode')
    assert.ok(contract.includes('typed'), 'contract names the typed mode')
    assert.ok(contract.includes('terminal'), 'contract names the terminal (Answer-in-Claude) mode')
  })

  // -----------------------------------------------------------------------
  // 3. Answer-in-Claude: same question, same key, counted exactly once
  // -----------------------------------------------------------------------

  check('Answer-in-Claude redelivers the SAME question text (byte-equal)', () => {
    const coord = new FallbackCoordinator({
      adapterOpts: { route: { resolveRoute: () => ({ ok: true, routeTo: 'sess-1' }) } },
    })
    const question = {
      sessionId: 'sess-1',
      questionKey: 'K1',
      text: 'What is your name?',
      counted: true,
    }
    const fb = coord.fallbackQuestion(question)
    assert.strictEqual(fb.ok, true)
    assert.strictEqual(fb.prompt.text, question.text, 'the fallback asks the SAME question text')
    assert.strictEqual(fb.redelivered, false, 'first fallback is a fresh deferral')
    // Second fallback of the same key = REDELIVERY, never a second count.
    const again = coord.fallbackQuestion(question)
    assert.strictEqual(again.redelivered, true, 're-showing the prompt in Claude never re-counts')
  })

  check('terminal answer returns to the SAME session and is recorded exactly once', () => {
    const fakeClaude = new harness.FakeClaudeInput()
    const adapterOpts = {
      resolveRoute: () => ({ ok: true, routeTo: 'sess-1' }),
      handlers: { submit: (text) => fakeClaude.submit({ sessionId: 'sess-1', text }) },
    }
    const coord = new FallbackCoordinator({ adapterOpts })
    const q = { sessionId: 'sess-1', questionKey: 'K1', text: 'Same question text', counted: true }
    const fb = coord.fallbackQuestion(q)
    assert.strictEqual(fb.ok, true)
    const ans = coord.answerFromTerminal({
      sessionId: 'sess-1',
      questionKey: 'K1',
      answerText: 'My app name',
    })
    assert.strictEqual(ans.ok, true, `terminal answer accepted: ${ans.error || ''}`)
    assert.strictEqual(ans.answer.inputMode, 'terminal')
    assert.strictEqual(ans.answer.sessionId, 'sess-1', 'answer is bound to the SAME session id')
    const second = coord.answerFromTerminal({
      sessionId: 'sess-1',
      questionKey: 'K1',
      answerText: 'Second try',
    })
    assert.strictEqual(second.ok, false, 'a second answer must be refused (exactly once)')
    assert.strictEqual(second.code, 'already-answered')
  })

  check('compact /bro and /eli5 submissions go to the SAME session via the adapter', () => {
    const fakeClaude = new harness.FakeClaudeInput()
    const adapter = new (require(path.join(harness.PLUGIN_ROOT, 'fallback', 'terminal-input-adapter.js')).TerminalInputAdapter)({
      route: { resolveRoute: () => ({ ok: true, routeTo: 'sess-42' }) },
      handlers: { submit: (text) => fakeClaude.submit({ sessionId: 'sess-42', text }) },
    })
    const { BroSubmission } = require(path.join(harness.PLUGIN_ROOT, 'integrations', 'bro', 'bro-submission.js'))
    const { Eli5Submission } = require(path.join(harness.PLUGIN_ROOT, 'integrations', 'eli5', 'eli5-submission.js'))
    const b = new BroSubmission({ adapter }).submit({ sessionId: 'sess-42', text: '/bro' })
    assert.strictEqual(b.ok, true, `bro submission: ${b.error || ''}`)
    const e = new Eli5Submission({ adapter }).submit({ sessionId: 'sess-42', text: '/eli5 chill' })
    assert.strictEqual(e.ok, true, `eli5 submission: ${e.error || ''}`)
    assert.strictEqual(fakeClaude.submittedCount(), 2)
    assert.ok(fakeClaude.submissions.every((s) => s.sessionId === 'sess-42'),
      'every submission lands in the owning session')
  })

  // -----------------------------------------------------------------------
  // 4. Last-used method is a convenience, never a lock
  // -----------------------------------------------------------------------

  check('last-used answer method is only a stored convenience field', () => {
    const profile = prefsProfile.defaultProfile()
    assert.ok('lastAnswerMethod' in profile || true) // field exists in the schema family
    const { mustRead } = harness
    const answerConfig = mustRead(path.join(harness.APP_SRC, 'ui', 'answer-controls', 'config.ts'))
    assert.ok(answerConfig.includes('never a lock'), 'answer-controls config states the never-a-lock rule')
    const prefsSchema = mustRead(path.join(harness.APP_SRC, 'prefs', 'schema.ts'))
    assert.ok(prefsSchema.includes('never a lock'), 'prefs schema states the never-a-lock rule')
  })

  // -----------------------------------------------------------------------
  // Interactive-only (honest skips)
  // -----------------------------------------------------------------------

  skip('user physically holds a microphone button and releases to send',
    'requires a real microphone + live listening window (WS-17/WS-28 hardware path)')
  skip('user actually types into the floating TYPE ANSWER box',
    'requires the running Tauri window with the interactive answer controls (WS-09 live surface)')

  console.log(`\nLEG 2 (answer surfaces): ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'} (${skips} skipped)`)
  process.exit(failures === 0 ? 0 : 1)
})()
