import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeSpeechFailure, parseCancellation, parseLifecycle, parseQuestion,
  reportSpeechFailure, shouldSpeakQuestion,
} from '../bridge.ts';

test('bridge question and cancellation parsers accept only presentable exact payloads', () => {
  const question = {
    type: 'question', version: '1.0', question: {
      schemaVersion: '1.0', sessionId: 'session-a', questionKey: 'PROJECT_NAME',
      text: 'What is the project name?', allowedInputModes: ['typed'],
    },
  };
  assert.equal(parseQuestion(question)?.questionKey, 'PROJECT_NAME');
  assert.deepEqual(parseCancellation({ sessionId: 'session-a', questionKey: 'PROJECT_NAME' }), {
    sessionId: 'session-a', questionKey: 'PROJECT_NAME',
  });
  assert.equal(parseCancellation({ sessionId: 'session-a', questionKey: 'not-valid' }), null);
  assert.equal(parseQuestion({ ...question, question: { ...question.question, text: '' } }), null);
});

test('FIX-013 S4: native cancellation carries the exact operation identity', () => {
  const cancelled = parseCancellation({
    sessionId: 'session-a', questionKey: 'PROJECT_NAME', operationId: 'op-0123456789abcdef01234567',
  });
  assert.deepEqual(cancelled, {
    sessionId: 'session-a', questionKey: 'PROJECT_NAME', operationId: 'op-0123456789abcdef01234567',
  });
  // A cancellation without an operation id still matches by exact keys.
  assert.deepEqual(parseCancellation({ sessionId: 'session-a', questionKey: 'PROJECT_NAME' }), {
    sessionId: 'session-a', questionKey: 'PROJECT_NAME',
  });
});

test('FIX-013 S4: lifecycle events parse only named phases with bounded ids', () => {
  assert.equal(parseLifecycle({ lifecycle: 'connected', sessionId: 'session-a' })?.lifecycle, 'connected');
  assert.equal(parseLifecycle({ lifecycle: 'disconnected' })?.lifecycle, 'disconnected');
  const recovered = parseLifecycle({
    lifecycle: 'recovered', sessionId: 'session-a', leaseId: 'lease-1',
    operationId: 'op-0123456789abcdef01234567', questionKey: 'PROJECT_NAME',
  });
  assert.equal(recovered?.lifecycle, 'recovered');
  assert.equal(recovered?.leaseId, 'lease-1');
  assert.equal(recovered?.operationId, 'op-0123456789abcdef01234567');
  assert.equal(parseLifecycle({ lifecycle: '' }), null);
  assert.equal(parseLifecycle(null), null);
  assert.equal(parseLifecycle({}), null);
});

const q = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'question', version: '1.0', question: {
    schemaVersion: '1.0', sessionId: 's', questionKey: 'BUILD_TARGET',
    text: 'What are you building?', allowedInputModes: ['typed'],
    readAloud: true, sensitivity: 'normal', ...over,
  },
});

test('FIX-017: the parser carries the privacy echoes the speech decision needs', () => {
  const parsed = parseQuestion(q());
  assert.equal(parsed?.readAloud, true);
  assert.equal(parsed?.sensitivity, 'normal');
  // Absent metadata must arrive as absent, never as a permissive default.
  const bare = parseQuestion(q({ readAloud: undefined, sensitivity: undefined }));
  assert.equal(bare?.readAloud, false);
  assert.equal(bare?.sensitivity, undefined);
});

test('FIX-017: a question is spoken only on an exact normal + readAloud match', () => {
  assert.equal(shouldSpeakQuestion({ readAloud: true, sensitivity: 'normal' }, true), true);

  // Secret is never spoken — this is the leak that matters most.
  assert.equal(shouldSpeakQuestion({ readAloud: true, sensitivity: 'secret' }, true), false);
  // Personal fails closed in the webview: the server guard permits it only
  // with an explicit opt-in that does not reach here.
  assert.equal(shouldSpeakQuestion({ readAloud: true, sensitivity: 'personal' }, true), false);
  // The registry echo must be exactly true.
  assert.equal(shouldSpeakQuestion({ readAloud: false, sensitivity: 'normal' }, true), false);
  // Absent or malformed metadata never defaults open.
  assert.equal(shouldSpeakQuestion({ sensitivity: 'normal' }, true), false);
  assert.equal(shouldSpeakQuestion({ readAloud: true }, true), false);
  assert.equal(shouldSpeakQuestion({ readAloud: true, sensitivity: 'NORMAL' }, true), false);
  assert.equal(shouldSpeakQuestion({ readAloud: true, sensitivity: '' }, true), false);
  // Truthy-but-not-true must not pass.
  assert.equal(
    shouldSpeakQuestion({ readAloud: 1 as unknown as boolean, sensitivity: 'normal' }, true),
    false,
  );
});

test('the user voice-output preference is an independent veto', () => {
  assert.equal(shouldSpeakQuestion({ readAloud: true, sensitivity: 'normal' }, false), false);
  assert.equal(
    shouldSpeakQuestion({ readAloud: true, sensitivity: 'normal' }, undefined as unknown as boolean),
    false,
  );
});

// ------------------------------------------------- speech failure reporting

/**
 * The exact strings `resolve_approved_voice` produces. Tauri rejects a
 * `Result<_, String>` with the RAW STRING, so these arrive as strings and NOT
 * as `Error` — which is why `error.message` found nothing and every one of
 * them was discarded before this repair.
 */
const NATIVE_VOICE_FAILURES = [
  'the approved voice could not be resolved; captions remain available',
  "the user speech manifest declares voice 'af_heart' but the bundled manifest declares 'af_bella'",
  'the speech manifest is malformed: expected `,`',
  "the canonical voice 'af_heart' is not operator-approved (approval: approval-pending)",
];

test('an unresolvable voice produces text a human can read, carrying the reason', () => {
  for (const native of NATIVE_VOICE_FAILURES) {
    const announced: string[] = [];
    const text = reportSpeechFailure(native, (t) => announced.push(t));
    assert.equal(announced.length, 1, 'exactly one announcement per failure');
    assert.equal(announced[0], text, 'the returned text is the text announced');
    // Readable: a sentence a person can act on, not a code or an attribute.
    assert.match(text, /^Candice could not speak this question aloud/);
    // The REASON must survive — this is the assertion the old catch failed.
    const kernel = native.slice(0, 40);
    assert.ok(text.includes(kernel), `the native reason must survive: ${native}`);
  }
});

test('a rejection that carries no usable reason still says something, never silence', () => {
  for (const empty of [undefined, null, '', '   ', {}, 42]) {
    const announced: string[] = [];
    reportSpeechFailure(empty, (t) => announced.push(t));
    assert.equal(announced.length, 1);
    assert.ok(announced[0].length > 0, 'never an empty announcement');
    // The copy used to end "The voice engine gave no reason", which told the
    // user about our plumbing. What they need is that the words are on
    // screen. Still pinned to a specific phrase so this keeps discriminating
    // -- a generic non-empty check would pass on any string at all.
    assert.match(announced[0], /You can read it on screen/);
  }
});

test('an Error rejection is read from .message, a string rejection from itself', () => {
  const fromError = describeSpeechFailure(new Error('voice engine exploded'));
  assert.ok(fromError.includes('voice engine exploded'));
  const fromString = describeSpeechFailure('voice engine exploded');
  assert.ok(fromString.includes('voice engine exploded'));
});

test('a runaway reason is bounded and elided, never dropped and never unbounded', () => {
  const text = describeSpeechFailure('x'.repeat(5000));
  assert.ok(text.length < 300, `bounded, got ${text.length}`);
  assert.ok(text.includes('\u2026'), 'elision is visible');
  assert.ok(text.includes('xxx'), 'the reason is still represented');
});

test('reporting a failure never throws, even when the caption surface does', () => {
  assert.doesNotThrow(() => {
    reportSpeechFailure('some reason', () => { throw new Error('captions are down'); });
  });
  // Absent sink is the degraded case, not a crash.
  assert.doesNotThrow(() => reportSpeechFailure('some reason', undefined));
});
