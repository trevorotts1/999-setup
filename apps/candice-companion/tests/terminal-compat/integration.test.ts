/**
 * WS-25 acceptance tests — macOS Terminal/iTerm compatibility (integration)
 * (CHECKLIST E.1 WS-25 + Master Spec 17/27/28).
 *
 * Binary criteria proven here (fixture level; live app launch is the
 * `e2e-live.mjs` harness):
 *
 *  1. Session identity is the routing authority — a window anchor is
 *     visual metadata ONLY. `route` never accepts a window as routing
 *     proof; session id is the only routing input.
 *  2. One top-level terminal window may host many Claude sessions
 *     (Terminal.app tabs, iTerm2 tabs/panes). When a window maps to more
 *     than one session, routing MUST refuse (`ambiguous-window`), never
 *     guess, never cross-route (spec 17: "switching tabs/panes must never
 *     send a Candice answer to another Claude session").
 *  3. A window bound to a session other than the candidate refuses the
 *     route (`unproven-session` / `ambiguous-window`), even when the
 *     candidate session itself is active.
 *  4. Routing to the exact active session succeeds only when no window
 *     ambiguity exists; the anchored window is used purely for placement.
 *  5. Rebind changes only the visual anchor; session identity never
 *     changes on rebind (move/resize/minimize/monitor follow).
 *  6. endSession releases the anchor (`releaseWindowAnchor` cleanup
 *     contract from WS-03 lifecycle) — no stale anchor can later be
 *     misread as a live session.
 *  7. Failure never stops Claude: every refusal is `{ok:false, code}`
 *     with a stable machine-readable code, never a throw (spec 20).
 *
 * The integration under test is the WS-03 binding bridge
 * (`plugins/candice-integration/session/bridge/binding-bridge.js` +
 * `session-lifecycle.js` facade) — the seam the app's macOS platform
 * adapter calls at runtime with the WS-21 anchor geometry. The WS-21
 * crate (src-tauri/binding/macos) is exercised by its own 35-test cargo
 * suite and by the e2e-live harness.
 *
 * Runner: plain Node >= 22.6 (Node 26 strips types natively). No external
 * dependencies — runs in any CI container and on the Mac without the app
 * toolchain:
 *
 *   cd apps/candice-companion
 *   node --test tests/terminal-compat/integration.test.ts
 *
 * Lane: WR-015 / WS-25. Owned glob (manifest 9.2):
 * `apps/candice-companion/tests/terminal-compat/**`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// WS-03 lane files are outside this lane's owned glob; they are READ-ONLY
// inputs here (the integration seam), never written.
const require = createRequire(import.meta.url)
const pluginRoot = new URL('../../../../plugins/candice-integration/session/', import.meta.url)
const { BindingBridge } = require(
  new URL('bridge/binding-bridge.js', pluginRoot).pathname
)
const { SessionLifecycle } = require(new URL('session-lifecycle.js', pluginRoot).pathname)

/** Minimal session store facade matching the bridge's `sessions` contract. */
class FakeSessions {
  constructor() {
    this.active = new Map() // sessionId -> true
  }
  activate(id) { this.active.set(id, true); return true }
  deactivate(id) { this.active.delete(id) }
  isActive(id) { return this.active.has(id) }
}

function makeBridge() {
  const sessions = new FakeSessions()
  const raw = new BindingBridge({ sessions })
  // route() is the lifecycle-facade name; the bridge exposes resolveRoute().
  const bridge = {
    route: (args) => raw.resolveRoute(args),
    bind: (args) => raw.bind(args),
    rebind: (args) => raw.rebind(args),
    unbind: (args) => raw.unbind(args),
    getBinding: (id) => raw.getBinding(id),
    anchorForWindow: (id) => raw.anchorForWindow(id),
  }
  return { sessions, bridge }
}

test('WS-25: a bare window is never routing evidence — resolveRoute refuses', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-window-only')
  // Candidate session IS active, but the ONLY evidence offered is a window.
  const route = bridge.route({ sessionId: 'sess-window-only', windowId: 'w-terminal-1' })
  assert.equal(route.ok, false)
  assert.equal(route.code, 'unproven-session') // window bound to no session
  // No session was ever bound: nothing can route on a window alone.
})

test('WS-25: route by session id alone succeeds with no window involved', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-a')
  const route = bridge.route({ sessionId: 'sess-a' })
  assert.deepEqual(route, { ok: true, routeTo: 'sess-a' })
})

test('WS-25: bind is visual metadata only — it never becomes routing authority', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-a')
  const bound = bridge.bind({ sessionId: 'sess-a', windowAnchor: { kind: 'window-id', value: 'w-1' } })
  assert.equal(bound.ok, true)
  // Still routes by session id alone.
  const route = bridge.route({ sessionId: 'sess-a' })
  assert.equal(route.ok, true)
  assert.equal(route.routeTo, 'sess-a')
})

test('WS-25: two sessions sharing one terminal window (tabs) -> ambiguous, refused', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-tab-a')
  sessions.activate('sess-tab-b')
  bridge.bind({ sessionId: 'sess-tab-a', windowAnchor: 'w-tabs' })
  bridge.bind({ sessionId: 'sess-tab-b', windowAnchor: 'w-tabs' })
  // Switching to tab A must never route to tab B or guess.
  for (const sessionId of ['sess-tab-a', 'sess-tab-b']) {
    const route = bridge.route({ sessionId, windowId: 'w-tabs' })
    assert.equal(route.ok, false)
    assert.equal(route.code, 'ambiguous-window')
  }
  // Without a window argument both route to their own exact session.
  assert.equal(bridge.route({ sessionId: 'sess-tab-a' }).routeTo, 'sess-tab-a')
  assert.equal(bridge.route({ sessionId: 'sess-tab-b' }).routeTo, 'sess-tab-b')
})

test('WS-25: window bound to a different active session -> refused, never cross-routed', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-owner')
  sessions.activate('sess-intruder')
  bridge.bind({ sessionId: 'sess-owner', windowAnchor: 'w-owner' })
  const route = bridge.route({ sessionId: 'sess-intruder', windowId: 'w-owner' })
  assert.equal(route.ok, false)
  // The window maps to exactly one session, but NOT the candidate: the
  // exact target cannot be proven -> ambiguous/refused (spec 17).
  assert.equal(route.code, 'ambiguous-window')
})

test('WS-25: single-window single-session anchor is confirmed, but routing still by session', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-solo')
  bridge.bind({ sessionId: 'sess-solo', windowAnchor: 'w-solo' })
  const route = bridge.route({ sessionId: 'sess-solo', windowId: 'w-solo' })
  assert.equal(route.ok, true)
  assert.equal(route.routeTo, 'sess-solo')
  // anchorForWindow reports the anchor for placement only.
  assert.deepEqual(bridge.anchorForWindow('w-solo'), ['sess-solo'])
})

test('WS-25: inactive session can never route, even with an anchor present', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-live')
  sessions.activate('sess-dying')
  bridge.bind({ sessionId: 'sess-dying', windowAnchor: 'w-dying' })
  sessions.deactivate('sess-dying')
  const route = bridge.route({ sessionId: 'sess-dying' })
  assert.equal(route.ok, false)
  assert.equal(route.code, 'session-not-active')
  // The live session is unaffected.
  assert.equal(bridge.route({ sessionId: 'sess-live' }).ok, true)
})

test('WS-25: rebind changes only the anchor — identity never changes', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-m')
  bridge.bind({ sessionId: 'sess-m', windowAnchor: 'w-old' })
  const rebound = bridge.rebind({ sessionId: 'sess-m', windowAnchor: 'w-new' })
  assert.equal(rebound.ok, true)
  const binding = bridge.getBinding('sess-m')
  assert.equal(binding.windowAnchor.value, 'w-new')
  assert.equal(binding.sessionId, 'sess-m') // identity stable (move/resize/monitor follow)
})

test('WS-25: lifecycle endSession releases the window anchor (cleanup manifest)', () => {
  const lifecycle = new SessionLifecycle({ stateDir: null })
  const begin = lifecycle.beginSession({ sessionId: 'sess-life', skill: 'spec-protocol', windowAnchor: 'w-life' })
  assert.equal(begin.ok, true)
  assert.equal(lifecycle.status({ sessionId: 'sess-life' }).windowAnchor.value, 'w-life')
  const end = lifecycle.endSession({ sessionId: 'sess-life', reason: 'interview complete' })
  assert.equal(end.ok, true)
  assert.equal(end.cleanup.releaseWindowAnchor, true)
  const after = lifecycle.status({ sessionId: 'sess-life' })
  assert.equal(after.ok, true)
  assert.equal(after.status, 'ended') // record retained for audit, never a live route
  assert.equal(after.windowAnchor, null) // anchor released
  // An ended session can never route.
  assert.equal(lifecycle.route({ sessionId: 'sess-life' }).ok, false)
  assert.equal(lifecycle.route({ sessionId: 'sess-life' }).code, 'session-not-active')
})

test('WS-25: session id hygiene — invalid/oversized ids are refused, never routed', () => {
  const { sessions, bridge } = makeBridge()
  for (const bad of ['', '  ', 'a b', 'x'.repeat(129), 42, null, undefined]) {
    const route = bridge.route({ sessionId: bad })
    assert.equal(route.ok, false)
    assert.equal(route.code, 'invalid-session-id')
  }
})

test('WS-25: stable failure codes (spec 20) — every refusal is {ok:false,code}, never a throw', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-x')
  const codes = new Set()
  for (const r of [
    bridge.route({ sessionId: '' }),
    bridge.route({ sessionId: 'sess-ghost' }),
    bridge.route({ sessionId: 'sess-x', windowId: 'w-unbound' }),
  ]) {
    assert.equal(r.ok, false)
    assert.ok(r.code.length > 0)
    codes.add(r.code)
  }
  assert.ok(codes.has('invalid-session-id'))
  assert.ok(codes.has('session-not-active'))
  assert.ok(codes.has('unproven-session'))
})

test('WS-25: sanitized anchors — junk window anchors degrade to no-anchor, never crash', () => {
  const { sessions, bridge } = makeBridge()
  sessions.activate('sess-an')
  for (const junk of ['', '   ', 42, { kind: 7, value: '' }, { value: 'x' }]) {
    const bound = bridge.bind({ sessionId: 'sess-an', windowAnchor: junk })
    // Session open is enough; a junk anchor is metadata-only and must not fail the bind.
    assert.equal(bound.ok, true)
    const b = bridge.getBinding('sess-an')
    assert.ok(b.windowAnchor === null || typeof b.windowAnchor.value === 'string')
  }
})
