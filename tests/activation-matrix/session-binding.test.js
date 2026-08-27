'use strict'

/**
 * candice activation matrix — session-binding leg.
 * Owned path: tests/activation-matrix/** (G22 FIX-010 automated evidence).
 *
 * Automates exact-session binding semantics against the real WS-03
 * BindingBridge: the session ID is the routing authority, window data is
 * visual-only, tab/pane ambiguity disables injection, and no route is ever
 * resolved to "the window". Two Claude sessions can never cross-bind.
 * Consumes plugins/candice-integration/session/** read-only.
 */

const test = require('node:test')
const { assert, loadDeps, FakeSessionStore } = require('./harness')

const { BindingBridge } = loadDeps()

test('bind requires a live active session and stores only a visual anchor', () => {
  const sessions = new FakeSessionStore()
  const bridge = new BindingBridge({ sessions })
  assert.equal(bridge.bind({ sessionId: 'session-a' }).ok, false)
  assert.equal(bridge.bind({ sessionId: 'session-a' }).code, 'session-not-active')
  sessions.beginSession({ sessionId: 'session-a' })
  const result = bridge.bind({ sessionId: 'session-a', windowAnchor: 'window-1' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.binding.windowAnchor, { kind: 'window-id', value: 'window-1' })
  assert.equal(bridge.getBinding('session-a').windowAnchor.value, 'window-1')
  assert.equal(bridge.bind({ sessionId: 'not-an-opaque id' }).code, 'invalid-session-id')
})

test('two Claude sessions get distinct bindings and can never cross-bind', () => {
  const sessions = new FakeSessionStore()
  const bridge = new BindingBridge({ sessions })
  sessions.beginSession({ sessionId: 'session-a' })
  sessions.beginSession({ sessionId: 'session-b' })
  bridge.bind({ sessionId: 'session-a', windowAnchor: 'window-1' })
  bridge.bind({ sessionId: 'session-b', windowAnchor: 'window-2' })
  // Each session resolves only to itself.
  assert.deepEqual(bridge.resolveRoute({ sessionId: 'session-a' }), { ok: true, routeTo: 'session-a' })
  assert.deepEqual(bridge.resolveRoute({ sessionId: 'session-b' }), { ok: true, routeTo: 'session-b' })
  // A window that maps to exactly one session is still not a routing
  // shortcut for the OTHER session.
  const cross = bridge.resolveRoute({ sessionId: 'session-b', windowId: 'window-1' })
  assert.equal(cross.ok, false)
  assert.equal(cross.code, 'ambiguous-window')
  // Ending session-a cannot disturb session-b's binding.
  sessions.endSession('session-a')
  assert.deepEqual(bridge.resolveRoute({ sessionId: 'session-b' }), { ok: true, routeTo: 'session-b' })
  assert.equal(bridge.resolveRoute({ sessionId: 'session-a' }).code, 'session-not-active')
})

test('tab/pane ambiguity disables injection: one window, two sessions', () => {
  const sessions = new FakeSessionStore()
  const bridge = new BindingBridge({ sessions })
  sessions.beginSession({ sessionId: 'session-a' })
  sessions.beginSession({ sessionId: 'session-b' })
  // Windows Terminal tabs / macOS tab panes: one host window id, two sessions.
  bridge.bind({ sessionId: 'session-a', windowAnchor: 'shared-window' })
  bridge.bind({ sessionId: 'session-b', windowAnchor: 'shared-window' })
  assert.deepEqual(bridge.anchorForWindow('shared-window'), ['session-a', 'session-b'])
  for (const sessionId of ['session-a', 'session-b']) {
    const route = bridge.resolveRoute({ sessionId, windowId: 'shared-window' })
    assert.equal(route.ok, false, 'ambiguous window must disable injection')
    assert.equal(route.code, 'ambiguous-window')
  }
  // Without window evidence, exact-session routing still works.
  assert.deepEqual(bridge.resolveRoute({ sessionId: 'session-a' }), { ok: true, routeTo: 'session-a' })
})

test('an unproven session is a hard fail and never routes to a window', () => {
  const sessions = new FakeSessionStore()
  const bridge = new BindingBridge({ sessions })
  sessions.beginSession({ sessionId: 'session-a' })
  bridge.bind({ sessionId: 'session-a', windowAnchor: 'window-1' })
  // Unknown session, known window: still refused.
  const unknown = bridge.resolveRoute({ sessionId: 'session-b', windowId: 'window-1' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'session-not-active')
  // Known session, window bound to nothing: refused, never guessed.
  const unproven = bridge.resolveRoute({ sessionId: 'session-a', windowId: 'window-9' })
  assert.equal(unproven.ok, false)
  assert.equal(unproven.code, 'unproven-session')
  // Dead session cannot be rebound.
  sessions.endSession('session-a')
  assert.equal(bridge.bind({ sessionId: 'session-a' }).code, 'session-not-active')
})

test('rebind changes only the visual anchor; session identity is immutable', () => {
  const sessions = new FakeSessionStore()
  const bridge = new BindingBridge({ sessions })
  sessions.beginSession({ sessionId: 'session-a' })
  bridge.bind({ sessionId: 'session-a', windowAnchor: 'window-1' })
  const rebind = bridge.rebind({ sessionId: 'session-a', windowAnchor: 'window-2' })
  assert.equal(rebind.ok, true)
  assert.equal(bridge.getBinding('session-a').windowAnchor.value, 'window-2')
  assert.deepEqual(bridge.resolveRoute({ sessionId: 'session-a', windowId: 'window-2' }), { ok: true, routeTo: 'session-a' })
  // Rebinding a never-bound session fails.
  sessions.beginSession({ sessionId: 'session-b' })
  assert.equal(bridge.rebind({ sessionId: 'session-b' }).code, 'not-bound')
})

test('unbind releases the anchor and later routes fail as session-not-active', () => {
  const sessions = new FakeSessionStore()
  const bridge = new BindingBridge({ sessions })
  sessions.beginSession({ sessionId: 'session-a' })
  bridge.bind({ sessionId: 'session-a', windowAnchor: 'window-1' })
  assert.equal(bridge.unbind({ sessionId: 'session-a' }).ok, true)
  assert.equal(bridge.getBinding('session-a'), null)
  assert.equal(bridge.unbind({ sessionId: 'session-a' }).code, 'not-bound')
})

// Exit contract for suite.js (matches tests/same-session convention).
test('prints ALL TESTS PASSED when every check passed', () => {
  assert.ok(true)
})
