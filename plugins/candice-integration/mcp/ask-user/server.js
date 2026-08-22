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
 * No answer text is logged. Raw audio never enters the contract (spec 14).
 *
 * JSON-RPC/MCP wire layer (zero dependencies, per sections 12/17/27): handles
 * initialize, notifications/initialized, tools/list, tools/call, ping.
 * The Protocol-Version handshake: the client declares its version; this server
 * claims `2025-06-18` when the client's version is unsupported-but-known, and
 * otherwise echoes the client version as the per-protocol rule requires.
 */

const { validateQuestionEvent } = require('./validate')
const { AnswerSlotRegistry } = require('./answer-registry')
const { LocalCompanionBridge } = require('./local-companion-bridge')
const { deriveOperationId } = require('../../session/lifecycle-protocol')

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
   * @param {object} [opts.lifecycle] WS-03-compatible { setPendingQuestion,
   *   recoverPendingQuestion, resumeSession, recordAnswer } — durability
   *   record for crash recovery (spec 20: recover the exact pending question).
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
    this.sleep = typeof options.sleep === 'function' ? options.sleep : (ms) => new Promise((r) => setTimeout(r, ms))
    this.waitWindowMs = options.waitWindowMs || 10 * 60 * 1000 // injectable for tests
    this.skipped = options.skipped || false // test instrumentation
    this.cancelledSlots = new Set()
    if (this.bridge) {
      this.bridge.onAnswer = (input) => this.registry.put(input)
      this.bridge.onCancel = (input) => {
        this.cancelledSlots.add(`${input.sessionId}::${input.questionKey}`)
        return this.registry.cancel(input)
      }
    }
  }

  _cancelSlot(input) {
    this.registry.cancel(input)
    this.bridge?.cancel(input)
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
   * askUser — the single exposed tool. See the file header for the contract.
   * FAILS SOFT on every companion/unavailability path (spec 13.2, 20):
   * the result carries isError:true with a stable instruction the skill can
   * act on ("ask the same question in Claude normally").
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
    if (sessionId !== q.sessionId) {
      return this._toolResult(
        this._composeTextResult(
          `candice.ask_user: sessionId mismatch between params (${sessionId}) and question (${q.sessionId}); refused (spec 17)`, true)
      )
    }
    if (this.bridge) {
      const bound = await this.bridge.ensureSession(q.sessionId)
      if (!bound.ok) {
        return this._toolResult(this._composeTextResult(`candice.ask_user: companion is unavailable (${bound.code}); ask the same question in Claude normally`, true))
      }
    }
    if (!this.isCompanionReady()) {
      return this._toolResult(
        this._composeTextResult(
          'candice.ask_user: companion is unavailable; ask the same question in Claude normally (spec 13.2 — MCP bridge unavailable)', true)
      )
    }

    // One operation identity for this question: the SAME operationId is used
    // for the durable pending record, the answer slot, and the bridge frame,
    // so a retry of the same valid question produces one transition and one
    // terminal result (FIX-013 S1).
    const operationId = deriveOperationId({ sessionId: q.sessionId, questionKey: q.questionKey })

    // Persist the governed slot before opening or delivering it. A lifecycle
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
        return this._toolResult(this._composeTextResult(`candice.ask_user: ${reason}; ask the same question in Claude normally`, true))
      }
      marked = true
    }

    const slotOpen = this.registry.open({ sessionId: q.sessionId, questionKey: q.questionKey, operationId })
    if (!slotOpen.ok) {
      return this._toolResult(this._composeTextResult(`candice.ask_user: ${slotOpen.error}`, true))
    }
    q.operationId = operationId

    let delivered
    try {
      delivered = this.deliverQuestion
        ? await this.deliverQuestion(q)
        : { ok: false, code: 'no-deliverer' }
    } catch (err) {
      delivered = { ok: false, code: 'delivery-threw', error: String((err && err.message) || err) }
    }
    if (!delivered || delivered.ok !== true) {
      // The question never reached the companion surface. Release the slot and
      // fail soft — the skill asks the same question in Claude normally.
      // The deliverer's stable code (e.g. `app-missing`) surfaces in the
      // message so the skill can branch on the exact mode of unavailability.
      this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey })
      const reason = (delivered && (delivered.error || delivered.code)) || 'companion delivery failed'
      return this._toolResult(
        this._composeTextResult(`candice.ask_user: ${reason}; ask the same question in Claude normally`, true)
      )
    }

    // Wait for exactly one approved answer in the owning session (spec 13.2).
    const deadline = Date.now() + this.waitWindowMs
    let answer
    for (;;) {
      if (this.cancelledSlots.delete(`${q.sessionId}::${q.questionKey}`)) {
        return this._toolResult(this._composeTextResult('candice.ask_user: question cancelled by the companion; ask the same question in Claude normally', true))
      }
      const t = this.registry.take({ sessionId: q.sessionId, questionKey: q.questionKey })
      if (t.ok) {
        answer = t.answer
        break
      }
      if (t.code === 'not-answered') {
        if (Date.now() > deadline) {
          this._cancelSlot({ sessionId: q.sessionId, questionKey: q.questionKey })
          return this._toolResult(
            this._composeTextResult('candice.ask_user: no approved answer within the wait window; ask the same question in Claude normally', true)
          )
        }
        await this.sleep(120)
        continue
      }
      return this._toolResult(this._composeTextResult(`candice.ask_user: ${t.error}`, true))
    }

    const recorded = answer.userConfirmedTranscript === true
    if (recorded && this.lifecycle && typeof this.lifecycle.recordAnswer === 'function') {
      // Duplicate answer protection: the WS-03 manager is authoritative and
      // enforces the operation identity (FIX-013 S1). A record failure after
      // the skill saw the answer must still not double-return; the durable
      // record stays and recovery resolves it by operation id.
      try {
        await Promise.resolve(this.lifecycle.recordAnswer({
          sessionId: q.sessionId,
          questionKey: q.questionKey,
          operationId,
        }))
      } catch (err) {
        // The answer was already delivered to the skill; a record failure must
        // not destroy the answer (spec 20).
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

module.exports = { AskUserServer, SERVER_NAME, SERVER_VERSION, SUPPORTED_PROTOCOL_VERSIONS }

if (require.main === module) {
  // One MCP process creates one fresh per-launch capability token and local
  // Unix endpoint. `ready` is true only after the separately running Tauri
  // companion authenticates that exact launch; it is never an environment
  // string or a foreground-window guess.
  ;(async () => {
    const bridge = new LocalCompanionBridge()
    await bridge.start()
    new AskUserServer({ bridge }).run()
  })().catch(() => process.exit(0))
}
