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
 * FIX-014 (I-05/I-06): the label lives in a DEDICATED label element so the
 * glow/wave children survive every render; busy states set BOTH `disabled`
 * and `aria-disabled` and every start handler checks eligibility; the
 * pointer is captured on press so release events outside the button still
 * end the hold; release closes exactly once on pointerup, pointercancel,
 * lostpointercapture, pointerleave, keyup, blur, and teardown.
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
  --candice-ptt-text: var(--candice-text, #faf7ff);
  /* Referenced by the transcribing border below, and defined NOWHERE until
     now -- so that rule fell through to a hardcoded literal and was the one
     colour in this block not routed through the shared token. Milder than
     the --candice-ac-surface defect documented in answer-controls/view.ts
     (that one had no fallback, so the whole declaration went invalid at
     computed-value time); this one merely drifted. Same cause: a local alias
     referenced without being declared. */
  --candice-ptt-muted: var(--candice-muted, #d7cfdf);
  --candice-ptt-danger: #ff4b4b;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  /* Scales with the text-size preference, like the surface around it.
     Fixed at 14px, HOLD TO TALK stayed small at Large while the
     question grew -- the control a low-vision user most needs to hit. */
  font-size: calc(14px * var(--candice-text-scale, 1));
  line-height: 1.3;
  color: var(--candice-ptt-text);
  user-select: none;
  /* FIX-008: opaque backdrop for the cluster's own label text. */
  background: var(--candice-ui-surface, #171321);
  border-radius: 12px;
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
  /* FIX-008: HOLD TO TALK sits on a transparent window. Without an opaque
     fill it vanished into the desktop and read as disabled — a false
     affordance, since the model enables it whenever delegate mode is off.
     The disabled states below stay the only thing that dims this button. */
  background: var(--candice-ui-surface, #171321);
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
.candice-ptt-button:disabled {
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
  border-color: var(--candice-ptt-muted);
}
.candice-ptt-wave {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 20px;
}
/*
 * "display: flex" above beats the user-agent "[hidden] { display: none }"
 * rule, so "wave.hidden = true" did NOTHING and the bars rendered in EVERY
 * status — including "thinking" and "speaking", where the status table sets
 * "waveform: false". The operator saw them moving while nothing was playing.
 * Same guard the state caption and answer-confirm rows already carry.
 */
.candice-ptt-wave[hidden] {
  display: none;
}
/*
 * Bar height is DATA, not decoration.
 *
 * These bars previously ran an unconditional 420ms keyframe loop, so they
 * animated whenever they were on screen regardless of whether any audio
 * existed. That is an indicator asserting something that is not happening —
 * the exact failure this project exists to eliminate.
 *
 * The height is now a pure function of a MEASURED input level. No level
 * source attached means "--candice-ptt-level" stays 0 and the bars sit flat:
 * a static affordance that claims nothing. When the capture lane feeds real
 * levels through "setInputLevel", they move because the microphone moved.
 */
.candice-ptt-wave-bar {
  width: 4px;
  height: calc(4px + (16px * var(--candice-ptt-level, 0)));
  border-radius: 2px;
  background: var(--candice-ptt-danger);
  transition: height 90ms linear;
}
html.${PTT_REDUCED_MOTION_CLASS} .candice-ptt-wave-bar {
  transition: none;
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
  /**
   * Feed a MEASURED input level (0..1) from the capture lane.
   *
   * This is the only thing that may move the waveform bars. Never call it
   * with a synthesised, timer-derived or assumed value: an indicator that
   * moves without a real signal behind it is a lie about the microphone.
   * Values outside 0..1 are clamped; NaN is ignored.
   */
  setInputLevel(level: number): void;
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
    setInputLevel() {},
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
 * FIX-014 additions:
 *  - pointer capture on press + a document-level `pointerup` fallback, so a
 *    release anywhere still ends the hold exactly once;
 *  - `lostpointercapture` ends the hold;
 *  - every start path checks eligibility (busy states disable the button
 *    with BOTH `disabled` and `aria-disabled`, I-06);
 *  - `destroy()` releases an active hold before removing the root.
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
  // No aria-label here, deliberately. It was set ONCE and never updated,
  // and aria-label overrides element content -- so `setStatus` changed the
  // visible label to "LISTENING - LET GO WHEN FINISHED" while a screen
  // reader went on saying "HOLD TO TALK". The single most safety-relevant
  // state this app has, an OPEN MICROPHONE, was inaudible to the users who
  // most need to be told about it. The label span below is real text,
  // re-rendered on every status change, and the glow and wave spans are
  // aria-hidden, so the button names itself correctly and stays correct.

  // Dedicated label element (I-05): renders NEVER replace it, so the glow
  // and wave children survive every status render.
  const label = document.createElement('span');
  label.className = 'candice-ptt-label';
  label.textContent = '🎙 HOLD TO TALK';

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

  button.append(glow, label);
  root.append(button, wave);
  mount.append(root);

  let destroyed = false;
  let pressed = false;
  let keyHeld = false;
  let eligible = true; // busy statuses disable the control (I-06)
  let activePointerId: number | null = null;

  const start = (): void => {
    if (!eligible || pressed) return; // eligibility guard + single-flight
    pressed = true;
    handlers.onTalkStart();
  };
  const stop = (): void => {
    if (!pressed && !keyHeld) return;
    pressed = false;
    keyHeld = false;
    handlers.onTalkStop();
  };

  const doc = root.ownerDocument ?? (typeof document !== 'undefined' ? document : null);

  // Document-level release fallback (I-06): if the pointer is captured by
  // the button, pointerup on the button fires; if capture was lost or never
  // granted, this document-level listener still ends the hold — and `stop`
  // is idempotent so the mic closes exactly once.
  const onDocPointerUp = (e: Event): void => {
    const p = e as PointerEvent;
    if (activePointerId !== null && p.pointerId === activePointerId) {
      activePointerId = null;
      stop();
    }
  };
  if (doc !== null) {
    doc.addEventListener('pointerup', onDocPointerUp);
    doc.addEventListener('pointercancel', onDocPointerUp);
  }

  button.addEventListener('pointerdown', (e) => {
    const ev = e as PointerEvent;
    if (ev.button !== 0) return;
    if (!eligible) return; // guard: disabled control never starts capture
    ev.preventDefault();
    try {
      button.setPointerCapture?.(ev.pointerId);
      activePointerId = ev.pointerId;
    } catch {
      // Capture unsupported (older WebView/fake DOM): the document-level
      // release fallback still ends the hold.
    }
    start();
  });
  button.addEventListener('pointerup', (e) => {
    const ev = e as PointerEvent;
    if (activePointerId !== null && ev.pointerId === activePointerId) activePointerId = null;
    stop();
  });
  button.addEventListener('pointercancel', (e) => {
    const ev = e as PointerEvent;
    if (activePointerId !== null && ev.pointerId === activePointerId) activePointerId = null;
    stop();
  });
  button.addEventListener('lostpointercapture', (e) => {
    const ev = e as PointerEvent;
    if (activePointerId !== null && ev.pointerId === activePointerId) activePointerId = null;
    // Capture lost mid-hold (e.g. touch scroll takes over): release.
    stop();
  });
  button.addEventListener('pointerleave', () => {
    // Release always ends the hold even if the pointer left the button —
    // the mic is live only while HOLD TO TALK is pressed (E.1 WS-17).
    if (pressed) stop();
  });
  button.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    if (ev.repeat) return;
    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      if (!eligible || keyHeld) return; // guard (I-06)
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
      // BOTH disabled and aria-disabled (I-06); handlers re-check `eligible`
      // so no path can start capture while busy.
      eligible = false;
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    } else {
      eligible = true;
      button.disabled = false;
      button.setAttribute('aria-disabled', 'false');
      // The dedicated label element updates; glow/wave children survive (I-05).
      label.textContent = view.label;
    }
    root.setAttribute('data-candice-ptt-state', view.family);
    root.setAttribute('data-candice-ptt-interruptible', String(view.interruptible));
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
    setInputLevel(level: number): void {
      if (destroyed) return;
      if (typeof level !== 'number' || Number.isNaN(level)) return;
      const clamped = Math.min(1, Math.max(0, level));
      root.style.setProperty('--candice-ptt-level', String(clamped));
    },
    destroy(): void {
      if (destroyed) return;
      // Release any live hold before removing the root (I-06: teardown is
      // one of the mandated release paths; stop is idempotent).
      stop();
      destroyed = true;
      if (doc !== null) {
        doc.removeEventListener('pointerup', onDocPointerUp);
        doc.removeEventListener('pointercancel', onDocPointerUp);
      }
      root.remove();
    },
  };
}
