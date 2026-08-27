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
import { splitSentences, activeSentenceIndex } from './highlight.ts';

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
  border: 1px solid var(--candice-ui-edge);
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
  /* Scales with the preference like the caption it labels. */
  font-size: calc(11px * var(--candice-text-scale, 1));
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--candice-cap-muted);
}
.candice-captions-text {
  max-width: 100%;
  overflow-wrap: anywhere;
  /* The question is the thing the user has to answer -- it is never shortened
     to fit. It used to be: 500 chars and an ellipsis, with the remainder
     unreachable because nothing scrolled. When it does not fit, this scrolls.
     overscroll-behavior:contain stops a flick past the end of the question
     from scrolling whatever desktop is behind the transparent window. */
  max-height: 26vh;
  /* WKWebView overlay scrollbars stay invisible until a scroll is already in
     progress, so a clipped question reads as truncated even though it
     scrolls -- the exact complaint this box was widened to answer. The
     ::-webkit-scrollbar rules above keep the thumb permanently visible, so
     "there is more below" is legible without touching anything. */
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--candice-ui-border) transparent;
  overscroll-behavior: contain;
  /* Question copy uses blank lines to separate the choices. textContent keeps
     them, but the default white-space collapses them back into one wall of
     text -- which is the thing the rewrite was meant to stop. */
  white-space: pre-wrap;
  text-align: left;
}
/* A scrollable region must be reachable by keyboard, not just by trackpad. */
.candice-captions-text::-webkit-scrollbar {
  width: 8px;
}
.candice-captions-text::-webkit-scrollbar-thumb {
  background: var(--candice-ui-border);
  border-radius: 4px;
}
.candice-captions-text:focus-visible {
  outline: 2px solid var(--candice-ui-border);
  outline-offset: 2px;
}
/* The sentence currently being spoken. Deliberately a background wash rather
   than a colour change: the contrast matrix measures caption text against the
   surface token, and recolouring the text would move a measured ratio. */
.candice-captions-spoken {
  background: var(--candice-ui-border);
  color: var(--candice-ui-surface);
  border-radius: 3px;
}
html.candice-reduced-motion .candice-captions-spoken {
  /* Reduced motion removes the MOVEMENT, not the information. */
  background: var(--candice-ui-border);
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
  /**
   * Highlight the sentence being spoken. `fraction` is 0..1 through the
   * utterance; null clears the highlight and restores plain text.
   */
  setSpokenProgress(fraction: number | null): void;
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
    setSpokenProgress: () => undefined,
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
  // The caption scrolls when a long question overflows; a scrollable region
  // that cannot be focused is unreachable without a pointer.
  text.tabIndex = 0;
  // NOT a live region. The root above already is one, and a live region
  // nested inside another makes assistive technology announce the same
  // caption twice. This element additionally has its children replaced on
  // every spoken sentence (see setSpokenProgress), which inside a live
  // region means the WHOLE question is re-announced once per sentence for
  // the entire utterance -- the caption reads itself over and over while
  // Candice is still speaking the first line.

  root.appendChild(label);
  root.appendChild(text);
  mount.appendChild(root);

  let stale = false;
  let currentText = '';
  let highlighted = -1;

  const setStale = (on: boolean): void => {
    if (stale === on) return;
    stale = on;
    root.classList.toggle(CAPTIONS_STALE_CLASS, on);
  };

  const render = (entry: CaptionEntry | null): void => {
    if (entry === null || entry.text === '') {
      root.classList.add('candice-captions-empty');
      text.textContent = '';
      // Clear the HIGHLIGHT STATE too, not just the DOM. Leaving currentText
      // set meant a later setSpokenProgress(null) -- which the highlight
      // driver emits on every drain, 100ms apart -- took the "restore plain
      // text" branch and wrote the OLD question back into the element. The
      // empty class hides it visually, so nothing looked wrong, but this is
      // an aria-live region: a screen reader re-announced a question that had
      // already been answered and cleared.
      currentText = '';
      highlighted = -1;
      // Same restore as the branch below: clearing must not leave the
      // region latched off for whatever is shown next.
      root.setAttribute('aria-live', CAPTIONS_LIVE);
      setStale(false);
      return;
    }
    root.classList.remove('candice-captions-empty');
    // Restore liveness BEFORE the text changes, or this caption is silent.
    //
    // Sentence highlighting sets `aria-live: off` so the region is not
    // re-announced once per sentence over the speech it accompanies. The
    // only place that turned it back on was `setSpokenProgress(null)` --
    // and that path returns early when `highlighted === -1`, which is
    // exactly what a new caption sets. So one interrupted utterance
    // latched the region off for the rest of the session:
    //
    //   highlight active (off) -> new caption renders (highlighted = -1)
    //   -> drain fires setSpokenProgress(null) -> early return, no restore.
    //
    // Every later caption, including every later QUESTION, then mutated a
    // dead live region. A screen-reader user heard nothing and the
    // interview simply stopped talking to them -- with no visible symptom,
    // because sighted users could still read it.
    root.setAttribute('aria-live', CAPTIONS_LIVE);
    currentText = entry.text;
    highlighted = -1;
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
    setSpokenProgress: (fraction) => {
      if (currentText === '') return;
      if (fraction === null) {
        if (highlighted === -1) return;
        highlighted = -1;
        text.textContent = currentText;
        // The utterance is over; the region speaks for itself again.
        root.setAttribute('aria-live', CAPTIONS_LIVE);
        return;
      }
      const sentences = splitSentences(currentText);
      const index = activeSentenceIndex(sentences, fraction);
      // Rebuild only when the highlighted sentence actually changes: this runs
      // on an animation frame, and replacing the DOM 60x a second would fight
      // the user's scroll position inside the caption box.
      if (index === highlighted) return;
      highlighted = index;
      if (index < 0) { text.textContent = currentText; return; }
      // Highlighting is a VISUAL progress cue. The caption was already
      // announced once when it was rendered; re-announcing it per sentence
      // is noise that talks over the speech it is meant to accompany.
      root.setAttribute('aria-live', 'off');
      const spans = sentences.map((s, i) => {
        const span = d.createElement('span');
        // textContent, never innerHTML: caption text is untrusted content.
        span.textContent = s.text;
        if (i === index) span.className = 'candice-captions-spoken';
        return span;
      });
      text.replaceChildren(...spans);
      // The caption scrolls (max-height + overflow-y), which is exactly why
      // the highlight needs to follow: on a long question the sentence being
      // spoken is otherwise highlighted below the fold, where the whole
      // feature is invisible. `block: 'nearest'` scrolls only when the span
      // is actually out of view, so it never fights a user who has scrolled.
      const active = spans[index];
      if (active && typeof active.scrollIntoView === 'function') {
        try {
          active.scrollIntoView({ block: 'nearest' });
        } catch {
          // A view that cannot scroll costs the cue, never the caption.
        }
      }
    },
    destroy: () => {
      root.remove();
    },
  };
}
