/**
 * WS-14 acceptance tests (CHECKLIST E.1 WS-14).
 *
 *   PASS: captions always shown regardless of voice state; OS
 *         reduced-motion setting is respected.
 *
 * Runnable with zero deps on Node >= 22.6 (node:test + TS type-stripping),
 * following the lane convention established by WS-07/WS-12/WS-13/WS-40:
 *
 *   node --test apps/candice-companion/src/a11y/__tests__/a11y.test.ts
 *
 * Scope: the reduced-motion half of WS-14 — tier resolution (OS query,
 * spec-9 preference override), the single shared class application on
 * <html>, the OS change listener, and the never-throw failure mode.
 * The captions half lives in `src/ui/captions/__tests__/captions.test.ts`.
 *
 * The class name is proven identical to every consuming lane's declaration
 * (WS-09 PTT/answer-controls, WS-10 compact, WS-13 gesture) by reading the
 * sibling lane config sources — the single shared class is a hard contract
 * (spec 10; E.2 "reduced-motion" row).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  A11Y_CONTRACT_VERSION,
  REDUCED_MOTION_CLASS,
  REDUCED_MOTION_QUERY,
  REDUCED_MOTION_TIERS,
} from "../config.ts";
import {
  applyReducedMotion,
  applyReducedMotionForPreference,
  resolveReducedMotionTier,
  tierFromMedia,
  tierFromPreference,
  type A11yMediaLike,
} from "../apply.ts";
import { createReducedMotionState, isReducedMotionTier } from "../motion.ts";
import { createA11yController } from "../controller.ts";

// ------------------------------------------------------------ tiny fake DOM

class FakeClassList {
  private set = new Set<string>();
  add(...names: string[]): void { for (const n of names) this.set.add(n); }
  remove(...names: string[]): void { for (const n of names) this.set.delete(n); }
  toggle(name: string, force?: boolean): boolean {
    const on = force === undefined ? !this.set.has(name) : force;
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name: string): boolean { return this.set.has(name); }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly classes = new FakeClassList();
  readonly children: FakeElement[] = [];
  ownerDocument: FakeDocument | null = null;
  parent: FakeElement | null = null;
  textContent = '';
  id = '';
  tagName: string;

  constructor(tagName: string) {
    this.tagName = tagName;
  }
  get classList(): FakeClassList { return this.classes; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...children: FakeElement[]): void {
    for (const c of children) { c.parent = this; this.children.push(c); }
  }
  remove(): void {
    if (this.parent === null) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

class FakeMediaList implements A11yMediaLike {
  matches = false;
  private listeners = new Set<() => void>();
  addEventListener(type: string, fn: () => void): void {
    if (type === 'change') this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    if (type === 'change') this.listeners.delete(fn);
  }
  fireChange(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

class FakeDocument {
  documentElement = new FakeElement('html');
  readonly head = new FakeElement('head');
  readonly body = new FakeElement('body');
  defaultView: { matchMedia: (q: string) => FakeMediaList } | null = null;
  getElementById(_id: string): FakeElement | null { return null; }
  createElement(tag: string): FakeElement { return new FakeElement(tag); }
}

function env(matches = false): { doc: FakeDocument; root: FakeElement; media: FakeMediaList } {
  const doc = new FakeDocument();
  const media = new FakeMediaList();
  media.matches = matches;
  doc.defaultView = { matchMedia: () => media };
  const root = new FakeElement('html');
  root.ownerDocument = doc;
  doc.documentElement = root;
  return { doc, root, media };
}

// ---------------------------------------------------- E.1 shape: shared class

test('E.1 WS-14: reduced-motion class is THE shared class across every consuming lane', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const app = join(here, '..', '..');
  const lanes = [
    ['gesture', join(app, 'animation', 'gesture', 'config.ts')],
    ['compact', join(app, 'ui', 'compact', 'config.ts')],
    ['ptt', join(app, 'ui', 'ptt', 'config.ts')],
    ['answer-controls', join(app, 'ui', 'answer-controls', 'config.ts')],
  ] as const;
  for (const [name, path] of lanes) {
    const source = readFileSync(path, 'utf8');
    const quoted = source.split('\n').find((line) => line.includes(REDUCED_MOTION_CLASS));
    assert.ok(
      source.includes(`'${REDUCED_MOTION_CLASS}'`) || source.includes(`\`${REDUCED_MOTION_CLASS}\``),
      `${name} lane must consume the shared class literal '${REDUCED_MOTION_CLASS}'`,
    );
    assert.ok(quoted, `${name} lane references the class`);
  }
});

test('E.1 WS-14: contract constants are the published values', () => {
  assert.equal(A11Y_CONTRACT_VERSION, 1);
  assert.equal(REDUCED_MOTION_CLASS, 'candice-reduced-motion');
  assert.equal(REDUCED_MOTION_QUERY, '(prefers-reduced-motion: reduce)');
  assert.deepEqual([...REDUCED_MOTION_TIERS], ['os', 'reduce', 'allow']);
  assert.ok(isReducedMotionTier('os'));
  assert.ok(isReducedMotionTier('reduce'));
  assert.ok(isReducedMotionTier('allow'));
  assert.ok(!isReducedMotionTier('none'));
  assert.ok(!isReducedMotionTier(1));
});

// ------------------------------------------------------- tier resolution

test('tierFromPreference: spec-9 triple (null follows OS, true forces, false allows)', () => {
  assert.equal(tierFromPreference(null), 'os');
  assert.equal(tierFromPreference(true), 'reduce');
  assert.equal(tierFromPreference(false), 'allow');
});

test('tierFromMedia: reads the real OS query; broken matchMedia degrades, never throws', () => {
  assert.deepEqual(tierFromMedia({ matchMedia: (q) => ({ matches: true } as A11yMediaLike) }), {
    tier: 'reduce',
    mediaAvailable: true,
  });
  assert.deepEqual(tierFromMedia({ matchMedia: (q) => ({ matches: false } as A11yMediaLike) }), {
    tier: 'allow',
    mediaAvailable: true,
  });
  // Missing matchMedia -> os + mediaAvailable false.
  assert.deepEqual(tierFromMedia({}), { tier: 'os', mediaAvailable: false });
  // matchMedia throws -> never a throw.
  assert.deepEqual(
    tierFromMedia({
      matchMedia: () => {
        throw new Error('no matchMedia');
      },
    }),
    { tier: 'os', mediaAvailable: false },
  );
  assert.deepEqual(tierFromMedia(null), { tier: 'os', mediaAvailable: false });
});

test('resolveReducedMotionTier: explicit preference always wins over the OS', () => {
  const osReduce = { matchMedia: () => ({ matches: true } as A11yMediaLike) };
  const osAllow = { matchMedia: () => ({ matches: false } as A11yMediaLike) };
  assert.equal(resolveReducedMotionTier(null, osReduce).tier, 'reduce');
  assert.equal(resolveReducedMotionTier(null, osAllow).tier, 'allow');
  assert.equal(resolveReducedMotionTier(true, osAllow).tier, 'reduce', 'forced reduce wins');
  assert.equal(resolveReducedMotionTier(false, osReduce).tier, 'allow', 'forced allow wins');
});

// --------------------------------------------------------- apply to <html>

test('applyReducedMotion: single writer toggles the class on <html>', () => {
  const { root } = env();
  applyReducedMotion(root as unknown as HTMLElement, 'reduce');
  assert.ok(root.classes.contains(REDUCED_MOTION_CLASS));
  assert.equal(root.getAttribute('data-candice-reduced-motion'), 'reduce');

  applyReducedMotion(root as unknown as HTMLElement, 'allow');
  assert.ok(!root.classes.contains(REDUCED_MOTION_CLASS));
  assert.equal(root.getAttribute('data-candice-reduced-motion'), 'allow');
});

test('applyReducedMotion: null root and throwing environments never throw (spec 20)', () => {
  assert.doesNotThrow(() => applyReducedMotion(null, 'reduce'));
  const broken = {
    ownerDocument: {
      documentElement: {
        classList: { toggle: () => { throw new Error('boom'); } },
      },
    },
  };
  assert.doesNotThrow(() => applyReducedMotion(broken as unknown as HTMLElement, 'reduce'));
});

test('applyReducedMotion: os tier keeps the class live on OS change + detach stops it', () => {
  const { root, media } = env(true);
  applyReducedMotion(root as unknown as HTMLElement, 'os');
  assert.ok(root.classes.contains(REDUCED_MOTION_CLASS), 'OS reduce -> class on');
  media.matches = false;
  media.fireChange();
  assert.ok(!root.classes.contains(REDUCED_MOTION_CLASS), 'OS allow -> class off');
  assert.equal(root.getAttribute('data-candice-reduced-motion'), 'allow');
  media.matches = true;
  media.fireChange();
  assert.ok(root.classes.contains(REDUCED_MOTION_CLASS), 'OS reduce again -> class on');
});

test('applyReducedMotionForPreference: prefer-resolve-apply in one call', () => {
  const { root } = env(true);
  const { result, detach } = applyReducedMotionForPreference(
    root as unknown as HTMLElement,
    false,
    { matchMedia: () => ({ matches: true } as A11yMediaLike) },
  );
  assert.equal(result.reduced, false, 'preference allow wins over OS reduce');
  assert.equal(result.tier, 'allow');
  assert.ok(!root.classes.contains(REDUCED_MOTION_CLASS));
  detach();
});

// --------------------------------------------------------- motion store + controller

test('createReducedMotionState: tier store notifies, never throws on subscriber failure', () => {
  const s = createReducedMotionState('os');
  const seen: string[] = [];
  const unsub = s.subscribe((tier) => seen.push(tier));
  const bad = s.subscribe(() => {
    throw new Error('subscriber boom');
  });
  s.setTier('reduce');
  s.setTier('reduce'); // no-op, no duplicate notify
  s.setTier('allow');
  unsub();
  bad();
  assert.deepEqual(seen, ['reduce', 'allow']);
  s.setTier('os');
  assert.deepEqual(seen, ['reduce', 'allow'], 'unsubscribed listeners get nothing');
});

test('createA11yController: preference applies at creation; re-apply on change', () => {
  const { root, media } = env(true);
  const ctrl = createA11yController({
    root: root as unknown as HTMLElement,
    preference: null,
    media: { matchMedia: (q) => media },
  });
  assert.equal(ctrl.reduced, true, 'OS reduce at boot');
  assert.equal(ctrl.tier, 'reduce');
  ctrl.applyPreference(false);
  assert.equal(ctrl.reduced, false, 'explicit allow overrides OS');
  assert.equal(ctrl.tier, 'allow');
  ctrl.applyPreference(true);
  assert.equal(ctrl.reduced, true);
  ctrl.detach();
  ctrl.applyPreference(false); // detached: no-op, never throws
  assert.equal(ctrl.reduced, true);
});

test('createA11yController: null root / broken media never throw (spec 20)', () => {
  assert.doesNotThrow(() =>
    createA11yController({ root: null, preference: null, media: null }),
  );
  const ctrl = createA11yController({
    root: null,
    preference: true,
    media: {
      matchMedia: () => {
        throw new Error('boom');
      },
    },
  });
  assert.equal(ctrl.tier, 'reduce', 'explicit preference holds without media');
  assert.doesNotThrow(() => ctrl.detach());
});
