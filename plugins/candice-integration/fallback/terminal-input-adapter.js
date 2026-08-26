'use strict'

/**
 * candice-integration / fallback/terminal-input-adapter.js
 * WS-05 terminal input adapter — owned path: plugins/candice-integration/fallback/**
 *
 * Master Spec 13.3 (same-session free conversation) + 17 (window binding):
 * the fallback delivers the question to the exact Claude input surface of the
 * EXACT session that owns it, and never to "the window". When the exact
 * session target cannot be proven, the adapter refuse routes (spec 17:
 * "injection fallback disables itself when exact target proof is unavailable";
 * spec 20: "session mismatch — refuse to inject text").
 *
 * This adapter is the decision layer. It is not a terminal-emulator keystroke
 * injector: OS-level injection is platform-owned (macOS src-tauri binding
 * layer / Windows Win32), so this module works with injected input handlers
 * (test doubles and real platform adapters) behind one tiny seam:
 * `handlers.submit(text)`.
 *
 * Rules enforced here (spec 13.3 injection list):
 *   - inject only text the user explicitly typed/spoke (never synthesized
 *     prompts, never hidden text),
 *   - queue while Claude is busy,
 *   - submit only when the session is at a safe input point ("ready"),
 *   - never inject into a different terminal/window (session is the authority),
 *   - never send hidden prompts — submitText shows the queued payload to the
 *     caller (the UI would display it) before submit,
 *   - refusal is the default when the target is unproven.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27).
 */

const SESSION_ID_RE = /^[\x21-\x7e]{1,128}$/ // same contract as WS-03 bridge/binding-bridge.js
const MAX_QUEUE = 32
const MAX_TEXT_LENGTH = 4096

function validSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId)
}

class TerminalInputAdapter {
  /**
   * @param {object} opts
   * @param {object|null} [opts.route]      WS-03 bridge-compatible resolver with
   *   resolveRoute({ sessionId, windowId }) — the routing authority.
   * @param {object|null} [opts.sessionBusy] optional fn(sessionId) => boolean —
   *   true when Claude is busy; when provided and busy, submit queues.
   * @param {object|null} [opts.handlers]   { submit(text) } — the injector.
   *   Absent => dry-run mode: the adapter validates and queues but never
   *   injects (used by tests and by "show what will be submitted" preflight).
   */
  constructor(opts) {
    const options = opts || {}
    this.route = options.route || null
    this.sessionBusy = typeof options.sessionBusy === 'function' ? options.sessionBusy : null
    this.handlers = options.handlers || null
    this.queued = [] // { sessionId, text, at }
  }

  /**
   * submitText — deliver a piece of user-authored text to the owning session.
   * Returns the delivery decision; never throws. When the exact session cannot
   * be proven the adapter refuses (spec 17), and the caller falls back to
   * "Answer in Claude instead" / direct terminal input (spec 20).
   */
  submitText({ sessionId, text, windowId }) {
    const id = this._resolve(sessionId, windowId)
    if (!id.ok) return id
    const clean = this._sanitizeText(text)
    if (clean === null) {
      return { ok: false, code: 'invalid-text', error: 'text must be a non-empty string' }
    }
    if (this._isBusy(id.routeTo)) {
      // Claude is busy: queue and surface the "not yet" state (spec 13.3).
      if (this.queued.length >= MAX_QUEUE) {
        return { ok: false, code: 'queue-full', error: `queue is full (${MAX_QUEUE} pending)` }
      }
      this.queued.push({ sessionId: id.routeTo, text: clean, at: new Date().toISOString() })
      return {
        ok: true,
        queued: true,
        routeTo: id.routeTo,
        text: clean,
        note: 'Claude is working. I’ll send that as soon as it’s ready.',
      }
    }
    if (this.handlers && typeof this.handlers.submit === 'function') {
      this.handlers.submit(clean) // the exact injector for the exact session
    }
    return { ok: true, queued: false, routeTo: id.routeTo, text: clean }
  }

  /**
   * flush — submit queued texts for a session in order, once it is safe.
   * Returns how many were submitted. Never injects while busy.
   */
  flush(sessionId) {
    if (!validSessionId(sessionId) || this._isBusy(sessionId)) return 0
    const mine = this.queued.filter((q) => q.sessionId === sessionId)
    if (mine.length === 0) return 0
    this.queued = this.queued.filter((q) => q.sessionId !== sessionId)
    if (this.handlers && typeof this.handlers.submit === 'function') {
      for (const item of mine) this.handlers.submit(item.text)
    }
    return mine.length
  }

  /** pendingCount — how many texts are queued for the session (UI badge). */
  pendingCount(sessionId) {
    if (!validSessionId(sessionId)) return 0
    return this.queued.filter((q) => q.sessionId === sessionId).length
  }

  /** dropQueued — the user changed their mind before submission. */
  dropQueued(sessionId) {
    if (!validSessionId(sessionId)) return 0
    const before = this.queued.length
    this.queued = this.queued.filter((q) => q.sessionId !== sessionId)
    return before - this.queued.length
  }

  /**
   * _resolve — routing authority. Refuses (never injects, never guesses) when:
   *   - session id invalid (spec 17: session must be provable),
   *   - the route resolver is absent and a window was offered as the only
   *     evidence,
   *   - resolver returns unproven/ambiguous/inactive (spec 20 session-mismatch).
   */
  _resolve(sessionId, windowId) {
    if (!validSessionId(sessionId)) {
      return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    }
    if (!this.route || typeof this.route.resolveRoute !== 'function') {
      if (windowId !== undefined && windowId !== null && windowId !== '') {
        return {
          ok: false,
          code: 'unproven-session',
          error: 'no route resolver; a window alone is never routing evidence (spec 17)',
        }
      }
      // No resolver, no window evidence: the caller-provided session id is the
      // only claim. Keep refuse-safe: dry-run still requires the owning session
      // to be the argument, but without a resolver we cannot prove it — refuse.
      return {
        ok: false,
        code: 'unproven-session',
        error: 'no route resolver; cannot prove the exact session target (spec 17)',
      }
    }
    const resolved = this.route.resolveRoute({ sessionId, windowId })
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.code === 'invalid-session-id' ? 'invalid-session-id' : 'route-refused',
        error: resolved.error || `route refused (${resolved.code})`,
      }
    }
    return resolved
  }

  _isBusy(sessionId) {
    if (!this.sessionBusy) return false
    try {
      return !!this.sessionBusy(sessionId)
    } catch (err) {
      // A broken busy probe must fail CLOSED: queue, never inject blind.
      return true
    }
  }

  _sanitizeText(text) {
    if (typeof text !== 'string' || text.trim().length === 0) return null
    return text.slice(0, MAX_TEXT_LENGTH)
  }
}

module.exports = { TerminalInputAdapter, validSessionId, MAX_QUEUE, MAX_TEXT_LENGTH }
