/**
 * Gesture animation configuration (Master Spec 0E WS-13, spec section 10).
 *
 * Canonical WS-13 declarations. This lane covers blink, idle/breathing,
 * head movement, arm/hand gestures, and the speaking/listening/processing
 * glow states. Every value is sprite/layer-swap or transform/opacity
 * based — no canvas, no 3D, no video, no particle simulation (spec 10
 * "Avoid" list).
 *
 * Two transparency contracts (Master Spec 11/28 + WS-15): gesture assets
 * are composite layers over a transparent character. This lane must paint
 * NOTHING opaque and must hold on BOTH light and dark desktop backgrounds
 * (E.1). Surface classes are the render contract; actual pixel proof of
 * alpha edges is owned by the WS-15 visual harness, not this lane.
 *
 * @module
 */

/** Version bump on any breaking shape change of the surface below. */
export const GESTURE_CONTRACT_VERSION = 1;

/** E.1: use only lightweight primitives (spec 10 "Prefer" list). */
export const ANIMATION_KINDS = ['layer-swap', 'transform', 'opacity'] as const;
export type AnimationKind = (typeof ANIMATION_KINDS)[number];

/** Canonical gesture ids (Master Spec 11: late-binding manifest keys). */
export const GESTURE_IDS = [
  'welcome',
  'presenting',
  'listening',
  'thinking',
  'affirmative',
] as const;
export type GestureId = (typeof GESTURE_IDS)[number];

/** Gestures available at boot. Lazy layer registration fills the rest. */
export const BOOT_GESTURES: readonly GestureId[] = [
  'listening',
  'thinking',
] as const;

/**
 * E.1 + WS-14 dependency: never fight the OS reduced-motion setting. This
 * class (same as WS-07's consumer contract) turns every continuous
 * animation off in CSS; this lane's tests prove it (spec 9).
 */
export const REDUCED_MOTION_CLASS = 'candice-reduced-motion';

/** Root attribute for the gesture surface. */
export const GESTURE_STAGE_ATTR = 'data-candice-gesture-stage';

/** Root attribute for the glow surface. */
export const GLOW_STAGE_ATTR = 'data-candice-glow-stage';

/** Classes marking active gesture layers (one at a time). */
export const GESTURE_ACTIVE_CLASS = 'candice-gesture-active';
export const GESTURE_INACTIVE_CLASS = 'candice-gesture-inactive';

/** Cyclic states that must drop to a static layer under reduced motion. */
export const CONTINUOUS_STATES = [
  'blinking',
  'idling',
  'listening',
  'thinking',
] as const;
export type ContinuousState = (typeof CONTINUOUS_STATES)[number];

/**
 * Default duty-cycle timing (ms), all transform/opacity, all pause-safe
 * (spec 24: negligible idle resource use; timers cleared on detach).
 */
export const GESTURE_TIMING = {
  /**
   * Nominal blink period. Retained as the reference period for
   * `staggerPhase`, which offsets when a loop STARTS. It is no longer the
   * gap between blinks — see `blinkIntervalMinMs`/`blinkIntervalMaxMs`.
   */
  blinkPeriodMs: 4_000,
  /** Closed-eye hold inside a blink. */
  blinkClosedMs: 120,
  /**
   * Eyelid close and open ramps.
   *
   * These existed only implicitly before, and wrongly: the driver fed
   * `eyeOpenRatio` three quantized values `{1, 0.5, 0}`, and because
   * `cos(0.5 * PI)` is 0, BOTH `1` and `0.5` rendered fully closed. The
   * result was a 240ms hard cut with no ramp in either direction — a
   * flicker, not a blink. The eyelid now sweeps continuously across these
   * two ramps, so the cosine shoulder is actually exercised.
   *
   * Deliberately ASYMMETRIC. A real eyelid snaps down and drifts back up,
   * and the reopen is the half a viewer actually watches. It also decides
   * smoothness: the driver ticks at 16ms, so a 60ms reopen is sampled only
   * ~4 times and the cosine dumps 19.4pt of a 47.8pt travel into a single
   * frame — perceptible, but as a stutter. At 140ms it is sampled ~9 times
   * and the worst frame moves 8.5pt. Total blink 320ms, inside the real
   * human 300-400ms range.
   *
   * Amplitude is emphatically NOT the risk here, unlike the breath: the eye
   * band renders ~47.8pt (96 device px) tall, so a full close travels ~34x
   * the 2.8px that made the breath invisible.
   */
  blinkCloseMs: 60,
  blinkOpenMs: 140,
  /**
   * Gap between blinks, sampled per blink.
   *
   * A fixed period made her blink on an exact 4.000s metronome, which reads
   * as mechanical — real blinking is irregular. Each gap is drawn
   * deterministically from this range (see `blinkIntervalMs`), so the
   * rhythm is lifelike but still exactly reproducible in a test.
   */
  blinkIntervalMinMs: 3_000,
  blinkIntervalMaxMs: 6_000,
  /** Idle breathing period (scale). */
  idleBreathPeriodMs: 3_200,
  /**
   * Maximum idle scale delta either side of 1.
   *
   * This was 0.008. On the ~500px-tall character that is a 4px total travel
   * over 3.2s — measurable in a frame diff and invisible to a person, which
   * is why the operator read her as a still image. The layers scale from
   * `transform-origin: 50% 100%` (the feet), so the delta lands at the head
   * where it reads as breathing. 0.025 gives roughly 12px of head travel:
   * clearly alive, and still well under the 0.03 the old CSS breathe used,
   * so it cannot read as a bounce.
   */
  idleBreathScaleMax: 0.025,
  /**
   * Maximum head-motion delta (px) either side of rest.
   *
   * SUSPECTED BELOW THE PERCEPTIBILITY FLOOR — deliberately NOT changed
   * yet, because it has never been seen on screen.
   *
   * Calibration: the breath was `0.008`, which on a ~350px-tall render is
   * ~2.8px of peak travel, and that was confirmed invisible — it is why the
   * operator read her as a still image. 2px of `translateX` sits at or below
   * that same threshold, so this is likely wrong by the standard already
   * established for the breath. But `[data-candice-head]` has never been
   * created by any mount path, so this value has never actually rendered
   * and the claim is unproven. Check it visually once the head layer exists,
   * then set it deliberately rather than guessing a second time.
   */
  headDriftPxMax: 2,
  /** Glow pulse period for active statuses. */
  glowPulsePeriodMs: 2_200,
} as const;

/** Speaking glow intensity (unitless). */
export const SPEAKING_GLOW_INTENSITY = 1;
/** Listening glow intensity (unitless). */
export const LISTENING_GLOW_INTENSITY = 0.9;
/** Processing/thinking glow intensity (unitless). */
export const PROCESSING_GLOW_INTENSITY = 0.7;
/** Idle glow intensity (unitless). */
export const IDLE_GLOW_INTENSITY = 0.35;
/** Reduced-motion glow cap: static, not animated. */
export const REDUCED_MOTION_GLOW_CAP = 0.55;

/** DOM + status contract mirrored from WS-08 (never diverges silently). */
export const GESTURE_STATUS_CONTRACT = {
  listening: 'listening',
  speaking: 'speaking',
  processing: ['thinking', 'transcribing', 'confirming'],
} as const;
