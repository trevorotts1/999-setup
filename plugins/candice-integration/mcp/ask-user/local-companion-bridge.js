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

const BRIDGE_PROTOCOL_VERSION = '1.0'
const MAX_FRAME_BYTES = 64 * 1024

function bridgeFailure(code) {
  return { ok: false, code }
}

class LocalCompanionBridge {
  constructor(options = {}) {
    this.token = options.token || crypto.randomBytes(32).toString('hex')
    this.launchCommand = options.launchCommand || process.env.CANDICE_COMPANION_CMD || null
    this.socketDir = options.socketDir || fs.mkdtempSync(path.join(os.tmpdir(), 'candice-mcp-'))
    this.endpoint = options.endpoint || path.join(this.socketDir, 'companion.sock')
    this.server = null
    this.socket = null
    this.ready = false
    this.started = false
    this.pendingAcks = new Map()
    this.active = new Map()
    this.launchSessionId = null
    this.onAnswer = typeof options.onAnswer === 'function' ? options.onAnswer : () => bridgeFailure('answer-handler-unavailable')
    this.onCancel = typeof options.onCancel === 'function' ? options.onCancel : () => ({ ok: true })
  }

  _key(sessionId, questionKey) { return `${sessionId}::${questionKey}` }

  async start() {
    if (this.started) return this
    this.started = true
    await new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this._accept(socket))
      this.server.once('error', reject)
      this.server.listen(this.endpoint, () => {
        this.server.removeListener('error', reject)
        try { fs.chmodSync(this.endpoint, 0o600) } catch (_) { /* best effort */ }
        resolve()
      })
    })
    return this
  }

  async ensureSession(sessionId) {
    if (this.launchSessionId && this.launchSessionId !== sessionId) return bridgeFailure('session-binding-in-use')
    if (!this.launchSessionId) {
      this.launchSessionId = sessionId
      if (!this.launchCommand && !this.isReady()) return bridgeFailure('companion-not-configured')
      this._launchCompanion(sessionId)
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

  _launchCompanion(sessionId) {
    // The user may start the app separately with these launch arguments; a
    // configured executable simply removes that manual step. Never shell out
    // through an interpolated command string.
    if (!this.launchCommand) return
    try {
      const child = spawn(this.launchCommand, [
        '--bridge-endpoint', this.endpoint,
        '--bridge-token', this.token,
        '--bridge-version', BRIDGE_PROTOCOL_VERSION,
        '--session-id', sessionId,
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
          if (message.type !== 'hello' || message.version !== BRIDGE_PROTOCOL_VERSION || candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
            socket.destroy(); return
          }
          authenticated = true
          this.socket = socket
          this.ready = true
          this._write({ type: 'ready', version: BRIDGE_PROTOCOL_VERSION })
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
    const pending = this.active.get(key)
    if (!pending) return
    if (message.type === 'answer') {
      // The registry performs schema/session/key/duplicate validation. This
      // bridge only accepts answers for a currently delivered exact slot.
      const result = this.onAnswer({ sessionId: message.sessionId, questionKey: message.questionKey, answer: message.answer })
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
    if (!this.isReady() || this.launchSessionId !== question.sessionId) return bridgeFailure('companion-not-ready')
    const key = this._key(question.sessionId, question.questionKey)
    if (this.active.has(key)) return bridgeFailure('question-already-delivered')
    const ack = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(key)
        resolve(bridgeFailure('companion-delivery-timeout'))
      }, 2000)
      this.pendingAcks.set(key, { resolve: (value) => { clearTimeout(timeout); resolve(value) } })
    })
    this.active.set(key, { sessionId: question.sessionId, questionKey: question.questionKey })
    if (!this._write({ type: 'question', version: BRIDGE_PROTOCOL_VERSION, question })) {
      this.active.delete(key)
      return bridgeFailure('companion-disconnected')
    }
    const result = await ack
    if (!result.ok) this.active.delete(key)
    return result
  }

  cancel({ sessionId, questionKey }) {
    const key = this._key(sessionId, questionKey)
    this.active.delete(key)
    const pendingAck = this.pendingAcks.get(key)
    if (pendingAck) { this.pendingAcks.delete(key); pendingAck.resolve(bridgeFailure('question-cancelled')) }
    this._write({ type: 'cancel', sessionId, questionKey })
  }

  async close() {
    this.ready = false
    if (this.socket) this.socket.destroy()
    if (this.server) await new Promise((resolve) => this.server.close(resolve))
    try { fs.unlinkSync(this.endpoint) } catch (_) { /* already removed */ }
    try { fs.rmdirSync(this.socketDir) } catch (_) { /* only our empty dir */ }
  }
}

module.exports = { LocalCompanionBridge, BRIDGE_PROTOCOL_VERSION }
