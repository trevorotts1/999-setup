/**
 * Glow surface (WS-13, spec 10 speaking/listening/processing glow).
 *
 * The glow is a transparent aura layer rendered with opacity only — no
 * background painting, so the character stays edge-clean on light AND dark
 * desktops (E.1). This module owns the layer element and its attribute
 * contract; the driver owns the pulsing values.
 *
 * @module
 */

import { GLOW_STAGE_ATTR } from './config.ts';

/** Create the glow surface element (caller mounts it). */
export function createGlowSurface(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute(GLOW_STAGE_ATTR, '');
  el.setAttribute('aria-hidden', 'true'); // decorative, never announced
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.pointerEvents = 'none';
  el.style.opacity = '0';
  return el;
}

/** Find the glow surface in a root; null when not mounted. */
export function findGlowSurface(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  return root.querySelector<HTMLElement>(`[${GLOW_STAGE_ATTR}]`);
}
