import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildWakeRequest,
  dispatchWake,
  parseHookPayload,
  SUPPORTED_COMMANDS,
} from '../wake-candice.mjs';

test('FIX-010: hook registration invokes the Node dispatcher for only supported commands', () => {
  const hooks = JSON.parse(readFileSync(new URL('../../hooks/hooks.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(hooks.hooks), ['UserPromptExpansion']);
  const entries = hooks.hooks.UserPromptExpansion;
  assert.equal(entries.length, SUPPORTED_COMMANDS.length);
  assert.deepEqual(entries.map((entry) => `/${entry.matcher}`), SUPPORTED_COMMANDS);
  for (const entry of entries) {
    const hook = entry.hooks[0];
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, 'node');
    assert.equal(hook.async, true);
    assert.equal(hook.args[0], '${CLAUDE_PLUGIN_ROOT}/bin/wake-candice.mjs');
  }
});

test('FIX-010: dispatcher accepts bounded opaque metadata and ignores prompt content', () => {
  const parsed = parseHookPayload(JSON.stringify({
    session_id: 'session-42',
    event_id: 'event-9',
    terminal_id: 'host-7',
    prompt: 'never include this in a wake request',
    transcript_path: '/private/transcript',
  }));
  assert.deepEqual(parsed, {
    ok: true,
    sessionId: 'session-42',
    activationId: 'event-9',
    hostCorrelation: 'host-7',
  });
  assert.deepEqual(buildWakeRequest('/kaizen', parsed), {
    ok: true,
    version: '1.0',
    command: '/kaizen',
    sessionId: 'session-42',
    activationId: 'event-9',
    hostCorrelation: 'host-7',
  });
});

test('FIX-010: malformed hook input and unsupported commands are ignored fail-soft', () => {
  assert.deepEqual(parseHookPayload('{'), { ok: false, code: 'invalid-json' });
  assert.deepEqual(buildWakeRequest('/ordinary-prompt', parseHookPayload('')), {
    ok: false,
    code: 'unsupported-command',
  });
  assert.deepEqual(dispatchWake({ ok: false, code: 'invalid-json' }), {
    outcome: 'ignored',
    code: 'invalid-json',
  });
});

test('FIX-010: oversized and malformed identifiers never become routing metadata', () => {
  assert.deepEqual(parseHookPayload('x'.repeat(64 * 1024 + 1)), {
    ok: false,
    code: 'payload-too-large',
  });
  assert.deepEqual(parseHookPayload(JSON.stringify({
    session_id: 'unsafe value with whitespace',
    event_id: 'bad\nactivation',
    terminal_id: 'host-ok',
  })), {
    ok: true,
    sessionId: null,
    activationId: null,
    hostCorrelation: 'host-ok',
  });
});

test('FIX-010: visual wake does not forward unverified session or terminal identity', () => {
  const request = buildWakeRequest('/bro', parseHookPayload(JSON.stringify({
    sessionId: 'session-a', eventId: 'activation-a', terminalId: 'terminal-a',
  })));
  const calls = [];
  const result = dispatchWake(request, {
    launchCommand: '/opt/Candice Companion',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { once() {}, unref() {} };
    },
  });
  assert.deepEqual(result, { outcome: 'visual-wake-requested', command: '/bro' });
  assert.deepEqual(calls, [{
    command: '/opt/Candice Companion',
    args: ['--wake', '/bro'],
    options: { detached: true, shell: false, stdio: 'ignore', windowsHide: true },
  }]);
  assert.equal(calls[0].args.includes('--session-id'), false);
  assert.equal(calls[0].args.includes('--host-window'), false);
});

test('FIX-010: shipped routed launchers remain independent of Candice wake dispatch', () => {
  const mac = readFileSync(new URL('../../../../launchers/macos/claude-nine', import.meta.url), 'utf8');
  const windowsCmd = readFileSync(new URL('../../../../launchers/windows/claude-nine.cmd', import.meta.url), 'utf8');
  const windowsPs1 = readFileSync(new URL('../../../../launchers/windows/claude-nine.ps1', import.meta.url), 'utf8');
  for (const launcher of [mac, windowsCmd, windowsPs1]) {
    assert.equal(launcher.includes('wake-candice'), false,
      'model-routing launcher must not implement or bypass Candice wake dispatch');
    assert.equal(launcher.includes('CANDICE_COMPANION_CMD'), false,
      'launcher must not rewrite the companion launch target');
  }
});

test('FIX-010: legacy POSIX wrapper delegates without being required by native Windows registration', () => {
  const wrapper = readFileSync(new URL('../wake-candice.sh', import.meta.url), 'utf8');
  assert.match(wrapper, /exec node .*wake-candice\.mjs/);
  assert.match(wrapper, /--command "\$1"/);
});

test('FIX-010: legacy positional wrapper translates the command before dispatch', { skip: process.platform === 'win32' }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'candice-wrapper-'));
  const log = join(temp, 'args.log');
  const companion = join(temp, 'fake-companion');
  writeFileSync(companion, `#!/usr/bin/env sh\nprintf '%s\\n' "$@" > '${log}'\n`);
  chmodSync(companion, 0o700);
  try {
    const wrapper = new URL('../wake-candice.sh', import.meta.url).pathname;
    const result = spawnSync('bash', [wrapper, '/bro'], {
      input: '', encoding: 'utf8', env: { ...process.env, CANDICE_COMPANION_CMD: companion },
    });
    assert.equal(result.status, 0);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { readFileSync(log, 'utf8'); break } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['--wake', '/bro']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
