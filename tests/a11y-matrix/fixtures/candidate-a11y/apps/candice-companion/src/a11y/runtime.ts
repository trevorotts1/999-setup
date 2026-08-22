/**
 * Production accessibility runtime wiring (FIX-008).
 *
 * This module deliberately owns only presentation preferences that can be
 * honored without claiming a session, microphone, answer, or bridge flow.
 * It connects the existing OS reduced-motion controller to the actual
 * webview and supplies one validated text-scale CSS variable for every
 * mounted surface.
 */

import { createA11yController, type A11yController } from './controller.ts';
import type { ReducedMotionPreference } from './config.ts';

export const DEFAULT_TEXT_SCALE = 1;
export const MIN_TEXT_SCALE = 0.8;
export const MAX_TEXT_SCALE = 1.6;

export interface AccessibilityRuntimeOptions {
  /** Null means follow the OS. A future preference owner may re-apply it. */
  reducedMotion?: ReducedMotionPreference;
  /** UI-only multiplier; invalid values safely return to the default. */
  textScale?: number;
}

export interface AccessibilityRuntime {
  readonly controller: A11yController;
  readonly textScale: number;
  setReducedMotionPreference(preference: ReducedMotionPreference): void;
  setTextScale(scale: number): void;
  dispose(): void;
}

export function normalizeTextScale(scale: unknown): number {
  return typeof scale === 'number' && Number.isFinite(scale)
    ? Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, scale))
    : DEFAULT_TEXT_SCALE;
}

/** Mount real OS motion handling and the inherited text-scale token. */
export function initializeAccessibilityRuntime(
  root: HTMLElement,
  options: AccessibilityRuntimeOptions = {},
): AccessibilityRuntime {
  const controller = createA11yController({
    root: document.documentElement,
    // The webview currently has no approved preference IPC. Following the OS
    // is intentional and truthful until that owner exposes one.
    preference: options.reducedMotion ?? null,
  });
  let scale = normalizeTextScale(options.textScale);

  const applyScale = (next: number): void => {
    scale = normalizeTextScale(next);
    root.style.setProperty('--candice-text-scale', String(scale));
    root.dataset.candiceTextScale = String(scale);
  };

  root.dataset.candiceA11yRuntime = 'active';
  applyScale(scale);

  return {
    controller,
    get textScale() {
      return scale;
    },
    setReducedMotionPreference: (preference) => controller.applyPreference(preference),
    setTextScale: applyScale,
    dispose: () => {
      controller.detach();
      delete root.dataset.candiceA11yRuntime;
    },
  };
}
