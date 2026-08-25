/** Visual composition contract tests (FIX-006, FIX-016). */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AssetManifestError, AssetRegistry } from '../../../assets/candice/loader.ts';
import { GESTURE_IDS } from '../../animation/gesture/index.ts';
import { createCandiceStateMachine } from '../../state/machine.ts';
import {
  bindStatusFlow,
  CANONICAL_IDLE_ASSET_ID,
  GESTURE_STATE_KEYS,
  IDLE_GESTURE,
  resolveCanonicalIdle,
  resolveGestureEntry,
  type GestureStageHost,
} from '../candice-composition.ts';
import { dismissBootSurface } from '../boot-surface.ts';

test('a mounted visual stage removes the first-paint boot surface', () => {
  let removed = false;
  const root = {
    querySelector: (selector: string) => selector === '.boot'
      ? { remove: () => { removed = true; } }
      : null,
  } as unknown as HTMLElement;

  dismissBootSurface(root);
  assert.equal(removed, true);
});

test('the initial composition resolves the canonical operator-approved idle image', () => {
  const entry = resolveCanonicalIdle();
  assert.equal(entry.id, CANONICAL_IDLE_ASSET_ID);
  assert.equal(entry.file, '01-fullbody-idle.png');
  assert.equal(entry.approval, 'operator-approved');
  assert.equal(entry.role, 'body/idle-standing');
});

test('the composition refuses a substituted or unapproved idle mapping', () => {
  const registry = {
    resolve: () => ({
      id: CANONICAL_IDLE_ASSET_ID,
      role: 'body/idle-standing',
      approval: 'unapproved',
    }),
  } as unknown as Pick<AssetRegistry, 'resolve'>;

  assert.throws(
    () => resolveCanonicalIdle(registry),
    AssetManifestError,
  );
});

// ------------------------------------------------------------- FIX-016 contract

test('FIX-016: every canonical gesture id has a manifest stateMap binding slot', () => {
  for (const id of GESTURE_IDS) {
    const binding = GESTURE_STATE_KEYS[id];
    assert.ok(binding, `gesture ${id} must have a stateMap binding`);
    assert.equal(binding.group, 'body', `gesture ${id} binds to a body layer`);
    assert.match(binding.key, /^[a-z][a-z-]*$/, 'manifest key shape');
  }
});

test('FIX-016: the idle fallback gesture binds to the approved idle asset', () => {
  assert.equal(IDLE_GESTURE, 'welcome');
  assert.equal(GESTURE_STATE_KEYS[IDLE_GESTURE].key, 'idle-standing');
  const entry = resolveCanonicalIdle();
  assert.equal(entry.id, CANONICAL_IDLE_ASSET_ID);
});

test('FIX-016: every bound pose resolves to its exact approved asset', () => {
  // These four were `pose/unresolved` for the whole campaign, so this test
  // asserted they resolve to NULL — encoding "not yet bound" as if it were
  // "must never be bound". The bindings are now made (operator-delegated;
  // see assets/candice/source/operator-approved/README.md), so the guard is
  // restated as what it was always protecting: a pose resolves to its exact
  // approved asset, or to nothing. Never to a substitute.
  const registry = AssetRegistry.create();
  const bound = {
    presenting: '14-presenting-twohands',
    thinking: '16-presenting-standing-b',
    listening: '10-presenting-portrait-a',
    affirmative: '12-presenting-fullbody-a',
  } as const;
  const seen = new Set<string>();
  for (const [gesture, assetId] of Object.entries(bound)) {
    const entry = resolveGestureEntry(registry, gesture as keyof typeof bound);
    assert.ok(entry, `${gesture} must resolve to its bound layer`);
    assert.equal(entry?.id, assetId, `${gesture} must resolve to exactly ${assetId}`);
    assert.equal(entry?.approval, 'operator-approved');
    assert.ok(entry?.role.startsWith('body/'), `${gesture} must carry a body role`);
    seen.add(entry!.id);
  }
  assert.equal(seen.size, 4, 'each state gets its OWN artwork, not four aliases of one image');

  const idle = resolveGestureEntry(registry, IDLE_GESTURE);
  assert.ok(idle, 'the welcome slot resolves the approved idle');
  assert.equal(idle?.id, CANONICAL_IDLE_ASSET_ID);
  assert.equal(idle?.approval, 'operator-approved');
  assert.ok(!seen.has(idle!.id), 'the idle layer is distinct from every bound pose');
});

test('FIX-016: a pose with no binding still resolves to null, never to a substitute', () => {
  // The anti-fabrication guard, kept live against art that is deliberately
  // still unbound: 13-multipose-sheet (a contact sheet, never a runtime
  // asset) and 15-presenting-standing-a (indistinguishable from 10 and 12).
  const registry = AssetRegistry.create();
  const unbound = {
    resolve: () => { throw new Error('unknown state key: body.unbound-pose'); },
  } as unknown as AssetRegistry;
  assert.equal(
    resolveGestureEntry(unbound, 'listening'),
    null,
    'an absent binding degrades to null, never to the nearest available art',
  );
  const stillUnresolved = registry.list().filter((a) => a.role === 'pose/unresolved');
  assert.deepEqual(
    stillUnresolved.map((a) => a.id).sort(),
    ['13-multipose-sheet', '15-presenting-standing-a'],
    'exactly the two deliberately unbound assets remain unresolved',
  );
});

test('FIX-016: an unapproved or non-body binding never becomes a gesture layer', () => {
  const unapproved = {
    resolve: () => ({
      id: 'some-pose',
      role: 'body/listening-pose',
      approval: 'unapproved',
    }),
  } as unknown as AssetRegistry;
  assert.equal(resolveGestureEntry(unapproved, 'listening'), null, 'unapproved art rejected');

  const faceRole = {
    resolve: () => ({
      id: 'some-face',
      role: 'face/mouth-open',
      approval: 'operator-approved',
    }),
  } as unknown as AssetRegistry;
  assert.equal(resolveGestureEntry(faceRole, 'listening'), null, 'face layers are not body gestures');
});

test('FIX-016: bindStatusFlow repaints only on real transitions and unbinds cleanly', () => {
  const machine = createCandiceStateMachine();
  const seen: string[] = [];
  const host: GestureStageHost = {
    setStatus: (status) => { seen.push(status); },
    detach: () => undefined,
    driver: null as unknown as GestureStageHost['driver'],
    faceStage: null as unknown as GestureStageHost['faceStage'],
  };

  const unbind = bindStatusFlow(machine, host);
  assert.deepEqual(seen, ['idle'], 'initial status applied on bind');

  machine.transition({ type: 'ptt:start' });
  assert.deepEqual(seen, ['idle', 'listening'], 'real transition repaints');

  machine.transition({ type: 'ptt:start' });
  assert.deepEqual(seen, ['idle', 'listening'], 'ignored transition never repaints');

  unbind();
  machine.transition({ type: 'ptt:stop' });
  assert.deepEqual(seen, ['idle', 'listening'], 'unbind restores the original transition');
});

test('FIX-016: a status resolves to approved art or to the idle layer, never placeholder art', () => {
  // Same restatement as above: this passed trivially while all four poses
  // resolved to null. It now proves the real property — whatever a status
  // resolves to is operator-approved art carrying a body role, and anything
  // that resolves to nothing degrades to the approved idle rather than to
  // invented or substituted art.
  const registry = AssetRegistry.create();
  const idle = resolveGestureEntry(registry, IDLE_GESTURE);
  assert.ok(idle);
  for (const gesture of ['listening', 'thinking', 'presenting', 'affirmative'] as const) {
    const layer = resolveGestureEntry(registry, gesture);
    if (layer === null) continue; // degrades to the approved idle at mount time
    assert.equal(layer.approval, 'operator-approved', `${gesture} layer must be approved`);
    assert.ok(layer.role.startsWith('body/'), `${gesture} layer must carry a body role`);
    assert.match(layer.file, /^[0-9]{2}-[a-z0-9-]+\.png$/, 'a canonical source file, never a derivative');
  }
});
