'use strict'

/**
 * candice failure matrix — Claude busy — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "Claude busy while companion prompt is submitted" leg (spec
 * 13.3: when Claude is working, the delivery QUEUES and surfaces the "not
 * yet" state; it never injects while busy). Drives the REAL WS-05 terminal
 * adapter's busy path: queued, flushed in order once idle, never injected
 * while busy, and a BROKEN busy probe fails closed (queue, never inject
 * blind).
 *
 * Invariants: Claude is never interrupted mid-turn by Candice; a broken
 * probe can never cause a blind inject; the queue is bounded and
 * per-session.
 */

const assert = require('assert')
const path = require('path')
const { check, finish } = require('./harness')

const FALLBACK = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'fallback')
const { TerminalInputAdapter } = require(path.join(FALLBACK, 'terminal-input-adapter'))

function acceptAllRoute() {
  return {
    resolveRoute: ({ sessionId }) => ({ ok: true, routeTo: sessionId }),
  }
}

function main() {
  // ---- Claude busy: text queues, never injects. ----
  check('Claude busy: submission queues with the "not yet" state, nothing injected', () => {
    let injected = 0
    const adapter = new TerminalInputAdapter({
      route: acceptAllRoute(),
      sessionBusy: () => true,
      handlers: { submit: () => { injected += 1 } },
    })
    const r = adapter.submitText({ sessionId: 'sess-busy-1', text: 'my answer', windowId: 'tab-1' })
    assert.equal(r.ok, true)
    assert.equal(r.queued, true)
    assert.ok(r.note.includes('Claude is working'))
    assert.equal(injected, 0, 'nothing injected while Claude is busy')
    assert.equal(adapter.pendingCount('sess-busy-1'), 1)
  })

  // ---- Once idle: flush submits in order, exactly once each. ----
  check('Claude idle again: queued texts flush in order, exactly once each', () => {
    const injected = []
    let busy = true
    const adapter = new TerminalInputAdapter({
      route: acceptAllRoute(),
      sessionBusy: () => busy,
      handlers: { submit: (t) => injected.push(t) },
    })
    adapter.submitText({ sessionId: 'sess-busy-2', text: 'first', windowId: 'tab-1' })
    adapter.submitText({ sessionId: 'sess-busy-2', text: 'second', windowId: 'tab-1' })
    busy = false
    const flushed = adapter.flush('sess-busy-2')
    assert.equal(flushed, 2)
    assert.deepEqual(injected, ['first', 'second'])
    assert.equal(adapter.pendingCount('sess-busy-2'), 0)
    // Flushing while idle again is a no-op: no double submit.
    const again = adapter.flush('sess-busy-2')
    assert.equal(again, 0)
    assert.equal(injected.length, 2)
  })

  // ---- Broken busy probe: fail CLOSED — queue, never inject blind. ----
  check('broken busy probe fails closed: queue, never inject blind', () => {
    let injected = 0
    const adapter = new TerminalInputAdapter({
      route: acceptAllRoute(),
      sessionBusy: () => {
        throw new Error('probe crashed')
      },
      handlers: { submit: () => { injected += 1 } },
    })
    const r = adapter.submitText({ sessionId: 'sess-busy-3', text: 'answer', windowId: 'tab-1' })
    assert.equal(r.ok, true)
    assert.equal(r.queued, true, 'a broken busy probe queues rather than injecting')
    assert.equal(injected, 0)
  })

  // ---- Queue bound: a full queue refuses rather than growing unbounded. ----
  check('queue is bounded: a full queue refuses new entries', () => {
    const adapter = new TerminalInputAdapter({
      route: acceptAllRoute(),
      sessionBusy: () => true,
    })
    let ok = true
    for (let i = 0; i < 32; i += 1) {
      const r = adapter.submitText({ sessionId: 'sess-busy-4', text: `msg-${i}`, windowId: 'tab-1' })
      if (!r.ok) ok = false
    }
    assert.equal(ok, true, 'queue holds up to its bound')
    const overflow = adapter.submitText({ sessionId: 'sess-busy-4', text: 'overflow', windowId: 'tab-1' })
    assert.equal(overflow.ok, false)
    assert.equal(overflow.code, 'queue-full')
  })

  finish('CLAUDE-BUSY')
}

main()
