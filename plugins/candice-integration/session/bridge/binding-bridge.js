'use strict'

/**
 * candice-integration / session/bridge/binding-bridge.js
 * WS-03 binding bridge — owned path: plugins/candice-integration/session/**
 *
 * The binding bridge connects the Candice companion app to the active Claude
 * Code session. Master Spec section 17 is explicit and binding:
 *
 *   - the Claude SESSION ID / bridge binding is the authority for which
 *     conversation Candice belongs to;
 *   - the top-level host window is used ONLY for visual anchoring;
 *   - never assume "foreground window" means "correct Claude session";
 *   - if the exact session target cannot be proven, DISABLE injection and use
 *     the same-session MCP/bridge path or "Answer in Claude instead";
 *   - switching tabs/panes must never send a Candice answer to another session.
 *
 * This module therefore implements the bridge as a session-keyed registry with
 * an OPTIONAL window anchor. Every routing decision is made on session identity
 * alone. Window data participates only in visual anchoring (which the app's
 * platform adapter consumes) — it is never a routing input.
 *
 * The registry is opinionated toward failure: when the exact session cannot be
 * proven, every route returns { ok:false, code:'unproven-session' } and the
 * caller falls back to text-in-Claude. Section 20 (failure must never stop
 * Claude) applies to every path below.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27: no package
 * manager step required on the customer machine).
 */

const SESSION_ID_RE = /^[\x21-\x7e]{1,128}$/ // printable ASCII, bounded — opaque ids only
const { isValidOperationId } = require('../lifecycle-protocol')

/** A window anchor is optional metadata. It NEVER becomes routing authority. */
function sanitizeAnchor(anchor) {
  if (anchor === undefined || anchor === null) return null
  if (typeof anchor === 'string') {
    const trimmed = anchor.trim().slice(0, 256)
    return trimmed.length === 0 ? null : { kind: 'window-id', value: trimmed }
  }
  if (typeof anchor === 'object' && typeof anchor.kind === 'string' && typeof anchor.value === 'string') {
    const kind = anchor.kind.slice(0, 64)
    const value = anchor.value.slice(0, 256)
    return kind.length > 0 && value.length > 0 ? { kind, value } : null
  }
  return null
}

class BindingBridge {
  /**
   * @param {object} opts
   * @param {object} [opts.sessions]   SessionManager-compatible interface
   *                                   (getSession/isActive used for routing)
   */
  constructor(opts) {
    const options = opts || {}
    this.sessions = options.sessions || null
    this.bindings = new Map() // sessionId -> { sessionId, windowAnchor }
    this.targetOverrides = new Map() // sessionId -> { windowAnchor } — rebind support
  }

  _requireSessionId(sessionId) {
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return null
    return sessionId
  }

  _sessionActive(sessionId) {
    if (this.sessions) {
      return !!this.sessions.isActive(sessionId)
    }
    // No session store: the binding itself is the only authority we have.
    return this.bindings.has(sessionId)
  }

  /**
   * bind — associates a window anchor with a session for VISUAL anchoring only.
   * Returns ok:false when the session is not a live active session: binding to
   * a dead session would create an anchor without routing proof.
   * The binding carries a `boundAt` bounded timestamp and the operation id
   * (derived from the session when absent); a binding atomically created by
   * the same operation identity is idempotent (FIX-013 S1).
   */
  bind({ sessionId, windowAnchor, operationId, boundAt }) {
    const id = this._requireSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    if (!this._sessionActive(id)) {
      return { ok: false, code: 'session-not-active', error: `session ${id} is not active; cannot bind` }
    }
    if (operationId !== undefined && operationId !== null && !isValidOperationId(operationId)) {
      return { ok: false, code: 'invalid-operation-id', error: 'operationId must be a bounded opaque id' }
    }
    const anchor = sanitizeAnchor(windowAnchor)
    const resolvedOperationId = operationId || `bind-${id}`
    const now = boundAt || new Date().toISOString()
    this.bindings.set(id, { sessionId: id, windowAnchor: anchor, boundAt: now, operationId: resolvedOperationId })
    return { ok: true, binding: { sessionId: id, windowAnchor: anchor, boundAt: now, operationId: resolvedOperationId } }
  }

  /**
   * rebind — change the visual anchor for an EXISTING active session (user
   * moved the companion, terminal window moved, monitor changed). Session
   * identity never changes on rebind.
   */
  rebind({ sessionId, windowAnchor, boundAt }) {
    const id = this._requireSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    if (!this.bindings.has(id)) {
      return { ok: false, code: 'not-bound', error: `session ${id} has no binding; use bind first` }
    }
    const anchor = sanitizeAnchor(windowAnchor)
    const existing = this.bindings.get(id)
    this.bindings.set(id, {
      sessionId: id,
      windowAnchor: anchor,
      boundAt: boundAt || existing.boundAt || new Date().toISOString(),
      operationId: existing.operationId || `bind-${id}`, // rebind never changes session identity
    })
    return { ok: true, binding: { sessionId: id, windowAnchor: anchor } }
  }

  /** unbind — release the visual anchor (session ended / terminal closed). */
  unbind({ sessionId }) {
    const id = this._requireSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    if (!this.bindings.delete(id)) {
      return { ok: false, code: 'not-bound', error: `session ${id} has no binding` }
    }
    return { ok: true }
  }

  /** getBinding — read the anchor for VISUAL purposes only. */
  getBinding(sessionId) {
    const id = this._requireSessionId(sessionId)
    if (!id) return null
    const binding = this.bindings.get(id)
    return binding || null
  }

  /**
   * anchorForWindow — find the session bound to a given host-window id.
   * WARNING: this is a visual-anchor lookup, never a routing decision. A window
   * may host several sessions (Windows Terminal tabs/panes, macOS tabs) — the
   * caller must treat multiple hits as unproven and refuse to route (section 17).
   */
  anchorForWindow(windowId) {
    if (typeof windowId !== 'string' || windowId.length === 0) return []
    const hits = []
    for (const binding of this.bindings.values()) {
      if (binding.windowAnchor && binding.windowAnchor.value === windowId) hits.push(binding.sessionId)
    }
    return hits
  }

  /**
   * resolveRoute — THE routing authority. Given a candidate session, returns
   * the session identity the message must go to. It is a hard fail (unproven)
   * when:
   *   - the session id is invalid,
   *   - the session is not active,
   *   - a window is offered as routing evidence (window never routes),
   *   - the window maps to more than one session (tab/panes — ambiguous).
   * Anything else routes to the exact active session. Never to "the window".
   */
  resolveRoute({ sessionId, windowId }) {
    const id = this._requireSessionId(sessionId)
    if (!id) return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    if (!this._sessionActive(id)) {
      return { ok: false, code: 'session-not-active', error: `session ${id} is not active` }
    }
    if (windowId !== undefined && windowId !== null && windowId !== '') {
      const byWindow = this.anchorForWindow(windowId)
      if (byWindow.length === 0) {
        return {
          ok: false,
          code: 'unproven-session',
          error: `window ${windowId} is bound to no session; refusing to guess`,
        }
      }
      if (byWindow.length > 1 || !byWindow.includes(id)) {
        return {
          ok: false,
          code: 'ambiguous-window',
          error: `window ${windowId} maps to ${byWindow.length} sessions (${byWindow.join(', ')}); window is not routing authority`,
        }
      }
      // Single unambiguous window mapping that matches the session: anchor
      // confirmed, but routing still goes by session id.
    }
    return { ok: true, routeTo: id }
  }

  /** Status summary for diagnostics — never exposes secrets or payloads. */
  status() {
    const bindings = []
    for (const [sessionId, binding] of this.bindings.entries()) {
      bindings.push({
        sessionId,
        hasAnchor: !!binding.windowAnchor,
        anchorKind: binding.windowAnchor ? binding.windowAnchor.kind : null,
        active: this._sessionActive(sessionId),
      })
    }
    return { bindings }
  }
}

module.exports = { BindingBridge, SESSION_ID_RE, sanitizeAnchor }
