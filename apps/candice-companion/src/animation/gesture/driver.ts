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
  CONTINUOUS_STATES,
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

  function continuousStatus(status: CandiceStatus): boolean {
    return (CONTINUOUS_STATES as readonly string[]).includes(status);
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
      applyGlow(currentStatus, REDUCED_MOTION_GLOW_CAP);
      return;
    }
    startBlinkLoop();
    startIdleLoop();
    startHeadLoop();
    startGlowLoop();
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
      applyLayerSwap(currentStatus);
      if (continuousStatus(currentStatus)) startContinuous();
    },
    detach(): void {
      stopAllLoops();
      stage = null;
      glowStage = null;
      detached = true;
    },
  };
}
