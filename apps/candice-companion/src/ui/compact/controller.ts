/**
 * Compact companion controller (Master Spec 0E WS-10, spec 13.3 / 16).
 *
 * Wires the WS-08 state machine's REAL transition results to the compact
 * view and the WS-10 submit queue:
 *  - status events are consumed by the machine first (the reducer never
 *    invents progress), then the resulting state is rendered;
 *  - the queue holds ONLY the user's explicit input while the session is
 *    busy (spec 13.3) and is drained only at a safe input point by the
 *    transport adapter this lane hands submissions to;
 *  - the controller never owns session identity, never injects input into
 *    a terminal/window itself, and never opens a second AI conversation
 *    (spec 2 / 13).
 *
 * The controller is DOM-safe and never throws on a missing bridge: the
 * no-op view path keeps the compact surface degraded but present (spec
 * 20: failure never stops Claude).
 *
 * @module
 */

import type { CandiceEvent, CandiceStateMachine } from '../../state/machine.ts';
import { BUSY_HINT_TEXT, CompactSubmitQueue, submissionMustWait } from './queue.ts';
import type { CompactSubmitEntry } from './queue.ts';
import { compactStatusView } from './status.ts';
import { createCompactView, type CompactView } from './view.ts';

/** Transport surface the compact companion can hand submissions to. */
export interface CompactTransport {
  /**
   * Submit one user-authored entry at a safe input point. Queue draining
   * is owned by the transport (WS-03/WS-05 session adapter); the
   * controller only ever calls this with explicit user input.
   */
  submit(entry: CompactSubmitEntry): void;
}

export interface CompactControllerOptions {
  /** Real WS-08 machine instance. */
  machine: CandiceStateMachine;
  /** Mount element for the view. Null in headless runs (spec 20). */
  mount: HTMLElement | null;
  /** Transport adapter; null degrades to queued-only (never hidden). */
  transport: CompactTransport | null;
  /** Document injection (tests); defaults to the real document. */
  doc?: Document | null;
}

export interface CompactController {
  /** Feed the machine a real event, then render the result. */
  handle(event: CandiceEvent): void;
  /** Render the machine's current state (idempotent). */
  render(): void;
  /** Queued entries in order. */
  pending(): readonly CompactSubmitEntry[];
  /** True when surface is expanded. */
  isExpanded(): boolean;
  destroy(): void;
}

/**
 * Create the compact controller. The machine remains the source of truth;
 * every view change is a render of a machine result. One controller per
 * companion instance/session — never shared across sessions.
 */
export function createCompactController(options: CompactControllerOptions): CompactController {
  const { machine, mount, transport, doc } = options;
  const queue = new CompactSubmitQueue();
  let talkHeld = false;
  let expanded = false;

  const view: CompactView = createCompactView(mount, {
    // Hold-to-talk: pointerdown starts capture, pointerup stops it. The
    // WS-08 machine single-flights ptt (a second ptt:start while already
    // listening is ignored), so a missed release can never double-open.
    onTalkToggle: (held: boolean) => {
      if (held === talkHeld) return;
      talkHeld = held;
      machine.transition({ type: held ? 'ptt:start' : 'ptt:stop' });
      render();
    },
    onSubmit: (text) => {
      // Only the user's explicit input is ever queued (spec 13.3: never
      // hidden prompts). The machine is NOT told to fall back to text —
      // that decision belongs to the WS-05/WS-03 adapter. When the
      // session is at a safe input point, pending entries drain FIFO.
      queue.enqueue({ text, inputMode: 'typed' });
      flushIfSafe();
      render();
    },
    onExpandToggle: () => {
      expanded = !expanded;
      view.setExpanded(expanded);
      render();
    },
    onMuteToggle: () => undefined,
    onReturnToClaude: () => {
      expanded = false;
      view.setExpanded(false);
      render();
    },
  }, doc ?? null);

  /**
   * Drain the queue FIFO at a safe input point. Called when the session
   * becomes safe — either via a status event transition or on submit —
   * because spec 13.3: submit only when the session is at a safe input
   * point. Never called with a busy status; render alone never drains
   * (a queued entry must not vanish without being submitted).
   */
  function flushIfSafe(): void {
    if (submissionMustWait(machine.getState().status)) return;
    // No transport (bridge/terminal adapter absent, spec 20): keep every
    // drained entry visible in the queue — never drop user input.
    if (transport === null) return;
    let drained = queue.drain();
    while (drained !== null) {
      transport.submit(drained);
      drained = queue.drain();
    }
  }

  /**
   * Queue the user's spoken compact question. The compact companion has no
   * inline confirm/edit UI (that surface is WS-09's interview UI), so the
   * transcript of the user's explicit utterance joins the same visible FIFO
   * the moment the machine reports it. It stays visible in the pending list
   * and drains only at a safe input point (spec 13.3: show the user what
   * will be submitted). Entry is created only from a real machine
   * transcript — never silent input, never invented.
   */
  function queueSpokenInput(): void {
    // Compact voice questions exist only after the structured interview
    // (spec 16); during the interview the WS-04/WS-09 path owns answers.
    const state = machine.getState();
    if (state.phase !== 'post-interview') return;
    const transcript = state.transcript;
    if (transcript === null) return;
    queue.enqueue({ text: transcript, inputMode: 'voice' });
    flushIfSafe();
  }

  /** Render the machine result (never invent anything). */
  function render(): void {
    const result = machine.getState();
    const viewState = compactStatusView(result.status);
    view.setStatus(viewState);
    view.setBusyHint(viewState.busy && queue.size > 0, BUSY_HINT_TEXT);
    view.setPending(queue.pending());
  }

  render();

  return {
    handle: (event) => {
      // The machine's transition result is the single source of truth: a
      // null return means the event was a no-op (e.g. a duplicate
      // `speech:transcript` while the machine is already confirming, or a
      // transcript arriving outside listening/transcribing) and must never
      // produce a queue entry. Queueing on the event type alone would
      // double-submit the same spoken question.
      const result = machine.transition(event);
      // A real safe-point transition releases held user input (spec 13.3).
      // The compact companion has no inline confirm/edit surface (WS-09 owns
      // that UI), so the transcript the machine reported is the user's
      // explicit spoken submission: queue it, never drop it — and only when
      // the machine actually accepted it.
      if (result !== null && event.type === 'speech:transcript') queueSpokenInput();
      flushIfSafe();
      render();
    },
    render,
    pending: () => queue.pending(),
    isExpanded: () => expanded,
    destroy: () => view.destroy(),
  };
}
