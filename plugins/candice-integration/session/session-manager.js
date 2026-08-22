'use strict'

/**
 * candice-integration / session/session-manager.js
 * WS-03 session lifecycle — owned path: plugins/candice-integration/session/**
 *
 * Governs the Candice session lifecycle: begin_session / end_session / status /
 * recover. The active Claude Code session is the brain, rules, memory and source
 * of truth (Master Spec section 2). Candice never creates a second independent
 * AI conversation; this manager only tracks the lifecycle of the ONE active
 * Claude session Candice is bound to, plus the pending-question state needed for
 * crash recovery (section 20: "Candice crashes mid-question" -> recover the
 * exact pending question without re-ask or double-count).
 *
 * Invariants enforced here:
 *  - A session ID is opaque, non-empty, bounded, and is the ROUTING AUTHORITY.
 *    Nothing in this file ever routes by window (section 17).
 *  - One active session at a time per store. begin_session on an already-active
 *    session is a conflict, not a silent overwrite.
 *  - Pending-question recovery returns the exact pending question and marks it
 *    re-asked; it never increments the question counter (no double-count).
 *  - Write-through durability: every mutation is persisted immediately when a
 *    state directory is configured (sections 15/20 write-through durability).
 *
 * Pure CommonJS, zero runtime dependencies — the plugin ships on macOS and
 * Windows native paths without a package manager step (sections 12/17/27).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { registryVersion, lookup } = require('../../../packages/candice-protocol/question-registry')
const { deriveOperationId, LIMITS } = require('./lifecycle-protocol')

const MAX_SESSION_ID_LENGTH = 128
const MAX_SKILL_LENGTH = 64
const MAX_TEXT_LENGTH = 4096

const SESSION_STATUS = Object.freeze(['active', 'ended', 'recovering'])

/**
 * Durable lifecycle states recorded per pending question record. `displaying`
 * is persisted BEFORE the question is delivered; `displayed` only after the
 * app acknowledgement; `fallback-pending` after an atomic ownership transfer
 * to the Claude terminal fallback. `answered` / `cancelled` are terminal for
 * the operation. (FIX-013 section 1/3 — the state machine itself lives in
 * lifecycle-state.js; this manager records the current durable state.)
 */
const PENDING_DURABLE_STATES = Object.freeze(['displaying', 'displayed', 'fallback-pending', 'recovering'])

function isPendingDurableState(value) {
  return typeof value === 'string' && PENDING_DURABLE_STATES.includes(value)
}

function nowIso(clock) {
  return (clock || (() => new Date().toISOString()))()
}

function sanitizeSessionId(sessionId) {
  if (typeof sessionId !== 'string') return null
  const trimmed = sessionId.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_SESSION_ID_LENGTH) return null
  return trimmed
}

function sanitizeSkill(skill) {
  if (skill === undefined || skill === null) return 'unknown'
  const trimmed = String(skill).trim().slice(0, MAX_SKILL_LENGTH)
  return trimmed.length === 0 ? 'unknown' : trimmed
}

function sanitizeText(text) {
  if (typeof text !== 'string') return ''
  return text.slice(0, MAX_TEXT_LENGTH)
}

function sanitizeOperationId(operationId) {
  if (operationId === undefined || operationId === null) return null
  if (typeof operationId !== 'string') return null
  const trimmed = operationId.trim()
  if (trimmed.length === 0 || trimmed.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null
  return trimmed
}

/** The MCP validator owns the bounded-timestamp check (lifecycle-protocol). */

/**
 * Session state record (single-writer: the session manager owns every field).
 * `windowAnchor` is OPTIONAL METADATA ONLY — the app's platform adapter may
 * supply a host-window id for visual anchoring (sections 17/21/26). It is never
 * used for routing; routing is exclusively by sessionId.
 */
function createSessionRecord({ sessionId, skill, windowAnchor, clock }) {
  const startedAt = nowIso(clock)
  return {
    schemaVersion: '1.0',
    sessionId,
    skill: sanitizeSkill(skill),
    status: 'active',
    startedAt,
    lastActiveAt: startedAt,
    endedAt: null,
    windowAnchor: windowAnchor || null,
    pendingQuestion: null, // { questionKey, text, answerKind, counted, askedAt }
    questionCount: 0, // answered questions in THIS session, for accounting only
    answeredQuestionKeys: [],
    registryVersion,
  }
}

class SessionManager {
  /**
   * @param {object} opts
   * @param {string|null} opts.stateDir  directory for write-through JSON state;
   *                                    null/undefined -> in-memory only
   * @param {function} [opts.clock]      () => ISO string, injectable for tests
   */
  constructor(opts) {
    const options = opts || {}
    this.stateDir = options.stateDir || null
    this.clock = options.clock || null
    this.sessions = new Map() // sessionId -> record
    this._load()
  }

  _stateFilePath() {
    return this.stateDir ? path.join(this.stateDir, 'candice-sessions.json') : null
  }

  _load() {
    const file = this._stateFilePath()
    if (!file) return
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return // fresh start
      throw new Error(`session-manager: cannot read state file ${file}: ${err.message}`)
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`session-manager: state file ${file} is corrupt JSON: ${err.message}`)
    }
    const list = Array.isArray(parsed.sessions) ? parsed.sessions : []
    let migrated = false
    for (const record of list) {
      if (record && typeof record.sessionId === 'string' && record.sessionId.length > 0) {
        // Safe migration for pre-registry state: absent history stays empty;
        // it never becomes an unvalidated arbitrary object.
        if (!Array.isArray(record.answeredQuestionKeys)) record.answeredQuestionKeys = []
        record.answeredQuestionKeys = [...new Set(record.answeredQuestionKeys.filter((k) => typeof k === 'string' && k.length > 0))]
        // A persisted pending record is an authority boundary too.  Do not
        // revive legacy/arbitrary keys after a restart merely because they
        // happened to be written before registry enforcement was introduced.
        if (record.pendingQuestion && !lookup(record.pendingQuestion.questionKey, record.skill).ok) {
          record.pendingQuestion = null
          migrated = true
        }
        // FIX-013 S1 migration: pending records written before the lifecycle
        // contract get the derived operation identity and durable state
        // `displaying` (they were persisted before/at delivery); records
        // already in a recovery handoff keep `recovering`. The bounded
        // timestamp check tolerates legacy `askedAt` (never fails the load),
        // while a malformed record still fails closed to text fallback.
        if (record.pendingQuestion && !record.pendingQuestion.operationId) {
          record.pendingQuestion.operationId = deriveOperationId({
            sessionId: record.sessionId,
            questionKey: record.pendingQuestion.questionKey,
          })
          record.pendingQuestion.durableState = record.status === 'recovering' ? 'recovering' : 'displaying'
          record.pendingQuestion.deliveredAt = record.pendingQuestion.deliveredAt || null
          record.pendingQuestion.acknowledgedAt = record.pendingQuestion.acknowledgedAt || null
          record.pendingQuestion.leaseId = record.pendingQuestion.leaseId || null
          record.pendingQuestion.leaseHeldUntil = record.pendingQuestion.leaseHeldUntil || null
          migrated = true
        }
        if (typeof record.registryVersion !== 'string') record.registryVersion = registryVersion
        this.sessions.set(record.sessionId, record)
      }
    }
    if (migrated) this._save()
  }

  _save() {
    const file = this._stateFilePath()
    if (!file) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const payload = JSON.stringify(
      { schemaVersion: '1.0', sessions: Array.from(this.sessions.values()) },
      null,
      2
    )
    // Atomic write: temp file + rename, so a crash mid-write never corrupts state.
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, payload, 'utf8')
    fs.renameSync(tmp, file)
  }

  /**
   * begin_session — opens a session record. Session identity is the routing
   * authority; the window anchor (if supplied) is recorded as metadata only.
   *
   * @returns {object} { ok:true, session } on success
   * @returns {object} { ok:false, error, code } on conflict/invalid input
   */
  beginSession({ sessionId, skill, windowAnchor }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) {
      return {
        ok: false,
        code: 'invalid-session-id',
        error: `sessionId must be a non-empty string of at most ${MAX_SESSION_ID_LENGTH} characters`,
      }
    }
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)
      if (existing.status === 'active') {
        return {
          ok: false,
          code: 'already-active',
          error: `session ${id} is already active; end it before beginning a new one`,
        }
      }
      // Re-using an ended session id: reopen it fresh (idempotent re-bind path).
    }
    const record = createSessionRecord({ sessionId: id, skill, windowAnchor, clock: this.clock })
    this.sessions.set(id, record)
    this._save()
    return { ok: true, session: record }
  }

  /**
   * end_session — closes the session, clears the window anchor, records the end
   * time. Returns the closed record so the caller can release per-session
   * resources (window tracking, temp audio) — the RELEASE decision itself is
   * the caller's (sections 16/20), this manager only records the lifecycle.
   */
  endSession({ sessionId, reason }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    const record = this.sessions.get(id)
    if (!record) return { ok: false, code: 'not-found', error: `no session ${id}` }
    if (record.status === 'ended') {
      return { ok: false, code: 'already-ended', error: `session ${id} already ended` }
    }
    record.status = 'ended'
    record.endedAt = nowIso(this.clock)
    record.windowAnchor = null
    record.pendingQuestion = null
    record.endReason = sanitizeText(reason || '')
    this._save()
    return { ok: true, session: record }
  }

  /** get_session / status — returns the live record, or null. */
  getSession(sessionId) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return null
    return this.sessions.get(id) || null
  }

  /** Session is a routing authority only while active. */
  isActive(sessionId) {
    const record = this.getSession(sessionId)
    return !!record && record.status === 'active'
  }

  listActiveSessions() {
    return Array.from(this.sessions.values()).filter((r) => r.status === 'active')
  }

  /** Crash recovery: find the active session carrying an unanswered pending question. */
  findPendingQuestion() {
    for (const record of this.sessions.values()) {
      if (record.status === 'active' && record.pendingQuestion) return record
    }
    return null
  }

  /**
   * Set the pending question — the exact governed question Candice is currently
   * asking (sections 13.2/15). The companion must preserve one governed question
   * at a time. A different question never overwrites a pending question.
   */
  setPendingQuestion({ sessionId, questionKey, text, answerKind, counted, operationId, deliveredAt }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    const record = this.sessions.get(id)
    if (!record) return { ok: false, code: 'not-found', error: `no session ${id}` }
    if (record.status !== 'active') {
      return { ok: false, code: 'session-not-active', error: `session ${id} is not active` }
    }
    if (typeof questionKey !== 'string' || questionKey.length === 0) {
      return { ok: false, code: 'invalid-question-key', error: 'questionKey is required' }
    }
    // The session's declared owning skill is the authority for direct
    // lifecycle callers.  MCP validates the complete event, while this seam
    // independently refuses unknown, retired, and cross-skill keys so no
    // caller can persist an ungoverned pending question by bypassing MCP.
    const governed = lookup(questionKey, record.skill)
    if (!governed.ok) {
      return {
        ok: false,
        code: governed.code,
        error: `questionKey ${questionKey} is not governed for skill ${record.skill}`,
      }
    }
    if (record.answeredQuestionKeys.includes(questionKey)) {
      return { ok: false, code: 'question-already-answered', error: 'question was already answered in this session' }
    }
    // The operation identity: a retry of the same (sessionId, questionKey)
    // derives the SAME operationId; a caller-supplied id must be bounded and
    // opaque. A DIFFERENT operation id for an already-pending key is refused.
    const resolvedOperationId = sanitizeOperationId(operationId) || deriveOperationId({ sessionId: id, questionKey })
    if (!resolvedOperationId) {
      return { ok: false, code: 'invalid-operation-id', error: 'operationId must be a bounded opaque id' }
    }
    if (record.pendingQuestion) {
      if (record.pendingQuestion.questionKey === questionKey) {
        if (record.pendingQuestion.operationId === resolvedOperationId) {
          return { ok: true, recovery: true, session: record }
        }
        return { ok: false, code: 'pending-operation-mismatch', error: 'a different operation id for the same pending question is refused' }
      }
      return { ok: false, code: 'pending-question-exists', error: 'another question is already pending in this session' }
    }
    const askedAt = nowIso(this.clock)
    record.pendingQuestion = {
      questionKey,
      operationId: resolvedOperationId,
      durableState: 'displaying', // persisted BEFORE delivery (FIX-013)
      text: sanitizeText(text),
      answerKind: answerKind || 'free_text',
      counted: !!counted,
      askedAt,
      deliveredAt: deliveredAt || null,
      acknowledgedAt: null,
      leaseId: null,
      leaseHeldUntil: null,
    }
    record.lastActiveAt = askedAt
    this._save()
    return { ok: true, session: record }
  }

  /**
   * Answer recorded — terminal commit: clears the pending question exactly
   * once. `counted` accounting lives with the skill; this manager only
   * mirrors the flag so recovery can prove it will not double-count (section
   * 20). The operation identity `(sessionId, questionKey, operationId)` is
   * enforced: an answer for a different operation id than the pending one is
   * refused (replayed/duplicate terminal completion fails closed).
   */
  recordAnswer({ sessionId, questionKey, operationId }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    const record = this.sessions.get(id)
    if (!record) return { ok: false, code: 'not-found', error: `no session ${id}` }
    if (!record.pendingQuestion) {
      return { ok: false, code: 'no-pending-question', error: `session ${id} has no pending question` }
    }
    if (questionKey !== undefined && record.pendingQuestion.questionKey !== questionKey) {
      return {
        ok: false,
        code: 'question-key-mismatch',
        error: `pending question is ${record.pendingQuestion.questionKey}, not ${questionKey}`,
      }
    }
    if (operationId !== undefined && operationId !== null) {
      const expected = record.pendingQuestion.operationId
      const submitted = sanitizeOperationId(operationId)
      if (!submitted || submitted !== expected) {
        return {
          ok: false,
          code: 'operation-id-mismatch',
          error: `operation id ${submitted} does not match the pending operation ${expected}`,
        }
      }
    }
    record.questionCount += 1
    record.answeredQuestionKeys.push(record.pendingQuestion.questionKey)
    record.answeredQuestionKeys = [...new Set(record.answeredQuestionKeys)]
    record.pendingQuestion = null
    record.lastActiveAt = nowIso(this.clock)
    this._save()
    return { ok: true, session: record }
  }

  /**
   * Crash recovery path (section 20). Claims a recovery LEASE on the exact
   * pending question WITHOUT deleting the record: the session moves to
   * `recovering`, the pending record stays with durableState `recovering` and
   * a `leaseId` + `heldUntil`, and only an acknowledged handoff
   * (`acknowledgeRecoveryHandoff`) may complete it. Returns null when nothing
   * is pending; a lease already held by another id and still unexpired is
   * refused (a second process cannot render or submit the same question).
   */
  recoverPendingQuestion({ sessionId, operationId, leaseId, now = Date.now() }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    const record = this.sessions.get(id)
    if (!record) return { ok: false, code: 'not-found', error: `no session ${id}` }
    if (!record.pendingQuestion) {
      return { ok: true, recovered: null, lease: null }
    }
    const pending = record.pendingQuestion
    // FIX-013: a record already owned by the terminal fallback must NEVER be
    // re-recovered after a restart (that is the duplicate re-ask defect of
    // the audit F13-03). The terminal path owns it; recordAnswer/cancel/end
    // complete it.
    if (pending.durableState === 'fallback-pending') {
      return { ok: false, code: 'fallback-owns-question', error: 'the terminal fallback owns this question; recovery cannot re-ask it' }
    }
    const expectedOperationId = pending.operationId
    if (operationId !== undefined && operationId !== null && sanitizeOperationId(operationId) !== expectedOperationId) {
      return { ok: false, code: 'operation-id-mismatch', error: 'recovery operation id does not match the pending operation' }
    }
    if (pending.leaseId) {
      const heldUntil = pending.leaseHeldUntil ? Date.parse(pending.leaseHeldUntil) : NaN
      if (!Number.isNaN(heldUntil) && heldUntil > now) {
        return {
          ok: false,
          code: 'recovery-lease-held',
          error: `recovery lease ${pending.leaseId} is still held; cannot claim a second lease`,
        }
      }
      // An expired lease is stale: the claim may be renewed by a new caller.
    }
    const leaseIdValue = sanitizeOperationId(leaseId) || `lease-${crypto.randomUUID()}`
    const heldUntil = new Date(now + LIMITS.maxLeaseMs).toISOString()
    pending.leaseId = leaseIdValue
    pending.leaseHeldUntil = heldUntil
    pending.durableState = 'recovering'
    record.status = 'recovering'
    record.lastActiveAt = nowIso(this.clock)
    this._save()
    return { ok: true, recovered: pending, lease: { leaseId: leaseIdValue, heldUntil } }
  }

  /**
   * Acknowledge the exact recovery handoff (FIX-013 S1). The app or terminal
   * fallback received the exact recovered record; only now may the pending
   * record complete/release. Same leaseId required (the acknowledging process
   * must be the lease holder); wrong lease or wrong operation fails closed and
   * the record stays in `recovering`. The session returns to `active` with no
   * pending question; `state: 'recovered'` mirrors the WS-08 recovered step.
   */
  acknowledgeRecoveryHandoff({ sessionId, operationId, leaseId }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    const record = this.sessions.get(id)
    if (!record) return { ok: false, code: 'not-found', error: `no session ${id}` }
    if (record.status !== 'recovering' || !record.pendingQuestion) {
      return { ok: false, code: 'not-recovering', error: `session ${id} has no recovery handoff to acknowledge` }
    }
    const pending = record.pendingQuestion
    if (leaseId !== undefined && pending.leaseId !== sanitizeOperationId(leaseId)) {
      return { ok: false, code: 'recovery-lease-mismatch', error: 'acknowledgement lease id does not match the claimed lease' }
    }
    if (operationId !== undefined && operationId !== null && sanitizeOperationId(operationId) !== pending.operationId) {
      return { ok: false, code: 'operation-id-mismatch', error: 'operation id does not match the pending operation' }
    }
    record.pendingQuestion = null // handed off exactly once — a second recovery finds nothing
    record.status = 'active'
    record.lastActiveAt = nowIso(this.clock)
    this._save()
    return { ok: true, session: record, state: 'recovered' }
  }

  /**
   * After recovery completes, the session returns to active with no pending
   * question. NOTE (FIX-013): recovery ownership is only complete when the
   * app or terminal fallback acknowledges the exact handoff via
   * `acknowledgeRecoveryHandoff`; this method alone must NOT be the release
   * path in the production startup sequence (it is retained for the legacy
   * contract and its tests).
   */
  resumeSession({ sessionId }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    const record = this.sessions.get(id)
    if (!record) return { ok: false, code: 'not-found', error: `no session ${id}` }
    if (record.status !== 'recovering') {
      return { ok: false, code: 'not-recovering', error: `session ${id} is not in recovering status` }
    }
    record.status = 'active'
    record.lastActiveAt = nowIso(this.clock)
    this._save()
    return { ok: true, session: record }
  }

  /**
   * Standard durable-state transition for the pending question record:
   * `displaying -> displayed` (after the delivered acknowledgement),
   * `displayed -> fallback-pending` (atomic ownership transfer on timeout/
   * cancel/disconnect; the SAME record is retained with `fallback-pending`
   * durable state, it is never deleted before the skill records the handoff),
   * or `recovering -> displayed` (after a recovery handoff is re-shown).
   * Unknown/illegal transitions fail closed without changing state.
   */
  transitionPendingDurableState({ sessionId, operationId, from, to }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    const record = this.sessions.get(id)
    if (!record) return { ok: false, code: 'not-found', error: `no session ${id}` }
    const pending = record.pendingQuestion
    if (!pending) {
      return { ok: false, code: 'no-pending-question', error: `session ${id} has no pending question` }
    }
    if (operationId !== undefined && operationId !== null
      && sanitizeOperationId(operationId) !== pending.operationId) {
      return { ok: false, code: 'operation-id-mismatch', error: 'operation id does not match the pending operation' }
    }
    if (!isPendingDurableState(from) || !isPendingDurableState(to)) {
      return { ok: false, code: 'invalid-durable-state', error: 'from/to must be one of: displaying, displayed, fallback-pending, recovering' }
    }
    const legal = {
      displaying: ['displayed', 'fallback-pending'],
      displayed: ['fallback-pending'],
      recovering: ['displayed', 'fallback-pending'],
      'fallback-pending': ['displayed'],
    }[from]
    if (!legal || !legal.includes(to)) {
      return { ok: false, code: 'illegal-durable-transition', error: `cannot transition ${from} -> ${to}` }
    }
    if (pending.durableState !== from) {
      return {
        ok: false,
        code: 'durable-state-mismatch',
        error: `pending durable state is ${pending.durableState}, not ${from}`,
      }
    }
    if (pending.durableState === 'recovering' && !pending.leaseId) {
      return { ok: false, code: 'recovery-lease-required', error: 'a recovering record must carry its lease before it may transition' }
    }
    pending.durableState = to
    if (to === 'displayed') pending.acknowledgedAt = pending.acknowledgedAt || nowIso(this.clock)
    if (to === 'fallback-pending') pending.leaseId = null
    record.lastActiveAt = nowIso(this.clock)
    this._save()
    return { ok: true, session: record, durableState: to }
  }

  /** Purge ended sessions (housekeeping). Returns the count removed. */
  purgeEnded() {
    let removed = 0
    for (const [id, record] of this.sessions.entries()) {
      if (record.status === 'ended') {
        this.sessions.delete(id)
        removed += 1
      }
    }
    if (removed > 0) this._save()
    return removed
  }
}

module.exports = { SessionManager, sanitizeSessionId, sanitizeSkill, SESSION_STATUS, createSessionRecord }
