/**
 * Motion targets for blink, idle breathing, and head drift (WS-13).
 *
 * This module is a pure calculator: it converts a normalized 0..1 phase
 * into concrete transform/opacity targets for the renderer. No DOM, no
 * clock, no randomness — the same phase always yields the same target
 * (WS-08 determinism shape respected). Randomness is intentionally
 * ABSENT even for natural-looking drift: spec 10 prefers "subtle" motion
 * and the phase source (motion phases) applies a deterministic stagger so
 * no two continuous motions share a frequency.
 *
 * @module
 */

import {
  GESTURE_TIMING,
} from './config.ts';

/** Blink progress in closed-eye units (0 = open, 1 = closed). */
export type EyePhase = number;

/** Breathing progress in radians across one period. */
export type BreathPhase = number;

/** Drift progress in radians across one period. */
export type DriftPhase = number;

/** Open-eye progress: fully open unless inside the closed window. */
export function eyeOpenRatio(closedUnits: number): number {
  // closedUnits >= 1 means "inside the closed window" (and beyond): hold
  // fully closed, never pop back open mid-blink.
  if (closedUnits >= 1) return 0;
  if (closedUnits <= 0) return 1;
  // 0..1 closes the eyelid on a cosine shoulder: 0 -> 1 (open),
  // 0.5 -> 0 (fully closed), 1 -> 0 (still closed, clamped above).
  return Math.max(0, Math.cos(closedUnits * Math.PI));
}

/**
 * Eyelid position `t` ms into a single blink, as `closedUnits` for
 * `eyeOpenRatio`: `0` is fully open and `0.5` is fully closed.
 *
 * `0.5` is the closed point, NOT the halfway point — `eyeOpenRatio` is
 * `cos(u * PI)`, which reaches zero at `u = 0.5`. The old driver treated
 * `0.5` as "half closed" and rendered it identically to fully closed. Only
 * the open interval `(0, 0.5)` produces intermediate eyelid positions, so
 * this sweeps across exactly that range and never past it.
 *
 * Outside the blink span the eye is fully open, so a caller may pass any
 * `t` without bounds-checking it first.
 */
export function blinkClosedUnits(t: number): number {
  const close = GESTURE_TIMING.blinkCloseMs;
  const hold = GESTURE_TIMING.blinkClosedMs;
  const open = GESTURE_TIMING.blinkOpenMs;
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t < close) return 0.5 * (t / close);
  if (t < close + hold) return 0.5;
  if (t < close + hold + open) return 0.5 * (1 - (t - close - hold) / open);
  return 0;
}

/** Total duration of one blink: close ramp + closed hold + open ramp. */
export function blinkSpanMs(): number {
  return (
    GESTURE_TIMING.blinkCloseMs +
    GESTURE_TIMING.blinkClosedMs +
    GESTURE_TIMING.blinkOpenMs
  );
}

/**
 * Gap in ms before blink number `index`, within the configured range.
 *
 * Deterministic by design: a seeded RNG in the driver would make the blink
 * rhythm untestable, and a fixed period is what made it read as a
 * metronome. This is an integer hash of the blink index, so consecutive
 * gaps differ irregularly while any given index always yields the same gap.
 */
export function blinkIntervalMs(index: number): number {
  const min = GESTURE_TIMING.blinkIntervalMinMs;
  const max = GESTURE_TIMING.blinkIntervalMaxMs;
  let h = Math.imul(Math.floor(index) + 1, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return min + ((h >>> 0) / 4294967296) * (max - min);
}

/** Breathing scale around 1 for a phase in radians (smooth cosine). */
export function breathScale(radians: number): number {
  const s = GESTURE_TIMING.idleBreathScaleMax;
  return 1 + s * Math.cos(radians);
}

/** Head drift offset in px for a phase in radians (smooth sine). */
export function headDriftPx(radians: number): number {
  const d = GESTURE_TIMING.headDriftPxMax;
  return d * Math.sin(radians);
}

/**
 * Glow pulse intensity 0..1 for a phase in radians, weighted by the
 * status intensity constant. Same pure-calculator contract as the rest.
 */
export function glowIntensity(radians: number, statusIntensity: number): number {
  const pulse = (1 + Math.cos(radians)) / 2; // 0..1
  const base = Math.max(0, Math.min(1, statusIntensity));
  return Math.max(0, Math.min(1, pulse * base));
}

/**
 * Deterministic per-status phase staggering: continuous motions never
 * share a frequency, so combined motion reads as subtle layered drift
 * rather than a synchronized pulse (spec 10 "subtle idle/breathing").
 */
export function staggerPhase(kind: 'blink' | 'breath' | 'drift' | 'glow', offsetMs: number): number {
  const periodMs =
    kind === 'blink' ? GESTURE_TIMING.blinkPeriodMs :
    kind === 'breath' ? GESTURE_TIMING.idleBreathPeriodMs :
    kind === 'glow' ? GESTURE_TIMING.glowPulsePeriodMs :
    GESTURE_TIMING.idleBreathPeriodMs; // drift rides the breath period
  if (periodMs <= 0) return 0;
  const safe = Math.max(0, offsetMs);
  return ((safe % periodMs) / periodMs) * Math.PI * 2;
}
