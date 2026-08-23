import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initializeSpeechRuntime,
  speechStatusText,
  voiceApprovalStatusText,
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

test('speech runtime probe mounts duplex and reports native facts', async () => {
  const invoked: string[] = [];
  const runtime = await initializeSpeechRuntime({
    invoke: async (command) => {
      invoked.push(command);
      if (command === 'speech_health') return truthfulHealth;
      if (command === 'speech_permissions') return truthfulPermissions;
      throw new Error(`unexpected command ${command}`);
    },
  });
  assert.deepEqual(invoked, ['speech_health', 'speech_permissions']);
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
  // Duplex controller still mounted: press/release remain deterministic.
  const press = runtime.duplex.press();
  assert.equal(press.event?.type, 'ptt:start');
  const release = runtime.duplex.release();
  assert.equal(release.event?.type, 'ptt:stop');
  assert.equal(runtime.duplex.phase(), 'idle');
});

test('malformed native health fails closed to unprobed, never invented', async () => {
  const runtime = await initializeSpeechRuntime({
    invoke: async (command) => (
      command === 'speech_health'
        ? { ...truthfulHealth, capabilities: { ...truthfulHealth.capabilities, ttsAvailable: 'yes' } }
        : truthfulPermissions
    ),
  });
  assert.equal(runtime.health, null);
  assert.equal(runtime.permissions?.microphone, 'not-determined');
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
