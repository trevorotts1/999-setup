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

const MAX_SESSION_ID_LENGTH = 128
const MAX_SKILL_LENGTH = 64
const MAX_TEXT_LENGTH = 4096

const SESSION_STATUS = Object.freeze(['active', 'ended', 'recovering'])

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
    for (const record of list) {
      if (record && typeof record.sessionId === 'string' && record.sessionId.length > 0) {
        this.sessions.set(record.sessionId, record)
      }
    }
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
   * at a time; a second set overwrites the previous pending question, which is
   * by design (a skill asks exactly one question at a time).
   */
  setPendingQuestion({ sessionId, questionKey, text, answerKind, counted }) {
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
    record.pendingQuestion = {
      questionKey,
      text: sanitizeText(text),
      answerKind: answerKind || 'free_text',
      counted: !!counted,
      askedAt: nowIso(this.clock),
    }
    record.lastActiveAt = record.pendingQuestion.askedAt
    this._save()
    return { ok: true, session: record }
  }

  /**
   * Answer recorded — clears the pending question exactly once. `counted`
   * accounting lives with the skill; this manager only mirrors the flag so
   * recovery can prove it will not double-count (section 20).
   */
  recordAnswer({ sessionId, questionKey }) {
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
    record.questionCount += 1
    record.pendingQuestion = null
    record.lastActiveAt = nowIso(this.clock)
    this._save()
    return { ok: true, session: record }
  }

  /**
   * Crash recovery path (section 20). Marks the session recovering and returns
   * the exact pending question so the skill can re-ask in Claude WITHOUT
   * incrementing the question counter. Returns null when nothing is pending.
   */
  recoverPendingQuestion({ sessionId }) {
    const id = sanitizeSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    const record = this.sessions.get(id)
    if (!record) return { ok: false, code: 'not-found', error: `no session ${id}` }
    if (!record.pendingQuestion) {
      return { ok: true, recovered: null }
    }
    const pending = record.pendingQuestion
    record.pendingQuestion = null // handed off exactly once — a second recovery finds nothing
    record.status = 'recovering'
    record.lastActiveAt = nowIso(this.clock)
    this._save()
    return { ok: true, recovered: pending }
  }

  /** After recovery completes, the session returns to active with no pending question. */
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
