'use strict'

/**
 * candice-integration / session/session-lifecycle.test.js
 * WS-03 session lifecycle tests — owned path: plugins/candice-integration/session/**
 *
 * Runs with plain `node` (zero dependencies, cross-platform):
 *   node session/session-lifecycle.test.js
 * Exits 0 on PASS, 1 on FAIL. Every assertion prints PASS/FAIL with the exact
 * input that produced it — primary-source evidence for the acceptance run.
 *
 * Covers the WS-03 acceptance criterion: begin_session/end_session lifecycle
 * works; the bridge binds the app to the Claude session ID; session identity
 * is the routing authority, never the window.
 */

const assert = require('assert')
const os = require('os')
const fs = require('fs')
const path = require('path')

const { SessionManager } = require('./session-manager')
const { BindingBridge } = require('./bridge/binding-bridge')
const { SessionLifecycle } = require('./session-lifecycle')

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

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'candice-session-test-'))
}

function fixedClock(startIso) {
  let current = startIso
  return () => current
}

check('begin_session opens an active session and returns its id', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  const r = sm.beginSession({ sessionId: 'sess-test-1', skill: 'spec-protocol' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.session.status, 'active')
  assert.strictEqual(r.session.sessionId, 'sess-test-1')
})

check('begin_session rejects empty session ids', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  const r = sm.beginSession({ sessionId: '   ', skill: 'spec-protocol' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-session-id')
})

check('begin_session rejects duplicate active sessions', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-dup', skill: 'kaizen' })
  const r = sm.beginSession({ sessionId: 'sess-dup', skill: 'kaizen' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'already-active')
})

check('end_session closes the session exactly once', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-end', skill: 'bro' })
  const r1 = sm.endSession({ sessionId: 'sess-end', reason: 'interview complete' })
  assert.strictEqual(r1.ok, true)
  assert.strictEqual(r1.session.status, 'ended')
  const r2 = sm.endSession({ sessionId: 'sess-end' })
  assert.strictEqual(r2.ok, false)
  assert.strictEqual(r2.code, 'already-ended')
})

check('end_session on unknown session reports not-found', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  const r = sm.endSession({ sessionId: 'sess-ghost' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'not-found')
})

check('pending question is stored and answered exactly once', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-pq', skill: 'spec-protocol' })
  const set = sm.setPendingQuestion({
    sessionId: 'sess-pq',
    questionKey: 'BUILD_TARGET',
    text: 'Tell me about your idea',
    answerKind: 'free_text',
    counted: false,
  })
  assert.strictEqual(set.ok, true)
  assert.strictEqual(set.session.pendingQuestion.questionKey, 'BUILD_TARGET')
  const ans = sm.recordAnswer({ sessionId: 'sess-pq', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(ans.ok, true)
  assert.strictEqual(ans.session.pendingQuestion, null)
  assert.strictEqual(ans.session.questionCount, 1)
})

check('recordAnswer refuses a question-key mismatch (no cross-answer)', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-qq', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-qq', questionKey: 'BUILD_TARGET', counted: false })
  const r = sm.recordAnswer({ sessionId: 'sess-qq', questionKey: 'OTHER_KEY' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'question-key-mismatch')
})

check('a different pending question cannot overwrite the first', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-no-overwrite', skill: 'spec-protocol' })
  assert.strictEqual(sm.setPendingQuestion({ sessionId: 'sess-no-overwrite', questionKey: 'BUILD_TARGET' }).ok, true)
  const refused = sm.setPendingQuestion({ sessionId: 'sess-no-overwrite', questionKey: 'KAZEN_TARGET' })
  assert.strictEqual(refused.ok, false)
  assert.strictEqual(refused.code, 'pending-question-exists')
  assert.strictEqual(sm.getSession('sess-no-overwrite').pendingQuestion.questionKey, 'BUILD_TARGET')
})

check('same pending key is an explicit recovery idempotency exception', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-same-key', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-same-key', questionKey: 'BUILD_TARGET' })
  const again = sm.setPendingQuestion({ sessionId: 'sess-same-key', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(again.ok, true)
  assert.strictEqual(again.recovery, true)
  assert.strictEqual(again.session.questionCount, 0)
})

check('answered key cannot be asked again after persisted restart', () => {
  const dir = tempDir()
  const sm1 = new SessionManager({ stateDir: dir })
  sm1.beginSession({ sessionId: 'sess-never-reask', skill: 'spec-protocol' })
  sm1.setPendingQuestion({ sessionId: 'sess-never-reask', questionKey: 'BUILD_TARGET' })
  sm1.recordAnswer({ sessionId: 'sess-never-reask', questionKey: 'BUILD_TARGET' })
  const sm2 = new SessionManager({ stateDir: dir })
  const refused = sm2.setPendingQuestion({ sessionId: 'sess-never-reask', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(refused.ok, false)
  assert.strictEqual(refused.code, 'question-already-answered')
  assert.strictEqual(sm2.getSession('sess-never-reask').registryVersion, '2.0.0')
})

check('recovery returns the exact pending question and does not re-count', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-rec', skill: 'spec-protocol' })
  sm.setPendingQuestion({
    sessionId: 'sess-rec',
    questionKey: 'BUILD_TARGET',
    text: 'Tell me about your idea',
    counted: true,
  })
  const rec = sm.recoverPendingQuestion({ sessionId: 'sess-rec' })
  assert.strictEqual(rec.ok, true)
  assert.strictEqual(rec.recovered.questionKey, 'BUILD_TARGET')
  assert.strictEqual(rec.recovered.text, 'Tell me about your idea')
  assert.strictEqual(rec.recovered.counted, true)
  const record = sm.getSession('sess-rec')
  assert.strictEqual(record.status, 'recovering')
  assert.strictEqual(record.pendingQuestion, null)
  assert.strictEqual(record.questionCount, 0) // not re-counted
})

check('recovery with nothing pending returns recovered null', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-none', skill: 'eli5' })
  const rec = sm.recoverPendingQuestion({ sessionId: 'sess-none' })
  assert.strictEqual(rec.ok, true)
  assert.strictEqual(rec.recovered, null)
})

check('resumeSession returns a recovering session to active', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-rs', skill: 'bro' })
  sm.setPendingQuestion({ sessionId: 'sess-rs', questionKey: 'BUILD_TARGET', counted: true })
  sm.recoverPendingQuestion({ sessionId: 'sess-rs' }) // only then is the session recovering
  const resume = sm.resumeSession({ sessionId: 'sess-rs' })
  assert.strictEqual(resume.ok, true)
  assert.strictEqual(resume.session.status, 'active')
})

check('recovery hands the pending question off exactly once (second recovery finds none)', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-2x', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-2x', questionKey: 'BUILD_TARGET', counted: true })
  const first = sm.recoverPendingQuestion({ sessionId: 'sess-2x' })
  assert.strictEqual(first.recovered.questionKey, 'BUILD_TARGET')
  const record = sm.getSession('sess-2x')
  assert.strictEqual(record.pendingQuestion, null) // no double-recovery
  const second = sm.recoverPendingQuestion({ sessionId: 'sess-2x' })
  assert.strictEqual(second.recovered, null)
})

check('write-through state survives a new manager instance (durability)', () => {
  const dir = tempDir()
  const sm1 = new SessionManager({ stateDir: dir, clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm1.beginSession({ sessionId: 'sess-durable', skill: 'spec-protocol' })
  sm1.setPendingQuestion({ sessionId: 'sess-durable', questionKey: 'BUILD_TARGET', counted: false })
  const sm2 = new SessionManager({ stateDir: dir, clock: fixedClock('2026-08-21T00:00:00.000Z') })
  const record = sm2.getSession('sess-durable')
  assert.strictEqual(record.status, 'active')
  assert.strictEqual(record.pendingQuestion.questionKey, 'BUILD_TARGET')
})

check('session id is the routing authority: resolveRoute returns exactly the session', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-route', skill: 'spec-protocol' })
  const bridge = new BindingBridge({ sessions: sm })
  const r = bridge.resolveRoute({ sessionId: 'sess-route' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.routeTo, 'sess-route')
})

check('routing never happens by window when no session is bound', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-w', skill: 'spec-protocol' })
  const bridge = new BindingBridge({ sessions: sm })
  const r = bridge.resolveRoute({ sessionId: 'sess-w', windowId: 'win-foreground' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'unproven-session')
})

check('ambiguous window (two sessions, tabs/panes) refuses to route', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-tab-a', skill: 'spec-protocol' })
  sm.beginSession({ sessionId: 'sess-tab-b', skill: 'kaizen' })
  const bridge = new BindingBridge({ sessions: sm })
  bridge.bind({ sessionId: 'sess-tab-a', windowAnchor: 'win-multi' })
  bridge.bind({ sessionId: 'sess-tab-b', windowAnchor: 'win-multi' })
  const r = bridge.resolveRoute({ sessionId: 'sess-tab-a', windowId: 'win-multi' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'ambiguous-window')
})

check('window binding is metadata only: anchorForWindow lists sessions, never routes', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-anchor', skill: 'eli5' })
  const bridge = new BindingBridge({ sessions: sm })
  const bind = bridge.bind({ sessionId: 'sess-anchor', windowAnchor: 'win-42' })
  assert.strictEqual(bind.ok, true)
  assert.deepStrictEqual(bridge.anchorForWindow('win-42'), ['sess-anchor'])
  // Rebind changes the anchor, never the session identity.
  bridge.rebind({ sessionId: 'sess-anchor', windowAnchor: 'win-99' })
  assert.deepStrictEqual(bridge.anchorForWindow('win-99'), ['sess-anchor'])
  assert.deepStrictEqual(bridge.anchorForWindow('win-42'), [])
})

check('bind refuses a dead session (no anchor without routing proof)', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  const bridge = new BindingBridge({ sessions: sm })
  const r = bridge.bind({ sessionId: 'sess-dead', windowAnchor: 'win-1' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'session-not-active')
})

check('SessionLifecycle façade: begin -> status -> end with cleanup manifest', () => {
  const lifecycle = new SessionLifecycle({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  const begin = lifecycle.beginSession({ sessionId: 'sess-lc', skill: 'spec-protocol', windowAnchor: 'win-7' })
  assert.strictEqual(begin.ok, true)
  const status = lifecycle.status({ sessionId: 'sess-lc' })
  assert.strictEqual(status.ok, true)
  assert.strictEqual(status.status, 'active')
  assert.strictEqual(status.windowAnchor.value, 'win-7')
  const end = lifecycle.endSession({ sessionId: 'sess-lc', reason: 'done' })
  assert.strictEqual(end.ok, true)
  assert.strictEqual(end.session.status, 'ended')
  assert.strictEqual(end.cleanup.releaseWindowAnchor, true)
  const after = lifecycle.status({ sessionId: 'sess-lc' })
  assert.strictEqual(after.status, 'ended')
})

check('SessionLifecycle route() enforces session authority end to end', () => {
  const lifecycle = new SessionLifecycle({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  lifecycle.beginSession({ sessionId: 'sess-r2', skill: 'bro' })
  const r = lifecycle.route({ sessionId: 'sess-r2', windowId: 'some-foreground-window' })
  assert.strictEqual(r.ok, false) // window alone never proves the session
  const r2 = lifecycle.route({ sessionId: 'sess-r2' })
  assert.strictEqual(r2.ok, true)
  assert.strictEqual(r2.routeTo, 'sess-r2')
})

check('lifecycle crash recovery end to end (section 20)', () => {
  const lifecycle = new SessionLifecycle({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  lifecycle.beginSession({ sessionId: 'sess-crash', skill: 'spec-protocol' })
  lifecycle.sessions.setPendingQuestion({
    sessionId: 'sess-crash',
    questionKey: 'BUILD_TARGET',
    text: 'Who is the application for?',
    counted: true,
  })
  const rec = lifecycle.recoverPendingQuestion({ sessionId: 'sess-crash' })
  assert.strictEqual(rec.ok, true)
  assert.strictEqual(rec.recovered.questionKey, 'BUILD_TARGET')
  assert.strictEqual(rec.recovered.counted, true)
  const resume = lifecycle.resumeSession({ sessionId: 'sess-crash' })
  assert.strictEqual(resume.ok, true)
  assert.strictEqual(resume.session.status, 'active')
})

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
