'use strict'

/**
 * candice-integration / fallback/double-count-guard.js
 * WS-05 no-double-count guard — owned path: plugins/candice-integration/fallback/**
 *
 * Master Spec 5.1, 13.2, 20, 27:
 *   - "Answer in Claude instead": the same question falls back to the
 *     terminal/Claude input surface WITHOUT losing state or counting the
 *     question twice.
 *   - MCP bridge unavailable -> ask the question normally in Claude.
 *   - voice/typed/terminal answer paths all return exactly one answer.
 *
 * This guard is the accounting seam for the terminal path. It never stores
 * answers (spec 13.2: "Do not save a duplicate answer store inside Candice") —
 * it stores only deferral/answered bookkeeping per (sessionId, questionKey),
 * and it delegates the authoritative exactly-once record to the WS-03
 * session lifecycle (SessionManager.recordAnswer, which refuses a second
 * record for the same pending question).
 *
 * States per (sessionId, questionKey): none -> deferred -> answered.
 *   - defer: none -> deferred. A second defer of the same key is a REDELIVERY:
 *     it returns ok with redelivered:true and does not move the state, so
 *     re-showing the prompt in the terminal never opens a second reconciliation
 *     slot (that is the double-count guard).
 *   - reconcile: deferred -> answered, and calls lifecycle.recordAnswer
 *     EXACTLY ONCE for the whole lifecycle of the question.
 *   - reconcile of a question the MCP path already consumed returns
 *     question-already-consumed (the WS-03 lifecycle's recordAnswer refuses,
 *     and the guard surfaces that without inventing a second count).
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27).
 */

const SESSION_ID_RE = /^[\x21-\x7e]{1,128}$/ // matches WS-03 bridge contract: opaque printable ids

function validSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId)
}

function validQuestionKey(questionKey) {
  return typeof questionKey === 'string' && /^[A-Z][A-Z0-9_-]*$/.test(questionKey)
}

class DoubleCountGuard {
  /**
   * @param {object} opts
   * @param {object|null} [opts.lifecycle] WS-03 SessionLifecycle-compatible
   *   object exposing recordAnswer({sessionId, questionKey}). Optional: when
   *   absent, the guard is pure bookkeeping (used by tests and by callers that
   *   keep their own lifecycle).
   */
  constructor(opts) {
    const options = opts || {}
    this.lifecycle = options.lifecycle || null
    // sessionId -> questionKey -> { status:'deferred'|'answered', counted, deferredAt, reconciledAt }
    this.records = new Map()
  }

  _sessionMap(sessionId, create) {
    let m = this.records.get(sessionId)
    if (!m && create) {
      m = new Map()
      this.records.set(sessionId, m)
    }
    return m || null
  }

  /**
   * deferToTerminal — hand the question to the terminal input surface.
   * First defer moves the question into 'deferred'. A repeat defer of the same
   * key is a redelivery (ok:true, redelivered:true) — it never resets state and
   * never creates a second answer slot.
   */
  deferToTerminal({ sessionId, questionKey, counted }) {
    if (!validSessionId(sessionId)) {
      return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    }
    if (!validQuestionKey(questionKey)) {
      return { ok: false, code: 'invalid-question-key', error: 'questionKey must match ^[A-Z][A-Z0-9_-]*$' }
    }
    const sessionMap = this._sessionMap(sessionId, true)
    const existing = sessionMap.get(questionKey)
    if (existing && existing.status === 'answered') {
      return {
        ok: false,
        code: 'already-answered',
        error: `question ${questionKey} was already answered in session ${sessionId}; refusing a second answer`,
      }
    }
    if (existing && existing.status === 'deferred') {
      // Same question re-shown in terminal: state unchanged, exactly one
      // reconciliation remains (spec 5.1 no double-count).
      return { ok: true, redelivered: true, recorded: false, questionKey }
    }
    sessionMap.set(questionKey, {
      status: 'deferred',
      counted: !!counted,
      deferredAt: new Date().toISOString(),
      reconciledAt: null,
    })
    // 'answered' status can be reached via reconcileTerminalAnswer only.
    return { ok: true, redelivered: false, recorded: true, questionKey, counted: !!counted }
  }

  /**
   * reconcileTerminalAnswer — the answer arrived through the normal Claude
   * input surface (inputMode 'terminal'). Records the answer exactly once via
   * the WS-03 lifecycle, then marks the guard slot answered. Any second call
   * for the same question fails without touching the lifecycle.
   */
  reconcileTerminalAnswer({ sessionId, questionKey }) {
    if (!validSessionId(sessionId)) {
      return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    }
    if (!validQuestionKey(questionKey)) {
      return { ok: false, code: 'invalid-question-key', error: 'questionKey must match ^[A-Z][A-Z0-9_-]*$' }
    }
    const sessionMap = this._sessionMap(sessionId, false)
    const existing = sessionMap ? sessionMap.get(questionKey) : null
    if (!existing) {
      return {
        ok: false,
        code: 'never-deferred',
        error: `question ${questionKey} was never handed to the terminal for session ${sessionId}`,
      }
    }
    if (existing.status === 'answered') {
      return {
        ok: false,
        code: 'already-answered',
        error: `question ${questionKey} already has its one answer in session ${sessionId}`,
      }
    }
    if (existing.status !== 'deferred') {
      return {
        ok: false,
        code: 'never-deferred',
        error: `question ${questionKey} is in unknown state ${existing.status} for session ${sessionId}`,
      }
    }
    // Exactly-once record against the WS-03 lifecycle. It refuses a second
    // record (no-pending-question / question-key-mismatch), which is the
    // authoritative cross-path double-count proof (MCP path + terminal path).
    // The record function resolves from either facade shape: the WS-03
    // SessionLifecycle facade (no recordAnswer pass-through today) or its
    // SessionManager (recordAnswer lives there; see session/session-manager.js).
    const recordFn =
      this.lifecycle && typeof this.lifecycle.recordAnswer === 'function'
        ? (args) => this.lifecycle.recordAnswer(args)
        : this.lifecycle &&
          this.lifecycle.sessions &&
          typeof this.lifecycle.sessions.recordAnswer === 'function'
          ? (args) => this.lifecycle.sessions.recordAnswer(args)
          : null
    if (recordFn) {
      const recorded = recordFn({ sessionId, questionKey })
      if (!recorded.ok) {
        return {
          ok: false,
          code: 'question-already-consumed',
          error: `lifecycle refused the record (${recorded.code}): ${recorded.error}`,
        }
      }
    }
    existing.status = 'answered'
    existing.reconciledAt = new Date().toISOString()
    return { ok: true, questionKey, counted: existing.counted, recorded: true }
  }

  /** isAnswered — answered in this session via either path. */
  isAnswered({ sessionId, questionKey }) {
    const sessionMap = this._sessionMap(sessionId, false)
    const existing = sessionMap ? sessionMap.get(questionKey) : null
    return !!existing && existing.status === 'answered'
  }

  /** isDeferred — currently sitting in the terminal waiting for an answer. */
  isDeferred({ sessionId, questionKey }) {
    const sessionMap = this._sessionMap(sessionId, false)
    const existing = sessionMap ? sessionMap.get(questionKey) : null
    return !!existing && existing.status === 'deferred'
  }

  /** resetForSession — drop all bookkeeping for a session (session ended). */
  resetForSession(sessionId) {
    this.records.delete(sessionId)
    return true
  }

  /** Diagnostic summary — ids and states only, never answer text. */
  status() {
    const out = []
    for (const [sessionId, m] of this.records.entries()) {
      for (const [questionKey, rec] of m.entries()) {
        out.push({ sessionId, questionKey, status: rec.status, counted: rec.counted })
      }
    }
    return out
  }
}

module.exports = { DoubleCountGuard, validSessionId, validQuestionKey }
