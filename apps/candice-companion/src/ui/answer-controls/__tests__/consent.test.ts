/**
 * FIX-015 FAIL-5 capture consent gate tests.
 *
 * Contract (plan 3D):
 *  - granted and not-determined proceed to the capture path (the
 *    not-determined case IS the first-run press: the OS prompt appears
 *    at the press itself, prompt_source "ptt-only");
 *  - denied / no-device / error block: onBlocked fires, onAllowed does
 *    not, and the machine (typed-answer surface) is untouched;
 *  - a query that fails closes the gate ("error");
 *  - a press released before the async query answers is discarded — the
 *    mic can never open with the button up;
 *  - single-flight: one live press at a time;
 *  - destroy() discards pending answers; onStopped is never called by
 *    teardown.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCaptureConsentGate,
  isConsentBlocked,
  BLOCKED_CONSENTS,
  type CaptureConsent,
} from '../consent.ts';

function make(
  query: () => CaptureConsent | Promise<CaptureConsent>,
) {
  let allowed = 0;
  let stopped = 0;
  const blocked: Array<{ consent: CaptureConsent; explanation: string }> = [];
  const gate = createCaptureConsentGate({
    query,
    onAllowed: () => { allowed += 1; },
    onStopped: () => { stopped += 1; },
    onBlocked: (consent, explanation) => { blocked.push({ consent, explanation }); },
  });
  return {
    gate,
    allowed: () => allowed,
    stopped: () => stopped,
    blocked: () => blocked,
  };
}

test('blocked set contains exactly the failing states', () => {
  assert.deepEqual([...BLOCKED_CONSENTS].sort(), ['denied', 'error', 'no-device']);
  assert.equal(isConsentBlocked('denied'), true);
  assert.equal(isConsentBlocked('no-device'), true);
  assert.equal(isConsentBlocked('error'), true);
  assert.equal(isConsentBlocked('granted'), false);
  assert.equal(isConsentBlocked('not-determined'), false);
});

test('granted press proceeds to the capture path', async () => {
  const { gate, allowed, stopped, blocked } = make(() => 'granted');
  gate.requestStart();
  await new Promise((r) => setTimeout(r, 0)); // drain the microtask
  assert.equal(allowed(), 1);
  assert.equal(blocked().length, 0);
  gate.release();
  assert.equal(stopped(), 1);
});

test('not-determined press proceeds (the press IS the OS consent moment)', async () => {
  const { gate, allowed } = make(() => 'not-determined');
  gate.requestStart();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(allowed(), 1);
  gate.release();
});

test('denied press blocks and carries the actionable explanation', async () => {
  const { gate, allowed, stopped, blocked } = make(() => 'denied');
  gate.requestStart();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(allowed(), 0);
  assert.equal(blocked().length, 1);
  assert.equal(blocked()[0].consent, 'denied');
  assert.ok(blocked()[0].explanation.includes('System Settings'));
  assert.ok(blocked()[0].explanation.includes('Typed answers remain available'));
  // Release after a blocked press still routes the stop: the machine's
  // `ptt:stop` transition is a no-op when nothing is listening, so the
  // pointerup path stays uniform regardless of the gate outcome.
  gate.release();
  assert.equal(stopped(), 1);
});

test('no-device and error block with honest explanations', async () => {
  for (const consent of ['no-device', 'error'] as const) {
    const { gate, allowed, blocked } = make(() => consent);
    gate.requestStart();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(allowed(), 0);
    assert.equal(blocked().length, 1);
    assert.ok(blocked()[0].explanation.includes('Typed answers'));
  }
});

test('release before the async query answers discards the press', async () => {
  let resolveQuery!: (c: CaptureConsent) => void;
  const { gate, allowed, stopped } = make(
    () => new Promise<CaptureConsent>((resolve) => { resolveQuery = resolve; }),
  );
  gate.requestStart();
  gate.release();
  assert.equal(stopped(), 1);
  // The answer lands after release: mic must never open.
  resolveQuery('granted');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(allowed(), 0, 'late answer must be discarded');
});

test('single-flight: second press while gated is ignored', async () => {
  let resolveQuery!: (c: CaptureConsent) => void;
  let allowed = 0;
  const gate = createCaptureConsentGate({
    query: () => new Promise<CaptureConsent>((resolve) => { resolveQuery = resolve; }),
    onAllowed: () => { allowed += 1; },
    onStopped: () => {},
  });
  gate.requestStart();
  gate.requestStart(); // ignored: a press is already live
  resolveQuery('granted');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(allowed, 1);
});

test('throwing query closes the gate with error (fail closed at the gate)', async () => {
  const { gate, allowed, blocked } = make(() => {
    throw new Error('invoke failed');
  });
  gate.requestStart();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(allowed(), 0);
  assert.equal(blocked().length, 1);
  assert.equal(blocked()[0].consent, 'error');
  assert.ok(blocked()[0].explanation.includes('Typed answers'));
});

test('rejecting query closes the gate with error', async () => {
  const { gate, allowed, blocked } = make(() => Promise.reject(new Error('ipc down')));
  gate.requestStart();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(allowed(), 0);
  assert.equal(blocked().length, 1);
  assert.equal(blocked()[0].consent, 'error');
});

test('destroy discards pending answers and never calls onStopped', async () => {
  let resolveQuery!: (c: CaptureConsent) => void;
  const { gate, allowed, stopped } = make(
    () => new Promise<CaptureConsent>((resolve) => { resolveQuery = resolve; }),
  );
  gate.requestStart();
  gate.destroy();
  resolveQuery('granted');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(allowed(), 0);
  assert.equal(stopped(), 0);
  assert.equal(gate.isPressed(), false);
});
