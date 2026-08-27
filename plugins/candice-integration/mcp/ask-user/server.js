'use strict'

/**
 * candice-integration / mcp/ask-user/server.js
 * WS-04 structured ask_user MCP path — owned path: plugins/candice-integration/mcp/**
 *
 * The candice.ask_user MCP server (Master Spec 13.2). Local stdio MCP server
 * registered from the plugin's .mcp.json (spec 13: "Use a dedicated local
 * Claude Code plugin/integration layer"; 13.2: "use a local MCP tool contract
 * rather than screen-scraping terminal text").
 *
 * Tool contract (spec 13.2 + 14 + server.initialize response):
 *   candice.ask_user { question } -> { answer }
 *     - question: the structured question event (question-event.schema.json).
 *     - answer:   exactly one answer event (answer-event.schema.json). The
 *       tool call BLOCKS on the slot registry until the companion surface
 *       delivers the user's approved answer IN THE SAME Claude session.
 *     - wrong-session / wrong-question / unconfirmed answers are refused.
 *     - the companion is unavailable or the user chose Answer-in-Claude:
 *       the tool fails soft with a stable code the skill can use to fall back
 *       to asking the question normally in Claude (spec 13.2, 20) — the skill
 *       then drives the same question through the WS-05 terminal fallback
 *       without double-counting.
 *
 * FIX-013 S3 — durable lifecycle and fallback wiring:
 *
 *   - ONE lifecycle + ONE FallbackCoordinator are constructed per
 *     authenticated launch (see `createComposition` below; entrypoint) and
 *     injected into AskUserServer. A production path that only returns a text
 *     instruction without durable handoff does not exist: every fallback
 *     cause (mcp-unavailable, app-unavailable, delivery-failure, timeout,
 *     user-cancel from the companion, disconnect, recovery-failure) invokes
 *     the SAME coordinator method with the validated original question,
 *     session, key, counted flag and operation id.
 *   - Persist BEFORE delivery (setPendingQuestion with durableState
 *     'displaying'); require the delivered acknowledgement before 'displayed'
 *     (on delivered -> transitionPendingDurableState displaying -> displayed).
 *   - On timeout/cancel/bridge-failure the durable record is atomically
 *     transferred to 'fallback-pending' and the UI is invalidated (slot
 *     cancelled + bridge cancel frame before the fail-soft instruction).
 *   - On answer: the terminal commit (recordAnswer) MUST commit before the
 *     MCP success is returned. If the durable commit failed, the tool returns
 *     a RETRYABLE non-success (commit-pending) and retains exactly one
 *     recoverable record — the skill retries the same (sessionId, questionKey,
 *     operationId) and the idempotent terminal completion resolves it.
 *
 * No answer text is logged. Raw audio never enters the contract (spec 14).
 *
 * JSON-RPC/MCP wire layer (zero dependencies, per sections 12/17/27): handles
 * initialize, notifications/initialized, tools/list, tools/call, ping.
 * The Protocol-Version handshake: the client declares its version; this server
 * claims `2025-06-18` when the client's version is unsupported-but-known, and
 * otherwise echoes the client version as the per-protocol rule requires.
 */

const os = require('os')
const path = require('path')

const { validateQuestionEvent } = require('./validate')
const { AnswerSlotRegistry } = require('./answer-registry')
const { LocalCompanionBridge } = require('./local-companion-bridge')
const { deriveOperationId } = require('../../session/lifecycle-protocol')
const { SessionLifecycle } = require('../../session/session-lifecycle')
const { FallbackCoordinator } = require('../../fallback/fallback-coordinator')

const SERVER_NAME = 'candice'
const SERVER_VERSION = '1.0.0'
const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
const LATEST_PROTOCOL = '2025-06-18'
const WIRE_BREAK = /\r?\n/ // frame boundary: newline-delimited JSON

const JSONRPC_PARSE_ERROR = -32700
const JSONRPC_INVALID_REQUEST = -32600
const JSONRPC_METHOD_NOT_FOUND = -32601
const JSONRPC_INVALID_PARAMS = -32602
const JSONRPC_INTERNAL_ERROR = -32603

const ANSWER_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'object', description: 'Structured question event per packages/candice-protocol/schemas/question-event.schema.json (Master Spec 14).' },
    sessionId: { type: 'string', description: 'Opaque Claude Code session id — routing authority (spec 17).' },
  },
  required: ['question'],
  additionalProperties: false,
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * defaultStateDir — one deterministic per-user state root shared by the MCP
 * process and the companion: `~/.candice/state` (POSIX) / %USERPROFILE%\.candice\state.
 * Never read from the environment — the provider-identity gate pins the
 * plugin's env surface to the single readiness probe; `homedir()` is the
 * OS-owned user home resolution, not an env read.
 */
function defaultStateDir() {
  return path.join(os.homedir(), '.candice', 'state')
}

/**
 * FIX-013 S5 — production startup recovery, spawned BEFORE the interactive
 * surface. The WS-35 runner (src-tauri/recovery/startup-runner.ts) executes
 * the REAL store recovery + the REAL WS-20 temp sweep over the real
 * node:fs adapter + the WS-33 updater journal (validated, never executed).
 * Runner IO is bounded (one child, one JSON line, hard 20 s cap); a failure
 * degrades the server state and never blocks Claude (spec 20). The recovered
 * record stays `recovering` — startup never resumes it; the app or terminal
 * fallback acknowledges the exact handoff later.
 */
function runProductionStartupRecovery(options) {
  const opts = options || {}
  const runner = path.join(__dirname, '..', '..', '..', '..', 'apps', 'candice-companion', 'src-tauri', 'recovery', 'startup-runner.ts')
  const args = ['--experimental-strip-types', runner, '--state-dir', opts.stateDir || defaultStateDir(), '--temp-root', opts.tempRoot || os.tmpdir()]
  if (opts.sessionId) { args.push('--session-id', opts.sessionId) }
  if (opts.journalFile) { args.push('--journal', opts.journalFile) }
  if (opts.updaterComponent) { args.push('--component', opts.updaterComponent) }
  return new Promise((resolve) => {
    let settled = false
    const done = (outcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    let child
    try {
      child = require('child_process').spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (_) {
      done({ ok: false, failures: ['runner:spawn-failed'], degraded: { reason: 'sweep-failed', detail: 'startup runner could not spawn', retryAtStartup: true } })
      return
    }
    const timeout = setTimeout(() => { try { child.kill() } catch (_) {} done({ ok: false, failures: ['runner:timeout'], degraded: { reason: 'sweep-failed', detail: 'startup runner exceeded 15s', retryAtStartup: true } }) }, 15000)
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => { clearTimeout(timeout); done({ ok: false, failures: ['runner:error'], degraded: { reason: 'sweep-failed', detail: 'startup runner process error', retryAtStartup: true } }) })
    child.on('exit', () => {
      clearTimeout(timeout)
      const line = out.split('\n').find((l) => l.trim().length > 0)
      try {
        const parsed = line ? JSON.parse(line) : null
        if (parsed && typeof parsed === 'object') { done(parsed); return }
      } catch (_) { /* fall through to degraded */ }
      done({ ok: false, failures: ['runner:unparseable'], degraded: { reason: 'sweep-failed', detail: 'startup runner produced no parseable outcome', retryAtStartup: true } })
    })
  })
}

/**
 * createComposition — construct EXACTLY ONE lifecycle + ONE FallbackCoordinator
 * per authenticated launch (FIX-013 S3). The MCP entrypoint owns this; the
 * components are then injected into the AskUserServer. The state root is
 * deterministic per-user (never an env probe) and the lifecycle is lazily
 * opened — a blocked store (storeBlockedReason) is surfaced on the
 * lifecycle so a later ask gates on it instead of persisting blind.
 */
function createComposition(options) {
  const opts = options || {}
  const stateDir = opts.stateDir || defaultStateDir()
  const lifecycle = opts.lifecycle instanceof SessionLifecycle
    ? opts.lifecycle
    : new SessionLifecycle({
        stateDir: opts.stateDir ? opts.stateDir : stateDir,
        clock: opts.clock || undefined,
      })
  const coordinator = opts.coordinator instanceof FallbackCoordinator
    ? opts.coordinator
    : new FallbackCoordinator(Object.assign({}, opts.coordinatorOpts || {}, { lifecycle }))
  return { lifecycle, coordinator, stateDir }
}

class AskUserServer {
  /**
   * @param {object} opts
   * @param {function} [opts.deliverQuestion] async (question) => {ok,...} — the
   *   companion front channel (display/speak). Absent => the deliverer is
   *   treated as unavailable and the tool fails soft immediately (spec 20).
   * @param {AnswerSlotRegistry} [opts.registry] answer slot registry.
   * @param {function} [opts.sleep] async ms => Promise; injectable for tests.
   * @param {function} [opts.isCompanionReady] () => boolean — runtime probe;
   *   when false the tool fails soft fast (companion unavailable, spec 20).
   * @param {function} [opts.poll] (() => boolean) — registry poll override.
   * @param {SessionLifecycle} [opts.lifecycle] WS-03-compatible lifecycle
   *   (setPendingQuestion, recordAnswer, transitionPendingDurableState,
   *   getPendingOperation, recordFallbackAnswer, beginSession) — durability
   *   record for crash recovery (spec 20). REQUIRED for the durable path in
   *   production; when absent the server fails soft WITHOUT durable handoff
   *   (legacy embedders/tests) and never marks the answer committed.
   * @param {FallbackCoordinator} [opts.fallback] coordinator for the durable
   *   terminal handoff (constructed once per authenticated launch).
   */
  constructor(opts) {
    const options = opts || {}
    this.registry = options.registry || new AnswerSlotRegistry()
    this.bridge = options.bridge || null
    this.deliverQuestion = typeof options.deliverQuestion === 'function'
      ? options.deliverQuestion
      : this.bridge
        ? (question) => this.bridge.deliverQuestion(question)
        : null
    // Fail-safe readiness probe: the tool delivers only after the companion
    // has completed the authenticated local bridge handshake. Without it the
    // tool fails soft and the skill asks in Claude (spec 13.2/20).
    this.isCompanionReady = typeof options.isCompanionReady === 'function'
      ? options.isCompanionReady
      : () => this.bridge ? this.bridge.isReady() : false
    this.lifecycle = options.lifecycle || null
    this.fallback = options.fallback || null
    this.sleep = typeof options.sleep === 'function' ? options.sleep : (ms) => new Promise((r) => setTimeout(r, ms))
    this.waitWindowMs = options.waitWindowMs || 10 * 60 * 1000 // injectable for tests
    this.reconnectWindowMs = options.reconnectWindowMs || 3000 // bounded reconnect wait after a transport disconnect
    this.disconnectedSince = null
    this.disconnectDeadline = 0
    this._recovered = false // FIX-013 S4 QC D2: recovery acknowledged for the in-flight operation
    this.skipped = options.skipped || false // test instrumentation
    this.cancelledSlots = new Set()
    // FIX-013 S5: production startup recovery outcome (real store + sweep +
    // disposition), recorded before the interactive surface. `startupDegraded`
    // is the bounded degraded status; null on a clean pass. Never blocks.
    this.startupOutcome = options.startupOutcome || null
    this.startupDegraded = options.startupDegraded || null
    // FIX-013 S5 QC D2: the startup recovery outcome is consumed EXACTLY
    // ONCE. The flag is set when the matching ask enters the recovery branch
    // and is cleared only on a retryable failure (the same operation may
    // re-enter); a terminal outcome keeps it so a second ask of the same
    // question can never re-ask or double-count.
    this._startupRecoveryConsumed = false
    if (this.bridge) {
      this.bridge.onAnswer = (input) => this.registry.put(input)
      this.bridge.onCancel = (input) => {
        this.cancelledSlots.add(`${input.sessionId}::${input.questionKey}`)
        return this.registry.cancel(input)
      }
      // FIX-013 S4: ONE bridge lifecycle per launch. `disconnected` is
      // re-connectable (bounded wait, then terminal fallback); `recovered`
      // mirrors the app re-acknowledging a replayed operation; `ended` fires
      // exactly once at shutdown.
      this.bridge.onLifecycleEvent = (event) => {
        if (event.lifecycle === 'disconnected') this._onBridgeDisconnected(event)
        else if (event.lifecycle === 'recovered') this._onBridgeRecovered(event)
        else if (event.lifecycle === 'ended') this._onBridgeEnded()
      }
      // FIX-013 S4 normal shutdown: the lifecycle ends exactly once, bridge
      // bindings close, queue/answer slots release, session temp audio is
      // swept (marker-guarded, WS-20 safety mirror), and protected pending
      // state is removed durably (endSession clears the pending record).
      if (this.lifecycle && typeof this.bridge.onEnd === 'function') {
        this.bridge.onEnd(async () => {
          await this._shutdownCleanup()
        })
      }
    }
  }

  /** One bounded reconnect window per disconnect (never re-opened by an
   * ended lifecycle). */
  _onBridgeDisconnected() {
    if (this._ended) return
    const deadline = Date.now() + this.reconnectWindowMs
    if (this.disconnectedSince === null) this.disconnectedSince = Date.now()
    if (deadline > this.disconnectDeadline) this.disconnectDeadline = deadline
    // FIX-013 S4 QC D2: a new disconnect invalidates any prior recovery —
    // the in-flight operation is no longer recovered.
    this._recovered = false
  }

  _onBridgeRecovered(event) {
    // FIX-013 S4 QC D2: the recovered handoff was acknowledged for the
    // in-flight operation. The bridge flips to 'connected' in the same
    // breath, so the transport-loss decision below must not require
    // 'reconnecting' once a recovery is on record.
    this._recovered = true
    if (this.lifecycle && typeof this.lifecycle.acknowledgeRecoveryHandoff === 'function' && event.sessionId) {
      try {
        this.lifecycle.acknowledgeRecoveryHandoff({
          sessionId: event.sessionId,
          leaseId: event.leaseId,
        })
      } catch (_) {
        // Acknowledge is best-effort here; the app's own recovered
        // acknowledgement is the authoritative completion path.
      }
    }
  }

  _onBridgeEnded() {
    this._ended = true
    this.disconnectedSince = null
    this.disconnectDeadline = null
    this._recovered = false
  }

  /** True while the app may still re-establish the same authenticated
   * transport after a disconnect. */
  _withinReconnectWindow() {
    if (this.disconnectedSince === null) return false
    return Date.now() < this.disconnectDeadline
  }

  /**
   * _shutdownCleanup — the normal-shutdown sweep (FIX-013 S4). For every
   * session the lifecycle still owns: end it durably (removes protected
   * pending state), then sweep that session's temp audio — ONLY a
   * marker-carrying directory directly under the Candice temp root is ever
   * removed (the WS-20 ownership proof; a naming coincidence never causes a
   * delete). Every failure is contained: shutdown must never throw.
   */
  async _shutdownCleanup() {
    const lifecycle = this.lifecycle
    if (!lifecycle || !lifecycle.sessions) return
    let sessions = []
    try { sessions = lifecycle.sessions.listActiveSessions() || [] } catch (_) { return }
    for (const record of sessions) {
      const sessionId = record && record.sessionId
      if (!sessionId) continue
      try {
        const ended = await Promise.resolve(lifecycle.endSession({ sessionId, reason: 'bridge-ended' }))
        if (ended && ended.ok && this._sweepSessionTemp) await this._sweepSessionTemp(sessionId)
      } catch (_) { /* shutdown is best-effort; the durable store is the truth */ }
    }
  }

  /**
   * _sweepSessionTemp — marker-guarded removal of one session's temp audio
   * dir. Mirrors the WS-20 safety contract: only `<tmp>/candice-companion/
   * session-<id>` directories carrying `.candice-session` are removed, and
   * the resolved dir must be a direct child of the Candice-owned root.
   */
  async _sweepSessionTemp(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) return
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const root = path.join(os.tmpdir(), 'candice-companion')
    const dir = path.join(root, `session-${sessionId}`)
    try {
      const realRoot = fs.realpathSync(root)
      const realDir = fs.realpathSync(dir)
      const rest = realDir.slice(realRoot.length)
      if (!rest.startsWith('/') && !rest.startsWith('\\')) return
      const marker = path.join(dir, '.candice-session')
      if (!fs.existsSync(marker)) return
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (_) { /* absent or unverifiable: never delete blindly */ }
  }

  _cancelSlot(input) {
    this.registry.cancel(input)
    this.bridge?.cancel(input)
  }

  /**
   * _failSoft — one shared fail-soft assembly. The skill instruction text is
   * always present; `commitRef` carries the durable handoff proof (cause +
   * operationId + durableState) so a QC trace can prove the terminal fallback
   * path was entered with the SAME operation, not just a text instruction.
   */
  _failSoft(reason, cause, q, operationId) {
    const text = `candice.ask_user: ${reason}; ask the same question in Claude normally`
    const extra = { cause, operationId, questionKey: q ? q.questionKey : undefined }
    return this._toolResult({
      content: [{ type: 'text', text }],
      isError: true,
      fallback: extra,
    })
  }

  /**
   * _resolveProtocol — client/server version negotiation per the MCP
   * protocol-version rule: echo the client version when supported; claim
   * LATEST_PROTOCOL for a client whose version this server does not know.
   */
  _resolveProtocol(clientVersion) {
    if (SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion)) return clientVersion
    return LATEST_PROTOCOL
  }

  /**
   * _composeTextResult — one content block, isError flag as the spec allows
   * for a tool call that executes but reports a domain failure (e.g. the
   * fallback instruction for MCP-unavailable questions).
   */
  _composeTextResult(text, isError) {
    return { content: [{ type: 'text', text }], isError: !!isError }
  }

  /** _toolResult — always a valid JSON-RPC success envelope (tool outcome
   * goes in the result body; protocol-level errors use _error). */
  _toolResult(result) {
    return { result }
  }

  _error(code, message, data) {
    const e = { code, message: message || 'error' }
    if (data !== undefined) e.data = data
    return { error: e }
  }

  /**
   * _runFallback — the ONE coordinator entry for every fallback cause.
   * Returns the ready-made fail-soft result. The durable claim happens here,
   * before the instruction text leaves the process. The instruction surface
   * carries a stable human-readable reason (the cause word, or the
   * underlying stable code when `detail` is given, e.g. the deliverer's
   * `app-missing`) so the skill can branch on the exact mode of
   * unavailability; the `fallback` envelope carries the durable proof
   * (cause + operationId + durableState) for the QC trace.
   */
  _runFallback(cause, q, operationId, detail) {
    const reason = detail || cause
    const text = cause === 'user-cancel'
      ? 'candice.ask_user: question cancelled by the companion; ask the same question in Claude normally'
      : cause === 'timeout'
        ? 'candice.ask_user: no approved answer within the wait window; ask the same question in Claude normally'
        : `candice.ask_user: companion is unavailable (${reason}); ask the same question in Claude normally`
    if (this.fallback && typeof this.fallback.fallbackQuestion === 'function') {
      const handled = this.fallback.fallbackQuestion(q, cause, operationId)
      if (!handled.ok) {
        // The durable claim failed closed: surface the reason, NEVER a bare
        // text-only return (there is no text-only production path).
        return this._failSoft(`fallback handoff refused (${handled.code})`, cause, q, operationId)
      }
      if (handled.durableCommitOk === false) {
        // The claim's terminal durable commit did not reach disk: the
        // terminal surface does NOT own the question. Never report a
        // fallback-pending handoff on an unproven commit (FIX-013 S3 QC D1).
        return this._failSoft('fallback handoff commit failed; retryable — the same question/session/operation may be retried', cause, q, operationId)
      }
      return this._toolResult({
        content: [{ type: 'text', text }],
        isError: true,
        fallback: { cause: handled.cause || cause, operationId, questionKey: q ? q.questionKey : undefined, durableState: handled.durableState },
      })
    }
    // No coordinator (legacy embedders/tests): fail soft WITHOUT a durable
    // claim — the caller did not wire the durable path.
    return this._toolResult({ content: [{ type: 'text', text }], isError: true })
  }

  /**
   * FIX-013 S5 QC D2 — the startup recovery outcome is the MCP process's
   * consumer of the runner's recovered record. The runner claimed the lease
   * and printed the outcome; this server stored it and now READS it.
   *
   * Match is on the full operation identity (sessionId, questionKey,
   * operationId) — the same identity the runner recovered and the same one
   * this ask derives. The durable store remains the authority: the branch
   * engages only when the durable record is still `recovering` with the same
   * operationId (a record already acked by the app is gone and falls through
   * to the normal path).
   */
  _matchesStartupRecovery(q, operationId) {
    if (this._startupRecoveryConsumed) return false
    const o = this.startupOutcome
    if (!o || !o.recovery || o.recovery.recovered !== true) return false
    if (o.recovery.sessionId !== q.sessionId) return false
    const p = o.recovery.pending
    if (!p) return false
    if (p.questionKey !== q.questionKey) return false
    if (p.operationId !== operationId) return false
    return true
  }

  /** Best-effort session resume after a recovery-owned record completes.
   * recordAnswer/recordFallbackAnswer never change record.status, so without
   * this the session would stay `recovering` and every later ask would be
   * refused `session-not-active`. Never throws, never blocks. */
  async _resumeAfterRecovery(sessionId) {
    if (this.lifecycle && typeof this.lifecycle.resumeSession === 'function') {
      try { await Promise.resolve(this.lifecycle.resumeSession({ sessionId })) } catch (_) { /* best-effort */ }
    }
  }

  /**
   * FIX-013 S5 QC D2 — re-ask the recovered question EXACTLY ONCE under the
   * runner's recovery lease. Returns null when the durable record no longer
   * matches (the app already acknowledged the handoff) so the caller falls
   * through to the normal path. The re-ask is a FRESH delivery frame (no
   * replayed flag — the app treats it as a new question), then the legal
   * durable transition `recovering -> displayed`, then the same wait loop as
   * the normal path, then the ONE terminal recordAnswer commit. The consumed
   * flag is cleared only on a retryable failure so the same operation may
   * re-enter; a terminal outcome keeps it — a second ask of the same
   * question can never re-ask or double-count.
   */
  async _reaskRecoveredQuestion(q, operationId) {
    if (!this.lifecycle || typeof this.lifecycle.getPendingOperation !== 'function') return null
    const durable = await Promise.resolve(this.lifecycle.getPendingOperation({ sessionId: q.sessionId }))
    if (!durable || !durable.ok || !durable.pending) return null
    const pending = durable.pending
    if (pending.durableState !== 'recovering' || pending.operationId !== operationId) return null
    this._startupRecoveryConsumed = true

    const slotOpen = this.registry.open({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
    if (!slotOpen.ok) {
      return this._toolResult(this._composeTextResult(`candice.ask_user: ${slotOpen.error}`, true))
    }

    let delivered
    try {
      delivered = this.deliverQuestion
        ? await this.deliverQuestion(q)
        : { ok: false, code: 'no-deliverer' }
    } catch (err) {
      delivered = { ok: false, code: 'delivery-threw', error: String((err && err.message) || err) }
    }
    if (!delivered || delivered.ok !== true) {
      // Same bounded reconnect window as the normal path: the same
      // authenticated process may crash and restart and replay this exact
      // operation under its recovery lease.
      const transportLoss = delivered && (delivered.code === 'companion-disconnected' || delivered.code === 'companion-delivery-timeout')
      if (transportLoss) {
        while (this._withinReconnectWindow()) {
          await this.sleep(50)
          const replayed = this.registry.peek({ sessionId: q.sessionId, questionKey: q.questionKey })
          if (replayed.ok && replayed.status === 'answered') break
          const ready = this.bridge ? this.bridge.isReady() : false
          if (ready && this.registry.openCount() > 0) {
            const replayed2 = this.registry.peek({ sessionId: q.sessionId, questionKey: q.questionKey })
            if (replayed2.ok && replayed2.status === 'waiting') break
          }
        }
      }
      const phase = this.bridge && this.bridge.lifecycle ? this.bridge.lifecycle.phase : null
      if (phase === 'reconnecting' || (this._recovered && phase === 'connected')) {
        // The replayed frame is in flight: fall through to the wait loop.
      } else {
        // The question never reached the companion surface. The record is
        // still `recovering` (the coordinator would refuse it with
        // `recovery-owns-question`), so the recovery branch owns the
        // transfer: `recovering -> fallback-pending` first, then the
        // coordinator sees a redelivered terminal claim.
        this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
        const cause = (delivered && (delivered.code === 'companion-busy' || delivered.code === 'app-missing' || delivered.code === 'companion-not-ready'))
          ? 'app-unavailable'
          : 'delivery-failure'
        return this._routeRecoveredToFallback(q, operationId, cause, delivered && (delivered.error || delivered.code))
      }
    }

    // Delivered acknowledgement received: persist the legal recovery
    // transition BEFORE waiting (the record carries the runner's leaseId).
    if (this.lifecycle && typeof this.lifecycle.transitionPendingDurableState === 'function') {
      const t = await Promise.resolve(this.lifecycle.transitionPendingDurableState({
        sessionId: q.sessionId,
        operationId,
        from: 'recovering',
        to: 'displayed',
      }))
      if (!t || !t.ok || t.durableCommitOk === false) {
        this._startupRecoveryConsumed = false
        this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
        return this._failSoft('recovery re-ask persist failed (durable-commit-failed); retryable — the same question/session/operation may be retried', 'delivery-failure', q, operationId)
      }
    }

    // Wait for exactly one approved answer in the owning session (spec 13.2).
    const deadline = Date.now() + this.waitWindowMs
    let answer
    for (;;) {
      if (this.cancelledSlots.delete(`${q.sessionId}::${q.questionKey}`)) {
        this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
        const res = this._runFallback('user-cancel', q, operationId)
        if (res.result && res.result.fallback) await this._resumeAfterRecovery(q.sessionId)
        return res
      }
      const t = this.registry.take({ sessionId: q.sessionId, questionKey: q.questionKey })
      if (t.ok) {
        answer = t.answer
        break
      }
      if (t.code === 'not-answered') {
        if (Date.now() > deadline) {
          this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
          const res = this._runFallback('timeout', q, operationId)
          if (res.result && res.result.fallback) await this._resumeAfterRecovery(q.sessionId)
          return res
        }
        await this.sleep(120)
        continue
      }
      return this._toolResult(this._composeTextResult(`candice.ask_user: ${t.error}`, true))
    }

    const recorded = answer.userConfirmedTranscript === true
    if (recorded && this.lifecycle && typeof this.lifecycle.recordAnswer === 'function') {
      const commit = await Promise.resolve(
        this.lifecycle.recordAnswer({
          sessionId: q.sessionId,
          questionKey: q.questionKey,
          operationId,
        })
      )
      if (!commit || commit.ok !== true || commit.durableCommitOk === false) {
        this._startupRecoveryConsumed = false
        return this._failSoft(`answer commit failed (${(commit && (commit.code && !commit.durableCommitOk ? 'durable-commit-failed' : commit.code)) || 'commit-pending'}); retryable — the same question/session/operation may be retried`, 'delivery-failure', q, operationId)
      }
    }

    // recordAnswer never changes record.status: the session would stay
    // `recovering` and every later ask would be refused `session-not-active`.
    await this._resumeAfterRecovery(q.sessionId)

    return this._toolResult({
      answer: {
        schemaVersion: answer.schemaVersion,
        sessionId: answer.sessionId,
        questionKey: answer.questionKey,
        answerText: answer.answerText,
        inputMode: answer.inputMode,
        userConfirmedTranscript: answer.userConfirmedTranscript,
      },
      ok: true,
      committed: recorded && !!this.lifecycle,
    })
  }

  /**
   * FIX-013 S5 QC D2 — route a recovery-owned question to the terminal
   * fallback. The record is still `recovering` (the coordinator refuses it
   * with `recovery-owns-question`), so the recovery branch performs the
   * legal transfer `recovering -> fallback-pending` FIRST (clears the
   * leaseId), then resumes the session, then hands the terminal claim to the
   * coordinator — which sees `fallback-pending` and returns redelivered:true.
   * A failed transfer clears the consumed flag and fails soft retryable.
   */
  async _routeRecoveredToFallback(q, operationId, cause, detail) {
    if (this.lifecycle && typeof this.lifecycle.transitionPendingDurableState === 'function') {
      const t = await Promise.resolve(this.lifecycle.transitionPendingDurableState({
        sessionId: q.sessionId,
        operationId,
        from: 'recovering',
        to: 'fallback-pending',
      }))
      if (!t || !t.ok || t.durableCommitOk === false) {
        this._startupRecoveryConsumed = false
        return this._failSoft('recovery fallback persist failed (durable-commit-failed); retryable — the same question/session/operation may be retried', cause, q, operationId)
      }
    }
    await this._resumeAfterRecovery(q.sessionId)
    return this._runFallback(cause, q, operationId, detail)
  }

  /**
   * askUser — the single exposed tool. See the file header for the contract.
   * FAILS SOFT on every companion/unavailability path (spec 13.2, 20):
   * the result carries isError:true with a stable instruction the skill can
   * act on ("ask the same question in Claude normally") plus the durable
   * fallback handoff record.
   */
  async askUser(params) {
    if (!isPlainObject(params)) {
      return this._toolResult(this._composeTextResult('candice.ask_user: params must be an object', true))
    }
    const question = params.question
    const sessionId = params.sessionId || (isPlainObject(question) ? question.sessionId : null)
    const check = validateQuestionEvent(question)
    if (!check.ok) {
      return this._toolResult(
        this._composeTextResult(
          `candice.ask_user: invalid question event (${check.field}: ${check.rule}); ask the same question in Claude normally`, true)
      )
    }
    const q = check.event
    this.cancelledSlots.delete(`${q.sessionId}::${q.questionKey}`)
    // FIX-013 S4 QC D2: a recovery acknowledged for a PREVIOUS operation must
    // not leak into this ask's transport-loss decision.
    this._recovered = false
    if (sessionId !== q.sessionId) {
      return this._toolResult(
        this._composeTextResult(
          `candice.ask_user: sessionId mismatch between params (${sessionId}) and question (${q.sessionId}); refused (spec 17)`, true)
      )
    }
    // One operation identity for this question: the SAME operationId is used
    // for the durable pending record, the answer slot, the bridge frame, and
    // the fallback handoff, so a retry of the same valid question produces one
    // transition and one terminal result (FIX-013 S1/S3).
    const operationId = deriveOperationId({ sessionId: q.sessionId, questionKey: q.questionKey })

    if (this.bridge) {
      const bound = await this.bridge.ensureSession(q.sessionId)
      if (!bound.ok) {
        // Pass the bridge's OWN code through as the detail. Collapsing every
        // ensureSession failure into a bare `mcp-unavailable` told the
        // operator the environment was broken when the truth was
        // `companion-not-configured` (fixable config) or
        // `companion-launch-failed` (a bad install path) — a diagnosable
        // fault reported as an environmental one. The CAUSE stays a valid
        // FALLBACK_CAUSES member so the coordinator handoff is unchanged;
        // only the operator-visible detail is widened.
        return this._runFallback('mcp-unavailable', q, operationId, bound.code)
      }
    }
    // S2 handoff: a BLOCKED durable store (unproven owner/mode/ACL, quarantine
    // failure) must gate the tool — never persist blind. No durable claim is
    // possible, so the ONLY honest return is the text fail-soft (the store
    // itself degrades to Claude text mode by design).
    if (this.lifecycle && this.lifecycle.sessions && this.lifecycle.sessions.storeBlockedReason) {
      return this._toolResult(
        this._composeTextResult(
          `candice.ask_user: durable state is blocked (${this.lifecycle.sessions.storeBlockedReason}); ask the same question in Claude normally`, true)
      )
    }
    // FIX-013 S5 QC D2 — the startup recovery consumer. When this ask
    // matches the runner's recovered record (sessionId, questionKey,
    // operationId) and the durable record is still `recovering`, the
    // recovery branch OWNS the routing: it re-asks exactly once under the
    // lease, or transfers the record to fallback-pending when the companion
    // cannot take it. It sits BEFORE the readiness probe because a
    // not-ready companion must route to fallback-pending, not hit the
    // coordinator's `recovery-owns-question` refusal and strand the record.
    if (this._matchesStartupRecovery(q, operationId)) {
      const recovered = await this._reaskRecoveredQuestion(q, operationId)
      if (recovered !== null) return recovered
    }
    if (!this.isCompanionReady()) {
      return this._runFallback('app-unavailable', q, operationId)
    }

    // A FRESH Claude session has no durable session record — nothing has
    // called begin_session yet, because the bridge only binds transport.
    // setPendingQuestion refuses an unknown session with `not-found`, which
    // sent QUESTION 1 of EVERY session down _runFallback('mcp-unavailable')
    // and showed the user text mode instead of the companion window. The
    // fallback then opened the session, so Q2+ worked — the defect looked
    // intermittent when it was in fact the first ask, every time.
    //
    // Mirrors the terminal-claim path in fallback/fallback-coordinator.js:
    // consult the durable record first and begin ONLY when there is none, so
    // a `recovering` or `ended` record is never overwritten by a fresh one
    // (beginSession short-circuits on `active` alone and would otherwise
    // clobber a recovery lease and its pending question). This sits AFTER the
    // blocked-store gate — a blocked store must never be persisted into — and
    // AFTER the readiness probe, because a not-ready companion routes to the
    // coordinator, which opens the session itself.
    if (
      this.lifecycle &&
      typeof this.lifecycle.beginSession === 'function' &&
      typeof this.lifecycle.getPendingOperation === 'function' &&
      q.skill !== undefined
    ) {
      const known = await Promise.resolve(this.lifecycle.getPendingOperation({ sessionId: q.sessionId }))
      if (known && known.ok === false && known.code === 'not-found') {
        const begin = await Promise.resolve(this.lifecycle.beginSession({ sessionId: q.sessionId, skill: q.skill }))
        // 'already-active' is the idempotent same-session case — not a failure.
        if (!begin || (!begin.ok && begin.code !== 'already-active')) {
          const reason = (begin && (begin.code || begin.error)) || 'session-not-active'
          return this._runFallback('mcp-unavailable', q, operationId, reason)
        }
      }
    }

    // Persist the governed slot BEFORE opening or delivering it. A lifecycle
    // refusal is authoritative: do not let a second pending/answered key reach
    // the companion and do not disturb FIX-011's authenticated bridge.
    let marked = false
    if (this.lifecycle && typeof this.lifecycle.setPendingQuestion === 'function') {
      const m = await Promise.resolve(this.lifecycle.setPendingQuestion({
        sessionId: q.sessionId,
        questionKey: q.questionKey,
        text: q.text,
        answerKind: q.answerKind,
        counted: q.counted,
        operationId,
      }))
      if (!m || !m.ok) {
        const reason = (m && (m.code || m.error)) || 'pending-question-refused'
        // The lifecycle refused the slot BEFORE any delivery: the question
        // never reached the companion. Terminal fallback owns it now. The
        // refusal code is a lifecycle verdict, NOT a fallback cause: the
        // coordinator validates causes against FALLBACK_CAUSES, so pass a
        // valid cause and surface the refusal code as the detail (FIX-013
        // S3 QC D2 — a refusal code as cause corrupts the handoff).
        return this._runFallback('mcp-unavailable', q, operationId, reason)
      }
      if (m.durableCommitOk === false) {
        // The pending record did not reach disk: persist-before-delivery is
        // broken. NEVER deliver a question the store cannot recover — fail
        // soft without opening or delivering the slot (FIX-013 S3 QC D4).
        return this._failSoft('pending persist failed (durable-commit-failed); retryable — the same question/session/operation may be retried', 'mcp-unavailable', q, operationId)
      }
      marked = true
    }

    const slotOpen = this.registry.open({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
    if (!slotOpen.ok) {
      return this._toolResult(this._composeTextResult(`candice.ask_user: ${slotOpen.error}`, true))
    }
    // NOTE: the canonical question event is NOT mutated with operationId —
    // operationId is lifecycle-envelope metadata, not a question-event field
    // (FIX-012 schema authority). The bridge derives it per frame, the slot
    // and the durable record carry it, and the coordinator receives it as the
    // explicit argument, so a re-validation of the event stays clean.

    let delivered
    try {
      delivered = this.deliverQuestion
        ? await this.deliverQuestion(q)
        : { ok: false, code: 'no-deliverer' }
    } catch (err) {
      delivered = { ok: false, code: 'delivery-threw', error: String((err && err.message) || err) }
    }
    if (!delivered || delivered.ok !== true) {
      // A plain transport disconnect is RE-CONNECTABLE (FIX-013 S4): the
      // same authenticated process may crash and restart within the bounded
      // window and replay this exact operation under its recovery lease.
      // Only when the window expires (or the delivery failed for a
      // non-transport reason) does the question transfer to the terminal
      // fallback — never while a reconnect is still possible.
      const transportLoss = delivered && (delivered.code === 'companion-disconnected' || delivered.code === 'companion-delivery-timeout')
      if (transportLoss) {
        while (this._withinReconnectWindow()) {
          await this.sleep(50)
          const replayed = this.registry.peek({ sessionId: q.sessionId, questionKey: q.questionKey })
          if (replayed.ok && replayed.status === 'answered') break
          const ready = this.bridge ? this.bridge.isReady() : false
          if (ready && this.registry.openCount() > 0) {
            const replayed = this.registry.peek({ sessionId: q.sessionId, questionKey: q.questionKey })
            if (replayed.ok && replayed.status === 'waiting') break
          }
        }
      }
      const phase = this.bridge && this.bridge.lifecycle ? this.bridge.lifecycle.phase : null
      // FIX-013 S4 QC D2: the recovered ack flips the bridge to 'connected'
      // in the same breath it emits 'recovered'. A recovery acknowledged for
      // THIS operation (this._recovered, cleared on disconnect/end and at
      // askUser start) is the same fall-through as 'reconnecting' — the
      // answer for the replayed operation is still in flight.
      if (phase === 'reconnecting' || (this._recovered && phase === 'connected')) {
        // The SAME authenticated process reconnected and the replayed frame
        // is in flight: fall through to the wait loop with the original
        // operation (the replay carries the identical operation id). The
        // slot was never cancelled, so the one answer completes the one
        // operation — no second ask, no double-count.
      } else {
        // The question never reached the companion surface (or the
        // reconnect window expired). Release the slot, send the matching
        // cancel/handoff to the bridge (invalidate UI), then atomically
        // transfer the durable record to 'fallback-pending' BEFORE
        // returning the fail-soft instruction (F13-03: a timeout must never
        // leave a recoverable pending record).
        this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
        const cause = (delivered && (delivered.code === 'companion-busy' || delivered.code === 'app-missing'))
          ? 'app-unavailable'
          : 'delivery-failure'
        // The deliverer's stable code (e.g. `app-missing`) surfaces in the
        // message so the skill can branch on the exact mode of unavailability.
        return this._runFallback(cause, q, operationId, delivered && (delivered.error || delivered.code))
      }
    }

    // Delivered acknowledgement received: the app has the question on screen
    // (or is about to). Persist displayed BEFORE waiting; a crash after the
    // acknowledgement but before the answer must recover exactly once.
    if (marked && this.lifecycle && typeof this.lifecycle.transitionPendingDurableState === 'function') {
      await Promise.resolve(this.lifecycle.transitionPendingDurableState({
        sessionId: q.sessionId,
        operationId,
        from: 'displaying',
        to: 'displayed',
      }))
    }

    // Wait for exactly one approved answer in the owning session (spec 13.2).
    const deadline = Date.now() + this.waitWindowMs
    let answer
    for (;;) {
      if (this.cancelledSlots.delete(`${q.sessionId}::${q.questionKey}`)) {
        // Companion cancelled (FIX-011 timeout-cancel / user cancel): the UI
        // is already invalid on the app side; this side transfers the durable
        // record to the terminal fallback before instructioning the skill.
        this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
        return this._runFallback('user-cancel', q, operationId)
      }
      const t = this.registry.take({ sessionId: q.sessionId, questionKey: q.questionKey })
      if (t.ok) {
        answer = t.answer
        break
      }
      if (t.code === 'not-answered') {
        if (Date.now() > deadline) {
          this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
          return this._runFallback('timeout', q, operationId)
        }
        await this.sleep(120)
        continue
      }
      return this._toolResult(this._composeTextResult(`candice.ask_user: ${t.error}`, true))
    }

    const recorded = answer.userConfirmedTranscript === true
    if (recorded && this.lifecycle && typeof this.lifecycle.recordAnswer === 'function') {
      // Duplicate answer protection: the WS-03 manager is authoritative and
      // enforces the operation identity (FIX-013 S1). The commit MUST succeed
      // before the MCP success is returned: a commit failure is a retryable
      // non-success (commit-pending) and exactly one recoverable record stays
      // — the skill retries the same operation id and the idempotent
      // completion resolves it. The answer was never shown as success.
      const commit = await Promise.resolve(
        this.lifecycle.recordAnswer({
          sessionId: q.sessionId,
          questionKey: q.questionKey,
          operationId,
        })
      )
      if (!commit || commit.ok !== true || commit.durableCommitOk === false) {
        return this._failSoft(`answer commit failed (${(commit && (commit.code && !commit.durableCommitOk ? 'durable-commit-failed' : commit.code)) || 'commit-pending'}); retryable — the same question/session/operation may be retried`, 'delivery-failure', q, operationId)
      }
    }

    // The same tool call, same Claude session, one answer (spec 13.2 item 5).
    return this._toolResult({
      answer: {
        schemaVersion: answer.schemaVersion,
        sessionId: answer.sessionId,
        questionKey: answer.questionKey,
        answerText: answer.answerText,
        inputMode: answer.inputMode,
        userConfirmedTranscript: answer.userConfirmedTranscript,
      },
      // Fail-soft hook for the caller: the answer is a single structured event.
      ok: true,
      committed: recorded && !!this.lifecycle,
    })
  }

  /** _dispatch — route one inbound JSON-RPC message to its handler. */
  _dispatch(raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch (err) {
      return this._error(JSONRPC_PARSE_ERROR, 'parse error')
    }
    if (!isPlainObject(msg) || msg.jsonrpc !== '2.0') {
      return this._error(JSONRPC_INVALID_REQUEST, 'invalid request')
    }
    if (msg.method === undefined) {
      return this._error(JSONRPC_INVALID_REQUEST, 'invalid request: missing method')
    }
    // Notifications: no id — no response.
    if (msg.id === undefined || msg.id === null) {
      return null
    }
    switch (msg.method) {
      case 'initialize':
        return {
          result: {
            protocolVersion: this._resolveProtocol((msg.params || {}).protocolVersion),
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION,
            },
          },
        }
      case 'tools/list':
        return {
          result: {
            tools: [
              {
                name: 'ask_user',
                description:
                  'Deliver one structured governed question to the local Candice companion and wait for EXACTLY ONE final approved answer from the same Claude Code session. ' +
                  'Input: the question-event schema (schemaVersion 1.0, sessionId, skill, event "question", questionKey, text, answerKind, allowedInputModes, readAloud, sensitivity, counted, progress, helpText, canGoBack). ' +
                  'Output: the answer-event schema — exactly one answer (answerText, inputMode voice|typed|terminal, userConfirmedTranscript true). ' +
                  'Fail-soft (spec 13.2/20): when the companion is unavailable, delivery fails, or no confirmation arrives, this tool returns isError with instructions to ask the SAME question normally in Claude ' +
                  '(the skill then falls back through the candice-integration fallback adapter — no second count). ' +
                  'A retry of the same (sessionId, questionKey) after a commit failure is idempotent (same operation identity). ' +
                  'Never send Raw audio; never read a question aloud when sensitivity is "secret"; the answer routes to the session that asked (spec 17).',
                inputSchema: ANSWER_TOOL_SCHEMA,
              },
            ],
          },
        }
      case 'tools/call': {
        // Canonical MCP framing (protocol 2024-11-05/2025-03-26/2025-06-18):
        // tools/call params = { name, arguments: {...} }.
        const mp = msg.params || {}
        const params = mp.arguments !== undefined ? mp.arguments : (mp.params || {})
        const toolName = mp.name || ''
        const id = msg.id
        if (toolName !== 'ask_user') {
          return this._error(JSONRPC_METHOD_NOT_FOUND, `unknown tool: ${toolName}`, { id })
        }
        return this.askUser(params).then(
          (result) => result,
          (err) => this._error(JSONRPC_INTERNAL_ERROR, 'internal error', { cause: String((err && err.message) || err) })
        )
      }
      case 'ping':
        return { result: {} }
      default:
        return this._error(JSONRPC_METHOD_NOT_FOUND, `method not found: ${msg.method}`, { id: msg.id })
    }
  }

  /**
   * _serialize — wrap a dispatch outcome into one response JSON line.
   * `id` is the request id recovered from the raw line.
   */
  _serialize(id, result) {
    return JSON.stringify({ jsonrpc: '2.0', id, ...result })
  }

  /**
   * handleLine — process one framed JSON-RPC line. Returns the response JSON
   * line, a Promise of one (async methods such as tools/call), or null for
   * notifications (no response is allowed).
   */
  handleLine(line) {
    const trimmed = line.trim()
    if (trimmed.length === 0) return null
    let id = null
    try {
      const parsed = JSON.parse(trimmed)
      id = parsed && parsed.id !== undefined && parsed.id !== null ? parsed.id : null
    } catch (err) {
      /* parse errors carry no id */
    }
    if (id === null) return null // notification or unparseable — never answer these
    const result = this._dispatch(trimmed)
    if (result === null) return null
    if (typeof result.then === 'function') {
      return result.then((resolved) => {
        if (resolved === null) return null
        return this._serialize(id, resolved)
      })
    }
    return this._serialize(id, result)
  }

  /** run — stdio pump. Frames arrive as newline-delimited JSON on stdin;
   * responses go to stdout one JSON line per response. Never writes logs to
   * stdout (the MCP transport owns it); diagnostics go to stderr.
   */
  run() {
    const server = this
    const stdin = process.stdin
    let buffer = ''
    stdin.setEncoding('utf8')
    stdin.on('data', (chunk) => {
      buffer += chunk
      let idx
      while ((idx = buffer.search(WIRE_BREAK)) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + (buffer[idx + 1] === '\n' ? 2 : 1))
        const response = server.handleLine(line)
        if (response === null) continue
        if (typeof response.then === 'function') {
          response.then((resolved) => {
            if (resolved) process.stdout.write(resolved + '\n')
          })
        } else {
          process.stdout.write(response + '\n')
        }
      }
    })
    stdin.on('error', () => process.exit(0))
    stdin.on('end', () => process.exit(0))
  }
}

module.exports = {
  AskUserServer,
  SERVER_NAME,
  SERVER_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  createComposition,
  defaultStateDir,
}

if (require.main === module) {
  // One MCP process creates one fresh per-launch capability token and local
  // endpoint. `ready` is true only after the separately running Tauri
  // companion authenticates that exact launch; it is never an environment
  // string or a foreground-window guess. EXACTLY ONE lifecycle and ONE
  // FallbackCoordinator are constructed here, per authenticated launch
  // (FIX-013 S3), and injected into the server.
  // Optional arg: `--state-dir <path>` (hermetic launches/tests); the
  // default is the deterministic per-user root.
  // FIX-013 S5: recovery + startup sweep + updater disposition run BEFORE
  // the interactive surface (bridge, window, question delivery). The real
  // WS-35 runner executes against the REAL protected store, the REAL WS-20
  // sweep engine over the real node:fs adapter, and the WS-33 updater
  // journal (read + validated, never executed). The outcome is recorded on
  // the server; partial cleanup degrades (bounded, safe retry) and never
  // blocks Claude. The recovered record stays `recovering` — `resumeSession`
  // is never called by startup; the exact handoff is acknowledged by the
  // app (`recovered-result`) or the terminal fallback.
  ;(async () => {
    const argv = process.argv.slice(2)
    const stateDirArg = argv.indexOf('--state-dir') >= 0 ? argv[argv.indexOf('--state-dir') + 1] : null
    const bridge = new LocalCompanionBridge()
    // FIX-013 S5: recovery + startup sweep + updater disposition run BEFORE
    // the interactive surface AND before the lifecycle is constructed, so
    // the in-memory lifecycle loads the durable post-claim state (the lease
    // and `recovering` are already on disk when the server starts).
    let startup = null
    if (!argv.includes('--skip-startup-recovery')) {
      startup = await runProductionStartupRecovery({
        stateDir: stateDirArg || defaultStateDir(),
        tempRoot: os.tmpdir(),
      })
    }
    const { lifecycle, coordinator } = createComposition(stateDirArg ? { stateDir: stateDirArg } : {})
    const server = new AskUserServer({ bridge, lifecycle, fallback: coordinator, startupOutcome: startup, startupDegraded: startup ? startup.degraded : null })
    await bridge.start()
    // FIX-013 S4: normal shutdown ends the lifecycle EXACTLY ONCE (idempotent
    // on repeat signals): close bridge bindings, sweep session temp audio,
    // remove protected pending state. Stdin EOF (Claude closing the tool
    // process) takes the same path.
    let ending = false
    const endLifecycle = () => {
      if (ending) return
      ending = true
      void bridge.endLifecycle().finally(() => process.exit(0))
    }
    process.on('SIGINT', endLifecycle)
    process.on('SIGTERM', endLifecycle)
    process.on('SIGQUIT', endLifecycle)
    const originalExit = process.exit
    process.exit = (code) => {
      endLifecycle()
      setTimeout(() => originalExit(code), 1000).unref()
    }
    server.run()
  })().catch(() => process.exit(0))
}
