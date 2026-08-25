/**
 * Viseme → mouth renderer (WS-12 output stage, FIX-005/FIX-016).
 *
 * The scheduler was a pull API with nothing pulling it. `speech-timing.ts`
 * already feeds real phoneme timings into `VisemeScheduler.start()`, and
 * `visemeAt()` already computes the correct mouth shape for any instant —
 * but `visemeAt` and `stepsAt` had zero call sites outside their own tests.
 * Input wired, computation correct, output never read: the mouth could not
 * move no matter how good the timings were. This module is the missing
 * consumer, and nothing else in the app polls the scheduler.
 *
 * Contract:
 *  - The mouth moves ONLY while an utterance is actually scheduled. The
 *    instant playback ends — natural drain, interruption, or error — the
 *    mouth returns to the approved neutral (`03-mouth-neutral-closed`).
 *  - Only approved cutouts are used. The viseme→state map is derived from
 *    the build record, never hand-written, so it cannot drift from the
 *    measured registration (see `mouthStateForViseme`).
 *  - Never throws from the tick (spec 20). A failure inside the render path
 *    parks the mouth at neutral and stops the loop rather than propagating.
 *  - Reduced motion and the animation-off toggle hold the mouth at neutral,
 *    because lip sync is animation like any other.
 *
 * The surface is taken structurally (`MouthSurface`), not as an import of
 * the face stage. The renderer therefore does not depend on that module's
 * shape and cannot be broken by edits to it.
 *
 * @module
 */

import { LAYER_REGISTRATION, VISEME_LAYER_FILES } from "./layers.ts";
import type { VisemeId } from "./types.ts";
import { scheduleLoop } from "../gesture/timers.ts";
import type { Clock, ScheduledLoop } from "../gesture/timers.ts";

/** Shared reduced-motion class written by the WS-14 a11y controller. */
const MOUTH_REDUCED_MOTION_CLASS = "candice-reduced-motion";

/**
 * Poll interval. Matches the blink loop: fine enough that a 50ms minimum
 * viseme span (the scheduler's floor) is never skipped entirely.
 */
export const MOUTH_TICK_MS = 16;

/**
 * The mouth surface this renderer drives. Structural on purpose — the face
 * stage satisfies it without this module importing it.
 */
export interface MouthSurface {
  /** Swap the mouth cutout. Unknown states are ignored by the surface. */
  setMouthState(state: string): void;
  /** True while the bust (and therefore the mouth) is on screen. */
  readonly visible: boolean;
}

/** The scheduler surface consumed. `VisemeScheduler` satisfies it. */
export interface VisemeSource {
  readonly active: boolean;
  visemeAt(nowMs: number): VisemeId;
}

export interface MouthRendererOptions {
  scheduler: VisemeSource;
  surface: MouthSurface;
  /**
   * MUST be the same clock the scheduler was constructed with: `visemeAt`
   * takes scheduler-clock milliseconds, and the scheduler stamps its start
   * from its own clock. Production uses the default on both sides.
   */
  clock?: Clock;
  /** True when animation is off (toggle) or the OS asked for reduced motion. */
  motionOff?: () => boolean;
  /** Injected so tests drive ticks deterministically instead of sleeping. */
  schedule?: (intervalMs: number, tick: (elapsedMs: number) => void) => ScheduledLoop;
}

export interface MouthRenderer {
  /** Begin polling. Idempotent. */
  start(): void;
  /** Stop polling and park the mouth at the approved neutral. Idempotent. */
  stop(): void;
  readonly running: boolean;
  /** The state last written to the surface; evidence for tests and probes. */
  readonly currentState: string;
}

/**
 * Registration state key for a viseme, resolved through the build record.
 *
 * `VISEME_LAYER_FILES` maps a viseme to a cutout FILE; the face surface is
 * addressed by registration STATE KEY. Deriving the key from the file keeps
 * one authority (the build record) instead of a second hand-written table
 * that could silently disagree with the measured rects.
 *
 * Throws at module load on divergence, exactly as `layers.ts` does: a build
 * record that cannot satisfy the viseme set is a build fault, and boot turns
 * it into the honest text fallback rather than a wrong mouth.
 */
function mouthStateForViseme(viseme: VisemeId): string {
  const file = VISEME_LAYER_FILES[viseme];
  for (const [state, entry] of Object.entries(LAYER_REGISTRATION.mouthStates)) {
    if (entry.file === file) return state;
  }
  throw new Error(
    `viseme "${viseme}" maps to layer file "${file}" with no matching ` +
      `mouthStates key in the build record`,
  );
}

/** Viseme → registration mouth-state key. Built once, fail-loud. */
export const MOUTH_STATE_FOR_VISEME: Readonly<Record<VisemeId, string>> = Object.freeze({
  closed: mouthStateForViseme("closed"),
  rest: mouthStateForViseme("rest"),
  mm: mouthStateForViseme("mm"),
  ai: mouthStateForViseme("ai"),
  ee: mouthStateForViseme("ee"),
  oh: mouthStateForViseme("oh"),
  wide: mouthStateForViseme("wide"),
});

/**
 * The approved resting mouth: the registration state carrying source 03
 * (`03-mouth-neutral-closed`). Derived rather than hard-coded so a renamed
 * state key cannot leave the mouth parked on the wrong cutout.
 */
export const NEUTRAL_MOUTH_STATE: string = (() => {
  for (const [state, entry] of Object.entries(LAYER_REGISTRATION.mouthStates)) {
    if (entry.source === "03") return state;
  }
  throw new Error("build record has no source-03 mouth state (neutral closed)");
})();

/** Default motion check: the shared reduced-motion class on <html>. */
function defaultMotionOff(): boolean {
  try {
    const docEl = globalThis.document?.documentElement;
    return docEl?.classList?.contains(MOUTH_REDUCED_MOTION_CLASS) === true;
  } catch {
    // A missing/hostile document must not decide that motion is ON.
    return false;
  }
}

export function createMouthRenderer(options: MouthRendererOptions): MouthRenderer {
  const { scheduler, surface } = options;
  const clock: Clock = options.clock ?? { now: () => performance.now() };
  const motionOff = options.motionOff ?? defaultMotionOff;
  const schedule = options.schedule ?? ((ms, tick) => scheduleLoop(ms, tick));

  let loop: ScheduledLoop | null = null;
  // Seeded to neutral: the mouth is closed before a word is ever spoken,
  // and the first write is suppressed only if it agrees with that truth.
  let currentState = NEUTRAL_MOUTH_STATE;
  let wrote = false;

  /** Write only on change; a swap per frame would thrash the layer. */
  function apply(state: string): void {
    if (wrote && state === currentState) return;
    currentState = state;
    wrote = true;
    surface.setMouthState(state);
  }

  function desiredState(): string {
    // Lip sync is animation: the toggle and the OS preference stop it.
    if (motionOff()) return NEUTRAL_MOUTH_STATE;
    // Not speaking, or the bust is not the visible surface: rest closed.
    if (!scheduler.active || !surface.visible) return NEUTRAL_MOUTH_STATE;
    return MOUTH_STATE_FOR_VISEME[scheduler.visemeAt(clock.now())] ?? NEUTRAL_MOUTH_STATE;
  }

  function tick(): void {
    try {
      apply(desiredState());
    } catch {
      // Fail closed (spec 20): park at the approved neutral and stop rather
      // than throw out of a render tick or leave the mouth mid-phoneme.
      stop();
    }
  }

  function start(): void {
    if (loop && !loop.cancelled) return;
    loop = schedule(MOUTH_TICK_MS, tick);
  }

  function stop(): void {
    loop?.cancel();
    loop = null;
    try {
      apply(NEUTRAL_MOUTH_STATE);
    } catch {
      // The surface is already gone; there is nothing left to reset.
    }
  }

  return {
    start,
    stop,
    get running() {
      return loop !== null && !loop.cancelled;
    },
    get currentState() {
      return currentState;
    },
  };
}
