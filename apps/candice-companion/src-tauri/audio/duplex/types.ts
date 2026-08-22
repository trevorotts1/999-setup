/**
 * WS-20 duplex-safety types — speech interruption and half-duplex gating.
 *
 * Owned lane (manifest 9.2 WR-014 / WS-20):
 *   `apps/candice-companion/src-tauri/audio/duplex/**`
 *
 * The invariants this lane proves (CONTROL/CHECKLIST.md E.1 WS-20,
 * Master Spec sections 6 / 8 / 20):
 *   1. pressing PTT while Candice speaks stops her speech immediately;
 *   2. Candice's own TTS output never feeds the STT input;
 *   3. the microphone is released after an interrupt only after the
 *      playback tail has drained (half duplex — spec 6: stop, then listen);
 *   4. an interrupt can never block, reset, or destroy the user's session
 *      (spec 20: stop failures are forced and the input still unblocks).
 *
 * Determinism rules (inherited from WS-08):
 *  - the controller never reads the clock internally; time is injected via
 *    `now()` so every transition is reproducible in tests;
 *  - no timers inside the lane — timeouts are enforced by `tick()`, which
 *    the bridge calls from its own fast loop.
 *
 * Effect/event shapes mirror WS-08 (`src/state/machine.ts`) so the bridge
 * can forward them without translation; the shape-compatibility check is a
 * type-level test in `__tests__/duplex.test.ts`.
 */

/** Controller phase. `listening` here means mic capture may be open. */
export type DuplexPhase = "idle" | "speaking" | "interrupting" | "listening";

/** Events forwarded to the WS-08 state machine. */
export type DuplexEvent =
  /** PTT pressed while Candice was speaking (WS-08 transitions speaking -> listening). */
  | { type: "speech:interrupted" }
  /** Interrupt settled and tail drained: WS-08 `ptt:start` timing. */
  | { type: "ptt:start" }
  /** User released after an interrupt-driven listen (WS-08 `ptt:stop` timing). */
  | { type: "ptt:stop" };

/**
 * Side-effects this lane guarantees. A subset of WS-08 `CandiceSideEffect`
 * (only `tts:stop` / `mic:open` / `mic:close`, caption always null); the
 * shape-compatibility test proves assignment into `CandiceSideEffect`.
 */
export interface DuplexEffect {
  type: "tts:stop" | "mic:open" | "mic:close";
  caption: null;
}

/** One transition result: the new phase, the machine event (if any), effects. */
export interface DuplexTransition {
  phase: DuplexPhase;
  event: DuplexEvent | null;
  effects: DuplexEffect[];
}

/** Tunable half-duplex constants. All optional, all defaulted. */
export interface DuplexPolicy {
  /**
   * Output latency + acoustic tail that must drain after `stop()` before
   * capture may open. 120 ms covers the sink flush of a 24 kHz short buffer.
   */
  playbackTailMs: number;
  /**
   * If `SpeechTarget.stop()` has not settled by this deadline the lane
   * forces the tail window anyway (spec 20: an interrupt must never hang).
   */
  stopTimeoutMs: number;
}

export const DUPLEX_DEFAULTS: Required<DuplexPolicy> = {
  playbackTailMs: 120,
  stopTimeoutMs: 3000,
};

/**
 * The speech output this lane interrupts. Implemented by the TTS/playback
 * seam (WS-19 engine handle + platform audio sink); the bridge wires it here.
 */
export interface SpeechTarget {
  /**
   * Synchronously cancel in-flight synthesis and playback. Called FIRST on
   * an interrupt — speech stops in the same call as the press. Never throws.
   */
  abort(): void;
  /**
   * Stop playback output for the current utterance. Resolves with the
   * wall-clock ms at which output went silent (tail accounting input).
   * May reject or never settle — the lane's stop timeout forces recovery.
   */
  stop(): Promise<{ stoppedAtMs: number }>;
}

/** Machine-readable counters (QA/audit surface; never contains audio data). */
export interface DuplexStats {
  /** Number of interrupts started (press while speaking). */
  interrupts: number;
  /** Number of times `SpeechTarget.stop()` was invoked (<= interrupts). */
  stops: number;
  /** Count of stop timeouts/rejections that were force-settled (spec 20). */
  forcedStops: number;
  /** Utterances that reached `speaking` end normally. */
  speeches: number;
  /** Presses during an interrupt that were released before the tail drained. */
  cancelledListens: number;
  /** Frames of input suppressed by the echo gate (output tail excluded). */
  suppressedFrames: number;
  /** Frames of input allowed through the echo gate. */
  passedFrames: number;
}
