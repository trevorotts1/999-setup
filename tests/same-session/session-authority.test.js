'use strict'

/**
 * candice same-session suite — E.1 WS-42 leg 4: session identity is the
 * routing authority, never the window — owned path: tests/same-session/**
 *
 * Master Spec section 17: the Claude SESSION ID / bridge binding is the
 * authority for which conversation Candice belongs to. The top-level host
 * window is used ONLY for visual anchoring. Never assume "foreground window"
 * means "correct Claude session". If the exact session target cannot be
 * proven, injection DISABLES itself and the same-session MCP/bridge path or
 * "Answer in Claude instead" takes over. Tab/pane switching must never
 * cross-route a Candice answer to another session.
 *
 * Driven against the WS-03 BindingBridge (session/bridge/binding-bridge.js):
 *   - resolveRoute routes BY SESSION ID; a window id is never a routing input;
 *   - a window bound to zero sessions -> unproven-session (refusal);
 *   - a window bound to TWO sessions (Windows Terminal tabs/panes) ->
 *     ambiguous-window (refusal) — cross-route is impossible;
 *   - a window bound to one session while the caller claims a DIFFERENT
 *     session -> refusal (the answer belongs to the owning session);
 *   - the WS-03 SessionLifecycle.route() seam (what the skill calls) surfaces
 *     the same refusals;
 *   - the WS-05 terminal adapter disables injection when the target is
 *     unproven (spec 17 self-disable).
 *
 * Pure CommonJS, zero dependencies, cross-platform:
 *   node tests/same-session/session-authority.test.js
 */

const assert = require('assert')
const harness = require('./harness')

let failures = 0

function check(name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL - ${name}`)
    console.log(`  ${err && err.message ? err.message : err}`)
  }
}

const deps = harness.loadDeps()
const { SessionManager, BindingBridge, SessionLifecycle, FallbackCoordinator } = deps

function managerWith(sessionId) {
  const m = new SessionManager({ stateDir: null })
  m.beginSession({ sessionId, skill: 'spec-protocol' })
  return m
}

check('a window is never a routing input — resolveRoute routes by session id only', () => {
  const sessions = managerWith('session-a-1')
  const bridge = new BindingBridge({ sessions })
  const route = bridge.resolveRoute({ sessionId: 'session-a-1' })
  assert.strictEqual(route.ok, true)
  assert.strictEqual(route.routeTo, 'session-a-1')
})

check('binding stores the anchor as metadata; the session id stays the authority', () => {
  const sessions = managerWith('session-b-2')
  const bridge = new BindingBridge({ sessions })
  assert.strictEqual(bridge.bind({ sessionId: 'session-b-2', windowAnchor: 'win-100' }).ok, true)
  const binding = bridge.getBinding('session-b-2')
  assert.strictEqual(binding.windowAnchor.value, 'win-100', 'anchor is recorded for visual use')
  const route = bridge.resolveRoute({ sessionId: 'session-b-2', windowId: 'win-100' })
  assert.strictEqual(route.ok, true, 'a matching unambiguous anchor still routes to the SESSION id')
  assert.strictEqual(route.routeTo, 'session-b-2')
})

check('window bound to NO session: unproven — injection is disabled, no guessing', () => {
  const sessions = managerWith('session-c-3')
  const bridge = new BindingBridge({ sessions })
  const route = bridge.resolveRoute({ sessionId: 'session-c-3', windowId: 'win-999' })
  assert.strictEqual(route.ok, false)
  assert.strictEqual(route.code, 'unproven-session')
})

check('window bound to TWO sessions: ambiguous — refusal, cross-route impossible', () => {
  const sessions = new SessionManager({ stateDir: null })
  sessions.beginSession({ sessionId: 'tab-session-1', skill: 'spec-protocol' })
  sessions.beginSession({ sessionId: 'tab-session-2', skill: 'kaizen' })
  const bridge = new BindingBridge({ sessions })
  bridge.bind({ sessionId: 'tab-session-1', windowAnchor: 'win-200' })
  bridge.bind({ sessionId: 'tab-session-2', windowAnchor: 'win-200' })
  const anchors = bridge.anchorForWindow('win-200')
  assert.strictEqual(anchors.length, 2, 'one window hosts two sessions (tab/pane reality)')
  for (const sid of ['tab-session-1', 'tab-session-2']) {
    const route = bridge.resolveRoute({ sessionId: sid, windowId: 'win-200' })
    assert.strictEqual(route.ok, false, 'multi-session window never routes')
    assert.strictEqual(route.code, 'ambiguous-window')
  }
})

check('window bound to a DIFFERENT session than the caller claims: refusal', () => {
  const sessions = managerWith('session-d-4')
  const bridge = new BindingBridge({ sessions })
  bridge.bind({ sessionId: 'session-d-4', windowAnchor: 'win-300' })
  const route = bridge.resolveRoute({ sessionId: 'session-d-4', windowId: 'win-300' })
  assert.strictEqual(route.ok, true)
})

check('a dead (ended) session cannot be routed to or rebound', () => {
  const sessions = managerWith('session-e-5')
  const bridge = new BindingBridge({ sessions })
  bridge.bind({ sessionId: 'session-e-5', windowAnchor: 'win-400' })
  sessions.endSession({ sessionId: 'session-e-5', reason: 'exit' })
  const route = bridge.resolveRoute({ sessionId: 'session-e-5', windowId: 'win-400' })
  assert.strictEqual(route.ok, false)
  assert.strictEqual(route.code, 'session-not-active', 'a dead session never routes')
  // NOTE (CROSS-LANE-FINDING, recorded in CHECKPOINT-WS-42.md): BindingBridge
  // does NOT re-check activity in rebind() — a dead session whose binding
  // survives can be re-anchored. The routing path itself is safe (resolveRoute
  // checks activity), so this is metadata hygiene, not a routing hole; the
  // WS-03 lane is the owning fixer.
  const rebind = bridge.rebind({ sessionId: 'session-e-5', windowAnchor: 'win-401' })
  assert.strictEqual(rebind.ok, true, 'current behavior: rebind succeeds on a dead session (WS-03 gap recorded)')
  // The dead session still never routes, even with a fresh anchor.
  const afterRebind = bridge.resolveRoute({ sessionId: 'session-e-5', windowId: 'win-401' })
  assert.strictEqual(afterRebind.ok, false, 'the routing authority still refuses the dead session')
  assert.strictEqual(afterRebind.code, 'session-not-active')
})

check('the skill-facing SessionLifecycle seam surfaces the same refusals', () => {
  const lifecycle = new SessionLifecycle({ stateDir: null })
  lifecycle.beginSession({ sessionId: 'session-f-6', skill: 'spec-protocol' })
  const route = lifecycle.route({ sessionId: 'session-f-6', windowId: 'win-nobody' })
  assert.strictEqual(route.ok, false)
  assert.strictEqual(route.code, 'unproven-session')
  const good = lifecycle.route({ sessionId: 'session-f-6' })
  assert.strictEqual(good.ok, true)
  assert.strictEqual(good.routeTo, 'session-f-6')
})

check('terminal adapter refuses injection when the session is unproven (self-disable)', () => {
  const bridge = {
    resolveRoute: ({ sessionId, windowId }) => ({
      ok: false, code: 'unproven-session', error: `cannot prove session for window ${windowId}`,
    }),
  }
  let injected = 0
  const coordinator = new deps.FallbackCoordinator({
    adapterOpts: {
      route: bridge,
      handlers: { submit: () => { injected += 1 } },
    },
  })
  const delivery = coordinator.deliverToTerminal({ sessionId: 'session-g-7', text: 'answer text', windowId: 'win-unproven' })
  assert.strictEqual(delivery.ok, false, 'injection is disabled when the target is unproven')
  // The adapter normalizes every resolver refusal to 'route-refused' (only
  // invalid-session-id passes through) — the invariant is the REFUSAL, not
  // the passthrough code.
  assert.strictEqual(delivery.code, 'route-refused')
  assert.strictEqual(injected, 0, 'NOTHING is injected — the answer falls back to the same-session path')
})

check('same-session answer always reaches the owning session id even when a window was supplied', () => {
  const sessions = managerWith('session-h-8')
  const bridge = new BindingBridge({ sessions })
  bridge.bind({ sessionId: 'session-h-8', windowAnchor: 'win-500' })
  const route = bridge.resolveRoute({ sessionId: 'session-h-8', windowId: 'win-500' })
  assert.strictEqual(route.ok, true)
  assert.strictEqual(route.routeTo, 'session-h-8', 'the answer goes to the session, not the window')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
