/**
 * Animation-off toggle — configuration (FIX-008 accessibility surface).
 *
 * The operator asked for "an option to turn animation off". This lane adds
 * the CONTROL only; it invents no new preference mechanism and no new class
 * name. The stored value is the existing spec-9 profile field
 * `reducedMotion` (`boolean | null`, see `src/prefs/schema.ts`), and the
 * applied effect is the existing shared class `candice-reduced-motion` on
 * `<html>`, owned by the WS-14 a11y lane (`src/a11y/**`).
 *
 * Two-state control over a three-state field, deliberately:
 *
 *   checked (animation ON)  -> `reducedMotion: null`  = follow the OS
 *   unchecked (animation OFF) -> `reducedMotion: true`  = always minimal
 *
 * ON maps to `null`, never to `false`. `false` means "force animation even
 * when the OS asked for reduced motion", which would defeat
 * `prefers-reduced-motion: reduce` — an accessibility regression, not a user
 * convenience. Mapping ON to `null` keeps the OS setting authoritative for
 * free: a user who has never touched this control, and a user who switched
 * it back on, both follow the OS.
 *
 * @module
 */

/** Root class of the toggle surface. */
export const ANIMATION_TOGGLE_CLASS = 'candice-animation-toggle';

/** Stable id so the control mounts exactly once. */
export const ANIMATION_TOGGLE_ID = 'candice-animation-toggle';

/** Exported style id so the style tag is injected exactly once. */
export const ANIMATION_TOGGLE_STYLE_ID = 'candice-animation-toggle-style';

/** Visible label. */
export const ANIMATION_TOGGLE_LABEL = 'Animation';

/**
 * Hint shown when the OS is forcing reduced motion. The control is disabled
 * in that state: re-enabling animation would mean writing `reducedMotion:
 * false`, which is exactly the OS override this lane refuses to offer.
 */
export const ANIMATION_TOGGLE_OS_HINT = 'Off — your computer asked for less motion';

/** Hint shown when the user turned animation off themselves. */
export const ANIMATION_TOGGLE_OFF_HINT = 'Off — Candice holds a still pose';

/** Hint shown while animation is running. */
export const ANIMATION_TOGGLE_ON_HINT = 'On — blink, breathing, and lip sync';
