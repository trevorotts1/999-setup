/**
 * Visible-region measurement (FIX-008 partial input policy).
 *
 * These tests exist to defend one property above all others: a region is
 * published ONLY for pixels the operator can see. Every false positive here
 * becomes an invisible rectangle sitting on top of the operator's Terminal
 * and eating clicks, which is the exact failure FIX-008 was written to
 * prevent. The "invisible surfaces are never published" cases are therefore
 * the load-bearing ones, not the happy path.
 *
 * The DOM is faked rather than emulated: these assertions are about the
 * measurement math and the visibility filter, not about a selector engine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectVisibleSurfaces,
  measureVisibleRegions,
  paintedRect,
  paintsPixels,
  regionsDiffer,
} from '../visible-regions.ts';
import { CHARACTER_SELECTOR, CONTROL_SELECTOR } from '../visible-regions.ts';

// ------------------------------------------------------------------ fake DOM

interface FakeStyle {
  display: string;
  visibility: string;
  opacity: string;
  objectFit: string;
  contentVisibility: string;
}

class FakeElement {
  parentElement: FakeElement | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  style: Partial<FakeStyle> = {};
  rect = { x: 0, y: 0, width: 0, height: 0 };
  readonly ownerDocument: { defaultView: FakeView };

  constructor(view: FakeView) {
    this.ownerDocument = { defaultView: view };
  }

  getBoundingClientRect(): { x: number; y: number; width: number; height: number } {
    return { ...this.rect };
  }
}

class FakeView {
  innerWidth = 420;
  innerHeight = 640;

  getComputedStyle(element: FakeElement): FakeStyle {
    return {
      display: element.style.display ?? 'block',
      visibility: element.style.visibility ?? 'visible',
      opacity: element.style.opacity ?? '1',
      objectFit: element.style.objectFit ?? 'fill',
      contentVisibility: element.style.contentVisibility ?? 'visible',
    };
  }
}

/** A root whose querySelectorAll answers from explicit per-selector lists. */
class FakeRoot {
  // Explicit fields, not parameter properties: node --experimental-strip-types
  // runs in strip-only mode and rejects parameter properties outright.
  characters: FakeElement[];
  controls: FakeElement[];

  constructor(characters: FakeElement[], controls: FakeElement[]) {
    this.characters = characters;
    this.controls = controls;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === CHARACTER_SELECTOR) return this.characters;
    if (selector === CONTROL_SELECTOR) return this.controls;
    throw new Error(`unexpected selector: ${selector}`);
  }
}

function element(view: FakeView, rect: Partial<FakeElement['rect']>): FakeElement {
  const el = new FakeElement(view);
  el.rect = { x: 0, y: 0, width: 0, height: 0, ...rect };
  return el;
}

/** Cast helper: the fakes satisfy the structural reads under test. */
function asRoot(root: FakeRoot): ParentNode {
  return root as unknown as ParentNode;
}
function asElement(el: FakeElement): Element {
  return el as unknown as Element;
}

// --------------------------------------------------------------- visibility

test('paintsPixels accepts a laid-out, opaque, visible element', () => {
  const view = new FakeView();
  const el = element(view, { x: 10, y: 10, width: 100, height: 40 });
  assert.equal(paintsPixels(asElement(el)), true);
});

test('paintsPixels rejects display:none, visibility:hidden and zero-size boxes', () => {
  const view = new FakeView();
  const hidden = element(view, { width: 100, height: 40 });
  hidden.style.display = 'none';
  assert.equal(paintsPixels(asElement(hidden)), false, 'display:none paints nothing');

  const invisible = element(view, { width: 100, height: 40 });
  invisible.style.visibility = 'hidden';
  assert.equal(paintsPixels(asElement(invisible)), false, 'visibility:hidden paints nothing');

  const empty = element(view, { width: 0, height: 40 });
  assert.equal(paintsPixels(asElement(empty)), false, 'a zero-width box paints nothing');
});

test('paintsPixels rejects a fully transparent element (the inactive gesture layer)', () => {
  // `.candice-gesture-inactive` sets opacity:0 on the layer that is fading
  // out. It still has a full-size box, so only the opacity read stops it
  // from being published as a capture region.
  const view = new FakeView();
  const layer = element(view, { width: 400, height: 600 });
  layer.style.opacity = '0';
  assert.equal(paintsPixels(asElement(layer)), false);
});

test('paintsPixels rejects an element whose ANCESTOR is transparent', () => {
  // opacity does not inherit, so the child reports opacity 1 while painting
  // nothing at all. Missing this is how an invisible blocker gets published.
  const view = new FakeView();
  const parent = element(view, { width: 400, height: 600 });
  parent.style.opacity = '0';
  const child = element(view, { width: 100, height: 40 });
  child.parentElement = parent;
  assert.equal(paintsPixels(asElement(child)), false);
});

// ------------------------------------------------------------- painted rect

test('paintedRect returns the element box for a non-image element', () => {
  const view = new FakeView();
  const el = element(view, { x: 5, y: 6, width: 100, height: 40 });
  assert.deepEqual(paintedRect(asElement(el)), { x: 5, y: 6, width: 100, height: 40 });
});

test('paintedRect letterboxes an object-fit:contain image to the pixels it paints', () => {
  // A 200x400 artwork inside a 400x400 box paints a 200x400 column centered
  // horizontally: 100px of each side of that box is empty. Publishing the
  // element box would hand native 100px of transparent capture on both
  // sides of the character.
  const view = new FakeView();
  const img = element(view, { x: 0, y: 0, width: 400, height: 400 });
  img.naturalWidth = 200;
  img.naturalHeight = 400;
  img.style.objectFit = 'contain';
  assert.deepEqual(paintedRect(asElement(img)), { x: 100, y: 0, width: 200, height: 400 });
});

test('paintedRect falls back to the element box when the image has not decoded', () => {
  const view = new FakeView();
  const img = element(view, { x: 0, y: 0, width: 400, height: 400 });
  img.style.objectFit = 'contain';
  // naturalWidth/Height stay 0 until decode.
  assert.deepEqual(paintedRect(asElement(img)), { x: 0, y: 0, width: 400, height: 400 });
});

test('paintedRect never enlarges a scale-down image past its natural size', () => {
  const view = new FakeView();
  const img = element(view, { x: 0, y: 0, width: 400, height: 400 });
  img.naturalWidth = 100;
  img.naturalHeight = 100;
  img.style.objectFit = 'scale-down';
  assert.deepEqual(paintedRect(asElement(img)), { x: 150, y: 150, width: 100, height: 100 });
});

// ---------------------------------------------------------------- collection

test('collectVisibleSurfaces labels the character a drag handle and controls controls', () => {
  const view = new FakeView();
  const character = element(view, { width: 300, height: 500 });
  const button = element(view, { width: 80, height: 30 });
  const surfaces = collectVisibleSurfaces(asRoot(new FakeRoot([character], [button])));
  assert.deepEqual(
    surfaces.map((s) => s.purpose),
    ['drag-handle', 'control'],
  );
});

test('collectVisibleSurfaces never lists the same element twice', () => {
  // The character stage can also match a control selector (e.g. it carries a
  // tabindex). A duplicate would publish the same rectangle twice.
  const view = new FakeView();
  const shared = element(view, { width: 300, height: 500 });
  const surfaces = collectVisibleSurfaces(asRoot(new FakeRoot([shared], [shared])));
  assert.equal(surfaces.length, 1);
  assert.equal(surfaces[0]?.purpose, 'drag-handle', 'first classification wins');
});

// --------------------------------------------------------------- measurement

test('measureVisibleRegions publishes a padded box for a visible surface', () => {
  const view = new FakeView();
  const pill = element(view, { x: 100, y: 200, width: 120, height: 30 });
  const regions = measureVisibleRegions(asRoot(new FakeRoot([], [pill])), view, 4);
  assert.deepEqual(regions, [
    { x: 96, y: 196, width: 128, height: 38, purpose: 'control' },
  ]);
});

test('measureVisibleRegions publishes NOTHING when nothing is painted', () => {
  // This is the resting state of the shell before artwork mounts. An empty
  // list keeps the window in whole-window pass-through, which is what lets
  // the operator keep clicking the Terminal underneath.
  const view = new FakeView();
  const hidden = element(view, { width: 300, height: 500 });
  hidden.style.display = 'none';
  const transparent = element(view, { width: 300, height: 500 });
  transparent.style.opacity = '0';
  const regions = measureVisibleRegions(asRoot(new FakeRoot([hidden], [transparent])), view, 4);
  assert.deepEqual(regions, []);
});

test('measureVisibleRegions clips to the window and drops offscreen surfaces', () => {
  const view = new FakeView();
  // Straddles the right edge of the 420px-wide window.
  const straddling = element(view, { x: 400, y: 10, width: 100, height: 20 });
  // Entirely below the 640px-tall window.
  const offscreen = element(view, { x: 10, y: 900, width: 100, height: 20 });
  const regions = measureVisibleRegions(
    asRoot(new FakeRoot([], [straddling, offscreen])),
    view,
    0,
  );
  assert.equal(regions.length, 1, 'the offscreen surface is dropped entirely');
  assert.deepEqual(regions[0], { x: 400, y: 10, width: 20, height: 20, purpose: 'control' });
});

test('measureVisibleRegions returns nothing for a zero-sized viewport', () => {
  const view = new FakeView();
  view.innerWidth = 0;
  view.innerHeight = 0;
  const pill = element(view, { x: 0, y: 0, width: 100, height: 20 });
  assert.deepEqual(measureVisibleRegions(asRoot(new FakeRoot([], [pill])), view), []);
});

// ----------------------------------------------------------------- diffing

test('regionsDiffer ignores sub-tolerance drift (the breathing animation)', () => {
  // `@keyframes candice-breathe` scales the character continuously, so its
  // measured box never settles. Without a tolerance every animation frame
  // would republish over IPC.
  const a = [{ x: 100, y: 100, width: 200, height: 400, purpose: 'drag-handle' as const }];
  const b = [{ x: 103, y: 97, width: 194, height: 406, purpose: 'drag-handle' as const }];
  assert.equal(regionsDiffer(a, b, 8), false);
});

test('regionsDiffer reports a real move, a count change and a purpose change', () => {
  const base = [{ x: 100, y: 100, width: 200, height: 400, purpose: 'drag-handle' as const }];
  assert.equal(
    regionsDiffer(base, [{ ...base[0]!, x: 140 }], 8),
    true,
    'a 40px move is a real move',
  );
  assert.equal(regionsDiffer(base, [], 8), true, 'a count change always differs');
  assert.equal(
    regionsDiffer(base, [{ ...base[0]!, purpose: 'control' }], 8),
    true,
    'the purpose is part of the published fact',
  );
});
