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
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto 6px;
  padding: 6px 10px;
  /* The ROW is the click target, not the 16px box inside it: outside a
     published rectangle the window is pointer-transparent, so a near miss
     goes through Candice to the desktop. min-height carries it to the 44px
     minimum; the native region padding adds only 4px. */
  min-height: 44px;
  width: fit-content;
  /* Long hints must wrap rather than be clipped: body has overflow:hidden,
     so an overflowing row loses its tail and reads as broken. */
  max-width: min(92vw, 404px);
  flex-wrap: wrap;
  justify-content: center;
  font-size: calc(12px * var(--candice-text-scale, 1));
  line-height: 1.3;
  color: var(--candice-text, #faf7ff);
  background: var(--candice-ui-surface, #171321);
  border: 1px solid var(--candice-ui-border, #beb0ff);
  border-radius: 8px;
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
.${SETTINGS_TOGGLE_CLASS} .${SETTINGS_TOGGLE_HINT_CLASS} {
  color: var(--candice-muted, #d7cfdf);
  font-size: calc(11px * var(--candice-text-scale, 1));
  width: 100%;
  text-align: center;
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

  row.append(input, label, hint);
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
