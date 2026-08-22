/**
 * Reduced-motion state store (Master Spec 0E WS-14, spec 9 / 10 / 19).
 *
 * Holds the RESOLVED reduced-motion tier as a plain field + notifier so
 * DOM-free code (state machine, controllers, tests) can read it without
 * touching `matchMedia` or the DOM. The DOM application (class flip on
 * `<html>`) lives in `applyReducedMotion()` in this lane — one writer,
 * one class, idempotent.
 *
 * Failure behavior (spec 20): a missing `matchMedia` (or any thrown
 * environment API) degrades to `tier: 'os'` and a no-op apply — never a
 * throw, never an unhandled rejection, never a stop of Claude.
 *
 * @module
 */

import { REDUCED_MOTION_TIERS, type ReducedMotionTier } from './config.ts';

export type ReducedMotionListener = (tier: ReducedMotionTier) => void;

/** The resolved reduced-motion state. `tier` is the single truth for consumers. */
export interface ReducedMotionState {
  tier: ReducedMotionTier;
  /** Applies the current tier: updates the store, notifies, and applies to DOM. */
  setTier(tier: ReducedMotionTier): void;
  /** Subscribe to tier changes. Returns an unsubscribe function. */
  subscribe(listener: ReducedMotionListener): () => void;
}

/** Guard: a value is a valid tier exactly when it is one of the three constants. */
export function isReducedMotionTier(value: unknown): value is ReducedMotionTier {
  return (
    typeof value === 'string' &&
    (REDUCED_MOTION_TIERS as readonly string[]).includes(value)
  );
}

export function createReducedMotionState(initial: ReducedMotionTier = 'os'): ReducedMotionState {
  let tier: ReducedMotionTier = isReducedMotionTier(initial) ? initial : 'os';
  const listeners = new Set<ReducedMotionListener>();

  return {
    get tier() {
      return tier;
    },
    setTier(next: ReducedMotionTier): void {
      if (!isReducedMotionTier(next) || next === tier) return;
      tier = next;
      for (const listener of [...listeners]) {
        try {
          listener(tier);
        } catch {
          // A subscriber failure must never propagate (spec 20).
        }
      }
    },
    subscribe(listener: ReducedMotionListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
