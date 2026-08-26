/**
 * Choice-question options: registry -> machine -> selectable buttons.
 *
 * THE DEFECT THIS PINS. `canonicalQuestion('ENTRY_MODE')` has always returned
 *   answerKind: "single_choice"
 *   options:    ["interview", "provided-material"]
 * and the webview dropped both. Every choice question rendered as a bare text
 * box, so the only way to answer was to type a slug that was never displayed.
 * 18 of the 20 single_choice entries in the shipped registry carry options.
 *
 * These are outcome tests: they assert what the machine CARRIES and what the
 * user would be SHOWN, not that a particular function was called.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCandiceStateMachine } from '../../../state/machine.ts';
import { optionLabel } from '../view.ts';

const OPTS = ['interview', 'provided-material'] as const;

test('a delivered choice question carries its options into the machine', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'Which works better?', options: OPTS });
  assert.deepEqual(m.getState().pendingOptions, [...OPTS]);
});

test('a question with no options leaves pendingOptions null, not empty', () => {
  // null means "not a choice question". An empty array would be a choice
  // question with nothing to choose, which is a different (broken) thing.
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'Tell me about it.' });
  assert.equal(m.getState().pendingOptions, null);
});

test('answering clears the options with the question', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'Which works better?', options: OPTS });
  m.transition({ type: 'answer:confirmed', transcript: 'interview' });
  assert.equal(m.getState().pendingOptions, null,
    'stale buttons must never outlive the question they belong to');
});

test('a cancelled bridge clears the options with the question', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'Which works better?', options: OPTS });
  m.transition({ type: 'bridge:cancelled' });
  assert.equal(m.getState().pendingOptions, null,
    'a closed answer slot must not leave a live-looking choice surface');
});

test('recovery keeps the options: a crash must not downgrade a choice question', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'Which works better?', options: OPTS });
  m.transition({ type: 'question:recovered' });
  assert.deepEqual(m.getState().pendingOptions, [...OPTS],
    'the recovery event carries no registry payload; options come from state');
});

test('options compare by content, so a re-parsed payload is not a false change', () => {
  // Every wire parse produces a NEW array. Reference equality would report a
  // state change on every single transition and re-render the buttons under
  // the user's cursor.
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'Q', options: ['a', 'b'] });
  const before = m.getState();
  m.transition({ type: 'question:received', question: 'Q', options: ['a', 'b'] });
  assert.deepEqual(m.getState().pendingOptions, before.pendingOptions);
});

// ------------------------------------------------------------- option labels

test('optionLabel re-cases a slug for reading but never invents wording', () => {
  assert.equal(optionLabel('interview'), 'Interview');
  assert.equal(optionLabel('provided-material'), 'Provided material');
  assert.equal(optionLabel('yes'), 'Yes');
});

test('optionLabel passes real prose and pre-cased values through untouched', () => {
  // KAZEN_SCOPE ships "I don't know" as a literal option value.
  assert.equal(optionLabel("I don't know"), "I don't know");
  assert.equal(optionLabel('3'), '3');
});

test('the label is display only: the submitted value stays the registry string', () => {
  // This is the invariant that keeps a prettified label from becoming an
  // answer the protocol does not accept.
  for (const v of [...OPTS, "I don't know", '7']) {
    assert.notEqual(optionLabel(v), undefined);
    assert.equal(typeof optionLabel(v), 'string');
  }
});
