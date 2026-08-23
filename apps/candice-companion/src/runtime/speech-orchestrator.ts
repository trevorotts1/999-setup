/**
 * Speech orchestrator (QFIX Q-02, design q2-design.md section 2).
 *
 * The ONE webview caller of the `cmd_speech_*` boundary (sole-caller rule,
 * design 2.1): consent query, capture start/stop, transcribe, speak, and
 * stop all go through this module and nowhere else. Every command name
 * comes from `SPEECH_COMMANDS` (Q-04: Rust registration is truth).
 *
 * Ownership split (design 2.1):
 *  - `DuplexController` (WS-20) remains the press/release/interrupt-timing
 *    authority; the orchestrator drives it and translates its outcomes.
 *  - the Rust capture worker's `PttController` (WS-17) remains the capture
 *    authority; the orchestrator only relays its admission facts.
 *  - the orchestrator is the IPC/engine authority connecting them, and the
 *    single emitter of machine events for the voice path (`ptt:start`,
 *    `ptt:stop`, `speech:interrupted`, `speech:transcript`, `error`) —
 *    machine semantics are unchanged; only the emitter moved here.
 *
 * Preserved guard rails (design section 6):
 *  - FIX-015 consent: the permission query happens at press time only,
 *    fails closed on unknown state, and a blocked press leaves the typed
 *    surface untouched. `not-determined` proceeds BY DESIGN so the macOS
 *    TCC prompt appears at the press itself.
 *  - FIX-017: the final-boundary guard stays upstream. The orchestrator
 *    never classifies text; when a guard predicate is supplied it refuses
 *    to carry text the guard did not allow (defense in depth, design 2.4).
 *  - Spec 20: every operation is total — failures become honest machine
 *    states (`error` with the `mic`/`stt` codes) and captions/typed answers
 *    stay available. A stale press answer (release beat the permission
 *    answer) never opens the mic.
 *
 * @module
 */

import { DuplexController } from '../../src-tauri/audio/duplex/index.ts';
import type { SpeechTarget } from '../../src-tauri/audio/duplex/index.ts';
import { CANDICE_ERRORS } from '../state/machine.ts';
import type { CandiceStateMachine } from '../state/machine.ts';
import {
  BLOCKED_EXPLANATIONS,
  isConsentBlocked,
  type CaptureConsent,
} from '../ui/answer-controls/consent.ts';
import { SPEECH_COMMANDS } from './speech-commands.ts';
import type { SpeechCommandName } from './speech-commands.ts';

/** IPC seam: any Tauri invoke adapter (real @tauri-apps/api/core or test stub). */
export interface SpeechInvokeAdapter {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** Native `cmd_speech_permissions` fact (camelCase mirror of SpeechPermissions). */
interface PermissionsFact {
  microphone?: unknown;
  promptSource?: unknown;
  explanation?: unknown;
}

/** Native `cmd_speech_capture_start` outcome (camelCase CaptureStartOutcome). */
interface CaptureStartOutcome {
  status?: unknown;
  requestId?: unknown;
}

/** Native `cmd_speech_transcribe` result (camelCase JSON payload). */
interface TranscriptOutcome {
  requestId?: unknown;
  status?: unknown;
  text?: unknown;
}

export interface SpeechOrchestratorOptions {
  /** The IPC seam — every `cmd_speech_*` invoke originates here. */
  invoke: SpeechInvokeAdapter;
  /** The WS-08 machine (transition authority). Events are emitted HERE. */
  machine: CandiceStateMachine;
  /**
   * The duplex controller the shell mounted (FIX-015 seam). The
   * orchestrator drives press/release/tick on it; the shell keeps ticking
   * via {@link SpeechOrchestrator.tick} or may call the controller itself.
   */
  duplex: DuplexController;
  /**
   * FIX-017 defense in depth (design 2.4): when supplied, `speak` refuses
   * text this predicate did not allow. The guard DECISION stays upstream
   * (the bridge applies decideSpeech/readAloud before calling); this is a
   * hard backstop, never the classifier.
   */
  speechGuard?: (text: string) => boolean;
  /** Blocked-press surface (FIX-015): reason travels to the user, typing stays. */
  onBlocked?: (consent: CaptureConsent, explanation: string) => void;
  /**
   * Exact-once confirmed-answer delivery (spec 5.1 no-double-count). Called
   * only from {@link SpeechOrchestrator.confirmTranscript}, which
   * single-flights per transcript until a NEW transcript arrives.
   */
  submitAnswer?: (text: string, inputMode: 'voice') => void;
  /** Clock injection (determinism: tests inject; production defaults). */
  now?: () => number;
  /** Request-id seed (tests pin; production defaults to randomUUID). */
  newRequestId?: () => string;
}

export class SpeechOrchestratorError extends Error {
  override name = 'SpeechOrchestratorError';
}

function defaultRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `req-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

/** Map the native permission fact to the consent vocabulary; unknown -> error. */
function toConsent(fact: unknown): CaptureConsent {
  const record = asRecord(fact);
  switch (record?.microphone) {
    case 'granted':
      return 'granted';
    case 'not-determined':
      return 'not-determined';
    case 'denied':
      return 'denied';
    case 'no-device':
      return 'no-device';
    default:
      return 'error'; // malformed fact or unmapped state: fail closed
  }
}

/**
 * The one speech command executor. See the module doc for ownership rules.
 */
export class SpeechOrchestrator {
  readonly #invoke: SpeechInvokeAdapter;
  readonly #machine: CandiceStateMachine;
  readonly #duplex: DuplexController;
  readonly #guard: ((text: string) => boolean) | null;
  readonly #onBlocked: ((consent: CaptureConsent, explanation: string) => void) | null;
  readonly #submit: ((text: string, inputMode: 'voice') => void) | null;
  readonly #now: () => number;
  readonly #newRequestId: () => string;

  /** Monotonic press generation; a release (or newer press) supersedes in-flight presses. */
  #generation = 0;
  /** Request id of the LIVE capture, or null. Single-flight (plan 3C). */
  #liveCaptureId: string | null = null;
  /** True while a transcription round-trip is in flight for the live id. */
  #transcribing = false;
  /** Exact-once submit latch; reset when a NEW transcript arrives. */
  #submitted = false;
  /** Utterance id handed to the duplex speech target (idempotent stop). */
  #utteranceId: string | null = null;

  constructor(options: SpeechOrchestratorOptions) {
    this.#invoke = options.invoke;
    this.#machine = options.machine;
    this.#duplex = options.duplex;
    this.#guard = options.speechGuard ?? null;
    this.#onBlocked = options.onBlocked ?? null;
    this.#submit = options.submitAnswer ?? null;
    this.#now = options.now ?? (() => Date.now());
    this.#newRequestId = options.newRequestId ?? defaultRequestId;
  }

  // ------------------------------------------------------------- queries

  /** The duplex controller this orchestrator drives (shell tick wiring). */
  get duplex(): DuplexController {
    return this.#duplex;
  }

  /** Request id of the live capture, or null (evidence/QA surface). */
  get liveCaptureId(): string | null {
    return this.#liveCaptureId;
  }

  /** True once the CURRENT transcript has been confirmed and submitted. */
  get submitted(): boolean {
    return this.#submitted;
  }

  // ------------------------------------------------------ consent (Q-04)

  /**
   * Consult the native permission fact (FIX-015 plan 3D). Never prompts —
   * prompting happens at the press, inside the capture open. Any failure
   * (reject, malformed payload) maps to `'error'`: fail closed.
   */
  async queryConsent(): Promise<CaptureConsent> {
    let fact: unknown;
    try {
      fact = await this.#invoke.invoke(SPEECH_COMMANDS.permissions);
    } catch {
      return 'error';
    }
    return toConsent(fact);
  }

  // ------------------------------------------------------- PTT lifecycle

  /**
   * HOLD TO TALK pressed (design 2.3 steps 1-5, order preserved):
   *  1. speaking -> interrupt first (`speech:interrupted`; the duplex fires
   *     abort synchronously inside its press);
   *  2. consent query — blocked states leave the machine untouched and
   *     route the actionable explanation to {@link onBlocked};
   *  3. `cmd_speech_capture_start` — the REAL device open; the OS prompt
   *     fires inside it for a first-run (`not-determined`) user;
   *  4. success -> duplex press + machine `ptt:start`: HONEST listening,
   *     derived from the capture crate's `listening` outcome, never the
   *     button alone.
   *
   * Resolves true only when the mic genuinely opened. A release that beats
   * an in-flight answer supersedes the press (stale-callback rule): the mic
   * never opens with the button up, and a mic opened in the race window is
   * closed immediately.
   */
  async pttPress(): Promise<boolean> {
    const generation = ++this.#generation;
    const machineWasSpeaking = this.#machine.getState().status === 'speaking';
    if (machineWasSpeaking) {
      // Spec-6 interrupt: the duplex call stops output in the same call
      // (abort-in-press) and begins the tail drain; WS-08 moves
      // speaking -> listening on the event below.
      this.#duplex.press();
      this.#machine.transition({ type: 'speech:interrupted' });
    }

    const consent = await this.queryConsent();
    if (generation !== this.#generation) return false; // superseded mid-query
    if (isConsentBlocked(consent)) {
      this.#onBlocked?.(consent, BLOCKED_EXPLANATIONS[consent] ?? BLOCKED_EXPLANATIONS.error);
      return false;
    }

    const requestId = this.#newRequestId();
    let outcome: unknown;
    try {
      outcome = await this.#invoke.invoke(SPEECH_COMMANDS.captureStart, { requestId });
    } catch {
      // The device did not open (denied open, busy, engine down). Honest
      // mic error; the listening UI never appears; typing stays available.
      this.#machine.transition({ type: 'error', detail: CANDICE_ERRORS.MIC });
      return false;
    }
    if (generation !== this.#generation) {
      // Released while the open was in flight: give the mic straight back.
      this.#closeCaptureQuietly(requestId);
      return false;
    }
    const record = asRecord(outcome);
    if (!record || record.requestId !== requestId || record.status !== 'listening') {
      this.#machine.transition({ type: 'error', detail: CANDICE_ERRORS.MIC });
      return false;
    }

    this.#duplex.press();
    if (this.#machine.getState().status !== 'listening') {
      this.#machine.transition({ type: 'ptt:start' });
    }
    this.#liveCaptureId = requestId;
    return true;
  }

  /**
   * LET GO (design 2.3 steps 6-9). Idempotent. Supersedes any in-flight
   * press first (stale-callback rule), then: native stop (idempotent),
   * machine `ptt:stop` -> `transcribing`, then `cmd_speech_transcribe`
   * mode `capture` — the REAL STT run on the recording that stayed native.
   * A non-empty transcript moves the machine to `confirming`; an empty
   * transcript or a failed run is an explicit `error`/`stt` — never a
   * blank answer (spec 20).
   */
  async pttRelease(): Promise<void> {
    this.#generation += 1; // invalidate any in-flight press answer
    const requestId = this.#liveCaptureId;
    if (requestId === null) return;
    this.#liveCaptureId = null;
    this.#transcribing = true;
    try {
      this.#duplex.release();
      try {
        await this.#invoke.invoke(SPEECH_COMMANDS.captureStop, { requestId });
      } catch {
        // Idempotent native stop; the release already closed the stream.
      }
      if (this.#machine.getState().status === 'listening') {
        this.#machine.transition({ type: 'ptt:stop' }); // -> transcribing
      }
      let raw: unknown;
      try {
        raw = await this.#invoke.invoke(SPEECH_COMMANDS.transcribe, {
          requestId,
          mode: 'capture',
          language: 'en',
        });
      } catch {
        this.#failStt();
        return;
      }
      const record = asRecord(raw);
      const text = typeof record?.text === 'string' ? record.text.trim() : '';
      if (record?.status !== 'transcribed' || text.length === 0) {
        // Empty transcript is a failure — never a blank answer (spec 20).
        this.#failStt();
        return;
      }
      this.#machine.transition({ type: 'speech:transcript', transcript: text });
      // A fresh transcript re-arms the exact-once submit latch.
      this.#submitted = false;
    } finally {
      this.#transcribing = false;
    }
  }

  /**
   * Advance the duplex controller (tail drain, stop-timeout force, stuck-
   * PTT auto-release). The bridge calls this from its loop; a `ptt:start`
   * the duplex emits after an interrupt's tail drains is forwarded to the
   * machine (ignored when the interrupt already set listening).
   */
  tick(): void {
    const transition = this.#duplex.tick();
    if (transition.event?.type === 'ptt:start') {
      if (this.#machine.getState().status !== 'listening') {
        this.#machine.transition({ type: 'ptt:start' });
      }
    }
  }

  // --------------------------------------------------- confirm / submit

  /**
   * Explicit user confirmation of the editable transcript (design 2.3
   * step 10). EXACT-ONCE: the first call transitions `answer:confirmed`
   * and hands the text to the submit transport with `inputMode: 'voice'`;
   * every further call until a NEW transcript arrives is a no-op. Never
   * auto-submits.
   */
  confirmTranscript(): string | null {
    if (this.#submitted) return null;
    const transcript = this.#machine.getState().transcript;
    if (typeof transcript !== 'string' || transcript.trim().length === 0) return null;
    this.#submitted = true;
    this.#machine.transition({ type: 'answer:confirmed', transcript });
    this.#submit?.(transcript, 'voice');
    return transcript;
  }

  // ------------------------------------------------------------ TTS path

  /**
   * Speak bounded text through the real TTS boundary (design 2.4). The
   * FIX-017 decision happened upstream; when a guard predicate is wired,
   * disallowed text is REFUSED here without touching the engine.
   * Errors propagate to the caller (captions stay available — spec 20).
   */
  async speak(text: string): Promise<void> {
    if (this.#guard !== null && !this.#guard(text)) {
      throw new SpeechOrchestratorError(
        'speak refused: the privacy boundary did not allow this text',
      );
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new SpeechOrchestratorError('speak refused: empty text');
    }
    const requestId = this.#newRequestId();
    this.#utteranceId = requestId;
    // The duplex learns output is active NOW: its next press becomes the
    // spec-6 interrupt (abort fires inside the press call).
    this.#duplex.speak();
    try {
      await this.#invoke.invoke(SPEECH_COMMANDS.speak, { requestId, text });
    } catch (error) {
      // The boundary refused the utterance: output never happened, so the
      // duplex must not stay in the speaking phase.
      this.#duplex.finishSpeaking();
      throw error;
    }
  }

  /**
   * The speech output target for the duplex controller (design 2.4):
   * `abort` fires `cmd_speech_stop` fire-and-forget (synchronous-feeling
   * interrupt in the press call), `stop` awaits the native stop and
   * reports the silence time from the injected clock. A failed/rejected
   * stop propagates — the duplex force limb recovers (spec 20).
   */
  createSpeechTarget(): SpeechTarget {
    return {
      abort: () => {
        const requestId = this.#utteranceId;
        if (requestId === null) return;
        void this.#invoke
          .invoke(SPEECH_COMMANDS.stop, { requestId, immediate: true })
          .catch(() => {});
      },
      stop: async () => {
        const requestId = this.#utteranceId;
        await this.#invoke.invoke(SPEECH_COMMANDS.stop, { requestId });
        return { stoppedAtMs: this.#now() };
      },
    };
  }

  // -------------------------------------------------------- status events

  /**
   * Consume a native `candice:speech-capture-status` event (status codes
   * only — never audio). A denial surfacing mid-listen closes the capture
   * honestly: mic error, machine leaves listening. Unknown statuses are
   * recorded facts, never state changes.
   */
  applyCaptureStatus(status: unknown): void {
    if (status !== 'denied' && status !== 'no-device' && status !== 'error') return;
    const requestId = this.#liveCaptureId;
    if (requestId === null) return;
    this.#liveCaptureId = null;
    this.#closeCaptureQuietly(requestId);
    this.#machine.transition({ type: 'error', detail: CANDICE_ERRORS.MIC });
  }

  // ----------------------------------------------------------- internals

  #failStt(): void {
    if (this.#machine.getState().status === 'transcribing') {
      this.#machine.transition({ type: 'error', detail: CANDICE_ERRORS.STT });
    }
  }

  #closeCaptureQuietly(requestId: string): void {
    void this.#invoke
      .invoke(SPEECH_COMMANDS.captureStop, { requestId })
      .catch(() => {});
  }
}

/** Factory mirroring the composition seams' style. */
export function createSpeechOrchestrator(
  options: SpeechOrchestratorOptions,
): SpeechOrchestrator {
  return new SpeechOrchestrator(options);
}

/** Every command name this module may put on the wire (contract evidence). */
export function orchestratorCommands(): readonly SpeechCommandName[] {
  return Object.values(SPEECH_COMMANDS);
}
