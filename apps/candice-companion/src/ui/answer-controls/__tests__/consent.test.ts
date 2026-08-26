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
  // The explanation must always end by naming the way in that still
  // works -- a refusal the user cannot act on is a dead end.
  assert.ok(blocked()[0].explanation.includes('You can still type your answer'));
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
    assert.ok(blocked()[0].explanation.includes('You can still type your answer'));
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
  assert.ok(blocked()[0].explanation.includes('You can still type your answer'));
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

// ------------------------------ somebody has to actually supply onBlocked

/**
 * The bug this guards was not in the gate. The gate computed a correct,
 * actionable explanation for every blocked consent state and handed it to
 * `onBlocked` -- and NOBODY EVER SUPPLIED AN `onBlocked`. Neither the
 * bridge nor the orchestrator passed one, so the explanation was built and
 * dropped. A user whose microphone was denied pressed HOLD TO TALK and saw
 * nothing at all: no error, no hint, no reason. The single failure mode the
 * user can fix themselves was the one we said nothing about.
 *
 * Every test above passes with the callback wired to nothing, because they
 * supply their own. So this reads the source, the way
 * `proc.rs::spawn_sites_all_use_the_helper` does for the same class of
 * problem: a seam that is only correct if someone downstream connects it.
 */
test('the shell wires the blocked explanation to a real surface (source guard)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string): string => readFileSync(join(here, rel), 'utf8');

  const composition = read('../../../runtime/composition.ts');
  const bridge = read('../../../runtime/bridge.ts');

  assert.ok(
    /announceCaptureBlocked:\s*\(/.test(composition),
    'composition must supply announceCaptureBlocked, or a denied microphone says nothing',
  );
  assert.ok(
    composition.includes('captions.announce'),
    'and it must route to a surface the user can actually see',
  );
  assert.ok(
    /onBlocked:\s*prefs\.announceCaptureBlocked/.test(bridge),
    'the bridge must forward it into captureConsent.onBlocked',
  );

  // CONTROL: the probe reads real files with real content. If these paths
  // were wrong, every assertion above would throw rather than pass, but a
  // future refactor could point them at something empty.
  assert.ok(composition.length > 5000, 'composition.ts was actually read');
  assert.ok(bridge.length > 5000, 'bridge.ts was actually read');
});
