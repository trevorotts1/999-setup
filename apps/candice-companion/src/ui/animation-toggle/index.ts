/**
 * Animation-off toggle public surface.
 *
 * Single barrel so the composition root imports one stable path and never
 * deep-imports the controller (mirrors the WS-14 a11y barrel convention).
 *
 * @module
 */

export {
  ANIMATION_TOGGLE_CLASS,
  ANIMATION_TOGGLE_ID,
  ANIMATION_TOGGLE_LABEL,
  ANIMATION_TOGGLE_OFF_HINT,
  ANIMATION_TOGGLE_ON_HINT,
  ANIMATION_TOGGLE_OS_HINT,
  ANIMATION_TOGGLE_STYLE_ID,
} from './config.ts';

export { createAnimationToggle } from './controller.ts';
export type {
  AnimationToggle,
  AnimationToggleOptions,
  ToggleMediaLike,
} from './controller.ts';
