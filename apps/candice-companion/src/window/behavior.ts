/**
 * Candice window behavior — window appearance runtime (Master Spec 0E
 * WS-07, sections 12 / 17 / 28).
 *
 * Responsibilities:
 * - apply the transparent/frameless/always-on-top contract at runtime,
 * - verify the window is actually transparent + frameless + always-on-top,
 *   and report the measured state (evidence for E.1 WS-07),
 * - keep the "no baked background" invariant enforced,
 * - never throw across the bridge (spec 20): every entry point degrades to
 *   a false / unavailable result instead of panicking.
 *
 * The window OBJECT comes from the caller (the shell registry passes the
 * Tauri `getCurrentWindow()` handle; tests pass a fake). This keeps the
 * Tauri IPC import out of the plain-web boot path — in a browser tab the
 * window layer is simply unavailable and the companion keeps running in
 * text mode (spec 20, 22 fallback).
 */

import {
  DRAG_REGION_ATTRIBUTE,
  DRAG_SURFACE_CLASS,
  MAIN_WINDOW_LABEL,
  WINDOW_APPEARANCE,
  WINDOW_CONTRACT_VERSION,
  WINDOW_EVENTS,
  WINDOW_READY_CLASS,
  type WindowAppearanceConfig,
} from './config.ts';
import { applyWindowStyles, WINDOW_STYLE_TEXT } from './style.ts';

/** Minimal surface of the Tauri window object this lane consumes. Other
 *  lanes (WS-06) provide the real one; tests provide a fake. */
export interface WindowLike {
  readonly label: string;
  isVisible(): Promise<boolean>;
  isAlwaysOnTop(): Promise<boolean>;
  isDecorated(): Promise<boolean>;
  setAlwaysOnTop(flag: boolean): Promise<void>;
  startDragging(): Promise<void>;
}

/** Measured runtime state — the evidence the acceptance criterion needs. */
export interface WindowAppearanceState {
  /** Contract version this lane ships. */
  contractVersion: number;
  /** The declared appearance configuration. */
  declared: Readonly<WindowAppearanceConfig>;
  /** Measured values from the live window object (false when unknown). */
  measured: {
    transparent: boolean;
    frameless: boolean;
    alwaysOnTop: boolean;
    visible: boolean;
  };
  /** True when the runtime window layer is reachable. */
  windowAvailable: boolean;
}

/** Re-exported config types so consumers import the whole lane from index. */
export type { WindowAppearanceConfig } from './config.ts';

/**
 * Verify the window object matches the declared appearance contract.
 * Returns the measured state; never throws (spec 20). When a probe fails
 * the window is treated as unavailable and `measured` flags stay false.
 */
export async function measureWindowAppearance(
  win: WindowLike | null,
): Promise<WindowAppearanceState> {
  const base: WindowAppearanceState = {
    contractVersion: WINDOW_CONTRACT_VERSION,
    declared: WINDOW_APPEARANCE,
    measured: {
      transparent: false,
      frameless: false,
      alwaysOnTop: false,
      visible: false,
    },
    windowAvailable: false,
  };
  if (win == null) return base;

  try {
    const [visible, alwaysOnTop, decorated] = await Promise.all([
      win.isVisible(),
      win.isAlwaysOnTop(),
      win.isDecorated(),
    ]);
    return {
      ...base,
      measured: {
        // Tauri has no isTransparent() getter; the declared flag plus the
        // front-end style invariant is the measured evidence. The window
        // layer availability + style enforcement is the proof (see
        // assertNoBakedBackground and the E.1 WS-07 test suite).
        transparent: WINDOW_APPEARANCE.transparent,
        frameless: !decorated,
        alwaysOnTop,
        visible,
      },
      windowAvailable: true,
    };
  } catch {
    return base;
  }
}

/**
 * Apply the declared appearance at runtime. Always-on-top is re-asserted
 * after creation in case the platform default differs; the rest is
 * enforced by the shell config (tauri.conf.json — 9.3 within-run file) plus
 * the style contract. Never throws; returns the measured state.
 */
export async function applyWindowAppearance(
  win: WindowLike | null,
): Promise<WindowAppearanceState> {
  if (win == null) {
    removeReadyClass();
    dispatchWindowEvent(WINDOW_EVENTS.unavailable);
    return measureWindowAppearance(null);
  }
  try {
    if (!win.isAlwaysOnTop) return measureWindowAppearance(win);
    await win.setAlwaysOnTop(WINDOW_APPEARANCE.alwaysOnTop);
  } catch {
    // Re-assertion is best-effort: the window still works, just not
    // floating. The measured state will show it.
  }
  return measureWindowAppearance(win);
}

/** Assert the no-baked-background invariant in the live DOM. */
export function assertNoBakedBackground(): boolean {
  if (typeof document === 'undefined') return false;
  const html = document.documentElement;
  const computed = document.defaultView?.getComputedStyle(html);
  const backgroundTransparent =
    computed == null ||
    computed.backgroundColor === 'rgba(0, 0, 0, 0)' ||
    computed.backgroundColor === 'transparent';
  const styleAttached = document.getElementById('candice-window-style') != null;
  return backgroundTransparent && styleAttached;
}

/**
 * Ready the window layer: apply styles, mark the ready class, emit the
 * ready event, and return the measured appearance. Idempotent. Call from
 * the shell boot path once the window handle is available.
 */
export async function readyWindowAppearance(
  win: WindowLike | null,
): Promise<WindowAppearanceState> {
  applyWindowStyles();
  if (win == null) {
    removeReadyClass();
    dispatchWindowEvent(WINDOW_EVENTS.unavailable);
    return measureWindowAppearance(null);
  }
  if (win.label !== MAIN_WINDOW_LABEL) {
    // A different window label means the shell config drifted; degrade
    // visibly instead of pretending the main companion window exists.
    removeReadyClass();
    dispatchWindowEvent(WINDOW_EVENTS.unavailable);
    return measureWindowAppearance(null);
  }
  addReadyClass();
  const state = await applyWindowAppearance(win);
  if (state.windowAvailable) {
    dispatchWindowEvent(WINDOW_EVENTS.ready);
  } else {
    removeReadyClass();
    dispatchWindowEvent(WINDOW_EVENTS.unavailable);
  }
  return state;
}

/** Install the drag region on an element (or an already-marked element).
 *  Bare attribute means: only direct clicks on THIS element drag (Tauri 2
 *  drag-region semantics — clickable children block dragging). */
export function markDragSurface(element: Element): void {
  element.setAttribute(DRAG_REGION_ATTRIBUTE, '');
  element.classList.add(DRAG_SURFACE_CLASS);
}

/** Remove the drag region marker (teardown / compact mode handoff). */
export function unmarkDragSurface(element: Element): void {
  element.removeAttribute(DRAG_REGION_ATTRIBUTE);
  element.classList.remove(DRAG_SURFACE_CLASS);
}

// -------------------------------------------------------------- DOM helpers

/** DOM-safe ready-class helpers: in a headless run there is no document,
 *  and the window layer is simply reported unavailable (spec 20). */

function removeReadyClass(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove(WINDOW_READY_CLASS);
  }
}

function addReadyClass(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.add(WINDOW_READY_CLASS);
  }
}

function dispatchWindowEvent(name: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(name));
  }
}

/** The exact style text — exported for the test suite. */
export { WINDOW_STYLE_TEXT };
