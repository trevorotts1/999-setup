import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseShellInfo,
  probeNativeShell,
  ShellHealthError,
} from '../boot-health.ts';

const healthyShell = {
  appVersion: '0.2.0',
  suppliedAssetCount: 16,
  windowVisible: true,
  shellReady: true,
  subsystems: ['shell', 'window-visibility', 'events'],
};

test('native shell probe accepts a complete ready response', async () => {
  const info = await probeNativeShell({
    invoke: async (command) => {
      assert.equal(command, 'cmd_get_shell_info');
      return healthyShell;
    },
  });

  assert.deepEqual(info, healthyShell);
});

test('native shell probe rejects an unavailable or malformed readiness response', async () => {
  await assert.rejects(
    () => probeNativeShell({ invoke: async () => ({ ...healthyShell, shellReady: false }) }),
    ShellHealthError,
  );
  await assert.rejects(
    () => probeNativeShell({ invoke: async () => { throw new Error('bridge unavailable'); } }),
    /native shell health probe failed: bridge unavailable/,
  );
  assert.throws(
    () => parseShellInfo({ ...healthyShell, subsystems: ['shell', 42] }),
    ShellHealthError,
  );
});
