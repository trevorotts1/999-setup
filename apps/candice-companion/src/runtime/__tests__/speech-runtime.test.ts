import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SPEECH_COMMANDS,
  SPEECH_COMMAND_NAMES,
  type SpeechCommandName,
} from '../speech-commands.ts';
import {
  initializeSpeechRuntime,
  speechStatusText,
  voiceApprovalStatusText,
  type SpeechInvokeAdapter,
} from '../speech-runtime.ts';

const truthfulHealth = {
  contractVersion: '1.0',
  capabilities: {
    sttAvailable: false,
    ttsAvailable: false,
    systemTtsAvailable: true,
    duplexMounted: true,
    captureMounted: false,
    canonicalVoiceApproved: false,
  },
  sttRuntime: 'whisper.cpp',
  sttRuntimeVersion: '1.9.2',
  sttModel: 'ggml-tiny.en-q5_1.bin',
  sttModelSha256: 'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b',
  sttEngineReady: false,
  ttsEngineReady: false,
  ttsModel: 'kokoro-v1.0.fp16.onnx',
  ttsVoicepackRelease: 'model-files-v1.1',
  canonicalVoiceId: 'af_heart',
  canonicalVoiceApproval: 'approval-pending',
  degraded: false,
  degradedReason: null,
};

const truthfulPermissions = {
  microphone: 'not-determined',
  promptSource: 'ptt-only',
  explanation: 'Microphone permission is requested only when you press HOLD TO TALK.',
};

/**
 * QFIX Q-04 invoke contract: the Rust `invoke_handler` registration list in
 * `src-tauri/src/lib.rs` is truth. Parse the `speech::cmd_speech_*` entries
 * (the `speech_timing::cmd_speech_timing_*` trio is a different subsystem
 * and is deliberately excluded) and return the exact registered names.
 */
function rustSpeechCommandNames(): Set<string> {
  const libRs = readFileSync(
    new URL('../../../src-tauri/src/lib.rs', import.meta.url),
    'utf8',
  );
  const names = new Set<string>();
  for (const match of libRs.matchAll(/speech::(cmd_speech_\w+)/g)) {
    names.add(match[1]);
  }
  return names;
}

/**
 * A contract-accurate handler map: every name comes from the parsed Rust
 * registration list. Names outside the list are unknown commands and must
 * throw a visible error — the same behavior Tauri's invoke_handler has for
 * unregistered commands.
 */
function contractAdapter(
  handlers: Partial<Record<SpeechCommandName, (args?: Record<string, unknown>) => Promise<unknown>>>,
  registered: Set<string> = rustSpeechCommandNames(),
): SpeechInvokeAdapter {
  return {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
      if (!registered.has(command)) {
        return Promise.reject(new Error(`unknown speech command: ${command} (not in Rust invoke_handler)`));
      }
      const handler = handlers[command as SpeechCommandName];
      if (!handler) {
        return Promise.reject(new Error(`speech command ${command} registered but unavailable here`));
      }
      return handler(args);
    },
  };
}

test('speech command constants exactly match the Rust invoke_handler registration (Rust is truth)', () => {
  const rust = rustSpeechCommandNames();
  assert.ok(rust.size >= 7, `expected at least 7 speech commands in lib.rs, found ${rust.size}`);
  // Every TypeScript constant must be a registered Rust command name.
  for (const name of SPEECH_COMMAND_NAMES) {
    assert.ok(rust.has(name), `SPEECH_COMMANDS value ${name} is not registered in src-tauri/src/lib.rs`);
  }
  // Every registered speech command must exist in the constants module —
  // a Rust-side rename without a TypeScript-side rename cannot merge green.
  const expected = new Set(SPEECH_COMMAND_NAMES);
  const extra = [...rust].filter((name) => !expected.has(name as SpeechCommandName));
  assert.deepEqual(extra, [], 'Rust registers speech commands missing from SPEECH_COMMANDS');
  // Timing trio stays out of this module by design.
  for (const name of rust) {
    assert.ok(!name.startsWith('cmd_speech_timing'), `${name} belongs to the speech-timing subsystem`);
  }
});

test('speech runtime probe mounts duplex and reports native facts', async () => {
  const runtime = await initializeSpeechRuntime(
    contractAdapter({
      [SPEECH_COMMANDS.health]: async () => truthfulHealth,
      [SPEECH_COMMANDS.permissions]: async () => truthfulPermissions,
    }),
  );
  // Contract check through the runtime itself: the probe calls must have
  // used exactly the registered names, in the documented order.
  const recording: string[] = [];
  const recordingRuntime = await initializeSpeechRuntime({
    invoke: async (command) => {
      recording.push(command);
      if (command === SPEECH_COMMANDS.health) return truthfulHealth;
      if (command === SPEECH_COMMANDS.permissions) return truthfulPermissions;
      throw new Error(`unexpected command ${command}`);
    },
  });
  assert.deepEqual(recording, [SPEECH_COMMANDS.health, SPEECH_COMMANDS.permissions]);
  assert.equal(recordingRuntime.health?.canonicalVoiceApproval, 'approval-pending');
  assert.equal(runtime.health?.canonicalVoiceApproval, 'approval-pending');
  assert.equal(runtime.health?.capabilities.canonicalVoiceApproved, false);
  assert.equal(runtime.health?.capabilities.systemTtsAvailable, true);
  assert.equal(runtime.permissions?.microphone, 'not-determined');
  assert.equal(runtime.permissions?.promptSource, 'ptt-only');
  assert.equal(runtime.duplex.phase(), 'idle');
});

test('speech runtime fails closed when native boundary is absent', async () => {
  const runtime = await initializeSpeechRuntime({
    invoke: async () => {
      throw new Error('invoke unavailable');
    },
  });
  assert.equal(runtime.health, null);
  assert.equal(runtime.permissions, null);
  // Duplex controller still mounted: press/release remain deterministic
  // (typed answers and captions stay available — spec 20 fail closed).
  const press = runtime.duplex.press();
  assert.equal(press.event?.type, 'ptt:start');
  const release = runtime.duplex.release();
  assert.equal(release.event?.type, 'ptt:stop');
  assert.equal(runtime.duplex.phase(), 'idle');
});

test('malformed native health fails closed to unprobed, never invented', async () => {
  const runtime = await initializeSpeechRuntime({
    invoke: async (command) => (
      command === SPEECH_COMMANDS.health
        ? { ...truthfulHealth, capabilities: { ...truthfulHealth.capabilities, ttsAvailable: 'yes' } }
        : truthfulPermissions
    ),
  });
  assert.equal(runtime.health, null);
  assert.equal(runtime.permissions?.microphone, 'not-determined');
});

test('invoke contract: every SPEECH_COMMANDS name resolves against the Rust-derived handler map', async () => {
  const handlers: Partial<Record<SpeechCommandName, (args?: Record<string, unknown>) => Promise<unknown>>> = {
    [SPEECH_COMMANDS.health]: async () => truthfulHealth,
    [SPEECH_COMMANDS.permissions]: async () => truthfulPermissions,
    [SPEECH_COMMANDS.captureStart]: async (args) => {
      assert.ok(args?.requestId, 'captureStart must carry requestId');
      return args!.requestId as string;
    },
    [SPEECH_COMMANDS.captureStop]: async () => undefined,
    [SPEECH_COMMANDS.transcribe]: async (args) => ({
      requestId: args?.requestId,
      status: 'transcribed',
      text: 'contract transcript',
    }),
    [SPEECH_COMMANDS.speak]: async () => undefined,
    [SPEECH_COMMANDS.stop]: async () => undefined,
  };
  const adapter = contractAdapter(handlers);
  for (const name of SPEECH_COMMAND_NAMES) {
    const result = await adapter.invoke(name, { requestId: 'req-1' });
    assert.ok(result !== undefined || name === SPEECH_COMMANDS.captureStop
      || name === SPEECH_COMMANDS.speak || name === SPEECH_COMMANDS.stop,
    `command ${name} resolved through the contract map`);
  }
});

test('negative: the old speech_health name fails loudly against the Rust registration', async () => {
  const adapter = contractAdapter({
    [SPEECH_COMMANDS.health]: async () => truthfulHealth,
    [SPEECH_COMMANDS.permissions]: async () => truthfulPermissions,
  });
  await assert.rejects(
    () => adapter.invoke('speech_health'),
    /unknown speech command: speech_health \(not in Rust invoke_handler\)/,
  );
  await assert.rejects(
    () => adapter.invoke('speech_permissions'),
    /unknown speech command: speech_permissions/,
  );
  // The runtime, which now uses the constants, is unaffected by the dead names.
  const runtime = await initializeSpeechRuntime(adapter);
  assert.equal(runtime.health?.canonicalVoiceApproval, 'approval-pending');
});

test('negative: unavailable registered command leaves the honest fallback, never a hang', async () => {
  // Handler map mirrors a native boundary where health is registered but
  // the handler is unavailable (missing engine state): the probe must
  // fail visibly and the runtime must land in the fallback state —
  // duplex mounted, health unprobed, typed answers and captions intact.
  const registered = rustSpeechCommandNames();
  const adapter = contractAdapter(
    { [SPEECH_COMMANDS.permissions]: async () => truthfulPermissions },
    registered,
  );
  const runtime = await initializeSpeechRuntime(adapter);
  assert.equal(runtime.health, null);
  assert.equal(runtime.permissions?.microphone, 'not-determined');
  assert.equal(runtime.duplex.phase(), 'idle');
  // Explicit probe surfaces the unavailability instead of hanging.
  await assert.rejects(() => runtime.probe(), /registered but unavailable/);
  assert.equal(runtime.health, null);
  // Captions/typing path still fully usable.
  const press = runtime.duplex.press();
  assert.equal(press.event?.type, 'ptt:start');
  runtime.duplex.release();
  assert.equal(runtime.duplex.phase(), 'idle');
});

test('degraded speech never hides captions fallback', () => {
  assert.equal(
    speechStatusText({ ...truthfulHealth, degraded: true, degradedReason: 'assets missing' }),
    'assets missing',
  );
  assert.equal(
    speechStatusText({ ...truthfulHealth, degraded: true, degradedReason: null }),
    'Speech is degraded — typed answers and captions remain available.',
  );
  assert.equal(speechStatusText(null), 'Speech runtime not probed — typed answers and captions remain available.');
  assert.equal(
    speechStatusText({
      ...truthfulHealth,
      capabilities: {
        ...truthfulHealth.capabilities,
        systemTtsAvailable: false,
      },
    }),
    'No speech engines available — typed answers and captions remain available.',
  );
});

test('canonical voice approval-pending status is honest', () => {
  assert.equal(
    voiceApprovalStatusText(truthfulHealth),
    'Canonical voice pending operator approval.',
  );
  assert.equal(
    voiceApprovalStatusText({
      ...truthfulHealth,
      canonicalVoiceApproval: 'approved',
      capabilities: { ...truthfulHealth.capabilities, canonicalVoiceApproved: true },
    }),
    'Canonical voice approved.',
  );
  assert.equal(
    voiceApprovalStatusText(null),
    'Voice availability unknown — captions and typed answers remain available.',
  );
});
