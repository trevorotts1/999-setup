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
    text: 'First question, and it is an easy one, because you already know the answer — it is your idea. Tell me about it in your own words: what is it, and who is it for? A sentence or two is plenty, and describing it the way you would describe it to a friend is exactly right. There are no special words to know. I will tell you what I heard, and you tell me if I got it right.', answerKind: 'free_text', allowedInputModes: ['voice', 'typed', 'terminal'],
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

test('FIX-013 S4: same-instance reconnect re-authenticates and replays ONE unacked op under a bounded lease', async () => {
  const bridge = new LocalCompanionBridge({ recoveryLeaseMs: 5000 })
  const events = []
  bridge.onLifecycleEvent = (event) => events.push(event.lifecycle)
  await bridge.start()
  await bridge.ensureSession('session-a')
  const activation = { ...bridge.activation, instanceId: 'candice-reconnect' }
  let firstReadyResolve
  const firstReady = new Promise((resolve) => { firstReadyResolve = resolve })
  let firstQuestionResolve
  const firstQuestion = new Promise((resolve) => { firstQuestionResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, activation, (message, socket) => {
    if (message.type === 'ready') firstReadyResolve()
    if (message.type === 'question') {
      assert.equal(message.replayed, undefined, 'the first delivery is not a replay')
      firstQuestionResolve({ message, socket })
    }
  })
  await firstReady
  const deliver = bridge.deliverQuestion(question())
  const { message, socket } = await firstQuestion
  assert.equal(message.operationId, bridge.active.get('session-a::BUILD_TARGET').operationId)

  // The app process crashes mid-question WITHOUT acknowledging delivery.
  companion.destroy()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(bridge.isReady(), false)
  assert.equal(bridge.lifecycle.phase, 'disconnected')
  assert.ok(events.includes('disconnected'))
  assert.equal(bridge.active.has('session-a::BUILD_TARGET'), true, 'unacked slot retained for the same-process replay')
  assert.equal(bridge.replay.key, 'session-a::BUILD_TARGET')

  // The SAME authenticated process restarts and re-authenticates.
  let replayResolve
  const replayed = new Promise((resolve) => { replayResolve = resolve })
  const restarted = await connect(bridge.endpoint, bridge.token, activation, (message, socket) => {
    if (message.type === 'question' && message.replayed === true) {
      assert.equal(message.question.questionKey, 'BUILD_TARGET', 'the one unacked op is replayed')
      assert.ok(message.leaseId, 'replay carries a recovery lease id')
      replayResolve({ message, socket })
    }
  })
  const replay = await replayed
  assert.equal(events.includes('reconnecting'), true, 'reconnecting lifecycle event emitted')
  assert.equal(bridge.lifecycle.phase, 'reconnecting')

  // The app re-acknowledges the exact replay with the granted lease: the
  // original ask continues with the SAME operation id.
  const leaseId = bridge.replayLease.leaseId
  assert.ok(leaseId, 'a recovery lease was granted')
  replay.socket.write(JSON.stringify({
    type: 'recovered', sessionId: 'session-a', questionKey: 'BUILD_TARGET',
    operationId: replay.message.operationId, leaseId,
  }) + '\n')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(bridge.replay, null, 'the acknowledged replay is never replayed again')
  assert.equal(bridge.replayLease.replayable, false, 'the recovery lease is single-use')

  // The original unacked delivery resolves as a disconnect failure; the ask
  // then sees the reconnected bridge and the replayed slot still open.
  const result = await deliver
  assert.equal(result.ok, false)
  assert.equal(result.code, 'companion-disconnected')
  assert.equal(bridge.isReady(), true, 'bridge is ready again after the same-process reconnect')
  restarted.destroy()
  await bridge.close()
})

test('FIX-013 S4: reconnect refuses a mismatched instance and an ended bridge accepts no hello', async () => {
  const bridge = new LocalCompanionBridge()
  await bridge.start()
  await bridge.ensureSession('session-a')
  const activation = { ...bridge.activation, instanceId: 'candice-original' }
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, activation, (message) => {
    if (message.type === 'ready') readyResolve()
  })
  await ready
  companion.destroy()
  await new Promise((resolve) => setTimeout(resolve, 10))

  // A DIFFERENT instance claiming the same session/activation is refused.
  let intruderReady = false
  const intruder = await connect(bridge.endpoint, bridge.token,
    { ...activation, instanceId: 'candice-other' }, (message) => { if (message.type === 'ready') intruderReady = true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(intruderReady, false, 'mismatched instance cannot take over the disconnected bridge')
  intruder.destroy()

  // After endLifecycle the bridge accepts NO hello at all (ends exactly once).
  await bridge.close()
  let lateReady = false
  try {
    const late = await connect(bridge.endpoint, bridge.token, activation, (message) => { if (message.type === 'ready') lateReady = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(lateReady, false, 'an ended lifecycle accepts no connection')
    late.destroy()
  } catch (err) {
    // ECONNREFUSED is the strongest proof: the listener is gone entirely.
    assert.equal(err.code, 'ECONNREFUSED')
  }
  assert.equal(bridge.lifecycle.phase, 'ended')
})

test('FIX-013 S4: endLifecycle is exactly-once and sweeps registered shutdown hooks', async () => {
  const bridge = new LocalCompanionBridge()
  const events = []
  bridge.onLifecycleEvent = (event) => events.push(event.lifecycle)
  let swept = 0
  bridge.onEnd(async () => { swept += 1 })
  await bridge.start()
  await bridge.ensureSession('session-a')
  const activation = { ...bridge.activation, instanceId: 'candice-end' }
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, activation, (message) => {
    if (message.type === 'ready') readyResolve()
  })
  await ready
  const first = await bridge.endLifecycle()
  assert.equal(first.ok, true)
  assert.equal(events.filter((e) => e === 'ended').length, 1, 'the ended lifecycle event fires exactly once')
  assert.equal(swept, 1, 'shutdown hooks run exactly once')
  const second = await bridge.endLifecycle()
  assert.equal(second.alreadyEnded, true)
  assert.equal(swept, 1, 'a second end never re-runs cleanup')
  assert.equal(events.filter((e) => e === 'ended').length, 1)
  companion.destroy()
})

test('FIX-013 S4: delivered or answered operations are never replayed after a reconnect', async () => {
  const bridge = new LocalCompanionBridge()
  await bridge.start()
  await bridge.ensureSession('session-a')
  const activation = { ...bridge.activation, instanceId: 'candice-acked' }
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const companion = await connect(bridge.endpoint, bridge.token, activation, (message, socket) => {
    if (message.type === 'ready') readyResolve()
    if (message.type === 'question') {
      const q = message.question
      socket.write(JSON.stringify({ type: 'delivered', sessionId: q.sessionId, questionKey: q.questionKey }) + '\n')
      socket.write(JSON.stringify({
        type: 'answer', sessionId: q.sessionId, questionKey: q.questionKey,
        answer: { schemaVersion: '1.0', sessionId: q.sessionId, questionKey: q.questionKey, answerText: 'Done', inputMode: 'typed', userConfirmedTranscript: true },
      }) + '\n')
    }
  })
  await ready
  const server = new AskUserServer({ bridge, waitWindowMs: 1000 })
  const result = await server.askUser({ question: question() })
  assert.equal(result.result.ok, true)
  assert.equal(bridge.replay, null, 'an acknowledged+answered operation leaves no replay candidate')

  // Disconnect + same-instance reconnect: NOTHING is replayed.
  companion.destroy()
  await new Promise((resolve) => setTimeout(resolve, 10))
  let replayedFrame = false
  let secondReadyResolve
  const secondReady = new Promise((resolve) => { secondReadyResolve = resolve })
  const restarted = await connect(bridge.endpoint, bridge.token, activation, (message) => {
    if (message.type === 'ready') secondReadyResolve()
    if (message.type === 'question') replayedFrame = true
  })
  await secondReady
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(replayedFrame, false, 'a fully answered operation is never replayed')
  restarted.destroy()
  await bridge.close()
})
