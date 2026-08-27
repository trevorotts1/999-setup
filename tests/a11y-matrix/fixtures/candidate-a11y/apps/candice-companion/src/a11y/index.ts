/**
 * Accessibility public surface (Master Spec 0E WS-14).
 *
 * Single-file barrel: consuming lanes import one stable path
 * (`@candice/a11y`) — the WS-13 gesture lane and the WS-09/WS-10 UI
 * lanes already consume the shared `candice-reduced-motion` class name;
 * this barrel is the definition authority. Never deep-import.
 *
 * @module
 */

export {
  A11Y_CONTRACT_VERSION,
  REDUCED_MOTION_CLASS,
  REDUCED_MOTION_QUERY,
  REDUCED_MOTION_EVENT,
  REDUCED_MOTION_TIERS,
} from './config.ts';
export type { ReducedMotionPreference, ReducedMotionTier } from './config.ts';

export {
  createReducedMotionState,
  isReducedMotionTier,
} from './motion.ts';
export type { ReducedMotionListener, ReducedMotionState } from './motion.ts';

export {
  applyReducedMotion,
  applyReducedMotionForPreference,
  resolveReducedMotionTier,
  tierFromMedia,
  tierFromPreference,
} from './apply.ts';
export type {
  A11yMediaLike,
  A11yWindowLike,
  ReducedMotionApplyResult,
} from './apply.ts';

export { createA11yController } from './controller.ts';
export type { A11yController, A11yControllerOptions, A11yMediaSource } from './controller.ts';

export {
  ensureAriaLabel,
  setKeyboardOnlyFocusable,
  setLiveRegion,
} from './focus.ts';
