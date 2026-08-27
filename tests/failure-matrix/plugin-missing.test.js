'use strict'

/**
 * candice failure matrix — plugin missing — owned path: tests/failure-matrix/**
 *
 * E.1 WS-43 "plugin missing" leg (spec 13/20). The plugin surface is absent,
 * so the ask_user MCP tool must fail soft with the stable ask-in-Claude
 * instruction, and the WS-05 fallback coordinator must keep the question
 * going through the terminal path — the fallback lives without the MCP path.
 *
 * This file is executed TWICE by suite.js with a different environment:
 *   node plugin-missing.test.js            — normal run (plugin modules present)
 *   CANDICE_FM_SILENT_MCP=1 node plugin-missing.test.js  — simulates the
 *     companion side never answering (a missing/silent plugin that accepted
 *     the question but never returns an answer): the tool times out and
 *     fails soft instead of blocking the session forever.
 */

const assert = require('assert')
const path = require('path')
const { check, checkAsync, finish } = require('./harness')

const MCP = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'mcp', 'ask-user')
const FALLBACK = path.join(__dirname, '..', '..', 'plugins', 'candice-integration', 'fallback')

const { AskUserServer } = require(path.join(MCP, 'server'))
const { AnswerSlotRegistry } = require(path.join(MCP, 'answer-registry'))
const { FallbackCoordinator } = require(path.join(FALLBACK, 'fallback-coordinator'))
const { canonicalQuestion } = require(path.join(__dirname, '..', '..', 'packages', 'candice-protocol', 'question-registry'))

const Q = canonicalQuestion({ sessionId: 'sess-plugin-missing', questionKey: 'BUILD_TARGET', skill: 'spec-protocol' }).question

function lifecycleStub() {
  return {
    setPendingQuestion: () => ({ ok: true }),
    recordAnswer: () => ({ ok: true }),
    recoverPendingQuestion: () => ({ ok: true, recovered: null }),
    resumeSession: () => ({ ok: true }),
  }
}

async function main() {
  if (process.env.CANDICE_FM_SILENT_MCP === '1') {
    // ---- Mode 2: MCP accepted the question but never answers (silent). ----
    await checkAsync('silent MCP: ask_user times out soft with ask-in-Claude instruction, never hangs the session', async () => {
      let sleepless = false
      const server = new AskUserServer({
        isCompanionReady: () => true,
        registry: new AnswerSlotRegistry(),
        lifecycle: lifecycleStub(),
        deliverQuestion: async () => ({ ok: true }),
        waitWindowMs: 30,
        sleep: async () => {
          sleepless = true
        },
      })
      const env = await server.askUser({ question: Q })
      assert.equal(sleepless, true, 'the poll loop actually polled')
      assert.equal(env.result.isError, true)
      assert.ok(env.result.content[0].text.includes('no approved answer within the wait window'))
      assert.ok(env.result.content[0].text.includes('ask the same question in Claude normally'))
      assert.equal(server.registry.openCount(), 0, 'slot released after the timeout')
    })
    finish('PLUGIN-MISSING (silent-MCP mode)')
    return
  }

  // ---- Mode 1: plugin surface entirely absent. ----
  check('plugin missing: ask_user fails soft with the same ask-in-Claude instruction', async () => {
    const server = new AskUserServer({}) // no readiness, no deliverer — the plugin surface is gone
    const env = await server.askUser({ question: Q })
    assert.equal(env.result.isError, true)
    assert.ok(env.result.content[0].text.includes('companion is unavailable'))
    assert.ok(env.result.content[0].text.includes('ask the same question in Claude normally'))
  })

  check('plugin missing: the fallback coordinator still answers through the terminal path', () => {
    const coord = new FallbackCoordinator()
    const fb = coord.fallbackQuestion({ ...Q })
    assert.equal(fb.ok, true)
    assert.equal(fb.prompt.text, Q.text)
    const ans = coord.answerFromTerminal({ sessionId: Q.sessionId, questionKey: Q.questionKey, answerText: 'The operators' })
    assert.equal(ans.ok, true)
    assert.equal(ans.answer.inputMode, 'terminal')
    assert.equal(ans.answer.userConfirmedTranscript, true)
    // Second answer to the same question is refused — the terminal path
    // records exactly once even with the plugin gone.
    const again = coord.answerFromTerminal({ sessionId: Q.sessionId, questionKey: Q.questionKey, answerText: 'Second try' })
    assert.equal(again.ok, false)
    assert.equal(again.code, 'already-answered')
  })

  await checkAsync('plugin missing: JSON-RPC initialize/tools/list still work (plugin absent, MCP wire intact)', async () => {
    const server = new AskUserServer({})
    const init = server._dispatch('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}')
    assert.equal(init.result.serverInfo.name, 'candice')
    assert.equal(init.result.protocolVersion, '2025-06-18')
    const list = server._dispatch('{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
    assert.equal(list.result.tools[0].name, 'ask_user')
  })

  finish('PLUGIN-MISSING')
}

main()
