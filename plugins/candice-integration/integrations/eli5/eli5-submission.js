'use strict'

/**
 * candice-integration / integrations/eli5/eli5-submission.js
 * WS-38 ELI5 Candice integration — owned path: plugins/candice-integration/integrations/eli5/**
 *
 * The compact-companion /eli5 submission path (Master Spec 13.3, 16; E.1
 * WS-38: "ELI5 integration is minimal; activatable from compact Candice; no
 * rule changes").
 *
 * What this module does:
 *   - normalizes what the user typed or spoke into the exact slash command
 *     text that gets submitted to the owning Claude session. ELI5's own
 *     documented switch (`.claude/skills/eli5/SKILL.md`: `/eli5 easy|chill|quick`)
 *     is preserved — the level argument is the skill's surface, never invented
 *     here;
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
 *   - never touches `.claude/skills/eli5/**` — ELI5's rules, levels, and
 *     license stay the authority (spec 25: minimum instructions only; spec 2:
 *     Candice never modifies skill rules);
 *   - never submits when the exact session target cannot be proven
 *     (spec 17/20: injection fallback disables itself);
 *   - never renames the slash command (spec 13.1);
 *   - stores no answer text, no audio, no secrets (spec 8/13.2).
 *
 * The ELI5 skill has no governed questions — /eli5 re-explains in simpler
 * language. This lane adds only the surface that lets compact Candice forward
 * the user's own command (and, when the user gave one, the skill's own level
 * argument) to the same session. No question order, ceiling, or count exists
 * here to modify.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27).
 */

const { TerminalInputAdapter } = require('../../fallback/terminal-input-adapter')

// The canonical slash command. Slash names are NOT renamed (spec 13.1).
const ELI5_COMMAND = '/eli5'
// The skill's own documented switch arguments (eli5 SKILL.md: "Switch:
// /eli5 easy|chill|quick"). Preserved verbatim — lowercased only for the
// canonical submission text, never reinterpreted.
const ELI5_LEVELS = ['easy', 'chill', 'quick']
// "/eli5" + space + longest level ("chill"/"quick" = 5) + slack
const MAX_COMMAND_LENGTH = 32
const SESSION_ID_RE = /^[\x21-\x7e]{1,128}$/ // same contract as WS-03 bridge

function validSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId)
}

/**
 * normalizeEli5Command — map what the user typed/spoke to the exact submission
 * text. Accepts "/eli5" and the spoken word "eli5", optionally followed by one
 * of the skill's own level arguments (easy|chill|quick) exactly as documented
 * in the ELI5 SKILL.md switch. Anything else is refused: the module never
 * invents a command or an argument the user did not give.
 */
function normalizeEli5Command(text) {
  if (typeof text !== 'string') {
    return { ok: false, code: 'invalid-input', error: 'text must be a string' }
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { ok: false, code: 'empty-command', error: 'empty command' }
  }
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return { ok: false, code: 'command-too-long', error: `command exceeds ${MAX_COMMAND_LENGTH} characters` }
  }
  const parts = trimmed.split(/\s+/)
  const spoken = parts[0].toLowerCase() === 'eli5'
  const slashed = parts[0].toLowerCase() === '/eli5'
  if (!spoken && !slashed) {
    return {
      ok: false,
      code: 'not-an-eli5-command',
      error: 'only the /eli5 command (with an optional skill level) can be submitted from compact Candice',
    }
  }
  if (parts.length === 1) {
    return { ok: true, text: ELI5_COMMAND, normalized: spoken ? 'spoken' : 'typed' }
  }
  if (parts.length === 2) {
    const level = parts[1].toLowerCase()
    if (ELI5_LEVELS.indexOf(level) !== -1) {
      return {
        ok: true,
        text: `${ELI5_COMMAND} ${level}`,
        normalized: spoken ? 'spoken' : 'typed',
        level,
      }
    }
    return {
      ok: false,
      code: 'unknown-level',
      error: `unknown level "${parts[1]}"; ELI5 levels are easy, chill, quick`,
    }
  }
  return {
    ok: false,
    code: 'too-many-arguments',
    error: 'one optional level argument at most (easy|chill|quick)',
  }
}

class Eli5Submission {
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
    const norm = normalizeEli5Command(text)
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
      skill: 'eli5',
      integrationVersion: '1.0.0',
      slashCommand: ELI5_COMMAND,
      levels: ELI5_LEVELS.slice(),
      submissionPath: 'same-session-terminal-input-adapter',
      ruleChanges: false, // this lane never modifies ELI5 skill rules (spec 2)
    }
  }
}

module.exports = { Eli5Submission, normalizeEli5Command, validSessionId, ELI5_COMMAND, ELI5_LEVELS }
