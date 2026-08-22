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

check('a cross-skill key cannot overwrite the owning session pending question', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-no-overwrite', skill: 'spec-protocol' })
  assert.strictEqual(sm.setPendingQuestion({ sessionId: 'sess-no-overwrite', questionKey: 'BUILD_TARGET' }).ok, true)
  const refused = sm.setPendingQuestion({ sessionId: 'sess-no-overwrite', questionKey: 'KAZEN_TARGET' })
  assert.strictEqual(refused.ok, false)
  assert.strictEqual(refused.code, 'question-skill-mismatch')
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

check('direct lifecycle calls refuse unknown and retired keys without persisting pending state', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-governed-only', skill: 'spec-protocol' })
  for (const questionKey of ['NOT_REGISTERED', 'B3']) {
    const r = sm.setPendingQuestion({ sessionId: 'sess-governed-only', questionKey })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.code, questionKey === 'B3' ? 'retired-governed-question' : 'unregistered-governed-question')
  }
  assert.strictEqual(sm.getSession('sess-governed-only').pendingQuestion, null)
})

check('restart drops a legacy ungoverned pending key before recovery can surface it', () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'candice-sessions.json'), JSON.stringify({
    schemaVersion: '1.0',
    sessions: [{
      schemaVersion: '1.0',
      sessionId: 'sess-legacy-ungoverned',
      skill: 'spec-protocol',
      status: 'active',
      pendingQuestion: { questionKey: 'NOT_REGISTERED', text: 'legacy bypass' },
      answeredQuestionKeys: [],
    }],
  }))
  const sm = new SessionManager({ stateDir: dir })
  assert.strictEqual(sm.getSession('sess-legacy-ungoverned').pendingQuestion, null)
  assert.strictEqual(sm.recoverPendingQuestion({ sessionId: 'sess-legacy-ungoverned' }).recovered, null)
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'candice-sessions.json'), 'utf8'))
  assert.strictEqual(saved.sessions[0].pendingQuestion, null, 'migration persists the fail-closed cleanup')
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
  assert.strictEqual(sm2.getSession('sess-never-reask').registryVersion, '3.0.0')
})

check('recovery claims a lease without deleting the pending record (FIX-013)', () => {
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
  assert.strictEqual(typeof rec.recovered.operationId, 'string')
  assert.strictEqual(rec.recovered.durableState, 'recovering')
  assert.strictEqual(typeof rec.lease.leaseId, 'string')
  const record = sm.getSession('sess-rec')
  assert.strictEqual(record.status, 'recovering')
  // The lease does NOT delete the pending record: only an acknowledged
  // handoff may complete it.
  assert.strictEqual(record.pendingQuestion.questionKey, 'BUILD_TARGET')
  assert.strictEqual(record.pendingQuestion.leaseId, rec.lease.leaseId)
  assert.strictEqual(record.questionCount, 0)
  // A second recovery while the lease is still held is refused (a second
  // process cannot render or submit the same question).
  const second = sm.recoverPendingQuestion({ sessionId: 'sess-rec' })
  assert.strictEqual(second.ok, false)
  assert.strictEqual(second.code, 'recovery-lease-held')
  // The exact handoff acknowledged by the lease holder completes recovery.
  const ack = sm.acknowledgeRecoveryHandoff({
    sessionId: 'sess-rec',
    operationId: rec.recovered.operationId,
    leaseId: rec.lease.leaseId,
  })
  assert.strictEqual(ack.ok, true)
  assert.strictEqual(ack.state, 'recovered')
  assert.strictEqual(sm.getSession('sess-rec').status, 'active')
  assert.strictEqual(sm.getSession('sess-rec').pendingQuestion, null)
})

check('recovery acknowledgement refuses a wrong lease (replay fails closed)', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-rec-x', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-rec-x', questionKey: 'BUILD_TARGET', counted: true })
  const rec = sm.recoverPendingQuestion({ sessionId: 'sess-rec-x' })
  assert.strictEqual(rec.ok, true)
  const wrong = sm.acknowledgeRecoveryHandoff({
    sessionId: 'sess-rec-x',
    operationId: rec.recovered.operationId,
    leaseId: 'lease-other-process',
  })
  assert.strictEqual(wrong.ok, false)
  assert.strictEqual(wrong.code, 'recovery-lease-mismatch')
  const rec2 = sm.recoverPendingQuestion({ sessionId: 'sess-rec-x' })
  assert.strictEqual(rec2.ok, false) // lease still held — record untouched
  assert.strictEqual(rec2.code, 'recovery-lease-held')
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
  sm.beginSession({ sessionId: 'sess-rs', skill: 'spec-protocol' })
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
  assert.strictEqual(typeof first.lease.leaseId, 'string')
  const sec = sm.recoverPendingQuestion({ sessionId: 'sess-2x' })
  assert.strictEqual(sec.ok, false)
  assert.strictEqual(sec.code, 'recovery-lease-held')
  // Completing the handoff is the terminal release: after it, recovery finds nothing.
  const ack = sm.acknowledgeRecoveryHandoff({
    sessionId: 'sess-2x',
    operationId: first.recovered.operationId,
    leaseId: first.lease.leaseId,
  })
  assert.strictEqual(ack.ok, true)
  const after = sm.recoverPendingQuestion({ sessionId: 'sess-2x' })
  assert.strictEqual(after.recovered, null)
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

// ——————————————————————————————————————————————
// FIX-013 S1: durable operation identity + pending durable states
// ——————————————————————————————————————————————

check('pending record carries operationId and durableState displaying before delivery', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-op', skill: 'spec-protocol' })
  const set = sm.setPendingQuestion({ sessionId: 'sess-op', questionKey: 'BUILD_TARGET', counted: !0 })
  assert.strictEqual(set.ok, true)
  const p = sm.getSession('sess-op').pendingQuestion
  assert.strictEqual(typeof p.operationId, 'string')
  assert.strictEqual(p.operationId.startsWith('op-'), true)
  assert.strictEqual(p.durableState, 'displaying')
  assert.strictEqual(/^\d{4}-\d{2}-\d{2}T/.test(p.askedAt), true)
})

check('retry with same operation identity is idempotent; different id is refused', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-op2', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-op2', questionKey: 'BUILD_TARGET' })
  const retry = sm.setPendingQuestion({ sessionId: 'sess-op2', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(retry.ok, true)
  assert.strictEqual(retry.recovery, true)
  const wrongId = sm.setPendingQuestion({
    sessionId: 'sess-op2',
    questionKey: 'BUILD_TARGET',
    operationId: 'op-11aa22bb33cc44dd55ee66ff',
  })
  assert.strictEqual(wrongId.ok, false)
  assert.strictEqual(wrongId.code, 'pending-operation-mismatch')
})

check('recordAnswer enforces the operation identity (replay fails closed)', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-op3', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-op3', questionKey: 'BUILD_TARGET' })
  const pending = sm.getSession('sess-op3').pendingQuestion
  const wrong = sm.recordAnswer({ sessionId: 'sess-op3', questionKey: 'BUILD_TARGET', operationId: 'op-deadbeefdeadbeefdeadbeef' })
  assert.strictEqual(wrong.ok, false)
  assert.strictEqual(wrong.code, 'operation-id-mismatch')
  const right = sm.recordAnswer({ sessionId: 'sess-op3', questionKey: 'BUILD_TARGET', operationId: pending.operationId })
  assert.strictEqual(right.ok, true)
})

check('durable transitions: displaying -> displayed and displayed -> fallback-pending', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-dt', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-dt', questionKey: 'BUILD_TARGET' })
  const p = sm.getSession('sess-dt').pendingQuestion
  const t1 = sm.transitionPendingDurableState({ sessionId: 'sess-dt', operationId: p.operationId, from: 'displaying', to: 'displayed' })
  assert.strictEqual(t1.ok, true)
  assert.strictEqual(t1.durableState, 'displayed')
  assert.strictEqual(typeof sm.getSession('sess-dt').pendingQuestion.acknowledgedAt, 'string')
  const t2 = sm.transitionPendingDurableState({ sessionId: 'sess-dt', operationId: p.operationId, from: 'displayed', to: 'fallback-pending' })
  assert.strictEqual(t2.ok, true)
  assert.strictEqual(sm.getSession('sess-dt').pendingQuestion.durableState, 'fallback-pending')
  // The record is retained after fallback ownership — a later restart cannot
  // recover a question already redirected to Claude (FIX-013).
  assert.strictEqual(sm.getSession('sess-dt').pendingQuestion.questionKey, 'BUILD_TARGET')
  const illegal = sm.transitionPendingDurableState({ sessionId: 'sess-dt', operationId: p.operationId, from: 'fallback-pending', to: 'displaying' })
  assert.strictEqual(illegal.ok, false)
  assert.strictEqual(illegal.code, 'illegal-durable-transition')
})

check('a recovering record requires its lease before it may transition', () => {
  const sm = new SessionManager({ stateDir: tempDir() })
  sm.beginSession({ sessionId: 'sess-lease-req', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-lease-req', questionKey: 'BUILD_TARGET' })
  const rec = sm.recoverPendingQuestion({ sessionId: 'sess-lease-req' })
  assert.strictEqual(rec.ok, true)
  const t = sm.transitionPendingDurableState({
    sessionId: 'sess-lease-req',
    operationId: rec.recovered.operationId,
    from: 'recovering',
    to: 'displayed',
  })
  assert.strictEqual(t.ok, true)
  assert.strictEqual(t.durableState, 'displayed')
})

check('SessionLifecycle façade exposes the full FIX-013 lifecycle surface', () => {
  const lifecycle = new SessionLifecycle({ stateDir: tempDir() })
  lifecycle.beginSession({ sessionId: 'sess-facade', skill: 'spec-protocol' })
  const set = lifecycle.setPendingQuestion({
    sessionId: 'sess-facade',
    questionKey: 'BUILD_TARGET',
    text: 'q',
    counted: true,
  })
  assert.strictEqual(set.ok, true)
  assert.strictEqual(typeof set.session.pendingQuestion.operationId, 'string')
  const rec = lifecycle.recoverPendingQuestion({ sessionId: 'sess-facade' })
  assert.strictEqual(rec.ok, true)
  const ack = lifecycle.acknowledgeRecoveryHandoff({
    sessionId: 'sess-facade',
    operationId: rec.recovered.operationId,
    leaseId: rec.lease.leaseId,
  })
  assert.strictEqual(ack.ok, true)
  assert.strictEqual(ack.state, 'recovered')
  lifecycle.setPendingQuestion({ sessionId: 'sess-facade', questionKey: 'BUILD_TARGET', counted: false })
  const rec2 = lifecycle.recordAnswer({ sessionId: 'sess-facade', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(rec2.ok, true)
  // The answered key cannot be re-asked in this session (governed once); the
  // durable transition is exercised on a fresh session instead.
  const recycled = lifecycle.beginSession({ sessionId: 'sess-facade-2', skill: 'spec-protocol' })
  assert.strictEqual(recycled.ok, true)
  lifecycle.setPendingQuestion({ sessionId: 'sess-facade-2', questionKey: 'BUILD_TARGET', counted: false })
  const opId = lifecycle.sessions.getSession('sess-facade-2').pendingQuestion.operationId
  const t = lifecycle.transitionPendingDurableState({
    sessionId: 'sess-facade-2',
    operationId: opId,
    from: 'displaying',
    to: 'fallback-pending',
  })
  assert.strictEqual(t.ok, true)
  assert.strictEqual(lifecycle.sessions.getSession('sess-facade-2').pendingQuestion.durableState, 'fallback-pending')
})

check('a fallback-owned question can never be re-recovered after restart (F13-03)', () => {
  const dir = tempDir()
  const sm1 = new SessionManager({ stateDir: dir })
  sm1.beginSession({ sessionId: 'sess-fb', skill: 'spec-protocol' })
  sm1.setPendingQuestion({ sessionId: 'sess-fb', questionKey: 'BUILD_TARGET' })
  const p = sm1.getSession('sess-fb').pendingQuestion
  sm1.transitionPendingDurableState({ sessionId: 'sess-fb', operationId: p.operationId, from: 'displaying', to: 'fallback-pending' })
  // Restart: the persisted record survives, but recovery refuses to re-ask.
  const sm2 = new SessionManager({ stateDir: dir })
  const rec = sm2.recoverPendingQuestion({ sessionId: 'sess-fb' })
  assert.strictEqual(rec.ok, false)
  assert.strictEqual(rec.code, 'fallback-owns-question')
  assert.strictEqual(sm2.getSession('sess-fb').pendingQuestion.durableState, 'fallback-pending')
  // The terminal answer may still complete it exactly once.
  const ans = sm2.recordAnswer({ sessionId: 'sess-fb', questionKey: 'BUILD_TARGET', operationId: p.operationId })
  assert.strictEqual(ans.ok, true)
  assert.strictEqual(sm2.getSession('sess-fb').questionCount, 1)
})

// ---------------------------------------------------------------------------
// FIX-013 S3 — durable fallback terminal completion + read seam
// ---------------------------------------------------------------------------

check('getPendingOperation reads the durable record without mutating it', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-gpo', skill: 'spec-protocol' })
  const none = sm.getPendingOperation({ sessionId: 'sess-gpo' })
  assert.strictEqual(none.ok, false)
  assert.strictEqual(none.code, 'no-pending-question')
  sm.setPendingQuestion({ sessionId: 'sess-gpo', questionKey: 'BUILD_TARGET' })
  const got = sm.getPendingOperation({ sessionId: 'sess-gpo' })
  assert.strictEqual(got.ok, true)
  assert.strictEqual(got.pending.durableState, 'displaying')
  const after = sm.getSession('sess-gpo')
  assert.strictEqual(after.pendingQuestion.durableState, 'displaying', 'read never mutates')
})

check('recordFallbackAnswer completes the one terminal commit for a fallback-pending record', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-rfa', skill: 'spec-protocol' })
  const set = sm.setPendingQuestion({
    sessionId: 'sess-rfa', questionKey: 'BUILD_TARGET', counted: true, durableState: 'fallback-pending',
  })
  assert.strictEqual(set.ok, true)
  const rec = sm.recordFallbackAnswer({ sessionId: 'sess-rfa', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(rec.ok, true)
  assert.strictEqual(rec.durableCommitOk, true)
  const status = sm.getSession('sess-rfa')
  assert.strictEqual(status.questionCount, 1)
  assert.strictEqual(status.pendingQuestion, null)
  // second terminal answer finds no record (durable exactly-once)
  const again = sm.recordFallbackAnswer({ sessionId: 'sess-rfa', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(again.ok, false)
  assert.strictEqual(again.code, 'no-pending-question')
})

check('recordFallbackAnswer refuses a record still owned by the MCP/app path', () => {
  const sm = new SessionManager({ stateDir: tempDir(), clock: fixedClock('2026-08-21T00:00:00.000Z') })
  sm.beginSession({ sessionId: 'sess-rfa2', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-rfa2', questionKey: 'BUILD_TARGET' }) // displaying
  const rec = sm.recordFallbackAnswer({ sessionId: 'sess-rfa2', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(rec.ok, false)
  assert.strictEqual(rec.code, 'fallback-not-owner')
  assert.strictEqual(sm.getSession('sess-rfa2').questionCount, 0)
})

check('recordAnswer reverts the in-memory terminal clear when the durable commit fails (exactly one recoverable record)', () => {
  const dir = tempDir()
  const sm = new SessionManager({ stateDir: dir })
  sm.beginSession({ sessionId: 'sess-tx', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-tx', questionKey: 'BUILD_TARGET', text: 'exact question text' })
  const originalSave = sm._save.bind(sm)
  sm._save = () => ({ ok: false, code: 'store:write-failed', error: 'injected commit failure' })
  const rec = sm.recordAnswer({ sessionId: 'sess-tx', questionKey: 'BUILD_TARGET' })
  sm._save = originalSave
  assert.strictEqual(rec.ok, true)
  assert.strictEqual(rec.durableCommitOk, false)
  const record = sm.getSession('sess-tx')
  assert.strictEqual(record.questionCount, 0, 'no count on an unproven commit')
  assert.ok(record.pendingQuestion, 'exactly one recoverable record retained')
  assert.strictEqual(record.pendingQuestion.text, 'exact question text')
  // the same operation id re-commits idempotently once the store works
  const ok = sm.recordAnswer({ sessionId: 'sess-tx', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(ok.ok, true)
  assert.strictEqual(ok.durableCommitOk, true)
  assert.strictEqual(sm.getSession('sess-tx').questionCount, 1)
})

check('recordFallbackAnswer reverts the in-memory clear when the durable commit fails', () => {
  const dir = tempDir()
  const sm = new SessionManager({ stateDir: dir })
  sm.beginSession({ sessionId: 'sess-tx2', skill: 'spec-protocol' })
  sm.setPendingQuestion({ sessionId: 'sess-tx2', questionKey: 'BUILD_TARGET', counted: true, durableState: 'fallback-pending' })
  const originalSave = sm._save.bind(sm)
  sm._save = () => ({ ok: false, code: 'store:write-failed', error: 'injected commit failure' })
  const rec = sm.recordFallbackAnswer({ sessionId: 'sess-tx2', questionKey: 'BUILD_TARGET' })
  sm._save = originalSave
  assert.strictEqual(rec.ok, true)
  assert.strictEqual(rec.durableCommitOk, false)
  assert.strictEqual(rec.recorded, false)
  const record = sm.getSession('sess-tx2')
  assert.strictEqual(record.questionCount, 0)
  assert.strictEqual(record.pendingQuestion.durableState, 'fallback-pending', 'exactly one recoverable fallback record retained')
})

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
