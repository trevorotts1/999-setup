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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* 12px above, 6px below. The animation toggle sits directly on top with an
     identical silhouette, and at a matching 6px gap the two scanned as one
     grouped pair -- which is both why the off switch was hard to FIND and
     why a miss aimed at the toggle could land on quit. */
  /* THIRD ITEM ON THE ROW, not a line of its own.
     This has been, in turn, its own floating card, then a row under the
     toggles separated by a hairline. It is now the third switch beside Voice
     and Hologram, because that is what the operator asked for: "then by next
     one that says Candice and that has an on and off switch".

     The separation it used to carry was load-bearing -- an identical
     silhouette directly under the toggles made the off switch both hard to
     find and easy to hit by accident -- and it is not simply dropped. It
     moves into COLOUR: this switch alone is tinted --candice-danger, so the
     one control that ends the session is the one control that is not
     lavender. Costs no width, which is what the row has none of. */
  margin: 0;
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
  padding: 2px 0;
  min-height: 44px;
  /* Intrinsic, like the two switches beside it -- three share one line. */
  width: auto;
  flex: 0 0 auto;
  /* At the Large text scale (1.2) the button plus the hint runs past the
     420px window, and body{overflow:hidden} clips the tail rather than
     scrolling it, so the row reads as broken. Wrap instead. */
  max-width: 100%;
  flex-wrap: wrap;
  justify-content: flex-start;
  font-size: calc(12px * var(--candice-text-scale, 1));
  line-height: 1.3;
  color: var(--candice-text, #faf7ff);
  /* Transparent: this row now sits inside the settings panel, which
     paints the group's single opaque surface. Painting again here is what
     made it a third floating card. */
  background: transparent;
  border: 0;
}
.${POWER_OFF_CLASS} label {
  cursor: pointer;
  align-self: stretch;
  display: flex;
  align-items: center;
}
.${POWER_OFF_CLASS} input {
  width: 16px;
  height: 16px;
  /* THE ONE THING ON THIS ROW THAT IS NOT LAVENDER.
     This used to be a pill with a danger border, and the reason for the
     danger tint has not changed: an identical silhouette beside the other
     controls left the operator unable to tell which one ended the session.
     Now that it is a checkbox in a row of checkboxes, the tint is the ONLY
     thing distinguishing it, so it matters more than it did, not less.

     8.04:1 on the surface; see --candice-danger in styles.css. accent-color
     paints the checked box, which is the state this control spends all of
     its visible life in -- Candice is on whenever you can see this. */
  accent-color: var(--candice-danger, #ff8a8a);
  cursor: pointer;
  flex: none;
}
.${POWER_OFF_CLASS} input:disabled {
  cursor: default;
  opacity: 0.6;
}
/* HIDDEN AT REST, SHOWN WHEN IT MATTERS.
   Same live region as the other two switches, and hidden the same way and
   for the same reason -- the operator asked for switches "without all the
   fucking words". The difference is the failure state: if the close cannot
   be delivered, the user has just switched Candice off and watched nothing
   happen, and a silent screen-reader-only message is not enough. That one
   case unhides. */
.${POWER_OFF_CLASS} .${POWER_OFF_CLASS}-hint {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
  color: var(--candice-muted, #d7cfdf);
  font-size: calc(11px * var(--candice-text-scale, 1));
}
.${POWER_OFF_CLASS}[data-candice-power="failed"] .${POWER_OFF_CLASS}-hint {
  position: static;
  width: auto;
  height: auto;
  margin: 0;
  overflow: visible;
  clip: auto;
  clip-path: none;
  white-space: normal;
  flex-basis: 100%;
  color: var(--candice-danger, #ff8a8a);
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
  let toggle: HTMLInputElement | null = null;
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

    // A SWITCH, NOT A BUTTON.
    //
    // It was a button because turning her off is an action, and a verb that
    // fires once cannot honestly report a pressed state. The operator asked
    // for it to join the row of switches instead -- "then by next one that
    // says Candice and that has an on and off switch" -- and as a two-state
    // control it CAN report its state honestly: checked means Candice is on,
    // which is true of every moment you can see this control.
    //
    // A native checkbox rather than a styled div: Space toggles it, the OS
    // draws its own focus ring, and the checked state is announced without
    // inventing an aria-checked to keep in sync. Same choice the two
    // switches beside it make, which is why they behave identically.
    const label = doc.createElement('label');
    label.setAttribute('for', POWER_OFF_ID);
    label.textContent = POWER_OFF_LABEL;

    toggle = doc.createElement('input');
    toggle.setAttribute('type', 'checkbox');
    toggle.id = POWER_OFF_ID;
    // On, because she is: this control only exists while she is running.
    toggle.checked = true;

    hint = doc.createElement('span');
    hint.className = `${POWER_OFF_CLASS}-hint`;
    hint.textContent = POWER_OFF_HINT;
    // The hint carries the outcome, so it must be announced when it changes.
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');

    // Name then switch, matching Voice and Hologram exactly.
    root.append(label, toggle, hint);
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
    if (toggle !== null) {
      toggle.disabled = false;
      // BACK ON, because she is still here. A switch that stays OFF while
      // Candice is visibly still running is a control lying about the state
      // of the thing it controls -- the exact confusion the animation toggle
      // used to cause. The failure hint (which unhides in this state, see
      // the stylesheet) says what happened; the switch says what is true.
      toggle.checked = true;
    }
    root?.setAttribute('data-candice-power', 'failed');
    relayout();
  };

  const press = (): void => {
    // Single-flight. A second click while the first close is in flight must
    // not fire a second quit; in production the process is already leaving.
    if (destroyed || closing) return;
    closing = true;
    if (toggle !== null) {
      toggle.disabled = true;
      // press() is also the programmatic path (tests, keyboard shortcuts),
      // where nothing has moved the switch yet.
      toggle.checked = false;
    }
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

  // Only OFF acts. Switching it back on is not a second action to run --
  // there is nothing to turn on, she is already running -- and after a failed
  // close fail() has re-checked the box itself, so a change event from that
  // must not loop straight back into another quit attempt.
  toggle.addEventListener('change', () => {
    if (toggle !== null && toggle.checked === false) press();
  });
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
      toggle = null;
      hint = null;
    },
  };
}
