'use strict'

const assert = require('assert')
const fs = require('fs')
const net = require('net')
const test = require('node:test')
const { AskUserServer } = require('./server')
const { LocalCompanionBridge } = require('./local-companion-bridge')

function question(sessionId = 'session-a', questionKey = 'BUILD_TARGET') {
  return {
    schemaVersion: '1.0', sessionId, skill: 'spec-protocol', event: 'question', questionKey,
    text: 'Tell me about your idea in your own words: what is it, and who is it for?', answerKind: 'free_text', allowedInputModes: ['voice', 'typed', 'terminal'],
    readAloud: true, sensitivity: 'normal', counted: false, progress: null,
    helpText: 'A sentence or two is plenty.', canGoBack: true,
  }
}

async function connect(endpoint, token, activation, handler) {
  const socket = await new Promise((resolve, reject) => {
    const port = Number(new URL(endpoint).port)
    const client = net.createConnection({ host: '127.0.0.1', port }, () => resolve(client))
    client.once('error', reject)
  })
  socket.setEncoding('utf8')
  socket.write(JSON.stringify({
    type: 'hello', version: '1.0', token,
    sessionId: activation.sessionId,
    activationId: activation.activationId,
    activationIssuedAt: String(activation.issuedAt),
    instanceId: activation.instanceId || 'candice-test-instance',
  }) + '\n')
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1)
      handler(message, socket)
    }
  })
  return socket
}

test('authenticated local bridge completes deliver → confirmed answer → same MCP call', async () => {
  const bridge = new LocalCompanionBridge()
  await bridge.start()
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(bridge.tokenFile).mode & 0o077, 0,
      'the bridge capability file is owner-only')
  }
  assert.equal((await bridge.ensureSession('session-a')).ok, false, 'unconfigured companion only issues the bounded activation')
  const activation = { ...bridge.activation, instanceId: 'candice-session-a' }
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, activation, (message, socket) => {
    if (message.type === 'ready') {
      assert.equal(message.sessionId, 'session-a')
      assert.equal(message.activationId, activation.activationId)
      assert.equal(message.instanceId, activation.instanceId)
      assert.match(message.bindingId, /^[A-Za-z0-9._:-]+$/)
      readyResolve()
    }
    if (message.type === 'question') {
      const q = message.question
      socket.write(JSON.stringify({ type: 'delivered', sessionId: q.sessionId, questionKey: q.questionKey }) + '\n')
      socket.write(JSON.stringify({
        type: 'answer', sessionId: q.sessionId, questionKey: q.questionKey,
        answer: { schemaVersion: '1.0', sessionId: q.sessionId, questionKey: q.questionKey, answerText: 'Candice', inputMode: 'typed', userConfirmedTranscript: true },
      }) + '\n')
    }
  })
  await ready
  const server = new AskUserServer({ bridge, waitWindowMs: 1000 })
  const result = await server.askUser({ question: question() })
  assert.equal(result.result.ok, true)
  assert.equal(result.result.answer.answerText, 'Candice')
  assert.equal(result.result.answer.sessionId, 'session-a')
  assert.equal(server.registry.openCount(), 0)
  companion.destroy()
  await bridge.close()
})

test('wrong token, session, or question key cannot answer an authenticated slot', async () => {
  const bridge = new LocalCompanionBridge()
  await bridge.start()
  await bridge.ensureSession('session-a')
  const activation = { ...bridge.activation, instanceId: 'candice-authenticated' }
  const intruder = await connect(bridge.endpoint, '0'.repeat(64), activation, () => {})
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(bridge.isReady(), false)
  intruder.destroy()
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, activation, (message, socket) => {
    if (message.type === 'ready') readyResolve()
    if (message.type === 'question') {
      const q = message.question
      socket.write(JSON.stringify({ type: 'delivered', sessionId: q.sessionId, questionKey: q.questionKey }) + '\n')
      socket.write(JSON.stringify({ type: 'answer', sessionId: 'other-session', questionKey: q.questionKey, answer: {} }) + '\n')
      socket.write(JSON.stringify({ type: 'answer', sessionId: q.sessionId, questionKey: 'OTHER_KEY', answer: {} }) + '\n')
      setTimeout(() => socket.write(JSON.stringify({ type: 'cancel', sessionId: q.sessionId, questionKey: q.questionKey }) + '\n'), 5)
    }
  })
  await ready
  const server = new AskUserServer({ bridge, waitWindowMs: 1000 })
  const result = await server.askUser({ question: question() })
  assert.equal(result.result.isError, true)
  assert.match(result.result.content[0].text, /cancelled/i)
  assert.equal(server.registry.openCount(), 0)
  companion.destroy()
  await bridge.close()
})

test('an explicitly busy single-surface companion never leaves a concurrent question acknowledged', async () => {
  const bridge = new LocalCompanionBridge()
  await bridge.start()
  await bridge.ensureSession('session-a')
  const activation = { ...bridge.activation, instanceId: 'candice-single-surface' }
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, activation, (message, socket) => {
    if (message.type === 'ready') readyResolve()
    if (message.type === 'question') {
      const q = message.question
      socket.write(JSON.stringify({
        type: 'unavailable', sessionId: q.sessionId, questionKey: q.questionKey, code: 'companion-busy',
      }) + '\n')
    }
  })
  await ready
  const result = await bridge.deliverQuestion(question())
  assert.deepEqual(result, { ok: false, code: 'companion-busy' })
  assert.equal(bridge.active.size, 0, 'a refused question is not retained as a live answer slot')
  companion.destroy()
  await bridge.close()
})

test('activation acknowledgement is exact, expires, and cannot be replayed by another instance', async () => {
  let clock = 1_000
  const bridge = new LocalCompanionBridge({ now: () => clock, activationTtlMs: 50 })
  await bridge.start()
  await bridge.ensureSession('session-a')
  const activation = { ...bridge.activation, instanceId: 'candice-owner' }
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, activation, (message) => {
    if (message.type === 'ready') readyResolve(message)
  })
  const acknowledgement = await ready
  assert.equal(acknowledgement.sessionId, 'session-a')
  assert.equal(bridge.binding.instanceId, 'candice-owner')
  assert.equal((await bridge.ensureSession('session-b')).code, 'session-binding-in-use')

  companion.destroy()
  await new Promise((resolve) => setTimeout(resolve, 10))
  let replayReady = false
  const replay = await connect(bridge.endpoint, bridge.token,
    { ...activation, instanceId: 'candice-replay' }, (message) => { if (message.type === 'ready') replayReady = true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(replayReady, false, 'a consumed activation cannot select a replacement instance')
  replay.destroy()
  clock += 100
  let staleReady = false
  const stale = await connect(bridge.endpoint, bridge.token, activation, (message) => { if (message.type === 'ready') staleReady = true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(staleReady, false, 'expired activation cannot reconnect even from the original instance')
  stale.destroy()
  await bridge.close()
})
