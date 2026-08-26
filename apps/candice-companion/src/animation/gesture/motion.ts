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
