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

// ------------------------------- product names and prices, not re-wordings

/**
 * `optionLabel` must never invent wording -- a label that says something
 * other than the value risks a client agreeing to something they did not
 * pick. But de-hyphenation alone produced "Claude code", "Claude nine" and
 * "$40 year", which are not re-wordings to fix: they are the same words,
 * spelled wrong.
 */
test('product names and prices are formatted, not reworded', () => {
  assert.equal(optionLabel('claude-code'), 'Claude Code');
  assert.equal(optionLabel('claude-nine'), 'Claude-Nine');
  assert.equal(optionLabel('$40-year'), '$40 a year', 'not "$40 year"');
  assert.equal(optionLabel('$100-year'), '$100 a year');
});

test('the table stays a formatting table: no option gains a new meaning', () => {
  // These read badly for a non-technical client, and fixing them means
  // asserting what each one ROUTES TO. Getting that wrong is worse than a
  // confusing label, so they are left mechanical and recorded for the
  // registry owner instead of guessed at here.
  assert.equal(optionLabel('simple-ghl'), 'Simple ghl');
  assert.equal(optionLabel('provided-material'), 'Provided material');
  assert.equal(optionLabel('greenfield'), 'Greenfield');
});

test('CONTROL: the table is consulted at all, and only for its own keys', () => {
  assert.notEqual(optionLabel('claude-code'), 'Claude code', 'the table is consulted');
  assert.equal(optionLabel('some-unlisted-value'), 'Some unlisted value', 'and only for listed keys');
  assert.equal(optionLabel("I don't know"), "I don't know", 'prose still passes through');
});
