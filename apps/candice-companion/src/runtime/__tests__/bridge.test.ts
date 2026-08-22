import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCancellation, parseQuestion } from '../bridge.ts';

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
