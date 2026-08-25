/**
 * Regression cover for the "she is a still image" defect (WS-13 driver).
 *
 * These are OUTCOME tests. `gesture.test.ts` already proves the pure
 * `breathScale()` calculator returns a perceptible number — but that number
 * was never reaching the DOM, because `continuousStatus()` compared a WS-08
 * `CandiceStatus` (`'idle'`) against this lane's own vocabulary
 * (`'idling'`). Every calculator test passed while the companion sat frozen.
 *
 * So each test below drives the REAL driver, waits for real ticks, and reads
 * back what was actually written to the element. A future edit that breaks
 * the wiring again fails here even if every calculator still returns the
 * right value.
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/animation/gesture/__tests__/driver-continuous.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGestureDriver } from '../driver.ts';
import { REDUCED_MOTION_CLASS } from '../config.ts';
import type { CandiceStatus } from '../../../state/status.ts';

// -------------------------------------------------------------- tiny fake DOM

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  ownerDocument: { documentElement: FakeElement } | null = null;
  tagName: string;
  private classes = new Set<string>();

  constructor(tagName: string, attrs: Record<string, string> = {}) {
    this.tagName = tagName;
    for (const [k, v] of Object.entries(attrs)) this.attributes.set(k, v);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  get classList() {
    return {
      add: (c: string) => this.classes.add(c),
      remove: (c: string) => this.classes.delete(c),
      toggle: (c: string, on: boolean) => (on ? this.classes.add(c) : this.classes.delete(c)),
      contains: (c: string) => this.classes.has(c),
    };
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  querySelector<T>(selector: string): T | null {
    const m = /^\[([^\]]+)\]$/.exec(selector);
    if (!m) return null;
    return (this.children.find((c) => c.attributes.has(m[1])) ?? null) as T | null;
  }
  querySelectorAll<T>(selector: string): T[] {
    const m = /^\[([^\]]+)\]$/.exec(selector);
    if (!m) return [];
    return this.children.filter((c) => c.attributes.has(m[1])) as T[];
  }
}

/** A stage carrying the three documented motion targets (CONTRACT.md). */
function makeStage(): FakeElement {
  const html = new FakeElement('html');
  const stage = new FakeElement('div', { 'data-candice-gesture-stage': '' });
  stage.ownerDocument = { documentElement: html };
  stage.appendChild(
    new FakeElement('img', { 'data-candice-body': '', 'data-candice-gesture': 'welcome' }),
  );
  stage.appendChild(new FakeElement('div', { 'data-candice-eye': '' }));
  stage.appendChild(new FakeElement('div', { 'data-candice-head': '' }));
  stage.appendChild(new FakeElement('div', { 'data-candice-glow-stage': '' }));
  return stage;
}

const settle = (ms = 160): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Drive one status and report what actually landed on the DOM. */
async function observe(status: CandiceStatus, reduced = false) {
  const driver = createGestureDriver();
  const stage = makeStage();
  if (reduced) stage.ownerDocument!.documentElement.classList.add(REDUCED_MOTION_CLASS);
  driver.attach(stage as unknown as HTMLElement);
  driver.setStatus(status);
  await settle();
  const body = stage.querySelector<FakeElement>('[data-candice-body]');
  const eye = stage.querySelector<FakeElement>('[data-candice-eye]');
  const result = {
    running: driver.active,
    bodyTransform: body?.style.transform,
    eyeTransform: eye?.style.transform,
  };
  driver.detach();
  return result;
}

// -------------------------------------------------- the defect, stated as tests

test('idle actually breathes — a transform reaches the body layer (the regression)', async () => {
  const seen = await observe('idle');
  assert.equal(seen.running, true, 'the continuous loops must run at idle');
  assert.ok(
    seen.bodyTransform !== undefined,
    'idle wrote NO transform: the breath loop never started (the original defect)',
  );
  assert.match(
    seen.bodyTransform!,
    /^scale\([\d.]+\)$/,
    'the breath is a scale transform (spec 10 primitive)',
  );
});

test('idle breathing is perceptible on the DOM, not merely non-zero', async () => {
  const driver = createGestureDriver();
  const stage = makeStage();
  driver.attach(stage as unknown as HTMLElement);
  driver.setStatus('idle');
  const body = stage.querySelector<FakeElement>('[data-candice-body]')!;

  // Sample across most of a breath period and keep the extremes.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 60; i++) {
    await settle(30);
    const m = /^scale\(([\d.]+)\)$/.exec(body.style.transform ?? '');
    if (!m) continue;
    const v = Number(m[1]);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  driver.detach();

  assert.ok(Number.isFinite(min) && Number.isFinite(max), 'the loop wrote sampled values');
  // On a ~500px character a 1% peak-to-peak scale is ~5px of head travel.
  // Anything under this was the "measurable but invisible" state the
  // operator reported as a still image.
  assert.ok(
    max - min >= 0.01,
    `breath travel ${(max - min).toFixed(4)} is too small to see (need >= 0.01 peak to peak)`,
  );
  assert.ok(max <= 1.05, `breath scale ${max} is a bounce, not a breath`);
});

test('speaking animates too — she is not frozen while she talks', async () => {
  const seen = await observe('speaking');
  assert.equal(seen.running, true);
  assert.ok(seen.bodyTransform !== undefined, 'speaking must drive the body layer');
});

test('compact stays alive (it is an idle-equivalent pose, not a still frame)', async () => {
  const seen = await observe('compact');
  assert.equal(seen.running, true);
  assert.ok(seen.bodyTransform !== undefined);
});

test('the blink loop reaches the eye target at idle', async () => {
  const seen = await observe('idle');
  assert.ok(
    seen.eyeTransform !== undefined,
    'the eye layer received no transform: the blink loop never started',
  );
  assert.match(seen.eyeTransform!, /^scaleY\([\d.]+\)$/);
});

// ------------------------------------------------------- what must stay still

test('transient round trips stay static (confirming/transcribing)', async () => {
  for (const status of ['confirming', 'transcribing'] as const) {
    const seen = await observe(status);
    assert.equal(seen.running, false, `${status} must not run continuous loops`);
  }
});

test('text-fallback and recovering stay static', async () => {
  for (const status of ['text-fallback', 'recovering'] as const) {
    const seen = await observe(status);
    assert.equal(seen.running, false, `${status} must not run continuous loops`);
  }
});

// ----------------------------------------------------------- reduced motion

test('reduced motion still wins at idle — no loops, resting pose', async () => {
  const seen = await observe('idle', true);
  assert.equal(seen.running, false, 'reduced motion must stop the idle loops too');
  // The requirement is "no ANIMATION", not "no style written". An explicit
  // rest pose is what the character should hold; the thing that must never
  // appear is a moving value.
  assert.equal(
    seen.bodyTransform,
    'scale(1)',
    'the character must hold the approved rest pose, not a breath frame',
  );
});


// -------------------------------- live preference change (the toggle path)

/**
 * The animation-off toggle flips the shared class on `<html>` while the loops
 * are ALREADY running. `startContinuous()` samples reduced motion once, at
 * start, so nothing used to re-check it — the class went on and the character
 * kept breathing. The driver now subscribes to the class instead.
 *
 * The fake DOM has no MutationObserver, so these tests exercise the same
 * re-evaluation through the public surface the observer calls into: flip the
 * class, then let the driver re-read it. A real browser proof of the observer
 * itself is in the captured evidence run.
 */
test('turning reduced motion ON mid-run stops the loops and rests the pose', async () => {
  const driver = createGestureDriver();
  const stage = makeStage();
  driver.attach(stage as unknown as HTMLElement);
  driver.setStatus('idle');
  await settle();
  assert.equal(driver.active, true, 'breathing before the preference flips');

  stage.ownerDocument!.documentElement.classList.add(REDUCED_MOTION_CLASS);
  // What the observer callback drives.
  driver.setStatus('idle');
  await settle();

  assert.equal(driver.active, false, 'loops must stop when motion is turned off');
  const body = stage.querySelector<FakeElement>('[data-candice-body]');
  assert.equal(
    body?.style.transform,
    'scale(1)',
    'the character must rest at the approved pose, not freeze mid-breath',
  );
  const eye = stage.querySelector<FakeElement>('[data-candice-eye]');
  assert.equal(eye?.style.transform, 'scaleY(1)', 'no frozen half-blink');
  driver.detach();
});

test('turning reduced motion OFF again resumes the loops', async () => {
  const driver = createGestureDriver();
  const stage = makeStage();
  stage.ownerDocument!.documentElement.classList.add(REDUCED_MOTION_CLASS);
  driver.attach(stage as unknown as HTMLElement);
  driver.setStatus('idle');
  await settle();
  assert.equal(driver.active, false);

  stage.ownerDocument!.documentElement.classList.remove(REDUCED_MOTION_CLASS);
  driver.setStatus('idle');
  await settle();

  assert.equal(driver.active, true, 'motion resumes when the user turns it back on');
  const body = stage.querySelector<FakeElement>('[data-candice-body]');
  assert.match(body!.style.transform, /^scale\([\d.]+\)$/);
  driver.detach();
});
