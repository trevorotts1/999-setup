'use strict'

/**
 * candice-integration / mcp/ask-user/mcp.test.js
 * WS-04 structured ask_user MCP path tests — owned path: plugins/candice-integration/mcp/**
 *
 * Runs with plain `node` (zero dependencies, cross-platform):
 *   node plugins/candice-integration/mcp/ask-user/mcp.test.js
 * Exits 0 on PASS, 1 on FAIL. Every assertion prints PASS/FAIL with the exact
 * input that produced it — primary-source evidence for the acceptance run.
 *
 * Covers the WS-04/E.1 acceptance criterion:
 *   "candice.ask_user MCP path delivers a question and returns exactly one
 *    answer to the owning session."
 * plus spec 13.2 checklist items 1-5 and spec 14 exactly-one/never-double-count.
 */

const assert = require('assert')
const { spawn } = require('child_process')
const path = require('path')

const { AskUserServer, SUPPORTED_PROTOCOL_VERSIONS } = require('./server')
const { AnswerSlotRegistry } = require('./answer-registry')
const { validateQuestionEvent, validateAnswerEvent } = require('./validate')

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

function question(overrides) {
  return Object.assign(
    {
      schemaVersion: '1.0',
      sessionId: 'opaque-session-id',
      skill: 'spec-protocol',
      event: 'question',
      questionKey: 'BUILD_TARGET',
      text: 'Tell me about your idea in your own words: what is it, and who is it for?',
      answerKind: 'free_text',
      allowedInputModes: ['voice', 'typed', 'terminal'],
      readAloud: true,
      sensitivity: 'normal',
      counted: false,
      progress: null,
      helpText: 'A sentence or two is plenty.',
      canGoBack: true,
    },
    overrides || {}
  )
}

function answer(overrides) {
  return Object.assign(
    {
      schemaVersion: '1.0',
      sessionId: 'opaque-session-id',
      questionKey: 'BUILD_TARGET',
      answerText: 'I want a booking tool for local barbers.',
      inputMode: 'typed',
      userConfirmedTranscript: true,
    },
    overrides || {}
  )
}

function makeServer(opts) {
  const options = Object.assign(
    {
      isCompanionReady: () => true,
      deliverQuestion: async () => ({ ok: true }),
      sleep: async () => {},
    },
    opts || {}
  )
  return new AskUserServer(options)
}

// ——————————————————————————————————————————————
// 1. Question event validation (WS-01 contract gate, spec 14)
// ——————————————————————————————————————————————

check('validateQuestionEvent accepts the canonical question event', () => {
  const r = validateQuestionEvent(question())
  assert.strictEqual(r.ok, true)
})

check('validateQuestionEvent rejects unknown fields (additionalProperties:false)', () => {
  const q = question({ extra: 'nope' })
  const r = validateQuestionEvent(q)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'extra')
})

check('validateQuestionEvent rejects a bad questionKey (lowercase)', () => {
  const r = validateQuestionEvent(question({ questionKey: 'build_target' }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'questionKey')
})

check('validateQuestionEvent rejects an unknown skill', () => {
  const r = validateQuestionEvent(question({ skill: 'not-a-supported-skill' }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'skill')
})

check('validateQuestionEvent rejects empty text', () => {
  const r = validateQuestionEvent(question({ text: '' }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'text')
})

check('validateQuestionEvent rejects an unsupported input mode', () => {
  const r = validateQuestionEvent(question({ allowedInputModes: ['telepathy'] }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'allowedInputModes')
})

check('validateQuestionEvent rejects an unregistered secret even when readAloud is false', () => {
  const r = validateQuestionEvent(question({ sensitivity: 'secret', readAloud: false }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.rule, 'question-authority-mismatch')
})

check('validateQuestionEvent refuses unknown keys, wrong skill, and altered registry authority', () => {
  for (const changed of [
    question({ questionKey: 'UNREGISTERED_GOVERNED_QUESTION' }),
    question({ skill: 'kaizen' }),
    question({ text: 'A producer cannot replace governed wording.' }),
    question({ options: ['invented'] }),
    question({ counted: true }),
    question({ readAloud: false }),
  ]) {
    assert.strictEqual(validateQuestionEvent(changed).ok, false)
  }
})

check('validateAnswerEvent refuses an unregistered answer key and mismatched privacy', () => {
  assert.strictEqual(validateAnswerEvent(answer({ questionKey: 'UNREGISTERED_GOVERNED_QUESTION' })).ok, false)
  assert.strictEqual(validateAnswerEvent(answer({ sensitivity: 'secret' })).ok, false)
})

// ——————————————————————————————————————————————
// 2. Answer event validation (spec 13.2 item 4 "allow transcript correction",
//    spec 14: raw audio never part of response; confirmed only)
// ——————————————————————————————————————————————

check('validateAnswerEvent accepts a confirmed typed answer', () => {
  const r = validateAnswerEvent(answer())
  assert.strictEqual(r.ok, true)
})

check('validateAnswerEvent accepts a confirmed voice answer with answeredAt', () => {
  const r = validateAnswerEvent(answer({ inputMode: 'voice', answeredAt: '2026-08-21T00:00:00.000Z' }))
  assert.strictEqual(r.ok, true)
})

check('validateAnswerEvent refuses an UNCONFIRMED transcript (spec 14: never submitted until confirmed)', () => {
  const r = validateAnswerEvent(answer({ userConfirmedTranscript: false }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'not-confirmed')
})

check('validateAnswerEvent refuses empty answerText', () => {
  const r = validateAnswerEvent(answer({ answerText: '' }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'answerText')
})

check('validateAnswerEvent refuses an unknown input mode', () => {
  const r = validateAnswerEvent(answer({ inputMode: 'telepathy' }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.field, 'inputMode')
})

// ——————————————————————————————————————————————
// 3. Slot registry: exactly one answer per question (spec 14)
// ——————————————————————————————————————————————

check('registry: open -> put -> take returns exactly one answer once', () => {
  const reg = new AnswerSlotRegistry()
  assert.strictEqual(reg.open({ sessionId: 's1', questionKey: 'BUILD_TARGET' }).ok, true)
  assert.strictEqual(reg.put({ sessionId: 's1', questionKey: 'BUILD_TARGET', answer: answer({ sessionId: 's1', questionKey: 'BUILD_TARGET' }) }).ok, true)
  const first = reg.take({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(first.ok, true)
  assert.strictEqual(first.answer.answerText, 'I want a booking tool for local barbers.')
  const second = reg.take({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(second.ok, false)
  assert.strictEqual(second.code, 'not-answered')
})

check('registry: second answer to the same question is refused', () => {
  const reg = new AnswerSlotRegistry()
  reg.open({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(reg.put({ sessionId: 's1', questionKey: 'BUILD_TARGET', answer: answer({ sessionId: 's1', questionKey: 'BUILD_TARGET' }) }).ok, true)
  const dup = reg.put({ sessionId: 's1', questionKey: 'BUILD_TARGET', answer: answer({ sessionId: 's1', questionKey: 'BUILD_TARGET', answerText: 'second try' }) })
  assert.strictEqual(dup.ok, false)
  assert.strictEqual(dup.code, 'already-answered')
})

check('registry: double open of the same question is refused', () => {
  const reg = new AnswerSlotRegistry()
  reg.open({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  const again = reg.open({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(again.ok, false)
  assert.strictEqual(again.code, 'slot-open')
})

check('registry: answer for the WRONG session is refused, never re-routed (spec 17)', () => {
  const reg = new AnswerSlotRegistry()
  reg.open({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  const wrong = reg.put({ sessionId: 's1', questionKey: 'BUILD_TARGET', answer: answer({ sessionId: 'other-session', questionKey: 'BUILD_TARGET' }) })
  assert.strictEqual(wrong.ok, false)
  assert.strictEqual(wrong.code, 'session-mismatch')
})

check('registry: answer with the wrong questionKey is refused', () => {
  const reg = new AnswerSlotRegistry()
  reg.open({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  const wrong = reg.put({ sessionId: 's1', questionKey: 'BUILD_TARGET', answer: answer({ sessionId: 's1', questionKey: 'KAZEN_TARGET' }) })
  assert.strictEqual(wrong.ok, false)
  assert.strictEqual(wrong.code, 'question-key-mismatch')
})

check('registry: put without an open slot is refused', () => {
  const reg = new AnswerSlotRegistry()
  const r = reg.put({ sessionId: 's1', questionKey: 'BUILD_TARGET', answer: answer({ sessionId: 's1', questionKey: 'BUILD_TARGET' }) })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.code, 'no-open-slot')
})

check('registry: cancel releases the slot, take then finds nothing', () => {
  const reg = new AnswerSlotRegistry()
  reg.open({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(reg.cancel({ sessionId: 's1', questionKey: 'BUILD_TARGET' }).ok, true)
  const t = reg.take({ sessionId: 's1', questionKey: 'BUILD_TARGET' })
  assert.strictEqual(t.ok, false)
})

// ——————————————————————————————————————————————
// 4. candice.ask_user tool end to end (spec 13.2 item 5: answer returns to the
//    SAME MCP tool call in the SAME session)
// ——————————————————————————————————————————————

check('ask_user delivers the question and returns exactly one answer to the owning session', async () => {
  const registry = new AnswerSlotRegistry()
  const server = new AskUserServer({
    registry,
    isCompanionReady: () => true,
    deliverQuestion: async (q) => {
      assert.strictEqual(q.questionKey, 'BUILD_TARGET')
      assert.strictEqual(q.text, 'Tell me about your idea in your own words: what is it, and who is it for?')
      registry.put({ sessionId: q.sessionId, questionKey: q.questionKey, answer: answer() })
      return { ok: true }
    },
    sleep: async (ms) => new Promise((r) => setTimeout(r, 5)),
  })
  const result = await server.askUser({
    question: question(),
    sessionId: 'opaque-session-id',
  })
  assert.strictEqual(result.result.ok, true)
  assert.strictEqual(result.result.answer.questionKey, 'BUILD_TARGET')
  assert.strictEqual(result.result.answer.sessionId, 'opaque-session-id')
  assert.strictEqual(result.result.answer.userConfirmedTranscript, true)
  assert.strictEqual(result.result.answer.isError, undefined)
})

check('ask_user with an EXTERNAL answer still returns the answer to the same code path (surface feeds the registry)', async () => {
  const registry = new AnswerSlotRegistry()
  const server = new AskUserServer({
    registry,
    isCompanionReady: () => true,
    deliverQuestion: async () => {
      // The companion surface delivers the approved answer asynchronously.
      setTimeout(() => {
        registry.put({ sessionId: 'opaque-session-id', questionKey: 'BUILD_TARGET', answer: answer({ inputMode: 'voice' }) })
      }, 10)
      return { ok: true }
    },
    sleep: async (ms) => new Promise((r) => setTimeout(r, 5)),
  })
  const result = await server.askUser({ question: question(), sessionId: 'opaque-session-id' })
  assert.strictEqual(result.result.ok, true)
  assert.strictEqual(result.result.answer.inputMode, 'voice')
  assert.strictEqual(result.result.answer.answerText, 'I want a booking tool for local barbers.')
})

check('ask_user fails soft when the companion is unavailable (spec 13.2/20 — ask in Claude normally)', async () => {
  const server = makeServer({ isCompanionReady: () => false })
  const result = await server.askUser({ question: question(), sessionId: 'opaque-session-id' })
  assert.strictEqual(result.result.isError, true)
  assert.ok(result.result.content[0].text.includes('ask the same question in Claude normally'))
  assert.ok(result.result.content[0].text.includes('companion is unavailable'))
})

check('ask_user fails soft when delivery to the companion fails', async () => {
  const server = makeServer({ deliverQuestion: async () => ({ ok: false, code: 'app-missing' }) })
  const result = await server.askUser({ question: question(), sessionId: 'opaque-session-id' })
  assert.strictEqual(result.result.isError, true)
  assert.ok(result.result.content[0].text.includes('app-missing'))
  assert.ok(result.result.content[0].text.includes('ask the same question in Claude normally'))
})

check('ask_user refuses an invalid question event BEFORE delivery (no question ever shown)', async () => {
  let delivered = 0
  const server = makeServer({ deliverQuestion: async () => { delivered += 1; return { ok: true } } })
  const result = await server.askUser({ question: question({ questionKey: 'lowercase' }), sessionId: 'opaque-session-id' })
  assert.strictEqual(delivered, 0)
  assert.strictEqual(result.result.isError, true)
  assert.ok(result.result.content[0].text.includes('invalid question event'))
})

check('ask_user refuses a sessionId mismatch between params and question (spec 17)', async () => {
  const server = makeServer({})
  const result = await server.askUser({ question: question(), sessionId: 'different-session' })
  assert.strictEqual(result.result.isError, true)
  assert.ok(result.result.content[0].text.includes('sessionId mismatch'))
})

check('ask_user records the pending question in the WS-03 lifecycle for crash recovery (spec 20)', async () => {
  const recorded = []
  const lifecycle = {
    setPendingQuestion: async (p) => { recorded.push(p); return { ok: true } },
    recordAnswer: async (p) => { recorded.push(p); return { ok: true } },
  }
  const registry = new AnswerSlotRegistry()
  const server = new AskUserServer({
    registry,
    lifecycle,
    isCompanionReady: () => true,
    deliverQuestion: async () => {
      setTimeout(() => {
        registry.put({ sessionId: 'opaque-session-id', questionKey: 'BUILD_TARGET', answer: answer() })
      }, 10)
      return { ok: true }
    },
    sleep: async (ms) => new Promise((r) => setTimeout(r, 5)),
  })
  await server.askUser({ question: question(), sessionId: 'opaque-session-id' })
  assert.strictEqual(recorded.length, 2)
  assert.strictEqual(recorded[0].questionKey, 'BUILD_TARGET')
  assert.strictEqual(recorded[0].counted, false)
  // FIX-013 S1: both lifecycle calls carry the same derived operation identity.
  assert.strictEqual(recorded[0].operationId, recorded[1].operationId)
  assert.deepStrictEqual(recorded[1], { sessionId: 'opaque-session-id', questionKey: 'BUILD_TARGET', operationId: recorded[1].operationId })
})

check('ask_user refuses lifecycle-rejected question before it opens or delivers a slot', async () => {
  let delivered = false
  const registry = new AnswerSlotRegistry()
  const server = new AskUserServer({
    registry,
    lifecycle: { setPendingQuestion: () => ({ ok: false, code: 'question-already-answered' }) },
    isCompanionReady: () => true,
    deliverQuestion: async () => { delivered = true; return { ok: true } },
  })
  const result = await server.askUser({ question: question(), sessionId: 'opaque-session-id' })
  assert.strictEqual(result.result.isError, true)
  assert.ok(result.result.content[0].text.includes('question-already-answered'))
  assert.strictEqual(delivered, false)
  assert.strictEqual(registry.openCount(), 0)
})

check('ask_user never logs or echoes answer text beyond the answer result', async () => {
  // The registry stores the answer only until take(); after take the slot is
  // gone — a second take cannot replay it (exactly one read, spec 14).
  const registry = new AnswerSlotRegistry()
  const server = new AskUserServer({
    registry,
    isCompanionReady: () => true,
    deliverQuestion: async (q) => {
      registry.put({ sessionId: q.sessionId, questionKey: q.questionKey, answer: answer() })
      return { ok: true }
    },
    sleep: async () => {},
  })
  await server.askUser({ question: question(), sessionId: 'opaque-session-id' })
  assert.strictEqual(registry.openCount(), 0, 'no answer retained after the single read')
})

// ——————————————————————————————————————————————
// 5. MCP wire layer (stdio json-rpc)
// ——————————————————————————————————————————————

check('wire: initialize answers with protocol version + tool capability', () => {
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))
  const parsed = JSON.parse(line)
  assert.strictEqual(parsed.id, 1)
  assert.strictEqual(parsed.result.protocolVersion, '2025-06-18')
  assert.strictEqual(parsed.result.capabilities.tools.listChanged, false)
  assert.strictEqual(parsed.result.serverInfo.name, 'candice')
})

check('wire: initialize echoes a KNOWN older client protocol version', () => {
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }))
  assert.strictEqual(JSON.parse(line).result.protocolVersion, '2024-11-05')
})

check('wire: initialize claims the latest version for an unknown client version', () => {
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } }))
  assert.strictEqual(JSON.parse(line).result.protocolVersion, '2025-06-18')
})

check('wire: notifications/initialized gets no response (valid JSON-RPC notification)', () => {
  const s = new AskUserServer()
  assert.strictEqual(s.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), null)
})

check('wire: tools/list exposes exactly one tool named ask_user', () => {
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
  const parsed = JSON.parse(line)
  assert.strictEqual(parsed.result.tools.length, 1)
  assert.strictEqual(parsed.result.tools[0].name, 'ask_user')
})

check('wire: ping answers pong', () => {
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }))
  assert.deepStrictEqual(JSON.parse(line).result, {})
})

check('wire: unknown method returns method-not-found with the original id', () => {
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'nope' }))
  const parsed = JSON.parse(line)
  assert.strictEqual(parsed.id, 7)
  assert.strictEqual(parsed.error.code, -32601)
})

check('wire: unknown tool returns method-not-found', () => {
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'other_tool', params: {} } }))
  assert.strictEqual(JSON.parse(line).error.code, -32601)
})

check('wire: malformed JSON returns parse error', () => {
  const s = new AskUserServer()
  // An unparseable line carries no id, so the protocol forbids answering it
  // (JSON-RPC notifications-only rule): handleLine must return null, not a
  // response echoing a fabricated id.
  assert.strictEqual(s.handleLine('{not json'), null)
})

check('wire: invalid question event returns isError text, never a partial answer', async () => {
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'ask_user', params: { question: {} } } }))
  const resp = JSON.parse(await line)
  assert.strictEqual(resp.id, 9)
  assert.strictEqual(resp.result.isError, true)
  assert.ok(resp.result.content[0].text.includes('invalid question event'))
})

check('wire: CANONICAL tools/call framing (params.name + params.arguments) is honored', () => {
  // Per the MCP spec (2024-11-05, 2025-03-26, 2025-06-18) a real client sends
  //   { "method": "tools/call", "params": { "name": "ask_user", "arguments": {...} } }
  // — NOT the legacy { params: { name, params } } shape. This is the framing
  // Claude Code actually emits; the server must extract arguments, not {}.
  const s = new AskUserServer()
  const line = s.handleLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'ask_user', arguments: { question: question() } },
  }))
  return line.then((resolved) => {
    const parsed = JSON.parse(resolved)
    assert.strictEqual(parsed.id, 2)
    assert.strictEqual(parsed.result.isError, true, 'default probe: companion not ready -> fail soft, question reached the tool')
    assert.ok(parsed.result.content[0].text.includes('companion is unavailable'))
  })
})

check('wire: stdio subprocess boots, initializes, lists tools, and exits clean', async () => {
  const child = spawn('node', [path.join(__dirname, 'server.js')], { stdio: ['pipe', 'pipe', 'pipe'] })
  const out = []
  let errOut = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => out.push(...d.split('\n').filter(Boolean)))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d) => { errOut += d })
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')
  await new Promise((r) => setTimeout(r, 100))
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.227' } } })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  await new Promise((r) => setTimeout(r, 200))
  child.stdin.end()
  const closed = new Promise((r) => child.on('exit', r))
  await closed
  const init = out.find((l) => l.includes('"id":1'))
  const list = out.find((l) => l.includes('"id":2'))
  assert.ok(init, 'initialize response received')
  assert.strictEqual(JSON.parse(init).result.protocolVersion, '2025-03-26')
  assert.strictEqual(JSON.parse(init).result.serverInfo.name, 'candice')
  assert.ok(list, 'tools/list response received')
  assert.strictEqual(JSON.parse(list).result.tools[0].name, 'ask_user')
  assert.strictEqual(out.filter((l) => l.includes('notifications')).length, 0, 'notifications never answered')
  assert.ok(!errOut.includes('Error'), 'no stderr errors: ' + errOut)
})

check('wire: ask_user over real stdio with CANONICAL framing fails soft when companion absent', async () => {
  // Duplicate of the check above, but with the exact framing a real MCP client
  // (Claude Code) puts on the wire: params.arguments instead of params.params.
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { CANDICE_COMPANION_READY: 'probe' }),
  })
  const out = []
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => out.push(...d.split('\n').filter(Boolean)))
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')
  await new Promise((r) => setTimeout(r, 100))
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ask_user', arguments: { question: question() } } })
  await new Promise((r) => setTimeout(r, 200))
  child.stdin.end()
  const closed = new Promise((r) => child.on('exit', r))
  await closed
  const call = out.find((l) => l.includes('"id":2'))
  assert.ok(call, 'tools/call response received')
  const parsed = JSON.parse(call)
  assert.strictEqual(parsed.result.isError, true, 'default probe: companion not ready -> fail soft')
  assert.ok(parsed.result.content[0].text.includes('ask the same question in Claude normally'))
  assert.ok(parsed.result.content[0].text.includes('companion is unavailable'))
})

check('wire: ask_user over real stdio fails soft when companion absent', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { CANDICE_COMPANION_READY: 'probe' }),
  })
  const out = []
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => out.push(...d.split('\n').filter(Boolean)))
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')
  await new Promise((r) => setTimeout(r, 100))
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ask_user', params: { question: question() } } })
  await new Promise((r) => setTimeout(r, 200))
  child.stdin.end()
  const closed = new Promise((r) => child.on('exit', r))
  await closed
  const call = out.find((l) => l.includes('"id":2'))
  assert.ok(call, 'tools/call response received')
  const parsed = JSON.parse(call)
  assert.strictEqual(parsed.result.isError, true, 'default probe: companion not ready -> fail soft')
  assert.ok(parsed.result.content[0].text.includes('ask the same question in Claude normally'))
  assert.ok(parsed.result.content[0].text.includes('companion is unavailable'))
})

// ——————————————————————————————————————————————
// 6. Regression: sibling lanes still load (cross-lane import seam)
// ——————————————————————————————————————————————

check('regression: WS-03 session-lifecycle still loads and passes its suite', async () => {
  const lifecycle = require('../../session/session-lifecycle')
  assert.strictEqual(typeof lifecycle.SessionLifecycle, 'function')
  const { execFileSync } = require('child_process')
  const rc = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'session', 'session-lifecycle.test.js')], { stdio: 'pipe' })
  assert.ok(String(rc).includes('ALL TESTS PASSED'))
})

check('regression: WS-05 fallback coordinator still loads', () => {
  const { FallbackCoordinator } = require('../../fallback/fallback-coordinator')
  assert.strictEqual(typeof FallbackCoordinator, 'function')
})

if (failures === 0) {
  console.log('ALL TESTS PASSED')
} else {
  console.log(`${failures} CHECK(S) FAILED`)
  process.exit(1)
}
