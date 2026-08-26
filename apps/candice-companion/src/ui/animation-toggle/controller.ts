/**
 * Animation-off toggle — control surface (FIX-008 accessibility surface).
 *
 * Mounts one checkbox that turns Candice's motion off and back on, applies
 * the change through the EXISTING WS-14 a11y controller, and persists it
 * through the EXISTING `cmd_save_profile` seam. No new preference file, no
 * new storage key, no second reduced-motion class — see `./config.ts` for
 * why the two-state control maps onto the three-state `reducedMotion` field.
 *
 * Pointer reachability: the companion window is pointer-transparent except
 * over regions published to the native hit test
 * (`src/window/native-input-regions.ts`). `button`/`input` already match that
 * lane's `CONTROL_SELECTOR`, so this control becomes clickable as soon as the
 * regions are refreshed — which is why {@link AnimationToggleOptions.onLayoutChange}
 * exists and is called after every mount and every visible state change.
 *
 * Never throws (spec 20): a missing document, missing `matchMedia`, or a
 * failed persist degrades to an in-memory-only toggle. Losing the preference
 * must never cost the session.
 *
 * @module
 */

import type { ReducedMotionPreference } from '../../a11y/config.ts';
import { REDUCED_MOTION_QUERY, REDUCED_MOTION_EVENT } from '../../a11y/config.ts';
import {
  ANIMATION_TOGGLE_CLASS,
  ANIMATION_TOGGLE_ID,
  ANIMATION_TOGGLE_LABEL,
  ANIMATION_TOGGLE_OFF_HINT,
  ANIMATION_TOGGLE_ON_HINT,
  ANIMATION_TOGGLE_OS_HINT,
  ANIMATION_TOGGLE_STYLE_ID,
} from './config.ts';

/** Minimal media-query surface consumed (mirrors `A11yMediaLike`). */
export interface ToggleMediaLike {
  matches: boolean;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export interface AnimationToggleOptions {
  /** Element the control is appended to. */
  mount: HTMLElement;
  /** Document injection for tests; defaults to `mount.ownerDocument`. */
  doc?: Document;
  /** The persisted value at boot (`null` = follow the OS). */
  reducedMotion: ReducedMotionPreference;
  /** Apply to the live a11y controller (the single DOM writer). */
  applyPreference(preference: ReducedMotionPreference): void;
  /** Persist the explicit user change. May be async; failures are tolerated. */
  persist(preference: ReducedMotionPreference): Promise<boolean> | boolean | void;
  /** Called after the control's visible box changes (input-region refresh). */
  onLayoutChange?(): void;
  /** Media source injection for tests; defaults to the real `matchMedia`. */
  media?: ToggleMediaLike | null;
}

export interface AnimationToggle {
  /** The mounted root, or null when the DOM was unusable. */
  readonly element: HTMLElement | null;
  /** The preference value the control currently represents. */
  readonly preference: ReducedMotionPreference;
  /** True when motion is currently suppressed (by the user OR by the OS). */
  readonly motionOff: boolean;
  /** Set the preference programmatically (same path as a user click). */
  set(preference: ReducedMotionPreference): void;
  /** Remove listeners and DOM. Idempotent. */
  destroy(): void;
}

/** Resolve the OS media query without ever throwing. */
function osMedia(doc: Document | null, injected: ToggleMediaLike | null): ToggleMediaLike | null {
  if (injected != null) return injected;
  try {
    const view = doc?.defaultView as { matchMedia?(q: string): ToggleMediaLike } | null;
    return view?.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  } catch {
    return null;
  }
}

function injectStyle(doc: Document): void {
  if (doc.getElementById(ANIMATION_TOGGLE_STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = ANIMATION_TOGGLE_STYLE_ID;
  // The window is transparent, so this control paints its own opaque
  // backdrop for the same reason the name prompt does (FIX-008): otherwise
  // it renders onto the user's desktop and cannot be read.
  style.textContent = `
.${ANIMATION_TOGGLE_CLASS} {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto 6px;
  /* The ROW is the click target, not the 16px box inside it -- the native
     hit test publishes this element's rectangle, and outside a published
     rectangle the window is pointer-transparent, so a near miss does not
     just fail: it goes through Candice to the desktop behind her.
     min-height carries it to the 44px target minimum; REGION_PADDING adds
     only 4px, so the CSS has to do the work.

     This used to be two competing rules. A repair added a second
     .candice-animation-toggle rule with padding 6px 4px below this one,
     which won on source order and quietly cut the horizontal padding from
     10px to 4px -- making the row NARROWER while trying to make it easier
     to hit. Merged. */
  padding: 6px 10px;
  min-height: 44px;
  width: fit-content;
  font-size: calc(12px * var(--candice-text-scale, 1));
  line-height: 1.3;
  color: var(--candice-text, #eceaf3);
  background: var(--candice-ui-surface, #171321);
  border: 1px solid var(--candice-ui-border, #beb0ff);
  border-radius: 8px;
}
.${ANIMATION_TOGGLE_CLASS} input {
  width: 16px;
  height: 16px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--candice-accent, #7c5cff);
}
.${ANIMATION_TOGGLE_CLASS} input:disabled {
  cursor: not-allowed;
}
.${ANIMATION_TOGGLE_CLASS} label {
  /* Stretch to the row so the words are part of the target, not just the
     checkbox. The label was never published on its own -- that was the
     original bug here. */
  align-self: stretch;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}
.${ANIMATION_TOGGLE_CLASS} .${ANIMATION_TOGGLE_CLASS}-hint {
  color: var(--candice-muted, #a8a3b8);
  font-size: calc(11px * var(--candice-text-scale, 1));
}
`;
  (doc.head ?? doc.documentElement).append(style);
}

/**
 * Mount the animation toggle. Returns an inert handle when the DOM is
 * unusable so callers never branch on null (spec 20).
 */
export function createAnimationToggle(options: AnimationToggleOptions): AnimationToggle {
  const doc = options.doc ?? options.mount?.ownerDocument ?? null;
  let preference: ReducedMotionPreference = options.reducedMotion ?? null;
  let media: ToggleMediaLike | null = null;
  let onOsChange: (() => void) | null = null;
  let root: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let hint: HTMLElement | null = null;
  let destroyed = false;

  const inert: AnimationToggle = {
    element: null,
    get preference() {
      return preference;
    },
    get motionOff() {
      return preference === true;
    },
    set: (next) => {
      preference = next;
      try {
        options.applyPreference(next);
      } catch {
        // A broken a11y controller must not propagate (spec 20).
      }
    },
    destroy: () => undefined,
  };

  if (doc === null || options.mount == null) return inert;
  // Re-entry (HMR, double mount) keeps the first control; two checkboxes
  // writing one preference is exactly the drift this app fails closed on.
  if (doc.getElementById(ANIMATION_TOGGLE_ID) !== null) return inert;

  try {
    injectStyle(doc);

    root = doc.createElement('div');
    root.className = ANIMATION_TOGGLE_CLASS;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Animation preference');

    input = doc.createElement('input');
    input.id = ANIMATION_TOGGLE_ID;
    input.type = 'checkbox';

    const label = doc.createElement('label');
    label.setAttribute('for', ANIMATION_TOGGLE_ID);
    label.textContent = ANIMATION_TOGGLE_LABEL;

    hint = doc.createElement('span');
    hint.className = `${ANIMATION_TOGGLE_CLASS}-hint`;
    // The hint is the state readout, so it must be announced when it flips.
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');

    root.append(input, label, hint);
    options.mount.append(root);
  } catch {
    return inert;
  }

  media = osMedia(doc, options.media ?? null);

  /** True when the OS is asking for reduced motion right now. */
  const osReduced = (): boolean => {
    try {
      return media?.matches === true;
    } catch {
      return false;
    }
  };

  /**
   * Paint the control from the CURRENT preference + live OS state. The
   * control is disabled while the OS forces reduced motion: the only way to
   * re-enable animation from there would be `reducedMotion: false`, and this
   * lane refuses to offer an override of `prefers-reduced-motion: reduce`.
   */
  const render = (): void => {
    if (destroyed || input === null || hint === null) return;
    const forcedByOs = preference !== true && osReduced();
    const off = preference === true || forcedByOs;
    input.checked = !off;
    input.disabled = forcedByOs;
    // No aria-checked: a native input[type=checkbox] exposes its own
    // checked state, and a hand-maintained mirror is one missed render away
    // from telling a screen reader the opposite of the truth.
    // `input.checked` above is the whole job.
    hint.textContent = forcedByOs
      ? ANIMATION_TOGGLE_OS_HINT
      : off
        ? ANIMATION_TOGGLE_OFF_HINT
        : ANIMATION_TOGGLE_ON_HINT;
    root?.setAttribute('data-candice-animation', off ? 'off' : 'on');
    root?.setAttribute(
      'data-candice-animation-source',
      preference === true ? 'user' : forcedByOs ? 'os' : 'default',
    );
    try {
      options.onLayoutChange?.();
    } catch {
      // A failed region refresh costs clickability, never the session.
    }
  };

  const apply = (next: ReducedMotionPreference, persist: boolean): void => {
    preference = next;
    try {
      options.applyPreference(next);
    } catch {
      // The a11y controller is the DOM writer; a failure there leaves the
      // class untouched and animation lanes treat that as motion allowed.
    }
    if (persist) {
      try {
        void Promise.resolve(options.persist(next)).catch(() => undefined);
      } catch {
        // In-memory only. Spec 20: a preference write never blocks.
      }
    }
    render();
  };

  input.addEventListener('change', () => {
    // checked = animation ON = follow the OS (null); see config.ts.
    apply(input?.checked === true ? null : true, true);
  });

  if (media?.addEventListener) {
    onOsChange = () => render();
    try {
      media.addEventListener(REDUCED_MOTION_EVENT, onOsChange);
    } catch {
      onOsChange = null;
    }
  }

  // Paint the boot state. The a11y runtime already applied the persisted
  // preference in main.ts, so this render must NOT re-apply it — it only
  // reflects it.
  render();

  return {
    get element() {
      return root;
    },
    get preference() {
      return preference;
    },
    get motionOff() {
      // Off when the user asked for it, or when the OS is asking and the
      // user has not overridden it (`null` = follow the OS).
      return preference === true || osReduced();
    },
    set: (next) => apply(next, false),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (onOsChange && media?.removeEventListener) {
        try {
          media.removeEventListener(REDUCED_MOTION_EVENT, onOsChange);
        } catch {
          // best-effort teardown
        }
      }
      onOsChange = null;
      root?.remove();
      root = null;
      input = null;
      hint = null;
    },
  };
}
