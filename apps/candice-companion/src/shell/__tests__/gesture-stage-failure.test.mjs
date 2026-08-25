/**
 * Layer-failure behaviour of the gesture stage — the regression guard for the
 * catastrophic half of the bundling bug.
 *
 *   PASS: a pose whose image fails to load degrades to the approved idle and
 *         does NOT dispatch `candice:shell-error`. Only the IDLE layer failing
 *         reports, because that is the one case where there is no character.
 *
 * The old behaviour wired EVERY layer's `error` listener to `reportShellError()`.
 * Combined with only one PNG being emitted into the bundle, a single 404 on a
 * pose dropped the entire companion into text mode — the approved idle had
 * loaded perfectly and was thrown away anyway. This file exists so that cannot
 * come back silently.
 *
 * `gesture-stage.ts` imports a `?url` asset and calls `import.meta.glob`, which
 * are Vite transforms. Plain `node --test` cannot resolve either, so the REAL
 * module is loaded through Vite's SSR loader — no re-implementation, no stub of
 * the code under test.
 *
 *   node --test apps/candice-companion/src/shell/__tests__/gesture-stage-failure.test.mjs
 */

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import * as path from 'node:path';
import * as url from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '../../..');

let server;
let mountGestureStage;
let AssetRegistry;
let IDLE_GESTURE;

before(async () => {
  server = await createServer({
    configFile: false,
    root: appRoot,
    // `watch: null` is load-bearing, not tidiness. Vite's file watcher keeps
    // open handles that outlive `server.close()`, so the test process sat
    // alive for ~90s after the last assertion and only ended on the runner's
    // timeout — which reads as a failing suite in CI even when every test
    // passed. Disabling the watcher lets the process exit immediately.
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    logLevel: 'silent',
  });
  ({ mountGestureStage } = await server.ssrLoadModule('/src/shell/gesture-stage.ts'));
  ({ AssetRegistry } = await server.ssrLoadModule('/assets/candice/loader.ts'));
  ({ IDLE_GESTURE } = await server.ssrLoadModule('/src/shell/candice-composition.ts'));
});

after(async () => {
  await server?.close();
});

// -------------------------------------------------------------- tiny fake DOM

class FakeElement {
  attributes = new Map();
  children = [];
  listeners = new Map();
  parent = null;
  dataset = {};
  style = {};
  className = '';
  id = '';
  alt = '';
  decoding = '';
  src = '';
  hidden = false;
  textContent = '';
  #classes = new Set();

  constructor(tagName) {
    this.tagName = tagName;
  }
  setAttribute(n, v) {
    this.attributes.set(n, String(v));
  }
  getAttribute(n) {
    return this.attributes.get(n) ?? null;
  }
  get classList() {
    return {
      add: (c) => this.#classes.add(c),
      remove: (c) => this.#classes.delete(c),
      toggle: (c, on) => (on ? this.#classes.add(c) : this.#classes.delete(c)),
      contains: (c) => this.#classes.has(c),
    };
  }
  append(...nodes) {
    for (const n of nodes) {
      n.parent = this;
      this.children.push(n);
    }
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type, fn) {
    const l = this.listeners.get(type) ?? [];
    l.push(fn);
    this.listeners.set(type, l);
  }
  /** Fire the listener the browser would fire on a 404. */
  fire(type) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  querySelector(sel) {
    const m = /^\[([^\]]+)\]$/.exec(sel);
    if (!m) return null;
    return this.children.find((c) => c.attributes.has(m[1])) ?? null;
  }
  querySelectorAll(sel) {
    const m = /^\[([^\]]+)\]$/.exec(sel);
    if (!m) return [];
    return this.children.filter((c) => c.attributes.has(m[1]));
  }
  get parentElement() {
    return this.parent;
  }
  get ownerDocument() {
    return { documentElement: new FakeElement('html') };
  }
}

/** Mount the real stage over a fake DOM; images never load on their own here. */
function mountFakeStage() {
  const character = new FakeElement('div');
  character.setAttribute('data-candice-gesture-stage', '');
  const doc = {
    createElement: (tag) => new FakeElement(tag),
    getElementById: () => null,
  };
  const shellErrors = [];
  const registry = AssetRegistry.create((src) => {
    const img = new FakeElement('img');
    img.src = src;
    return img;
  });
  const host = mountGestureStage({
    document: doc,
    character,
    registry,
    reportShellError: () => shellErrors.push(1),
  });
  return { character, host, shellErrors };
}

const layersOf = (character) =>
  character.children.filter((c) => c.getAttribute('data-candice-gesture') !== null);
const nonIdleLayer = (character) =>
  layersOf(character).find((c) => c.getAttribute('data-candice-gesture') !== IDLE_GESTURE);
const idleLayer = (character) =>
  layersOf(character).find((c) => c.getAttribute('data-candice-gesture') === IDLE_GESTURE);

// ----------------------------------------------------------------- the mount

test('the stage mounts a layer for every bound pose, not just the idle', () => {
  const { character, host } = mountFakeStage();
  const mounted = layersOf(character).map((c) => c.getAttribute('data-candice-gesture'));
  assert.ok(mounted.includes(IDLE_GESTURE), 'the approved idle must always mount');
  assert.ok(
    mounted.length > 1,
    `only ${mounted.length} layer mounted — bound poses are not reaching the stage`,
  );
  assert.equal(
    Number(character.dataset.candiceGestureLayers),
    mounted.length,
    'the published layer count must match what is actually in the DOM',
  );
  assert.equal(character.dataset.candiceGestureFailed, undefined, 'nothing failed yet');
  host.detach();
});

test('every mounted layer resolves to a real URL, never the unbundled source path', () => {
  const { character, host } = mountFakeStage();
  const unbundled = layersOf(character)
    .map((c) => c.src)
    .filter((src) => src.startsWith('source/operator-approved/'));
  assert.deepEqual(
    unbundled,
    [],
    'a layer still points at the repo source path, which does not exist inside the .app',
  );
  host.detach();
});

// ------------------------------------------- a failed pose must not kill the app

test('a non-idle layer failing does NOT dispatch a shell error', () => {
  const { character, host, shellErrors } = mountFakeStage();
  const layer = nonIdleLayer(character);
  assert.ok(layer, 'at least one non-idle pose must be bound for this test to mean anything');
  const before = Number(character.dataset.candiceGestureLayers);

  layer.fire('error');

  assert.deepEqual(
    shellErrors,
    [],
    'a missing POSE must degrade to the approved idle, never drop the companion to text mode',
  );
  assert.equal(character.dataset.candiceGestureMounted, 'true', 'the character stays mounted');
  assert.equal(
    Number(character.dataset.candiceGestureLayers),
    before - 1,
    'the failed layer must leave the mounted set',
  );
  assert.ok(
    (character.dataset.candiceGestureFailed ?? '').includes(
      layer.getAttribute('data-candice-gesture'),
    ),
    'the failure must be published as evidence, not silently swallowed',
  );
  assert.ok(idleLayer(character), 'the approved idle layer is still there');
  host.detach();
});

test('a pose that fails while it is ON SCREEN falls back to the approved idle', () => {
  const { character, host, shellErrors } = mountFakeStage();
  const layer = nonIdleLayer(character);
  const gesture = layer.getAttribute('data-candice-gesture');

  // Worst case: the broken layer is the one currently displayed.
  character.setAttribute('data-candice-gesture-active', gesture);
  layer.fire('error');

  assert.deepEqual(shellErrors, [], 'still no shell error');
  assert.equal(
    character.getAttribute('data-candice-gesture-active'),
    IDLE_GESTURE,
    'the visible layer must fall back to the approved idle, not stay on a broken image',
  );
  host.detach();
});

test('every non-idle pose failing still leaves a working character', () => {
  const { character, host, shellErrors } = mountFakeStage();
  for (const layer of [...layersOf(character)]) {
    if (layer.getAttribute('data-candice-gesture') !== IDLE_GESTURE) layer.fire('error');
  }
  assert.deepEqual(shellErrors, [], 'losing every pose is a degraded look, not a dead companion');
  assert.equal(Number(character.dataset.candiceGestureLayers), 1, 'only the idle remains');
  assert.ok(idleLayer(character), 'and it is the approved idle');
  assert.equal(character.dataset.candiceGestureMounted, 'true');
  host.detach();
});

// ------------------------------------------------- the one case that must report

test('the IDLE layer failing IS a shell error — there is no character without it', () => {
  const { character, host, shellErrors } = mountFakeStage();
  const idle = idleLayer(character);
  assert.ok(idle, 'the idle layer must be mounted');

  idle.fire('error');

  assert.equal(
    shellErrors.length,
    1,
    'losing the approved idle means no character at all — that must report',
  );
  host.detach();
});
