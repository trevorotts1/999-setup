'use strict'

/**
 * candice-integration / mcp/ask-user/answer-registry.js
 * WS-04 structured ask_user MCP path — owned path: plugins/candice-integration/mcp/**
 *
 * The answer slot registry: exactly-one-pending-answer per (sessionId,
 * questionKey). This is the accounting seam for `candice.ask_user` — the tool
 * call that delivered the question BLOCKS until exactly one answer is placed
 * into its slot, and any second answer to the same question is refused
 * (spec 13.2: "return the final approved text to the same MCP tool call in
 * the same Claude session"; spec 14: "Exactly one answer per question").
 *
 * Design rules:
 *   - NO answer text is ever stored past the single read by the owning tool
 *     call. The registry keeps only { status } plus a guarded handoff:
 *     put() stores, take() removes-and-returns. After take() the slot is gone
 *     — a second take for the same question returns not-found (the WS-41
 *     suite proves exactly-one-answer per question).
 *   - No duplicate answer store inside Candice (spec 13.2). This registry is
 *     routing bookkeeping for the in-flight tool call, not a history; the
 *     WS-03 SessionManager remains the durability record (crash recovery).
 *   - The registry is a HARD FAIL on wrong session (spec 17: "session
 *     mismatch — refuse"), never a silent re-route.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27).
 */

const { validateAnswerEvent } = require('./validate')
const { deriveOperationId, isValidOperationId } = require('../../session/lifecycle-protocol')

const MAX_WAIT_MS = 10 * 60 * 1000 // one governed question, one sitting; owner may abort

function validSessionId(sessionId) {
  return typeof sessionId === 'string' && sessionId.length >= 1 && sessionId.length <= 128
}

class AnswerSlotRegistry {
  constructor(opts) {
    const options = opts || {}
    this.clock = options.clock || (() => new Date())
    this.timer = options.timer || null // test injectable: { schedule(fn, ms), cancel(handle) }
    this.slots = new Map() // `${sessionId}::${questionKey}` -> { status, at, answer }
  }

  _key(sessionId, questionKey) {
    return `${sessionId}::${questionKey}`
  }

  /**
   * open — declare the pending answer slot for a delivered question.
   * Refuses a second open for the same (sessionId, questionKey) so a
   * delivered question has exactly one answer surface (spec 14). The slot
   * carries the operation identity `(sessionId, questionKey, operationId)`
   * with a bounded `at` timestamp (FIX-013 S1).
   */
  open({ sessionId, questionKey, operationId }) {
    if (!validSessionId(sessionId)) {
      return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    }
    if (typeof questionKey !== 'string' || !/^[A-Z][A-Z0-9_-]*$/.test(questionKey)) {
      return { ok: false, code: 'invalid-question-key', error: 'questionKey must match ^[A-Z][A-Z0-9_-]*$' }
    }
    const resolvedOperationId = operationId || deriveOperationId({ sessionId, questionKey })
    if (!isValidOperationId(resolvedOperationId)) {
      return { ok: false, code: 'invalid-operation-id', error: 'operationId must be a bounded opaque id' }
    }
    const key = this._key(sessionId, questionKey)
    if (this.slots.has(key)) {
      return {
        ok: false,
        code: 'slot-open',
        error: `question ${questionKey} already has an open answer slot in session ${sessionId}`,
      }
    }
    this.slots.set(key, { status: 'waiting', at: this.clock().toISOString(), answer: null, operationId: resolvedOperationId })
    return { ok: true }
  }

  /**
   * put — the user's approved answer for the pending question arrives from the
   * companion surface. Validated against answer-event.schema.json before
   * anything is recorded. A put for a session different from the one that
   * opened the slot is refused (spec 17 session mismatch, never re-routed);
   * the operation identity is enforced against the slot (replay of a
   * different operation fails closed).
   */
  put({ sessionId, questionKey, answer, operationId }) {
    const key = this._key(sessionId, questionKey)
    const slot = this.slots.get(key)
    if (!slot) {
      return { ok: false, code: 'no-open-slot', error: `no open answer slot for ${questionKey} in ${sessionId}` }
    }
    if (slot.status !== 'waiting') {
      return { ok: false, code: 'already-answered', error: `question ${questionKey} in ${sessionId} already answered` }
    }
    const check = validateAnswerEvent(answer)
    if (!check.ok) return check
    if (answer.sessionId !== sessionId) {
      return {
        ok: false,
        code: 'session-mismatch',
        error: `answer sessionId ${answer.sessionId} does not match the owning session ${sessionId}; refused (spec 17)`,
      }
    }
    if (answer.questionKey !== questionKey) {
      return {
        ok: false,
        code: 'question-key-mismatch',
        error: `answer questionKey ${answer.questionKey} does not match ${questionKey}`,
      }
    }
    if (operationId !== undefined && operationId !== null && operationId !== slot.operationId) {
      return {
        ok: false,
        code: 'operation-id-mismatch',
        error: 'answer operation id does not match the open slot operation id',
      }
    }
    slot.status = 'answered'
    slot.answer = check.answer
    slot.at = this.clock().toISOString()
    slot.answeredAt = slot.at
    this._armTimeout(key)
    return { ok: true }
  }

  _armTimeout(key) {
    if (!this.timer) return
    const slotted = this.slots.get(key)
    const handle = this.timer.schedule(() => {
      const s = this.slots.get(key)
      if (s && s.status === 'answered' && !s.taken) {
        this.slots.delete(key) // answer never collected: release the slot
      }
    }, MAX_WAIT_MS)
    if (slotted) slotted.timeoutHandle = handle
  }

  /**
   * take — the owning candice.ask_user call reads its answer exactly once.
   * Returns the stored answer or null when none is present (still waiting).
   */
  take({ sessionId, questionKey }) {
    const key = this._key(sessionId, questionKey)
    const slot = this.slots.get(key)
    if (!slot || slot.status !== 'answered' || slot.answer === null) {
      return { ok: false, code: 'not-answered', error: `no approved answer for ${questionKey} in ${sessionId}` }
    }
    const answer = slot.answer
    if (slot.timeoutHandle && this.timer && !slot.taken) this.timer.cancel(slot.timeoutHandle)
    this.slots.delete(key) // exactly one read (spec 14); after this the slot is gone
    return { ok: true, answer }
  }

  /** peek — diagnostic read only; never consumes. */
  peek({ sessionId, questionKey }) {
    const slot = this.slots.get(this._key(sessionId, questionKey))
    if (!slot) return { ok: false, code: 'not-found' }
    return { ok: true, status: slot.status, hasAnswer: slot.answer !== null }
  }

  /** cancel — the owning skill abandons the question: release the slot. */
  cancel({ sessionId, questionKey }) {
    const slot = this.slots.get(this._key(sessionId, questionKey))
    if (!slot) return { ok: false, code: 'not-found' }
    if (slot.timeoutHandle && this.timer && !slot.taken) this.timer.cancel(slot.timeoutHandle)
    this.slots.delete(this._key(sessionId, questionKey))
    return { ok: true }
  }

  /** count in-flight slots (diagnostics only). */
  openCount() {
    return this.slots.size
  }
}

module.exports = { AnswerSlotRegistry }
