/**
 * Gesture animation driver (WS-13). Pure presentation: it renders motion
 * for a given status; it never changes the status (WS-08 owns that).
 *
 * Mechanism (spec 10 "Prefer" list only):
 * - layer-swap: one gesture layer active at a time via classes
 * - transform: blink (scaleY on eye layer), breathing (scale on body),
 *   head drift (translate on head layer)
 * - opacity: glow layers for speaking/listening/processing
 *
 * Light/dark background contract (E.1): this lane paints no colors and no
 * backgrounds. The stage is transparent; the only classes it toggles are
 * documented in CONTRACT.md and the CSS keyframes it emits are transform/
 * opacity-only. Pixel-level alpha proof on both backgrounds is WS-15's
 * visual harness; this lane guarantees the source-of-truth shape it needs.
 *
 * Reduced motion (spec 9): when the root carries `candice-reduced-motion`
 * (WS-14's consumer class), continuous loops stop; the current gesture
 * layer and a STATIC glow remain, so the character is never invisible.
 *
 * Pause-safe: loops use the real elapsed delta per tick (timers.ts); the
 * driver degrades to no-op when the DOM is missing (text fallback runs
 * headless) and never throws from render paths (spec 20).
 *
 * @module
 */

import type { CandiceStatus } from '../../state/status.ts';
import {
  GESTURE_ACTIVE_CLASS,
  GESTURE_INACTIVE_CLASS,
  GESTURE_STAGE_ATTR,
  GESTURE_TIMING,
  GLOW_STAGE_ATTR,
  IDLE_GLOW_INTENSITY,
  LISTENING_GLOW_INTENSITY,
  PROCESSING_GLOW_INTENSITY,
  REDUCED_MOTION_CLASS,
  REDUCED_MOTION_GLOW_CAP,
  SPEAKING_GLOW_INTENSITY,
} from './config.ts';
import { createGestureRegistry } from './gestures.ts';
import type { GestureLayer } from './gestures.ts';
import {
  breathScale,
  glowIntensity,
  headDriftPx,
  eyeOpenRatio,
} from './motion.ts';
import { scheduleLoop } from './timers.ts';
import type { ScheduledLoop } from './timers.ts';

export type { GestureLayer } from './gestures.ts';

export interface GestureDriver {
  /** Apply the status's gesture + glow. Idempotent; null-DOM safe. */
  setStatus(status: CandiceStatus): void;
  /** Register a lazy-loaded final-art layer (WS-11 path). */
  registerLayer(layer: GestureLayer): boolean;
  /** Bind to a DOM stage. May be called once or after unbind. */
  attach(stage: HTMLElement | null): void;
  /** Detach all loops and DOM references. Idempotent. */
  detach(): void;
  /** True when a continuous loop is running. */
  readonly active: boolean;
  /** The status the driver is currently rendering. */
  readonly status: CandiceStatus;
}

interface LoopSet {
  blink: ScheduledLoop | null;
  idle: ScheduledLoop | null;
  head: ScheduledLoop | null;
  glow: ScheduledLoop | null;
}

const EMPTY_LOOPS: LoopSet = {
  blink: null,
  idle: null,
  head: null,
  glow: null,
};

const FALLBACK_STATUS: CandiceStatus = 'idle';

export function createGestureDriver(): GestureDriver {
  const registry = createGestureRegistry();
  let stage: HTMLElement | null = null;
  let glowStage: HTMLElement | null = null;
  let currentStatus: CandiceStatus = FALLBACK_STATUS;
  let detached = true;
  let loops: LoopSet = { ...EMPTY_LOOPS };
  let motionWatcher: MutationObserver | null = null;

  // Phase accumulators (per loop, from real elapsed deltas).
  let breathPhase = 0;
  let driftPhase = 0;
  let glowPhase = 0;
  let blinkElapsed = 0;

  function queryStage(root: HTMLElement | null): HTMLElement | null {
    if (!root) return null;
    return root.querySelector<HTMLElement>(`[${GESTURE_STAGE_ATTR}]`) ?? root;
  }

  function queryGlow(root: HTMLElement | null): HTMLElement | null {
    if (!root) return null;
    return root.querySelector<HTMLElement>(`[${GLOW_STAGE_ATTR}]`);
  }

  function reducedMotion(): boolean {
    if (!stage) return false;
    const root = stage.ownerDocument?.documentElement;
    return (root?.classList.contains(REDUCED_MOTION_CLASS)) === true;
  }

  function applyLayerSwap(status: CandiceStatus): void {
    if (!stage) return;
    const { gesture } = registry.planFor(status);
    // Exactly one active gesture layer; every other known layer inactive.
    for (const child of Array.from(stage.children)) {
      const isActive = child.getAttribute('data-candice-gesture') === gesture;
      child.classList.toggle(GESTURE_ACTIVE_CLASS, isActive);
      child.classList.toggle(GESTURE_INACTIVE_CLASS, !isActive);
    }
    stage.setAttribute('data-candice-gesture-active', gesture);
  }

  function applyGlow(status: CandiceStatus, intensity: number): void {
    if (!glowStage) return;
    const safe = reducedMotion()
      ? Math.min(intensity, REDUCED_MOTION_GLOW_CAP)
      : intensity;
    glowStage.style.opacity = String(Math.max(0, Math.min(1, safe)));
    glowStage.setAttribute('data-candice-glow-status', status);
  }

  function stopAllLoops(): void {
    for (const key of Object.keys(loops) as (keyof LoopSet)[]) {
      const loop = loops[key];
      if (loop) {
        loop.cancel();
        loops[key] = null;
      }
    }
  }

  /**
   * Statuses that hold a STILL pose. Everything else animates.
   *
   * This used to test the incoming status against `CONTINUOUS_STATES`, and
   * that comparison could never match at rest. `CONTINUOUS_STATES` is this
   * lane's own vocabulary — `blinking`, `idling`, `listening`, `thinking` —
   * while `setStatus()` is handed a WS-08 `CandiceStatus`, whose values are
   * `idle | listening | transcribing | confirming | thinking | speaking |
   * compact | recovering | text-fallback` (`src/state/status.ts`). Only
   * `listening` and `thinking` appear in both lists. `'idle'` never equals
   * `'idling'`, so `startContinuous()` never ran in the state the companion
   * actually sits in — `src/shell/gesture-stage.ts` calls `setStatus('idle')`
   * at mount — and the character was a still image no matter how large
   * `GESTURE_TIMING.idleBreathScaleMax` was set. `speaking` was missing for
   * the same reason, so nothing animated while she talked either.
   *
   * Inverting the test is deliberate: a status this lane has not heard of
   * should breathe, not freeze. The still list is short and each entry earns
   * its place — a transient round trip, or a surface where the driver no
   * longer owns the character.
   */
  const STILL_STATUSES: readonly CandiceStatus[] = [
    // Sub-second round trips; motion here reads as a twitch, and the WS-13
    // acceptance suite pins `confirming` as static.
    'transcribing',
    'confirming',
    // The shell is repairing itself; the layer under us may be swapped.
    'recovering',
    // The character is detached entirely (spec 20 text mode).
    'text-fallback',
  ];

  function continuousStatus(status: CandiceStatus): boolean {
    return !STILL_STATUSES.includes(status);
  }

  function startBlinkLoop(): void {
    loops.blink = scheduleLoop(16, (elapsed) => {
      if (!stage) return;
      blinkElapsed += elapsed;
      const period = GESTURE_TIMING.blinkPeriodMs;
      const closed = GESTURE_TIMING.blinkClosedMs;
      const inCycle = blinkElapsed % period;
      const closedUnits =
        inCycle < closed ? 1 : (inCycle - closed) < closed ? 0.5 : 0;
      const ratio = eyeOpenRatio(closedUnits);
      for (const eye of Array.from(
        stage.querySelectorAll<HTMLElement>('[data-candice-eye]'),
      )) {
        eye.style.transform = `scaleY(${ratio.toFixed(3)})`;
        eye.style.opacity = String(ratio < 0.05 ? 0.05 : 1);
      }
    });
  }

  function startIdleLoop(): void {
    loops.idle = scheduleLoop(32, (elapsed) => {
      if (!stage) return;
      const period = GESTURE_TIMING.idleBreathPeriodMs;
      breathPhase = (breathPhase + (elapsed / period) * Math.PI * 2) % (Math.PI * 2);
      const scale = breathScale(breathPhase);
      for (const body of Array.from(
        stage.querySelectorAll<HTMLElement>('[data-candice-body]'),
      )) {
        body.style.transform = `scale(${scale.toFixed(4)})`;
      }
    });
  }

  function startHeadLoop(): void {
    loops.head = scheduleLoop(50, (elapsed) => {
      if (!stage) return;
      const period = GESTURE_TIMING.idleBreathPeriodMs;
      driftPhase = (driftPhase + (elapsed / period) * Math.PI * 2) % (Math.PI * 2);
      const px = headDriftPx(driftPhase);
      for (const head of Array.from(
        stage.querySelectorAll<HTMLElement>('[data-candice-head]'),
      )) {
        head.style.transform = `translateX(${px.toFixed(3)}px)`;
      }
    });
  }

  function startGlowLoop(): void {
    loops.glow = scheduleLoop(50, (elapsed) => {
      if (!glowStage) return;
      const period = GESTURE_TIMING.glowPulsePeriodMs;
      glowPhase = (glowPhase + (elapsed / period) * Math.PI * 2) % (Math.PI * 2);
      applyGlow(currentStatus, glowIntensity(glowPhase, intensityFor(currentStatus)));
    });
  }

  function stopContinuous(): void {
    for (const key of ['blink', 'idle', 'head', 'glow'] as const) {
      const loop = loops[key];
      if (loop) {
        loop.cancel();
        loops[key] = null;
      }
    }
  }

  function startContinuous(): void {
    if (!stage || detached) return;
    if (reducedMotion()) {
      restToNeutral();
      applyGlow(currentStatus, REDUCED_MOTION_GLOW_CAP);
      return;
    }
    startBlinkLoop();
    startIdleLoop();
    startHeadLoop();
    startGlowLoop();
  }

  /**
   * Return every motion target to its rest pose.
   *
   * Cancelling the loops alone is not enough: the LAST value each loop wrote
   * stays on the element, so the character freezes wherever the breath
   * happened to be — mid-inhale at `scale(1.02)`, or worse, mid-blink with a
   * squashed eye. Reduced motion is supposed to leave the approved idle pose,
   * not an arbitrary frame of an animation that is no longer running.
   */
  function restToNeutral(): void {
    if (!stage) return;
    for (const body of Array.from(
      stage.querySelectorAll<HTMLElement>('[data-candice-body]'),
    )) {
      body.style.transform = 'scale(1)';
    }
    for (const head of Array.from(
      stage.querySelectorAll<HTMLElement>('[data-candice-head]'),
    )) {
      head.style.transform = 'translateX(0px)';
    }
    for (const eye of Array.from(
      stage.querySelectorAll<HTMLElement>('[data-candice-eye]'),
    )) {
      eye.style.transform = 'scaleY(1)';
      eye.style.opacity = '1';
    }
  }

  /**
   * Re-evaluate motion because the reduced-motion CLASS changed, not because
   * the status did.
   *
   * `startContinuous()` samples `reducedMotion()` once, at start. Nothing
   * re-sampled it afterwards, so a preference that flipped while the loops
   * were already running had no effect until the next status change — the
   * animation-off toggle set the class and the character kept breathing, and
   * the OS `prefers-reduced-motion` listener in the WS-14 lane had the same
   * blind spot. This is the missing subscription.
   */
  function reapplyMotionPreference(): void {
    if (!stage || detached) return;
    if (!continuousStatus(currentStatus)) return;
    const wantStill = reducedMotion();
    const running = loops.blink !== null || loops.idle !== null
      || loops.head !== null || loops.glow !== null;
    if (wantStill === !running) return; // already in the requested state
    stopContinuous();
    startContinuous();
  }

  /**
   * Watch `<html>` for the shared reduced-motion class. The WS-14 a11y lane
   * remains the only WRITER of that class; this is a read-only subscription
   * so the driver notices a change it did not cause. Absent MutationObserver
   * (or a DOM at all) the driver simply keeps its start-time behavior.
   */
  function watchMotionPreference(): void {
    unwatchMotionPreference();
    try {
      const root = stage?.ownerDocument?.documentElement;
      const view = stage?.ownerDocument?.defaultView as
        | { MutationObserver?: typeof MutationObserver }
        | null
        | undefined;
      const Observer = view?.MutationObserver
        ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      if (!root || !Observer) return;
      motionWatcher = new Observer(() => reapplyMotionPreference());
      motionWatcher.observe(root, { attributes: true, attributeFilter: ['class'] });
    } catch {
      motionWatcher = null; // never throw from attach (spec 20)
    }
  }

  function unwatchMotionPreference(): void {
    try {
      motionWatcher?.disconnect();
    } catch {
      // best-effort teardown
    }
    motionWatcher = null;
  }

  function intensityFor(status: CandiceStatus): number {
    switch (status) {
      case 'speaking':
        return SPEAKING_GLOW_INTENSITY;
      case 'listening':
        return LISTENING_GLOW_INTENSITY;
      case 'thinking':
      case 'transcribing':
      case 'confirming':
        return PROCESSING_GLOW_INTENSITY;
      default:
        return IDLE_GLOW_INTENSITY;
    }
  }

  return {
    get status() {
      return currentStatus;
    },
    get active() {
      return !detached && (loops.blink !== null || loops.idle !== null || loops.head !== null || loops.glow !== null);
    },
    setStatus(status: CandiceStatus): void {
      currentStatus = status;
      applyLayerSwap(status);
      if (continuousStatus(status)) {
        stopContinuous();
        startContinuous();
      } else {
        stopContinuous();
        applyGlow(status, intensityFor(status));
      }
    },
    registerLayer(layer: GestureLayer): boolean {
      return registry.register(layer);
    },
    attach(root: HTMLElement | null): void {
      stopAllLoops();
      stage = queryStage(root);
      glowStage = queryGlow(root);
      detached = stage === null;
      if (!stage) return;
      watchMotionPreference();
      applyLayerSwap(currentStatus);
      if (continuousStatus(currentStatus)) startContinuous();
    },
    detach(): void {
      stopAllLoops();
      unwatchMotionPreference();
      stage = null;
      glowStage = null;
      detached = true;
    },
  };
}
