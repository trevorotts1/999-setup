/**
 * Face-state registration precondition (WS-12, Master Spec 11A / E.1).
 *
 * Spec 11A: "Do not assume all near-neutral face images are exact
 * pixel-aligned animation frames. Measure registration first."
 *
 * The viseme lane emits mouth-shape steps over the timing clock only. It
 * is the face-render lane (WS-11) that applies a step to an asset — and
 * it must first measure face-state registration (landmark/head-shoulder
 * placement) and record the result here. Until a positive measurement is
 * recorded, `assertRegistrationMeasured` throws, so no render lane can
 * consume viseme steps against unverified whole-frame assets.
 *
 * This is a compile-time-visible, runtime-enforced precondition, not a
 * comment: the guard is the only API this lane exposes for gating
 * whole-frame application, and it fails closed.
 */

/**
 * Single source of truth for whether face-state registration has been
 * measured (not merely assumed) for the assets the renderer will swap.
 * False until a render lane records a real measurement.
 */
export const VISEME_REGISTRATION_PRECONDITION: {
  registered: boolean;
} = {
  registered: false,
};

/**
 * Fail-closed gate. Returns null once a positive registration measurement
 * has been recorded; throws otherwise. Callers (WS-11/WS-13 render paths)
 * must call this before applying viseme steps to assets.
 */
export function assertRegistrationMeasured(
  registered: boolean = VISEME_REGISTRATION_PRECONDITION.registered,
): null {
  if (!registered) {
    throw new Error(
      "face-state registration not measured — viseme steps must not be " +
        "applied to unverified whole-frame assets (Master Spec 11A)",
    );
  }
  return null;
}

/** Record a registration measurement (called by the render lane). */
export function recordRegistrationMeasured(): void {
  VISEME_REGISTRATION_PRECONDITION.registered = true;
}
