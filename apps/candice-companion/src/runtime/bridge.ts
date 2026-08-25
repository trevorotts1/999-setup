/**
 * Webview side of the authenticated local MCP bridge. Native code authenticates
 * the socket before emitting an event; this module still validates every event
 * before it can create a visible answer surface or send an answer back.
 *
 * FIX-013 S4: every visible surface is keyed by the exact operation identity
 * `(sessionId, questionKey, operationId)`; a native cancel clears the matching
 * pending UI by that identity and restores click-through. A replayed question
 * (the same operation after a reconnect) is surfaced as a recovery with the
 * lease id, and the native `recovered` acknowledgement is sent before the
 * controls are made interactive again — the exact handoff is acknowledged
 * before the surface is usable.
 */

import type { CandiceStateMachine } from '../state/machine.ts';
import { createAnswerControlsController, type AnswerControlsController } from '../ui/answer-controls/index.ts';
import type { AnswerMethod } from '../ui/answer-controls/config.ts';
import type { CaptureConsent } from '../ui/answer-controls/consent.ts';
import { SPEECH_BOUNDARY_EVENT, SPEECH_DRAIN_EVENT } from './speech-timing.ts';

interface BridgeQuestion {
  schemaVersion: '1.0';
  sessionId: string;
  questionKey: string;
  text: string;
  allowedInputModes: readonly string[];
  /**
   * FIX-017 privacy echoes from the question event. These are the caller's
   * UNTRUSTED echo of the registry, exactly as `decideSpeech` treats them —
   * the registry remains the authority server-side. The webview uses them
   * only to refuse MORE than the server guard would, never to permit more.
   */
  readAloud?: boolean;
  sensitivity?: string;
  /** Registry `spoken` variant when the producer sends one; else `text`. */
  spoken?: string;
}

interface BridgeIdentity {
  sessionId: string;
  questionKey: string;
  operationId?: string;
}

interface BridgeLifecycleEvent {
  lifecycle: string;
  sessionId?: string;
  leaseId?: string;
  operationId?: string;
  questionKey?: string;
}

function parseQuestion(payload: unknown): BridgeQuestion | null {
  if (!payload || typeof payload !== 'object') return null;
  const outer = payload as { type?: unknown; version?: unknown; question?: unknown };
  if (outer.type !== 'question' || outer.version !== '1.0' || !outer.question || typeof outer.question !== 'object') return null;
  const question = outer.question as Record<string, unknown>;
  if (
    question.schemaVersion !== '1.0'
    || typeof question.sessionId !== 'string' || question.sessionId.length === 0
    || typeof question.questionKey !== 'string' || !/^[A-Z][A-Z0-9_-]*$/.test(question.questionKey)
    || typeof question.text !== 'string' || question.text.length === 0
    || !Array.isArray(question.allowedInputModes)
  ) return null;
  const parsed = { ...question } as unknown as BridgeQuestion;
  // Carry the privacy echoes verbatim; validation happens in the speech
  // decision, which fails closed on anything that is not exactly right.
  parsed.readAloud = question.readAloud === true;
  parsed.sensitivity = typeof question.sensitivity === 'string' ? question.sensitivity : undefined;
  parsed.spoken = typeof question.spoken === 'string' && question.spoken.length > 0
    ? question.spoken
    : undefined;
  return parsed;
}

/**
 * Whether a delivered question may be spoken aloud (FIX-017 defense in depth).
 *
 * The authority is `decideSpeech` in the FIX-017 final-boundary guard, which
 * runs server-side against the registry. That guard cannot run in the webview
 * (it needs the registry module), so this is deliberately STRICTER than the
 * guard rather than a reimplementation of it — refusing more than the
 * authority is safe, permitting more would be a leak:
 *
 *   - `secret`   never spoken (matches the guard, which refuses unconditionally)
 *   - `personal` never spoken HERE. The guard allows it with an explicit
 *     `readAloudOptIn` consent, but no trustworthy opt-in signal reaches the
 *     webview yet, so it fails closed. 10 of the 51 active registry entries
 *     are `personal`; wiring that consent through is a follow-up, not a bug.
 *   - anything other than exactly `normal` + `readAloud === true` is refused,
 *     including absent or malformed metadata.
 *
 * The user's own voice-output preference is an independent veto.
 */
export function shouldSpeakQuestion(
  question: Pick<BridgeQuestion, 'readAloud' | 'sensitivity'>,
  voiceOutputEnabled: boolean,
): boolean {
  if (voiceOutputEnabled !== true) return false;
  if (question.readAloud !== true) return false;
  return question.sensitivity === 'normal';
}

/** Longest failure reason shown to a user; the rest is elided, never dropped. */
const MAX_SPEECH_FAILURE_CHARS = 200;

/**
 * Turn whatever `cmd_speech_speak` rejected with into one readable line.
 *
 * Tauri rejects a `Result<_, String>` with the RAW STRING, not an `Error`, so
 * `error.message` is undefined on the exact path that matters — which is how
 * every message the native side produces got discarded here. Both shapes are
 * handled, and an unusable error still yields text rather than silence.
 */
export function describeSpeechFailure(error: unknown): string {
  const raw = typeof error === 'string'
    ? error
    : error instanceof Error && typeof error.message === 'string'
      ? error.message
      : '';
  const reason = raw.replace(/\s+/g, ' ').trim();
  if (reason.length === 0) {
    return 'Candice could not speak this question aloud. The voice engine gave no reason.';
  }
  const bounded = reason.length > MAX_SPEECH_FAILURE_CHARS
    ? reason.slice(0, MAX_SPEECH_FAILURE_CHARS - 1) + '\u2026'
    : reason;
  return 'Candice could not speak this question aloud: ' + bounded;
}

/**
 * Announce a speech failure and return the exact text announced.
 *
 * Total by construction (spec 20): reporting a failure must never itself
 * throw, or a speech problem becomes a session problem.
 */
export function reportSpeechFailure(
  error: unknown,
  announce: ((text: string) => void) | undefined,
): string {
  const text = describeSpeechFailure(error);
  try {
    announce?.(text);
  } catch { /* the report is best effort; it must never escalate */ }
  return text;
}

/** Accept only a native cancellation for an exact opaque bridge question. */
function parseCancellation(payload: unknown): BridgeIdentity | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.sessionId !== 'string' || value.sessionId.length === 0
    || typeof value.questionKey !== 'string' || !/^[A-Z][A-Z0-9_-]*$/.test(value.questionKey)
  ) return null;
  const identity: BridgeIdentity = { sessionId: value.sessionId, questionKey: value.questionKey };
  if (typeof value.operationId === 'string' && value.operationId.length > 0) identity.operationId = value.operationId;
  return identity;
}

/**
 * FIX-014 (I-11): the persisted convenience values the answer surface
 * consumes, and the voice-toggle report the profile lane persists.
 */
export interface BridgePreferencesHooks {
  /** Remembered convenience only; never a lock (spec 5.1). */
  lastUsedMethod?: AnswerMethod | null;
  /** Separate persistent toggle (spec 5.2). */
  voiceEnabled?: boolean;
  /** The WS-40 profile lane owns persistence; the bridge only reports. */
  onVoiceToggleChange?: (voiceEnabled: boolean) => void;
}

/**
 * QFIX Q-02 (design 2.2): the consent transport the answer surface uses.
 * The composition injects the orchestrator's `queryConsent` here so the
 * sole-caller rule holds — the bridge never invokes a `cmd_speech_*`
 * command itself.
 */
export interface BridgeSpeechHooks {
  queryConsent?: () => CaptureConsent | Promise<CaptureConsent>;
  /**
   * Speak a delivered question. The composition wires this to the
   * orchestrator so the sole-caller rule holds — the bridge never invokes a
   * `cmd_speech_*` command itself. Rejection is non-fatal: the question is
   * already displayed before this is ever called.
   */
  speakQuestion?: (text: string) => Promise<void>;
  /**
   * Stop any utterance still playing. Called on EVERY teardown path —
   * answered, delegated, server-cancelled, session ended — so an utterance
   * can never talk over the next question.
   */
  cancelSpeech?: () => void;
  /**
   * The user's voice-output preference (spec 5.2). Read-only here; the
   * profile lane owns the store. Absent means "unknown" and fails closed.
   */
  voiceOutputEnabled?: () => boolean;
  /**
   * Report a speech failure to the user IN WORDS. The composition wires this
   * to the caption surface, which is the only channel a human actually reads:
   * `data-speech-playback` is debug state with no reader anywhere in the app.
   *
   * This exists because the native side now REFUSES to substitute a voice the
   * operator did not approve (`resolve_approved_voice`). Without a reader for
   * the reason it gives, that refusal degrades from "wrong voice" to
   * "unexplained silence" — correct, refused, and nobody told.
   */
  announceSpeechFailure?: (text: string) => void;
}
function parseLifecycle(payload: unknown): BridgeLifecycleEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.lifecycle !== 'string' || value.lifecycle.length === 0) return null;
  const event: BridgeLifecycleEvent = { lifecycle: value.lifecycle };
  if (typeof value.sessionId === 'string') event.sessionId = value.sessionId;
  if (typeof value.leaseId === 'string') event.leaseId = value.leaseId;
  if (typeof value.operationId === 'string') event.operationId = value.operationId;
  if (typeof value.questionKey === 'string') event.questionKey = value.questionKey;
  return event;
}

const identityKey = (identity: BridgeIdentity): string =>
  `${identity.sessionId}::${identity.questionKey}`;

const sameIdentity = (a: BridgeIdentity, b: BridgeIdentity): boolean =>
  a.sessionId === b.sessionId && a.questionKey === b.questionKey;

/** Mount answer controls only after native delivered an authenticated question. */
export async function initializeAuthenticatedBridge(
  root: HTMLElement,
  machine: CandiceStateMachine,
  prefs: BridgePreferencesHooks & BridgeSpeechHooks = {},
): Promise<() => void> {
  const [{ listen }, { invoke }] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/core'),
  ]);
  let controls: AnswerControlsController | null = null;
  let active: (BridgeQuestion & { operationId?: string }) | null = null;
  let submitted = false;
  /** Set while a replayed question is awaiting its native recovered ack. */
  let awaitingRecovery = false;
  /** Identity of the utterance in flight, so a stale result cannot re-arm. */
  let speakingFor: string | null = null;

  /**
   * Debug-only playback state. NOTHING READS THIS — not a CSS rule, not the
   * animation lane, not a test. It is a breadcrumb for a human with a
   * debugger, and it is NOT how a failure reaches the user; that is
   * `announceSpeechFailure`. Do not treat this attribute as a report.
   * See docs/SPEECH-PLAYBACK-CONTRACT.md.
   */
  const setPlaybackState = (state: 'speaking' | 'idle' | 'failed'): void => {
    root.dataset.speechPlayback = state;
  };

  /**
   * The utterance is over — drained naturally, interrupted, or refused.
   *
   * This is what takes her OUT of `status: 'speaking'`, and it must run on
   * EVERY exit path: `ptt:start` refuses while speaking, so a missed exit
   * leaves HOLD TO TALK dead until the next question. Idempotent — the
   * machine ignores `speech:ended` unless she is actually speaking, so a
   * duplicate drain, or a teardown after a drain, costs nothing.
   */
  const endSpeaking = (): void => {
    if (speakingFor === null) return;
    speakingFor = null;
    setPlaybackState('idle');
    machine.transition({ type: 'speech:ended' });
  };

  const stopSpeaking = (): void => {
    if (speakingFor === null) return;
    endSpeaking();
    try { prefs.cancelSpeech?.(); } catch { /* stopping must never throw */ }
  };

  /**
   * Speak a delivered question. Total by construction (spec 20): the
   * question is already on screen before this runs, so a refusal or a
   * synthesis failure costs the caption nothing.
   *
   * A failure is REPORTED IN WORDS on the caption surface, carrying the
   * reason the native side gave. That matters most for the one the native
   * side now raises deliberately: an unapproved or unresolvable canonical
   * voice. Refusing to speak in a voice the operator did not choose is only
   * an improvement if the user is told why she went quiet.
   */
  const speakQuestion = (question: BridgeQuestion): void => {
    const speak = prefs.speakQuestion;
    const voiceOn = prefs.voiceOutputEnabled?.() ?? false;
    if (!speak) return;
    if (!shouldSpeakQuestion(question, voiceOn)) return;
    const utterance = question.spoken ?? question.text;
    const identity = identityKey(question);
    speakingFor = identity;
    setPlaybackState('speaking');
    // THE hologram wire. `status: 'speaking'` is the only status the bust,
    // blink, lip sync and head drift render under, and this is its ONLY
    // dispatch in the app: `speech:tts` was declared, handled and tested
    // while nothing ever fired it, so those layers were never once reachable.
    machine.transition({ type: 'speech:tts', ttsFallback: false });
    void speak(utterance).catch((error: unknown) => {
      // Only the utterance we started may clear the state; a late rejection
      // from a superseded question must not stomp the current one.
      if (speakingFor !== identity) return;
      speakingFor = null;
      setPlaybackState('failed');
      // A refused utterance must leave `speaking` too, or a synthesis error
      // strands her there and HOLD TO TALK never comes back.
      machine.transition({ type: 'speech:ended' });
      // The parameter is the whole point: this catch used to take none, so
      // every reason the native side produced died here.
      reportSpeechFailure(error, prefs.announceSpeechFailure);
    });
  };

  const closeControls = async (): Promise<void> => {
    const closing = active;
    // Stop first, before anything can await: an utterance must never talk
    // over the next question, and every teardown path funnels through here
    // (answered, delegated, server-cancelled, session ended).
    stopSpeaking();
    controls?.destroy();
    controls = null;
    try { await invoke('cmd_set_answer_input_enabled', { enabled: false }); } catch { /* native disconnect fails closed */ }
    // Do not release native admission until click-through is restored. This
    // keeps a second inbound question from being acknowledged during teardown.
    active = null;
    submitted = false;
    awaitingRecovery = false;
    if (closing) {
      try {
        await invoke('cmd_release_bridge_question', {
          sessionId: closing.sessionId,
          questionKey: closing.questionKey,
          operationId: closing.operationId ?? null,
        });
      } catch { /* native disconnect/cancellation has already failed closed */ }
    }
  };

  const isCurrent = (question: BridgeQuestion): boolean => (
    active !== null && active.sessionId === question.sessionId && active.questionKey === question.questionKey
  );

  const present = async (payload: unknown): Promise<void> => {
    const question = parseQuestion(payload);
    if (!question || active !== null) return;
    const outer = payload as { operationId?: unknown; replayed?: unknown; leaseId?: unknown };
    const operationId = typeof outer.operationId === 'string' && outer.operationId.length > 0
      ? outer.operationId
      : undefined;
    const replayed = outer.replayed === true;
    const leaseId = typeof outer.leaseId === 'string' && outer.leaseId.length > 0
      ? outer.leaseId
      : undefined;
    active = { ...question, operationId };
    submitted = false;
    awaitingRecovery = replayed;
    machine.transition({ type: 'question:received', question: question.text });
    try { await invoke('cmd_set_answer_input_enabled', { enabled: true }); } catch {
      machine.transition({ type: 'bridge:unavailable' });
      await closeControls();
      return;
    }
    // A server timeout may have cancelled this question while the native
    // input-policy IPC call was in flight. Never mount a late answer surface.
    if (!isCurrent(question)) {
      try { await invoke('cmd_set_answer_input_enabled', { enabled: false }); } catch { /* fail closed */ }
      return;
    }
    // A replayed question is the SAME operation after a reconnect. The
    // recovery handoff must be acknowledged against the exact operation and
    // lease BEFORE the surface is interactive: the record leaves `recovering`
    // only on the acknowledged handoff. If the ack fails, the controls stay
    // un-mounted and the session fails closed.
    if (replayed) {
      try {
        await invoke('cmd_ack_replayed_question', {
          sessionId: question.sessionId,
          questionKey: question.questionKey,
          operationId,
          leaseId,
        });
      } catch {
        machine.transition({ type: 'bridge:unavailable' });
        await closeControls();
        return;
      }
      awaitingRecovery = false;
      machine.transition({ type: 'status', detail: 'recovering' });
    }

    // FIX-014 (I-13 mount bug): the answer-controls view clears its mount on
    // creation (`mount.innerHTML = ''`), so it gets a DEDICATED container —
    // never the shared #app root, which also hosts the captions live region
    // and the gesture stage. A delivered question must not wipe them.
    const controlsMount = document.createElement('div');
    controlsMount.id = 'candice-answer-controls-mount';
    root.append(controlsMount);
    controls = createAnswerControlsController({
      machine,
      mount: controlsMount,
      lastUsedMethod: prefs.lastUsedMethod ?? null,
      voiceEnabled: prefs.voiceEnabled,
      onVoiceToggleChange: prefs.onVoiceToggleChange,
      // FIX-015 FAIL-5 (plan 3D): consult the native capture-lane fact on
      // every HOLD TO TALK press. A denied/no-device/error report blocks
      // the press and leaves the typed-answer surface exactly as it was;
      // a failed query blocks too (fail closed, mic never opens on an
      // unknown consent state).
      captureConsent: {
        // QFIX Q-02 (design 2.2): the consent query routes through the
        // orchestrator's sole-caller seam. The composition always supplies
        // it; the inline fallback keeps the fail-closed contract for legacy
        // callers without a wired orchestrator.
        query: prefs.queryConsent ?? (async (): Promise<CaptureConsent> => 'error'),
      },
      submitAnswer: (text) => {
        if (!active || submitted || text.trim().length === 0) return;
        submitted = true;
        const current = active;
        void invoke('cmd_submit_bridge_answer', {
          request: {
            sessionId: current.sessionId,
            questionKey: current.questionKey,
            operationId: current.operationId ?? null,
            answer: {
              schemaVersion: '1.0', sessionId: current.sessionId, questionKey: current.questionKey,
              answerText: text, inputMode: 'typed', userConfirmedTranscript: true,
            },
          },
        }).then(closeControls).catch(() => {
          submitted = false;
          machine.transition({ type: 'bridge:unavailable' });
        });
      },
      delegateToClaude: () => {
        if (!active || submitted) return;
        submitted = true;
        const current = active;
        void invoke('cmd_cancel_bridge_question', {
          sessionId: current.sessionId,
          questionKey: current.questionKey,
          operationId: current.operationId ?? null,
        }).finally(closeControls);
      },
    });

    // The question is now displayed and interactive. Speaking is the LAST
    // thing that happens, so nothing about the caption or the answer surface
    // depends on it. Re-check currency: an await above may have let a
    // cancellation land while this question was still being mounted.
    if (isCurrent(question)) speakQuestion(active ?? question);
  };
  const unlisten = await listen<unknown>('candice:bridge-question', (event) => { void present(event.payload); });
  const unlistenCancel = await listen<unknown>('candice:bridge-cancel', (event) => {
    const cancelled = parseCancellation(event.payload);
    if (!cancelled || !active || !sameIdentity(cancelled, active)) return;
    // Native cancellation carries the exact operation identity when the
    // server sent it; a mismatched operation id is never applied to a
    // different surface. A native cancel with no operation id still applies
    // only when the keys match exactly (the server always sends the id when
    // it has one).
    if (cancelled.operationId !== undefined && active.operationId !== undefined
      && cancelled.operationId !== active.operationId) return;
    // This is an authenticated server-side timeout/cancellation, not user
    // intent. Clear the machine's pending question before destroying its
    // controls, and restore transparent click-through through closeControls.
    machine.transition({ type: 'bridge:cancelled' });
    void closeControls();
  });
  const unlistenLifecycle = await listen<unknown>('candice:bridge-lifecycle', (event) => {
    const lifecycle = parseLifecycle(event.payload);
    if (!lifecycle) return;
    if (lifecycle.lifecycle === 'disconnected') {
      machine.transition({ type: 'bridge:unavailable' });
    } else if (lifecycle.lifecycle === 'connected' || lifecycle.lifecycle === 'recovered') {
      machine.transition({ type: 'bridge:restored' });
    } else if (lifecycle.lifecycle === 'ended') {
      machine.transition({ type: 'session:end' });
    }
  });
  // END OF AUDIO. The native playback thread already emits exactly one of
  // these per utterance — `speech-drain` when it plays out, `speech-boundary`
  // when it is cut short — and until now the ONLY consumer was the viseme
  // scheduler. Nothing told the state machine she had stopped talking, so
  // without this she would sit in `speaking` from the moment the hologram
  // wire above fires until the next teardown, with HOLD TO TALK refused the
  // entire time. Both events mean the same thing here: the mouth is closed.
  const unlistenDrain = await listen<unknown>(SPEECH_DRAIN_EVENT, () => { endSpeaking(); });
  const unlistenBoundary = await listen<unknown>(SPEECH_BOUNDARY_EVENT, () => { endSpeaking(); });

  // An event emitted before WebView initialization is retrieved exactly once.
  // Register first, then take the pending value so neither ordering loses it.
  await present(await invoke('cmd_take_pending_bridge_question'));
  return () => {
    unlisten();
    unlistenCancel();
    unlistenLifecycle();
    unlistenDrain();
    unlistenBoundary();
    void closeControls();
  };
}

export { parseQuestion, parseCancellation, parseLifecycle };
