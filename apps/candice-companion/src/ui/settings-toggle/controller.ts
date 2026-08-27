/**
 * A plain on/off settings row that persists its value.
 *
 * Behaviour is modelled on `ui/animation-toggle`, whose hard-won parts are
 * repeated here on purpose:
 *
 *   - mounts exactly ONCE per id, so a second call is inert rather than
 *     producing two controls that disagree;
 *   - the hint is a `role="status"` live region, so a screen reader hears
 *     the new state instead of only sighted users seeing it;
 *   - `onLayoutChange` fires after mount AND after every state change,
 *     because the window is pointer-transparent outside published
 *     rectangles: a control that never refreshes them is DRAWN BUT NOT
 *     CLICKABLE;
 *   - a native checkbox, so Space/Enter and the OS's own focus ring work
 *     without reimplementation, and no `aria-pressed` is invented on top of
 *     the native checked state;
 *   - a failed persist degrades to an in-memory toggle rather than refusing
 *     the change. An off switch must switch things off; whether the choice
 *     survives a restart is a separate question.
 *
 * @module
 */

import {
  SETTINGS_PANEL_CLASS,
  SETTINGS_TOGGLE_CLASS,
  SETTINGS_TOGGLE_HINT_CLASS,
  SETTINGS_TOGGLE_STYLE_ID,
} from './config.ts';

export interface SettingsToggleOptions {
  mount: HTMLElement;
  doc?: Document;
  /** Stable element id — also the single-mount key. */
  id: string;
  /** Row class, published to the native hit test. */
  className: string;
  label: string;
  onHint: string;
  offHint: string;
  /** Value at boot. */
  checked: boolean;
  /** Apply the change. Called BEFORE persist, and never awaited. */
  apply?: (checked: boolean) => void;
  /** Write it down. A rejected or throwing persist is not fatal. */
  persist?: (checked: boolean) => Promise<boolean> | boolean | void;
  /** Republish the pointer regions. */
  onLayoutChange?: () => void;
}

export interface SettingsToggleController {
  /** The mounted row, or null when the DOM was unusable / already mounted. */
  element: HTMLElement | null;
  /** Current state, readable without touching the DOM. */
  isOn: () => boolean;
  /** Programmatic set, used to keep a second view of the same field in sync. */
  set: (checked: boolean) => void;
}

const INERT: SettingsToggleController = {
  element: null,
  isOn: () => false,
  set: () => undefined,
};

function injectStyle(doc: Document): void {
  if (doc.getElementById(SETTINGS_TOGGLE_STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = SETTINGS_TOGGLE_STYLE_ID;
  // The window is transparent, so every text-bearing row paints its own
  // opaque surface — text drawn onto transparency has no defined contrast.
  // Geometry matches the animation toggle it sits beside, so the settings
  // rows read as one column rather than as three unrelated widgets.
  style.textContent = `
.${SETTINGS_TOGGLE_CLASS} {
  /* INLINE, NOT A LINE OF ITS OWN.
     Each setting used to take a full row with a sentence of explanation
     under it, so two switches plus the off control ran to roughly 160px of
     a 640px window. The operator: "why does voice have to be on its own
     line and hologram be on its own line... it should say voice and then an
     on and off switch and then right next to it is hologram". They are one
     line now: name, switch, name, switch, name, switch. */
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* No margin and no width of its own: the row is a member of the panel
     below, and the panel owns the column. */
  margin: 0;
  flex: 0 0 auto;
  padding: 2px 0;
  /* The ROW is the click target, not the 16px box inside it: outside a
     published rectangle the window is pointer-transparent, so a near miss
     goes through Candice to the desktop. min-height carries it to the 44px
     minimum; the native region padding adds only 4px. */
  min-height: 44px;
  /* Sized by its own contents now -- a name and a checkbox -- because three
     of these share one line. This is not the shrink-wrapping the layout
     contract forbids: that rule is about PANELS, which must all be the same
     width. An item inside a row is the case where intrinsic width is right. */
  width: auto;
  max-width: 100%;
  flex-wrap: nowrap;
  justify-content: flex-start;
  font-size: calc(12px * var(--candice-text-scale, 1));
  line-height: 1.3;
  color: var(--candice-text, #faf7ff);
  /* NO background, NO border, NO radius. the settings panel below
     paints once for the whole group; a row that painted its own turned the
     group into a stack of separate floating cards. */
  background: transparent;
  border: 0;
}

/* The one surface the settings group paints. Opaque for the same reason the
   rows used to be: a transparent window can have any desktop behind it, and
   unreadable controls are broken controls. */
.${SETTINGS_PANEL_CLASS} {
  display: flex;
  /* One line, and it wraps rather than clips: at the Large text scale three
     names plus three checkboxes can exceed the column, and body has
     overflow:hidden, so an unwrapped row would lose its tail. */
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0 10px;
  /* One column, same token as every other panel (styles.css). */
  width: var(--candice-col);
  max-width: 100%;
  margin: 0 auto;
  padding: var(--candice-panel-pad);
  color: var(--candice-text, #faf7ff);
  background: var(--candice-ui-surface, #171321);
  border: 1px solid var(--candice-ui-edge, #3a3350);
  border-radius: var(--candice-panel-radius, 14px);
}
.${SETTINGS_TOGGLE_CLASS} input {
  width: 16px;
  height: 16px;
  accent-color: var(--candice-accent, #7c5cff);
  cursor: pointer;
  flex: none;
}
.${SETTINGS_TOGGLE_CLASS} label {
  cursor: pointer;
  /* Stretch so the WORDS activate the checkbox, not just the 16px box. */
  align-self: stretch;
  display: flex;
  align-items: center;
}
/* HEARD, NOT SEEN.
   "Candice reads questions out loud." and "Candice is visible." were a
   sentence per control, and the operator's instruction was a switch "without
   all the fucking words". They are not deleted, because they are not
   decoration: this is a role="status" live region, and it is how a screen
   reader learns the switch changed state at all -- a checkbox announces
   checked/unchecked, not what was turned on. Taking the text out of the DOM
   would take that announcement with it.
   So it stops being drawn and keeps being announced. The colour and size
   below never render now; they stay so that the failure hint pattern in
   ui/power/controller.ts, which DOES reveal its hint, has one styling rule
   to reuse rather than inventing a second. */
.${SETTINGS_TOGGLE_CLASS} .${SETTINGS_TOGGLE_HINT_CLASS} {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  /* Both forms: clip-path is the modern one, clip is what older WebKit
     honours, and this ships to WKWebView and WebView2 alike. */
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
  color: var(--candice-muted, #d7cfdf);
  font-size: calc(11px * var(--candice-text-scale, 1));
}
`;
  (doc.head ?? doc.documentElement).append(style);
}

export function createSettingsToggle(options: SettingsToggleOptions): SettingsToggleController {
  const doc = options.doc ?? options.mount?.ownerDocument ?? null;
  if (doc === null || typeof doc.createElement !== 'function' || !options.mount) return INERT;
  // Single mount. A second control bound to the same preference would let
  // the two disagree on screen, which is worse than having none.
  if (doc.getElementById(options.id) !== null) return INERT;

  injectStyle(doc);

  const row = doc.createElement('div');
  row.className = `${SETTINGS_TOGGLE_CLASS} ${options.className}`;

  const input = doc.createElement('input');
  input.setAttribute('type', 'checkbox');
  input.id = options.id;

  const label = doc.createElement('label');
  label.setAttribute('for', options.id);
  label.textContent = options.label;

  const hint = doc.createElement('span');
  hint.className = SETTINGS_TOGGLE_HINT_CLASS;
  // Announced, not merely displayed: the state change is the whole point.
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');

  // NAME THEN SWITCH, in that order: "it should say voice and then an on and
  // off switch". The label keeps its `for`, so the association a screen
  // reader reads is unchanged by the visual order.
  row.append(label, input, hint);
  options.mount.append(row);

  let on = options.checked === true;

  const paint = (): void => {
    input.checked = on;
    hint.textContent = on ? options.onHint : options.offHint;
  };

  const change = (next: boolean, persist: boolean): void => {
    on = next;
    paint();
    // APPLY FIRST, then write. A preference that only takes effect when the
    // disk write succeeds leaves the control reading OFF while the thing
    // carries on — which is what an off switch failing looks like.
    try {
      options.apply?.(on);
    } catch { /* an apply that throws must not wedge the control */ }
    if (persist && options.persist) {
      try {
        void Promise.resolve(options.persist(on)).catch(() => undefined);
      } catch { /* degrade to in-memory */ }
    }
    options.onLayoutChange?.();
  };

  input.addEventListener('change', () => { change(input.checked === true, true); });

  paint();
  // Publish the row's rectangle now, or it is drawn and not clickable.
  options.onLayoutChange?.();

  return {
    element: row,
    isOn: () => on,
    set: (checked: boolean) => {
      if (checked === on) return;
      change(checked === true, false);
    },
  };
}
