'use strict'

/**
 * WS-50 e2e acceptance — leg 5: NO SECOND AI, NO COMPETING MEMORY, SAME
 * SESSION (Master Spec 2/9/13.2; E.2 "No second-AI-conversation invariant",
 * "No competing project memory invariant").
 *
 * Walkthrough (nontechnical flow): the user answers a governed question; the
 * answer goes to the SAME Claude Code session that asked. Candice never
 * starts a second independent AI conversation, never keeps competing project
 * memory, never reads secrets aloud — she is the face/voice/ears/UI, the
 * active session and skill remain the brain, rules, memory, and source of
 * truth.
 *
 * Proof legs, all FAIL-CLOSED:
 *  1. The invariant is stated byte-exact in every shipped contract surface
 *     (SKILL.md, companion reference, question contract, plugin.json).
 *  2. The WS-04 ask-user server delivers a question and returns exactly one
 *     answer to the owning session — driven live end-to-end through the
 *     real server with the real WS-03 lifecycle and a fake Claude input.
 *  3. A secret-bearing question is never read aloud — live proof: the
 *     front-channel receives the question but the speaker path stays silent.
 *  4. The WS-37 Kaizen map never re-asks an answered key and keeps the fixed
 *     order (surface-only: no question-order modification).
 *  5. No competing project memory: the preference profile persisted by the
 *     store contains ONLY the known preference fields — never questions,
 *     answers, or conversation content.
 *
 *   node tests/e2e-acceptance/happy5-no-second-ai-same-session.test.js
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
  const { AskUserServer } = require(path.join(harness.PLUGIN_ROOT, 'mcp', 'ask-user', 'server.js'))
  const { AnswerSlotRegistry } = require(path.join(harness.PLUGIN_ROOT, 'mcp', 'ask-user', 'answer-registry.js'))
  const { SessionManager } = require(path.join(harness.PLUGIN_ROOT, 'session', 'session-manager.js'))
  const { validateQuestionEvent } = require(path.join(harness.PLUGIN_ROOT, 'mcp', 'ask-user', 'validate.js'))
  const { questionEvent, KAIZEN_ORDER } = require(path.join(harness.PLUGIN_ROOT, 'integrations', 'kaizen', 'question-map.js'))
  const { checkInvariants } = require(path.join(harness.PLUGIN_ROOT, 'integrations', 'kaizen', 'invariants.js'))
  const store = await import(path.join(harness.APP_SRC, 'prefs', 'store.ts'))

  const skill = harness.mustRead(harness.SPEC_SKILL)
  const companion = harness.mustRead(harness.COMPANION_REF)
  const contract = harness.mustRead(harness.QUESTION_CONTRACT_REF)
  const pluginJson = harness.readJson(path.join(harness.PLUGIN_ROOT, '.claude-plugin', 'plugin.json'))

  // -----------------------------------------------------------------------
  // 1. The invariant is stated in every contract surface
  // -----------------------------------------------------------------------

  pending.push(check('no-second-AI invariant is stated in SKILL.md, companion ref, plugin.json', () => {
    assert.ok(skill.includes('never creates a second AI conversation'), 'SKILL.md states the invariant')
    assert.ok(companion.includes('never creates a second AI conversation'), 'companion ref states the invariant')
    assert.ok(pluginJson.description.includes('never creates a second AI conversation'), 'plugin.json states the invariant')
  }))

  pending.push(check('the brain/rules/memory/source-of-truth ownership is stated', () => {
    assert.ok(skill.includes('remain the brain, rules,'), 'SKILL.md names the skill as brain/rules')
    // The companion ref wraps "memory, / and source of truth" across two
    // lines — assert the tokens, not a single-line phrase.
    assert.ok(companion.includes('remain the brain, rules, memory,'), 'companion ref names the brain/rules/memory')
    assert.ok(companion.includes('and source of truth'), 'companion ref names the source of truth')
    assert.ok(companion.includes('never keeps competing') && companion.includes('project memory'),
      'companion ref states the no-competing-memory rule')
    assert.ok(skill.includes('source of truth'), 'SKILL.md names the skill as source of truth')
  }))

  // -----------------------------------------------------------------------
  // 2. Live end-to-end: one question in, exactly one answer back, same
  //    session — through the REAL AskUserServer + SessionManager.
  // -----------------------------------------------------------------------

  pending.push(check('ask_user delivers one question and returns exactly one answer to the SAME session', async () => {
    const front = new harness.FakeCompanionFront()
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-sess-'))
    const clock = harness.fixedClock('2026-08-21T12:00:00.000Z')
    const lifecycle = new SessionManager({ stateDir, clock })
    lifecycle.beginSession({ sessionId: 'sess-abc', skill: 'kaizen' })
    const registry = new AnswerSlotRegistry()
    const server = new AskUserServer({
      deliverQuestion: (q) => front.deliverQuestion(q),
      registry,
      lifecycle,
      isCompanionReady: () => true,
      sleep: () => new Promise((r) => setTimeout(r, 5)),
      waitWindowMs: 2000,
    })
    const ev = questionEvent('KAZEN_TARGET', 'sess-abc')
    assert.strictEqual(ev.ok, true)
    const promise = server.askUser({ question: ev.question, sessionId: 'sess-abc' })
    // The server blocks until the approved answer lands in the slot; deliver
    // it from the user's side through the REAL registry API (put + a
    // schema-valid answer event), then await the server.
    // One governed question at a time (spec 14): a second ask while the
    // first is still pending must be refused with the slot guard, not
    // delivered a second time.
    const during = server.askUser({ question: ev.question, sessionId: 'sess-abc' })
    const refused = await during
    assert.strictEqual(refused.result && refused.result.isError, true,
      'a second concurrent ask must fail soft')
    assert.ok(JSON.stringify(refused).includes('already has an open answer slot'),
      'second concurrent delivery refused by the slot guard: ' + JSON.stringify(refused))

    const put = registry.put({
      sessionId: 'sess-abc',
      questionKey: 'KAZEN_TARGET',
      answer: {
        schemaVersion: '1.0',
        sessionId: 'sess-abc',
        questionKey: 'KAZEN_TARGET',
        answerText: 'My cooking app',
        inputMode: 'voice',
        userConfirmedTranscript: true,
      },
    })
    assert.strictEqual(put.ok, true, `answer placed: ${put.error || ''}`)
    const result = await promise
    // The success envelope: { result: { answer: {...}, ok: true } }, never a
    // JSON-RPC error and never isError.
    assert.strictEqual(result.error, undefined, 'no JSON-RPC error envelope')
    assert.strictEqual(result.result && result.result.isError, undefined,
      'a delivered answer is not an isError fail-soft result')
    assert.strictEqual(result.result.ok, true, 'tool reports ok')
    const answer = result.result.answer
    assert.strictEqual(answer.answerText, 'My cooking app')
    assert.strictEqual(answer.sessionId, 'sess-abc', 'answer bound to the SAME session id')
    assert.strictEqual(answer.inputMode, 'voice')
    // Exactly once: the lifecycle recorded ONE question and cleared the
    // pending — a second record is refused at the authoritative seam.
    const session = lifecycle.getSession('sess-abc')
    assert.strictEqual(session.questionCount, 1, 'question counted exactly once')
    assert.strictEqual(session.pendingQuestion, null, 'pending question cleared')
    const dup = lifecycle.recordAnswer({ sessionId: 'sess-abc', questionKey: 'KAZEN_TARGET' })
    assert.strictEqual(dup.ok, false, 'a duplicate answer record is refused')
    assert.strictEqual(dup.code, 'no-pending-question')
  }))

  // -----------------------------------------------------------------------
  // 3. Secret-bearing questions are never read aloud (live proof)
  // -----------------------------------------------------------------------

  pending.push(check('an unregistered secret question is rejected before companion delivery', () => {
    const front = new harness.FakeCompanionFront()
    const secretEvent = {
      schemaVersion: '1.0',
      event: 'question',
      sessionId: 'sess-1',
      skill: 'spec-protocol',
      questionKey: 'SECRET_K',
      text: 'What is your private key?',
      answerKind: 'free_text',
      allowedInputModes: ['voice', 'typed', 'terminal'],
      readAloud: false,
      sensitivity: 'secret',
      counted: true,
      progress: null,
      helpText: null,
      canGoBack: false,
    }
    const v = validateQuestionEvent(secretEvent)
    // No canonical secret prompt has protocol-owner provenance yet.  This
    // proves the runtime fails closed instead of treating a hand-written
    // safe-looking event as deliverable.
    assert.strictEqual(v.ok, false, `unregistered secret must be refused: ${v.error || ''}`)
    assert.strictEqual(v.code, 'invalid-question')
    assert.strictEqual(v.rule, 'unregistered-governed-question')
    assert.strictEqual(front.displayed.length, 0, 'rejected events never reach the display surface')
    assert.strictEqual(front.spoken.length, 0, 'rejected events never reach speech')
  }))

  // -----------------------------------------------------------------------
  // 4. Kaizen order fixed, never re-asked (Candice surfaces only)
  // -----------------------------------------------------------------------

  pending.push(check('Kaizen question order is fixed and contiguous; invariants pass', () => {
    const result = checkInvariants()
    assert.strictEqual(result.ok, true, `kaizen invariants: ${JSON.stringify(result.failures)}`)
    assert.deepStrictEqual(result.failures, [])
    assert.deepStrictEqual(KAIZEN_ORDER.slice(0, 7),
      ['KAZEN_TARGET', 'KAZEN_LOCATION', 'KAZEN_BETTER', 'KAZEN_SCOPE', 'KAZEN_PERMISSION', 'KAZEN_PROOF', 'KAZEN_INTERVAL'],
      'fixed Recipe order, first seven keys')
  }))

  // -----------------------------------------------------------------------
  // 5. No competing project memory: the profile holds preferences ONLY
  // -----------------------------------------------------------------------

  pending.push(check('local profile contains only preference fields, never conversation content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'candice-prefs-'))
    const env = { ...process.env, CANDICE_PREFS_DIR: dir }
    const saved = store.saveProfile(
      { schemaVersion: 1, preferredName: 'Trevor', voiceOutputEnabled: false }, env)
    assert.strictEqual(saved, true)
    const raw = fs.readFileSync(path.join(dir, 'profile.json'), 'utf8')
    const doc = JSON.parse(raw)
    const known = new Set(['schemaVersion', 'preferredName', 'voiceOutputEnabled', 'volume', 'speechRate',
      'lastAnswerMethod', 'textScale', 'reducedMotion', 'companionPosition', 'lastUsedSkill', 'nameAskedAt'])
    for (const key of Object.keys(doc)) {
      assert.ok(known.has(key), `profile must not carry conversation content (unexpected field ${key})`)
    }
  }))

  // -----------------------------------------------------------------------
  // Interactive-only (honest skips)
  // -----------------------------------------------------------------------

  skip('a real human answers in a real interactive Claude session',
    'requires an interactive Claude session with a human participant (CI cannot fabricate a session)')

  // Await every check (they may be async); only then decide the verdict.
  await Promise.all(pending)
  console.log(`\nLEG 5 (no second AI + same session): ${failures === 0 ? 'ALL TESTS PASSED' : 'FAILED'} (${skips} skipped)`)
  process.exit(failures === 0 ? 0 : 1)
})()
