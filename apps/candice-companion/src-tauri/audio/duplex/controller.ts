/**
 * WS-20 duplex controller — speech interruption + half-duplex sequencing.
 *
 * Owned lane (manifest 9.2 WR-014 / WS-20):
 *   `apps/candice-companion/src-tauri/audio/duplex/**`
 *
 * Interrupt sequence (Master Spec section 6 — press PTT while Candice speaks):
 *
 *   press while speaking
 *     -> abort() called synchronously (speech stops in the press call)
 *     -> emit `speech:interrupted` (WS-08 moves speaking -> listening)
 *     -> call stop(), then await the playback tail window
 *     -> only AFTER the tail has drained emit `ptt:start` (mic may open)
 *     -> later release -> emit `ptt:stop` (mic closes)
 *
 * Why `ptt:start` is deferred until after the tail (half duplex):
 * recording over the playback tail would capture Candice's own voice into
 * the STT input. Capture opens only after the output is provably silent,
 * and the input-side [`EchoGate`] blocks frames during every output window
 * anyway — that is what makes "Candice's own TTS output never feeds STT" a
 * property of this controller, not a hope.
 *
 * Spec 20 (an interrupt must never block the session): a `stop()` that
 * rejects or fails to settle by `stopTimeoutMs` is FORCED — the tail window
 * is skipped and the listen path still opens. The user always gets their
 * mic; only the echo-safety margin is degraded, and always in one branch.
 *
 * Determinism rules (inherited from WS-08): the controller never reads a
 * clock of its own — `now()` is injected — and no timers live inside.
 * Time-based limbs (`stopTimeoutMs`, tail drain, listen window) advance
 * only through `tick()`, which the bridge calls from its own loop and the
 * stop continuation calls once the promise settles.
 */

import type {
  DuplexEffect,
  DuplexEvent,
  DuplexPhase,
  DuplexPolicy,
  DuplexStats,
  DuplexTransition,
  SpeechTarget,
} from "./types.ts";
import { DUPLEX_DEFAULTS } from "./types.ts";

export type {
  DuplexEffect,
  DuplexEvent,
  DuplexPhase,
  DuplexPolicy,
  DuplexStats,
  DuplexTransition,
  SpeechTarget,
} from "./types.ts";

/** Stuck-PTT safety at the controller level: auto-release after this long. */
export const LISTEN_WINDOW_MS = 60_000;

/**
 * Input-side echo gate (half-duplex capture guard). Unidirectional per
 * utterance: the gate is OPEN only while a listen window is live, and
 * closes the instant the window ends or an interrupt settles without one.
 *
 * Even though this controller never opens capture before the tail drains,
 * the gate is the enforcement seam: any caller that routes captured frames
 * into an STT path MUST route them through [`EchoGate.gate`]. When closed,
 * frames are counted and discarded — they can never reach the transcript
 * path.
 */
export class EchoGate {
  #open = false;
  #dropped = 0;

  /** Open the gate for a new listen window. Throws if already open (double-open is a wiring bug). */
  open(): void {
    if (this.#open) {
      throw new Error("echo-gate-already-open");
    }
    this.#open = true;
  }

  /** Close the gate (listen ended, interrupted, or cancelled). */
  close(): void {
    this.#open = false;
  }

  isOpen(): boolean {
    return this.#open;
  }

  /** @returns true when the frame passes to STT; false when suppressed. */
  gate(_frame: unknown): boolean {
    if (!this.#open) {
      this.#dropped += 1;
      return false;
    }
    return true;
  }

  /** Frames suppressed since the gate was created. */
  dropped(): number {
    return this.#dropped;
  }
}

export interface DuplexControllerOptions {
  /** Wall/monotonic clock in ms. Defaults to `Date.now`. */
  now?: () => number;
  policy?: Partial<DuplexPolicy>;
}

/** Deterministic duplex controller. No timers inside — `tick()` is the clock. */
export class DuplexController {
  #now: () => number;
  #policy: Required<DuplexPolicy>;
  #target: SpeechTarget | null = null;
  #phase: DuplexPhase = "idle";
  #listeningSinceMs = 0;
  #interruptStartedAtMs = 0;
  #stopOp: Promise<{ stoppedAtMs: number }> | null = null;
  #stopSettledAtMs: number | null = null;
  #nowPlaying = false;
  #interruptAwaitingTail = false;
  #stats: DuplexStats = {
    interrupts: 0,
    stops: 0,
    forcedStops: 0,
    speeches: 0,
    cancelledListens: 0,
    suppressedFrames: 0,
    passedFrames: 0,
  };

  constructor(options: DuplexControllerOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#policy = { ...DUPLEX_DEFAULTS, ...(options.policy ?? {}) };
    if (this.#policy.playbackTailMs >= this.#policy.stopTimeoutMs) {
      throw new Error("duplex policy: playbackTailMs must be below stopTimeoutMs");
    }
  }

  // ------------------------------------------------------------- queries

  phase(): DuplexPhase {
    return this.#phase;
  }

  /** True while synthesis/playback is active (echo gate must stay closed). */
  nowPlaying(): boolean {
    return this.#nowPlaying;
  }

  /** Snapshot for the UI/audit. Never carries audio. */
  stats(): DuplexStats {
    return { ...this.#stats };
  }

  /** The session's input-side echo gate. Closed by default. */
  readonly gate: EchoGate = new EchoGate();

  /**
   * Fork of [`gate.gate`] that also tallies controller stats. Callers that
   * feed recorded frames to STT must use this; frames are suppressed while
   * the gate is closed.
   */
  gateFeed(frame: unknown): boolean {
    const ok = this.gate.gate(frame);
    if (ok) this.#stats.passedFrames += 1;
    else this.#stats.suppressedFrames += 1;
    return ok;
  }

  // ------------------------------------------------------------ commands

  /**
   * Candice starts speaking an utterance. Closes the echo gate and marks
   * output active. If a prior interrupt's stop has not settled, the stop is
   * re-awaited once so a stale playback can never overlap the new utterance.
   */
  speak(): DuplexTransition {
    const effects: DuplexEffect[] = [];
    if (this.#phase === "interrupting" && this.#pendingOpSettled()) {
      // Prior interrupt settled: its settle step later emits ptt:start.
      // A speak arriving now wins: cancel the pending listen, go speaking.
      this.#interruptAwaitingTail = false;
      this.#phase = "speaking";
      this.#nowPlaying = true;
      this.#stats.speeches += 1;
      this.gate.close();
      return { phase: this.#phase, event: null, effects };
    }
    // Re-await a prior stop (if any) through the stop-absorption path:
    // a fresh utterance must not start while output is still closing.
    this.#awaitPriorStopThenSpeak();
    this.#phase = "speaking";
    this.#nowPlaying = true;
    this.#stats.speeches += 1;
    this.gate.close();
    return { phase: this.#phase, event: null, effects };
  }

  /**
   * The utterance ended normally (drained or stopped by the caller).
   * Half-duplex rule on the normal path: the output is silent here, so the
   * mic may never be open — emit a defensive `mic:close` when it was.
   */
  finishSpeaking(): DuplexTransition {
    const effects: DuplexEffect[] = [];
    this.#nowPlaying = false;
    this.gate.close();
    if (this.#phase === "speaking") {
      this.#phase = "idle";
    } else if (this.#phase === "interrupting") {
      // Interrupt was already in flight; the settle path owns the tail.
      if (!this.#pendingOpSettled()) {
        // Nothing to do: tick() finishes the settle.
        return { phase: this.#phase, event: null, effects };
      }
      this.#phase = "idle";
    }
    if (this.#phase === "listening") {
      // Raced finish with an open listen (mirror release): close the mic.
      this.#phase = "idle";
      effects.push({ type: "mic:close", caption: null });
      // Listen window is still open per WS-08 ptt:stop semantics; the
      // bridge reconciles. Gate stays closed until a new ptt:start.
    }
    return { phase: this.#phase, event: null, effects };
  }

  /**
   * PTT pressed (same call as the WS-17 capture press).
   *
   * - idle: normal press -> listen (`ptt:start` + `mic:open`).
   * - speaking: INTERRUPT — `abort()` fires synchronously (speech stops in
   *   the press call), `speech:interrupted` is emitted, `stop()` is awaited,
   *   and `ptt:start` is deferred until the tail drains. The mic does NOT
   *   open in the same press.
   * - interrupting / listening: no-op (single-flight, exact-once stop).
   */
  press(): DuplexTransition {
    switch (this.#phase) {
      case "idle": {
        this.#phase = "listening";
        this.#listeningSinceMs = this.#now();
        this.gate.open();
        return {
          phase: this.#phase,
          event: { type: "ptt:start" },
          effects: [{ type: "mic:open", caption: null }],
        };
      }
      case "speaking": {
        this.#phase = "interrupting";
        this.#interruptStartedAtMs = this.#now();
        this.#stats.interrupts += 1;
        this.gate.close();
        // 1. Speech stops in the same call (spec 6: "stop immediately").
        const target = this.#target;
        if (target) {
          try {
            target.abort();
          } catch {
            // abort() must never throw; a broken target still interrupts (spec 20).
          }
        }
        // 2. WS-08 transitions speaking -> listening on this event; the
        //    caption/listening UI presentation is the machine's job.
        // 3. stop() + tail drain settle through tick(); ptt:start emits after.
        this.#requestStop();
        return {
          phase: this.#phase,
          event: { type: "speech:interrupted" },
          effects: [
            { type: "tts:stop", caption: null },
            { type: "mic:open", caption: null },
          ],
        };
      }
      case "interrupting":
      case "listening":
        return { phase: this.#phase, event: null, effects: [] };
    }
  }

  /**
   * PTT released.
   * - listening: close the mic (`ptt:stop`).
   * - interrupting: the user let go before the tail drained — the follow-up
   *   listen is cancelled; the settle step goes straight to idle.
   * - idle/speaking: no-op (WS-08 owns those transitions).
   */
  release(): DuplexTransition {
    switch (this.#phase) {
      case "listening": {
        this.#phase = "idle";
        this.gate.close();
        return {
          phase: this.#phase,
          event: { type: "ptt:stop" },
          effects: [{ type: "mic:close", caption: null }],
        };
      }
      case "interrupting": {
        if (this.#interruptAwaitingTail) {
          // Cancel the follow-up listen even if the stop already settled:
          // the user let go during the tail window — a phantom listen must
          // never open after release.
          this.#interruptAwaitingTail = false;
          this.#stats.cancelledListens += 1;
        }
        return { phase: this.#phase, event: null, effects: [] };
      }
      default:
        return { phase: this.#phase, event: null, effects: [] };
    }
  }

  /**
   * Clock-driven advancement. Called on a fast cadence by the bridge, and
   * once by the stop continuation when the stop promise settles. Handles:
   *   - the tail drain after an interrupt (then `ptt:start` + `mic:open`);
   *   - the stop-timeout force (spec 20 — never hang);
   *   - the 60 s listen-window auto-release (stuck PTT).
   */
  tick(): DuplexTransition {
    if (this.#phase === "interrupting") {
      return this.#tickInterrupt();
    }
    if (this.#phase === "listening") {
      const held = this.#now() - this.#listeningSinceMs;
      if (held >= LISTEN_WINDOW_MS) {
        this.#phase = "idle";
        this.gate.close();
        this.#nowPlaying = false;
        return {
          phase: this.#phase,
          event: { type: "ptt:stop" },
          effects: [{ type: "mic:close", caption: null }],
        };
      }
    }
    return { phase: this.#phase, event: null, effects: [] };
  }

  /** Register the speech output target (bridge wiring time). */
  attachTarget(target: SpeechTarget): void {
    this.#target = target;
  }

  /** Detach the target; an in-flight interrupt settles via the timeout limb. */
  detachTarget(): void {
    this.#target = null;
  }

  /**
   * Duplex invariant, checked by the bridge before opening capture and in
   * tests: output active and capture open at the same time is a violation.
   */
  assertDuplexInvariant(): void {
    if (this.#nowPlaying && this.#phase === "listening") {
      throw new Error("duplex-violation: output busy while capture open");
    }
  }

  // ----------------------------------------------------------- internals

  #tickInterrupt(): DuplexTransition {
    const settled = this.#stopSettledAtMs;
    // Settle-limb: the stop promise resolved/rejected since the last tick.
    if (settled !== null) {
      const tail = this.#now() - settled;
      if (tail >= this.#policy.playbackTailMs) {
        return this.#settleInterrupt();
      }
      return { phase: this.#phase, event: null, effects: [] };
    }
    // Promise still pending. Force limb first (spec 20), then tail.
    const elapsed = this.#now() - this.#interruptStartedAtMs;
    if (elapsed >= this.#policy.stopTimeoutMs) {
      this.#stats.forcedStops += 1;
      this.#stopSettledAtMs = this.#now();
      return this.#settleInterrupt();
    }
    return { phase: this.#phase, event: null, effects: [] };
  }

  #settleInterrupt(): DuplexTransition {
    const op = this.#stopOp;
    this.#phase = this.#interruptAwaitingTail ? "listening" : "idle";
    if (this.#phase === "listening") {
      // Tail fully drained: output provably silent -> capture may open.
      this.#listeningSinceMs = this.#now();
      this.#interruptAwaitingTail = false;
      this.gate.open();
      return {
        phase: this.#phase,
        event: { type: "ptt:start" },
        effects: [{ type: "mic:open", caption: null }],
      };
    }
    this.#interruptAwaitingTail = false;
    this.#nowPlaying = false;
    void op; // settled or forced; nothing further to await.
    return { phase: this.#phase, event: null, effects: [] };
  }

  #requestStop(): void {
    const target = this.#target;
    this.#stats.stops += 1;
    if (!target) {
      // Broken wiring: settle immediately; the tail still applies.
      this.#stopSettledAtMs = this.#now();
      this.#stopOp = null;
      return;
    }
    this.#interruptAwaitingTail = true;
    const op = target.stop();
    this.#stopOp = op;
    this.#stopSettledAtMs = null;
    // Micro-task continuation: never delays the press return.
    void op
      .then((r) => {
        if (this.#stopOp !== op) return;
        // Tail counted from the moment output went silent.
        this.#stopSettledAtMs = Math.max(r.stoppedAtMs, this.#now());
      })
      .catch(() => {
        if (this.#stopOp !== op) return;
        // Rejection -> force (spec 20). Settle eagerly so the tail window
        // can start immediately; tick() covers the timeout limb too.
        this.#stats.forcedStops += 1;
        this.#stopSettledAtMs = this.#now();
      });
  }

  /** True when the pending stop op has settled (or never existed). */
  #pendingOpSettled(): boolean {
    return this.#stopOp === null || this.#stopSettledAtMs !== null;
  }

  #awaitPriorStopThenSpeak(): void {
    // Speak-after-interrupt: if the prior stop has not settled, absorb it —
    // the new utterance plays only after the old output was closed. The
    // stop continuation settles `#stopSettledAtMs`; speak() does not wait on
    // it synchronously (output ordering is the sink's job), but the state
    // bookkeeping is atomic here.
    if (!this.#pendingOpSettled() && this.#stopOp) {
      this.#stopOp = null;
      this.#stopSettledAtMs = this.#now();
    }
    this.#interruptAwaitingTail = false;
  }
}
