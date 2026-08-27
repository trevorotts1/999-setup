'use strict'

/**
 * candice failure matrix — app missing — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 first leg: "app missing". The companion app is absent, so the
 * WS-04 `candice.ask_user` MCP tool must fail SOFT with a stable instruction
 * the skill can act on ("ask the same question in Claude normally", spec
 * 13.2/20), and the WS-05 coordinator must then hand the SAME question to the
 * terminal surface without losing state and without double-counting (spec
 * 5.1). Claude is never blocked: every leg returns a decision, never a throw.
 *
 * Wire shape: askUser() resolves to the JSON-RPC tool envelope
 * `{ result: { content, isError, ok } }`; the domain outcome lives inside.
 */

const path = require('path')
const assert = require('assert')
const { check, checkAsync, finish } = require('./harness')

const MCP = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'mcp', 'ask-user')
const FALLBACK = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'fallback')

const { AskUserServer } = require(path.join(MCP, 'server'))
const { FallbackCoordinator } = require(path.join(FALLBACK, 'fallback-coordinator'))
const { canonicalQuestion } = require(path.join(__dirname, '..', '..', 'packages', 'candice-protocol', 'question-registry'))

const Q = canonicalQuestion({ sessionId: 'sess-app-missing', questionKey: 'BUILD_TARGET', skill: 'spec-protocol' }).question

async function main() {
  // -- App missing: no deliverer, no readiness flag (companion absent). --------
  await checkAsync('app missing: ask_user fails soft with ask-in-Claude instruction', async () => {
    const server = new AskUserServer({}) // no deliverQuestion, no lifecycle, companion not ready
    const env = await server.askUser({ question: Q })
    assert.equal(env.result.isError, true, 'domain failure flag set')
    const text = env.result.content[0].text
    assert.ok(text.includes('companion is unavailable'), `expected companion-unavailable, got: ${text}`)
    assert.ok(text.includes('ask the same question in Claude normally'), `expected fallback instruction, got: ${text}`)
  })

  await checkAsync('app missing never opens an answer slot', async () => {
    const server = new AskUserServer({})
    await server.askUser({ question: Q })
    assert.equal(server.registry.openCount(), 0, 'no slot may remain open after a failed ask')
  })

  // -- The skill falls back: the SAME question goes to the terminal surface, once. --
  check('fallback hands the same question to Claude, counted once', () => {
    const coord = new FallbackCoordinator()
    const fallback = coord.fallbackQuestion({ ...Q })
    assert.equal(fallback.ok, true)
    assert.equal(fallback.redelivered, false)
    assert.equal(fallback.counted, Q.counted)
    assert.equal(fallback.prompt.text, Q.text, 'the fallback prompt is the SAME question text')
    assert.equal(fallback.prompt.allowedInputModes.includes('terminal'), true)
    const row = coord.guard.status().find(
      (r) => r.sessionId === Q.sessionId && r.questionKey === Q.questionKey
    )
    assert.equal(row.status, 'deferred')
    assert.equal(row.counted, Q.counted)
  })

  check('app missing while a second question waits: no cross-question mixing', () => {
    const coord = new FallbackCoordinator()
    coord.fallbackQuestion({ ...Q })
    const second = coord.fallbackQuestion({ ...Q, questionKey: 'DEPARTMENT', text: 'Which department?' })
    assert.equal(second.ok, false)
    assert.equal(second.code, 'unregistered-governed-question')
    const rows = coord.guard.status().filter((r) => r.sessionId === Q.sessionId)
    assert.equal(rows.length, 1, 'an unregistered question never creates a terminal deferral row')
  })

  // -- "app missing" must never throw out of the tool call (spec 20). ---------
  await checkAsync('deliverer that throws is captured, not propagated', async () => {
    const server = new AskUserServer({
      isCompanionReady: () => true,
      deliverQuestion: async () => {
        throw new Error('companion binary crashed while rendering')
      },
    })
    const env = await server.askUser({ question: Q })
    assert.equal(env.result.isError, true, 'domain failure flag set')
    const text = env.result.content[0].text
    assert.ok(text.includes('companion binary crashed while rendering'), `deliverer error surfaces, got: ${text}`)
    assert.ok(text.includes('ask the same question in Claude normally'), `fallback instruction kept, got: ${text}`)
    assert.equal(server.registry.openCount(), 0, 'slot released after delivery failure')
  })

  finish('APP-MISSING')
}

main()
