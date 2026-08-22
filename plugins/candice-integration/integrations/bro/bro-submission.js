'use strict'

/**
 * candice-integration / integrations/bro/bro-submission.js
 * WS-39 Bro Candice integration — owned path: plugins/candice-integration/integrations/bro/**
 *
 * The compact-companion /bro submission path (Master Spec 13.3, 16; E.1
 * WS-39: "Bro integration is minimal; activatable from compact Candice; no
 * rule changes").
 *
 * What this module does:
 *   - normalizes what the user typed or spoke into the exact slash command
 *     text that gets submitted to the owning Claude session;
 *   - routes the submission through the WS-05 same-session seam
 *     (fallback/terminal-input-adapter.js) — session identity is the routing
 *     authority, never the window (Master Spec 17);
 *   - queues while Claude is busy and surfaces "Claude is working. I'll send
 *     that as soon as it's ready." (Master Spec 13.3);
 *   - fails soft in every direction (Master Spec 20): an unproven session,
 *     a missing adapter, or a non-command payload never blocks Claude and
 *     never fabricates a submission.
 *
 * What this module NEVER does:
 *   - never composes or injects text the user did not type/speak (13.3:
 *     "inject only text the user explicitly typed/spoke"; "never send hidden
 *     prompts");
 *   - never touches `.claude/skills/bro/**` — Bro's skill rules stay the
 *     authority (spec 25: minimum instructions only; spec 2: Candice never
 *     modifies skill rules);
 *   - never submits when the exact session target cannot be proven
 *     (spec 17/20: injection fallback disables itself);
 *   - stores no answer text, no audio, no secrets (spec 8/13.2).
 *
 * The Bro skill itself has no governed questions — /bro re-explains the last
 * assistant message. This lane adds only the surface that lets compact
 * Candice forward the user's own command to the same session. No question
 * order, ceiling, or count exists here to modify.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27).
 */

const { TerminalInputAdapter } = require('../../fallback/terminal-input-adapter')

// The canonical slash command. Slash names are NOT renamed (spec 13.1).
const BRO_COMMAND = '/bro'
// Voice transcription sometimes drops the leading slash. Spoken "bro" is the
// user's own word — normalizing it to /bro submits exactly what the user said.
const SESSION_ID_RE = /^[\x21-\x7e]{1,128}$/ // same contract as WS-03 bridge

function validSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId)
}

/**
 * normalizeBroCommand — map what the user typed/spoke to the exact submission
 * text. Accepts "/bro" (with or without surrounding whitespace, case
 * insensitive) and the spoken word "bro". Anything else is refused: the
 * module never invents a command the user did not give.
 */
function normalizeBroCommand(text) {
  if (typeof text !== 'string') {
    return { ok: false, code: 'invalid-input', error: 'text must be a string' }
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { ok: false, code: 'empty-command', error: 'empty command' }
  }
  // Spoken word, no slash: the user explicitly said "bro" — normalize.
  if (trimmed.toLowerCase() === 'bro') {
    return { ok: true, text: BRO_COMMAND, normalized: 'spoken' }
  }
  // The slash form: /bro, /BRO, "/bro  " — preserve the canonical spelling.
  if (trimmed.toLowerCase() === '/bro') {
    return { ok: true, text: BRO_COMMAND, normalized: 'typed' }
  }
  return {
    ok: false,
    code: 'not-a-bro-command',
    error: 'only the /bro command can be submitted from compact Candice',
  }
}

class BroSubmission {
  /**
   * @param {object} opts
   * @param {object|null} [opts.adapter] WS-05 TerminalInputAdapter-compatible
   *   seam (created from fallback/terminal-input-adapter when absent). The
   *   adapter owns the routing decision; this module only feeds it the
   *   user-authored command.
   * @param {object|null} [opts.adapterOpts] opts for the adapter when created
   */
  constructor(opts) {
    const options = opts || {}
    this.adapter = options.adapter || new TerminalInputAdapter(options.adapterOpts || {})
  }

  /**
   * submit — take the user's typed/spoken command from compact Candice and
   * deliver it to the owning session via the WS-05 same-session seam.
   * Returns the delivery decision; never throws.
   */
  submit({ sessionId, text, windowId }) {
    if (!validSessionId(sessionId)) {
      return { ok: false, code: 'invalid-session-id', error: 'invalid sessionId' }
    }
    const norm = normalizeBroCommand(text)
    if (!norm.ok) return norm
    const result = this.adapter.submitText({
      sessionId,
      text: norm.text,
      windowId,
    })
    // Surface the exact adapter decision. When the adapter is in dry-run mode
    // (no injector handler) or refuses an unproven session, the caller must
    // fall back to direct Claude input — Claude is never blocked (spec 20).
    return {
      ok: result.ok,
      code: result.code || (result.ok ? 'submitted' : 'submission-failed'),
      queued: result.queued === true,
      sessionId: result.routeTo || sessionId,
      text: norm.text,
      error: result.error || null,
      note: result.note || null,
    }
  }

  /**
   * pendingNote — the queue note the UI shows when Claude is busy.
   * Text is exactly the spec 13.3 wording; the module owns the copy so the
   * compact surface does not reword it.
   */
  pendingNote() {
    return 'Claude is working. I’ll send that as soon as it’s ready.'
  }

  /**
   * integrationInfo — version/health surface for bootstrap and updater lanes
   * (WS-31/WS-32/WS-33 read this, they never edit integration files).
   */
  integrationInfo() {
    return {
      skill: 'bro',
      integrationVersion: '1.0.0',
      slashCommand: BRO_COMMAND,
      submissionPath: 'same-session-terminal-input-adapter',
      ruleChanges: false, // this lane never modifies Bro skill rules (spec 19)
    }
  }
}

module.exports = { BroSubmission, normalizeBroCommand, validSessionId, BRO_COMMAND }
