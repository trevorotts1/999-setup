/**
 * Face (bust) stage — surface tests.
 *
 * These are DELIVERY tests, deliberately. FIX-005 passed QC on artifacts and
 * unit tests while nothing ever mounted its layers: `viseme/layers.ts` was
 * imported only by its own barrel, and `[data-candice-eye]` /
 * `[data-candice-head]` were queried by the driver but created by nobody.
 * A test that only checked the registration record would have stayed green
 * through all of that.
 *
 * So each test below mounts the real surface and asserts what actually
 * reached the DOM: the elements exist, they carry the registered rects, the
 * paint order matches the build record, and the bust only takes over when it
 * is supposed to.
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/shell/__tests__/face-stage.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import registration from '../../../assets/candice/layers/build/registration.json' with { type: 'json' };
import { REDUCED_MOTION_CLASS } from '../../animation/gesture/config.ts';
import {
  FACE_BASE_ATTR,
  FACE_BODY_ATTR,
  FACE_EYE_ATTR,
  FACE_HEAD_ATTR,
  FACE_MOUTH_ATTR,
  FACE_STAGE_ATTR,
  mountFaceStage,
} from '../face-stage.ts';

// -------------------------------------------------------------- tiny fake DOM

class FakeEl {
  attributes = new Map<string, string>();
  children: FakeEl[] = [];
  tagName: string;
  className = '';
  src = '';
  alt = '';
  decoding = '';
  hidden = false;
  textContent = '';
  ownerDocument: { documentElement: FakeEl } | null = null;
  private classes = new Set<string>();

  constructor(tagName: string) {
    this.tagName = tagName;
  }
  setAttribute(n: string, v: string): void {
    this.attributes.set(n, v);
  }
  getAttribute(n: string): string | null {
    return this.attributes.get(n) ?? null;
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  remove(): void {}
  get classList() {
    return {
      add: (c: string) => this.classes.add(c),
      remove: (c: string) => this.classes.delete(c),
      contains: (c: string) => this.classes.has(c),
    };
  }
  /** Depth-first search by bare attribute selector, e.g. `[data-x]`. */
  find(attr: string): FakeEl | null {
    if (this.attributes.has(attr)) return this;
    for (const c of this.children) {
      const hit = c.find(attr);
      if (hit) return hit;
    }
    return null;
  }
}

function makeDoc() {
  const html = new FakeEl('html');
  const styles: FakeEl[] = [];
  const doc = {
    documentElement: html,
    createElement: (t: string) => new FakeEl(t),
    getElementById: (id: string) => styles.find((s) => s.getAttribute('id') === id) ?? null,
    head: { appendChild: (n: unknown) => styles.push(n as FakeEl) },
  };
  return { doc, html, styles };
}

/**
 * Stand-in for what Vite emits: hashed, bundled URLs keyed by module path.
 * Injected because `import.meta.glob` has no runtime form outside a Vite
 * build — the same reason the gesture stage has never been testable.
 */
const FAKE_LAYER_URLS: Record<string, string> = Object.fromEntries(
  [
    'base-neutral',
    'eye-open',
    'eye-half',
    'eye-closed',
    'mouth-neutral-closed',
    'mouth-open-small',
    'mouth-open-medium',
    'mouth-open-wide',
    'mouth-smile-closed',
    'mouth-smile-open',
  ].map((n) => [
    `../../assets/candice/layers/assets/${n}.png`,
    `/assets/${n}-BUNDLEDHASH.png`,
  ]),
);

function mount(reduced = false) {
  const { doc, html, styles } = makeDoc();
  if (reduced) html.classList.add(REDUCED_MOTION_CLASS);
  const character = new FakeEl('div');
  character.ownerDocument = { documentElement: html };
  const host = mountFaceStage({
    document: doc as never,
    character: character as never,
    layerUrls: FAKE_LAYER_URLS,
  });
  return { host, character, html, styles };
}

// ------------------------------------------------------------------- the tests

test('face stage creates the motion targets the driver has been querying', () => {
  const { host, character } = mount();
  assert.notEqual(host.element, null, 'face stage failed to mount');

  const stage = character.find(FACE_STAGE_ATTR);
  assert.ok(stage, `no [${FACE_STAGE_ATTR}] container reached the DOM`);

  // These two are the whole point: driver.ts:194 and :223 have been
  // querying for them against an empty tree every frame.
  assert.ok(character.find(FACE_EYE_ATTR), `no [${FACE_EYE_ATTR}] — blink has no target`);
  assert.ok(character.find(FACE_HEAD_ATTR), `no [${FACE_HEAD_ATTR}] — head drift has no target`);
  assert.ok(character.find(FACE_MOUTH_ATTR), `no [${FACE_MOUTH_ATTR}] — viseme has no target`);
  assert.ok(character.find(FACE_BASE_ATTR), `no [${FACE_BASE_ATTR}] — nothing to composite onto`);
});

test('mouth and eye carry their REGISTERED rects, as canvas percentages', () => {
  const { character } = mount();
  const [cw, ch] = (registration as { baseCanvas: number[] }).baseCanvas as [number, number];
  const reg = registration as { mouthRect: number[]; eyeRect: number[] };

  for (const [attr, rect] of [
    [FACE_MOUTH_ATTR, reg.mouthRect],
    [FACE_EYE_ATTR, reg.eyeRect],
  ] as const) {
    const el = character.find(attr);
    assert.ok(el, `missing ${attr}`);
    const style = el.getAttribute('style') ?? '';
    const [x0, y0, x1, y1] = rect as [number, number, number, number];
    const want = {
      left: ((x0 / cw) * 100).toFixed(4),
      top: ((y0 / ch) * 100).toFixed(4),
      width: (((x1 - x0) / cw) * 100).toFixed(4),
      height: (((y1 - y0) / ch) * 100).toFixed(4),
    };
    for (const [prop, value] of Object.entries(want)) {
      assert.ok(
        style.includes(`${prop}:${value}%`),
        `${attr} ${prop} must be the registered ${value}% — got style "${style}"`,
      );
    }
  }
});

test('paint order matches the build record zOrder (base, mouth, eye)', () => {
  const { character } = mount();
  const head = character.find(FACE_HEAD_ATTR);
  assert.ok(head);
  const order = head.children.map((c) =>
    c.attributes.has(FACE_BASE_ATTR)
      ? 'base'
      : c.attributes.has(FACE_MOUTH_ATTR)
        ? 'mouth'
        : c.attributes.has(FACE_EYE_ATTR)
          ? 'eye'
          : 'other',
  );
  assert.deepEqual(order, ['base', 'mouth', 'eye'], 'eye must paint last or a blink is hidden');
});

test('every layer resolves to a BUNDLED url, never a repo path', () => {
  const { character } = mount();
  for (const attr of [FACE_BASE_ATTR, FACE_MOUTH_ATTR, FACE_EYE_ATTR]) {
    const el = character.find(attr);
    assert.ok(el, `missing ${attr}`);
    assert.notEqual(el.src, '', `${attr} has no src`);
    // The gesture poses 404'd for exactly this reason: a manifest path is
    // not a bundled asset and does not exist inside the .app.
    assert.ok(
      !el.src.includes('assets/candice/layers/assets/'),
      `${attr} is using a repo path (${el.src}) — it will 404 in the package`,
    );
  }
});

test('bust takes over ONLY on speaking, and returns to the body after', () => {
  const { host } = mount();
  assert.equal(host.visible, false, 'must start on the body pose');

  host.setStatus('idle');
  assert.equal(host.visible, false, 'idle must hold the body pose');

  host.setStatus('listening');
  assert.equal(host.visible, false, 'listening must hold the body pose');

  host.setStatus('speaking');
  assert.equal(host.visible, true, 'speaking must show the bust');

  host.setStatus('thinking');
  assert.equal(host.visible, false, 'must return to the body when speech ends');
});

test('reduced motion holds the body pose — the bust never takes over', () => {
  const { host } = mount(true);
  host.setStatus('speaking');
  assert.equal(
    host.visible,
    false,
    'under reduced motion / animation-off the body pose must be held',
  );
});

test('mouth and eye swaps change the image and never the geometry', () => {
  const { character, host } = mount();
  const mouth = character.find(FACE_MOUTH_ATTR)!;
  const eye = character.find(FACE_EYE_ATTR)!;
  const mouthGeom = mouth.getAttribute('style');
  const eyeGeom = eye.getAttribute('style');
  const mouthBefore = mouth.src;

  host.setMouthState('open-wide');
  host.setEyeState('closed');

  assert.notEqual(mouth.src, mouthBefore, 'mouth image did not change');
  assert.equal(mouth.getAttribute('style'), mouthGeom, 'mouth rect moved — tolerance is zero');
  assert.equal(eye.getAttribute('style'), eyeGeom, 'eye rect moved — tolerance is zero');
});

test('unknown states are ignored and never throw (spec 20)', () => {
  const { character, host } = mount();
  const mouth = character.find(FACE_MOUTH_ATTR)!;
  const before = mouth.src;
  assert.doesNotThrow(() => host.setMouthState('not-a-real-viseme'));
  assert.doesNotThrow(() => host.setEyeState('winking'));
  assert.equal(mouth.src, before, 'an unknown state must leave the last good image up');
});

test('the bust BREATHES — it carries the driver idle-loop target', () => {
  const { character } = mount();
  const body = character.find(FACE_BODY_ATTR);
  assert.ok(
    body,
    `no [${FACE_BODY_ATTR}] on the bust — she freezes the moment she starts speaking`,
  );
  // The bust must sit inside it, or the scale reaches nothing visible.
  assert.ok(body.find(FACE_EYE_ATTR), 'the face layers must be inside the breath wrapper');
});

test('breath and drift targets are NEVER the same node', () => {
  const { character } = mount();

  // Both driver loops assign `style.transform` outright — breath writes
  // `scale(...)`, drift writes `translateX(...)`. Sharing a node makes them
  // clobber each other last-writer-wins, and it fails INTERMITTENTLY with
  // loop interleaving, which presents as "the drift randomly stopped".
  // Collapsing these back into one element is the obvious-looking
  // simplification; this test exists to stop it.
  const walk = (el: FakeEl): FakeEl[] => [el, ...el.children.flatMap(walk)];
  for (const el of walk(character)) {
    const isBody = el.attributes.has(FACE_BODY_ATTR);
    const isHead = el.attributes.has(FACE_HEAD_ATTR);
    assert.ok(
      !(isBody && isHead),
      'one element carries BOTH transform targets — the two driver loops will clobber each other',
    );
  }

  // And prove the nesting is real, not two unrelated siblings.
  const body = character.find(FACE_BODY_ATTR)!;
  assert.ok(body.find(FACE_HEAD_ATTR), 'the drift node must nest inside the breath node');
});

test('REFUSES eye states whose art is not operator-approved', () => {
  const { character, host } = mount();
  const eye = character.find(FACE_EYE_ATTR)!;
  const approved = eye.src;

  // eye-half and eye-closed are `synthesized: true, approval:
  // pending-operator` in the build manifest. They ARE bundled — the glob
  // supplies a URL for all ten layers — so a URL existing proves nothing.
  // The manifest is the approval authority.
  for (const pending of ['half', 'closed']) {
    host.setEyeState(pending);
    assert.equal(
      eye.src,
      approved,
      `setEyeState('${pending}') mounted art the operator never approved`,
    );
  }
});

test('the refusal is reported, and names approval as the reason', () => {
  const { doc, html } = makeDoc();
  const character = new FakeEl('div');
  character.ownerDocument = { documentElement: html };
  const errors: string[] = [];
  const host = mountFaceStage({
    document: doc as never,
    character: character as never,
    layerUrls: FAKE_LAYER_URLS,
    reportLayerError: (s) => errors.push(s),
  });
  errors.length = 0;
  host.setEyeState('half');
  assert.equal(errors.length, 1, 'a refused state must be reported, not swallowed');
  assert.match(
    errors[0]!,
    /not-operator-approved/,
    `refusal must name approval as the cause, got "${errors[0]}"`,
  );
});

test('approved states still mount — the gate is not a blanket refusal', () => {
  const { character, host } = mount();
  const eye = character.find(FACE_EYE_ATTR)!;
  const mouth = character.find(FACE_MOUTH_ATTR)!;

  // A control: without this, a gate that refused EVERYTHING would pass the
  // two tests above and quietly leave her faceless.
  assert.notEqual(eye.src, '', 'the approved eye/open must mount');
  assert.notEqual(mouth.src, '', 'the approved mouth must mount');

  for (const state of ['open-small', 'open-medium', 'open-wide', 'smile-closed', 'smile-open']) {
    const before = mouth.src;
    host.setMouthState(state);
    assert.notEqual(mouth.src, before, `approved mouth state '${state}' was wrongly refused`);
  }
});

test('an unusable DOM yields an inert host rather than throwing', () => {
  assert.doesNotThrow(() => {
    const host = mountFaceStage({ document: null as never, character: null as never });
    host.setStatus('speaking');
    assert.equal(host.visible, false);
    assert.equal(host.element, null);
    host.destroy();
  });
});

// ------------------------------------------- the three silent mount-time exits
//
// `reportLayerError` is only consulted inside `swap()`, which runs AFTER
// mount. So every mount-time `return inert` reported NOTHING: the bust was
// simply absent, with no record anywhere, while the body pose kept working —
// which reads as "the animation is fine". These three tests exist so that a
// future refactor cannot quietly restore the silence.

test('mount exit: an unusable DOM REPORTS rather than failing silently', () => {
  const seen: string[] = [];
  const host = mountFaceStage({
    document: null as never,
    character: null as never,
    reportLayerError: (s) => seen.push(s),
  });
  assert.equal(host.element, null, 'still fails closed to an inert host');
  assert.deepEqual(seen, ['mount:no-document'], 'the exit must name itself');
});

test('mount exit: a missing approved base REPORTS rather than failing silently', () => {
  const { doc } = makeDoc();
  const character = new FakeEl('div');
  const withoutBase = Object.fromEntries(
    Object.entries(FAKE_LAYER_URLS).filter(([k]) => !k.endsWith('/base-neutral.png')),
  );
  const seen: string[] = [];
  const host = mountFaceStage({
    document: doc as never,
    character: character as never,
    layerUrls: withoutBase,
    reportLayerError: (s) => seen.push(s),
  });
  assert.equal(host.element, null, 'still fails closed without approved base art');
  assert.deepEqual(seen, ['mount:no-approved-base'], 'the exit must name itself');
});

test('mount exit: a throw during DOM construction REPORTS its message', () => {
  const { doc } = makeDoc();
  const character = new FakeEl('div');
  const boom = {
    ...doc,
    createElement: (t: string) => {
      if (t === 'img') throw new Error('createElement exploded');
      return new FakeEl(t);
    },
  };
  const seen: string[] = [];
  const host = mountFaceStage({
    document: boom as never,
    character: character as never,
    layerUrls: FAKE_LAYER_URLS,
    reportLayerError: (s) => seen.push(s),
  });
  assert.equal(host.element, null, 'a throw still fails closed');
  assert.equal(seen.length, 1, 'exactly one report');
  assert.match(
    seen[0]!,
    /^mount:threw:createElement exploded$/,
    'the caught exception message must survive into the report, not be discarded',
  );
});
