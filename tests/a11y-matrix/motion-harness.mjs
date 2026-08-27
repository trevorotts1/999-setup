#!/usr/bin/env node
/**
 * FIX-008 QC — motion + text-scale harness (deterministic, pure Node).
 *
 * Imports the candidate a11y modules (exact blobs at commit 3bca501) via
 * Node's native TypeScript type-stripping and drives them against a fake
 * DOM. Exercises:
 *   - normalizeTextScale bounds (0.8 / 1.0 / 1.6, clamps, non-number → 1)
 *   - initializeAccessibilityRuntime (token write, dataset markers, dispose)
 *   - tier resolution (preference wins, media fallback, never throws)
 *   - applyReducedMotion single-writer class + data attribute + live OS listener
 *   - createA11yController (reduced/tier getters, applyPreference, detach)
 *   - createReducedMotionState (valid transitions, invalid ignored, subscribe)
 *   - cross-lane class consumers (no second class name anywhere)
 *
 * Usage: node tests/a11y-matrix/motion-harness.mjs
 * Exit 0 only when every check passes. Prints PASS/FAIL per check.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures', 'candidate-a11y', 'apps', 'candice-companion', 'src');

const {
  DEFAULT_TEXT_SCALE,
  MIN_TEXT_SCALE,
  MAX_TEXT_SCALE,
  normalizeTextScale,
  initializeAccessibilityRuntime,
} = await import(join(FIX, 'a11y', 'runtime.ts'));
const {
  REDUCED_MOTION_CLASS,
  REDUCED_MOTION_QUERY,
  REDUCED_MOTION_EVENT,
  REDUCED_MOTION_TIERS,
} = await import(join(FIX, 'a11y', 'config.ts'));
const {
  tierFromPreference,
  tierFromMedia,
  resolveReducedMotionTier,
  applyReducedMotion,
  applyReducedMotionForPreference,
} = await import(join(FIX, 'a11y', 'apply.ts'));
const { createA11yController } = await import(join(FIX, 'a11y', 'controller.ts'));
const { createReducedMotionState, isReducedMotionTier } = await import(join(FIX, 'a11y', 'motion.ts'));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ---- fake DOM --------------------------------------------------------------
class FakeClassList {
  constructor() { this.set = new Set(); }
  toggle(cls, force) {
    const want = force === undefined ? !this.set.has(cls) : force;
    if (want) this.set.add(cls); else this.set.delete(cls);
    return want;
  }
  contains(cls) { return this.set.has(cls); }
  add(cls) { this.set.add(cls); }
  remove(cls) { this.set.delete(cls); }
}

class FakeMQL {
  constructor(matches) {
    this.matches = matches;
    this.listeners = new Set();
  }
  addEventListener(type, fn) { if (type === REDUCED_MOTION_EVENT) this.listeners.add(fn); }
  removeEventListener(type, fn) { this.listeners.delete(fn); }
  fire() { for (const fn of [...this.listeners]) fn(); }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    this.attrs = {};
    this.ownerDocument = null;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
}

function makeDom({ mediaMatches = false, mediaThrows = false, noMatchMedia = false } = {}) {
  const html = new FakeElement('html');
  const mql = new FakeMQL(mediaMatches);
  const win = {
    matchMedia(query) {
      if (noMatchMedia) return undefined;
      if (mediaThrows) throw new Error('matchMedia broken');
      if (query !== REDUCED_MOTION_QUERY) return undefined;
      return mql;
    },
  };
  const doc = { documentElement: html, defaultView: win };
  html.ownerDocument = doc;
  return { html, doc, win, mql };
}

// ---- 1. text-scale normalization -------------------------------------------
check('constants: default 1, min 0.8, max 1.6',
  DEFAULT_TEXT_SCALE === 1 && MIN_TEXT_SCALE === 0.8 && MAX_TEXT_SCALE === 1.6);
check('normalizeTextScale(1) = 1', normalizeTextScale(1) === 1);
check('normalizeTextScale(0.8) = 0.8', normalizeTextScale(0.8) === 0.8);
check('normalizeTextScale(1.6) = 1.6', normalizeTextScale(1.6) === 1.6);
check('normalizeTextScale(0.5) clamps to 0.8', normalizeTextScale(0.5) === 0.8);
check('normalizeTextScale(2) clamps to 1.6', normalizeTextScale(2) === 1.6);
check('normalizeTextScale(-1) clamps to 0.8', normalizeTextScale(-1) === 0.8);
check('normalizeTextScale(NaN) = 1', normalizeTextScale(NaN) === 1);
check('normalizeTextScale(Infinity) = 1', normalizeTextScale(Infinity) === 1);
check('normalizeTextScale("1.2") = 1 (string rejected)', normalizeTextScale('1.2') === 1);
check('normalizeTextScale(null) = 1', normalizeTextScale(null) === 1);
check('normalizeTextScale(undefined) = 1', normalizeTextScale(undefined) === 1);

// ---- 2. runtime initialization ----------------------------------------------
{
  const { html } = makeDom();
  globalThis.document = { documentElement: html };
  const rt = initializeAccessibilityRuntime(html, { reducedMotion: null, textScale: 1 });
  check('runtime sets --candice-text-scale: 1', html.style.props['--candice-text-scale'] === '1');
  check('runtime sets data-candice-text-scale', html.dataset.candiceTextScale === '1');
  check('runtime marks data-candice-a11y-runtime active', html.dataset.candiceA11yRuntime === 'active');
  check('runtime textScale getter = 1', rt.textScale === 1);
  rt.setTextScale(1.4);
  check('setTextScale(1.4) writes 1.4', html.style.props['--candice-text-scale'] === '1.4'
    && html.dataset.candiceTextScale === '1.4' && rt.textScale === 1.4);
  rt.setTextScale(99);
  check('setTextScale(99) clamps to 1.6', rt.textScale === 1.6);
  rt.setTextScale(0.1);
  check('setTextScale(0.1) clamps to 0.8', rt.textScale === 0.8);
  rt.dispose();
  check('dispose removes runtime marker', !('candiceA11yRuntime' in html.dataset));
  delete globalThis.document;
}

// ---- 3. tier resolution ------------------------------------------------------
check('tierFromPreference(true) = reduce', tierFromPreference(true) === 'reduce');
check('tierFromPreference(false) = allow', tierFromPreference(false) === 'allow');
check('tierFromPreference(null) = os', tierFromPreference(null) === 'os');
{
  const { win } = makeDom({ mediaMatches: true });
  const r = tierFromMedia(win);
  check('tierFromMedia(matches) = reduce + available', r.tier === 'reduce' && r.mediaAvailable);
}
{
  const { win } = makeDom({ mediaMatches: false });
  const r = tierFromMedia(win);
  check('tierFromMedia(no match) = allow + available', r.tier === 'allow' && r.mediaAvailable);
}
{
  const { win } = makeDom({ noMatchMedia: true });
  const r = tierFromMedia(win);
  check('tierFromMedia(absent) = os + unavailable (never throws)', r.tier === 'os' && !r.mediaAvailable);
}
{
  const { win } = makeDom({ mediaThrows: true });
  const r = tierFromMedia(win);
  check('tierFromMedia(throwing) = os + unavailable (never throws)', r.tier === 'os' && !r.mediaAvailable);
}
{
  const { win } = makeDom({ mediaMatches: false });
  const r = resolveReducedMotionTier(true, win);
  check('resolve: preference true wins over media', r.tier === 'reduce');
}
{
  const { win } = makeDom({ mediaMatches: true });
  const r = resolveReducedMotionTier(false, win);
  check('resolve: preference false wins over media', r.tier === 'allow');
}
{
  const { win } = makeDom({ mediaMatches: true });
  const r = resolveReducedMotionTier(null, win);
  check('resolve: null follows OS media', r.tier === 'reduce' && r.mediaAvailable);
}

// ---- 4. applyReducedMotion single writer -------------------------------------
{
  const { html, win, mql } = makeDom({ mediaMatches: true });
  const detach = applyReducedMotion(html, 'reduce');
  check('apply reduce: class on', html.classList.contains(REDUCED_MOTION_CLASS));
  check('apply reduce: data attr reduce', html.getAttribute('data-candice-reduced-motion') === 'reduce');
  detach();
}
{
  const { html } = makeDom();
  applyReducedMotion(html, 'allow');
  check('apply allow: class off', !html.classList.contains(REDUCED_MOTION_CLASS));
  check('apply allow: data attr allow', html.getAttribute('data-candice-reduced-motion') === 'allow');
}
{
  const { html, win, mql } = makeDom({ mediaMatches: true });
  const detach = applyReducedMotion(html, 'os');
  check('apply os + media reduce: class on', html.classList.contains(REDUCED_MOTION_CLASS));
  mql.matches = false;
  mql.fire();
  check('os listener: media flip removes class', !html.classList.contains(REDUCED_MOTION_CLASS));
  check('os listener: media flip updates attr', html.getAttribute('data-candice-reduced-motion') === 'allow');
  mql.matches = true;
  mql.fire();
  check('os listener: media flip back re-adds class', html.classList.contains(REDUCED_MOTION_CLASS));
  detach();
  mql.matches = false;
  mql.fire();
  check('detach: listener removed, class unchanged', html.classList.contains(REDUCED_MOTION_CLASS));
}
{
  const { html, win } = makeDom({ mediaMatches: false });
  const { result } = applyReducedMotionForPreference(html, null, win);
  check('applyForPreference(null, media off): reduced false, tier allow',
    result.reduced === false && result.tier === 'allow' && result.mediaAvailable);
}
check('applyReducedMotion(null root) never throws', (() => {
  try { applyReducedMotion(null, 'os'); return true; } catch { return false; }
})());

// ---- 5. controller ------------------------------------------------------------
{
  const { html, win, mql } = makeDom({ mediaMatches: true });
  const c = createA11yController({ root: html, preference: null, media: win });
  check('controller: reduced true when OS says reduce', c.reduced === true);
  check('controller: tier reduce', c.tier === 'reduce');
  c.applyPreference(false);
  check('controller: applyPreference(false) removes class', c.reduced === false && c.tier === 'allow');
  c.applyPreference(true);
  check('controller: applyPreference(true) re-adds class', c.reduced === true && c.tier === 'reduce');
  c.applyPreference(null);
  check('controller: back to os follows media', c.reduced === true && c.tier === 'reduce');
  c.detach();
  mql.matches = false;
  mql.fire();
  check('controller: detach stops live updates', c.reduced === true);
}
{
  const { html } = makeDom();
  const c = createA11yController({ root: html, preference: null, media: null, doc: null });
  check('controller: headless (no doc) never throws, reduced false', c.reduced === false);
}

// ---- 6. reduced-motion state store --------------------------------------------
{
  const s = createReducedMotionState('os');
  check('state: initial tier os', s.tier === 'os');
  const seen = [];
  const unsub = s.subscribe((t) => seen.push(t));
  s.setTier('reduce');
  check('state: setTier reduce notifies', s.tier === 'reduce' && seen.join(',') === 'reduce');
  s.setTier('reduce');
  check('state: same tier no duplicate notify', seen.length === 1);
  s.setTier('bogus');
  check('state: invalid tier ignored', s.tier === 'reduce' && seen.length === 1);
  unsub();
  s.setTier('allow');
  check('state: unsubscribe stops notify', seen.length === 1 && s.tier === 'allow');
}
check('isReducedMotionTier: valid three', REDUCED_MOTION_TIERS.every(isReducedMotionTier));
check('isReducedMotionTier: rejects junk', !isReducedMotionTier('junk') && !isReducedMotionTier(42) && !isReducedMotionTier(null));

// ---- 7. cross-lane class consumers ---------------------------------------------
{
  const consumers = [
    'ui/captions/view.ts',
    'ui/compact/config.ts',
    'ui/transcript/config.ts',
    'ui/answer-controls/config.ts',
    'ui/ptt/config.ts',
    'animation/gesture/config.ts',
  ];
  for (const rel of consumers) {
    const text = readFileSync(join(FIX, rel), 'utf8');
    check(`consumer ${rel} references shared class`, text.includes(REDUCED_MOTION_CLASS));
  }
  // No second reduced-motion class name anywhere in the candidate tree.
  const allFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|css|html)$/.test(entry.name)) allFiles.push(p);
    }
  };
  walk(FIX);
  const offenders = [];
  for (const p of allFiles) {
    const text = readFileSync(p, 'utf8');
    const lines = text.split('\n');
    for (const line of lines) {
      const m = line.match(/['"]([a-z0-9-]*reduced-motion[a-z0-9-]*)['"]/gi) ?? [];
      for (const hit of m) {
        const name = hit.replace(/['"]/g, '');
        // Attributes (data-*) and the OS media query are not class names.
        if (name.startsWith('data-') || name.startsWith('prefers-')) continue;
        // Only class-application contexts count; doc comments may name the
        // spec row "reduced-motion" without defining a second class.
        if (!/classList|className|class\s*=|class\s*:/.test(line)) continue;
        if (name !== REDUCED_MOTION_CLASS) offenders.push(`${p}: ${name}`);
      }
    }
  }
  check('no second reduced-motion class name in candidate tree', offenders.length === 0,
    offenders.length ? offenders.join('; ') : undefined);
}

console.log(failures === 0 ? '\nMOTION HARNESS ALL GREEN' : `\n${failures} MOTION CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
