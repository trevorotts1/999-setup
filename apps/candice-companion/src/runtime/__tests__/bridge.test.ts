import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCancellation, parseLifecycle, parseQuestion, shouldSpeakQuestion } from '../bridge.ts';

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
