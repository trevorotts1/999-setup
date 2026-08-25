/**
 * Visible-pixel measurement for the FIX-008 partial input policy.
 *
 * The native hit test (`src-tauri/src/hit_test.rs`) needs to know where the
 * companion actually PAINTS, because everywhere else the 420x640 window must
 * stay pointer-transparent so the operator's Terminal keeps receiving clicks.
 * This module is the measurement half: pure DOM reads, no IPC, no Tauri
 * import, so it can be exercised without a native shell.
 *
 * What counts as a visible region is deliberately conservative and named,
 * not inferred: the mounted character artwork, the opaque UI surfaces the
 * FIX-008 contrast matrix already treats as painted backgrounds, and real
 * controls. An element that is display:none, visibility:hidden, transparent,
 * or zero-sized paints nothing and is never published — publishing it would
 * recreate exactly the invisible blocker FIX-008 exists to prevent.
 *
 * Honest limit: these are RECTANGLES. A rectangle around non-rectangular
 * character art still captures the transparent corners inside its own box.
 * That is a bounded, visible-adjacent cost, not per-pixel alpha hit testing,
 * and nothing here should be described as the latter.
 */

import type { InputRegion } from './input-policy.ts';

/**
 * Surfaces that paint an opaque background or are real controls. Every
 * entry corresponds to something the operator can see or click:
 * `.candice-status-surface` / `.candice-runtime-status` /
 * `.candice-state-caption` all paint `--candice-ui-surface` (styles.css),
 * and the rest are interactive by definition.
 */
export const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[tabindex]:not([tabindex="-1"])',
  // The painted surfaces, taken from the app's OWN enumeration of them:
  // the `@media (forced-colors: active)` rule in styles.css lists exactly
  // the classes that paint a background, because those are the ones that
  // must repaint in forced-colors mode. Mirroring that list keeps this
  // selector from drifting into a private opinion about what is visible.
  // `.fallback-*` matters most: when the companion has degraded to the text
  // card, it is the ONLY thing on screen the operator can grab.
  '.candice-status-surface',
  '.candice-runtime-status',
  '.candice-state-caption',
  '.candice-captions',
  '.candice-answer-controls',
  '.candice-ptt',
  '.candice-name-prompt',
  '.fallback-title',
  '.fallback-hint',
].join(',');

/** Character artwork mounted by the gesture stage (FIX-016). */
export const CHARACTER_SELECTOR = '.candice-gesture-layer, .candice-character-image';

/**
 * Padding added around every measured box, in CSS pixels.
 *
 * The character breathes (`@keyframes candice-breathe` scales it), so its
 * measured box oscillates every frame. Padding absorbs that oscillation so
 * the published regions stay stable instead of being rewritten 60 times a
 * second. It is intentionally small: the character already carries a 22px
 * drop-shadow glow, so these pixels are inside its visible halo.
 */
export const REGION_PADDING = 4;

/** An element treated as a visible surface, with the purpose it serves. */
export interface VisibleSurface {
  element: Element;
  purpose: InputRegion['purpose'];
}

interface ViewportLike {
  innerWidth: number;
  innerHeight: number;
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Collect the surfaces that paint, in document order, character first.
 * Exported so a caller can see exactly which elements were selected rather
 * than trusting the region list alone.
 */
export function collectVisibleSurfaces(root: ParentNode): VisibleSurface[] {
  const surfaces: VisibleSurface[] = [];
  const seen = new Set<Element>();
  const add = (element: Element, purpose: InputRegion['purpose']): void => {
    if (seen.has(element)) return;
    seen.add(element);
    surfaces.push({ element, purpose });
  };
  // The character is the drag handle: grabbing Candice is how the window
  // moves (src/window/dragging.ts).
  for (const element of root.querySelectorAll(CHARACTER_SELECTOR)) {
    add(element, 'drag-handle');
  }
  for (const element of root.querySelectorAll(CONTROL_SELECTOR)) {
    add(element, 'control');
  }
  return surfaces;
}

/**
 * True only when the element paints something. Checks its own computed
 * display/visibility/opacity plus ancestor opacity (opacity does not
 * inherit, so an invisible parent would otherwise go unnoticed), and
 * requires a non-zero box.
 */
export function paintsPixels(element: Element): boolean {
  const view = element.ownerDocument?.defaultView;
  if (view == null) return false;
  const style = view.getComputedStyle(element);
  // `visibility` inherits, so this one read covers ancestors too.
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.contentVisibility === 'hidden') return false;
  let node: Element | null = element;
  while (node != null) {
    const opacity = Number.parseFloat(view.getComputedStyle(node).opacity);
    if (Number.isFinite(opacity) && opacity <= 0.01) return false;
    node = node.parentElement;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * The box an element actually paints into.
 *
 * For an `object-fit: contain` image the element box is letterboxed: the
 * artwork occupies a centered sub-rect. Publishing the element box instead
 * would hand the native layer empty bars above and below the character.
 * Anything that is not a loaded, contained image reports its own box.
 */
export function paintedRect(element: Element): RectLike {
  const box = element.getBoundingClientRect();
  const base: RectLike = { x: box.x, y: box.y, width: box.width, height: box.height };
  const view = element.ownerDocument?.defaultView;
  if (view == null) return base;
  const image = element as Partial<HTMLImageElement>;
  const naturalWidth = typeof image.naturalWidth === 'number' ? image.naturalWidth : 0;
  const naturalHeight = typeof image.naturalHeight === 'number' ? image.naturalHeight : 0;
  if (naturalWidth <= 0 || naturalHeight <= 0) return base;
  if (base.width <= 0 || base.height <= 0) return base;
  const fit = view.getComputedStyle(element).objectFit;
  if (fit !== 'contain' && fit !== 'scale-down') return base;
  const scale = Math.min(base.width / naturalWidth, base.height / naturalHeight);
  // `scale-down` never enlarges past the natural size.
  const applied = fit === 'scale-down' ? Math.min(scale, 1) : scale;
  const width = naturalWidth * applied;
  const height = naturalHeight * applied;
  return {
    x: base.x + (base.width - width) / 2,
    y: base.y + (base.height - height) / 2,
    width,
    height,
  };
}

/**
 * Measure every painting surface under `root` and return the regions to
 * publish, in window-content CSS pixels, clipped to the viewport.
 *
 * Clipping matters: a region that hangs off the window edge would tell the
 * native layer to capture the pointer at coordinates the window does not
 * occupy. A surface entirely outside the viewport is dropped.
 */
export function measureVisibleRegions(
  root: ParentNode,
  viewport?: ViewportLike,
  padding: number = REGION_PADDING,
): InputRegion[] {
  const view = viewport
    ?? (root as Partial<Document>).defaultView
    ?? (root as Element).ownerDocument?.defaultView
    ?? (typeof window === 'undefined' ? null : window);
  if (view == null) return [];
  const maxX = view.innerWidth;
  const maxY = view.innerHeight;
  if (!(maxX > 0) || !(maxY > 0)) return [];

  const regions: InputRegion[] = [];
  for (const surface of collectVisibleSurfaces(root)) {
    if (!paintsPixels(surface.element)) continue;
    const rect = paintedRect(surface.element);
    const left = Math.max(0, rect.x - padding);
    const top = Math.max(0, rect.y - padding);
    const right = Math.min(maxX, rect.x + rect.width + padding);
    const bottom = Math.min(maxY, rect.y + rect.height + padding);
    const width = right - left;
    const height = bottom - top;
    if (!(width > 0) || !(height > 0)) continue;
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    regions.push({
      x: round(left),
      y: round(top),
      width: round(width),
      height: round(height),
      purpose: surface.purpose,
    });
  }
  return regions;
}

/**
 * True when two region sets differ enough to be worth republishing.
 *
 * The character's breathing animation moves its edges continuously; without
 * a tolerance every frame would send IPC. `tolerance` is the largest edge
 * movement, in CSS pixels, treated as the same region.
 *
 * The default is calibrated against the real animation, not guessed: the
 * mounted character's measured width was observed oscillating by 8.66px
 * (295.03 -> 286.37) on the packaged build, which a tolerance of 8 does not
 * absorb, so the regions were being republished about twice a second.
 *
 * THIS COUPLES THIS LANE TO THE ANIMATION LANE. The number is an empirical
 * fact about the breathing keyframes (`candice-breathe` in styles.css), not
 * a free parameter. If the breath amplitude changes, re-measure the
 * oscillation and re-set this: too low and every animation frame republishes
 * over IPC, too high and a real move of the character is not published and
 * the operator loses the grab region until the next larger change.
 */
export function regionsDiffer(
  a: readonly InputRegion[],
  b: readonly InputRegion[],
  tolerance = 12,
): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined || right === undefined) return true;
    if (left.purpose !== right.purpose) return true;
    if (Math.abs(left.x - right.x) > tolerance) return true;
    if (Math.abs(left.y - right.y) > tolerance) return true;
    if (Math.abs(left.width - right.width) > tolerance) return true;
    if (Math.abs(left.height - right.height) > tolerance) return true;
  }
  return false;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
