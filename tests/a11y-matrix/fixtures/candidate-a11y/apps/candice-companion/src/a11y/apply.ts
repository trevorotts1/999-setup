/**
 * Reduced-motion DOM application (Master Spec 0E WS-14, spec 9 / 10 / 19).
 *
 * This is the SINGLE place the shared class `candice-reduced-motion` is
 * applied to `<html>` (consuming lanes: WS-07, WS-09, WS-10, WS-13 —
 * each imports only the class name, never defines it).
 *
 * Two-driven: the resolved tier decides. `os` reads the live OS setting
 * via `matchMedia('(prefers-reduced-motion: reduce)')`; `reduce` forces
 * the class on; `allow` forces it off. Called on boot and re-driven when
 * the OS setting changes (media-query `change` event) or when the
 * spec-9 preference changes (the WS-40 profile lane calls
 * `applyReducedMotion` again with the new value).
 *
 * Never throws (spec 20): a missing/limited `matchMedia` degrades to a
 * no-op apply with `tier: 'os'` and the `mediaAvailable: false` marker
 * so the caller knows the OS setting could not be consulted — the class
 * is then simply never set (animation lanes treat a missing class as
 * "motion allowed").
 *
 * @module
 */

import {
  REDUCED_MOTION_CLASS,
  REDUCED_MOTION_EVENT,
  REDUCED_MOTION_QUERY,
  type ReducedMotionPreference,
  type ReducedMotionTier,
} from './config.ts';
import { isReducedMotionTier } from './motion.ts';

/** Minimal window surface consumed; injected so tests and the shell set the
 * matchMedia implementation. Everything else about the window is ignored. */
export interface A11yWindowLike {
  matchMedia?(query: string): A11yMediaLike;
}

/** Minimal MediaQueryList surface (see `A11yWindowLike`). */
export interface A11yMediaLike {
  matches: boolean;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

/** Rejection value when `matchMedia` is absent/broken (never thrown). */
export interface ReducedMotionApplyResult {
  /** Class applied to `<html>` when true. */
  reduced: boolean;
  /** True when the OS media query was consulted. */
  mediaAvailable: boolean;
  /** The tier that produced the result. */
  tier: ReducedMotionTier;
}

/** Resolve the OS reduced-motion status to a tier (never throws). */
export function tierFromPreference(pref: ReducedMotionPreference): ReducedMotionTier {
  if (pref === true) return 'reduce';
  if (pref === false) return 'allow';
  return 'os';
}

/** Resolve the live OS media-query state to a tier (never throws). */
export function tierFromMedia(w: A11yWindowLike | null | undefined): {
  tier: ReducedMotionTier;
  mediaAvailable: boolean;
} {
  try {
    const win = w as A11yWindowLike | undefined;
    const mql = win?.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!mql || typeof mql.matches !== 'boolean') {
      return { tier: 'os', mediaAvailable: false };
    }
    return { tier: mql.matches ? 'reduce' : 'allow', mediaAvailable: true };
  } catch {
    return { tier: 'os', mediaAvailable: false };
  }
}

/** Resolve the final tier from preference + live OS media (never throws). */
export function resolveReducedMotionTier(
  pref: ReducedMotionPreference,
  w: A11yWindowLike | null | undefined,
): { tier: ReducedMotionTier; mediaAvailable: boolean } {
  if (pref === true) return { tier: 'reduce', mediaAvailable: true };
  if (pref === false) return { tier: 'allow', mediaAvailable: true };
  return tierFromMedia(w);
}

/**
 * Apply the class to `<html>` per the resolved tier. One delegated writer:
 * return an unsubscribe that removes the OS `change` listener. Idempotent —
 * calling again with the same tier re-applies nothing and returns the same
 * unsubscribe; the stored unsubscribe is replaced only by a later call.
 *
 * `os` resolves the LIVE OS setting at apply time (never assumes motion
 * allowed), then keeps the class current via the media-query `change`
 * listener. `reduce`/`allow` are explicit wins and attach no listener.
 */
export function applyReducedMotion(root: HTMLElement | null, tier: ReducedMotionTier): () => void {
  const unsubscribers: (() => void)[] = [];
  try {
    if (root === null) return () => undefined;
    const html = root.ownerDocument?.documentElement ?? root;
    const win = root.ownerDocument?.defaultView as A11yWindowLike | undefined;
    let wantReduced = tier === 'reduce';
    if (tier === 'os') {
      // Follow the OS: read the live media state, not a guess.
      wantReduced = tierFromMedia(win).tier === 'reduce';
    }
    html.classList.toggle(REDUCED_MOTION_CLASS, wantReduced);
    html.setAttribute('data-candice-reduced-motion', wantReduced ? 'reduce' : 'allow');
    if (tier === 'os') {
      // Keep the class live while the OS setting is the source of truth.
      const mql = win?.matchMedia?.(REDUCED_MOTION_QUERY);
      if (mql?.addEventListener) {
        const onChange = () => {
          const now = mql.matches;
          html.classList.toggle(REDUCED_MOTION_CLASS, now);
          html.setAttribute('data-candice-reduced-motion', now ? 'reduce' : 'allow');
        };
        // Apply the current OS state immediately on attach (the query may
        // have flipped since the initial read).
        onChange();
        try {
          mql.addEventListener(REDUCED_MOTION_EVENT, onChange);
          unsubscribers.push(() => {
            mql.removeEventListener?.(REDUCED_MOTION_EVENT, onChange);
          });
        } catch {
          // Listener attachment failed: static apply only (spec 20).
        }
      }
    }
  } catch {
    // Never propagate from the apply path (spec 20).
  }
  return () => {
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        // Best-effort teardown (spec 20).
      }
    }
  };
}

/** Convenience: resolve from preference + window, then apply (never throws). */
export function applyReducedMotionForPreference(
  root: HTMLElement | null,
  pref: ReducedMotionPreference,
  win: A11yWindowLike | null | undefined,
): { result: ReducedMotionApplyResult; detach: () => void } {
  const { tier, mediaAvailable } = resolveReducedMotionTier(pref, win);
  const detach = applyReducedMotion(root, tier);
  return {
    result: { reduced: tier === 'reduce', mediaAvailable, tier },
    detach,
  };
}

/** Guard used by the a11y controller to sanitize profile input. */
export function saferTier(value: unknown): ReducedMotionTier {
  return isReducedMotionTier(value) ? value : 'os';
}
