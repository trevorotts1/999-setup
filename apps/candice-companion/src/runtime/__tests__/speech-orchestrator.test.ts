/**
 * Speech-orchestrator acceptance tests (QFIX Q-02, design q2-design.md
 * section 7; node:test, zero deps, deterministic — no hardware, no timers).
 *
 * Proven here, against a RECORDING invoke adapter (the exact command order
 * is the acceptance criterion, design section 10.3):
 *
 *  - press -> consent -> capture_start -> duplex+machine LISTENING (the
 *    honest-listening rule: the state comes from the native `listening`
 *    outcome, never from the button);
 *  - release -> capture_stop -> transcribe(mode capture) -> machine
 *    confirming -> submit ONLY on explicit confirm;
 *  - exact-once submit: double-confirm yields ONE submit invoke;
 *  - denied permission / no-device / query failure: blocked press, machine
 *    untouched, typed surface stays (FIX-015 consent semantics preserved);
 *  - not-determined proceeds (the press IS the OS consent moment);
 *  - stale callback: release before the permission answer — the mic never
 *    opens, and an open in the race window is closed again;
 *  - STT failure (invoke error, empty transcript): machine `confirming`
 *    via the `stt` error code, never a blank answer (spec 20);
 *  - TTS: speak goes to the real boundary; the duplex target aborts with
 *    an immediate `cmd_speech_stop`; the FIX-017 guard backstop refuses
 *    disallowed text before any engine touch.
 *
 * FIX-017 guard and FIX-015 consent semantics are asserted, not assumed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DuplexController } from '../../../src-tauri/audio/duplex/index.ts';
import { SPEECH_COMMANDS, type SpeechCommandName } from '../speech-commands.ts';
import {
  createCandiceStateMachine,
  INITIAL_STATE,
} from '../../state/machine.ts';
import type { CandiceState, CandiceStateMachine } from '../../state/machine.ts';
import {
  createSpeechOrchestrator,
  SpeechOrchestratorError,
  type SpeechInvokeAdapter,
  type SpeechOrchestratorOptions,
} from '../speech-orchestrator.ts';

// --------------------------------------------------------------- harness

interface RecordedCall {
  command: string;
  args?: Record<string, unknown>;
}

/** Recording adapter: logs every invoke, answers from a handler map. */
function recordingAdapter(
  handlers: Partial<Record<SpeechCommandName, (args?: Record<string, unknown>) => unknown>>,
): { adapter: SpeechInvokeAdapter; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    adapter: {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        const handler = handlers[command as SpeechCommandName];
        if (!handler) throw new Error(`no handler wired for ${command}`);
        return handler(args);
      },
    },
  };
}

const permissionsFact = (microphone: string): Record<string, unknown> => ({
  microphone,
  promptSource: 'ptt-only',
  explanation: 'Microphone permission is requested only when you press HOLD TO TALK.',
});

const captureStarted = (requestId: string): Record<string, unknown> => ({
  status: 'listening',
  requestId,
});

const transcribed = (text: string): Record<string, unknown> => ({
  requestId: 'req-1',
  status: 'transcribed',
  text,
  language: 'en',
});

/** Deterministic ids: req-1, req-2, ... (assertions pin the exact ids). */
function makeIds(): () => string {
  let n = 0;
  return () => `req-${++n}`;
}

interface HarnessOptions {
  handlers?: Partial<Record<SpeechCommandName, (args?: Record<string, unknown>) => unknown>>;
  speechGuard?: (text: string) => boolean;
  submitAnswer?: (text: string, inputMode: 'voice') => void;
  onBlocked?: (consent: string, explanation: string) => void;
  onSystemVoice?: () => void;
  initial?: Partial<CandiceState>;
  now?: () => number;
}

function makeHarness(options: HarnessOptions = {}) {
  const ids = makeIds();
  const { adapter, calls } = recordingAdapter(options.handlers ?? {});
  const machine: CandiceStateMachine = createCandiceStateMachine({
    ...INITIAL_STATE,
    ...options.initial,
  });
  const duplex = new DuplexController({ now: () => 1_000_000 });
  const blocked: Array<{ consent: string; explanation: string }> = [];
  const submitted: Array<{ text: string; inputMode: string }> = [];
  const orchestrator = createSpeechOrchestrator({
    invoke: adapter,
    machine,
    duplex,
    newRequestId: ids,
    speechGuard: options.speechGuard,
    submitAnswer: options.submitAnswer ?? ((text, inputMode) => submitted.push({ text, inputMode })),
    onBlocked: options.onBlocked ?? ((consent, explanation) => blocked.push({ consent, explanation })),
    onSystemVoice: options.onSystemVoice,
    now: options.now,
  });
  return { orchestrator, duplex, machine, calls, blocked, submitted, ids };
}

/** Drive a full happy-path press->release->transcript and return the text. */
async function captureTranscript(
  h: ReturnType<typeof makeHarness>,
  text = 'the answer is forty two',
): Promise<string> {
  assert.equal(await h.orchestrator.pttPress(), true);
  await h.orchestrator.pttRelease();
  const state = h.machine.getState();
  assert.equal(state.status, 'confirming');
  assert.equal(state.transcript, text);
  return text;
}

// ------------------------------------------------- press -> listening

test('press runs consent then capture_start then honest LISTENING (exact command order)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
    },
  });
  assert.equal(await h.orchestrator.pttPress(), true);

  // Design 2.3 order: permissions -> capture_start. Nothing else on the wire.
  assert.deepEqual(
    h.calls.map((c) => c.command),
    [SPEECH_COMMANDS.permissions, SPEECH_COMMANDS.captureStart],
  );
  assert.equal(h.calls[1].args?.requestId, 'req-1');

  // Honest listening: duplex phase AND machine status both listening.
  assert.equal(h.duplex.phase(), 'listening');
  assert.equal(h.machine.getState().status, 'listening');
  assert.equal(h.orchestrator.liveCaptureId, 'req-1');
  assert.equal(h.blocked.length, 0);
});

test('press while SPEAKING interrupts first, then consents, then captures', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.speak]: () => 'req-utt',
      [SPEECH_COMMANDS.stop]: () => undefined,
    },
  });
  // Production flow: the bridge speaks (duplex learns output is active,
  // WS-08 moves to speaking), THEN the user presses.
  const target = h.orchestrator.createSpeechTarget();
  h.duplex.attachTarget(target);
  await h.orchestrator.speak('the current question, read aloud');
  h.machine.transition({ type: 'speech:tts', ttsFallback: false });
  assert.equal(h.machine.getState().status, 'speaking');

  assert.equal(await h.orchestrator.pttPress(), true);

  // The duplex interrupt ran (abort in-press) and WS-08 moved
  // speaking -> listening.
  assert.equal(h.duplex.stats().interrupts, 1);
  assert.equal(h.machine.getState().status, 'listening');
  assert.deepEqual(
    h.calls.filter((c) => c.command !== SPEECH_COMMANDS.speak && c.command !== SPEECH_COMMANDS.stop)
      .map((c) => c.command),
    [SPEECH_COMMANDS.permissions, SPEECH_COMMANDS.captureStart],
  );
});

test('not-determined proceeds: the press IS the OS consent moment (FIX-015)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('not-determined'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
    },
  });
  assert.equal(await h.orchestrator.pttPress(), true);
  assert.equal(h.machine.getState().status, 'listening');
  assert.equal(h.blocked.length, 0);
});

test('single-flight: a press while a capture is live is refused by the native boundary', async () => {
  let live = false;
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: () => {
        if (live) throw new Error('capture-busy: a PTT capture is already active');
        live = true;
        return captureStarted('req-1');
      },
      [SPEECH_COMMANDS.captureStop]: () => {
        live = false;
        return undefined;
      },
    },
  });
  assert.equal(await h.orchestrator.pttPress(), true);
  assert.equal(await h.orchestrator.pttPress(), false);
  // The refused second press reported the honest mic error; the first
  // capture stays live and the machine stays listening.
  assert.equal(h.machine.getState().status, 'listening');
  assert.equal(h.orchestrator.liveCaptureId, 'req-1');
});

// ------------------------------------------- release -> transcribe -> confirm

test('release runs capture_stop then transcribe(mode capture) then CONFIRMING', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
      [SPEECH_COMMANDS.transcribe]: (args) => transcribed('the answer is forty two'),
    },
  });
  await captureTranscript(h);

  // Exact release order: capture_stop -> transcribe, same requestId, and
  // the capture path carries mode 'capture' with no other payload.
  const afterPress = 2;
  assert.equal(h.calls[afterPress]?.command, SPEECH_COMMANDS.captureStop);
  assert.equal(h.calls[afterPress]?.args?.requestId, 'req-1');
  assert.equal(h.calls[afterPress + 1]?.command, SPEECH_COMMANDS.transcribe);
  // `cmd_speech_transcribe` takes one named `request` parameter, so the
  // payload is wrapped. Asserting the wrapper as well as the fields keeps a
  // flat payload — which native rejects outright — from passing again.
  const transcribeArgs = h.calls[afterPress + 1]?.args as Record<string, unknown> | undefined;
  const transcribeRequest = transcribeArgs?.request as Record<string, unknown> | undefined;
  assert.ok(transcribeRequest, 'transcribe payload must be wrapped in `request`');
  assert.equal(transcribeArgs?.requestId, undefined, 'no flat requestId beside the wrapper');
  assert.equal(transcribeRequest?.requestId, 'req-1');
  assert.equal(transcribeRequest?.mode, 'capture');
  assert.equal(transcribeRequest?.transcriptText, undefined);
  assert.equal(transcribeRequest?.wavPath, undefined);

  // Machine: listening -> transcribing -> confirming with the transcript.
  assert.equal(h.machine.getState().status, 'confirming');
  assert.equal(h.machine.getState().transcript, 'the answer is forty two');
});

test('submit fires ONLY on explicit confirm, with inputMode voice and userConfirmedTranscript', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
      [SPEECH_COMMANDS.transcribe]: () => transcribed('the answer is forty two'),
    },
  });
  await captureTranscript(h);

  // Before confirm: no submission, no submit-shaped call on the wire.
  assert.equal(h.submitted.length, 0);
  assert.ok(!h.calls.some((c) => c.command.includes('submit')));

  const confirmed = h.orchestrator.confirmTranscript();
  assert.equal(confirmed, 'the answer is forty two');
  assert.deepEqual(h.submitted, [
    { text: 'the answer is forty two', inputMode: 'voice' },
  ]);
  assert.equal(h.machine.getState().status, 'thinking');
});

test('exact-once: double-confirm yields exactly ONE submission (spec 5.1)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
      [SPEECH_COMMANDS.transcribe]: () => transcribed('once only'),
    },
  });
  await captureTranscript(h, 'once only');

  assert.equal(h.orchestrator.confirmTranscript(), 'once only');
  assert.equal(h.orchestrator.confirmTranscript(), null);
  assert.equal(h.orchestrator.confirmTranscript(), null);
  assert.equal(h.submitted.length, 1);
});

test('exact-once latch re-arms on a NEW transcript (retry then confirm twice)', async () => {
  let transcriptNo = 0;
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
      [SPEECH_COMMANDS.transcribe]: () => transcribed(`take ${++transcriptNo}`),
    },
  });

  await captureTranscript(h, 'take 1');
  assert.equal(h.orchestrator.confirmTranscript(), 'take 1');
  assert.equal(h.submitted.length, 1);

  // TRY AGAIN: a new press from confirming discards the unconfirmed
  // transcript and re-arms the latch for the next round.
  await captureTranscript(h, 'take 2');
  assert.equal(h.orchestrator.confirmTranscript(), 'take 2');
  assert.deepEqual(
    h.submitted.map((s) => s.text),
    ['take 1', 'take 2'],
  );
});

test('confirm with no transcript is a no-op (never auto-submits, never fabricates)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
      [SPEECH_COMMANDS.transcribe]: () => transcribed('   '),
    },
  });
  assert.equal(h.orchestrator.confirmTranscript(), null);
  assert.equal(h.submitted.length, 0);

  await h.orchestrator.pttPress();
  // Release without a usable transcript: empty STT result is the explicit
  // failure path — the machine holds NO transcript to confirm.
  await h.orchestrator.pttRelease();
  assert.equal(h.machine.getState().transcript, null);
  assert.equal(h.orchestrator.confirmTranscript(), null);
  assert.equal(h.submitted.length, 0);
});

// ------------------------------------------- blocked consent (FIX-015)

test('denied permission: blocked press, machine untouched, explanation routed (FIX-015)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('denied'),
    },
  });
  assert.equal(await h.orchestrator.pttPress(), false);

  // The machine never left idle; no capture command was ever invoked.
  assert.equal(h.machine.getState().status, 'idle');
  assert.deepEqual(h.calls.map((c) => c.command), [SPEECH_COMMANDS.permissions]);
  assert.equal(h.duplex.phase(), 'idle');
  assert.equal(h.blocked.length, 1);
  assert.equal(h.blocked[0].consent, 'denied');
  // Reworded out of IT-ticket voice; still names the exact settings path,
  // which is the part the user has to act on.
  assert.match(h.blocked[0].explanation, /privacy settings, under Microphone/);
});

test('no-device: blocked press with the honest explanation, typed surface stays', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('no-device'),
    },
  });
  assert.equal(await h.orchestrator.pttPress(), false);
  assert.equal(h.machine.getState().status, 'idle');
  assert.equal(h.blocked[0].consent, 'no-device');
  assert.match(h.blocked[0].explanation, /can’t find a microphone/);
});

test('permission query failure fails CLOSED: blocked as error, mic never opens', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => {
        throw new Error('invoke unavailable');
      },
    },
  });
  assert.equal(await h.orchestrator.pttPress(), false);
  assert.equal(h.machine.getState().status, 'idle');
  assert.equal(h.blocked[0].consent, 'error');
  assert.match(h.blocked[0].explanation, /can’t check the microphone/);
});

test('malformed permission fact fails closed (unknown state never opens the mic)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => ({ microphone: 'something-new', promptSource: 'ptt-only' }),
    },
  });
  assert.equal(await h.orchestrator.pttPress(), false);
  assert.equal(h.blocked[0].consent, 'error');
  assert.equal(h.machine.getState().status, 'idle');
});

// ------------------------------------------------- stale callback rule

test('stale callback: release before the permission answer — mic never opens, no capture call', async () => {
  // Resolver held on an object property: property reads escape TS
  // control-flow narrowing, which would otherwise collapse a
  // closure-assigned `let` to `never` at the call site.
  const gate: { answerPermissions?: () => void } = {};
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () =>
        new Promise((resolve) => {
          gate.answerPermissions = () => resolve(permissionsFact('granted'));
        }),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
    },
  });

  const pressPromise = h.orchestrator.pttPress(); // parked on the consent query
  await Promise.resolve();
  await Promise.resolve();
  h.orchestrator.pttRelease(); // user let go while the query was in flight
  gate.answerPermissions?.();
  assert.equal(await pressPromise, false);

  // The mic never opened: no capture_start, no machine listening, and the
  // release was a clean no-op (no capture_stop for a never-opened mic).
  assert.deepEqual(h.calls.map((c) => c.command), [SPEECH_COMMANDS.permissions]);
  assert.equal(h.machine.getState().status, 'idle');
  assert.equal(h.duplex.phase(), 'idle');
  assert.equal(h.orchestrator.liveCaptureId, null);
});

test('stale callback: capture_start answers after release — the mic is given straight back', async () => {
  const gate: { answerCapture?: () => void } = {};
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) =>
        new Promise((resolve) => {
          gate.answerCapture = () => resolve(captureStarted(String(args?.requestId)));
        }),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
    },
  });

  const pressPromise = h.orchestrator.pttPress();
  await Promise.resolve();
  await Promise.resolve();
  h.orchestrator.pttRelease(); // release during the device open
  gate.answerCapture?.();
  assert.equal(await pressPromise, false);

  // The open succeeded but the press was already superseded: an immediate
  // capture_stop closes the device again. The machine never showed
  // LISTENING for a button-up mic.
  const stops = h.calls.filter((c) => c.command === SPEECH_COMMANDS.captureStop);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].args?.requestId, 'req-1');
  assert.equal(h.machine.getState().status, 'idle');
  assert.equal(h.orchestrator.liveCaptureId, null);
});

// ------------------------------------------------------- STT failure

test('STT invoke failure: machine lands in confirming via the stt error code, no blank answer', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
      [SPEECH_COMMANDS.transcribe]: () => {
        throw new Error('STT model checksum mismatch');
      },
    },
  });
  await h.orchestrator.pttPress();
  await h.orchestrator.pttRelease();

  // The machine's defined STT failure semantics: `error` with the stt code
  // moves transcribing -> confirming. Never a blank answer, never a hang.
  assert.equal(h.machine.getState().status, 'confirming');
  assert.equal(h.machine.getState().transcript, null);
  assert.equal(h.orchestrator.confirmTranscript(), null);
  assert.equal(h.submitted.length, 0);
});

test('empty transcript is an explicit STT failure — never a blank answer (spec 20)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
      [SPEECH_COMMANDS.transcribe]: () => transcribed('   '),
    },
  });
  await h.orchestrator.pttPress();
  await h.orchestrator.pttRelease();
  assert.equal(h.machine.getState().status, 'confirming');
  assert.equal(h.machine.getState().transcript, null);
  assert.equal(h.submitted.length, 0);
});

test('capture_start rejection (device did not open) reports the honest mic error, no listening UI', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: () => {
        throw new Error('capture-denied: microphone did not open');
      },
    },
  });
  assert.equal(await h.orchestrator.pttPress(), false);
  assert.equal(h.machine.getState().status, 'idle');
  assert.equal(h.duplex.phase(), 'idle');
  assert.equal(h.orchestrator.liveCaptureId, null);
});

test('capture_start with an unexpected status is refused — listening only from the native fact', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => ({
        status: 'requesting',
        requestId: args?.requestId,
      }),
    },
  });
  assert.equal(await h.orchestrator.pttPress(), false);
  assert.equal(h.machine.getState().status, 'idle');
  assert.equal(h.duplex.phase(), 'idle');
});

// ------------------------------------------- native capture status events

test('mid-listen denial event closes the capture honestly (mic-close effect, capture given back)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
    },
  });
  assert.equal(await h.orchestrator.pttPress(), true);
  assert.equal(h.machine.getState().status, 'listening');

  h.orchestrator.applyCaptureStatus('denied');

  // The device is closed again on the wire, the machine recorded its
  // mic-error effects (tts:stop + mic:close — the WS-08 `error`/`mic`
  // semantics), and the live id is gone. The mic can never stay open on
  // a denied stream.
  assert.ok(h.calls.some((c) => c.command === SPEECH_COMMANDS.captureStop));
  assert.equal(h.orchestrator.liveCaptureId, null);
  const last = h.machine.lastEffects;
  assert.ok(last.some((e) => e.type === 'mic:close'), 'mic must be closed by the denial');
  assert.ok(last.some((e) => e.type === 'tts:stop'));
});

test('unknown capture status codes are recorded facts, never state changes', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
    },
  });
  assert.equal(await h.orchestrator.pttPress(), true);
  h.orchestrator.applyCaptureStatus('listening');
  h.orchestrator.applyCaptureStatus('stopping');
  assert.equal(h.machine.getState().status, 'listening');
  assert.equal(h.orchestrator.liveCaptureId, 'req-1');
});

// --------------------------------------------------------- TTS + duplex

test('speak carries bounded text to the real boundary (cmd_speech_speak)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.speak]: (args) => String(
        (args?.request as Record<string, unknown> | undefined)?.requestId,
      ),
    },
  });
  await h.orchestrator.speak('Here is the next question.');
  const speak = h.calls.find((c) => c.command === SPEECH_COMMANDS.speak);
  assert.ok(speak, 'speak must reach the boundary');
  // `cmd_speech_speak(app, state, request: SpeakRequest)` takes ONE named
  // parameter. A flat payload is rejected by Tauri before the engine runs
  // ("invalid args `request` ... missing required key"), which is exactly how
  // the packaged app stayed silent while this test passed. Assert the wrapper.
  const speakRequest = speak.args?.request as Record<string, unknown> | undefined;
  assert.ok(speakRequest, 'speak payload must be wrapped in `request`');
  assert.equal(speak.args?.text, undefined, 'no flat text beside the wrapper');
  assert.equal(speakRequest?.text, 'Here is the next question.');
  assert.match(String(speakRequest?.requestId), /^req-\d+$/);
  // The canonical voice is resolved natively from the bundled manifest.
  assert.equal(speakRequest?.voiceId, undefined, 'voiceId stays unset on the call site');
});

test('speak refuses empty text without touching the engine (spec 20 bounded payloads)', async () => {
  const h = makeHarness({});
  await assert.rejects(
    () => h.orchestrator.speak('   '),
    SpeechOrchestratorError,
  );
  assert.deepEqual(h.calls, []);
});

test('FIX-017 backstop: speak refuses text the guard did not allow — no engine call', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.speak]: () => 'req-1',
    },
    speechGuard: (text) => !text.includes('secret'),
  });
  await assert.rejects(
    () => h.orchestrator.speak('the secret answer is 7'),
    /privacy boundary did not allow/,
  );
  assert.deepEqual(h.calls, [], 'the refused utterance never reached the boundary');
  // Allowed text still flows.
  await h.orchestrator.speak('the answer is 7');
  assert.equal(h.calls.length, 1);
});

test('duplex target: abort fires an immediate cmd_speech_stop (interrupt stops in the press call)', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.speak]: () => 'req-1',
      [SPEECH_COMMANDS.stop]: () => undefined,
    },
  });
  const target = h.orchestrator.createSpeechTarget();
  h.duplex.attachTarget(target);

  // Speak, then press while speaking: the duplex abort() runs in the press
  // call and the stop command is on the wire synchronously after a microtask.
  await h.orchestrator.speak('a long utterance');
  h.machine.transition({ type: 'speech:tts', ttsFallback: false });
  h.machine.transition({ type: 'speech:interrupted' });
  target.abort();
  await Promise.resolve();
  await Promise.resolve();

  const stops = h.calls.filter((c) => c.command === SPEECH_COMMANDS.stop);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].args?.immediate, true);
  assert.equal(stops[0].args?.requestId, 'req-1');
});

test('duplex target: stop awaits the native stop and reports the injected silence time', async () => {
  let clockMs = 5_000;
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.speak]: () => 'req-1',
      [SPEECH_COMMANDS.stop]: () => undefined,
    },
    now: () => clockMs,
  });
  const target = h.orchestrator.createSpeechTarget();
  h.duplex.attachTarget(target);

  await h.orchestrator.speak('another utterance');
  const pending = target.stop();
  clockMs = 5_140; // the tail accounting input
  const result = await pending;
  assert.deepEqual(result, { stoppedAtMs: 5_140 });

  // The stop is idempotent on the native side; a second stop still resolves.
  const second = await target.stop();
  assert.equal(second.stoppedAtMs, 5_140);
  assert.equal(h.calls.filter((c) => c.command === SPEECH_COMMANDS.stop).length, 2);
});

test('duplex interrupt sequence: press while speaking -> interrupted event, tail drain, then ptt:start', async () => {
  let clockMs = 1_000_000;
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.speak]: () => 'req-1',
      [SPEECH_COMMANDS.stop]: () => undefined,
    },
    now: () => clockMs,
  });
  const target = h.orchestrator.createSpeechTarget();
  h.duplex.attachTarget(target);

  await h.orchestrator.speak('utterance one');
  h.machine.transition({ type: 'speech:tts', ttsFallback: false });
  assert.equal(h.machine.getState().status, 'speaking');
  assert.ok(h.duplex.nowPlaying(), 'the duplex must know output is active');

  // Press while speaking: the orchestrator runs the duplex interrupt and
  // emits the machine event; consent+capture follow (design 2.3 step 1).
  const stopsBefore = h.calls.filter((c) => c.command === SPEECH_COMMANDS.stop).length;
  assert.equal(await h.orchestrator.pttPress(), true);
  assert.equal(h.duplex.stats().interrupts, 1);
  // The abort in the press call put an immediate stop on the wire.
  const stopsAfter = h.calls.filter((c) => c.command === SPEECH_COMMANDS.stop).length;
  assert.ok(stopsAfter > stopsBefore, 'abort fires a cmd_speech_stop in the press call (spec 6)');
  assert.equal(h.machine.getState().status, 'listening');

  // The duplex is draining the interrupted utterance's tail; tick() must
  // NOT emit a second ptt:start while the machine is already listening.
  clockMs += 200; // past the 120 ms tail
  h.orchestrator.tick();
  assert.equal(h.machine.getState().status, 'listening');
});

// ------------------------------------------------- sole-caller contract

test('sole-caller: every command this module can emit is a registered SPEECH_COMMANDS name', async () => {
  const h = makeHarness({
    handlers: {
      [SPEECH_COMMANDS.permissions]: () => permissionsFact('granted'),
      [SPEECH_COMMANDS.captureStart]: (args) => captureStarted(String(args?.requestId)),
      [SPEECH_COMMANDS.captureStop]: () => undefined,
      [SPEECH_COMMANDS.transcribe]: () => transcribed('text'),
      [SPEECH_COMMANDS.speak]: () => 'req-x',
      [SPEECH_COMMANDS.stop]: () => undefined,
    },
  });
  await h.orchestrator.pttPress();
  await h.orchestrator.pttRelease();
  h.orchestrator.confirmTranscript();
  await h.orchestrator.speak('hello');
  const target = h.orchestrator.createSpeechTarget();
  h.duplex.attachTarget(target);
  await h.orchestrator.speak('again');
  target.abort();
  await Promise.resolve();
  await Promise.resolve();

  const allowed = new Set<string>(Object.values(SPEECH_COMMANDS));
  for (const call of h.calls) {
    assert.ok(
      allowed.has(call.command),
      `orchestrator emitted non-contract command ${call.command}`,
    );
  }
  // The full lifecycle touched exactly the documented commands.
  assert.deepEqual(
    [...new Set(h.calls.map((c) => c.command))].sort(),
    [
      SPEECH_COMMANDS.captureStart,
      SPEECH_COMMANDS.captureStop,
      SPEECH_COMMANDS.permissions,
      SPEECH_COMMANDS.speak,
      SPEECH_COMMANDS.stop,
      SPEECH_COMMANDS.transcribe,
    ].sort(),
  );
});

test('release with no live capture is a clean no-op (idempotent, spec 20)', async () => {
  const h = makeHarness({});
  await h.orchestrator.pttRelease();
  await h.orchestrator.pttRelease();
  assert.deepEqual(h.calls, []);
  assert.equal(h.machine.getState().status, 'idle');
});

// ------------------------------- the OS voice must never stand in silently

/**
 * WR-016. When Candice's own engine cannot run, the native side may speak
 * through the OPERATING SYSTEM's voice and answers `system-voice:<id>`.
 *
 * The recorded objection to any voice fallback is precise: "Speaking in a
 * voice the client did not choose, WITHOUT TELLING THEM, is worse than not
 * speaking." The objection is to concealment, so the substitution is
 * allowed only while it is announced. This is the test that keeps it
 * announced.
 */
test('a system-voice substitution is reported, exactly once per session', async () => {
  const notices: number[] = [];
  const h = makeHarness({
    handlers: { [SPEECH_COMMANDS.speak]: () => 'system-voice:req-1' },
    onSystemVoice: () => notices.push(1),
  });
  await h.orchestrator.speak('first question');
  assert.equal(notices.length, 1, 'the user is told the first time');
  await h.orchestrator.speak('second question');
  await h.orchestrator.speak('third question');
  assert.equal(notices.length, 1, 'and not once per question after that');
});

test('CONTROL: Candice\u2019s own voice reports nothing', async () => {
  // Without this the test above would pass on an implementation that
  // announced unconditionally, putting a false notice on screen for every
  // client whose real engine is working perfectly.
  const notices: number[] = [];
  const h = makeHarness({
    handlers: { [SPEECH_COMMANDS.speak]: () => 'req-1' },
    onSystemVoice: () => notices.push(1),
  });
  await h.orchestrator.speak('a question');
  assert.deepEqual(notices, [], 'no notice when the real engine spoke');
});
