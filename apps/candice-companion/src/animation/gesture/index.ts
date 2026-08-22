/**
 * Gesture animation lane public surface (Master Spec 0E WS-13).
 *
 * Consumers import from here only. The lane owns blink, idle/breathing,
 * head movement, gestures, and the speaking/listening/processing glow —
 * sprite/layer-swap, transform, and opacity only (spec 10). Mouth/viseme
 * is WS-12's lane (`src/animation/viseme/`); accessibility gating is
 * WS-14's lane (`src/a11y/`) — this lane consumes its reduced-motion
 * class but never defines it.
 *
 * @module
 */

export {
  ANIMATION_KINDS,
  BOOT_GESTURES,
  CONTINUOUS_STATES,
  GESTURE_ACTIVE_CLASS,
  GESTURE_CONTRACT_VERSION,
  GESTURE_IDS,
  GESTURE_INACTIVE_CLASS,
  GESTURE_STAGE_ATTR,
  GESTURE_STATUS_CONTRACT,
  GESTURE_TIMING,
  GLOW_STAGE_ATTR,
  IDLE_GLOW_INTENSITY,
  LISTENING_GLOW_INTENSITY,
  PROCESSING_GLOW_INTENSITY,
  REDUCED_MOTION_CLASS,
  REDUCED_MOTION_GLOW_CAP,
  SPEAKING_GLOW_INTENSITY,
} from './config.ts';
export type { AnimationKind, ContinuousState, GestureId } from './config.ts';

export { createGestureDriver } from './driver.ts';
export type { GestureDriver } from './driver.ts';

export {
  createGestureRegistry,
  gestureForStatus,
  placeholderLayer,
} from './gestures.ts';
export type { GestureLayer, GesturePlan } from './gestures.ts';

export { createGlowSurface, findGlowSurface } from './glow.ts';

export {
  breathScale,
  eyeOpenRatio,
  glowIntensity,
  headDriftPx,
  staggerPhase,
} from './motion.ts';
export type { BreathPhase, DriftPhase, EyePhase } from './motion.ts';

export { monotonicClock, scheduleDelay, scheduleLoop } from './timers.ts';
export type { Clock, ScheduledLoop } from './timers.ts';
