/**
 * Push-to-talk control DOM surface (Master Spec 0E WS-09, spec 5.1 / 6).
 *
 * The floating PTT control is the press-and-hold answer surface. It owns:
 *  - the exact spec-6 labels (🎙 HOLD TO TALK / 🔴 LISTENING — LET GO WHEN
 *    FINISHED / Here is what I heard…),
 *  - the unmistakable listening state: red glow pulse + explicit label +
 *    optional lightweight waveform (spec 6 — never a tiny icon-only state),
 *  - the hold semantics (pointerdown/pointerup/leave map to start/stop —
 *    the same press pair the WS-08 PTT events use).
 *
 * This lane never:
 *  - resolves session/window identity (WS-03's),
 *  - owns the state machine or transcript-confirmation logic
 *    (WS-08 reducer, WS-18 transcript lane),
 *  - runs continuous animation except the single listening glow pulse,
 *    dropped under reduced motion (spec 19; class consumed from WS-14),
 *  - decides the interview outcome or question order (spec 2).
 *
 * The capture HANDLER is the caller's (the shell wiring hands PTT
 * start/stop to the WS-17 capture path); this module only reports intent
 * and renders the machine's real status.
 *
 * @module
 */

import {
  PTT_GLOW_PULSE_MS,
  PTT_LISTENING_CLASS,
  PTT_REDUCED_MOTION_CLASS,
  PTT_ROOT_CLASS,
  PTT_STYLE_ID,
  PTT_TRANSCRIBING_CLASS,
  PTT_WAVE_BAR_CLASS,
  PTT_WAVE_BAR_COUNT,
  PTT_WAVE_CLASS,
} from './config.ts';
import { pttStatusView, type PttStatusView } from './status.ts';

/**
 * Style contract. Variable references ONLY plus the one listening glow
 * pulse. Root paints no background (WS-07 transparent window; spec 11
 * transparency contract — the WS-07 invariant forbids baked backgrounds).
 */
export const PTT_STYLE_TEXT = `
.candice-ptt {
  --candice-ptt-accent: var(--candice-accent, #7c5cff);
  --candice-ptt-text: var(--candice-text, #eceaf3);
  --candice-ptt-danger: #ff4b4b;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.3;
  color: var(--candice-ptt-text);
  user-select: none;
}
.candice-ptt-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 220px;
  padding: 14px 22px;
  border: 2px solid var(--candice-ptt-accent);
  border-radius: 999px;
  background: transparent;
  color: var(--candice-ptt-text);
  font: inherit;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  touch-action: none;
}
.candice-ptt-button:focus-visible {
  outline: 2px solid var(--candice-ptt-accent);
  outline-offset: 2px;
}
.candice-ptt-button[aria-disabled='true'] {
  opacity: 0.45;
  cursor: default;
}
.candice-ptt-glow {
  position: absolute;
  inset: -6px;
  border-radius: 999px;
  pointer-events: none;
  opacity: 0;
}
.candice-ptt.candice-ptt-listening .candice-ptt-glow {
  opacity: 1;
  border: 3px solid var(--candice-ptt-danger);
  box-shadow:
    0 0 18px 4px var(--candice-ptt-danger),
    0 0 46px 14px color-mix(in srgb, var(--candice-ptt-danger) 40%, transparent);
  animation: candice-ptt-glow-pulse ${PTT_GLOW_PULSE_MS}ms ease-in-out infinite alternate;
}
html.${PTT_REDUCED_MOTION_CLASS} .candice-ptt.candice-ptt-listening .candice-ptt-glow {
  animation: none;
}
@keyframes candice-ptt-glow-pulse {
  from {
    box-shadow:
      0 0 14px 3px var(--candice-ptt-danger),
      0 0 34px 10px color-mix(in srgb, var(--candice-ptt-danger) 35%, transparent);
  }
  to {
    box-shadow:
      0 0 22px 6px var(--candice-ptt-danger),
      0 0 58px 20px color-mix(in srgb, var(--candice-ptt-danger) 45%, transparent);
  }
}
.candice-ptt.candice-ptt-transcribing .candice-ptt-button {
  border-color: var(--candice-ptt-muted, #a8a3b8);
}
.candice-ptt-wave {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 20px;
}
.candice-ptt-wave-bar {
  width: 4px;
  height: 8px;
  border-radius: 2px;
  background: var(--candice-ptt-danger);
  animation: candice-ptt-wave-pop 420ms ease-in-out infinite alternate;
}
.candice-ptt-wave-bar:nth-child(2n) {
  animation-delay: 120ms;
}
.candice-ptt-wave-bar:nth-child(3n) {
  animation-delay: 240ms;
}
html.${PTT_REDUCED_MOTION_CLASS} .candice-ptt-wave-bar {
  animation: none;
}
@keyframes candice-ptt-wave-pop {
  from { height: 8px; opacity: 0.7; }
  to { height: 20px; opacity: 1; }
}
`;

// -------------------------------------------------- module-level state

/** Set once by the first DOM-capable creation. */
let styleMounted = false;

/** Mount the PTT style sheet once (idempotent, headless-safe). */
export function mountPttStyle(): void {
  if (typeof document === 'undefined') return;
  if (styleMounted) return;
  if (document.getElementById(PTT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PTT_STYLE_ID;
  style.textContent = PTT_STYLE_TEXT;
  (document.head ?? document.documentElement).append(style);
  styleMounted = true;
}

export interface PttView {
  /** Root element (null when mount was null — no-op view, spec 20). */
  readonly el: HTMLElement | null;
  /** Apply a real status presentation (pure render of machine state). */
  setStatus(view: PttStatusView): void;
  /** Overload: apply by WS-08 status name (derives the view). */
  show(status: import('../../state/status.ts').CandiceStatus): void;
  /** True when the control currently shows the live-mic listening state. */
  isListening(): boolean;
  /** Idempotent teardown; never throws. */
  destroy(): void;
}

/** Empty no-op view — DOM absence must never throw (spec 20). */
function nullView(): PttView {
  return {
    el: null,
    setStatus() {},
    show() {},
    isListening: () => false,
    destroy() {},
  };
}

/**
 * Create the PTT control. Takes an explicit mount element (the shell or
 * the tests hand it in; this lane never owns document.querySelector).
 *
 * Hold semantics: `pointerdown` fires start; `pointerup`/`pointercancel`/
 * `pointerleave` (while pressed) fire stop. Only one live press at a time
 * (single-flight, mirroring the WS-08 `ptt:start` guard). Keyboard: the
 * button also maps Space/Enter hold (repeat filtered).
 *
 * `onTalkStart`/`onTalkStop` are the intent hooks — the caller routes them
 * to the WS-17 capture path. This module never records audio.
 */
export function createPttView(
  mount: HTMLElement | null,
  handlers: { onTalkStart(): void; onTalkStop(): void },
): PttView {
  if (mount === null) return nullView();
  if (typeof document === 'undefined') return nullView();
  mountPttStyle();
  mount.innerHTML = '';

  const root = document.createElement('div');
  root.className = PTT_ROOT_CLASS;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${PTT_ROOT_CLASS}-button`;
  button.textContent = '🎙 HOLD TO TALK';

  const glow = document.createElement('span');
  glow.className = 'candice-ptt-glow';
  glow.setAttribute('aria-hidden', 'true');

  const wave = document.createElement('div');
  wave.className = PTT_WAVE_CLASS;
  wave.setAttribute('aria-hidden', 'true');
  wave.hidden = true;
  for (let i = 0; i < PTT_WAVE_BAR_COUNT; i += 1) {
    const bar = document.createElement('span');
    bar.className = PTT_WAVE_BAR_CLASS;
    wave.append(bar);
  }

  button.append(glow);
  root.append(button, wave);
  mount.append(root);

  let destroyed = false;
  let pressed = false;
  let keyHeld = false;

  const start = (): void => {
    if (pressed) return; // single-flight
    pressed = true;
    handlers.onTalkStart();
  };
  const stop = (): void => {
    if (!pressed && !keyHeld) return;
    pressed = false;
    keyHeld = false;
    handlers.onTalkStop();
  };

  button.addEventListener('pointerdown', (e) => {
    if ((e as PointerEvent).button !== 0) return;
    e.preventDefault();
    start();
  });
  button.addEventListener('pointerup', () => stop());
  button.addEventListener('pointercancel', () => stop());
  button.addEventListener('pointerleave', () => {
    // Release always ends the hold even if the pointer left the button —
    // the mic is live only while HOLD TO TALK is pressed (E.1 WS-17).
    if (pressed) stop();
  });
  button.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).repeat) return;
    if ((e as KeyboardEvent).key === ' ' || (e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      if (keyHeld) return;
      keyHeld = true;
      pressed = true;
      handlers.onTalkStart();
    }
  });
  button.addEventListener('keyup', (e) => {
    if ((e as KeyboardEvent).key === ' ' || (e as KeyboardEvent).key === 'Enter') stop();
  });
  button.addEventListener('blur', () => stop());

  const setStatus = (view: PttStatusView): void => {
    if (destroyed) return;
    root.classList.toggle(PTT_LISTENING_CLASS, view.family === 'listening');
    root.classList.toggle(PTT_TRANSCRIBING_CLASS, view.family === 'transcribing');
    if (view.label === null) {
      // Busy states hide the prompt: the button stays (keyboard users can
      // still find it) but is disabled — never icon-only, never removed.
      button.setAttribute('aria-disabled', 'true');
    } else {
      button.setAttribute('aria-disabled', 'false');
      button.textContent = view.label;
    }
    root.setAttribute('data-candice-ptt-state', view.family);
    wave.hidden = !view.waveform;
  };

  return {
    el: root,
    setStatus,
    show(status) {
      setStatus(pttStatusView(status));
    },
    isListening(): boolean {
      return root.classList.contains(PTT_LISTENING_CLASS);
    },
    destroy(): void {
      destroyed = true;
      root.remove();
    },
  };
}
