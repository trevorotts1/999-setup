'use strict'

/**
 * candice-integration / fallback/fallback-coordinator.js
 * WS-05 fallback adapter — owned path: plugins/candice-integration/fallback/**
 *
 * Master Spec 5.1, 13.2, 13.3, 20, 27 — the "Answer in Claude instead" path:
 *
 *   - When the MCP bridge/companion is unavailable, the question is asked
 *     normally in Claude (13.2: "the tool must fail soft and instruct the skill
 *     to ask the same question in Claude normally").
 *   - The same question falls back WITHOUT losing state and WITHOUT counting
 *     the question twice (5.1). The answer arrives through the normal session
 *     input; the question is counted exactly once (inputMode 'terminal',
 *     answer-event schema).
 *   - Same-session identity: the fallback routes to the owning session only
 *     (WS-03 bridge is the routing authority; a window is never authority).
 *
 * FIX-013 S3 — durable fallback handoff:
 *
 *   - ONE method, `fallbackQuestion(question, cause, operationId)`, serves
 *     EVERY fallback cause (mcp-unavailable, app-unavailable,
 *     delivery-failure, timeout, user-cancel, disconnect, recovery-failure).
 *     The original validated question, session, key, counted flag and
 *     operation id are passed through untouched.
 *   - The handoff is DURABLE through the WS-03 lifecycle: if the pending
 *     record exists (displaying/displayed) it is atomically transferred to
 *     `fallback-pending` via transitionPendingDurableState; if the MCP path
 *     failed before persisting, the record is created directly at
 *     `fallback-pending` (one commit, never a window in which a restart could
 *     re-render a question the terminal surface already owns). A record in
 *     `recovering` refuses (recovery owns the question). A record already
 *     `fallback-pending` is a REDELIVERY: one slot, one answer, no second
 *     count.
 *   - `answerFromTerminal` completes ONE terminal commit through
 *     lifecycle.recordFallbackAnswer (operation identity enforced; requires
 *     the durableState `fallback-pending` so an answer can never complete a
 *     record still owned by the MCP/app path). The record is cleared in that
 *     one durable commit — double-count protection is durable through the
 *     terminal transaction, never memory-only. Without a lifecycle (legacy
 *     standalone consumers/tests) the memory guard semantics are unchanged.
 *
 * This module stores NO answer text and logs NO payloads: only
 * (sessionId, questionKey) bookkeeping (spec 13.2 "do not save a duplicate
 * answer store inside Candice"; spec 9 local-profile privacy). It is an
 * orchestrator over the DoubleCountGuard + TerminalInputAdapter seams.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27).
 */

const { DoubleCountGuard } = require('./double-count-guard')
const { TerminalInputAdapter } = require('./terminal-input-adapter')
const { validateQuestionEvent } = require('../mcp/ask-user/validate')
const { FALLBACK_CAUSES, isValidOperationId, deriveOperationId } = require('../session/lifecycle-protocol')

class FallbackCoordinator {
  /**
   * @param {object} opts
   * @param {object} [opts.guard]         DoubleCountGuard (created if absent)
   * @param {object} [opts.guardOpts]     opts for the guard when one is created
   * @param {object} [opts.adapter]       TerminalInputAdapter (created if absent)
   * @param {object} [opts.adapterOpts]   opts for the adapter when one is created
   * @param {object} [opts.lifecycle]     WS-03 SessionLifecycle-compatible
   *   durable lifecycle (getPendingOperation, setPendingQuestion,
   *   transitionPendingDurableState, recordFallbackAnswer). Present => the
   *   durable path below is authoritative; absent => memory-only legacy mode.
   */
  constructor(opts) {
    const options = opts || {}
    this.guard = options.guard || new DoubleCountGuard(options.guardOpts)
    this.adapter = options.adapter || new TerminalInputAdapter(options.adapterOpts)
    this.lifecycle = options.lifecycle || null
  }

  /**
   * _claimFallbackDurable — OWN the operation for the terminal fallback. The
   * durable record is the authority; the memory guard is same-process
   * bookkeeping only. Returns { ok, redelivered, state, durableCommitOk } or
   * a fail-closed result.
   */
  _claimFallbackDurable(q, operationId) {
    const lifecycle = this.lifecycle
    const identity = {
      sessionId: q.sessionId,
      questionKey: q.questionKey,
      operationId: operationId || deriveOperationId({ sessionId: q.sessionId, questionKey: q.questionKey }),
    }
    if (!isValidOperationId(identity.operationId)) {
      return { ok: false, code: 'invalid-operation-id', error: 'operationId must be a bounded opaque id' }
    }
    const got = lifecycle.getPendingOperation({ sessionId: q.sessionId })
    if (got.ok) {
      const pending = got.pending
      if (pending.questionKey !== q.questionKey) {
        return { ok: false, code: 'pending-question-exists', error: `another question (${pending.questionKey}) is already pending in this session` }
      }
      if (pending.operationId !== identity.operationId) {
        return { ok: false, code: 'pending-operation-mismatch', error: 'a different operation id for the same pending question is refused' }
      }
      if (pending.durableState === 'recovering') {
        return { ok: false, code: 'recovery-owns-question', error: 'the question is under a recovery lease; the terminal fallback cannot claim it' }
      }
      if (pending.durableState === 'fallback-pending') {
        // Same operation, terminal already owns it: one slot, one answer.
        return { ok: true, redelivered: true, state: 'fallback-pending', durableCommitOk: true }
      }
      // displaying / displayed -> atomic ownership transfer to the terminal.
      const t = lifecycle.transitionPendingDurableState({
        sessionId: q.sessionId,
        operationId: pending.operationId,
        from: pending.durableState,
        to: 'fallback-pending',
      })
      if (!t.ok) return t
      return { ok: true, redelivered: false, state: 'fallback-pending', durableCommitOk: t.durableCommitOk !== false }
    }
    if (got.code !== 'no-pending-question' && got.code !== 'not-found') return got
    if (q.skill !== undefined && typeof lifecycle.beginSession === 'function') {
      const begin = lifecycle.beginSession({ sessionId: q.sessionId, skill: q.skill })
      // 'already-active' is the idempotent same-session case — not a failure.
      if (!begin.ok && begin.code !== 'already-active') {
        return { ok: false, code: begin.code || 'session-not-active', error: begin.error || 'cannot open the session for the fallback claim' }
      }
    }
    if (typeof lifecycle.setPendingQuestion !== 'function') {
      return { ok: false, code: 'lifecycle-unavailable', error: 'the lifecycle cannot persist a fallback claim' }
    }
    // No prior durability record: the MCP path failed before persisting.
    // Create it directly at fallback-pending — one commit, never a window in
    // which a restart could re-render a question the terminal owns.
    const s = lifecycle.setPendingQuestion({
      sessionId: q.sessionId,
      questionKey: q.questionKey,
      text: q.text,
      answerKind: q.answerKind,
      counted: q.counted,
      operationId: identity.operationId,
      durableState: 'fallback-pending',
    })
    if (!s.ok) return s
    return { ok: true, redelivered: false, state: 'fallback-pending', durableCommitOk: s.durableCommitOk !== false }
  }

  /**
   * fallbackQuestion — every MCP/companion fallback cause funnels here:
   * `fallbackQuestion(question, cause, operationId)`. Hand this question to
   * the terminal/Claude surface. Returns the prompt payload the skill should
   * show as a normal Claude question plus the deferral decision.
   *
   * `cause` comes from the shared protocol's FALLBACK_CAUSES set and is
   * required when the caller names one; absent defaults to 'mcp-unavailable'
   * (legacy standalone callers).
   */
  fallbackQuestion(question, cause, operationId) {
    const q = question || {}
    if (!q.sessionId || !q.questionKey || !q.text) {
      return {
        ok: false,
        code: 'invalid-question',
        error: 'fallbackQuestion requires { sessionId, questionKey, text }',
      }
    }
    // Fallback is a delivery surface, never a second prompt-authoring path.
    // Require the shared canonical event before it can create terminal state;
    // this closes the direct-call bypass around the MCP validation boundary.
    const governed = validateQuestionEvent(q)
    if (!governed.ok) {
      return {
        ok: false,
        // Preserve the named registry authority reason when present, while
        // retaining generic invalid-question for malformed event shapes.
        code: governed.rule || governed.code,
        error: `fallback refuses an ungoverned question event${governed.field ? ` (${governed.field})` : ''}`,
      }
    }
    const causeValue = cause === undefined ? 'mcp-unavailable' : cause
    if (!FALLBACK_CAUSES.includes(causeValue)) {
      return { ok: false, code: 'invalid-cause', error: `cause must be one of ${FALLBACK_CAUSES.join(', ')}` }
    }
    // Durable claim FIRST — the terminal owns the question before the prompt
    // is shown, so no restart can re-render or re-count it.
    let durable = { ok: true, redelivered: false, state: null, durableCommitOk: true }
    if (this.lifecycle && typeof this.lifecycle.getPendingOperation === 'function') {
      durable = this._claimFallbackDurable(q, operationId)
      if (!durable.ok) {
        return { ok: false, code: durable.code, error: durable.error }
      }
    }
    const defer = this.guard.deferToTerminal({
      sessionId: q.sessionId,
      questionKey: q.questionKey,
      counted: q.counted,
    })
    if (!defer.ok) {
      return { ok: false, code: defer.code, error: defer.error }
    }
    // The prompt IS the normal Claude question — same text, same key, same
    // session. Nothing is silently renumbered or reworded (spec 14: the same
    // question; spec 15: Spec Protocol remains the authority).
    return {
      ok: true,
      redelivered: !!durable.redelivered || !!defer.redelivered,
      counted: !!q.counted,
      cause: causeValue,
      durableState: durable.state,
      durableCommitOk: durable.durableCommitOk !== false,
      // Skill-side instruction: ask the same question in Claude normally.
      prompt: {
        text: q.text,
        helpText: q.helpText || null,
        // 'terminal' allowed only when the question's contract permits it;
        // the skill remains the validator of answerKind.
        allowedInputModes: q.allowedInputModes || ['voice', 'typed', 'terminal'],
      },
      // Guard state for diagnostics — never the answer.
      guardStatus: this.guard.status().filter(
        (r) => r.sessionId === q.sessionId && r.questionKey === q.questionKey
      ),
    }
  }

  /**
   * answerFromTerminal — the answer came back through the normal Claude input
   * in the same session. Records it exactly once. Returns the answer-event
   * shaped payload the skill's normal answer path consumes (answer-event
   * schema: schemaVersion 1.0, sessionId, questionKey, answerText, inputMode
   * 'terminal', userConfirmedTranscript).
   *
   * With a lifecycle: ONE durable terminal commit via recordFallbackAnswer
   * (requires durableState fallback-pending; clears the record in that same
   * commit). The memory guard is updated only as same-process bookkeeping —
   * the guard's own lifecycle-driven reconcile is never run on a record the
   * durable path already completed (that would be a second count).
   * Without a lifecycle the memory guard semantics are unchanged.
   */
  answerFromTerminal({ sessionId, questionKey, answerText, userConfirmedTranscript, operationId }) {
    if (!sessionId || !questionKey || typeof answerText !== 'string' || answerText.trim().length === 0) {
      return {
        ok: false,
        code: 'invalid-answer',
        error: 'answerFromTerminal requires { sessionId, questionKey, answerText }',
      }
    }
    // ---- Durable path (FIX-013 S3): the lifecycle owns the transaction. ----
    if (this.lifecycle && typeof this.lifecycle.recordFallbackAnswer === 'function') {
      const rec = this.lifecycle.recordFallbackAnswer({ sessionId, questionKey, operationId })
      if (rec.ok && rec.durableCommitOk === false) {
        // The commit did not reach disk: exactly one recoverable record was
        // retained (the manager reverted the in-memory clear). NEVER report
        // success on an unproven durable commit — the answer must be retried
        // through the same operation identity.
        return {
          ok: false,
          code: 'durable-commit-failed',
          error: 'the terminal answer commit failed; retry the same question/session/operation',
        }
      }
      if (!rec.ok) {
        if (rec.code === 'fallback-not-owner') {
          // The MCP/app path consumed the question; terminal cannot complete it.
          return { ok: false, code: 'question-already-consumed', error: rec.error }
        }
        if (rec.code === 'no-pending-question' || rec.code === 'operation-id-mismatch') {
          // No record, OR a record completed by a previous terminal answer:
          // distinguish via the memory guard (never-deferred vs already-answered).
          if (rec.code === 'no-pending-question' &&
            (this.guard.isDeferred({ sessionId, questionKey }) || this.guard.isAnswered({ sessionId, questionKey }))) {
            return {
              ok: false,
              code: 'already-answered',
              error: `question ${questionKey} already has its one answer in session ${sessionId}`,
            }
          }
          if (rec.code === 'no-pending-question') {
            return {
              ok: false,
              code: 'never-deferred',
              error: `question ${questionKey} was not deferred to terminal in session ${sessionId}; nothing to reconcile`,
            }
          }
          return { ok: false, code: rec.code, error: rec.error }
        }
        return { ok: false, code: rec.code, error: rec.error }
      }
      // Durable commit succeeded. Memory bookkeeping only (never a second
      // lifecycle record): the guard's internal lifecycle (if any) must not
      // run, so a lifecycle-connected guard is left as-is and the durable
      // truth is authoritative.
      if (!this.guard.lifecycle) {
        this.guard.reconcileTerminalAnswer({ sessionId, questionKey })
      }
      return {
        ok: true,
        answer: {
          schemaVersion: '1.0',
          sessionId,
          questionKey,
          answerText,
          inputMode: 'terminal',
          userConfirmedTranscript: userConfirmedTranscript !== false,
          answeredAt: new Date().toISOString(),
        },
        durableCommitOk: rec.durableCommitOk !== false,
        recorded: rec.recorded !== false,
      }
    }
    // ---- Legacy memory path (no lifecycle). ----
    if (this.guard.isDeferred({ sessionId, questionKey })) {
      // Reject the terminal answer when the MCP path already consumed it:
      // the WS-03 lifecycle recordAnswer refuses, guard surfaces as consumed.
      const reconciled = this.guard.reconcileTerminalAnswer({ sessionId, questionKey })
      if (!reconciled.ok) {
        return { ok: false, code: reconciled.code, error: reconciled.error }
      }
      return {
        ok: true,
        answer: {
          schemaVersion: '1.0',
          sessionId,
          questionKey,
          answerText,
          inputMode: 'terminal',
          userConfirmedTranscript: userConfirmedTranscript !== false,
          answeredAt: new Date().toISOString(),
        },
      }
    }
    if (this.guard.isAnswered({ sessionId, questionKey })) {
      return {
        ok: false,
        code: 'already-answered',
        error: `question ${questionKey} already has its one answer in session ${sessionId}`,
      }
    }
    // The question was never deferred to terminal — the MCP path or another
    // mechanism owns it; this module refuses to fabricate a record.
    return {
      ok: false,
      code: 'never-deferred',
      error: `question ${questionKey} was not deferred to terminal in session ${sessionId}; nothing to reconcile`,
    }
  }

  /**
   * deliverToTerminal — same-session free-conversation path: submit user text
   * to the owning session through the terminal adapter (spec 13.3). Validated
   * + queued-or-submitted by the adapter; the adapter's route resolver (WS-03
   * bridge or a platform adapter) is the routing authority.
   */
  deliverToTerminal({ sessionId, text, windowId }) {
    return this.adapter.submitText({ sessionId, text, windowId })
  }

  /** status — session/question state summary, ids only, never payloads. */
  status() {
    return {
      questions: this.guard.status(),
      queued: this.adapter.queued.map((q) => ({ sessionId: q.sessionId })),
    }
  }
}

module.exports = { FallbackCoordinator }
