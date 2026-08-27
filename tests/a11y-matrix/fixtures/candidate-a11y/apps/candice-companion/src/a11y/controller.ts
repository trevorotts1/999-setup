/**
 * Accessibility controller (Master Spec 0E WS-14, spec 9 / 10 / 19).
 *
 * Wires the reduced-motion preference (spec-9 local profile, consumed as a
 * plain boolean | null — never read/written here) to the shared
 * `candice-reduced-motion` class on `<html>` (consuming lanes: WS-07,
 * WS-09, WS-10, WS-13):
 *
 *   1. On creation: resolve OS `prefers-reduced-motion` + preference and
 *      apply the class once.
 *   2. When the OS setting changes: `applyReducedMotion` keeps the class
 *      live for the `os` tier (single writer — this controller holds the
 *      returned detach handle and never attaches a second listener).
 *   3. When the preference changes (WS-40 caller invokes
 *      `applyPreference`): re-resolve and re-apply; the OS listener is
 *      refreshed so the class subsequently tracks the OS again when the
 *      preference returns to `os`.
 *
 * Never throws (spec 20): a null root, missing document/window, or broken
 * `matchMedia` all degrade to a no-op apply — the class is then simply
 * never set and animation lanes treat that as "motion allowed".
 *
 * @module
 */

import {
  REDUCED_MOTION_CLASS,
  type ReducedMotionPreference,
  type ReducedMotionTier,
} from './config.ts';
import {
  applyReducedMotion,
  resolveReducedMotionTier,
  type A11yMediaLike,
  type A11yWindowLike,
} from './apply.ts';

/** Injectable media-query source; defaults to the real `window`. */
export interface A11yMediaSource {
  matchMedia?(query: string): A11yMediaLike;
}

export interface A11yController {
  /** Current resolved tier (`os` | `reduce` | `allow`). */
  readonly tier: ReducedMotionTier;
  /** True when `<html>` carries the shared reduced-motion class right now. */
  readonly reduced: boolean;
  /** Re-resolve + re-apply. Idempotent; refreshes the OS change listener. */
  applyPreference(pref: ReducedMotionPreference): void;
  /** Detach the OS change listener and any DOM writes. */
  detach(): void;
}

export interface A11yControllerOptions {
  /** `<html>` element (or any element inside it). Null in headless runs. */
  root: HTMLElement | null;
  /** Local preference (spec 9): null = follow OS, true = minimal, false = allowed. */
  preference: ReducedMotionPreference;
  /** Media source; defaults to the real `window` when available. */
  media?: A11yMediaSource | null;
  /** Document override for tests; defaults to `root.ownerDocument`. */
  doc?: Document | null;
}

export function createA11yController(options: A11yControllerOptions): A11yController {
  const { root, media = null, doc = null } = options;
  let detached = false;
  let detachWatch: (() => void) | null = null;

  const resolvedDoc = (): Document | null => {
    if (doc !== null) return doc;
    try {
      return root?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    } catch {
      return null;
    }
  };

  const resolveWin = (): A11yWindowLike | null => {
    try {
      if (media != null) return media;
      return (resolvedDoc()?.defaultView as A11yWindowLike | null) ?? null;
    } catch {
      return null;
    }
  };

  const html = (): HTMLElement | null => {
    try {
      return resolvedDoc()?.documentElement ?? root;
    } catch {
      return null;
    }
  };

  const currentTier = (): ReducedMotionTier => {
    try {
      const attr = html()?.getAttribute?.('data-candice-reduced-motion');
      if (attr === 'reduce' || attr === 'allow') return attr;
    } catch {
      // fall through to the resolved default
    }
    return resolveReducedMotionTier(options.preference, resolveWin()).tier;
  };

  function apply(pref: ReducedMotionPreference): void {
    if (detached) return;
    const { tier } = resolveReducedMotionTier(pref, resolveWin());
    detachWatch?.();
    detachWatch = applyReducedMotion(html(), tier);
  }

  apply(options.preference);

  return {
    get tier() {
      return currentTier();
    },
    get reduced() {
      try {
        return html()?.classList.contains(REDUCED_MOTION_CLASS) === true;
      } catch {
        return false;
      }
    },
    applyPreference: (pref: ReducedMotionPreference) => apply(pref),
    detach: () => {
      detached = true;
      detachWatch?.();
      detachWatch = null;
    },
  };
}
