/**
 * Candice application state machine (Master Spec 0E WS-08).
 *
 * The brain, rules, memory, and source of truth are the active Claude Code
 * session and the invoked skill (Master Spec section 2). This state machine
 * is presentation infrastructure only: it never decides the outcome of the
 * interview, never modifies question order or rules, and never invents
 * progress. Every state change must be driven by a real status event
 * delivered by the session bridge (MCP `candice.status` / `candice.compact`,
 * or the terminal fallback adapter).
 *
 * Determinism rules:
 * - The machine is a pure reducer. The same (state, event) pair always
 *   produces the same next state and the same side-effect commands. No clock,
 *   no random, no IO inside the reducer. Rendering and timers live outside.
 * - Time-based transitions (timeout guards) are computed by the caller and
 *   delivered as real events; the machine itself never reads the clock.
 * - Unlisted events are IGNORED (state unchanged, side effects empty) so that
 *   late or duplicated events can never corrupt the session (Master Spec 20).
 *
 * @module
 */

import type { CandiceStatus } from './status.ts';
import { ALL_CANDICE_STATUSES } from './status.ts';

export type { CandiceStatus } from './status.ts';

export type CandicePhase =
  | 'interview'
  | 'post-interview'
  | 'ending';

/** Error classes this lane owns. Never collides with control-plane files. */
export const CANDICE_ERRORS = {
  /** STT runtime failed to produce a transcript. */
  STT: 'stt',
  /** TTS runtime failed to synthesize speech. */
  TTS: 'tts',
  /** Kokoro unavailable -> system TTS fallback is in use. */
  TTS_FALLBACK: 'tts-fallback',
  /** Microphone permission denied or no audio device. */
  MIC: 'mic',
  /** MCP bridge / companion app unavailable -> ask in Claude. */
  BRIDGE: 'bridge',
  /** The local profile or preferences store cannot be read/written. */
  PREFERENCES: 'preferences',
} as const;
export type CandiceErrorCode = (typeof CANDICE_ERRORS)[keyof typeof CANDICE_ERRORS];

export interface CandiceState {
  /**
   * One of the nine canonical states. Never invented progress: states only
   * move when an event listed below actually fired.
   */
  phase: CandicePhase;
  status: CandiceStatus;
  /** Transcript of the user's latest utterance while awaiting confirmation. */
  transcript: string | null;
  /** The pending question, recovered verbatim across `recovering` (spec 20). */
  pendingQuestion: string | null;
  /**
   * Registry `options` for the pending question, when it is a choice question.
   *
   * These are the exact answer values the protocol expects -- they are not
   * display copy and are never invented here. Null means "not a choice
   * question", which is different from an empty list.
   */
  pendingOptions: readonly string[] | null;
  /** Voice responses ON/OFF (spec 5.2). Never inferred; always explicit. */
  voiceEnabled: boolean;
  /** TTS degraded to system speech (clearly fallback, never canonical). */
  ttsFallbackActive: boolean;
  /** True while the MCP bridge is unreachable (spec 13.2 / 20). */
  bridgeUnavailable: boolean;
  /** True when the local preference store could not be accessed (spec 9). */
  preferencesUnavailable: boolean;
  /** Mirror of the `candice.compact` MCP event (spec 16). */
  compacted: boolean;
}

export interface CandiceEvent {
  readonly type: CandiceEventType;
  /** Reason the bridge attaches to a status change. May be empty. */
  readonly detail?: string;
  /** Present on `speech:transcript` and `answer:confirmed`. */
  readonly transcript?: string;
  /** Present on `question:received` / `question:recovered`. */
  readonly question?: string;
  /** Choice options for `question:received`, straight from the registry. */
  readonly options?: readonly string[];
  /** Present on `speech:tts`. */
  readonly ttsFallback?: boolean;
}

export type CandiceEventType =
  /** MCP `candice.status` — every bridge status event enters here. */
  | 'status'
  | 'session:begin'
  | 'session:end'
  | 'question:received'
  | 'answer:confirmed'
  | 'speech:transcript'
  | 'speech:tts'
  | 'speech:ended'
  | 'speech:interrupted'
  | 'ptt:start'
  | 'ptt:stop'
  | 'error'
  | 'bridge:unavailable'
  | 'bridge:restored'
  /** Authenticated server cancellation/timeout of the exact active question. */
  | 'bridge:cancelled'
  | 'fallback:text'
  | 'compact:enter'
  | 'compact:exit'
  /** Re-raise of the exact pending question after a crash (spec 20). */
  | 'question:recovered'
  /** Ask the user via the terminal/Claude input surface instead (spec 13.3). */
  | 'answer:delegate-to-claude';

export interface CandiceSideEffect {
  type:
    | 'tts:stop'
    | 'mic:open'
    | 'mic:close'
    | 'tts:speak'
    | 'captions:show';
  /** The exact caption text, always shown regardless of voice state (spec 5.2). */
  caption: string | null;
}

export interface CandiceTransition {
  state: CandiceState;
  effects: CandiceSideEffect[];
}

export interface CandiceStateMachine {
  getState(): CandiceState;
  /** Returns the final state after applying the event, or null when ignored. */
  transition(event: CandiceEvent): CandiceState | null;
  readonly lastEffects: readonly CandiceSideEffect[];
}

export const INITIAL_STATE: CandiceState = {
  phase: 'interview',
  status: 'idle',
  transcript: null,
  pendingQuestion: null,
  pendingOptions: null,
  voiceEnabled: true,
  ttsFallbackActive: false,
  bridgeUnavailable: false,
  preferencesUnavailable: false,
  compacted: false,
};

const CAPTIONS: Record<CandiceStatus, string> = {
  idle: '',
  listening: 'LISTENING - LET GO WHEN FINISHED',
  transcribing: 'Here is what I heard...',
  confirming: '',
  thinking: '',
  speaking: '',
  compact: '',
  recovering: 'RECOVERING - restoring your question',
  'text-fallback': 'Answer in Claude instead',
  building: '',
  'quality-checking': '',
  fixing: '',
  'waiting-for-user': '',
  complete: '',
};

const RESTRICTED_DURING_INTERVIEW: ReadonlySet<CandiceStatus> = new Set([
  'compact',
  'text-fallback',
]);

/**
 * Statuses treated as "actively busy" for the terminal fallback queue
 * (spec 13.3: queue while Claude is busy; inject only at a safe input point).
 */
const BUSY_STATUSES: ReadonlySet<CandiceStatus> = new Set([
  'listening',
  'transcribing',
  'confirming',
  'thinking',
  'speaking',
  'recovering',
]);

/**
 * Skill-run progress statuses (spec 16): BUILDING, QUALITY CHECKING, FIXING,
 * WAITING FOR USER, COMPLETE. The first such real status event marks the end
 * of the structured interview and moves the machine to the post-interview
 * phase. Voice-capture statuses (listening/transcribing/confirming) are NOT
 * skill progress and never appear here.
 */
const SKILL_PROGRESS_STATUSES: ReadonlySet<CandiceStatus> = new Set([
  'building',
  'quality-checking',
  'fixing',
  'waiting-for-user',
  'complete',
]);

export function createCandiceStateMachine(initial: CandiceState = INITIAL_STATE): CandiceStateMachine {
  let state: CandiceState = { ...initial };
  let lastEffects: CandiceSideEffect[] = [];

  function next(event: CandiceEvent): CandiceState | null {
    lastEffects = [];

    switch (event.type) {
      case 'session:begin': {
        if (state.phase !== 'interview') return null;
        state = { ...state, phase: 'interview', status: 'idle', compacted: false };
        return state;
      }

      case 'session:end': {
        if (state.phase === 'ending') return null;
        lastEffects.push({ type: 'tts:stop', caption: null });
        lastEffects.push({ type: 'mic:close', caption: null });
        state = { ...state, phase: 'ending', status: 'idle', compacted: false };
        return state;
      }

      case 'status': {
        const status = event.detail as CandiceStatus | undefined;
        if (!status || !isCandiceStatus(status)) return null;
        if (!isLegalStatus(state.phase, status)) return null;
        if (state.status === status && !SKILL_PROGRESS_STATUSES.has(status)) return state;
        if (SKILL_PROGRESS_STATUSES.has(status) && state.phase === 'interview') {
          // Real skill-progress status event -> the interview is complete
          // (spec 16). This is an event-driven phase change, never invented.
          state = { ...state, phase: 'post-interview' };
        }
        state = { ...state, status };
        if (status === 'recovering') {
          // Spec 20: never lose the exact pending question across a crash.
          state = { ...state, pendingQuestion: state.pendingQuestion };
        }
        return state;
      }

      case 'question:received':
      case 'question:recovered': {
        if (state.phase !== 'interview') return null;
        const question =
          event.question ??
          (event.type === 'question:recovered' ? state.pendingQuestion : null);
        if (question == null) return null;
        // A recovered question keeps the options it was delivered with: the
        // recovery event carries no registry payload, and dropping them would
        // silently downgrade a choice question to a text box after a crash.
        const options =
          event.options ??
          (event.type === 'question:recovered' ? state.pendingOptions : null);
        state = {
          ...state,
          pendingQuestion: question,
          pendingOptions: options ?? null,
          status: 'thinking',
        };
        lastEffects.push({ type: 'captions:show', caption: question });
        return state;
      }

      case 'answer:confirmed': {
        if (state.phase !== 'interview') return null;
        const transcript = event.transcript ?? state.transcript;
        if (transcript == null) return null;
        state = {
          ...state,
          transcript,
          pendingQuestion: null,
          pendingOptions: null,
          status: 'thinking',
        };
        return state;
      }

      case 'speech:transcript': {
        if (state.status !== 'listening' && state.status !== 'transcribing') return null;
        const transcript = event.transcript;
        if (transcript == null) return null;
        state = { ...state, transcript, status: 'confirming' };
        return state;
      }

      case 'speech:tts': {
        if (state.phase !== 'interview') return null;
        state = {
          ...state,
          status: 'speaking',
          ttsFallbackActive: event.ttsFallback === true,
        };
        lastEffects.push({ type: 'tts:speak', caption: state.pendingQuestion });
        return state;
      }

      case 'speech:ended': {
        // NATURAL completion of an utterance: the audio finished, or the
        // engine refused it. This is NOT `speech:interrupted` — that is a
        // barge-in, and it pushes `tts:stop` (stopping audio that already
        // stopped) plus `mic:open` (opening the mic is the USER's decision,
        // spec 6). Using it for completion would mean a stop for speech that
        // already ended and a mic she never asked to open.
        //
        // Without this event `speaking` is a TERMINAL status: the only way
        // out is `speech:interrupted`, and nothing dispatches that when an
        // utterance simply ends. Because `ptt:start` refuses while speaking,
        // making `speech:tts` reachable WITHOUT this would leave HOLD TO TALK
        // permanently dead — a worse regression than the unreachable
        // `speaking` status it was fixing.
        //
        // She rests where the delivered question already sat (`thinking`), so
        // the user can answer the moment she stops talking. No effects: the
        // caption is already correct and nothing needs stopping.
        if (state.status !== 'speaking') return null;
        state = {
          ...state,
          status: state.pendingQuestion === null ? 'idle' : 'thinking',
          ttsFallbackActive: false,
        };
        return state;
      }

      case 'speech:interrupted': {
        lastEffects.push({ type: 'tts:stop', caption: null });
        lastEffects.push({ type: 'mic:open', caption: null });
        state = { ...state, status: 'listening', ttsFallbackActive: false };
        return state;
      }

      case 'ptt:start': {
        if (state.phase === 'ending') return null;
        // Single-flight capture: no new listen while a transcription is in
        // flight, and interrupting speech is a distinct event
        // (`speech:interrupted`), never a silent overwrite (spec 6/20).
        if (
          state.status === 'listening' ||
          state.status === 'transcribing' ||
          state.status === 'speaking'
        ) {
          return null;
        }
        // Restarting while confirming discards only the unconfirmed local
        // transcript (spec 18: nothing is submitted until confirmed).
        lastEffects.push({ type: 'mic:open', caption: CAPTIONS.listening });
        state = { ...state, status: 'listening', transcript: null };
        return state;
      }

      case 'ptt:stop': {
        if (state.status !== 'listening') return null;
        lastEffects.push({ type: 'mic:close', caption: null });
        state = { ...state, status: 'transcribing' };
        return state;
      }

      case 'error': {
        if (state.phase !== 'interview') return null;
        const code = event.detail as CandiceErrorCode | undefined;
        if (!code || !isCandiceErrorCode(code)) return null;
        if (code === CANDICE_ERRORS.TTS_FALLBACK) {
          state = { ...state, ttsFallbackActive: true };
          return state;
        }
        lastEffects.push({ type: 'tts:stop', caption: null });
        lastEffects.push({ type: 'mic:close', caption: null });
        if (code === CANDICE_ERRORS.STT) {
          state = { ...state, status: 'confirming' };
        } else if (code === CANDICE_ERRORS.BRIDGE) {
          state = { ...state, bridgeUnavailable: true };
        } else if (code === CANDICE_ERRORS.PREFERENCES) {
          state = { ...state, preferencesUnavailable: true };
        }
        return state;
      }

      case 'bridge:unavailable': {
        state = { ...state, bridgeUnavailable: true };
        return state;
      }

      case 'bridge:restored': {
        state = { ...state, bridgeUnavailable: false };
        return state;
      }

      case 'bridge:cancelled': {
        // The authenticated bridge has closed the exact answer slot (for
        // example because the caller's wait window elapsed). Its controls
        // must not remain a false live-answer surface.
        lastEffects.push({ type: 'tts:stop', caption: null });
        lastEffects.push({ type: 'mic:close', caption: null });
        state = {
          ...state,
          pendingQuestion: null,
          pendingOptions: null,
          transcript: null,
          status: 'idle',
        };
        return state;
      }

      case 'fallback:text': {
        if (state.status === 'text-fallback' && state.phase === 'post-interview') {
          return state;
        }
        if (state.phase === 'post-interview') {
          state = { ...state, status: 'text-fallback', compacted: false };
          lastEffects.push({ type: 'captions:show', caption: CAPTIONS['text-fallback'] });
          return state;
        }
        if (state.status === 'listening' || state.status === 'transcribing') {
          lastEffects.push({ type: 'mic:close', caption: null });
        }
        state = { ...state, status: 'text-fallback', transcript: null };
        lastEffects.push({ type: 'captions:show', caption: CAPTIONS['text-fallback'] });
        return state;
      }

      case 'compact:enter': {
        if (state.phase !== 'post-interview') return null;
        lastEffects.push({ type: 'mic:close', caption: null });
        state = { ...state, compacted: true, status: 'compact', transcript: null };
        return state;
      }

      case 'compact:exit': {
        if (state.phase !== 'post-interview') return null;
        state = { ...state, compacted: false, status: 'idle' };
        return state;
      }

      case 'answer:delegate-to-claude': {
        if (state.phase !== 'interview') return null;
        if (state.status === 'listening' || state.status === 'transcribing') {
          lastEffects.push({ type: 'mic:close', caption: null });
        }
        lastEffects.push({ type: 'captions:show', caption: CAPTIONS['text-fallback'] });
        state = { ...state, status: 'text-fallback', transcript: null };
        return state;
      }

      default: {
        // Unlisted event types are ignored by construction.
        return null;
      }
    }
  }

  return {
    getState: () => state,
    transition(event: CandiceEvent): CandiceState | null {
      const before = state;
      const result = next(event);
      if (result === null || sameState(result, before)) {
        // Ignored event, or an event that leaves every field unchanged: report
        // null so callers can tell a real transition from a no-op.
        return null;
      }
      state = result;
      return state;
    },
    get lastEffects() {
      return lastEffects;
    },
  };
}

function isCandiceStatus(value: unknown): value is CandiceStatus {
  return typeof value === 'string' && (ALL_CANDICE_STATUSES as readonly string[]).includes(value);
}

function isCandiceErrorCode(value: unknown): value is CandiceErrorCode {
  return typeof value === 'string' && (Object.values(CANDICE_ERRORS) as string[]).includes(value);
}

/** Options compare by CONTENT: a re-parsed wire payload is a new array every
 *  time, so reference equality would report a change on every transition. */
function sameOptions(
  a: readonly string[] | null,
  b: readonly string[] | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameState(a: CandiceState, b: CandiceState): boolean {
  return (
    a.phase === b.phase &&
    a.status === b.status &&
    a.transcript === b.transcript &&
    a.pendingQuestion === b.pendingQuestion &&
    sameOptions(a.pendingOptions, b.pendingOptions) &&
    a.voiceEnabled === b.voiceEnabled &&
    a.ttsFallbackActive === b.ttsFallbackActive &&
    a.bridgeUnavailable === b.bridgeUnavailable &&
    a.preferencesUnavailable === b.preferencesUnavailable &&
    a.compacted === b.compacted
  );
}

function isLegalStatus(phase: CandicePhase, status: CandiceStatus): boolean {
  if (phase === 'ending') return false;
  if (phase === 'interview' && RESTRICTED_DURING_INTERVIEW.has(status)) return false;
  return true;
}

export function isBusy(status: CandiceStatus): boolean {
  return BUSY_STATUSES.has(status);
}
