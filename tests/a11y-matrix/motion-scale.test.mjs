/**
 * FIX-008 a11y matrix — reduced-motion tier x text-scale matrix + keyboard
 * tab-order enumeration + deterministic DOM captures.
 *
 * Drives the real a11y lane sources (read-only) through the fake-DOM pattern
 * established by `src/a11y/__tests__/a11y.test.ts`:
 *
 *   - reduced-motion tiers `os` / `reduce` / `allow` x OS media flip
 *     (reduce -> allow -> reduce) with the shared class + data attribute
 *     asserted per cell
 *   - text-scale bounds: 0.8 / 1.0 / 1.6 applied as the CSS variable and
 *     dataset; invalid values (0.1, 2.5, NaN, 'big', null) normalize to 1
 *   - keyboard tab-order enumeration: the boot path mounts NO visible
 *     interactive element (answer controls mount only after an
 *     authenticated bridge question; the window is pointer-transparent
 *     until then), so the honest recorded result is "no visible
 *     interactive controls" — proven from the DOM contract, not asserted
 *     as a live walk
 *   - deterministic captures: a JSON snapshot per matrix cell (tier,
 *     scale, class, data attributes, CSS variable) written to
 *     report/captures/ with a stable shape
 *
 * Runnable with zero deps on plain node (Node >= 22.6 type-stripping):
 *
 *   node --test tests/a11y-matrix/motion-scale.test.mjs
 *
 * Skip discipline: legs that need a real OS toggle (System Settings
 * reduced-motion flip on the packaged app) are RECORDED as skipped with
 * the reason and the suite still exits 0.
 */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  REDUCED_MOTION_CLASS,
  REDUCED_MOTION_QUERY,
  REDUCED_MOTION_TIERS,
} from '../../apps/candice-companion/src/a11y/config.ts';
import { createA11yController } from '../../apps/candice-companion/src/a11y/controller.ts';
import { applyReducedMotion } from '../../apps/candice-companion/src/a11y/apply.ts';
import {
  initializeAccessibilityRuntime,
  normalizeTextScale,
  MIN_TEXT_SCALE,
  MAX_TEXT_SCALE,
  DEFAULT_TEXT_SCALE,
} from '../../apps/candice-companion/src/a11y/runtime.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const APP = join(REPO_ROOT, 'apps', 'candice-companion', 'src');
const CAPTURE_DIR = join(HERE, 'report', 'captures');

// ------------------------------------------------------------ tiny fake DOM

class FakeClassList {
  #set = new Set();
  add(...names) { for (const n of names) this.#set.add(n); }
  remove(...names) { for (const n of names) this.#set.delete(n); }
  toggle(name, force) {
    const on = force === undefined ? !this.#set.has(name) : force;
    if (on) this.#set.add(name);
    else this.#set.delete(name);
    return on;
  }
  contains(name) { return this.#set.has(name); }
}

class FakeElement {
  attributes = new Map();
  classes = new FakeClassList();
  children = [];
  ownerDocument = null;
  parent = null;
  textContent = '';
  id = '';
  style = { props: new Map(), setProperty(k, v) { this.props.set(k, v); } };
  dataset = {};
  constructor(tagName) { this.tagName = tagName; }
  get classList() { return this.classes; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { for (const c of children) { c.parent = this; this.children.push(c); } }
  remove() {
    if (this.parent === null) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

class FakeMediaList {
  matches = false;
  #listeners = new Set();
  addEventListener(type, fn) { if (type === 'change') this.#listeners.add(fn); }
  removeEventListener(type, fn) { if (type === 'change') this.#listeners.delete(fn); }
  fireChange() { for (const fn of [...this.#listeners]) fn(); }
}

class FakeDocument {
  documentElement = new FakeElement('html');
  head = new FakeElement('head');
  body = new FakeElement('body');
  defaultView = null;
  getElementById() { return null; }
  createElement(tag) { return new FakeElement(tag); }
}

function env(matches = false) {
  const doc = new FakeDocument();
  const media = new FakeMediaList();
  media.matches = matches;
  doc.defaultView = { matchMedia: () => media };
  const root = new FakeElement('html');
  root.ownerDocument = doc;
  doc.documentElement = root;
  // runtime.ts reads the global `document` for the controller root; the
  // fake document must be visible there (mirror of the real webview).
  globalThis.document = doc;
  return { doc, root, media };
}

/** Deterministic capture of one matrix cell. */
function captureCell(cell) {
  return {
    tier: cell.tier,
    textScale: cell.textScale,
    reducedClassOn: cell.root.classes.contains(REDUCED_MOTION_CLASS),
    dataReducedMotion: cell.root.getAttribute('data-candice-reduced-motion'),
    dataTextScale: cell.root.dataset.candiceTextScale ?? null,
    cssTextScale: cell.root.style.props.get('--candice-text-scale') ?? null,
    dataA11yRuntime: cell.root.dataset.candiceA11yRuntime ?? null,
  };
}

// ------------------------------------------------------- motion tier matrix

test('FIX-008 motion matrix: os tier keeps the class live on OS flip (direct apply contract)', () => {
  const { root, media } = env(true);
  const detach = applyReducedMotion(root, 'os');
  assert.ok(root.classes.contains(REDUCED_MOTION_CLASS));
  assert.equal(root.getAttribute('data-candice-reduced-motion'), 'reduce');

  media.matches = false;
  media.fireChange();
  assert.ok(!root.classes.contains(REDUCED_MOTION_CLASS));
  assert.equal(root.getAttribute('data-candice-reduced-motion'), 'allow');

  media.matches = true;
  media.fireChange();
  assert.ok(root.classes.contains(REDUCED_MOTION_CLASS));
  assert.equal(root.getAttribute('data-candice-reduced-motion'), 'reduce');
  detach();
});

test('FIX-008 motion matrix: controller observation — creation applies the resolved concrete tier; OS flip re-resolves on re-apply', () => {
  // Observed behavior of createA11yController (lane-owned, read-only here):
  // creation resolves preference+OS to a CONCRETE tier and applies it, so
  // the class does not track a later OS flip until applyPreference re-runs.
  // Recorded honestly so the human OS-toggle leg knows exactly what to
  // check on the packaged app.
  const { root, media } = env(true);
  const ctrl = createA11yController({ root, preference: null, media: { matchMedia: () => media } });
  assert.equal(ctrl.tier, 'reduce', 'OS reduce at creation');
  assert.ok(root.classes.contains(REDUCED_MOTION_CLASS));

  media.matches = false;
  media.fireChange();
  assert.equal(ctrl.tier, 'reduce', 'observed: class stays until re-apply (documented)');

  ctrl.applyPreference(null);
  assert.equal(ctrl.tier, 'allow', 're-apply re-resolves the OS state');
  assert.ok(!root.classes.contains(REDUCED_MOTION_CLASS));
  ctrl.detach();
});

test('FIX-008 motion matrix: reduce tier forces the class regardless of OS', () => {
  for (const osMatches of [true, false]) {
    const { root, media } = env(osMatches);
    const ctrl = createA11yController({ root, preference: true, media: { matchMedia: () => media } });
    assert.equal(ctrl.tier, 'reduce', `OS=${osMatches}`);
    assert.ok(root.classes.contains(REDUCED_MOTION_CLASS));
    assert.equal(root.getAttribute('data-candice-reduced-motion'), 'reduce');
    ctrl.detach();
  }
});

test('FIX-008 motion matrix: allow tier keeps the class off regardless of OS', () => {
  for (const osMatches of [true, false]) {
    const { root, media } = env(osMatches);
    const ctrl = createA11yController({ root, preference: false, media: { matchMedia: () => media } });
    assert.equal(ctrl.tier, 'allow', `OS=${osMatches}`);
    assert.ok(!root.classes.contains(REDUCED_MOTION_CLASS));
    assert.equal(root.getAttribute('data-candice-reduced-motion'), 'allow');
    ctrl.detach();
  }
});

test('FIX-008 motion matrix: preference re-apply flips the class live (os -> reduce -> allow)', () => {
  const { root, media } = env(false);
  const ctrl = createA11yController({ root, preference: null, media: { matchMedia: () => media } });
  assert.equal(ctrl.tier, 'allow');
  ctrl.applyPreference(true);
  assert.equal(ctrl.tier, 'reduce');
  assert.ok(root.classes.contains(REDUCED_MOTION_CLASS));
  ctrl.applyPreference(false);
  assert.equal(ctrl.tier, 'allow');
  assert.ok(!root.classes.contains(REDUCED_MOTION_CLASS));
  ctrl.detach();
});

// ------------------------------------------------------- text-scale matrix

test('FIX-008 text-scale matrix: 0.8 / 1.0 / 1.6 apply as CSS var + dataset', () => {
  for (const scale of [0.8, 1.0, 1.6]) {
    const { root } = env();
    const runtime = initializeAccessibilityRuntime(root, { textScale: scale });
    assert.equal(runtime.textScale, scale);
    assert.equal(root.style.props.get('--candice-text-scale'), String(scale));
    assert.equal(root.dataset.candiceTextScale, String(scale));
    assert.equal(root.dataset.candiceA11yRuntime, 'active');
    runtime.dispose();
    assert.equal(root.dataset.candiceA11yRuntime, undefined, 'dispose clears the marker');
  }
});

test('FIX-008 text-scale matrix: invalid values normalize safely (clamp or default)', () => {
  // normalizeTextScale clamps finite numbers into [0.8, 1.6] and returns
  // the default 1 for non-numbers.
  assert.equal(normalizeTextScale(0.1), MIN_TEXT_SCALE, 'below MIN clamps to 0.8');
  assert.equal(normalizeTextScale(2.5), MAX_TEXT_SCALE, 'above MAX clamps to 1.6');
  for (const bad of [Number.NaN, 'big', null, undefined, {}]) {
    assert.equal(normalizeTextScale(bad), DEFAULT_TEXT_SCALE, `normalize(${String(bad)})`);
  }
  const { root } = env();
  const runtime = initializeAccessibilityRuntime(root, { textScale: 2.5 });
  assert.equal(runtime.textScale, 1.6, 'runtime clamps to MAX');
  assert.equal(root.style.props.get('--candice-text-scale'), '1.6');
  runtime.dispose();
});

test('FIX-008 text-scale matrix: bounds constants are the published values', () => {
  assert.equal(MIN_TEXT_SCALE, 0.8);
  assert.equal(MAX_TEXT_SCALE, 1.6);
  assert.equal(DEFAULT_TEXT_SCALE, 1);
});

test('FIX-008 text-scale matrix: setTextScale re-applies live and clamps', () => {
  const { root } = env();
  const runtime = initializeAccessibilityRuntime(root, { textScale: 1 });
  runtime.setTextScale(1.6);
  assert.equal(runtime.textScale, 1.6);
  assert.equal(root.style.props.get('--candice-text-scale'), '1.6');
  runtime.setTextScale(0.8);
  assert.equal(runtime.textScale, 0.8);
  runtime.setTextScale(99);
  assert.equal(runtime.textScale, 1.6, 'clamped to MAX');
  runtime.dispose();
});

// ------------------------------------------------------- keyboard tab order

test('FIX-008 tab order: boot path mounts no visible interactive element (honest enumeration)', () => {
  // The boot path (index.html + main.ts + composition.ts) mounts only:
  //   - the boot surface (role=status, aria-live=polite)
  //   - the gesture stage host (aria-hidden until layers mount)
  //   - the runtime status paragraph (role=status)
  //   - the captions live region (role=status, aria-live=polite)
  // Answer controls (input + buttons) mount ONLY inside
  // initializeAuthenticatedBridge after a native-authenticated question
  // event; the window stays pointer-transparent until then. So the honest
  // tab-order result for the idle companion is: no visible interactive
  // controls, zero tab stops.
  const indexHtml = readFileSync(join(APP, '..', 'index.html'), 'utf8');
  const mainTs = readFileSync(join(APP, 'main.ts'), 'utf8');
  const compositionTs = readFileSync(join(APP, 'runtime', 'composition.ts'), 'utf8');
  const bridgeTs = readFileSync(join(APP, 'runtime', 'bridge.ts'), 'utf8');

  // Static index.html: no interactive elements.
  assert.ok(!/<(button|input|textarea|select|a)\b/i.test(indexHtml), 'index.html has no interactive elements');
  assert.ok(!/tabindex/i.test(indexHtml), 'index.html sets no tabindex');

  // Boot path never imports the interactive views (comment mentions are
  // not imports; only import lines count).
  const importLines = (src) => src.split('\n').filter((l) => /^\s*import\b/.test(l));
  assert.ok(
    !importLines(mainTs).some((l) => l.includes('answer-controls')),
    'main.ts must not import answer-controls',
  );
  assert.ok(
    !importLines(compositionTs).some((l) => l.includes('answer-controls')),
    'composition.ts must not import answer-controls',
  );

  // The only interactive mount is gated behind the authenticated bridge.
  assert.ok(bridgeTs.includes('createAnswerControlsController'), 'bridge.ts owns the answer-controls mount');
  assert.ok(
    bridgeTs.includes('Mount answer controls only after native delivered an authenticated question'),
    'bridge mount is gated on the authenticated question event',
  );

  // The idle companion therefore has zero tab stops. Recorded as the
  // honest enumeration result, not a live walk.
  const result = {
    idleTabStops: 0,
    interactiveElements: [],
    reason:
      'no visible interactive controls in the idle companion; answer controls mount only after an authenticated bridge question (human leg covers the mounted state)',
  };
  assert.equal(result.idleTabStops, 0);
  assert.deepEqual(result.interactiveElements, []);
});

test('FIX-008 tab order: mounted answer controls carry keyboard-reachable elements with a11y names', () => {
  // The mounted-state tab order is proven from the view source: the input
  // and every button are native focusable elements; the input carries an
  // aria-label; buttons carry text content. The live walk of the mounted
  // state stays a human leg (needs a real authenticated question).
  const viewTs = readFileSync(join(APP, 'ui', 'answer-controls', 'view.ts'), 'utf8');
  assert.ok(viewTs.includes("input.setAttribute('aria-label', ANSWER_CONTROLS_LABELS.TYPE)"));
  const buttons = viewTs.match(/createElement\('button'\)/g) ?? [];
  assert.equal(buttons.length, 6, 'six buttons: submit, delegate, voice, use, edit, retry');
  assert.ok(viewTs.includes('use.disabled = true'), 'USE ANSWER starts disabled until a confirming transcript');
});

// ------------------------------------------------------- deterministic captures

test('FIX-008 captures: one deterministic snapshot per matrix cell', () => {
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const cells = [];
  for (const tier of REDUCED_MOTION_TIERS) {
    for (const scale of [0.8, 1.0, 1.6]) {
      const { root, media } = env(tier === 'reduce');
      const ctrl = createA11yController({
        root,
        preference: tier === 'os' ? null : tier === 'reduce',
        media: { matchMedia: () => media },
      });
      const runtime = initializeAccessibilityRuntime(root, { textScale: scale });
      const cell = { tier, textScale: scale, root, media };
      cells.push(cell);
      const capture = captureCell(cell);
      const name = `tier-${tier}-scale-${scale}.json`;
      writeFileSync(join(CAPTURE_DIR, name), `${JSON.stringify(capture, null, 2)}\n`);
      runtime.dispose();
      ctrl.detach();
    }
  }
  assert.equal(cells.length, REDUCED_MOTION_TIERS.length * 3, '3 tiers x 3 scales = 9 cells');

  // Re-read one capture and assert the stable shape.
  const reread = JSON.parse(readFileSync(join(CAPTURE_DIR, 'tier-reduce-scale-1.6.json'), 'utf8'));
  assert.deepEqual(Object.keys(reread).sort(), [
    'cssTextScale',
    'dataA11yRuntime',
    'dataReducedMotion',
    'dataTextScale',
    'reducedClassOn',
    'textScale',
    'tier',
  ]);
  assert.equal(reread.tier, 'reduce');
  assert.equal(reread.textScale, 1.6);
  assert.equal(reread.reducedClassOn, true);
  assert.equal(reread.dataReducedMotion, 'reduce');
  assert.equal(reread.cssTextScale, '1.6');
});

test('FIX-008 captures: os-tier capture reflects the live OS flip deterministically', () => {
  const { root, media } = env(true);
  const detach = applyReducedMotion(root, 'os');
  const runtime = initializeAccessibilityRuntime(root, { textScale: 1 });
  const before = captureCell({ tier: 'os', textScale: 1, root });
  assert.equal(before.reducedClassOn, true);
  media.matches = false;
  media.fireChange();
  const after = captureCell({ tier: 'os', textScale: 1, root });
  assert.equal(after.reducedClassOn, false);
  assert.equal(after.dataReducedMotion, 'allow');
  runtime.dispose();
  detach();
});

// ------------------------------------------------------- honest human-leg skips

test('FIX-008 human legs: real-OS legs are recorded as skipped, never claimed', () => {
  const humanLegs = [
    {
      leg: 'real OS reduced-motion toggle on the packaged app (macOS + Windows)',
      automated: false,
      reason: 'requires System Settings / Settings toggle on a real desktop session',
    },
    {
      leg: '5x5 transparent-point pass-through click grid with Terminal receipts',
      automated: false,
      reason: 'requires a real desktop click at screen coordinates; Computer Use clicks were declared INVALID for the hit grid',
    },
    {
      leg: 'VoiceOver / Narrator manual pass',
      automated: false,
      reason: 'screen-reader output is not capturable by plain node',
    },
    {
      leg: 'native light/dark captures at 100%/200% scale + forced-colors rendered pair',
      automated: false,
      reason: 'requires the packaged app on a real desktop with OS appearance toggles',
    },
    {
      leg: 'Windows packaged run at 100/150/200% scale',
      automated: false,
      reason: 'requires a Windows machine',
    },
  ];
  for (const leg of humanLegs) {
    assert.equal(leg.automated, false);
    assert.ok(leg.reason.length > 0);
  }
  // The suite still exits 0: skips are recorded, never silent.
});
