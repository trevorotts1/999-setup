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
const { resolveConfiguredLaunchCommand } = require('../../shared/launch-command')

const BRIDGE_PROTOCOL_VERSION = '1.0'
const MAX_FRAME_BYTES = 64 * 1024
const ACTIVATION_TTL_MS = 30 * 1000
/**
 * How long one launch may take to complete the authenticated ready handshake.
 *
 * This is a COLD app start: process spawn, WebView creation, asset load and
 * the boot handshake, on a machine that is already running a build. The
 * previous 3s budget expired mid-launch on a loaded machine and reported
 * `companion-ready-timeout` for an app that was starting normally. The cost of
 * waiting is a bounded pause before the terminal fallback takes the question;
 * the cost of expiring early is a working companion declared dead, so the
 * budget is generous.
 */
const READY_TIMEOUT_MS = 20 * 1000
const RECOVERY_LEASE_MS = 30 * 1000 // one bounded replay lease per reconnect
const OPAQUE_ID = /^[A-Za-z0-9._:-]{1,128}$/

function bridgeFailure(code) {
  return { ok: false, code }
}

class LocalCompanionBridge {
  constructor(options = {}) {
    this.token = options.token || crypto.randomBytes(32).toString('hex')
    // The MCP transport is a SEPARATE launch path from the hook dispatcher and
    // must resolve the companion the same way: a fresh client install carries
    // `CANDICE_COMPANION_READY=1` but no `CANDICE_COMPANION_CMD`, so reading
    // only the env var left this bridge unable to launch an installed app.
    // The strict resolver is used (never the bare PATH-name fallback) so a
    // genuinely absent install still reports `companion-not-configured`
    // instead of spawning a name that cannot exist and timing out.
    //
    // An explicit `launchCommand: null` means "never launch" and is honored as
    // given: discovery must not resurrect a launch the caller opted out of, or
    // a test driving its own socket would spawn the user's real app.
    this.launchCommand = options.launchCommand !== undefined
      ? options.launchCommand
      : resolveConfiguredLaunchCommand()
    // Set when a launch attempt provably failed (ENOENT/EACCES/spawn throw).
    // A failed launch is a FACT the waiter must see, not an absence to wait out.
    this.launchError = null
    this.socketDir = options.socketDir || fs.mkdtempSync(path.join(os.tmpdir(), 'candice-mcp-'))
    // Loopback TCP is deliberately used instead of a Unix socket so the
    // exact authenticated protocol works in native Windows builds too. The
    // endpoint is not authority; the owner-only token plus activation claim
    // are both required before any request is accepted.
    this.endpoint = options.endpoint || null
    this.tokenFile = options.tokenFile || path.join(this.socketDir, 'bridge-token')
    this.activationTtlMs = options.activationTtlMs || ACTIVATION_TTL_MS
    this.readyTimeoutMs = options.readyTimeoutMs || READY_TIMEOUT_MS
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
    // FIX-013 S4 lifecycle: one explicit lifecycle per launch, surfaced to the
    // MCP server so a disconnect during an in-flight ask can wait a bounded
    // reconnect window (the app may have crashed and restarted) before the
    // durable record transfers to the terminal fallback.
    this.onDisconnect = typeof options.onDisconnect === 'function' ? options.onDisconnect : null
    this.onRecovered = typeof options.onRecovered === 'function' ? options.onRecovered : null
    this.onLifecycleEvent = typeof options.onLifecycleEvent === 'function' ? options.onLifecycleEvent : () => {}
    this.recoveryLeaseMs = options.recoveryLeaseMs || RECOVERY_LEASE_MS
    this.lifecycle = {
      phase: 'none', // none | connected | disconnected | reconnecting | ended
      ended: false,
    }
    this.replay = null // { key, entry } — the ONE unacknowledged pending op
    this.replayLease = null // { leaseId, grantedAt, replayable } — recovery lease
    this.endCallbacks = []
    this._ended = false
  }

  _key(sessionId, questionKey) { return `${sessionId}::${questionKey}` }

  /** Emit one lifecycle event (callback + wire frame, never a secret). */
  _lifecycle(kind, extra) {
    const payload = Object.assign({ type: 'lifecycle', lifecycle: kind }, extra || {})
    if (this.binding) {
      payload.sessionId = this.binding.sessionId
      payload.activationId = this.binding.activationId
    }
    this.onLifecycleEvent(Object.assign({}, payload))
    this._write(payload)
  }

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
      let settled = false
      let pollTimer = null
      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (pollTimer) clearTimeout(pollTimer)
        resolve(result)
      }
      const timeout = setTimeout(() => finish(bridgeFailure('companion-ready-timeout')), this.readyTimeoutMs)
      const poll = () => {
        if (this.isReady()) { finish({ ok: true }); return }
        // A launch that provably failed can never become ready. Waiting the
        // full readiness budget for it reported `companion-ready-timeout` —
        // "it started but was too slow" — for a binary that never executed.
        if (this.launchError) { finish(bridgeFailure('companion-launch-failed')); return }
        if (!this.started || this.launchSessionId !== sessionId) { finish(bridgeFailure('companion-not-ready')); return }
        pollTimer = setTimeout(poll, 25)
      }
      poll()
    })
  }

  _launchCompanion(activation) {
    // The user may start the app separately with these launch arguments; a
    // configured executable simply removes that manual step. Never shell out
    // through an interpolated command string.
    //
    // Reaching here with no command means a companion is ALREADY connected:
    // ensureSession returns `companion-not-configured` above when it is not.
    // There is genuinely nothing to launch, so there is nothing to report.
    if (!this.launchCommand) return
    const failLaunch = (error) => {
      // Recorded, never thrown. The waiter turns this into an honest
      // `companion-launch-failed` instead of sitting out the readiness
      // budget for a process that was never going to connect.
      this.launchError = (error && error.code) || 'spawn-failed'
    }
    try {
      const child = spawn(this.launchCommand, [
        '--bridge-endpoint', this.endpoint,
        '--bridge-token-file', this.tokenFile,
        '--bridge-version', BRIDGE_PROTOCOL_VERSION,
        '--session-id', activation.sessionId,
        '--activation-id', activation.activationId,
        '--activation-issued-at', String(activation.issuedAt),
      ], { detached: true, stdio: 'ignore' })
      // MANDATORY, not defensive style. `spawn` reports ENOENT/EACCES
      // ASYNCHRONOUSLY through 'error', so the catch below never sees them —
      // and an 'error' event with NO listener is an uncaught exception that
      // takes the whole stdio MCP server down, killing every other tool call
      // with it. Verified empirically: spawn() of a missing path returns a
      // child with `pid === undefined` and throws nothing synchronously.
      // A bad install path must degrade to the terminal fallback, not crash.
      child.on('error', failLaunch)
      child.unref()
    } catch (error) {
      // Synchronous throws only (invalid argument shapes); ENOENT arrives
      // through the listener above.
      failLaunch(error)
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
          // FIX-013 S4 reconnect: a disconnect is the ONLY path that may
          // re-acknowledge the same activation. It must be the exact same
          // authenticated process instance (same session + activation +
          // instance id). Any other credential set — a replay from a
          // different instance, a mismatched session, a stale activation —
          // is refused exactly as on first connect. An ended bridge never
          // accepts another hello: the lifecycle ends exactly once.
          const reconnected = this.socket !== null || this.lifecycle.phase === 'disconnected' || this.lifecycle.phase === 'reconnecting'
          if (reconnected) {
            if (!this.binding
              || this.lifecycle.ended
              || this.binding.sessionId !== message.sessionId
              || this.binding.activationId !== message.activationId
              || this.binding.instanceId !== message.instanceId) {
              socket.destroy(); return
            }
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
          if (reconnected) {
            // Same authenticated process re-established the transport. The
            // ONE unacknowledged pending operation is replayed under a fresh
            // bounded recovery lease; a consumed activation cannot select a
            // replacement instance, so the lease belongs to this exact
            // process (mismatched/replayed credentials never got here).
            const leaseId = crypto.randomUUID()
            this.replayLease = { leaseId, grantedAt: this.now(), replayable: true }
            this.lifecycle.phase = 'reconnecting'
            this._lifecycle('reconnecting', { instanceId: this.binding.instanceId })
            this._replayPending(leaseId)
          } else {
            this.lifecycle.phase = 'connected'
            this._lifecycle('connected', { instanceId: this.binding.instanceId })
          }
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
    // FIX-013 S4: a disconnect is a RE-CONNECTABLE event, not a terminal one.
    // The same authenticated process instance may re-establish the transport
    // and replay the ONE unacknowledged pending operation under a recovery
    // lease. The activation is never reused by another instance; a consumed
    // activation cannot select a replacement process.
    const hadBinding = this.binding
    if (this.lifecycle.phase !== 'ended') {
      this.lifecycle.phase = 'disconnected'
      this._lifecycle('disconnected', hadBinding ? { instanceId: this.binding.instanceId } : undefined)
    }
    // A delivery acknowledgement in flight fails: the caller re-persists and
    // retries the SAME operation id, and the retry becomes the replay.
    for (const ack of this.pendingAcks.values()) ack.resolve(bridgeFailure('companion-disconnected'))
    this.pendingAcks.clear()
    for (const [key, pending] of this.active.entries()) {
      // Do NOT drop the slot on a plain transport loss: if the same process
      // reconnects within the bounded window, this exact entry is replayed
      // once under the recovery lease (never re-acknowledged as a new
      // question, never double-counted). An ended lifecycle drops it below.
      if (this.lifecycle.ended) {
        this.active.delete(key)
        this.onCancel(pending)
      }
    }
    if (!this.lifecycle.ended) {
      this._armReplayLease()
      if (this.onDisconnect) this.onDisconnect()
    }
  }

  /**
   * Arm the bounded recovery lease that lets the SAME authenticated process
   * replay the one unacknowledged pending operation after a reconnect. The
   * lease is single-use and expires; a second disconnect does not renew it.
   */
  _armReplayLease() {
    if (!this.replayLease) {
      this.replayLease = { leaseId: crypto.randomUUID(), grantedAt: this.now(), replayable: true }
    }
    const lease = this.replayLease
    const remaining = this.recoveryLeaseMs - (this.now() - lease.grantedAt)
    if (remaining <= 0) {
      this._expireReplayLease()
      return
    }
    if (lease.timer) clearTimeout(lease.timer)
    lease.timer = setTimeout(() => this._expireReplayLease(), remaining)
    if (typeof lease.timer.unref === 'function') lease.timer.unref()
  }

  /** The lease expired or was consumed: replay is no longer possible. */
  _expireReplayLease() {
    if (this.replayLease) {
      if (this.replayLease.timer) clearTimeout(this.replayLease.timer)
      this.replayLease.replayable = false
      this.replayLease.timer = null
    }
    if (this.lifecycle.phase === 'reconnecting') {
      // The SAME process never reconnected within the bounded window: the
      // disconnect is now terminal for replay. No second disconnected event
      // is emitted — the server's reconnect window is already armed and
      // bounded; an extra event would only re-arm it.
      this.lifecycle.phase = 'disconnected'
    }
  }

  /**
   * Replay the ONE unacknowledged pending operation under the fresh recovery
   * lease. The operation identity is carried unchanged, so the server sees
   * exactly one terminal result for the same (sessionId, questionKey,
   * operationId). Nothing is re-acked as a NEW question; the frame's
   * `replayed` marker lets the app surface the recovery to the user.
   */
  _replayPending(leaseId) {
    if (!this.replay || !this.replayLease || this.replayLease.replayable !== true) return
    const entry = this.replay
    if (this.active.has(entry.key)) {
      if (this._write({
        type: 'question', version: BRIDGE_PROTOCOL_VERSION,
        question: entry.question, operationId: entry.operationId,
        replayed: true, leaseId,
      })) {
        this._consumeReplayLease()
      }
    }
  }

  _consumeReplayLease() {
    if (this.replayLease) {
      if (this.replayLease.timer) clearTimeout(this.replayLease.timer)
      this.replayLease.replayable = false
      this.replayLease.timer = null
    }
  }

  /**
   * endLifecycle — shutdown ends the lifecycle EXACTLY ONCE: the transport
   * closes, the bridge bindings are released, pending slots are cancelled
   * (the durable store transfer is the server's job), the replay lease is
   * consumed, and the `ended` event is emitted. Returns a promise that
   * resolves after the end callbacks have run.
   */
  async endLifecycle() {
    if (this._ended) return { ok: true, alreadyEnded: true }
    if (this.lifecycle.phase === 'ended') return { ok: true, alreadyEnded: true }
    this._ended = true
    this.ready = false
    this.lifecycle.phase = 'ended'
    this.lifecycle.ended = true
    this._consumeReplayLease()
    this.replay = null
    for (const ack of this.pendingAcks.values()) ack.resolve(bridgeFailure('companion-ended'))
    this.pendingAcks.clear()
    for (const [key, pending] of this.active.entries()) {
      this.active.delete(key)
      this.onCancel(pending)
    }
    this._lifecycle('ended')
    if (this.socket) this.socket.destroy()
    if (this.server) await new Promise((resolve) => this.server.close(resolve))
    try { fs.unlinkSync(this.tokenFile) } catch (_) { /* already removed */ }
    try { fs.rmdirSync(this.socketDir) } catch (_) { /* only our empty dir */ }
    const callbacks = this.endCallbacks.splice(0)
    for (const callback of callbacks) {
      try { await callback() } catch (_) { /* best-effort teardown */ }
    }
    return { ok: true }
  }

  /** Register a shutdown hook (temp-audio sweep, protected-state removal). */
  onEnd(callback) {
    if (typeof callback === 'function') this.endCallbacks.push(callback)
  }

  _receive(message) {
    if (!message || typeof message !== 'object') return
    const key = this._key(message.sessionId, message.questionKey)
    if (message.type === 'delivered') {
      const ack = this.pendingAcks.get(key)
      if (ack) { this.pendingAcks.delete(key); ack.resolve({ ok: true }) }
      // The delivered acknowledgement ends the unacknowledged window: this
      // operation is never replayed (one terminal result per operation).
      if (this.replay && this.replay.key === key) this.replay = null
      return
    }
    if (message.type === 'recovered') {
      // The reconnected app re-acknowledges the exact replayed operation
      // (optionally carrying the granted recovery lease). This is the one
      // handoff completion for the replayed frame; an unknown operation or a
      // mismatched lease is ignored — the replay lease stays authoritative.
      const pending = this.active.get(key)
      if (!pending) return
      if (message.operationId !== undefined && pending.operationId !== message.operationId) return
      if (message.leaseId !== undefined && (!this.replayLease || this.replayLease.leaseId !== message.leaseId)) return
      if (this.replay && this.replay.key === key) this.replay = null
      this._consumeReplayLease()
      if (this.onRecovered) this.onRecovered(pending)
      this._write({ type: 'recovered-result', sessionId: message.sessionId, questionKey: message.questionKey, ok: true })
      // The exact handoff is acknowledged: the lifecycle returns to
      // connected, and the recovered step is surfaced once.
      this.lifecycle.phase = 'connected'
      this._lifecycle('recovered', { instanceId: this.binding ? this.binding.instanceId : undefined })
      return
    }
    if (message.type === 'ended') {
      // The app initiated normal shutdown: the lifecycle ends exactly once
      // (idempotent), closing bindings and running shutdown hooks.
      void this.endLifecycle()
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
      if (result && result.ok) {
        this.active.delete(key)
        // A terminal answer ends the unacknowledged window permanently: the
        // operation must never be replayed (exactly one terminal result).
        if (this.replay && this.replay.key === key) this.replay = null
      }
      this._write({ type: 'answer-result', sessionId: message.sessionId, questionKey: message.questionKey, ok: !!(result && result.ok), code: result && result.code })
      return
    }
    if (message.type === 'cancel') {
      this.active.delete(key)
      if (this.replay && this.replay.key === key) this.replay = null
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
    // FIX-013 S4: the ONE unacknowledged pending operation is the replay
    // candidate for a same-process reconnect under the recovery lease.
    // A delivered/acked or answered operation is no longer unacknowledged
    // and is never replayed; an ended lifecycle replays nothing.
    if (!this._ended) {
      this.replay = { key, entry: this.active.get(key), question, operationId }
    }
    if (!this._write({ type: 'question', version: BRIDGE_PROTOCOL_VERSION, question, operationId })) {
      this.active.delete(key)
      if (this.replay && this.replay.key === key) this.replay = null
      return bridgeFailure('companion-disconnected')
    }
    const result = await ack
    if (!result.ok) {
      // A transport disconnect is RE-CONNECTABLE (FIX-013 S4): the slot stays
      // as the ONE replay candidate for the same authenticated process under
      // its bounded recovery lease. Other failures (delivery timeout, cancel,
      // ended lifecycle) drop the slot permanently.
      const keepForReplay = result.code === 'companion-disconnected' && !this._ended
      if (!keepForReplay) {
        this.active.delete(key)
        if (this.replay && this.replay.key === key) this.replay = null
      }
    }
    return result
  }

  cancel({ sessionId, questionKey, operationId }) {
    const key = this._key(sessionId, questionKey)
    const pending = this.active.get(key)
    this.active.delete(key)
    // A cancelled question is terminal: it must never be replayed under a
    // recovery lease after a reconnect (FIX-013 S4).
    if (this.replay && this.replay.key === key) this.replay = null
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
    // Legacy close and the FIX-013 S4 shutdown path are the same operation:
    // the lifecycle ends exactly once (idempotent — a second close reports
    // alreadyEnded and never re-cancels or re-emits).
    await this.endLifecycle()
  }
}

module.exports = { LocalCompanionBridge, BRIDGE_PROTOCOL_VERSION, RECOVERY_LEASE_MS }
