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

test('FIX-016: unresolved poses resolve to null, never to a substituted asset', () => {
  const registry = AssetRegistry.create();
  // listening/thinking/success poses have no approved mapping yet
  // (FIX-003 approval pending), so they must degrade to the idle layer.
  for (const gesture of ['listening', 'thinking', 'affirmative', 'presenting'] as const) {
    assert.equal(resolveGestureEntry(registry, gesture), null, `${gesture} must not resolve to art`);
  }
  const idle = resolveGestureEntry(registry, IDLE_GESTURE);
  assert.ok(idle, 'the welcome slot resolves the approved idle');
  assert.equal(idle?.id, CANONICAL_IDLE_ASSET_ID);
  assert.equal(idle?.approval, 'operator-approved');
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

test('FIX-016: every unresolved status falls back to the idle layer, never placeholder art', () => {
  const registry = AssetRegistry.create();
  const idle = resolveGestureEntry(registry, IDLE_GESTURE);
  assert.ok(idle);
  for (const gesture of ['listening', 'thinking', 'presenting', 'affirmative'] as const) {
    const layer = resolveGestureEntry(registry, gesture);
    assert.ok(layer === null || layer.id === idle!.id, 'fallback must be the approved idle');
  }
});
