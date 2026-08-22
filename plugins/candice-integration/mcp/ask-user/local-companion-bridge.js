'use strict'

/**
 * Authenticated local-only transport between the stdio MCP process and one
 * Candice Companion launch.  The socket name is not an authority: the
 * capability token, protocol version, and an explicit ready handshake are.
 * Payloads and tokens are deliberately never logged.
 */

const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { deriveOperationId, isValidOperationId } = require('../../session/lifecycle-protocol')

const BRIDGE_PROTOCOL_VERSION = '1.0'
const MAX_FRAME_BYTES = 64 * 1024
const ACTIVATION_TTL_MS = 30 * 1000
const OPAQUE_ID = /^[A-Za-z0-9._:-]{1,128}$/

function bridgeFailure(code) {
  return { ok: false, code }
}

class LocalCompanionBridge {
  constructor(options = {}) {
    this.token = options.token || crypto.randomBytes(32).toString('hex')
    this.launchCommand = options.launchCommand || process.env.CANDICE_COMPANION_CMD || null
    this.socketDir = options.socketDir || fs.mkdtempSync(path.join(os.tmpdir(), 'candice-mcp-'))
    // Loopback TCP is deliberately used instead of a Unix socket so the
    // exact authenticated protocol works in native Windows builds too. The
    // endpoint is not authority; the owner-only token plus activation claim
    // are both required before any request is accepted.
    this.endpoint = options.endpoint || null
    this.tokenFile = options.tokenFile || path.join(this.socketDir, 'bridge-token')
    this.activationTtlMs = options.activationTtlMs || ACTIVATION_TTL_MS
    this.now = typeof options.now === 'function' ? options.now : Date.now
    this.server = null
    this.socket = null
    this.ready = false
    this.started = false
    this.pendingAcks = new Map()
    this.active = new Map()
    this.launchSessionId = null
    this.activation = null
    this.binding = null
    this.onAnswer = typeof options.onAnswer === 'function' ? options.onAnswer : () => bridgeFailure('answer-handler-unavailable')
    this.onCancel = typeof options.onCancel === 'function' ? options.onCancel : () => ({ ok: true })
  }

  _key(sessionId, questionKey) { return `${sessionId}::${questionKey}` }

  async start() {
    if (this.started) return this
    this.started = true
    // The directory is created by mkdtemp with owner-only permissions. Set it
    // explicitly as well: the token file is an authentication secret and
    // must never be available to another local account.
    try { fs.chmodSync(this.socketDir, 0o700) } catch (_) { /* best effort on Windows */ }
    try { fs.writeFileSync(this.tokenFile, this.token, { mode: 0o600, flag: 'wx' }) } catch (error) {
      if (error && error.code !== 'EEXIST') throw error
    }
    try { fs.chmodSync(this.tokenFile, 0o600) } catch (_) { /* best effort on Windows */ }
    await new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this._accept(socket))
      this.server.once('error', reject)
      const onListening = () => {
        this.server.removeListener('error', reject)
        const address = this.server.address()
        if (!this.endpoint && address && typeof address === 'object') {
          this.endpoint = `tcp://127.0.0.1:${address.port}`
        }
        resolve()
      }
      if (this.endpoint) {
        const match = /^tcp:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(this.endpoint)
        if (!match) { reject(new Error('invalid local bridge endpoint')); return }
        this.server.listen(Number(match[1]), '127.0.0.1', onListening)
      } else {
        this.server.listen(0, '127.0.0.1', onListening)
      }
    })
    return this
  }

  async ensureSession(sessionId) {
    if (typeof sessionId !== 'string' || !OPAQUE_ID.test(sessionId)) return bridgeFailure('invalid-session-id')
    if (this.launchSessionId && this.launchSessionId !== sessionId) return bridgeFailure('session-binding-in-use')
    if (!this.launchSessionId) {
      this.launchSessionId = sessionId
      this.activation = {
        sessionId,
        activationId: crypto.randomUUID(),
        issuedAt: this.now(),
        claimed: false,
      }
      if (!this.launchCommand && !this.isReady()) return bridgeFailure('companion-not-configured')
      this._launchCompanion(this.activation)
    }
    if (this.isReady()) return { ok: true }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(bridgeFailure('companion-ready-timeout')), 3000)
      const poll = () => {
        if (this.isReady()) { clearTimeout(timeout); resolve({ ok: true }); return }
        if (!this.started || this.launchSessionId !== sessionId) { clearTimeout(timeout); resolve(bridgeFailure('companion-not-ready')); return }
        setTimeout(poll, 25)
      }
      poll()
    })
  }

  _launchCompanion(activation) {
    // The user may start the app separately with these launch arguments; a
    // configured executable simply removes that manual step. Never shell out
    // through an interpolated command string.
    if (!this.launchCommand) return
    try {
      const child = spawn(this.launchCommand, [
        '--bridge-endpoint', this.endpoint,
        '--bridge-token-file', this.tokenFile,
        '--bridge-version', BRIDGE_PROTOCOL_VERSION,
        '--session-id', activation.sessionId,
        '--activation-id', activation.activationId,
        '--activation-issued-at', String(activation.issuedAt),
      ], { detached: true, stdio: 'ignore' })
      child.unref()
    } catch (_) {
      // A launch failure is represented by lack of authenticated readiness.
    }
  }

  _accept(socket) {
    // One companion owns one launch token. A second connection is never a
    // takeover route, even if it somehow learned the endpoint.
    if (this.socket !== null) { socket.destroy(); return }
    socket.setEncoding('utf8')
    let buffer = ''
    let authenticated = false
    socket.on('data', (chunk) => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES) { socket.destroy(); return }
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        let message
        try { message = JSON.parse(line) } catch (_) { socket.destroy(); return }
        if (!authenticated) {
          const candidate = Buffer.from(String(message.token || ''))
          const expected = Buffer.from(this.token)
          const activation = this.activation
          const age = activation ? this.now() - activation.issuedAt : Infinity
          const fresh = activation && age >= 0 && age <= this.activationTtlMs
          const matchingActivation = activation
            && message.sessionId === activation.sessionId
            && message.activationId === activation.activationId
            && message.activationIssuedAt === String(activation.issuedAt)
            && typeof message.instanceId === 'string' && OPAQUE_ID.test(message.instanceId)
          // A launch capability is single-use.  A reconnect from the same
          // authenticated process is not a second activation; any other
          // claimed activation is a replay/takeover and is rejected.
          const sameBinding = this.binding
            && this.binding.sessionId === message.sessionId
            && this.binding.activationId === message.activationId
            && this.binding.instanceId === message.instanceId
          if (message.type !== 'hello' || message.version !== BRIDGE_PROTOCOL_VERSION
            || !fresh || !matchingActivation || (activation.claimed && !sameBinding)
            || candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
            socket.destroy(); return
          }
          authenticated = true
          this.socket = socket
          this.ready = true
          activation.claimed = true
          this.binding = this.binding || {
            bindingId: crypto.randomUUID(),
            sessionId: activation.sessionId,
            activationId: activation.activationId,
            instanceId: message.instanceId,
          }
          this._write({
            type: 'ready', version: BRIDGE_PROTOCOL_VERSION,
            sessionId: this.binding.sessionId,
            activationId: this.binding.activationId,
            bindingId: this.binding.bindingId,
            instanceId: this.binding.instanceId,
          })
          continue
        }
        this._receive(message)
      }
    })
    socket.on('close', () => this._disconnect(socket))
    socket.on('error', () => this._disconnect(socket))
  }

  _disconnect(socket) {
    if (this.socket !== socket) return
    this.socket = null
    this.ready = false
    // The activation was consumed by a specific instance. It is never reused
    // after a disconnect; callers fail soft rather than accidentally route a
    // later session to a stale or replacement process.
    for (const ack of this.pendingAcks.values()) ack.resolve(bridgeFailure('companion-disconnected'))
    this.pendingAcks.clear()
    for (const [key, pending] of this.active.entries()) {
      this.active.delete(key)
      this.onCancel(pending)
    }
  }

  _receive(message) {
    if (!message || typeof message !== 'object') return
    const key = this._key(message.sessionId, message.questionKey)
    if (message.type === 'delivered') {
      const ack = this.pendingAcks.get(key)
      if (ack) { this.pendingAcks.delete(key); ack.resolve({ ok: true }) }
      return
    }
    if (message.type === 'unavailable') {
      // A single-surface companion explicitly refuses a concurrent question
      // rather than falsely acknowledging one it cannot present. Resolve the
      // delivery awaiter immediately so the caller can fall back safely.
      const ack = this.pendingAcks.get(key)
      if (ack) {
        this.pendingAcks.delete(key)
        ack.resolve(bridgeFailure(typeof message.code === 'string' ? message.code : 'companion-unavailable'))
      }
      this.active.delete(key)
      return
    }
    const pending = this.active.get(key)
    if (!pending) return
    if (message.type === 'answer') {
      // The registry performs schema/session/key/duplicate validation. This
      // bridge only accepts answers for a currently delivered exact slot and
      // carries the slot's operation identity as metadata (FIX-013 S1).
      const result = this.onAnswer({
        sessionId: message.sessionId,
        questionKey: message.questionKey,
        answer: message.answer,
        operationId: pending.operationId,
      })
      if (result && result.ok) this.active.delete(key)
      this._write({ type: 'answer-result', sessionId: message.sessionId, questionKey: message.questionKey, ok: !!(result && result.ok), code: result && result.code })
      return
    }
    if (message.type === 'cancel') {
      this.active.delete(key)
      this.onCancel(pending)
      this._write({ type: 'cancel-result', sessionId: message.sessionId, questionKey: message.questionKey, ok: true })
    }
  }

  _write(message) {
    if (!this.socket || this.socket.destroyed) return false
    try { return this.socket.write(JSON.stringify(message) + '\n') } catch (_) { return false }
  }

  isReady() { return this.ready && this.socket !== null && !this.socket.destroyed }

  async deliverQuestion(question) {
    if (!this.isReady() || !this.binding || this.binding.sessionId !== question.sessionId) return bridgeFailure('companion-not-ready')
    const key = this._key(question.sessionId, question.questionKey)
    if (this.active.has(key)) return bridgeFailure('question-already-delivered')
    // FIX-013 S1: the frame carries the operation identity so a replay/retry
    // of the same (sessionId, questionKey) is one operation end to end. The
    // bridge never derives authority: the operation id is metadata on an
    // already-authenticated FIX-011 frame.
    const operationId = question.operationId || deriveOperationId({
      sessionId: question.sessionId,
      questionKey: question.questionKey,
    })
    if (!isValidOperationId(operationId)) return bridgeFailure('invalid-operation-id')
    const ack = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(key)
        resolve(bridgeFailure('companion-delivery-timeout'))
      }, 2000)
      this.pendingAcks.set(key, { resolve: (value) => { clearTimeout(timeout); resolve(value) } })
    })
    this.active.set(key, {
      sessionId: question.sessionId,
      questionKey: question.questionKey,
      operationId,
      deliveredAt: new Date().toISOString(),
    })
    if (!this._write({ type: 'question', version: BRIDGE_PROTOCOL_VERSION, question, operationId })) {
      this.active.delete(key)
      return bridgeFailure('companion-disconnected')
    }
    const result = await ack
    if (!result.ok) this.active.delete(key)
    return result
  }

  cancel({ sessionId, questionKey, operationId }) {
    const key = this._key(sessionId, questionKey)
    const pending = this.active.get(key)
    this.active.delete(key)
    const pendingAck = this.pendingAcks.get(key)
    if (pendingAck) { this.pendingAcks.delete(key); pendingAck.resolve(bridgeFailure('question-cancelled')) }
    this._write({
      type: 'cancel',
      sessionId,
      questionKey,
      operationId: operationId || (pending && pending.operationId) || null,
    })
  }

  async close() {
    this.ready = false
    if (this.socket) this.socket.destroy()
    if (this.server) await new Promise((resolve) => this.server.close(resolve))
    try { fs.unlinkSync(this.tokenFile) } catch (_) { /* already removed */ }
    try { fs.rmdirSync(this.socketDir) } catch (_) { /* only our empty dir */ }
  }
}

module.exports = { LocalCompanionBridge, BRIDGE_PROTOCOL_VERSION }
