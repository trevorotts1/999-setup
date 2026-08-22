'use strict'

/**
 * candice-integration / fallback/fallback.test.js
 * WS-05 tests — owned path: plugins/candice-integration/fallback/**
 *
 * Runs with plain `node` (zero dependencies, cross-platform):
 *   node plugins/candice-integration/fallback/fallback.test.js
 * Exits 0 on PASS, 1 on FAIL. Every assertion prints PASS/FAIL with the exact
 * input that produced it — primary-source evidence for the acceptance run.
 *
 * Covers the WS-05 acceptance criteria (task-graph snapshot required_outputs +
 * acceptance_criteria, E.1 WS-05):
 *   - terminal fallback adapter exists and delivers the question normally in
 *     Claude when MCP is unavailable;
 *   - "Answer in Claude instead" falls back without losing state;
 *   - the question is counted exactly once across both paths (no double-count,
 *     spec 5.1 / 27);
 *   - same-session identity enforcement: a window is never routing authority,
 *     unproven/ambiguous targets refuse (spec 17, 20).
 */

const assert = require('assert')

const { DoubleCountGuard, validSessionId, validQuestionKey } = require('./double-count-guard')
const { TerminalInputAdapter } = require('./terminal-input-adapter')
const { FallbackCoordinator } = require('./fallback-coordinator')
const { canonicalQuestion } = require('../../../packages/candice-protocol/question-registry')

let failures = 0

function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL ${name}: ${err.message}`)
  }
}

// --- Minimal lifecycle stub (WS-03 contract: recordAnswer({sessionId, questionKey})) ---
function makeStubLifecycle() {
  const answered = new Map()
  return {
    answered,
    recordAnswer({ sessionId, questionKey }) {
      const key = `${sessionId}::${questionKey}`
      if (answered.has(key)) {
        return { ok: false, code: 'no-pending-question', error: `question ${questionKey} already recorded` }
      }
      answered.set(key, true)
      return { ok: true, recorded: true }
    },
  }
}

// --- Routing stub (WS-03 bridge contract: resolveRoute({sessionId, windowId})) ---
function routeStub(impl) {
  return { resolveRoute: impl }
}

function acceptAllRoute() {
  return routeStub(({ sessionId }) => ({ ok: true, routeTo: sessionId }))
}

const Q = canonicalQuestion({
  sessionId: 'sess-5-1',
  questionKey: 'BUILD_TARGET',
  skill: 'spec-protocol',
}).question

// ---------------------------------------------------------------------------
// DoubleCountGuard — defer semantics
// ---------------------------------------------------------------------------

check('deferToTerminal records the question once (deferred)', () => {
  const g = new DoubleCountGuard()
  const r = g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET', counted: true })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.redelivered, false)
  assert.strictEqual(r.recorded, true)
  assert.strictEqual(g.isDeferred({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' }), true)
})

check('repeat defer of the same key is redelivery, not a second slot (no double-count)', () => {
  const g = new DoubleCountGuard()
  g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET', counted: true })
  const r = g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET', counted: true })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.redelivered, true)
  assert.strictEqual(r.recorded, false)
  // exactly one slot: one reconcile allowed, second one refuses
  const first = g.reconcileTerminalAnswer({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(first.ok, true)
  const second = g.reconcileTerminalAnswer({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(second.ok, false)
  assert.strictEqual(second.code, 'already-answered')
})

check('defer after answered refuses (no second answer)', () => {
  const g = new DoubleCountGuard()
  g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET', counted: true })
  g.reconcileTerminalAnswer({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' })
  const r = g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET', counted: true })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'already-answered')
})

check('defer rejects invalid session id', () => {
  const g = new DoubleCountGuard()
  const r = g.deferToTerminal({ sessionId: '', questionKey: 'BUILD_TARGET', counted: true })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-session-id')
})

check('defer rejects invalid question key', () => {
  const g = new DoubleCountGuard()
  const r = g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'build_target', counted: true })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-question-key')
})

// ---------------------------------------------------------------------------
// DoubleCountGuard — reconcile semantics
// ---------------------------------------------------------------------------

check('reconcile records the answer exactly once', () => {
  const lifecycle = makeStubLifecycle()
  const g = new DoubleCountGuard({ lifecycle })
  g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET', counted: true })
  const r = g.reconcileTerminalAnswer({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.recorded, true)
  assert.strictEqual(lifecycle.answered.size, 1)
  assert.strictEqual(g.isAnswered({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' }), true)
  assert.strictEqual(g.isDeferred({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' }), false)
})

check('reconcile without defer refuses (never-deferred)', () => {
  const g = new DoubleCountGuard()
  const r = g.reconcileTerminalAnswer({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'never-deferred')
})

check('reconcile after MCP consumed the slot surfaces question-already-consumed', () => {
  const lifecycle = makeStubLifecycle()
  // Simulate the MCP path winning: the lifecycle already holds the answer.
  lifecycle.answered.set('sess-5-1::BUILD_TARGET', true)
  const g = new DoubleCountGuard({ lifecycle })
  g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET', counted: true })
  const r = g.reconcileTerminalAnswer({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'question-already-consumed')
  // The guard never moved to answered by a refused record.
  assert.strictEqual(g.isAnswered({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' }), false)
})

check('counted flag survives round-trip', () => {
  const g = new DoubleCountGuard()
  g.deferToTerminal({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET', counted: true })
  const r = g.reconcileTerminalAnswer({ sessionId: 'sess-5-1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(r.counted, true)
})

check('resetForSession clears bookkeeping; questions are session-scoped', () => {
  const g = new DoubleCountGuard()
  g.deferToTerminal({ sessionId: 'sess-a', questionKey: 'BUILD_TARGET', counted: true })
  g.deferToTerminal({ sessionId: 'sess-b', questionKey: 'BUILD_TARGET', counted: true })
  g.resetForSession('sess-a')
  assert.strictEqual(g.isDeferred({ sessionId: 'sess-a', questionKey: 'BUILD_TARGET' }), false)
  assert.strictEqual(g.isDeferred({ sessionId: 'sess-b', questionKey: 'BUILD_TARGET' }), true)
})

// ---------------------------------------------------------------------------
// TerminalInputAdapter — routing authority (spec 17/20)
// ---------------------------------------------------------------------------

check('submitText refuses when the route resolver is absent (unproven-session)', () => {
  const a = new TerminalInputAdapter()
  const r = a.submitText({ sessionId: 'sess-5-1', text: 'it is a booking tool' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unproven-session')
})

check('submitText refuses when a window is the only evidence (window never routes)', () => {
  const a = new TerminalInputAdapter() // no resolver at all
  const r = a.submitText({ sessionId: 'sess-5-1', text: 'it is a booking tool', windowId: 'host-win-1' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unproven-session')
})

check('submitText refuses when resolver says ambiguous (tabs/panes)', () => {
  const a = new TerminalInputAdapter({
    route: routeStub(() => ({ ok: false, code: 'ambiguous-window', error: 'window maps to 2 sessions' })),
  })
  const r = a.submitText({ sessionId: 'sess-5-1', text: 'it is a booking tool', windowId: 'host-win-1' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'route-refused')
})

check('submitText refuses on inactive/mismatched session (spec 20 session mismatch)', () => {
  const a = new TerminalInputAdapter({
    route: routeStub(() => ({ ok: false, code: 'session-not-active', error: 'session is not active' })),
  })
  const r = a.submitText({ sessionId: 'sess-dead', text: 'it is a booking tool' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'route-refused')
})

check('submitText delivers through the exact-session injector', () => {
  const submitted = []
  const a = new TerminalInputAdapter({
    route: acceptAllRoute(),
    handlers: { submit: (t) => submitted.push(t) },
  })
  const r = a.submitText({ sessionId: 'sess-5-1', text: 'I want a booking tool for local barbers.' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.queued, false)
  assert.strictEqual(r.routeTo, 'sess-5-1')
  assert.deepStrictEqual(submitted, ['I want a booking tool for local barbers.'])
})

check('submitText shows what will be submitted (no hidden prompt)', () => {
  const a = new TerminalInputAdapter({ route: acceptAllRoute() }) // dry-run: no handlers
  const r = a.submitText({ sessionId: 'sess-5-1', text: '/bro' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.text, '/bro') // the exact payload is returned to the UI to display
})

check('submitText rejects empty text', () => {
  const a = new TerminalInputAdapter({ route: acceptAllRoute() })
  const r = a.submitText({ sessionId: 'sess-5-1', text: '   ' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-text')
})

// ---------------------------------------------------------------------------
// TerminalInputAdapter — busy queue (spec 13.3)
// ---------------------------------------------------------------------------

check('busy session queues instead of injecting, then flushes in order', () => {
  const submitted = []
  let busy = true
  const a = new TerminalInputAdapter({
    route: acceptAllRoute(),
    sessionBusy: () => busy,
    handlers: { submit: (t) => submitted.push(t) },
  })
  const r1 = a.submitText({ sessionId: 'sess-5-1', text: 'first' })
  const r2 = a.submitText({ sessionId: 'sess-5-1', text: 'second' })
  assert.strictEqual(r1.ok, true)
  assert.strictEqual(r1.queued, true)
  assert.ok(/Claude is working/.test(r1.note))
  assert.strictEqual(r2.queued, true)
  assert.strictEqual(a.pendingCount('sess-5-1'), 2)
  assert.deepStrictEqual(submitted, []) // nothing injected while busy
  busy = false
  const flushed = a.flush('sess-5-1')
  assert.strictEqual(flushed, 2)
  assert.deepStrictEqual(submitted, ['first', 'second']) // order preserved
  assert.strictEqual(a.pendingCount('sess-5-1'), 0)
})

check('a failing busy probe fails closed (queues, never injects blind)', () => {
  const a = new TerminalInputAdapter({
    route: acceptAllRoute(),
    sessionBusy: () => {
      throw new Error('probe broken')
    },
    handlers: { submit: () => assert.fail('must never inject on a broken busy probe') },
  })
  const r = a.submitText({ sessionId: 'sess-5-1', text: 'hello' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.queued, true)
})

check('dropQueued removes pending texts before submission', () => {
  const a = new TerminalInputAdapter({ route: acceptAllRoute(), sessionBusy: () => true })
  a.submitText({ sessionId: 'sess-5-1', text: 'one' })
  a.submitText({ sessionId: 'sess-5-1', text: 'two' })
  assert.strictEqual(a.dropQueued('sess-5-1'), 2)
  assert.strictEqual(a.pendingCount('sess-5-1'), 0)
})

// ---------------------------------------------------------------------------
// FallbackCoordinator — the "Answer in Claude instead" path
// ---------------------------------------------------------------------------

check('fallbackQuestion returns the same question prompt (no state loss)', () => {
  const c = new FallbackCoordinator()
  const r = c.fallbackQuestion(Q)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.redelivered, false)
  assert.strictEqual(r.counted, Q.counted)
  assert.strictEqual(r.prompt.text, Q.text)
  assert.strictEqual(r.prompt.helpText, Q.helpText)
  assert.deepStrictEqual(r.prompt.allowedInputModes, ['voice', 'typed', 'terminal'])
})

check('fallbackQuestion twice returns redelivered and keeps one slot', () => {
  const c = new FallbackCoordinator()
  c.fallbackQuestion(Q)
  const r = c.fallbackQuestion(Q)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.redelivered, true)
  assert.strictEqual(r.guardStatus.filter((g) => g.status === 'deferred').length, 1)
})

check('fallbackQuestion refuses unknown and retired keys before either terminal delivery or guard state', () => {
  const c = new FallbackCoordinator()
  for (const questionKey of ['NOT_REGISTERED', 'B3']) {
    const r = c.fallbackQuestion({ ...Q, questionKey })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.code, questionKey === 'B3' ? 'retired-governed-question' : 'unregistered-governed-question')
  }
  assert.deepStrictEqual(c.guard.status(), [], 'rejected keys never create a terminal fallback slot')
})

check('answerFromTerminal yields one answer-event with inputMode terminal, counted once', () => {
  const c = new FallbackCoordinator()
  c.fallbackQuestion(Q)
  const r = c.answerFromTerminal({
    sessionId: 'sess-5-1',
    questionKey: 'BUILD_TARGET',
    answerText: 'I want a booking tool for local barbers.',
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.answer.schemaVersion, '1.0')
  assert.strictEqual(r.answer.sessionId, 'sess-5-1')
  assert.strictEqual(r.answer.questionKey, 'BUILD_TARGET')
  assert.strictEqual(r.answer.inputMode, 'terminal')
  assert.strictEqual(r.answer.userConfirmedTranscript, true)
  assert.strictEqual(r.answer.answerText, 'I want a booking tool for local barbers.')
  // second delivery of the same answer refuses (exactly one answer)
  const r2 = c.answerFromTerminal({
    sessionId: 'sess-5-1',
    questionKey: 'BUILD_TARGET',
    answerText: 'I want a booking tool for local barbers.',
  })
  assert.strictEqual(r2.ok, false)
  assert.strictEqual(r2.code, 'already-answered')
})

check('answerFromTerminal without defer refuses (never-deferred)', () => {
  const c = new FallbackCoordinator()
  const r = c.answerFromTerminal({
    sessionId: 'sess-5-1',
    questionKey: 'BUILD_TARGET',
    answerText: 'unmanaged answer',
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'never-deferred')
})

check('answerFromTerminal answers only the owning session (same-session identity)', () => {
  const c = new FallbackCoordinator()
  c.fallbackQuestion(Q) // deferred in sess-5-1
  const r = c.answerFromTerminal({
    sessionId: 'sess-other',
    questionKey: 'BUILD_TARGET',
    answerText: 'wrong session',
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'never-deferred')
})

check('deliverToTerminal enforces same-session routing end to end', () => {
  const submitted = []
  const c = new FallbackCoordinator({
    adapterOpts: {
      route: routeStub(({ sessionId }) =>
        sessionId === 'sess-5-1' ? { ok: true, routeTo: sessionId } : { ok: false, code: 'session-not-active' }
      ),
      handlers: { submit: (t) => submitted.push(t) },
    },
  })
  const ok = c.deliverToTerminal({ sessionId: 'sess-5-1', text: 'why do you need that?' })
  assert.strictEqual(ok.ok, true)
  const bad = c.deliverToTerminal({ sessionId: 'sess-other', text: 'wrong window' })
  assert.strictEqual(bad.ok, false)
  assert.deepStrictEqual(submitted, ['why do you need that?'])
})

// ---------------------------------------------------------------------------
// Cross-path double-count proof against the REAL WS-03 lifecycle seam
// ---------------------------------------------------------------------------

check('guard+lifecycle seam: terminal answer counts exactly once in the real lifecycle', () => {
  const { SessionLifecycle } = require('../session/session-lifecycle')
  const lifecycle = new SessionLifecycle({ stateDir: null })
  const begin = lifecycle.beginSession({ sessionId: 'sess-real', skill: 'spec-protocol' })
  assert.strictEqual(begin.ok, true)
  lifecycle.sessions.setPendingQuestion({ sessionId: 'sess-real', questionKey: 'BUILD_TARGET', text: Q.text, counted: true })
  const guard = new DoubleCountGuard({ lifecycle })
  guard.deferToTerminal({ sessionId: 'sess-real', questionKey: 'BUILD_TARGET', counted: true })
  const r = guard.reconcileTerminalAnswer({ sessionId: 'sess-real', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(r.ok, true)
  const status = lifecycle.status({ sessionId: 'sess-real' })
  assert.strictEqual(status.questionCount, 1)
  assert.strictEqual(status.hasPendingQuestion, false)
  // the same question through a second terminal reconcile cannot double-count
  const again = guard.reconcileTerminalAnswer({ sessionId: 'sess-real', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(again.ok, false)
  assert.strictEqual(lifecycle.status({ sessionId: 'sess-real' }).questionCount, 1)
})

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

check('validSessionId/validQuestionKey accept the canonical shape and reject junk', () => {
  assert.strictEqual(validSessionId('opaque-session-id'), true)
  assert.strictEqual(validSessionId(''), false)
  assert.strictEqual(validSessionId('has space'), false)
  assert.strictEqual(validQuestionKey('BUILD_TARGET'), true)
  assert.strictEqual(validQuestionKey('build_target'), false)
})

// ---------------------------------------------------------------------------
// Load check (all modules clean on Node)
// ---------------------------------------------------------------------------

check('all fallback modules load clean', () => {
  require('./double-count-guard')
  require('./terminal-input-adapter')
  require('./fallback-coordinator')
})

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
