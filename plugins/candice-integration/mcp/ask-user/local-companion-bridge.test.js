'use strict'

const assert = require('assert')
const net = require('net')
const test = require('node:test')
const { AskUserServer } = require('./server')
const { LocalCompanionBridge } = require('./local-companion-bridge')

function question(sessionId = 'session-a', questionKey = 'PROJECT_NAME') {
  return {
    schemaVersion: '1.0', sessionId, skill: 'spec-protocol', event: 'question', questionKey,
    text: 'What is the project name?', answerKind: 'free_text', allowedInputModes: ['typed', 'voice'],
    readAloud: true, sensitivity: 'normal', counted: true, progress: null,
    helpText: null, canGoBack: false,
  }
}

async function connect(endpoint, token, handler) {
  const socket = await new Promise((resolve, reject) => {
    const client = net.createConnection(endpoint, () => resolve(client))
    client.once('error', reject)
  })
  socket.setEncoding('utf8')
  socket.write(JSON.stringify({ type: 'hello', version: '1.0', token }) + '\n')
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
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, (message, socket) => {
    if (message.type === 'ready') readyResolve()
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
  const intruder = await connect(bridge.endpoint, '0'.repeat(64), () => {})
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(bridge.isReady(), false)
  intruder.destroy()
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, (message, socket) => {
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
