import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildWakeRequest,
  commandFromHookPayload,
  dispatchWake,
  isMainModule,
  parseHookPayload,
  resolveLaunchCommand,
  SUPPORTED_COMMANDS,
} from '../wake-candice.mjs';

test('FIX-010: hook registration invokes the Node dispatcher for only supported commands', () => {
  const hooks = JSON.parse(readFileSync(new URL('../../hooks/hooks.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(hooks.hooks), ['UserPromptSubmit']);
  const hook = hooks.hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(hook.type, 'command');
  assert.equal(hook.command,
    'node "${CLAUDE_PLUGIN_ROOT}/bin/wake-candice.mjs" --from-prompt');
  assert.equal(Object.hasOwn(hook, 'args'), false,
    'Claude command hooks require the executable and arguments in command');
  assert.equal(Object.hasOwn(hook, 'async'), false,
    'wake dispatch must complete before slash-command preflight begins');
});

test('FIX-010: prompt hook extracts only supported leading commands', () => {
  assert.equal(commandFromHookPayload(JSON.stringify({
    prompt: '/spec-protocol I want to build something',
  })), '/spec-protocol');
  assert.equal(commandFromHookPayload(JSON.stringify({ prompt: '  /eli5 explain it' })), '/eli5');
  assert.equal(commandFromHookPayload(JSON.stringify({ prompt: '/ordinary hello' })), null);
  assert.equal(commandFromHookPayload(JSON.stringify({ prompt: 'mention /bro later' })), null);
  assert.equal(commandFromHookPayload('{'), null);
});

test('FIX-010: prompt hook recognizes Claude slash-command expansion envelope', () => {
  assert.equal(commandFromHookPayload(JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    prompt: '<command-message>spec-protocol</command-message>\n'
      + '<command-name>/spec-protocol</command-name>\n'
      + '<command-args>I want to build something</command-args>',
  })), '/spec-protocol');
  assert.equal(commandFromHookPayload(JSON.stringify({
    prompt: '<command-message>ordinary</command-message>\n'
      + '<command-name>/ordinary</command-name>',
  })), null);
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

test('FIX-010: installed app resolves without an interactive-shell PATH', () => {
  const mac = '/Users/test/Library/Application Support/BlackCEO/999/app/Candice Companion.app/Contents/MacOS/candice-companion';
  assert.equal(resolveLaunchCommand({
    env: { HOME: '/Users/test' },
    platform: 'darwin',
    exists: (candidate) => candidate === mac,
  }), mac);
  assert.equal(resolveLaunchCommand({
    env: { HOME: '/Users/test', CANDICE_COMPANION_CMD: '/custom/candice' },
    platform: 'darwin',
    exists: () => false,
  }), '/custom/candice');
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

test('FIX-010: main-module detection is URL-safe for installed paths containing spaces', () => {
  const installed = '/Users/test/Library/Application Support/BlackCEO/wake candice.mjs';
  assert.equal(isMainModule(pathToFileURL(installed).href, installed), true);
  assert.equal(isMainModule('file:///different/wake-candice.mjs', installed), false);
});
