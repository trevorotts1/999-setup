import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseRuntimeCapabilities,
  probeRuntimeCapabilities,
  RuntimeCapabilityError,
} from '../capabilities.ts';

const truthfulCapabilities = {
  contractVersion: '1.0',
  runtimeCompositionActive: true,
  wakeReceived: true,
  wakeCommand: '/spec-protocol',
  sessionBindingActive: false,
  bridgeAvailable: false,
  answerRoundTripAvailable: false,
  singleInstanceRoutingAvailable: false,
  rejectedLaunchReason: null,
};

test('runtime capability probe preserves unavailable bridge truth', async () => {
  const result = await probeRuntimeCapabilities({
    invoke: async (command) => {
      assert.equal(command, 'cmd_get_runtime_capabilities');
      return truthfulCapabilities;
    },
  });
  assert.deepEqual(result, truthfulCapabilities);
  assert.equal(result.answerRoundTripAvailable, false);
  assert.equal(result.sessionBindingActive, false);
});

test('runtime capability parser rejects false composition and malformed optional fields', () => {
  assert.throws(
    () => parseRuntimeCapabilities({ ...truthfulCapabilities, runtimeCompositionActive: false }),
    RuntimeCapabilityError,
  );
  assert.throws(
    () => parseRuntimeCapabilities({ ...truthfulCapabilities, wakeCommand: 42 }),
    RuntimeCapabilityError,
  );
});
