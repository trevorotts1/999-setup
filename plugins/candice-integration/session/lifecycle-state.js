'use strict'

/**
 * candice-integration / session/lifecycle-state.js
 * FIX-013 shared protocol and lifecycle contract — owned path:
 * plugins/candice-integration/session/**
 *
 * The versioned durable operation state machine, one shared definition for
 * the operation identity `(sessionId, questionKey, operationId)`.
 *
 * Durable states (persisted): active, displaying, displayed, recovering,
 * fallback-pending, answered, cancelled, ended.
 * Live connection states (never persisted as state machine states):
 * connected, disconnected, reconnecting, recovered.
 *
 * Transition order is owned by the ONE lifecycle owner (the session manager /
 * future lifecycle service) — this module declares the legal arcs and the
 * terminal-set predicate:
 *
 *   validate activation -> begin session -> persist displaying -> deliver ->
 *   app acknowledgement -> displayed -> answer/fallback/cancel -> terminal
 *   commit -> cleanup/end.
 *
 * A transition is idempotent for the same operation identity (retry of the
 * same (sessionId, questionKey, operationId) produces one transition and one
 * terminal result) and rejects a different session, expired token, stale
 * activation, or duplicate terminal completion. Recovery claims a lease
 * without deleting the pending record; only an acknowledged handoff may
 * complete releasing the record.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27).
 */

const { DURABLE_STATES } = require('./lifecycle-protocol')

/** Which durable states are terminal for one operation: a terminal
 * completion may not be transitioned away from (duplicate terminal
 * completion is refused), and any retry of the same operation yields the
 * same terminal result. */
const TERMINAL_STATES = Object.freeze(['answered', 'cancelled', 'ended', 'fallback-pending'])

const TRANSITIONS = Object.freeze({
  active: ['displaying', 'recovering', 'ended'],
  displaying: ['displayed', 'fallback-pending', 'cancelled', 'ended'],
  displayed: ['answered', 'fallback-pending', 'cancelled', 'recovering', 'ended'],
  recovering: ['displayed', 'answered', 'fallback-pending', 'cancelled', 'ended'],
  'fallback-pending': ['answered', 'cancelled', 'ended'],
  answered: [],
  cancelled: [],
  ended: [],
})

function isDurableState(value) {
  return typeof value === 'string' && DURABLE_STATES.includes(value)
}

function isTerminalState(value) {
  return typeof value === 'string' && TERMINAL_STATES.includes(value)
}

/** Allowed next states from `from` (empty when terminal / unknown). */
function allowedTransitions(from) {
  return TRANSITIONS[from] || []
}

/** True when `to` is a legal one-step arc from `from`. Unknown states
 * transition nowhere (fail closed, never a silent overwrite). */
function canTransition(from, to) {
  if (!isDurableState(from) || !isDurableState(to)) return false
  return allowedTransitions(from).includes(to)
}

/**
 * One immutable operation identity. `operationId` is derived
 * deterministically from (sessionId, questionKey) when absent so a retry of
 * the same question always carries the same operation identity.
 */
function operationIdentity({ sessionId, questionKey, operationId }) {
  const { deriveOperationId } = require('./lifecycle-protocol')
  return Object.freeze({
    sessionId,
    questionKey,
    operationId: operationId || deriveOperationId({ sessionId, questionKey }),
  })
}

module.exports = {
  TRANSITIONS,
  TERMINAL_STATES,
  isDurableState,
  isTerminalState,
  canTransition,
  allowedTransitions,
  operationIdentity,
}
