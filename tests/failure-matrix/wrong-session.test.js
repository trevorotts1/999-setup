'use strict'

/**
 * candice failure matrix — wrong session target — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "wrong terminal/session target" leg (spec 17: session id / bridge
 * is the routing authority; a window is never session identity; wrong-session
 * answers are refused, never re-routed; injection disables itself when the
 * exact target session cannot be proven). Drives the REAL WS-04 registry
 * (session mismatch refusal), the REAL WS-05 terminal adapter (unproven
 * targets refuse, a window alone is never evidence), and the REAL WS-03
 * session manager (cross-session answer refusal).
 */

const assert = require('assert')
const path = require('path')
const { check, finish } = require('./harness')

const MCP = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'mcp', 'ask-user')
const FALLBACK = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'fallback')
const SESSION = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'session')

const { AnswerSlotRegistry } = require(path.join(MCP, 'answer-registry'))
const { TerminalInputAdapter } = require(path.join(FALLBACK, 'terminal-input-adapter'))
const { SessionManager } = require(path.join(SESSION, 'session-manager'))

function main() {
  // ---- WS-04: an answer from another session is refused. ----
  check('wrong session: an answer for the wrong session never lands (no-open-slot), owning slot untouched', () => {
    const reg = new AnswerSlotRegistry()
    reg.open({ sessionId: 'sess-a', questionKey: 'BUILD_TARGET' })
    const wrong = reg.put({
      sessionId: 'sess-b', // answer claims a DIFFERENT session
      questionKey: 'BUILD_TARGET',
      answer: {
        schemaVersion: '1.0',
        sessionId: 'sess-b',
        questionKey: 'BUILD_TARGET',
        answerText: 'wrong session answer',
        inputMode: 'typed',
        userConfirmedTranscript: true,
      },
    })
    assert.equal(wrong.ok, false)
    assert.equal(wrong.code, 'no-open-slot', 'the slot is keyed to the owning session — a wrong-session answer has no slot')
    assert.equal(reg.openCount(), 1, 'the owning slot stays open for the real session')
  })

  // ---- WS-05: a window alone is never routing evidence. ----
  check('wrong target: no route resolver + window evidence => refuse (window is never session identity)', () => {
    const adapter = new TerminalInputAdapter({}) // no resolver, no injector
    const r = adapter.submitText({ sessionId: 'sess-a', text: 'answer', windowId: 'terminal-tab-3' })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'unproven-session')
    assert.equal(r.error.includes('window alone is never routing evidence'), true)
  })

  check('wrong target: without proof of the exact session, refuse rather than guess', () => {
    const adapter = new TerminalInputAdapter({})
    const r = adapter.submitText({ sessionId: 'sess-a', text: 'answer' })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'unproven-session')
  })

  check('wrong target: route resolver that refuses leaves the answer undelivered (spec 20)', () => {
    let submitted = 0
    const adapter = new TerminalInputAdapter({
      route: {
        resolveRoute({ sessionId }) {
          // The bridge cannot prove this session -> refuse.
          return { ok: false, code: 'no-proof', error: 'session cannot be proven' }
        },
      },
      handlers: { submit: () => { submitted += 1 } },
    })
    const r = adapter.submitText({ sessionId: 'sess-a', text: 'answer', windowId: 'tab-1' })
    assert.equal(r.ok, false)
    assert.equal(submitted, 0, 'nothing injected without proof')
  })

  // ---- WS-03: the session manager refuses cross-session answer records. ----
  check('WS-03 session manager: answer for an unknown/wrong session is refused', () => {
    const manager = new SessionManager()
    // No question was ever asked in sess-c — a synthetic answer must be refused.
    const recorded = manager.recordAnswer({ sessionId: 'sess-c', questionKey: 'BUILD_TARGET' })
    assert.equal(recorded.ok, false)
  })

  finish('WRONG-SESSION')
}

main()
