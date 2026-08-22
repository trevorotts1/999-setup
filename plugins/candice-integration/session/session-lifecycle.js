'use strict'

/**
 * candice-integration / session/session-lifecycle.js
 * WS-03 session lifecycle — owned path: plugins/candice-integration/session/**
 *
 * Canonical session-lifecycle façade over SessionManager + BindingBridge.
 * This is the seam the WS-04 MCP path (plugins/candice-integration/mcp/**)
 * and the WS-02 hooks (plugins/candice-integration/.claude-plugin/**) call.
 *
 * Contract (Master Spec sections 13, 14, 16, 17, 20):
 *  - begin_session: opens the session; session identity is the routing
 *    authority, never the window. Returns the canonical session handle.
 *  - end_session: closes the session and returns a per-session cleanup manifest
 *    (temp audio dir, window anchor) the caller must release. The caller —
 *    never this module — performs the actual cleanup (section 16 "release
 *    window tracking resources" and section 8 temp-audio rules).
 *  - crash recovery: recoverPendingQuestion returns the exact pending question
 *    with the counted flag, and the skill re-asks WITHOUT re-counting (section
 *    20: recover the exact pending question; no re-ask of answered questions,
 *    no double-count).
 *
 * Cross-lane contract (shared classes): MCP tool implementations and hook
 * scripts are owned by other lanes. This module is the API they consume; it
 * never writes outside plugins/candice-integration/session/**.
 *
 * Zero runtime dependencies; works on macOS and Windows native paths.
 */

const { SessionManager } = require('./session-manager')
const { BindingBridge } = require('./bridge/binding-bridge')

class SessionLifecycle {
  /**
   * @param {object} opts
   * @param {string|null} [opts.stateDir]  write-through state dir (null = in-memory)
   * @param {function} [opts.clock]        injectable clock for deterministic tests
   */
  constructor(opts) {
    const options = opts || {}
    const sessions = options.sessions instanceof SessionManager
      ? options.sessions
      : new SessionManager({ stateDir: options.stateDir || null, clock: options.clock })
    this.sessions = sessions
    this.bridge = new BindingBridge({ sessions })
  }

  /** begin_session — open a session, optionally with a visual window anchor. */
  beginSession({ sessionId, skill, windowAnchor }) {
    const result = this.sessions.beginSession({ sessionId, skill })
    if (!result.ok) return result
    if (windowAnchor) {
      // Anchor failure is metadata-only; the session itself is already open.
      this.bridge.bind({ sessionId, windowAnchor })
    }
    return {
      ok: true,
      session: result.session,
      sessionId: result.session.sessionId,
      // Routing authority note: windowAnchor is visual-only (section 17).
    }
  }

  /**
   * end_session — close the session. Returns the cleanup manifest the caller
   * must execute (temp audio cleanup, window tracking release).
   */
  endSession({ sessionId, reason }) {
    const result = this.sessions.endSession({ sessionId, reason })
    if (!result.ok) return result
    this.bridge.unbind({ sessionId })
    return {
      ok: true,
      session: result.session,
      cleanup: {
        releaseWindowAnchor: true,
        // The temp-audio cleanup path itself lives with the WS-08 state machine /
        // app; this manifest is the lifecycle contract the app consumes.
        tempAudioCleanup: 'caller-owned', // section 8: per-session temp dir cleanup
      },
    }
  }

  /** status — current lifecycle state for the session. */
  status({ sessionId }) {
    const session = this.sessions.getSession(sessionId)
    if (!session) {
      return { ok: false, code: 'not-found', error: `no session ${sessionId}` }
    }
    const binding = this.bridge.getBinding(sessionId)
    return {
      ok: true,
      status: session.status,
      sessionId: session.sessionId,
      skill: session.skill,
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      hasPendingQuestion: !!session.pendingQuestion,
      pendingQuestionKey: session.pendingQuestion ? session.pendingQuestion.questionKey : null,
      questionCount: session.questionCount,
      windowAnchor: binding ? binding.windowAnchor : null,
    }
  }

  /** route — the routing authority: resolves to the exact session, never a window. */
  route({ sessionId, windowId }) {
    return this.bridge.resolveRoute({ sessionId, windowId })
  }

  /** recoverPendingQuestion — crash recovery (section 20); claims a lease. */
  recoverPendingQuestion({ sessionId, operationId, leaseId, now }) {
    return this.sessions.recoverPendingQuestion({ sessionId, operationId, leaseId, now })
  }

  /** acknowledgeRecoveryHandoff — only the acknowledged handoff completes the
   * recovered record (FIX-013 S1). */
  acknowledgeRecoveryHandoff({ sessionId, operationId, leaseId }) {
    return this.sessions.acknowledgeRecoveryHandoff({ sessionId, operationId, leaseId })
  }

  /** resumeSession — leave recovering status back to active (legacy path). */
  resumeSession({ sessionId }) {
    return this.sessions.resumeSession({ sessionId })
  }

  /** setPendingQuestion — persist the governed pending question before delivery
   * (FIX-013: durableState 'displaying' + one derived operationId). */
  setPendingQuestion(args) {
    return this.sessions.setPendingQuestion(args)
  }

  /** recordAnswer — one terminal commit; the manager enforces the operation id. */
  recordAnswer(args) {
    return this.sessions.recordAnswer(args)
  }

  /** transitionPendingDurableState — displaying/displayed/fallback-pending arcs. */
  transitionPendingDurableState(args) {
    return this.sessions.transitionPendingDurableState(args)
  }
}

module.exports = { SessionLifecycle }
