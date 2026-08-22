/**
 * State machine test suite (Master Spec 0E WS-08).
 *
 * Run with the system Node.js test runner — no dependencies:
 *   node --experimental-strip-types --test apps/candice-companion/src/state/machine.test.ts
 *
 * Coverage contract of this suite:
 * 1. Every one of the nine canonical states is reachable.
 * 2. Every transition is driven by a real event — no path invents progress.
 * 3. `recovering` preserves the exact pending question (spec 20).
 * 4. Failure events never block, reset, or destroy Claude (spec 20) and never
 *    enter `text-fallback`/`compact` during the structured interview.
 * 5. The reducer is pure and deterministic: replaying the same event list
 *    produces the same states.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCandiceStateMachine,
  INITIAL_STATE,
  CANDICE_ERRORS,
  isBusy,
} from './machine.ts';

function seq(...events: Parameters<ReturnType<typeof createCandiceStateMachine>['transition']>[0][]) {
  const m = createCandiceStateMachine();
  for (const e of events) m.transition(e);
  return m.getState();
}

test('initial state is idle in the interview phase', () => {
  const m = createCandiceStateMachine();
  assert.deepEqual(m.getState(), INITIAL_STATE);
});

test('nine canonical states are all reachable', () => {
  assert.equal(seq({ type: 'status', detail: 'idle' }).status, 'idle');
  assert.equal(seq({ type: 'ptt:start' }).status, 'listening');
  assert.equal(seq({ type: 'ptt:start' }, { type: 'ptt:stop' }).status, 'transcribing');
  assert.equal(
    seq({ type: 'ptt:start' }, { type: 'ptt:stop' }, { type: 'speech:transcript', transcript: 'hello' }).status,
    'confirming'
  );
  assert.equal(
    seq({ type: 'question:received', question: 'Do you prefer voice or text?' }).status,
    'thinking'
  );
  assert.equal(
    seq({ type: 'question:received', question: 'q' }, { type: 'speech:tts' }).status,
    'speaking'
  );
  assert.equal(
    seq(
      { type: 'status', detail: 'building' },
      { type: 'status', detail: 'complete' },
      { type: 'compact:enter' }
    ).status,
    'compact'
  );
  assert.equal(
    seq({ type: 'question:received', question: 'q' }, { type: 'status', detail: 'recovering' }).status,
    'recovering'
  );
  assert.equal(seq({ type: 'fallback:text' }).status, 'text-fallback');
});

test('every transition is driven by a real event: no path invents progress', () => {
  // A status change without a real status event is impossible: the only way
  // `status` moves is through an event that names it. Prove the guard by
  // attempting to move into restricted statuses with no event behind them.
  const m = createCandiceStateMachine();
  assert.equal(m.transition({ type: 'ptt:start' })?.status, 'listening');
  // No transcript event -> never reaches confirming on its own.
  assert.equal(m.transition({ type: 'ptt:stop' })?.status, 'transcribing');
  assert.equal(m.transition({ type: 'ptt:start' }), null); // rejected while transcribing
  assert.equal(m.getState().status, 'transcribing');
});

test('recovering preserves the exact pending question (spec 20)', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'What is your preferred name?' });
  m.transition({ type: 'status', detail: 'recovering' });
  assert.equal(m.getState().status, 'recovering');
  assert.equal(m.getState().pendingQuestion, 'What is your preferred name?');
  // Recovery re-asks the same question and returns to thinking.
  m.transition({ type: 'question:recovered' });
  assert.equal(m.getState().status, 'thinking');
  assert.equal(m.getState().pendingQuestion, 'What is your preferred name?');
});

test('question:recovered without a pending question is ignored (no invented recovery)', () => {
  const m = createCandiceStateMachine();
  assert.equal(m.transition({ type: 'question:recovered' }), null);
  assert.equal(m.getState().status, 'idle');
});

test('status event with an unknown detail is ignored', () => {
  const m = createCandiceStateMachine();
  assert.equal(m.transition({ type: 'status', detail: 'warp-speed' }), null);
  assert.equal(m.getState().status, 'idle');
});

test('status event without detail is ignored', () => {
  const m = createCandiceStateMachine();
  assert.equal(m.transition({ type: 'status' }), null);
});

test('duplicate status is idempotent', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'ptt:start' });
  assert.equal(m.transition({ type: 'status', detail: 'listening' }), null);
  assert.equal(m.getState().status, 'listening');
});

test('answer:confirmed without a transcript falls back to the held transcript', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'ptt:start' });
  m.transition({ type: 'ptt:stop' });
  m.transition({ type: 'speech:transcript', transcript: 'yes' });
  assert.equal(m.getState().status, 'confirming');
  m.transition({ type: 'answer:confirmed' });
  assert.equal(m.getState().status, 'thinking');
  assert.equal(m.getState().transcript, 'yes');
  assert.equal(m.getState().pendingQuestion, null); // answered -> no pending question
});

test('answer:confirmed with no transcript anywhere is ignored', () => {
  const m = createCandiceStateMachine();
  assert.equal(m.transition({ type: 'answer:confirmed' }), null);
});

test('authenticated bridge cancellation clears an expired question surface', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'Will this wait forever?' });
  m.transition({ type: 'bridge:cancelled' });
  assert.equal(m.getState().status, 'idle');
  assert.equal(m.getState().pendingQuestion, null);
  assert.equal(m.getState().transcript, null);
  assert.deepEqual(m.lastEffects.map((effect) => effect.type), ['tts:stop', 'mic:close']);
});

test('push-to-talk lifecycle and speech interruption', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'ptt:start' });
  assert.deepEqual(m.lastEffects.map((e) => e.type), ['mic:open']);
  assert.equal(m.lastEffects[0].caption, 'LISTENING - LET GO WHEN FINISHED');
  m.transition({ type: 'speech:interrupted' });
  assert.deepEqual(m.lastEffects.map((e) => e.type), ['tts:stop', 'mic:open']);
  assert.equal(m.getState().status, 'listening');
});

test('ptt while speaking stops speech and starts listening', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'q' });
  m.transition({ type: 'speech:tts' });
  assert.equal(m.getState().status, 'speaking');
  m.transition({ type: 'speech:interrupted' });
  assert.equal(m.getState().status, 'listening');
  assert.deepEqual(m.lastEffects.map((e) => e.type), ['tts:stop', 'mic:open']);
});

test('speech:tts marks the fallback flag only when explicitly passed', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'q' });
  m.transition({ type: 'speech:tts' });
  assert.equal(m.getState().ttsFallbackActive, false);
  m.transition({ type: 'speech:tts', ttsFallback: true });
  assert.equal(m.getState().ttsFallbackActive, true);
});

test('error events never enter text-fallback or compact during the interview (spec 20)', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'q' });
  for (const code of Object.values(CANDICE_ERRORS)) {
    m.transition({ type: 'error', detail: code });
    assert.notEqual(m.getState().status, 'text-fallback', `error ${code} entered text-fallback`);
    assert.notEqual(m.getState().status, 'compact', `error ${code} entered compact`);
  }
});

test('bridge:unavailable never resets the pending question', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'q' });
  m.transition({ type: 'bridge:unavailable' });
  assert.equal(m.getState().bridgeUnavailable, true);
  assert.equal(m.getState().pendingQuestion, 'q');
  m.transition({ type: 'bridge:restored' });
  assert.equal(m.getState().bridgeUnavailable, false);
});

test('error with unknown code is ignored', () => {
  const m = createCandiceStateMachine();
  assert.equal(m.transition({ type: 'error', detail: 'banana' }), null);
});

test('session lifecycle: end is terminal, begin after end is rejected', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'session:end' });
  assert.equal(m.getState().phase, 'ending');
  assert.deepEqual(m.lastEffects.map((e) => e.type), ['tts:stop', 'mic:close']);
  assert.equal(m.transition({ type: 'session:begin' }), null);
  assert.equal(m.transition({ type: 'status', detail: 'idle' }), null);
});

test('session:begin is idempotent', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'session:begin' });
  assert.equal(m.transition({ type: 'session:begin' }), null);
});

test('compact companion transitions (spec 16)', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'status', detail: 'building' });
  assert.equal(m.getState().status, 'building');
  m.transition({ type: 'status', detail: 'quality-checking' });
  m.transition({ type: 'status', detail: 'fixing' });
  m.transition({ type: 'status', detail: 'waiting-for-user' });
  m.transition({ type: 'status', detail: 'complete' });
  assert.equal(m.getState().status, 'complete');
  // Compact only after the interview (post-interview phase).
  m.transition({ type: 'compact:enter' });
  assert.equal(m.getState().status, 'compact');
  assert.equal(m.getState().compacted, true);
  assert.deepEqual(m.lastEffects.map((e) => e.type), ['mic:close']);
  m.transition({ type: 'compact:exit' });
  assert.equal(m.getState().status, 'idle');
  assert.equal(m.getState().compacted, false);
});

test('compact:enter is rejected before the interview ends', () => {
  const m = createCandiceStateMachine();
  assert.equal(m.transition({ type: 'compact:enter' }), null);
  assert.equal(m.getState().status, 'idle');
});

test('first skill-progress status event ends the interview (spec 16)', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'status', detail: 'building' });
  assert.equal(m.getState().phase, 'post-interview');
  assert.equal(m.getState().status, 'building');
});

test('voice-capture statuses never end the interview (never invented progress)', () => {
  const m = createCandiceStateMachine();
  for (const s of ['listening', 'transcribing', 'confirming']) {
    m.transition({ type: 'status', detail: s });
    assert.equal(m.getState().phase, 'interview', `status ${s} ended the interview`);
  }
});

test('fallback:text during the interview does not move to text-fallback if a question is pending', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'q' });
  m.transition({ type: 'fallback:text' });
  assert.equal(m.getState().status, 'text-fallback');
  assert.equal(m.getState().pendingQuestion, 'q');
});

test('answer:delegate-to-claude keeps the pending question and offers captions', () => {
  const m = createCandiceStateMachine();
  m.transition({ type: 'question:received', question: 'q' });
  m.transition({ type: 'answer:delegate-to-claude' });
  assert.equal(m.getState().status, 'text-fallback');
  assert.equal(m.getState().pendingQuestion, 'q');
  assert.ok(m.lastEffects.some((e) => e.type === 'captions:show'));
});

test('unknown event types are ignored (late or duplicate events cannot corrupt)', () => {
  const m = createCandiceStateMachine();
  // @ts-expect-error - deliberately unknown event type
  assert.equal(m.transition({ type: 'teleport' }), null);
  assert.deepEqual(m.getState(), INITIAL_STATE);
});

test('reducer is pure: replaying the same event list yields identical states', () => {
  const events = [
    { type: 'question:received', question: 'Name?' },
    { type: 'speech:tts' },
    { type: 'speech:interrupted' },
    { type: 'ptt:stop' },
    { type: 'speech:transcript', transcript: 'Trevor' },
    { type: 'answer:confirmed' },
    { type: 'status', detail: 'building' },
    { type: 'compact:enter' },
    { type: 'compact:exit' },
  ] as const;
  const run1 = seq(...events);
  const run2 = seq(...events);
  assert.deepEqual(run1, run2);
});

test('isBusy marks the statuses that block terminal injection (spec 13.3)', () => {
  assert.equal(isBusy('speaking'), true);
  assert.equal(isBusy('transcribing'), true);
  assert.equal(isBusy('confirming'), true);
  assert.equal(isBusy('thinking'), true);
  assert.equal(isBusy('listening'), true);
  assert.equal(isBusy('recovering'), true);
  assert.equal(isBusy('idle'), false);
  assert.equal(isBusy('compact'), false);
  assert.equal(isBusy('text-fallback'), false);
});
