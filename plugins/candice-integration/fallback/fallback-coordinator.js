'use strict'

/**
 * candice-integration / fallback/fallback-coordinator.js
 * WS-05 fallback adapter — owned path: plugins/candice-integration/fallback/**
 *
 * Master Spec 5.1, 13.2, 13.3, 20, 27 — the "Answer in Claude instead" path:
 *
 *   - When the MCP bridge/companion is unavailable, the question is asked
 *     normally in Claude (13.2: "the tool must fail soft and instruct the skill
 *     to ask the same question in Claude normally").
 *   - The same question falls back WITHOUT losing state and WITHOUT counting
 *     the question twice (5.1). The answer arrives through the normal session
 *     input; the question is counted exactly once (inputMode 'terminal',
 *     answer-event schema).
 *   - Same-session identity: the fallback routes to the owning session only
 *     (WS-03 bridge is the routing authority; a window is never authority).
 *
 * Coordinator usage model (owned by the skill side — WS-36/37/38/39 consume):
 *
 *   1. askUser(via MCP) fails soft  ->  coordinator.fallbackQuestion(question)
 *      - emits the prompt so the skill asks the question normally in Claude;
 *      - records the deferral once (no double-count on redisplays).
 *   2. The answer arrives back in the normal Claude turn (the skill sees user
 *      text where it asked a question) -> coordinator.answerFromTerminal(payload)
 *      - records the answer exactly once, with inputMode 'terminal';
 *      - refuses when the question was never deferred (an unmanaged question
 *        does not get a synthetic answer record), when it was already answered,
 *        or when the lifecycle slot was already consumed by the MCP path.
 *
 * This module stores NO answer text and logs NO payloads: only
 * (sessionId, questionKey) bookkeeping (spec 13.2 "do not save a duplicate
 * answer store inside Candice"; spec 9 local-profile privacy). It is an
 * orchestrator over the DoubleCountGuard + TerminalInputAdapter seams.
 *
 * Pure CommonJS, zero runtime dependencies (sections 12/17/27).
 */

const { DoubleCountGuard } = require('./double-count-guard')
const { TerminalInputAdapter } = require('./terminal-input-adapter')
const { validateQuestionEvent } = require('../mcp/ask-user/validate')

class FallbackCoordinator {
  /**
   * @param {object} opts
   * @param {object} [opts.guard]         DoubleCountGuard (created if absent)
   * @param {object} [opts.guardOpts]     opts for the guard when one is created
   * @param {object} [opts.adapter]       TerminalInputAdapter (created if absent)
   * @param {object} [opts.adapterOpts]   opts for the adapter when one is created
   */
  constructor(opts) {
    const options = opts || {}
    this.guard = options.guard || new DoubleCountGuard(options.guardOpts)
    this.adapter = options.adapter || new TerminalInputAdapter(options.adapterOpts)
  }

  /**
   * fallbackQuestion — MCP/companion unavailable: hand this question to the
   * terminal/Claude surface. Returns the prompt payload the skill should show
   * as a normal Claude question plus the deferral decision.
   */
  fallbackQuestion(question) {
    const q = question || {}
    if (!q.sessionId || !q.questionKey || !q.text) {
      return {
        ok: false,
        code: 'invalid-question',
        error: 'fallbackQuestion requires { sessionId, questionKey, text }',
      }
    }
    // Fallback is a delivery surface, never a second prompt-authoring path.
    // Require the shared canonical event before it can create terminal state;
    // this closes the direct-call bypass around the MCP validation boundary.
    const governed = validateQuestionEvent(q)
    if (!governed.ok) {
      return {
        ok: false,
        // Preserve the named registry authority reason when present, while
        // retaining generic invalid-question for malformed event shapes.
        code: governed.rule || governed.code,
        error: `fallback refuses an ungoverned question event${governed.field ? ` (${governed.field})` : ''}`,
      }
    }
    const defer = this.guard.deferToTerminal({
      sessionId: q.sessionId,
      questionKey: q.questionKey,
      counted: q.counted,
    })
    if (!defer.ok) {
      return { ok: false, code: defer.code, error: defer.error }
    }
    // The prompt IS the normal Claude question — same text, same key, same
    // session. Nothing is silently renumbered or reworded (spec 14: the same
    // question; spec 15: Spec Protocol remains the authority).
    return {
      ok: true,
      redelivered: !!defer.redelivered,
      counted: !!q.counted,
      // Skill-side instruction: ask the same question in Claude normally.
      prompt: {
        text: q.text,
        helpText: q.helpText || null,
        // 'terminal' allowed only when the question's contract permits it;
        // the skill remains the validator of answerKind.
        allowedInputModes: q.allowedInputModes || ['voice', 'typed', 'terminal'],
      },
      // Guard state for diagnostics — never the answer.
      guardStatus: this.guard.status().filter(
        (r) => r.sessionId === q.sessionId && r.questionKey === q.questionKey
      ),
    }
  }

  /**
   * answerFromTerminal — the answer came back through the normal Claude input
   * in the same session. Records it exactly once. Returns the answer-event
   * shaped payload the skill's normal answer path consumes (answer-event
   * schema: schemaVersion 1.0, sessionId, questionKey, answerText, inputMode
   * 'terminal', userConfirmedTranscript).
   */
  answerFromTerminal({ sessionId, questionKey, answerText, userConfirmedTranscript }) {
    if (!sessionId || !questionKey || typeof answerText !== 'string' || answerText.trim().length === 0) {
      return {
        ok: false,
        code: 'invalid-answer',
        error: 'answerFromTerminal requires { sessionId, questionKey, answerText }',
      }
    }
    if (this.guard.isDeferred({ sessionId, questionKey })) {
      // Reject the terminal answer when the MCP path already consumed it:
      // the WS-03 lifecycle recordAnswer refuses, guard surfaces as consumed.
      const reconciled = this.guard.reconcileTerminalAnswer({ sessionId, questionKey })
      if (!reconciled.ok) {
        return { ok: false, code: reconciled.code, error: reconciled.error }
      }
      return {
        ok: true,
        answer: {
          schemaVersion: '1.0',
          sessionId,
          questionKey,
          answerText,
          inputMode: 'terminal',
          userConfirmedTranscript: userConfirmedTranscript !== false,
          answeredAt: new Date().toISOString(),
        },
      }
    }
    if (this.guard.isAnswered({ sessionId, questionKey })) {
      return {
        ok: false,
        code: 'already-answered',
        error: `question ${questionKey} already has its one answer in session ${sessionId}`,
      }
    }
    // The question was never deferred to terminal — the MCP path or another
    // mechanism owns it; this module refuses to fabricate a record.
    return {
      ok: false,
      code: 'never-deferred',
      error: `question ${questionKey} was not deferred to terminal in session ${sessionId}; nothing to reconcile`,
    }
  }

  /**
   * deliverToTerminal — same-session free-conversation path: submit user text
   * to the owning session through the terminal adapter (spec 13.3). Validated
   * + queued-or-submitted by the adapter; the adapter's route resolver (WS-03
   * bridge or a platform adapter) is the routing authority.
   */
  deliverToTerminal({ sessionId, text, windowId }) {
    return this.adapter.submitText({ sessionId, text, windowId })
  }

  /** status — session/question state summary, ids only, never payloads. */
  status() {
    return {
      questions: this.guard.status(),
      queued: this.adapter.queued.map((q) => ({ sessionId: q.sessionId })),
    }
  }
}

module.exports = { FallbackCoordinator }
