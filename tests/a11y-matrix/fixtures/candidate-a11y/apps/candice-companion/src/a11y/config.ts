/**
 * Accessibility configuration (Master Spec 0E WS-14, spec sections 5.2 /
 * 9 / 10 / 19; CHECKLIST E.1 WS-14).
 *
 * Canonical WS-14 declarations, owned by this lane:
 *   `apps/candice-companion/src/a11y/**` — reduced motion,
 *   `apps/candice-companion/src/ui/captions/**` — captions.
 *
 * The reduced-motion class name defined here is the SINGLE shared class
 * every consuming animation lane imports (WS-07, WS-09, WS-10, WS-13).
 * Those lanes consume `candice-reduced-motion` on `<html>`; this lane
 * defines it and applies it from the real OS `prefers-reduced-motion`
 * setting (spec 10), overridable by the spec-9 local preference
 * (`reducedMotion`: null = follow OS, true = force minimal, false =
 * animations allowed).
 *
 * @module
 */

/** Version bump on any breaking shape change of the a11y surface. */
export const A11Y_CONTRACT_VERSION = 1;

/**
 * The single shared reduced-motion class, applied to `<html>` when
 * motion must be minimal. Consumed verbatim by:
 *   - WS-07 `src/window/**` (transparent window styles),
 *   - WS-09 `src/ui/ptt/**` + `src/ui/answer-controls/**`,
 *   - WS-10 `src/ui/compact/**` (`COMPACT_REDUCED_MOTION_CLASS`),
 *   - WS-13 `src/animation/gesture/**` (`REDUCED_MOTION_CLASS`).
 * Never define a second class name anywhere else.
 */
export const REDUCED_MOTION_CLASS = 'candice-reduced-motion';

/** CSS media query used to detect the OS reduced-motion setting (spec 10). */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** MediaQueryList event that fires when the OS setting changes. */
export const REDUCED_MOTION_EVENT = 'change';

/**
 * The spec-9 preference tier. Null = follow the OS setting; true =
 * force minimal animation; false = animations allowed. Mirrors the
 * `reducedMotion` field of the WS-40 preference profile
 * (`packages/candice-protocol/schemas/preferences.schema.json`), which
 * this lane consumes as a plain boolean/null — it never reads or writes
 * the profile itself.
 */
export type ReducedMotionPreference = boolean | null;

/** The three resolved preference tiers after normalizing the profile. */
export const REDUCED_MOTION_TIERS = ['os', 'reduce', 'allow'] as const;
export type ReducedMotionTier = (typeof REDUCED_MOTION_TIERS)[number];
