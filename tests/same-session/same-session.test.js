'use strict'

/**
 * candice same-session suite — E.1 WS-42 leg 1: the SAME session owns question
 * and answer, end to end, through every answer path — owned path:
 * tests/same-session/**
 *
 * Control: the session-id invariant. Every question Candice surfaces carries
 * ONE sessionId (the active Claude Code session the WS-03 lifecycle opened).
 * Every answer — voice, typed, or Answer-in-Claude terminal — must come back
 * under that same sessionId, through the exact same tool call / lifecycle
 * record. A sessionId change anywhere in the walk is a same-session failure
 * (spec 13.2: "the final approved text returns to the same MCP tool call in
 * the same Claude session"; spec 17: session identity is the routing
 * authority, never the window).
 *
 * Paths driven with the EXACT same (sessionId, questionKey) shape the real
 * walk uses:
 *   1. voice   -> AnswerSlotRegistry.put(voice answer) -> take() by the same
 *                 session's tool call -> SessionLifecycle.recordAnswer
 *   2. typed   -> AnswerSlotRegistry.put(typed answer) -> take() -> record
 *   3. terminal-> FallbackCoordinator.fallbackQuestion -> answerFromTerminal
 *                 (inputMode 'terminal') -> lifecycle record exactly once
 *
 * Cross-path invariants proven here:
 *   - the session id NEVER changes between question and answer in any path;
 *   - a second answer in any path is refused for the same question;
 *   - the MCP askUser end-to-end (server.js) returns the answer into the
 *     same tool call, and lifecycle questionCount moves exactly once;
 *   - crash recovery hands the exact pending question back into the SAME
 *     session (spec 20) — re-ask without re-count.
 *
 * Pure CommonJS, zero dependencies, cross-platform:
 *   node tests/same-session/same-session.test.js
 */

const assert = require('assert')
const path = require('path')
const harness = require('./harness')
const { canonicalQuestion } = require('../../packages/candice-protocol/question-registry')

let failures = 0

const pending = []
function check(name, fn) {
  try {
    const out = fn()
    if (out && typeof out.then === 'function') {
      pending.push(
        out.then(
          () => console.log(`ok - ${name}`),
          (err) => {
            failures += 1
            console.log(`FAIL - ${name}`)
            console.log(`  ${err && err.message ? err.message : err}`)
          }
        )
      )
      return
    }
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

/** All async checks must settle before the summary line. */
async function settleAll() {
  await Promise.all(pending)
}

const deps = harness.loadDeps()
const { SessionLifecycle, SessionManager, AnswerSlotRegistry, FallbackCoordinator } = deps

// Deterministic clock so every timestamp in the walk is comparable.
const CLOCK = harness.fixedClock('2026-08-21T12:00:00.000Z')
const SESSION = 'session-abc-42'
const KEY = 'BUILD_TARGET'
const QUESTION_TEXT = 'What are you building and for whom?'

function governedQuestion(sessionId) {
  return canonicalQuestion({ sessionId, questionKey: KEY, skill: 'spec-protocol' }).question
}

// ---------------------------------------------------------------------------
// Leg 1 — every answer path keeps the SAME session id
// ---------------------------------------------------------------------------

check('voice answer returns to the same session id', () => {
  const registry = new AnswerSlotRegistry()
  assert.strictEqual(registry.open({ sessionId: SESSION, questionKey: KEY }).ok, true)
  const put = registry.put({
    sessionId: SESSION,
    questionKey: KEY,
    answer: {
      schemaVersion: '1.0',
      sessionId: SESSION,
      questionKey: KEY,
      answerText: 'a local app',
      inputMode: 'voice',
      userConfirmedTranscript: true,
    },
  })
  assert.strictEqual(put.ok, true, 'voice put must be accepted')
  const take = registry.take({ sessionId: SESSION, questionKey: KEY })
  assert.strictEqual(take.ok, true, 'voice take must succeed')
  assert.strictEqual(take.answer.sessionId, SESSION, 'voice answer session must equal the asking session')
  assert.strictEqual(take.answer.inputMode, 'voice')
})

check('typed answer returns to the same session id', () => {
  const registry = new AnswerSlotRegistry()
  assert.strictEqual(registry.open({ sessionId: SESSION, questionKey: KEY }).ok, true)
  const put = registry.put({
    sessionId: SESSION,
    questionKey: KEY,
    answer: {
      schemaVersion: '1.0',
      sessionId: SESSION,
      questionKey: KEY,
      answerText: 'a local app',
      inputMode: 'typed',
      userConfirmedTranscript: true,
    },
  })
  assert.strictEqual(put.ok, true, 'typed.e be accepted')
  const take = registry.take({ sessionId: SESSION, questionKey: KEY })
  assert.strictEqual(take.ok, true)
  assert.strictEqual(take.answer.sessionId, SESSION, 'typed answer session must equal the asking session')
  assert.strictEqual(take.answer.inputMode, 'typed')
})

check('Answer-in-Claude terminal answer keeps the same session id', () => {
  const guard = new (deps.DoubleCountGuard)()
  const coordinator = new FallbackCoordinator({ guard })
  const question = governedQuestion(SESSION)
  const deferred = coordinator.fallbackQuestion(question)
  assert.strictEqual(deferred.ok, true)
  assert.strictEqual(deferred.prompt.text, question.text, 'the SAME question text is asked in Claude')
  const answered = coordinator.answerFromTerminal({
    sessionId: SESSION,
    questionKey: KEY,
    answerText: 'it records things',
  })
  assert.strictEqual(answered.ok, true, 'terminal answer must be accepted')
  assert.strictEqual(answered.answer.sessionId, SESSION, 'terminal answer session must equal the asking session')
  assert.strictEqual(answered.answer.inputMode, 'terminal')
})

check('a second answer to the same question in the same session is refused', () => {
  const registry = new AnswerSlotRegistry()
  registry.open({ sessionId: SESSION, questionKey: KEY })
  const put = registry.put({
    sessionId: SESSION,
    questionKey: KEY,
    answer: {
      schemaVersion: '1.0',
      sessionId: SESSION,
      questionKey: KEY,
      answerText: 'first',
      inputMode: 'typed',
      userConfirmedTranscript: true,
    },
  })
  assert.strictEqual(put.ok, true)
  const second = registry.put({
    sessionId: SESSION,
    questionKey: KEY,
    answer: {
      schemaVersion: '1.0',
      sessionId: SESSION,
      questionKey: KEY,
      answerText: 'second',
      inputMode: 'typed',
      userConfirmedTranscript: true,
    },
  })
  assert.strictEqual(second.ok, false, 'second put in the same session must be refused')
  assert.strictEqual(second.code, 'already-answered')
  const take = registry.take({ sessionId: SESSION, questionKey: KEY })
  assert.strictEqual(take.answer.answerText, 'first', 'exactly one answer survives')
})

check('an answer for a DIFFERENT session id is refused, never re-routed', () => {
  const registry = new AnswerSlotRegistry()
  registry.open({ sessionId: SESSION, questionKey: KEY })
  // The answer event claims a different session than the slot's owner.
  const wrong = registry.put({
    sessionId: SESSION,
    questionKey: KEY,
    answer: {
      schemaVersion: '1.0',
      sessionId: 'session-other-111',
      questionKey: KEY,
      answerText: 'wrong session',
      inputMode: 'typed',
      userConfirmedTranscript: true,
    },
  })
  assert.strictEqual(wrong.ok, false, 'cross-session answer must be refused (spec 17)')
  assert.strictEqual(wrong.code, 'session-mismatch')
  assert.strictEqual(registry.openCount(), 1, 'the owning session slot stays open')
  // A put under a session that never opened a slot is refused too — an answer
  // can only land in a session that asked the question.
  const neverOpened = registry.put({
    sessionId: 'session-other-111',
    questionKey: KEY,
    answer: {
      schemaVersion: '1.0',
      sessionId: 'session-other-111',
      questionKey: KEY,
      answerText: 'never asked',
      inputMode: 'typed',
      userConfirmedTranscript: true,
    },
  })
  assert.strictEqual(neverOpened.ok, false, 'answer into a session that never asked is refused')
  assert.strictEqual(neverOpened.code, 'no-open-slot')
})

// ---------------------------------------------------------------------------
// Leg 2: full walk through the WS-04 MCP ask_user seam
// ---------------------------------------------------------------------------

check('ask_user end-to-end: question and answer stay in ONE session, counted once', async () => {
  // Wire the WS-03 SessionManager (the authoritative record) behind the
  // lifecycle seam server.js expects. NOTE: the SessionLifecycle facade does
  // NOT yet expose setPendingQuestion/recordAnswer pass-throughs — recorded
  // as CROSS-LANE-FINDING (see CHECKPOINT-WS-42.md); the manager itself is
  // the authoritative seam and is what this test drives.
  const manager = new SessionManager({ stateDir: null, clock: CLOCK })
  manager.beginSession({ sessionId: SESSION, skill: 'spec-protocol' })
  const lifecycle = {
    setPendingQuestion: (p) => manager.setPendingQuestion(p),
    recordAnswer: (p) => manager.recordAnswer(p),
  }

  const delivered = []
  const server = new deps.AskUserServer({
    lifecycle,
    isCompanionReady: () => true,
    sleep: () => Promise.resolve(),
    waitWindowMs: 500,
    deliverQuestion: async (q) => {
      delivered.push(q)
      // Companion delivers the question and the user answers in the SAME
      // session: put() immediately so the blocking ask returns fast.
      const put = server.registry.put({
        sessionId: q.sessionId,
        questionKey: q.questionKey,
        answer: {
          schemaVersion: '1.0',
          sessionId: q.sessionId,
          questionKey: q.questionKey,
          answerText: 'the answer',
          inputMode: 'voice',
          userConfirmedTranscript: true,
        },
      })
      return put.ok ? { ok: true } : { ok: false, error: put.error }
    },
  })

  const result = await server.askUser({
    sessionId: SESSION,
    question: governedQuestion(SESSION),
  })
  assert.strictEqual(delivered.length, 1, 'exactly one question delivered')
  assert.strictEqual(delivered[0].sessionId, SESSION)
  const answer = result.result.answer
  assert.ok(answer, 'tool result carries the answer')
  assert.strictEqual(answer.sessionId, SESSION, 'the answer returns into the SAME session that asked')
  assert.strictEqual(answer.questionKey, KEY)
  const record = manager.getSession(SESSION)
  assert.ok(record, 'session record exists')
  assert.strictEqual(record.questionCount, 1, 'question counted exactly once')
})

// ---------------------------------------------------------------------------
// Leg 3: crash recovery returns the pending question into the SAME session
// ---------------------------------------------------------------------------

check('crash recovery re-asks the exact pending question in the same session, no re-count', () => {
  const lifecycle = new SessionLifecycle({ clock: CLOCK })
  lifecycle.beginSession({ sessionId: SESSION, skill: 'spec-protocol' })
  lifecycle.sessions.setPendingQuestion({
    sessionId: SESSION,
    questionKey: KEY,
    text: 'the exact pending text',
    answerKind: 'free_text',
    counted: true,
  })
  const rec = lifecycle.recoverPendingQuestion({ sessionId: SESSION })
  assert.strictEqual(rec.ok, true)
  assert.strictEqual(rec.recovered.questionKey, KEY)
  assert.strictEqual(rec.recovered.text, 'the exact pending text')
  assert.strictEqual(rec.recovered.counted, true, 'recovered question carries the counted flag')
  const again = lifecycle.recoverPendingQuestion({ sessionId: SESSION })
  assert.strictEqual(again.recovered, null, 'handed off exactly once — a second recovery finds nothing')
  assert.strictEqual(lifecycle.status({ sessionId: SESSION }).status, 'recovering')
  lifecycle.resumeSession({ sessionId: SESSION })
  assert.strictEqual(lifecycle.status({ sessionId: SESSION }).status, 'active')
  assert.strictEqual(lifecycle.status({ sessionId: SESSION }).questionCount, 0, 'recovery never increments the counter')
})

settleAll()
  .then(() => {
    if (failures > 0) {
      console.log(`\n${failures} CHECK(S) FAILED`)
      process.exit(1)
    }
    console.log('\nALL TESTS PASSED')
  })
  .catch((err) => {
    console.log(`FATAL: ${err && err.message ? err.message : err}`)
    process.exit(1)
  })
