'use strict'

/**
 * candice-integration / session/lifecycle-protocol.js
 * FIX-013 shared protocol and lifecycle contract — owned path:
 * plugins/candice-integration/session/**
 *
 * One runtime validator for the versioned lifecycle envelope
 * (packages/candice-protocol/schemas/lifecycle-event.schema.json). Both the
 * MCP/plugin process and the companion recovery lane consume this contract:
 * activation, question, delivered acknowledgement, answer, cancel, fallback,
 * reconnect, recovery lease, and lifecycle state.
 *
 * Rules:
 *   - Every event carries schemaVersion, and an unknown version fails closed
 *     (consumers reject unknown schema versions; producers never downgrade).
 *   - Every event discriminates on `event`; an unknown discriminator is
 *     refused, never treated as a best-effort message.
 *   - sessionId / operationId / questionKey / instanceId / activationId are
 *     bounded opaque or governed identifiers; malformed identities fail closed
 *     WITHOUT changing any state (validation never mutates).
 *   - Timestamps are bounded: an inbound timestamp older than
 *     LIMITS.maxAgeMs (or ahead of now + LIMITS.maxFutureSkewMs) is stale or
 *     forged and refused. A lease horizon must fall within
 *     [now, now + LIMITS.maxLeaseMs].
 *   - The event carries identity and timing only. Governed question text and
 *     answer text are never part of this envelope (they ride the FIX-011
 *     bridge frames and the question-event/answer-event schemas) and are
 *     never persisted by the lifecycle layer.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27 — no package
 * manager step on the customer machine).
 */

const LIFECYCLE_SCHEMA_VERSION = '1.0'

const EVENT_TYPES = Object.freeze([
  'activation',
  'question',
  'delivered',
  'answer',
  'cancel',
  'fallback',
  'reconnect',
  'lease',
  'lifecycle',
])

const FALLBACK_CAUSES = Object.freeze([
  'mcp-unavailable',
  'app-unavailable',
  'delivery-failure',
  'timeout',
  'user-cancel',
  'disconnect',
  'recovery-failure',
])

const LIFECYCLE_STATES = Object.freeze([
  'active',
  'displaying',
  'displayed',
  'recovering',
  'fallback-pending',
  'answered',
  'cancelled',
  'ended',
  'connected',
  'disconnected',
  'reconnecting',
  'recovered',
])

const DURABLE_STATES = Object.freeze([
  'active',
  'displaying',
  'displayed',
  'recovering',
  'fallback-pending',
  'answered',
  'cancelled',
  'ended',
])

const OPAQUE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
const SESSION_ID_RE = /^[\x21-\x7e]{1,128}$/
const QUESTION_KEY_RE = /^[A-Z][A-Z0-9_-]*$/

/**
 * Temporal bounds applied to every durable timestamp and lease horizon.
 * Clock skew + retention: an inbound event older than maxAgeMs is stale;
 * one ahead of now + maxFutureSkewMs is untrusted. A lease longer than
 * maxLeaseMs must be refused (a recovery lease is always bounded).
 */
const LIMITS = Object.freeze({
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days: nothing legitimate is older
  maxFutureSkewMs: 5 * 60 * 1000, // 5 minutes of local clock skew
  maxLeaseMs: 5 * 60 * 1000, // one recovery lease horizon
})

/**
 * Deterministic default operation id for `(sessionId, questionKey)`.
 * Shared by the session manager and the MCP ask_user path so the same
 * question operation always gets ONE identity even when the caller does not
 * supply one, and a retry of the same (sessionId, questionKey, operationId)
 * produces one transition and one terminal result.
 */
function deriveOperationId({ sessionId, questionKey }) {
  if (typeof sessionId !== 'string' || typeof questionKey !== 'string') return null
  const crypto = require('crypto')
  const digest = crypto.createHash('sha256').update(`${sessionId}\x00${questionKey}`).digest('hex')
  return `op-${digest.slice(0, 24)}`
}

/** True when the string is a valid bounded opaque operation/instance/lease id. */
function isValidOperationId(value) {
  return typeof value === 'string' && OPAQUE_ID_RE.test(value)
}

function isValidSessionId(value) {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

function isValidQuestionKey(value) {
  return typeof value === 'string' && QUESTION_KEY_RE.test(value)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Bounded ISO-8601 timestamp check. Returns null when valid and inside the
 * temporal window, else a fail-closed rule string.
 */
function checkBoundedIsoTime(value, { nowMs, maxAgeMs, maxFutureSkewMs }) {
  if (typeof value !== 'string' || value.length === 0) return 'must be an ISO-8601 date-time string'
  const time = Date.parse(value)
  if (Number.isNaN(time)) return 'must be a parseable ISO-8601 date-time string'
  if (time > nowMs + maxFutureSkewMs) return 'timestamp is too far in the future (skew window exceeded)'
  if (time < nowMs - maxAgeMs) return 'timestamp is stale (beyond the retention window)'
  return null
}

/**
 * validateLifecycleEvent — runtime gate for one lifecycle envelope.
 *
 * @param {unknown} event candidate lifecycle event
 * @param {object} [opts]
 * @param {number} [opts.nowMs]        now in epoch ms (injectable for tests)
 * @param {object} [opts.limits]       overrides of LIMITS
 * @returns {{ok:true, event:object}|{ok:false, code, field, rule}}
 *
 * Fail closed: any malformed, stale, wrong-session, wrong-key, wrong-token,
 * replayed, or unknown-version message returns ok:false and no state changes
 * anywhere (validation is pure — it never mutates the caller).
 */
function validateLifecycleEvent(event, opts) {
  const options = opts || {}
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now()
  const limits = Object.assign({}, LIMITS, options.limits || {})

  if (!isPlainObject(event)) return bad('event', 'must be an object')
  if (event.schemaVersion !== LIFECYCLE_SCHEMA_VERSION) {
    return bad('schemaVersion', `must be the string "${LIFECYCLE_SCHEMA_VERSION}"; unknown versions fail closed`)
  }
  if (!EVENT_TYPES.includes(event.event)) {
    return bad('event', `unknown lifecycle discriminator; must be one of ${EVENT_TYPES.join(', ')}`)
  }
  if (!isValidSessionId(event.sessionId)) {
    return bad('sessionId', 'must be a 1..128 char printable string (routing authority)')
  }
  // Wrong-session is a hard fail here only when the expected session is
  // supplied; the CALLER owns the expected identity comparison (FIX-010
  // activation identity is consumed, never re-created by this layer).
  if (options.expectedSessionId !== undefined && options.expectedSessionId !== null
    && event.sessionId !== options.expectedSessionId) {
    return bad('sessionId', 'does not match the expected session (wrong-session refused)')
  }

  const t = checkBoundedIsoTime(event.at, { nowMs, maxAgeMs: limits.maxAgeMs, maxFutureSkewMs: limits.maxFutureSkewMs })

  switch (event.event) {
    case 'activation':
      if (!isValidOperationId(event.activationId)) {
        return bad('activationId', 'must be a bounded opaque id')
      }
      if (!isBoundedIso(event.activationIssuedAt, nowMs, limits)) {
        return bad('activationIssuedAt', 'must be an ISO-8601 date-time within the temporal window')
      }
      return pass(event)
    case 'question':
      // The one durable operation id for (sessionId, questionKey) is derived
      // deterministically when absent: a retry of the same question arrives
      // with the same operation identity (one transition, one terminal
      // result). A caller-supplied id must itself be bounded/opaque.
      if (!isBoundedIso(event.askedAt, nowMs, limits)) return bad('askedAt', 'bounded timestamp required')
      if (!isValidQuestionKey(event.questionKey)) return bad('questionKey', 'must match ^[A-Z][A-Z0-9_-]*$')
      if (event.operationId === undefined) {
        const derived = deriveOperationId({ sessionId: event.sessionId, questionKey: event.questionKey })
        if (!derived) return bad('operationId', 'cannot derive a bounded operation id')
        return pass(Object.assign({}, event, { operationId: derived }))
      }
      if (!isValidOperationId(event.operationId)) return bad('operationId', 'must be a bounded opaque operation id')
      return pass(event)
    case 'delivered':
    case 'answer':
    case 'cancel':
      if (!isValidOperationId(event.operationId)) return bad('operationId', 'must be a bounded opaque operation id')
      if (!isValidQuestionKey(event.questionKey)) return bad('questionKey', 'must match ^[A-Z][A-Z0-9_-]*$')
      if (t) return bad('at', t)
      return pass(event)
    case 'fallback':
      if (!isValidOperationId(event.operationId)) return bad('operationId', 'must be a bounded opaque operation id')
      if (!isValidQuestionKey(event.questionKey)) return bad('questionKey', 'must match ^[A-Z][A-Z0-9_-]*$')
      if (!FALLBACK_CAUSES.includes(event.cause)) {
        return bad('cause', `must be one of ${FALLBACK_CAUSES.join(', ')}`)
      }
      if (t) return bad('at', t)
      return pass(event)
    case 'reconnect':
      if (!isValidOperationId(event.operationId)) return bad('operationId', 'must be a bounded opaque operation id')
      if (!isValidOperationId(event.instanceId)) return bad('instanceId', 'must be a bounded opaque instance id')
      if (t) return bad('at', t)
      return pass(event)
    case 'lease':
      if (!isValidOperationId(event.operationId)) return bad('operationId', 'must be a bounded opaque operation id')
      if (!isValidOperationId(event.leaseId)) return bad('leaseId', 'must be a bounded opaque lease id')
      if (!isValidQuestionKey(event.questionKey)) return bad('questionKey', 'must match ^[A-Z][A-Z0-9_-]*$')
      if (!isBoundedIso(event.heldUntil, nowMs, limits)) {
        return bad('heldUntil', 'lease horizon must be an ISO-8601 date-time within the temporal window')
      }
      if (!isBoundedLease(event.heldUntil, nowMs, limits)) {
        return bad('heldUntil', 'lease horizon exceeds the maximum lease length')
      }
      return pass(event)
    case 'lifecycle':
      if (!LIFECYCLE_STATES.includes(event.state)) {
        return bad('state', `unknown lifecycle state; must be one of ${LIFECYCLE_STATES.join(', ')}`)
      }
      if (event.operationId !== undefined && !isValidOperationId(event.operationId)) {
        return bad('operationId', 'must be a bounded opaque operation id')
      }
      if (t) return bad('at', t)
      return pass(event)
    default:
      return bad('event', 'unreachable — discriminator already checked')
  }
}

function isBoundedIso(value, nowMs, limits) {
  return checkBoundedIsoTime(value, { nowMs, maxAgeMs: limits.maxAgeMs, maxFutureSkewMs: limits.maxFutureSkewMs }) === null
}

function isBoundedIso(value, nowMs, limits) {
  return checkBoundedIsoTime(value, { nowMs, maxAgeMs: limits.maxAgeMs, maxFutureSkewMs: limits.maxFutureSkewMs }) === null
}

function isBoundedLease(value, nowMs, limits) {
  const time = Date.parse(value)
  if (Number.isNaN(time)) return false
  return time <= nowMs + limits.maxLeaseMs
}

function bad(field, rule) {
  return { ok: false, code: 'invalid-lifecycle-event', field, rule }
}

function pass(event) {
  return { ok: true, event }
}

module.exports = {
  LIFECYCLE_SCHEMA_VERSION,
  EVENT_TYPES,
  FALLBACK_CAUSES,
  LIFECYCLE_STATES,
  DURABLE_STATES,
  LIMITS,
  deriveOperationId,
  isValidOperationId,
  isValidSessionId,
  isValidQuestionKey,
  checkBoundedIsoTime,
  validateLifecycleEvent,
}
