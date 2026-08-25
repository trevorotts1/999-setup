/**
 * Captions DOM surface (Master Spec 0E WS-14, spec 5.2 / 11 / 19 / 28).
 *
 * Renders the caption region — the last question/status text, ALWAYS
 * shown regardless of voice-output state (spec 5.2). It never paints a
 * background behind the character (spec 11: WS-07 owns the transparent
 * window invariant), never runs continuous animation (spec 19), and never
 * resolves session identity.
 *
 * A11y: the root is a `role="status"` `aria-live="polite"` region so
 * screen readers announce caption changes; the voice toggle never hides
 * it (spec 5.2).
 *
 * The document is INJECTED (mirror of the compact/WS-10 lane): the shell
 * passes the real document in the browser; tests pass a fake cast to
 * Document. Without a document or mount the view degrades to a no-op view
 * (spec 20: failure never stops Claude).
 *
 * NOTE for linting: `mount.innerHTML = ''` clears only placeholder /
 * previously-created surfaces on an element this lane created or was
 * handed for mounting; all user/status text goes through `textContent`,
 * never innerHTML.
 *
 * @module
 */

import {
  CAPTIONS_LIVE,
  CAPTIONS_ROLE,
  CAPTIONS_ROOT_CLASS,
  CAPTIONS_STALE_CLASS,
  CAPTIONS_STYLE_ID,
  type CaptionsTextScale,
} from './config.ts';
import type { CaptionEntry } from './model.ts';

/**
 * Surface style contract. Variable references ONLY (no hex/rgba/url —
 * WS-07's transparent-window invariant forbids baked backgrounds; the
 * captions surface is a text layer over the transparent webview).
 * One-shot fade only; no loop (spec 19); reduced-motion class consumed
 * (never defined).
 */
export const CAPTIONS_STYLE_TEXT = `
.candice-captions {
  --candice-cap-text: var(--candice-text);
  --candice-cap-muted: var(--candice-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  max-width: 420px;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.35;
  color: var(--candice-cap-text);
  text-align: center;
  transition: opacity 200ms ease;
  /* FIX-008: the window is transparent, so the question text needs its own
     opaque backdrop or it renders straight onto the user's desktop. This is
     the same surface token the contrast matrix measures every ratio against. */
  background: var(--candice-ui-surface);
  border: 1px solid var(--candice-ui-border);
  border-radius: 8px;
}
/* FIX-008: staleness dims the TEXT, never the backdrop. Fading the element
   fades the scrim with it and hands the effective contrast back to whatever
   desktop is behind the window. */
.candice-captions.candice-captions-stale {
  opacity: 1;
}
.candice-captions.candice-captions-stale .candice-captions-text {
  color: var(--candice-cap-muted);
}
.candice-captions-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--candice-cap-muted);
}
.candice-captions-text {
  max-width: 100%;
  overflow-wrap: anywhere;
}
.candice-captions.candice-captions-empty {
  opacity: 0;
}
.candice-captions.candice-captions-empty .candice-captions-text {
  min-height: 1em;
}
html.candice-reduced-motion .candice-captions {
  transition: none;
}
`;

/** Scale-based CSS font-size map (spec 9 text size). */
export const CAPTIONS_SCALE_FONT_SIZES: Record<CaptionsTextScale, string> = {
  small: '12px',
  medium: '14px',
  large: '17px',
};

export interface CaptionsView {
  /** Root element. */
  readonly el: HTMLElement | null;
  /** Apply one entry (empty text clears to the reset state). */
  show(entry: CaptionEntry): void;
  /** Keep the live content in sync with the machine state's current text. */
  sync(text: string): void;
  /** Mark the current content stale (faded but still visible, spec 5.2). */
  fade(): void;
  /** Set the display scale (spec 9 text-size preference). */
  setTextScale(scale: CaptionsTextScale): void;
  /** Detach + tear down. */
  destroy(): void;
}

/** No-op view used when mount/document are unavailable (spec 20). */
function NULL_VIEW(): CaptionsView {
  return {
    el: null,
    show: () => undefined,
    sync: () => undefined,
    fade: () => undefined,
    setTextScale: () => undefined,
    destroy: () => undefined,
  };
}

function resolveDoc(doc: Document | null): Document | null {
  if (doc !== null) return doc;
  try {
    if (typeof document !== 'undefined') return document;
  } catch {
    return null;
  }
  return null;
}

export function mountCaptionsStyle(d: Document | null): void {
  if (d === null) return;
  if (d.getElementById(CAPTIONS_STYLE_ID) !== null) return;
  const style = d.createElement('style');
  style.id = CAPTIONS_STYLE_ID;
  style.textContent = CAPTIONS_STYLE_TEXT;
  (d.head ?? d.documentElement).append(style);
}

/** Create the captions view. Never throws (spec 20). */
export function createCaptionsView(
  mount: HTMLElement | null,
  doc: Document | null = null,
): CaptionsView {
  const d = resolveDoc(doc);
  if (mount === null || d === null) {
    return NULL_VIEW();
  }
  mountCaptionsStyle(d);
  mount.replaceChildren();

  const root = d.createElement('div');
  root.className = CAPTIONS_ROOT_CLASS;
  root.setAttribute('role', CAPTIONS_ROLE);
  root.setAttribute('aria-live', CAPTIONS_LIVE);
  root.classList.add('candice-captions-empty');

  const label = d.createElement('div');
  label.className = 'candice-captions-label';
  label.textContent = 'Candice';

  const text = d.createElement('div');
  text.className = 'candice-captions-text';
  text.setAttribute('aria-live', CAPTIONS_LIVE);

  root.appendChild(label);
  root.appendChild(text);
  mount.appendChild(root);

  let stale = false;

  const setStale = (on: boolean): void => {
    if (stale === on) return;
    stale = on;
    root.classList.toggle(CAPTIONS_STALE_CLASS, on);
  };

  const render = (entry: CaptionEntry | null): void => {
    if (entry === null || entry.text === '') {
      root.classList.add('candice-captions-empty');
      text.textContent = '';
      setStale(false);
      return;
    }
    root.classList.remove('candice-captions-empty');
    text.textContent = entry.text;
    setStale(!entry.important);
  };

  return {
    el: root,
    show: (entry) => render(entry),
    sync: (captionText) => {
      // Empty text is the machine's "no caption right now" signal.
      render(captionText === '' ? null : { text: captionText, important: false, seq: -1 });
    },
    fade: () => setStale(true),
    setTextScale: (scale) => {
      const size = CAPTIONS_SCALE_FONT_SIZES[scale];
      if (typeof size === 'string') text.style.fontSize = size;
    },
    destroy: () => {
      root.remove();
    },
  };
}
