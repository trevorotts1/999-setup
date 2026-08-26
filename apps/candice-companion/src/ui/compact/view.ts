/**
 * Compact companion DOM surface (Master Spec 0E WS-10, spec 16 / 19).
 *
 * The compact view is a single-root surface the WS-06 shell mounts after
 * the interview. It owns:
 *  - one reserved stage slot for the character image (WR-013 binds the
 *    final asset in; this lane never loads or names artwork),
 *  - the one-line status/phase text (only real status text, never a
 *    percent),
 *  - the small interaction surface (expanded on click): hold-to-talk,
 *    typed input, slash-command send, return-to-Claude, mute toggle,
 *  - the offline hint shown when Claude is busy (spec 13.3).
 *
 * Never:
 *  - paints a rectangular background behind the character (spec 11) —
 *    all colors are CSS-variable references, and the root trusts the
 *    WS-07 transparent window,
 *  - runs continuous animation (spec 19): the only transition is a
 *    one-shot expand, dropped under reduced motion,
 *  - resolves a session/window identity — decoration only; identity
 *    belongs to WS-03/session lifecycle.
 *
 * The document is INJECTED (mirror of the WS-07 lane injecting the Tauri
 * window): the shell passes the real document in the browser; tests pass
 * a fake cast to Document. Without a document or mount the view degrades
 * to a no-op view (spec 20: failure never stops Claude).
 *
 * NOTE for linting: `mount.innerHTML = ''` clears only placeholder /
 * previously-created surfaces on an element this lane created or was
 * handed for mounting; the compact lane never inserts untrusted text via
 * innerHTML (all user text goes through textContent).
 *
 * @module
 */

import {
  COMPACT_EXPAND_MS,
  COMPACT_EXPANDED_CLASS,
  COMPACT_INPUT_LABEL,
  COMPACT_REDUCED_MOTION_CLASS,
  COMPACT_ROOT_CLASS,
  COMPACT_STAGE_SLOT_ID,
  COMPACT_STATUS_ATTR,
} from './config.ts';
import type { CompactStatusView } from './status.ts';

/**
 * Surface style contract. Variable references ONLY: these resolve against
 * values the shell/WS-06 defines for the theme; the WS-07 transparent
 * window line is enforced by WS-07's own style tag. One-shot transition,
 * no loop, no opaque background on the root (spec 11: never a rectangular
 * UI background behind the character). The only `background` declaration
 * is the explicit transparent reset.
 */
export const COMPACT_STYLE_TEXT = `
.candice-compact {
  --candice-compact-text: var(--candice-text);
  --candice-compact-muted: var(--candice-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-height: 0;
  position: relative;
  padding: 12px 16px;
  /* Scales with the text-size preference, like every other surface. */
  font-size: calc(13px * var(--candice-text-scale, 1));
  line-height: 1.35;
  color: var(--candice-compact-text);
}
#${COMPACT_STAGE_SLOT_ID} {
  width: 96px;
  height: 96px;
  flex: none;
}
.candice-compact-status {
  max-width: 280px;
  text-align: center;
  color: var(--candice-compact-muted);
  /* FIX-008: this lane predates it. The window is transparent and always
     on top, so text with no backdrop renders straight onto the user's
     desktop -- the operator reported reading terminal scrollback through
     a governed question. Token-based scrim, exactly as the captions,
     answer-controls, PTT and animation-toggle lanes already do. */
  background: var(--candice-ui-surface);
  border-radius: 8px;
  padding: 4px 10px;
}
/* The "display" in the rule below beats the user-agent [hidden] rule, so
   setting .hidden = true alone cannot hide this element. */
.candice-compact-hint[hidden] {
  display: none;
}
.candice-compact-hint {
  max-width: 280px;
  text-align: center;
  color: var(--candice-compact-muted);
  background: var(--candice-ui-surface);
  border-radius: 8px;
  padding: 4px 10px;
}
.candice-compact-surface {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  transition: opacity ${COMPACT_EXPAND_MS}ms ease;
}
.candice-compact:not(.${COMPACT_EXPANDED_CLASS}) .candice-compact-surface {
  opacity: 0;
  pointer-events: none;
}
html.${COMPACT_REDUCED_MOTION_CLASS} .candice-compact-surface {
  transition: none;
}
.candice-compact-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.candice-compact-btn {
  border: 0;
  background: var(--candice-ui-surface);
  color: var(--candice-compact-muted);
  font: inherit;
  /* 44px targets. Outside a published rectangle this window is
     pointer-transparent, so an undersized control is not just fiddly --
     a near miss clicks the desktop behind her. */
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  padding: 4px 10px;
  cursor: pointer;
}
.candice-compact-btn:hover {
  color: var(--candice-compact-text);
  text-decoration: underline;
}
.candice-compact-input {
  width: 220px;
  max-width: 100%;
  border: 1px solid var(--candice-compact-muted);
  border-radius: 8px;
  background: var(--candice-ui-surface);
  color: inherit;
  font: inherit;
  min-height: 44px;
  padding: 6px 10px;
}
.candice-compact-input::placeholder {
  color: var(--candice-compact-muted);
}
`;

/** Mount the style sheet once (idempotent, headless-safe). */
export function mountCompactStyle(doc: Document | null = null): void {
  const d = resolveDoc(doc);
  if (d === null) return;
  if (d.getElementById('candice-compact-style') !== null) return;
  const style = d.createElement('style');
  style.id = 'candice-compact-style';
  style.textContent = COMPACT_STYLE_TEXT;
  (d.head ?? d.documentElement).append(style);
}

export interface CompactViewHandlers {
  /** User pressed (true) or released (false) the hold-to-talk button. */
  onTalkToggle(held: boolean): void;
  /** User submitted typed text or a slash command. */
  onSubmit(text: string): void;
  /** User clicked the expand affordance. */
  onExpandToggle(): void;
  /** User chose "mute/unmute voice responses". */
  onMuteToggle(): void;
  /** User chose to return focus to the Claude terminal (spec 13.3). */
  onReturnToClaude(): void;
}

export interface CompactView {
  /** Root element. */
  readonly el: HTMLElement;
  /** True when the interaction surface is expanded. */
  isExpanded(): boolean;
  /** Expand or collapse the interaction surface (one-shot, no loop). */
  setExpanded(expanded: boolean): void;
  /** Apply a real status view. */
  setStatus(view: CompactStatusView): void;
  /** Show/hide the offline hint (spec 13.3). */
  setBusyHint(visible: boolean, text: string): void;
  /** Render pending submissions (never hidden from the user). */
  setPending(pending: readonly { text: string; inputMode: 'typed' | 'voice' }[]): void;
  /** Detach + tear down. */
  destroy(): void;
}

/**
 * Create the compact view. Takes an explicit mount element and an explicit
 * document (the shell or tests hand them in; this lane never squires the
 * global). Never throws: a missing mount or document returns a no-op view
 * (spec 20).
 */
export function createCompactView(
  mount: HTMLElement | null,
  handlers: CompactViewHandlers,
  doc: Document | null = null,
): CompactView {
  const d = resolveDoc(doc);
  if (mount === null || d === null) {
    return NULL_VIEW();
  }
  mountCompactStyle(d);
  mount.replaceChildren();

  const root = d.createElement('div');
  root.className = COMPACT_ROOT_CLASS;

  const slot = d.createElement('div');
  slot.id = COMPACT_STAGE_SLOT_ID;

  const statusEl = d.createElement('div');
  statusEl.className = 'candice-compact-status';

  const hintEl = d.createElement('div');
  hintEl.className = 'candice-compact-hint';
  hintEl.hidden = true;

  const surface = d.createElement('div');
  surface.className = 'candice-compact-surface';

  const actions = d.createElement('div');
  actions.className = 'candice-compact-actions';

  const talk = d.createElement('button');
  talk.type = 'button';
  talk.className = 'candice-compact-btn';
  talk.textContent = 'Hold to talk';
  // Press/release discipline, matching the hardened PTT lane.
  //
  // What was here: pointerdown / pointerup / pointerleave and nothing else.
  // Three gaps, and the microphone is the worst place in the app to have
  // them:
  //   - `pointercancel` was unhandled. The OS cancels a pointer for its own
  //     reasons mid-hold, and the controller's `talkHeld` then stayed true
  //     with no release ever coming -- an open microphone stuck open.
  //   - release OUTSIDE the button never reached it. Only `pointerleave`
  //     saved it, and only if the pointer crossed the edge first.
  //   - there was no keyboard path AT ALL. Space and Enter on a <button>
  //     fire `click`, never `pointerdown`, so a keyboard-only user could
  //     not speak.
  let talkHeld = false;
  const beginTalk = (): void => {
    if (talkHeld) return;
    talkHeld = true;
    talk.setAttribute('aria-pressed', 'true');
    handlers.onTalkToggle(true);
  };
  const endTalk = (): void => {
    if (!talkHeld) return;
    talkHeld = false;
    talk.setAttribute('aria-pressed', 'false');
    handlers.onTalkToggle(false);
  };
  talk.setAttribute('aria-pressed', 'false');
  talk.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // Capture routes the release back here even if the pointer has moved
    // off the button by then.
    try { talk.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    beginTalk();
  });
  talk.addEventListener('pointerup', endTalk);
  talk.addEventListener('pointercancel', endTalk);
  talk.addEventListener('lostpointercapture', endTalk);
  talk.addEventListener('pointerleave', endTalk);
  talk.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (e.repeat) return;
    e.preventDefault(); // or Space also scrolls and Enter also clicks
    beginTalk();
  });
  talk.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    endTalk();
  });
  // Focus lost mid-hold must not leave the mic open.
  talk.addEventListener('blur', endTalk);

  const input = d.createElement('input');
  input.type = 'text';
  input.className = 'candice-compact-input';
  // Slash commands are how the OPERATOR drives Claude Code; a client typing
  // to Candice has no idea what /bro or /eli5 are, and a placeholder is not
  // the place to teach them.
  input.placeholder = 'Type a message…';
  // A STABLE accessible name, independent of the visible placeholder. The
  // packaged suite locates this field by its accessibility label, and with no
  // aria-label that label was the placeholder text — so a copy edit silently
  // broke a ship gate. Test locators must not be user-visible prose.
  input.setAttribute('aria-label', COMPACT_INPUT_LABEL);
  input.addEventListener('keydown', (e) => {
    // An IME commits its composition with Enter. See answer-controls/view.ts.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text !== '') {
        handlers.onSubmit(text);
        input.value = '';
      }
    }
  });

  const send = d.createElement('button');
  send.type = 'button';
  send.className = 'candice-compact-btn';
  send.textContent = 'Send';
  send.addEventListener('click', () => {
    const text = input.value.trim();
    if (text !== '') {
      handlers.onSubmit(text);
      input.value = '';
    }
  });

  const mute = d.createElement('button');
  mute.type = 'button';
  mute.className = 'candice-compact-btn';
  // The state used to be recovered by comparing the button's own visible
  // label against the word Unmute, so any copy edit silently inverted the
  // control, and assistive tech was told nothing at all. Real state now,
  // plus aria-pressed so a screen reader can read it.
  let muted = true;
  const renderMute = (): void => {
    mute.textContent = muted ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(muted));
  };
  renderMute();
  mute.addEventListener('click', () => {
    muted = !muted;
    renderMute();
    handlers.onMuteToggle();
  });

  const pendingEl = d.createElement('div');
  pendingEl.className = 'candice-compact-pending';
  pendingEl.setAttribute('role', 'list');

  const toClaude = d.createElement('button');
  toClaude.type = 'button';
  toClaude.className = 'candice-compact-btn';
  toClaude.textContent = 'Return to Claude';
  toClaude.addEventListener('click', () => handlers.onReturnToClaude());

  // Expansion was ONLY a click handler on the root div: not focusable, no
  // role, no keyboard path -- so a keyboard or screen-reader user could
  // never open the interaction surface at all. The root click stays,
  // because spec 16 says clicking compact Candice expands her; this adds
  // a real control beside it for everyone who is not using a mouse.
  const expand = d.createElement('button');
  expand.type = 'button';
  expand.className = 'candice-compact-btn';
  expand.textContent = 'Open';
  expand.setAttribute('aria-expanded', 'false');
  expand.addEventListener('click', () => handlers.onExpandToggle());

  actions.append(talk, input, send, mute);
  surface.append(actions, pendingEl, toClaude);
  root.append(slot, statusEl, expand, hintEl, surface);
  mount.append(root);

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target == null) return;
    // Buttons and the input block expansion; the character slot, the
    // status line, and the root gap toggle it (spec 16: "Clicking compact
    // Candice expands the small interaction surface").
    if (target.closest('button, input, .candice-compact-surface') !== null) return;
    if (!root.contains(target)) return;
    handlers.onExpandToggle();
  });

  return {
    el: root,
    isExpanded: () => root.classList.contains(COMPACT_EXPANDED_CLASS),
    setExpanded: (expanded: boolean) => {
      root.classList.toggle(COMPACT_EXPANDED_CLASS, expanded);
      expand.setAttribute('aria-expanded', String(expanded));
      expand.textContent = expanded ? 'Close' : 'Open';
    },
    setStatus: (view: CompactStatusView) => {
      root.setAttribute(COMPACT_STATUS_ATTR, view.family);
      statusEl.textContent = view.label;
    },
    setBusyHint: (visible: boolean, text: string) => {
      hintEl.hidden = !visible;
      if (visible) hintEl.textContent = text;
    },
    setPending: (pending) => {
      pendingEl.replaceChildren(
        ...pending.map((p) => {
          const li = d.createElement('div');
          li.setAttribute('role', 'listitem');
          li.textContent = `${p.inputMode}: ${p.text}`;
          return li;
        }),
      );
    },
    destroy: () => {
      root.remove();
    },
  };
}

/** Resolve the document: explicit injection, else the real one, else null. */
function resolveDoc(doc: Document | null): Document | null {
  if (doc !== null) return doc;
  try {
    if (typeof document !== 'undefined') return document;
  } catch {
    // Not a browser runtime; fall through to the no-op view.
  }
  return null;
}

/** No-op view for headless / absent-DOM runtimes. */
function NULL_VIEW(): CompactView {
  const noop = (): void => undefined;
  return {
    el: null as unknown as HTMLElement,
    isExpanded: () => false,
    setExpanded: noop,
    setStatus: noop,
    setBusyHint: noop,
    setPending: noop,
    destroy: noop,
  };
}
