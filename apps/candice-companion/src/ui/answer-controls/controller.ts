/**
 * Floating answer controls controller (Master Spec 0E WS-09, spec 5.1 /
 * 5.2 / 6).
 *
 * Wires the WS-08 state machine's REAL transition results to the floating
 * answer surface:
 *  - the machine consumes the events first (the reducer never invents a
 *    state); the controller then renders the result,
 *  - the PTT control (sibling WS-09 ptt lane) mounts into the answer
 *    surface; its intent hooks map to the machine PTT events
 *    (`ptt:start`/`ptt:stop`) — the WS-17 capture path is reached through
 *    the shell wiring, never by this lane,
 *  - typed answers and USE ANSWER submit through the machine's
 *    `answer:confirmed` event path (one answer, one confirmation — spec
 *    5.1/6),
 *  - "Answer in Claude instead" dispatches the machine's
 *    `answer:delegate-to-claude` event (spec 5.1 no-double-count),
 *  - EDIT / TRY AGAIN report intent through the transports (the WS-18
 *    transcript lane owns the full edit/retry UX); TRY AGAIN also restarts
 *    real capture via the machine's `ptt:start` (its defined semantics for
 *    a restart from `confirming`),
 *  - the voice toggle is presentation preference (spec 5.2) — stored by
 *    the WS-40 profile lane; this lane only reports the change.
 *
 * The machine remains the source of truth. One controller per companion
 * instance/session — never shared across sessions.
 *
 * @module
 */

import type { CandiceEvent, CandiceStateMachine } from '../../state/machine.ts';
import { answerControlsModel, type AnswerControlsModel } from './model.ts';
import { createAnswerControlsView, type AnswerControlsView } from './view.ts';
import { createPttView } from '../ptt/view.ts';
import {
  createCaptureConsentGate,
  type CaptureConsent,
  type CaptureConsentGate,
} from './consent.ts';
import type { AnswerMethod } from './config.ts';

export interface AnswerControlsControllerOptions {
  /** Real WS-08 machine instance (the transition authority). */
  machine: CandiceStateMachine;
  /** Mount element for the controls. Null in headless runs (spec 20). */
  mount: HTMLElement | null;
  /** Last-used convenience (spec 5.1) — never a lock. */
  lastUsedMethod?: AnswerMethod | null;
  /** Voice responses ON/OFF (spec 5.2). Defaults ON. */
  voiceEnabled?: boolean;
  /**
   * Is there a speech-to-text engine on this machine at all?
   *
   * This is the NATIVE fact (`SpeechHealth.stt_engine_ready`), not a user
   * preference. The app was computing it, parsing it into
   * `capabilities.sttEngineReady`, and then never reading it -- so HOLD TO
   * TALK was offered on builds that ship no `whisper-cli`. Pressing it
   * prompted for the microphone, recorded, and then showed "Answer in
   * Claude instead", every single time, because the transcribe call had
   * nothing to run.
   *
   * When this is false the PTT control is not created at all. A missing
   * button is kinder than a dead one: the typed answer box is always
   * present and always works, so the user simply types, and is never sent
   * through a permission prompt to reach a dead end.
   *
   * Defaults to TRUE so existing callers and tests are unchanged; the real
   * shell always passes the measured fact. Same posture as `voiceEnabled`.
   */
  sttAvailable?: boolean;
  /**
   * Transport: a confirmed answer handed to the session path (WS-03/WS-04
   * `answer` events / WS-05 fallback). One confirmed answer travels exactly
   * once (spec 5.1 no-double-count, E.1 WS-18). The machine's
   * `answer:confirmed` also records it; this hook delivers it.
   */
  submitAnswer?: (text: string) => void;
  /** Transport: the Answer-in-Claude fallback (spec 5.1/13.3). */
  delegateToClaude?: () => void;
  /** Transport: edit the transcript (WS-18 owns the edit surface). */
  editTranscript?: (text: string) => void;
  /** Transport: re-run the transcription (WS-18 owns it). */
  retryTranscription?: () => void;
  /** Transport: the voice-toggle change (spec 5.2). The WS-40 profile
   * lane owns persistence; this lane only reports the change. */
  onVoiceToggleChange?: (voiceEnabled: boolean) => void;
  /**
   * FIX-015 FAIL-5 (plan 3D): capture consent gate. When absent, a press
   * proceeds directly to the machine (legacy test wiring); the shell
   * always supplies a real query, so capture is gated in production.
   */
  captureConsent?: {
    /** Consult the native `cmd_speech_permissions` fact. Never throws. */
    query: () => CaptureConsent | Promise<CaptureConsent>;
    /** Called when a press was blocked (machine untouched; typing stays). */
    onBlocked?: (consent: CaptureConsent, explanation: string) => void;
  };
}

export interface AnswerControlsController {
  /** Feed an event to the machine, then render the result. */
  handle(event: CandiceEvent): void;
  /** Render the machine's current state (idempotent). */
  render(): void;
  /** The current presentation model (evidence for tests/QC). */
  model(): AnswerControlsModel;
  /** Re-query the profile convenience values (after the WS-40 store saves). */
  setPreferences(prefs: { lastUsedMethod?: AnswerMethod | null; voiceEnabled?: boolean }): void;
  destroy(): void;
}

export function createAnswerControlsController(
  options: AnswerControlsControllerOptions,
): AnswerControlsController {
  const { machine } = options;
  let lastUsedMethod = options.lastUsedMethod ?? null;
  let voiceEnabled = options.voiceEnabled !== false;

  const view: AnswerControlsView = createAnswerControlsView(options.mount, {
    onTypeAnswer: (text) => {
      machine.transition({ type: 'answer:confirmed', transcript: text });
      options.submitAnswer?.(text);
      render();
    },
    onChooseOption: (value) => {
      // A picked option is a confirmed answer: it came from the registry's own
      // list, so there is nothing to transcribe and nothing to confirm.
      machine.transition({ type: 'answer:confirmed', transcript: value });
      options.submitAnswer?.(value);
      render();
    },
    onDelegateToClaude: () => {
      machine.transition({ type: 'answer:delegate-to-claude' });
      options.delegateToClaude?.();
      render();
    },
    onVoiceToggle: () => {
      voiceEnabled = !voiceEnabled;
      options.onVoiceToggleChange?.(voiceEnabled);
      render();
    },
    onConfirmUse: () => {
      const transcript = machine.getState().transcript;
      if (transcript !== null) {
        machine.transition({ type: 'answer:confirmed', transcript });
        options.submitAnswer?.(transcript);
      }
      render();
    },
    onConfirmEdit: () => {
      const transcript = machine.getState().transcript;
      if (transcript !== null) options.editTranscript?.(transcript);
      // The machine stays in `confirming`; nothing is submitted or cleared
      // until the user explicitly confirms the edited text (spec 6).
    },
    onConfirmTryAgain: () => {
      // The machine's defined restart semantics: from `confirming`,
      // `ptt:start` discards only the unconfirmed transcript and opens the
      // mic (single-flight). Nothing is submitted until reconfirmed.
      machine.transition({ type: 'ptt:start' });
      options.retryTranscription?.();
      render();
    },
  });

  // Mount the PTT control into the answer surface (sibling WS-09 lane).
  // FIX-015 FAIL-5: the press routes through the capture consent gate —
  // the machine's `ptt:start` fires only on a cleared consent fact
  // (granted, or not-determined so the OS prompt appears at the press).
  // Blocked (denied / no-device / error / query failure) leaves the
  // machine untouched: the typed-answer surface stays exactly as it was.
  let pttView: ReturnType<typeof createPttView> | null = null;
  let consentGate: CaptureConsentGate | null = null;
  const stopPtt = (): void => {
    machine.transition({ type: 'ptt:stop' });
    render();
  };
  if (options.mount !== null && typeof document !== 'undefined') {
    const pttHost = document.createElement('div');
    consentGate = createCaptureConsentGate({
      query: options.captureConsent?.query
        ?? (() => 'error'), // no query wired: fail closed, never open mic
      onAllowed: () => {
        // FIX-014 (I-04): a hold press while Candice is SPEAKING is an
        // interrupt intent, not a new listen. `ptt:start` is rejected by
        // the machine in that status; `speech:interrupted` produces
        // `tts:stop` FIRST, then `mic:open` — the spec-6 duplex-safety
        // ordering. Every other status keeps the plain start event.
        if (machine.getState().status === 'speaking') {
          machine.transition({ type: 'speech:interrupted' });
        } else {
          machine.transition({ type: 'ptt:start' });
        }
        render();
      },
      onStopped: stopPtt,
      onBlocked: options.captureConsent?.onBlocked,
    });
    // No engine on this machine: never build the control. See
    // `sttAvailable` above -- offering it here is what produced the
    // record-then-give-up loop.
    pttView = options.sttAvailable === false ? null : createPttView(pttHost, {
      onTalkStart: () => {
        consentGate?.requestStart();
      },
      onTalkStop: () => {
        consentGate?.release();
      },
    });
    if (pttView !== null && pttView.el !== null) view.attachPtt(pttView.el);
  }

  function render(): void {
    const state = machine.getState();
    // The embedded PTT control renders the machine's REAL status: the
    // unmistakable listening state (glow/pulse + exact spec-6 label)
    // activates on the integrated surface, driven by the same reducer
    // the rest of the surface reads.
    if (pttView !== null) pttView.show(state.status);
    view.showOptions(state.pendingOptions);
    view.setModel(
      answerControlsModel(state, {
        lastUsedMethod,
        voiceEnabled,
        sttAvailable: options.sttAvailable,
      }),
    );
  }

  render();

  return {
    handle(event) {
      machine.transition(event);
      render();
    },
    render,
    model: () => answerControlsModel(machine.getState(), { lastUsedMethod, voiceEnabled }),
    setPreferences(prefs) {
      if (prefs.lastUsedMethod !== undefined) lastUsedMethod = prefs.lastUsedMethod;
      if (prefs.voiceEnabled !== undefined) voiceEnabled = prefs.voiceEnabled;
      render();
    },
    destroy: () => {
      // pttView holds document-level release listeners and a possible live
      // hold — its destroy() releases the hold and removes those listeners
      // (I-06 teardown path) before the answer surface is removed.
      pttView?.destroy();
      consentGate?.destroy();
      consentGate = null;
      view.destroy();
    },
  };
}
