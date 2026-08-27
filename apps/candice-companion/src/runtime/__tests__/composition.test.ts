/**
 * Runtime composition wiring guards.
 *
 * Run: node --test --experimental-strip-types \
 *        apps/candice-companion/src/runtime/__tests__/composition.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// ------------------------- "can she speak at all", not "is Kokoro ready"

/**
 * A gate that cancels the thing it was written to protect.
 *
 * `ttsAvailable` suppresses the speak attempt entirely when the machine
 * has no voice, so a Windows client is not told "Candice could not speak
 * this question aloud: <engine error>" once per question forever.
 *
 * It was computed from `ttsEngineReady` alone. Then the WR-016 system
 * voice landed, whose entire purpose is to speak when the Kokoro engine
 * is absent -- exactly the case where `ttsEngineReady` is false. So the
 * bridge would have returned BEFORE calling speak, and the fallback could
 * never run. The gate would have suppressed the capability added to fix
 * the situation the gate exists for.
 */
test('a machine with only the system voice is still allowed to speak', () => {
  const decide = (ttsEngineReady: boolean, systemTtsAvailable: boolean): boolean =>
    ttsEngineReady || systemTtsAvailable;

  assert.equal(decide(true, false), true, 'Kokoro only: speaks');
  assert.equal(decide(false, true), true, 'system voice only: must still speak');
  assert.equal(decide(true, true), true, 'both: speaks');
  assert.equal(decide(false, false), false, 'neither: stays quiet, as designed');
});

test('the composition really consults BOTH facts (source guard)', async () => {
  // The arithmetic above is trivially right; the risk is that the
  // composition stops asking one of the two questions. Read the source,
  // as consent.test.ts does for the same class of wiring bug.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'composition.ts'),
    'utf8',
  );
  assert.match(
    source,
    /ttsAvailable:[\s\S]{0,400}ttsEngineReady[\s\S]{0,120}systemTtsAvailable/,
    'ttsAvailable must consider the system voice, or WR-016 is unreachable',
  );
  assert.ok(source.length > 5000, 'CONTROL: composition.ts was actually read');
});
