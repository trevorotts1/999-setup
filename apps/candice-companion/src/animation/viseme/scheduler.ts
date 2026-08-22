/**
 * Candice viseme scheduler (WS-12).
 *
 * Translates TTS phoneme timings into time-anchored mouth steps on a local
 * monotonic clock. The scheduler is deliberately a pure, asset-free state
 * machine: it knows nothing about PNGs, DOM nodes, or the TTS runtime. The
 * face-render lane (WS-11/WS-13) consumes `VisemeStep` and applies the
 * mouth state to the current asset.
 *
 * Alignment design (spec 11A "switch/warp only the minimum face/mouth
 * region where possible"): a spoken viseme leads the mouth switch so the
 * lips are in position when the sound arrives. The lead is bounded so
 * long silences do not hold the mouth open.
 *
 * Cross-fade design: when `blendMode` is "crossfade", a gap between two
 * different visemes emits an inter-viseme step in the first half of the
 * gap, which the renderer cross-fades toward the next viseme. Direct mode
 * (default) emits no inter-step (cheap sprite swaps, spec 10).
 */

import {
  shouldBlend,
  timingToVisemeEvent,
} from "./mapping.ts";
import type {
  Clock,
  VisemeBlendMode,
  VisemeEvent,
  VisemeId,
  VisemeStep,
} from "./types.ts";

/** Tunables; bounds enforced in the constructor. */
export interface SchedulerOptions {
  /** Clock in ms; defaults to performance.now. */
  clock?: Clock;
  /** Mouth-shape lead before the audio span, ms. Default 60. */
  leadMs?: number;
  /** Minimum viseme span after normalization, ms. Default 50. */
  minSpanMs?: number;
  /** Inter-viseme blend mode. Default "direct". */
  blendMode?: VisemeBlendMode;
}

const DEFAULT_OPTIONS: Required<Omit<SchedulerOptions, "clock">> = {
  leadMs: 60,
  minSpanMs: 50,
  blendMode: "direct",
};

const DEFAULT_CLOCK: Clock = { now: () => performance.now() };

export class VisemeScheduler {
  readonly #clock: Clock;
  readonly #leadMs: number;
  readonly #minSpanMs: number;
  readonly #blendMode: VisemeBlendMode;

  #startWallMs = 0;
  #started = false;
  #events: VisemeEvent[] = [];

  constructor(options: SchedulerOptions = {}) {
    this.#clock = options.clock ?? DEFAULT_CLOCK;
    this.#leadMs = clampNonNegative(options.leadMs, DEFAULT_OPTIONS.leadMs);
    this.#minSpanMs = clampPositive(options.minSpanMs, DEFAULT_OPTIONS.minSpanMs);
    this.#blendMode = options.blendMode ?? DEFAULT_OPTIONS.blendMode;
  }

  /**
   * Load a TTS utterance's phoneme timings. Any timings that do not map
   * to a valid viseme event are skipped (garbage in, gap out — the state
   * machine must never throw on real-world TTS output).
   */
  start(timings: ReadonlyArray<{ phoneme: string; startSec: number; endSec: number }>): void {
    const events: VisemeEvent[] = [];
    for (const t of timings) {
      const ev = timingToVisemeEvent(t.phoneme, t.startSec, t.endSec);
      if (ev) {
        events.push(ev);
      }
    }
    // Sort defensively: TTS runtimes occasionally emit out-of-order spans.
    events.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
    if (events.length === 0) {
      // Nothing speakable: an utterance with no valid visemes is idle.
      this.stop();
      return;
    }
    this.#events = events;
    this.#startWallMs = this.#clock.now();
    this.#started = true;
  }

  /** Forget the current utterance; the mouth returns to idle. */
  stop(): void {
    this.#events = [];
    this.#startWallMs = 0;
    this.#started = false;
  }

  /**
   * Steps covering `[nowMs, nowMs + windowMs]`, in scheduler-clock time.
   * Never throws; returns an empty list when idle or outside the event
   * horizon. Steps are non-overlapping and ordered.
   */
  stepsAt(nowMs: number, windowMs: number): VisemeStep[] {
    if (!Number.isFinite(nowMs) || !Number.isFinite(windowMs) || windowMs <= 0) {
      return [];
    }
    if (!this.#started) {
      return [];
    }
    const horizon = nowMs + windowMs;
    const steps: VisemeStep[] = [];
    for (let i = 0; i < this.#events.length; i++) {
      const ev = this.#events[i];
      let startMs = this.#startWallMs + ev.startSec * 1000 - this.#leadMs;
      let endMs = this.#startWallMs + ev.endSec * 1000;
      if (i > 0) {
        const prev = this.#events[i - 1];
        if (startMs < prev.endSec * 1000 + this.#startWallMs) {
          startMs = prev.endSec * 1000 + this.#startWallMs;
        }
      }
      if (endMs <= startMs) {
        continue;
      }
      if (endMs - startMs < this.#minSpanMs) {
        endMs = startMs + this.#minSpanMs;
      }
      if (startMs >= horizon || endMs <= nowMs) {
        continue;
      }
      const clampedStart = Math.max(startMs, nowMs);
      const clampedEnd = Math.min(endMs, horizon);
      if (clampedEnd <= clampedStart) {
        continue;
      }
      steps.push({ viseme: ev.viseme, startMs: clampedStart, endMs: clampedEnd });

      // Cross-fade inter-step: first half of the gap before a different
      // next viseme. `shouldBlend` validates mode, gap, and shape change.
      const next = this.#events[i + 1];
      if (next) {
        const nextStartMs = this.#startWallMs + next.startSec * 1000 - this.#leadMs;
        if (shouldBlend(this.#blendMode, ev, next) && endMs < nextStartMs) {
          const blendMs = (endMs + nextStartMs) / 2;
          const blendEndMs = Math.min(nextStartMs, horizon);
          if (blendMs > nowMs && blendMs < blendEndMs) {
            steps.push({ viseme: next.viseme, startMs: blendMs, endMs: blendEndMs });
          }
        }
      }
    }
    return steps;
  }

  /** True when an utterance is loaded. */
  get active(): boolean {
    return this.#started;
  }

  /** Current mouth shape at the given scheduler-clock ms, "closed" if idle. */
  visemeAt(nowMs: number): VisemeId {
    for (const st of this.stepsAt(nowMs, 1)) {
      if (nowMs >= st.startMs && nowMs <= st.endMs) {
        return st.viseme;
      }
    }
    if (this.active && nowMs < this.#utteranceEndMs()) {
      return "rest";
    }
    return "closed";
  }

  /** End of the last scheduled viseme span in scheduler-clock ms. */
  #utteranceEndMs(): number {
    if (!this.#started || this.#events.length === 0) {
      return 0;
    }
    const last = this.#events[this.#events.length - 1];
    return this.#startWallMs + last.endSec * 1000;
  }
}

function clampNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}
