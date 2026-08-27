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
  margin: 0 auto 6px;
  /* Same geometry as the animation toggle it sits beside: the ROW is the
     target, and min-height carries it to the 44px minimum because the
     native region padding only adds 4px. */
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
.${POWER_OFF_CLASS} button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--candice-ui-border, #beb0ff);
  /* Deliberately NOT the accent colour. This is the one control on the
     surface that ends the session; it should read as distinct from the
     toggle beside it without shouting, because it is a normal thing to
     want and pressing it costs nothing. */
  background: transparent;
}
.${POWER_OFF_CLASS} button:hover:not(:disabled) {
  background: var(--candice-ui-border, #beb0ff);
  color: var(--candice-ui-surface, #171321);
}
.${POWER_OFF_CLASS} button:disabled {
  cursor: default;
  opacity: 0.6;
}
.${POWER_OFF_CLASS} .${POWER_OFF_CLASS}-hint {
  color: var(--candice-muted, #a8a3b8);
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
