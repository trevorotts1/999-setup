import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCancellation, parseLifecycle, parseQuestion } from '../bridge.ts';

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
