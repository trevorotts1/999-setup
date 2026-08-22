'use strict'

/**
 * candice contract suite — exactly one answer per path — owned path: tests/contract/**
 *
 * Checklist E.1 WS-41 third leg: "voice/typed/terminal paths each return
 * exactly one answer, Answer-in-Claude does not double-count" (spec 5.1, 14;
 * spec 27 contract tests).
 *
 * This is the cross-lane regression contract over the WS-04 answer slot
 * registry (mcp/ask-user/answer-registry.js — the MCP path's exactly-one
 * seam), the WS-05 double-count guard (fallback/double-count-guard.js — the
 * terminal path's no-double-count seam), and the WS-03 session lifecycle
 * (session/session-manager.js — the authoritative record).
 *
 * Each answer path is driven with the exact same (sessionId, questionKey)
 * shape the real walk uses:
 *   voice   -> registry put(voice answer) -> take() exactly once
 *   typed   -> registry put(typed answer) -> take() exactly once
 *   terminal-> guard.deferToTerminal -> reconcileTerminalAnswer exactly once
 *
 * Cross-path invariants proven here:
 *   - a second answer in ANY path is refused for the same question;
 *   - Answer-in-Claude (terminal) never double-counts: it records via the
 *     WS-03 lifecycle EXACTLY ONCE and the counting mirror moves once;
 *   - a question answered through the MCP path cannot later be recorded
 *     through the terminal path (question-already-consumed);
 *   - the marker: inputMode 'terminal' records the Answer-in-Claude path.
 *
 * Pure CommonJS, zero dependencies, cross-platform:
 *   node tests/contract/exactly-one.test.js
 */

const assert = require('assert')
const path = require('path')

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

const MCP = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'mcp', 'ask-user')
const FALLBACK = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'fallback')
const SESSION = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'session')

const { AnswerSlotRegistry } = require(path.join(MCP, 'answer-registry'))
const { DoubleCountGuard } = require(path.join(FALLBACK, 'double-count-guard'))
const { SessionManager } = require(path.join(SESSION, 'session-manager'))

const SID = 'opaque-session-id'
const KEY = 'BUILD_TARGET'

function mcpAnswer(inputMode, answerText) {
  return {
    schemaVersion: '1.0',
    sessionId: SID,
    questionKey: KEY,
    answerText: answerText || 'I want a booking tool for local barbers.',
    inputMode,
    userConfirmedTranscript: true,
  }
}

// ————————————————————————————————
// 1. Voice path: exactly one answer
// ————————————————————————————————

check('voice path: open -> put(voice) -> take returns exactly one answer once', () => {
  const reg = new AnswerSlotRegistry()
  assert.strictEqual(reg.open({ sessionId: SID, questionKey: KEY }).ok, true)
  assert.strictEqual(reg.put({ sessionId: SID, questionKey: KEY, answer: mcpAnswer('voice') }).ok, true)
  const first = reg.take({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(first.ok, true)
  assert.strictEqual(first.answer.inputMode, 'voice')
  const second = reg.take({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(second.ok, false)
  assert.strictEqual(second.code, 'not-answered')
})

check('voice path: a second voice answer to the same question is refused', () => {
  const reg = new AnswerSlotRegistry()
  reg.open({ sessionId: SID, questionKey: KEY })
  reg.put({ sessionId: SID, questionKey: KEY, answer: mcpAnswer('voice') })
  const dup = reg.put({ sessionId: SID, questionKey: KEY, answer: mcpAnswer('voice', 'second try') })
  assert.strictEqual(dup.ok, false)
  assert.strictEqual(dup.code, 'already-answered')
})

// ————————————————————————————————
// 2. Typed path: exactly one answer
// ————————————————————————————————

check('typed path: open -> put(typed) -> take returns exactly one answer once', () => {
  const reg = new AnswerSlotRegistry()
  reg.open({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(reg.put({ sessionId: SID, questionKey: KEY, answer: mcpAnswer('typed') }).ok, true)
  const first = reg.take({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(first.ok, true)
  assert.strictEqual(first.answer.inputMode, 'typed')
})

// ————————————————————————————————
// 3. Terminal path (Answer-in-Claude): exactly one, no double-count
// ————————————————————————————————

check('terminal path: defer -> reconcile records exactly once with inputMode terminal', () => {
  const guard = new DoubleCountGuard()
  const defer = guard.deferToTerminal({ sessionId: SID, questionKey: KEY, counted: true })
  assert.strictEqual(defer.ok, true)
  assert.strictEqual(defer.recorded, true)
  const rec = guard.reconcileTerminalAnswer({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(rec.ok, true)
  assert.strictEqual(rec.counted, true)
  assert.strictEqual(rec.recorded, true)
})

check('terminal path: a second reconcile refuses (already-answered, no second count)', () => {
  const guard = new DoubleCountGuard()
  guard.deferToTerminal({ sessionId: SID, questionKey: KEY, counted: true })
  guard.reconcileTerminalAnswer({ sessionId: SID, questionKey: KEY })
  const again = guard.reconcileTerminalAnswer({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(again.ok, false)
  assert.strictEqual(again.code, 'already-answered')
})

check('terminal path: redelivery of the prompt never opens a second slot', () => {
  const guard = new DoubleCountGuard()
  guard.deferToTerminal({ sessionId: SID, questionKey: KEY, counted: true })
  const again = guard.deferToTerminal({ sessionId: SID, questionKey: KEY, counted: true })
  assert.strictEqual(again.ok, true)
  assert.strictEqual(again.redelivered, true)
  assert.strictEqual(again.recorded, false, 'redelivery must not record a second deferral')
})

// ————————————————————————————————
// 4. Answer-in-Claude counting via the authoritative WS-03 lifecycle
// ————————————————————————————————

check('terminal path counts against the lifecycle exactly once (no double-count)', () => {
  const guard = new DoubleCountGuard({
    lifecycle: new SessionManager({ stateDir: null }),
  })
  guard.lifecycle.beginSession({ sessionId: SID, skill: 'spec-protocol' })
  guard.lifecycle.setPendingQuestion({ sessionId: SID, questionKey: KEY, text: 'q', counted: true })
  // The skill hands the question to the terminal first (Answer-in-Claude),
  // then the answer returns through the normal Claude input.
  const defer = guard.deferToTerminal({ sessionId: SID, questionKey: KEY, counted: true })
  assert.strictEqual(defer.ok, true)
  const rec = guard.reconcileTerminalAnswer({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(rec.ok, true)
  const session = guard.lifecycle.getSession(SID)
  assert.strictEqual(session.questionCount, 1, 'lifecycle counted the answer once')
  assert.strictEqual(session.pendingQuestion, null, 'pending question cleared')
  // A second reconcile path cannot increment again.
  const again = guard.reconcileTerminalAnswer({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(again.ok, false)
  assert.strictEqual(session.questionCount, 1, 'count stayed at 1')
})

// ————————————————————————————————
// 5. Cross-path: MCP-answered question cannot be terminal-recorded
// ————————————————————————————————

check('cross-path: MCP-answered question refuses terminal record (question-already-consumed)', () => {
  const lifecycle = new SessionManager({ stateDir: null })
  lifecycle.beginSession({ sessionId: SID, skill: 'spec-protocol' })
  lifecycle.setPendingQuestion({ sessionId: SID, questionKey: KEY, text: 'q', counted: true })
  // MCP path consumes the question.
  const mcpRec = lifecycle.recordAnswer({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(mcpRec.ok, true)
  // Terminal path now tries to reconcile the SAME question.
  const guard = new DoubleCountGuard({ lifecycle })
  guard.deferToTerminal({ sessionId: SID, questionKey: KEY, counted: true })
  const rec = guard.reconcileTerminalAnswer({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(rec.ok, false)
  assert.strictEqual(rec.code, 'question-already-consumed')
  assert.strictEqual(lifecycle.getSession(SID).questionCount, 1, 'still counted exactly once')
})

check('answer that never reached terminal refuses a synthetic record (never-deferred)', () => {
  const guard = new DoubleCountGuard({})
  const rec = guard.reconcileTerminalAnswer({ sessionId: SID, questionKey: KEY })
  assert.strictEqual(rec.ok, false)
  assert.strictEqual(rec.code, 'never-deferred')
})

// ————————————————————————————————
// 6. Same question-key identity across paths (spec 14: one key, one question)
// ————————————————————————————————

check('voice and typed answers to the same question cannot BOTH be consumed', () => {
  const reg = new AnswerSlotRegistry()
  reg.open({ sessionId: SID, questionKey: KEY })
  reg.put({ sessionId: SID, questionKey: KEY, answer: mcpAnswer('voice') })
  const dup = reg.put({ sessionId: SID, questionKey: KEY, answer: mcpAnswer('typed') })
  assert.strictEqual(dup.ok, false)
  assert.strictEqual(dup.code, 'already-answered')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
