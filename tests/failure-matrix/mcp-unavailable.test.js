'use strict'

/**
 * candice failure matrix — MCP unavailable — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "MCP server unavailable" leg (spec 13.2/20: the ask_user tool
 * fails soft with a stable instruction; the skill asks the same question in
 * Claude normally through the WS-05 fallback; no double-count). Drives the
 * REAL WS-04 server: readiness probe off, deliverer absent, invalid /
 * unknown-question shapes, and the cross-path double-count proof.
 *
 * Invariants: every unavailability path yields isError with the same
 * ask-in-Claude instruction; no answer slot is left open; a terminal-path
 * answer reconciles exactly once.
 */

const assert = require('assert')
const path = require('path')
const { check, checkAsync, finish } = require('./harness')

const MCP = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'mcp', 'ask-user')
const FALLBACK = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'fallback')

const { AskUserServer } = require(path.join(MCP, 'server'))
const { FallbackCoordinator } = require(path.join(FALLBACK, 'fallback-coordinator'))
const { canonicalQuestion } = require(path.join(__dirname, '..', '..', 'packages', 'candice-protocol', 'question-registry'))

const Q = canonicalQuestion({ sessionId: 'sess-mcp-unavailable', questionKey: 'BUILD_TARGET', skill: 'spec-protocol' }).question

async function main() {
  // ---- MCP server unavailable: readiness probe false. ----
  await checkAsync('MCP unavailable (not ready): fail soft, same ask-in-Claude instruction', async () => {
    const server = new AskUserServer({ isCompanionReady: () => false })
    const env = await server.askUser({ question: Q })
    assert.equal(env.result.isError, true)
    assert.ok(env.result.content[0].text.includes('companion is unavailable'))
    assert.ok(env.result.content[0].text.includes('ask the same question in Claude normally'))
    assert.equal(server.registry.openCount(), 0, 'no slot was ever opened')
  })

  // ---- MCP unavailable: the skill falls back through WS-05, same question. ----
  check('MCP unavailable: fallback hands the SAME question to Claude, no double-count', () => {
    const coord = new FallbackCoordinator()
    const fb = coord.fallbackQuestion({ ...Q })
    assert.equal(fb.ok, true)
    assert.equal(fb.prompt.text, Q.text)
    // The MCP path failed BEFORE opening a lifecycle record; the terminal
    // answer reconciles exactly once and refuses a second.
    const ans = coord.answerFromTerminal({ sessionId: Q.sessionId, questionKey: Q.questionKey, answerText: 'Operators' })
    assert.equal(ans.ok, true)
    assert.equal(ans.answer.inputMode, 'terminal')
    const again = coord.answerFromTerminal({ sessionId: Q.sessionId, questionKey: Q.questionKey, answerText: 'again' })
    assert.equal(again.ok, false)
    assert.equal(again.code, 'already-answered')
  })

  // ---- Invalid question: tool refuses without touching the session. ----
  await checkAsync('malformed question: refused with named rule, session untouched', async () => {
    const server = new AskUserServer({ isCompanionReady: () => true })
    const bad = { ...Q, text: '' }
    const env = await server.askUser({ question: bad })
    assert.equal(env.result.isError, true)
    assert.ok(env.result.content[0].text.includes('invalid question event'))
    assert.ok(env.result.content[0].text.includes('ask the same question in Claude normally'))
  })

  await checkAsync('unknown question key: never delivered, slot released, fail soft', async () => {
    const server = new AskUserServer({ isCompanionReady: () => true })
    const unknown = { ...Q, questionKey: 'NOT_A_REAL_KEY' }
    const env = await server.askUser({ question: unknown })
    assert.equal(env.result.isError, true)
    const text = env.result.content[0].text
    assert.ok(text.includes('unregistered-governed-question'), `unknown governed key is rejected before delivery, got: ${text}`)
    assert.ok(text.includes('ask the same question in Claude normally'), `fallback instruction kept, got: ${text}`)
    assert.equal(server.registry.openCount(), 0, 'no slot is left open for an undelivered question')
  })

  // ---- MCP unavailable at the wire: JSON-RPC errors are structured. ----
  check('MCP wire: malformed frame gets a JSON-RPC parse error, not a crash', () => {
    const server = new AskUserServer({})
    const err = server._dispatch('this is not json')
    assert.equal(err.error.code, -32700)
    const unknown = server._dispatch('{"jsonrpc":"2.0","id":1,"method":"nope"}')
    assert.equal(unknown.error.code, -32601)
  })

  finish('MCP-UNAVAILABLE')
}

main()
