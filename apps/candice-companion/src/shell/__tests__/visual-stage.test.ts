/** Visual composition contract tests (FIX-006). */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AssetManifestError, AssetRegistry } from '../../../assets/candice/loader.ts';
import {
  CANONICAL_IDLE_ASSET_ID,
  resolveCanonicalIdle,
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
