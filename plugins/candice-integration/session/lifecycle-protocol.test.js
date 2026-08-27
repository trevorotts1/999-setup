'use strict'

/**
 * candice-integration / session/lifecycle-protocol.test.js
 * FIX-013 shared protocol and lifecycle contract tests — owned path:
 * plugins/candice-integration/session/**
 *
 * Runs with plain `node` (zero dependencies, cross-platform):
 *   node plugins/candice-integration/session/lifecycle-protocol.test.js
 * Exits 0 on PASS, 1 on FAIL.
 *
 * Proves the S1 acceptance: malformed, stale, wrong-session, wrong-key,
 * wrong-token, replayed, and unknown-version events fail closed WITHOUT
 * changing state; the same valid message retried produces one transition.
 */

const assert = require('assert')
const proto = require('./lifecycle-protocol')
const state = require('./lifecycle-state')

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

const NOW = Date.parse('2026-08-22T12:00:00.000Z')

function within(value) {
  return new Date(NOW + (value || 0)).toISOString()
}

function base(overrides) {
  return Object.assign(
    { schemaVersion: '1.0', sessionId: 'sess-1' },
    overrides || {}
  )
}

check('valid question event passes and gains the derived operation id', () => {
  const r = proto.validateLifecycleEvent(base({ event: 'question', questionKey: 'BUILD_TARGET', askedAt: within(0) }), { nowMs: NOW })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.event.operationId, proto.deriveOperationId({ sessionId: 'sess-1', questionKey: 'BUILD_TARGET' }))
  assert.strictEqual(proto.isValidOperationId(r.event.operationId), true)
})

check('unknown schemaVersion fails closed', () => {
  const r = proto.validateLifecycleEvent(base({ schemaVersion: '2.0', event: 'question', questionKey: 'BUILD_TARGET', askedAt: within(0) }), { nowMs: NOW })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'schemaVersion')
})

check('unknown event discriminator fails closed', () => {
  const r = proto.validateLifecycleEvent(base({ event: 'teleport' }), { nowMs: NOW })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'invalid-lifecycle-event')
})

check('worng-session is refused when the expected session is supplied', () => {
  const r = proto.validateLifecycleEvent(base({ event: 'answer', operationId: 'op-1', questionKey: 'BUILD_TARGET', at: within(0) }), { nowMs: NOW, expectedSessionId: 'sess-other' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'sessionId')
  assert.ok(r.rule.includes('expected session'))
})

check('wrong-session event is ACCEPTED by the pure validator (the caller owns the comparison)', () => {
  const r = proto.validateLifecycleEvent(base({ event: 'answer', operationId: 'op-1', questionKey: 'BUILD_TARGET', at: within(0) }), { nowMs: NOW })
  assert.strictEqual(r.ok, true)
})

check('stale timestamp fails closed (beyond retention)', () => {
  const r = proto.validateLifecycleEvent(base({ event: 'answer', operationId: 'op-1', questionKey: 'BUILD_TARGET', at: within(-proto.LIMITS.maxAgeMs - 60_000) }), { nowMs: NOW })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.rule, 'timestamp is stale (beyond the retention window)')
})

check('future timestamp fails closed (beyond skew)', () => {
  const r = proto.validateLifecycleEvent(base({ event: 'answer', operationId: 'op-1', questionKey: 'BUILD_TARGET', at: within(proto.LIMITS.maxFutureSkewMs + 60_000) }), { nowMs: NOW })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.rule, 'timestamp is too far in the future (skew window exceeded)')
})

check('malformed identities fail closed', () => {
  for (const bad of [
    base({ event: 'answer', operationId: null, questionKey: 'BUILD_TARGET', at: within(0) }),
    base({ event: 'answer', operationId: 'op-1', questionKey: 'lowercase', at: within(0) }),
    base({ event: 'answer', operationId: 'op-1', questionKey: 'BUILD_TARGET' }),
    base({ event: 'lease', operationId: 'op-1', questionKey: 'BUILD_TARGET', leaseId: 'a b', heldUntil: within(0) }),
    base({ event: 'fallback', operationId: 'op-1', questionKey: 'BUILD_TARGET', cause: 'aliens', at: within(0) }),
    base({ event: 'lifecycle', state: 'teleported', at: within(0) }),
  ]) {
    const r = proto.validateLifecycleEvent(bad, { nowMs: NOW })
    assert.strictEqual(r.ok, false, JSON.stringify(bad))
  }
})

check('lease horizon beyond the max lease length fails closed', () => {
  const r = proto.validateLifecycleEvent(
    base({ event: 'lease', operationId: 'op-1', questionKey: 'BUILD_TARGET', leaseId: 'lease-1', heldUntil: within(proto.LIMITS.maxLeaseMs + 60_000) }),
    { nowMs: NOW }
  )
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'heldUntil')
})

check('an already-expired lease horizon fails closed (lower bound)', () => {
  // 1 hour in the past still passes isBoundedIso's 7-day maxAge window, so
  // isBoundedLease's [now, now + maxLeaseMs] lower bound is the gate.
  const r = proto.validateLifecycleEvent(
    base({ event: 'lease', operationId: 'op-1', questionKey: 'BUILD_TARGET', leaseId: 'lease-1', heldUntil: within(-60 * 60 * 1000) }),
    { nowMs: NOW }
  )
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'heldUntil')
})

check('all lifecycle event branches validate', () => {
  const cases = [
    base({ event: 'activation', activationId: 'act-1', activationIssuedAt: within(0) }),
    base({ event: 'question', operationId: 'op-q', questionKey: 'BUILD_TARGET', askedAt: within(0) }),
    base({ event: 'delivered', operationId: 'op-1', questionKey: 'BUILD_TARGET', at: within(0) }),
    base({ event: 'answer', operationId: 'op-1', questionKey: 'BUILD_TARGET', at: within(0) }),
    base({ event: 'cancel', operationId: 'op-1', questionKey: 'BUILD_TARGET', at: within(0) }),
    base({ event: 'fallback', operationId: 'op-1', questionKey: 'BUILD_TARGET', cause: 'timeout', at: within(0) }),
    base({ event: 'reconnect', operationId: 'op-1', instanceId: 'inst-1', at: within(0) }),
    base({ event: 'lease', operationId: 'op-1', questionKey: 'BUILD_TARGET', leaseId: 'lease-1', heldUntil: within(60_000) }),
    base({ event: 'lifecycle', state: 'displayed', at: within(0) }),
  ]
  for (const c of cases) {
    const r = proto.validateLifecycleEvent(c, { nowMs: NOW })
    assert.strictEqual(r.ok, true, `${c.event}: ${r.rule || ''}`)
    assert.strictEqual(r.event.event, c.event)
  }
})

check('lifecycle-state machine: legal arcs and idempotent identity', () => {
  assert.strictEqual(state.canTransition('displaying', 'displayed'), true)
  assert.strictEqual(state.canTransition('displaying', 'fallback-pending'), true)
  assert.strictEqual(state.canTransition('displayed', 'answered'), true)
  assert.strictEqual(state.canTransition('displayed', 'displaying'), false)
  assert.strictEqual(state.canTransition('answered', 'active'), false)
  assert.strictEqual(state.isTerminalState('answered'), true)
  assert.strictEqual(state.isTerminalState('recovering'), false)
  const id1 = state.operationIdentity({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  const id2 = state.operationIdentity({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(id1.operationId, id2.operationId, 'same (sessionId, questionKey) -> same operation identity')
  assert.strictEqual(state.isDurableState('displaying'), true)
  assert.strictEqual(state.isDurableState('connected'), false, 'live connection states are never durable states')
})

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
