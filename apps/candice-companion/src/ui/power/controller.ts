/**
 * Turn-off control — control surface.
 *
 * Mounts one button that turns Candice off, next to the animation toggle it
 * kept being mistaken for. See `./config.ts` for why it turns HER off rather
 * than her motion, and why it deliberately has no confirmation dialog.
 *
 * Pointer reachability: the companion window is pointer-transparent except
 * over regions published to the native hit test
 * (`src/window/native-input-regions.ts`). A `button` already matches that
 * lane's `CONTROL_SELECTOR`, so this becomes clickable as soon as the
 * regions are refreshed — which is why {@link PowerOffOptions.onLayoutChange}
 * exists and is called after mount and after every visible state change.
 *
 * Never throws (spec 20): a missing document or a wedged native boundary
 * degrades to an inert handle or a visible failure hint. A control that
 * cannot close her must not take the session down with it.
 *
 * @module
 */

import {
  POWER_OFF_BUSY_HINT,
  POWER_OFF_CLASS,
  POWER_OFF_FAILED_HINT,
  POWER_OFF_HINT,
  POWER_OFF_ID,
  POWER_OFF_LABEL,
  POWER_OFF_STYLE_ID,
} from './config.ts';

export interface PowerOffOptions {
  /** Element the control is appended to. */
  mount: HTMLElement;
  /** Document injection for tests; defaults to `mount.ownerDocument`. */
  doc?: Document;
  /**
   * Ask native to close the app. Resolves when the request was accepted;
   * rejects (or returns false) when it could not be delivered. In production
   * a success never actually resolves visibly — the process is gone.
   */
  quit(): Promise<unknown> | unknown;
  /** Called after the control's visible box changes (input-region refresh). */
  onLayoutChange?(): void;
}

export interface PowerOff {
  /** The mounted root, or null when the DOM was unusable. */
  readonly element: HTMLElement | null;
  /** True once a close has been requested and not yet failed. */
  readonly closing: boolean;
  /** Trigger the same path as a user click (tests, keyboard shortcuts). */
  press(): void;
  /** Remove DOM. Idempotent. */
  destroy(): void;
}

function injectStyle(doc: Document): void {
  if (doc.getElementById(POWER_OFF_STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = POWER_OFF_STYLE_ID;
  // The window is transparent, so this control paints its own opaque
  // backdrop for the same reason the animation toggle does: otherwise it
  // renders onto the user's desktop and cannot be read.
  style.textContent = `
.${POWER_OFF_CLASS} {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 12px above, 6px below. The animation toggle sits directly on top with an
     identical silhouette, and at a matching 6px gap the two scanned as one
     grouped pair -- which is both why the off switch was hard to FIND and
     why a miss aimed at the toggle could land on quit. */
  margin: 12px auto 6px;
  /* PUBLICATION and ACTIVATION are different things here, deliberately.

     The ROW is what the native hit test publishes (.candice-power-off is
     listed in CONTROL_SELECTOR, window/visible-regions.ts), so a near miss
     lands inside Candice rather than passing through to the desktop. That
     is what min-height 44px buys, and it is the whole reason the entry
     exists -- without it the hit test would publish the inner <button>
     alone, about 26px.

     But the only click HANDLER is on the button, so the activation target
     is the button, not the row. That is intentional: this is the one
     control that ends the session, and a 44px activation strip directly
     under a 44px toggle invites ending it by accident. The button is sized
     below for a comfortable target without becoming that strip. Do not
     "fix" this by moving the handler to the row. */
  padding: 6px 10px;
  min-height: 44px;
  width: fit-content;
  /* At the Large text scale (1.2) the button plus the hint runs past the
     420px window, and body{overflow:hidden} clips the tail rather than
     scrolling it, so the row reads as broken. Wrap instead. */
  max-width: min(92vw, 404px);
  flex-wrap: wrap;
  justify-content: center;
  font-size: calc(12px * var(--candice-text-scale, 1));
  line-height: 1.3;
  color: var(--candice-text, #faf7ff);
  /* Transparent: this row now sits inside the settings panel, which
     paints the group's single opaque surface. Painting again here is what
     made it a third floating card. */
  background: transparent;
  border: 0;
}
.${POWER_OFF_CLASS} button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 6px;
  /* Distinct from the toggle beside it, without shouting.

     Transparent-with-the-same-lavender-border made this a visual twin of
     the animation toggle, which is what left the operator unable to tell
     which chip was the off switch. The danger tint is carried by colour and
     border only -- NOT a filled red at rest, which would read as a warning
     and invite mis-clicks on a control that is a perfectly normal thing to
     want. Filled is the hover state, below.

     8.04:1 on the surface; see --candice-danger in styles.css. */
  border: 1px solid var(--candice-danger, #ff8a8a);
  color: var(--candice-danger, #ff8a8a);
  background: transparent;
  /* The activation target, as distinct from the published row above. 32px
     clears the 24px minimum comfortably while staying visibly a small pill
     inside the 44px row rather than a full-width quit strip. */
  min-height: 32px;
  min-width: 88px;
}
.${POWER_OFF_CLASS} button:hover:not(:disabled) {
  /* Inverted, and symmetric: surface-on-danger is the same measured 8.04:1
     as danger-on-surface. */
  background: var(--candice-danger, #ff8a8a);
  color: var(--candice-ui-surface, #171321);
  border-color: var(--candice-danger, #ff8a8a);
}
.${POWER_OFF_CLASS} button:disabled {
  cursor: default;
  opacity: 0.6;
}
.${POWER_OFF_CLASS} .${POWER_OFF_CLASS}-hint {
  color: var(--candice-muted, #d7cfdf);
  font-size: calc(11px * var(--candice-text-scale, 1));
}
`;
  (doc.head ?? doc.documentElement).append(style);
}

/**
 * Mount the turn-off control. Returns an inert handle when the DOM is
 * unusable so callers never branch on null (spec 20).
 */
export function createPowerOff(options: PowerOffOptions): PowerOff {
  const doc = options.doc ?? options.mount?.ownerDocument ?? null;
  let root: HTMLElement | null = null;
  let button: HTMLButtonElement | null = null;
  let hint: HTMLElement | null = null;
  let closing = false;
  let destroyed = false;

  const inert: PowerOff = {
    element: null,
    get closing() {
      return closing;
    },
    press: () => undefined,
    destroy: () => undefined,
  };

  if (doc === null || options.mount == null) return inert;
  // Re-entry (HMR, double mount) keeps the first control. Two off buttons is
  // one more than anybody needs.
  if (doc.getElementById(POWER_OFF_ID) !== null) return inert;

  try {
    injectStyle(doc);

    root = doc.createElement('div');
    root.className = POWER_OFF_CLASS;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Turn Candice off');

    button = doc.createElement('button');
    button.id = POWER_OFF_ID;
    button.type = 'button';
    button.textContent = POWER_OFF_LABEL;
    // No aria-pressed: this is an action, not a two-state control. A verb
    // that fires once cannot honestly report a pressed state.

    hint = doc.createElement('span');
    hint.className = `${POWER_OFF_CLASS}-hint`;
    hint.textContent = POWER_OFF_HINT;
    // The hint carries the outcome, so it must be announced when it changes.
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');

    root.append(button, hint);
    options.mount.append(root);
  } catch {
    return inert;
  }

  const relayout = (): void => {
    try {
      options.onLayoutChange?.();
    } catch {
      // A failed region refresh costs clickability, never the session.
    }
  };

  const fail = (): void => {
    if (destroyed) return;
    closing = false;
    if (hint !== null) hint.textContent = POWER_OFF_FAILED_HINT;
    if (button !== null) button.disabled = false;
    root?.setAttribute('data-candice-power', 'failed');
    relayout();
  };

  const press = (): void => {
    // Single-flight. A second click while the first close is in flight must
    // not fire a second quit; in production the process is already leaving.
    if (destroyed || closing) return;
    closing = true;
    if (button !== null) button.disabled = true;
    if (hint !== null) hint.textContent = POWER_OFF_BUSY_HINT;
    root?.setAttribute('data-candice-power', 'closing');
    relayout();
    try {
      // Native normally never comes back from this — the app exits. Only a
      // refusal or a missing boundary lands in the failure path.
      void Promise.resolve(options.quit()).then(
        (outcome) => {
          if (outcome === false) fail();
        },
        () => fail(),
      );
    } catch {
      fail();
    }
  };

  button.addEventListener('click', press);
  root.setAttribute('data-candice-power', 'ready');
  relayout();

  return {
    get element() {
      return root;
    },
    get closing() {
      return closing;
    },
    press,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      root?.remove();
      root = null;
      button = null;
      hint = null;
    },
  };
}
