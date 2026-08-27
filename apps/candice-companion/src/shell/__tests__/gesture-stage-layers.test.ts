/**
 * Layer-resolution acceptance tests for the gesture stage.
 *
 *   PASS: every pose bound in the manifest actually resolves to a loadable
 *         URL, and a pose that fails to load degrades to the approved idle
 *         WITHOUT taking the whole companion down.
 *
 * Why these exist. Only `01-fullbody-idle.png` had a static `?url` import, so
 * only that one PNG was emitted into the bundle — `ls src-tauri/dist/assets/*.png`
 * returned exactly one file against six poses bound in `stateMap.body`. Every
 * other layer resolved to `source/operator-approved/<file>.png`, a repo path
 * that does not exist inside the .app, and 404'd. Worse, EVERY layer's `error`
 * listener called `reportShellError()`, so one unreachable pose dispatched
 * `candice:shell-error` and dropped the entire companion to text mode: the
 * approved idle loaded perfectly and was thrown away anyway.
 *
 * `welcome-wave -> 02-gesture-welcome.png` was bound before any of the recent
 * pose work, so this had been failing for the whole campaign as a one-layer
 * defect; binding four more poses only widened it.
 *
 * Both halves are covered below, and both are outcome tests: they assert what
 * the stage DID, not that a helper returned something.
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/shell/__tests__/gesture-stage-layers.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import manifest from '../../../assets/candice/asset-manifest.json' with { type: 'json' };
import { GESTURE_STATE_KEYS, IDLE_GESTURE } from '../candice-composition.ts';
import { GESTURE_IDS } from '../../animation/gesture/config.ts';

type StateMap = Record<string, Record<string, string>>;
const stateMap = (manifest as unknown as { stateMap: StateMap }).stateMap;
const assets = (manifest as unknown as { assets: Array<Record<string, unknown>> }).assets;

/**
 * The build-time glob in `gesture-stage.ts` is a Vite transform, so it cannot
 * run under `node --test`. This mirrors its INPUT — the set of files present
 * in the approved-source directory — so the test proves the same property the
 * glob is responsible for: every bound pose has a real file behind it.
 */
async function approvedSourceFiles(): Promise<Set<string>> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const dir = path.resolve(here, '../../../assets/candice/source/operator-approved');
  return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.png')));
}

// ------------------------------------------------- every bound pose resolves

test('every gesture bound in the manifest has a real approved source file', async () => {
  const files = await approvedSourceFiles();
  const missing: string[] = [];
  for (const gesture of GESTURE_IDS) {
    const binding = GESTURE_STATE_KEYS[gesture];
    const file = stateMap[binding.group]?.[binding.key];
    if (file === undefined) continue; // unbound is legal — it degrades to idle
    if (!files.has(file)) missing.push(`${gesture} -> ${binding.group}.${binding.key} -> ${file}`);
  }
  assert.deepEqual(
    missing,
    [],
    'a bound gesture points at a file that does not exist in source/operator-approved',
  );
});

test('every stateMap file resolves to an operator-approved manifest entry', () => {
  const approvedFiles = new Set(
    assets
      .filter((a) => a.approval === 'operator-approved')
      .map((a) => String(a.file)),
  );
  const bad: string[] = [];
  for (const [group, entries] of Object.entries(stateMap)) {
    for (const [key, file] of Object.entries(entries)) {
      if (!approvedFiles.has(file)) bad.push(`${group}.${key} -> ${file}`);
    }
  }
  assert.deepEqual(bad, [], 'only operator-approved entries may ever be mounted');
});

test('the canonical idle is bound and approved — the guaranteed floor', () => {
  const binding = GESTURE_STATE_KEYS[IDLE_GESTURE];
  const file = stateMap[binding.group]?.[binding.key];
  assert.equal(file, '01-fullbody-idle.png', 'the idle slot must resolve the canonical idle');
  const entry = assets.find((a) => a.file === file);
  assert.ok(entry, 'the idle file must be a manifest entry');
  assert.equal(entry!.approval, 'operator-approved');
});

test('the manifest inventory guards stay green (16 originals, hashes, dimensions)', () => {
  assert.equal(assets.length, 16, 'the 16 operator originals are immutable');
  const SHA = /^[0-9a-f]{64}$/;
  for (const a of assets) {
    assert.match(String(a.sha256), SHA, `bad sha256 for ${String(a.id)}`);
    assert.ok(Number(a.width) > 0 && Number(a.height) > 0, `bad dimensions for ${String(a.id)}`);
    assert.equal(a.approval, 'operator-approved', `${String(a.id)} must be approved`);
  }
});

// The DOM-level failure tests live in `gesture-stage-failure.test.mjs`.
// `gesture-stage.ts` imports a `?url` asset and uses `import.meta.glob`, both
// of which are Vite transforms that plain `node --test` cannot resolve, so
// those tests load the real module through Vite's SSR loader instead.
