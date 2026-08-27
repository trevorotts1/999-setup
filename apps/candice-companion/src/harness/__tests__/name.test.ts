/**
 * Harness-name acceptance tests.
 *
 *   PASS: a user running claude-nine is never told to go to "the Claude
 *         window", and a user we know nothing about is never told a name we
 *         made up.
 *
 * These are OUTCOME tests: they assert the words that reach the screen.
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/harness/__tests__/name.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  UNKNOWN_HARNESS_PHRASE,
  answerElsewhereLabel,
  harnessName,
  harnessWindowPhrase,
  isAnswerElsewhereCaption,
  probeHarnessName,
  resetHarnessNameForTest,
  returnToHarnessLabel,
  setHarnessName,
} from '../name.ts';

test('plain Claude keeps the spec wording byte for byte', () => {
  resetHarnessNameForTest();
  setHarnessName('Claude');
  // Spec 5.1 pins this string. The packaged accessibility driver also finds
  // the control by this exact name, so a drift here breaks the e2e lane.
  assert.equal(answerElsewhereLabel(), 'Answer in Claude instead');
  assert.equal(returnToHarnessLabel(), 'Return to Claude');
  assert.equal(harnessWindowPhrase(), 'the Claude window');
});

test('claude-nine is named, not silently called Claude', () => {
  resetHarnessNameForTest();
  setHarnessName('Claude-Nine');
  assert.equal(answerElsewhereLabel(), 'Answer in Claude-Nine instead');
  assert.equal(returnToHarnessLabel(), 'Return to Claude-Nine');
  assert.equal(harnessWindowPhrase(), 'the Claude-Nine window');
  // The whole complaint, stated as an assertion.
  assert.ok(
    !harnessWindowPhrase().includes('the Claude window'),
    'a Claude-Nine user must never be pointed at "the Claude window"',
  );
});

test('unknown harness says "your terminal" instead of guessing', () => {
  resetHarnessNameForTest();
  assert.equal(harnessName(), null);
  assert.equal(harnessWindowPhrase(), UNKNOWN_HARNESS_PHRASE);
  assert.equal(answerElsewhereLabel(), 'Answer in your terminal instead');
  assert.equal(returnToHarnessLabel(), 'Return to your terminal');
});

test('a malformed native value is discarded, never displayed', () => {
  resetHarnessNameForTest();
  for (const junk of ['Gemini', '', null, 42, {}, ['Claude'], undefined]) {
    assert.equal(setHarnessName(junk), null, `${JSON.stringify(junk)} must not be accepted`);
    // The phrase must fall back, not embed the junk. Guarded on non-empty
    // because `''.includes('')` is true for every string and would make
    // this assertion fire on a value the code handled correctly.
    assert.equal(harnessWindowPhrase(), UNKNOWN_HARNESS_PHRASE);
    const text = String(junk);
    if (text.length > 0) {
      assert.ok(
        !harnessWindowPhrase().includes(text),
        'an unrecognised value must not reach the screen',
      );
    }
  }
});

test('the fallback caption is still classified after the label carries a name', () => {
  // The captions lane compared against the literal 'Answer in Claude
  // instead'. Under claude-nine that comparison silently stops matching and
  // the caption starts fading like a status line instead of holding like an
  // instruction — a failure with no error message.
  assert.ok(isAnswerElsewhereCaption('Answer in Claude instead'));
  assert.ok(isAnswerElsewhereCaption('Answer in Claude-Nine instead'));
  assert.ok(isAnswerElsewhereCaption('Answer in your terminal instead'));
  // CONTROL: it must still discriminate, or it would classify everything.
  assert.ok(!isAnswerElsewhereCaption('LISTENING'));
  assert.ok(!isAnswerElsewhereCaption('Candice is ready.'));
});

test('probe adopts what native reports', async () => {
  resetHarnessNameForTest();
  const seen: string[] = [];
  const got = await probeHarnessName({
    invoke: async (command: string) => {
      seen.push(command);
      return 'Claude-Nine';
    },
  });
  assert.equal(got, 'Claude-Nine');
  assert.deepEqual(seen, ['cmd_get_harness_name'], 'must ask the command native registers');
  assert.equal(harnessWindowPhrase(), 'the Claude-Nine window');
});

test('a native boundary that throws costs the name, never the boot', async () => {
  resetHarnessNameForTest();
  const got = await probeHarnessName({
    invoke: async () => {
      throw new Error('command not found');
    },
  });
  assert.equal(got, null, 'a failed probe stays unknown');
  assert.equal(harnessWindowPhrase(), UNKNOWN_HARNESS_PHRASE);
});

test('CONTROL: the resolved name actually drives the copy', () => {
  // If the label functions ignored the resolved value, every assertion above
  // could pass against a hardcoded string. Prove the SAME function returns
  // DIFFERENT text for different harnesses.
  resetHarnessNameForTest();
  setHarnessName('Claude');
  const claude = [answerElsewhereLabel(), returnToHarnessLabel(), harnessWindowPhrase()];
  setHarnessName('Claude-Nine');
  const nine = [answerElsewhereLabel(), returnToHarnessLabel(), harnessWindowPhrase()];
  for (let i = 0; i < claude.length; i += 1) {
    assert.notEqual(claude[i], nine[i], `copy ${i} did not change with the harness`);
  }
});
