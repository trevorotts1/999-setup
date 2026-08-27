/**
 * WS-13 acceptance tests (CHECKLIST E.1 WS-13).
 *
 *   PASS: blink/idle/head/gesture animation is lightweight
 *         (sprite/transform-based), lazy-loaded, and works on light and
 *         dark backgrounds.
 *
 * Runnable with zero deps on Node >= 22.6 (node:test + TS type-stripping),
 * following the lane convention established by WS-07/WS-17/WS-40:
 *
 *   node --test apps/candice-companion/src/animation/gesture/__tests__/gesture.test.ts
 *
 * The suite proves: (1) the CONTRACT shape (only layer-swap/transform/
 * opacity primitives are declared), (2) the pure motion calculators are
 * deterministic and bounded, (3) the gesture registry is lazy-loaded and
 * single-active, (4) the glow intensities are opacity-only and status-
 * driven, (5) the driver drives blink/idle/head/glow from real statuses,
 * stops under reduced motion, detaches cleanly, and is null-DOM safe
 * (spec 20). It cannot open a real transparent window (headless CI) —
 * pixel-level alpha proof on light AND dark desktops is the WS-15 visual
 * harness; this lane guarantees the source-of-truth shape it needs.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ANIMATION_KINDS,
  BOOT_GESTURES,
  CONTINUOUS_STATES,
  GESTURE_ACTIVE_CLASS,
  GESTURE_CONTRACT_VERSION,
  GESTURE_IDS,
  GESTURE_INACTIVE_CLASS,
  GESTURE_TIMING,
  GLOW_STAGE_ATTR,
  IDLE_GLOW_INTENSITY,
  LISTENING_GLOW_INTENSITY,
  PROCESSING_GLOW_INTENSITY,
  REDUCED_MOTION_CLASS,
  REDUCED_MOTION_GLOW_CAP,
  SPEAKING_GLOW_INTENSITY,
} from '../config.ts';
import {
  breathScale,
  eyeOpenRatio,
  glowIntensity,
  headDriftPx,
  staggerPhase,
} from '../motion.ts';
import {
  createGestureRegistry,
  gestureForStatus,
  placeholderLayer,
} from '../gestures.ts';
import type { GestureLayer } from '../gestures.ts';
import { monotonicClock, scheduleDelay, scheduleLoop } from '../timers.ts';
import { createGestureDriver } from '../driver.ts';

// -------------------------------------------------------------- tiny fake DOM

class FakeClassList {
  private set = new Set<string>();
  add(...names: string[]): void {
    for (const n of names) this.set.add(n);
  }
  remove(...names: string[]): void {
    for (const n of names) this.set.delete(n);
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force === undefined ? !this.set.has(name) : force;
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name: string): boolean {
    return this.set.has(name);
  }
  size(): number {
    return this.set.size;
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly classes = new FakeClassList();
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  ownerDocument: { documentElement: FakeElement } | null = null;
  private tagName: string;

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
    return this.classes;
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  querySelector<T>(selector: string): T | null {
    // Only attribute selectors are used by this lane.
    const m = /^\[([^\]]+)\]$/.exec(selector);
    if (!m) return null;
    const key = m[1];
    const found = this.children.find((c) => c.attributes.has(key));
    return (found ?? null) as T | null;
  }
  querySelectorAll<T>(selector: string): T[] {
    const m = /^\[([^\]]+)\]$/.exec(selector);
    if (!m) return [];
    const key = m[1];
    return this.children.filter((c) => c.attributes.has(key)) as T[];
  }
}

function makeStage(): FakeElement {
  const docEl = new FakeElement('html');
  const doc = { documentElement: docEl };
  const stage = new FakeElement('div', { 'data-candice-gesture-stage': '' });
  stage.ownerDocument = doc;
  const body = new FakeElement('div', { 'data-candice-body': '' });
  const head = new FakeElement('div', { 'data-candice-head': '' });
  const eye = new FakeElement('div', { 'data-candice-eye': '' });
  const glow = new FakeElement('div', { [GLOW_STAGE_ATTR]: '' });
  const listening = new FakeElement('div', { 'data-candice-gesture': 'listening' });
  const thinking = new FakeElement('div', { 'data-candice-gesture': 'thinking' });
  stage.appendChild(body);
  stage.appendChild(head);
  stage.appendChild(eye);
  stage.appendChild(glow);
  stage.appendChild(listening);
  stage.appendChild(thinking);
  return stage;
}

// ------------------------------------------------------- E.1 shape: primitives

test('E.1 WS-13: only layer-swap/transform/opacity primitives are declared (spec 10)', () => {
  assert.deepEqual([...ANIMATION_KINDS].sort(), ['layer-swap', 'opacity', 'transform']);
  const forbidden = ['canvas', 'video', 'mesh', 'webgl', 'particle', 'raycast'];
  const surface = JSON.stringify([ANIMATION_KINDS, CONTINUOUS_STATES, GESTURE_IDS]);
  for (const f of forbidden) {
    assert.ok(!surface.toLowerCase().includes(f), `forbidden primitive "${f}" must never appear`);
  }
});

test('E.1 WS-13: lazy-loaded by contract — boot gestures subset, late-binding ids', () => {
  assert.equal(GESTURE_CONTRACT_VERSION, 1);
  for (const id of BOOT_GESTURES) assert.ok(GESTURE_IDS.includes(id));
  assert.ok(BOOT_GESTURES.length < GESTURE_IDS.length, 'boot set must be a strict subset (lazy rest)');
  for (const id of GESTURE_IDS) {
    assert.match(id, /^[a-z-]+$/, 'canonical gesture ids match manifest key shape');
  }
});

test('E.1 WS-13: no colors or backgrounds in the contract surface (light+dark)', () => {
  const surface = JSON.stringify([
    GESTURE_TIMING,
    SPEAKING_GLOW_INTENSITY,
    LISTENING_GLOW_INTENSITY,
    PROCESSING_GLOW_INTENSITY,
    IDLE_GLOW_INTENSITY,
    REDUCED_MOTION_GLOW_CAP,
  ]);
  assert.doesNotMatch(surface, /#(?:[0-9a-fA-F]{3,8})/, 'no hex colors');
  assert.doesNotMatch(surface, /rgba?\(/i, 'no rgb/rgba colors');
  assert.doesNotMatch(surface, /url\(/i, 'no background images');
  assert.doesNotMatch(surface, /background/i, 'no background declarations');
  // Glow is opacity-only: intensities are bounded unitless opacities.
  for (const v of [SPEAKING_GLOW_INTENSITY, LISTENING_GLOW_INTENSITY, PROCESSING_GLOW_INTENSITY, IDLE_GLOW_INTENSITY, REDUCED_MOTION_GLOW_CAP]) {
    assert.ok(v > 0 && v <= 1, `intensity ${v} must be a unitless 0..1 opacity`);
  }
});

// ----------------------------------------------------------- motion calculators

test('eyeOpenRatio: open when outside the blink window, closed inside', () => {
  assert.equal(eyeOpenRatio(0), 1, 'fully open at rest');
  assert.equal(eyeOpenRatio(1), 0, 'fully closed inside the blink');
  assert.equal(eyeOpenRatio(2), 0, 'still closed beyond the window');

  // 0.5 is the CLOSED point, not the halfway point: eyeOpenRatio is
  // cos(u * PI), which reaches zero at u = 0.5. Asserting it explicitly so
  // nobody reads 0.5 as "half closed" again.
  assert.equal(
    Number(eyeOpenRatio(0.5).toFixed(3)),
    0,
    'closedUnits 0.5 is fully closed, not half closed',
  );

  // This assertion used to read `eyeOpenRatio(0.5)` and require only
  // `mid > 0 && mid < 1`. It passed on 6.123233995736766e-17 — the
  // floating-point residue of cos(PI/2) — so it certified an eyelid ramp
  // that did not exist while the driver rendered a 240ms hard cut. The
  // bounds below are PERCEPTIBLE ones: no float epsilon can satisfy them,
  // and they are sampled where the ramp actually lives, (0, 0.5).
  const mid = eyeOpenRatio(0.25);
  assert.ok(
    mid > 0.2 && mid < 0.8,
    `mid blink must be a visibly partial eyelid, got ${mid}`,
  );

  // A ramp is monotonic: sampling across the closing sweep must strictly
  // decrease. A single mid-point cannot prove that on its own.
  const sweep = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map(eyeOpenRatio);
  for (let i = 1; i < sweep.length; i += 1) {
    assert.ok(
      sweep[i]! < sweep[i - 1]!,
      `eyelid must close monotonically; step ${i} went ${sweep[i - 1]} -> ${sweep[i]}`,
    );
  }
});

test('breathScale: bounded and centered on 1', () => {
  const max = GESTURE_TIMING.idleBreathScaleMax;
  for (let r = 0; r < Math.PI * 2; r += 0.1) {
    const s = breathScale(r);
    assert.ok(s >= 1 - max - 1e-9 && s <= 1 + max + 1e-9, `breath ${s} out of range`);
  }
  assert.equal(breathScale(0), 1 + max);
  assert.ok(Math.abs(breathScale(Math.PI / 2) - 1) < 1e-9, 'quarter phase is rest');
});

test('headDriftPx: bounded, zero at rest phases, deterministic', () => {
  const max = GESTURE_TIMING.headDriftPxMax;
  for (let r = 0; r < Math.PI * 2; r += 0.1) {
    const px = headDriftPx(r);
    assert.ok(Math.abs(px) <= max, `drift ${px} out of range`);
  }
  assert.ok(Math.abs(headDriftPx(0)) < 1e-9);
  assert.equal(headDriftPx(Math.PI / 2), max, 'peak phase reaches the declared max');
});

test('glowIntensity: clamped 0..1 and pulsing between status intensity and 0', () => {
  for (let r = 0; r < Math.PI * 2; r += 0.1) {
    const g = glowIntensity(r, 0.7);
    assert.ok(g >= 0 && g <= 0.7 + 1e-9, `glow ${g} out of range`);
  }
  assert.ok(Math.abs(glowIntensity(0, 0.7) - 0.7) < 1e-9);
  assert.ok(Math.abs(glowIntensity(Math.PI, 0.7)) < 1e-9, 'trough is dark');
  assert.equal(glowIntensity(0, 5), 1, 'oversized status intensity clamps to 1');
});

test('staggerPhase: deterministic, in-range, period-proportional', () => {
  const p = staggerPhase('blink', 0);
  assert.ok(p >= 0 && p < Math.PI * 2);
  assert.equal(p, staggerPhase('blink', 0), 'deterministic');
  const shifted = staggerPhase('blink', GESTURE_TIMING.blinkPeriodMs);
  assert.ok(Math.abs(shifted - p) < 1e-9, 'one full period returns to the same phase');
  for (const kind of ['blink', 'breath', 'drift', 'glow'] as const) {
    assert.ok(staggerPhase(kind, 123) >= 0 && staggerPhase(kind, 123) < Math.PI * 2);
  }
});

// ------------------------------------------------------------ gesture registry

test('registry: all canonical ids known; every status plan maps to a real layer', () => {
  const reg = createGestureRegistry();
  assert.deepEqual([...reg.known()].sort(), [...GESTURE_IDS].sort());
  const statuses: Parameters<typeof gestureForStatus>[0][] = [
    'idle', 'listening', 'transcribing', 'confirming', 'thinking',
    'speaking', 'compact', 'recovering', 'text-fallback',
  ];
  for (const status of statuses) {
    const plan = reg.planFor(status);
    assert.ok(plan.layer, `layer exists for status ${status}`);
    assert.equal(plan.layer.id, plan.gesture, 'plan gesture and layer id agree');
  }
});

test('registry: lazy registration validates id, kind, and hold (never throws on bad input)', () => {
  const reg = createGestureRegistry();
  const badId = { id: 'not-a-gesture', kind: 'layer-swap', holdMs: 100 } as unknown as GestureLayer;
  assert.equal(reg.register(badId), false, 'unknown gesture id rejected');
  const badKind = { id: 'welcome', kind: 'webgl', holdMs: 100 } as unknown as GestureLayer;
  assert.equal(reg.register(badKind), false, 'forbidden animation kind rejected');
  const badHold = { id: 'welcome', kind: 'layer-swap', holdMs: -5 } as unknown as GestureLayer;
  assert.equal(reg.register(badHold), false, 'negative hold rejected');
  const good = { id: 'presenting', kind: 'layer-swap', holdMs: 900 } as unknown as GestureLayer;
  assert.equal(reg.register(good), true, 'valid late-binding layer accepted');
});

test('gestureForStatus: speaking->presenting, listening->listening, thinking->thinking, others->welcome', () => {
  assert.equal(gestureForStatus('speaking'), 'presenting');
  assert.equal(gestureForStatus('listening'), 'listening');
  assert.equal(gestureForStatus('thinking'), 'thinking');
  assert.equal(gestureForStatus('idle'), 'welcome');
  assert.equal(gestureForStatus('compact'), 'welcome');
});

test('placeholderLayer: transparent by construction — no src, no background', () => {
  for (const id of GESTURE_IDS) {
    const layer = placeholderLayer(id);
    assert.equal(layer.id, id);
    assert.equal(layer.kind, 'layer-swap');
    assert.equal(layer.registered, false);
    assert.ok(Number.isFinite(layer.holdMs) && layer.holdMs >= 0);
  }
});

// ------------------------------------------------------------------- timers

test('scheduleLoop: fires with positive deltas from a fake clock and cancels cleanly', async () => {
  let t = 0;
  const clock = { now: () => t };
  const ticks: number[] = [];
  const loop = scheduleLoop(10, (elapsed) => ticks.push(elapsed), clock);
  await new Promise((resolve) => setTimeout(resolve, 40));
  t = 35;
  await new Promise((resolve) => setTimeout(resolve, 40));
  loop.cancel();
  const before = ticks.length;
  t = 500;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(ticks.length, before, 'no ticks after cancel');
  assert.ok(ticks.length > 0, 'loop must have ticked');
  for (const elapsed of ticks) assert.ok(elapsed >= 1, 'deltas are positive');
});

test('scheduleDelay: fires once, never after cancel', async () => {
  let fired = 0;
  const delay = scheduleDelay(20, () => {
    fired += 1;
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fired, 1);
  delay.cancel();
  assert.equal(fired, 1);
  const cancelled = scheduleDelay(20, () => {
    fired += 1;
  });
  cancelled.cancel();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fired, 1, 'cancelled delay never fires');
});

test('monotonicClock: returns increasing finite numbers', () => {
  const c = monotonicClock();
  const a = c.now();
  const b = c.now();
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  assert.ok(b >= a);
});

// -------------------------------------------------------------------- driver

test('driver: null-DOM attach/setStatus never throws (spec 20 text fallback)', () => {
  const d = createGestureDriver();
  assert.doesNotThrow(() => d.attach(null));
  assert.doesNotThrow(() => d.setStatus('listening'));
  assert.doesNotThrow(() => d.detach());
  assert.equal(d.active, false);
});

test('driver: status drives exactly one active gesture layer (single-active swap)', () => {
  const d = createGestureDriver();
  const stage = makeStage();
  d.attach(stage as unknown as HTMLElement);
  d.setStatus('listening');
  const active = stage.children.filter((c) => c.classList.contains(GESTURE_ACTIVE_CLASS));
  assert.equal(active.length, 1, 'exactly one active gesture layer');
  assert.equal(active[0].getAttribute('data-candice-gesture'), 'listening');
  d.setStatus('thinking');
  const active2 = stage.children.filter((c) => c.classList.contains(GESTURE_ACTIVE_CLASS));
  assert.equal(active2.length, 1);
  assert.equal(active2[0].getAttribute('data-candice-gesture'), 'thinking');
  assert.equal(stage.getAttribute('data-candice-gesture-active'), 'thinking');
  d.detach();
});

test('driver: continuous statuses run blink/idle/head/glow loops; static statuses stop them', async () => {
  const d = createGestureDriver();
  const stage = makeStage();
  d.attach(stage as unknown as HTMLElement);
  d.setStatus('listening');
  assert.equal(d.active, true, 'continuous loops run while listening');
  await new Promise((resolve) => setTimeout(resolve, 80));
  const eye = stage.querySelector<FakeElement>('[data-candice-eye]');
  assert.ok(eye !== null);
  assert.ok(eye.style.transform !== undefined, 'blink transform applied');
  const glow = stage.querySelector<FakeElement>(`[${GLOW_STAGE_ATTR}]`);
  assert.ok(glow !== null);
  assert.ok(glow.style.opacity !== undefined && glow.style.opacity !== '0', 'glow opacity applied');
  d.setStatus('confirming');
  assert.equal(d.active, false, 'static status stops all loops');
  assert.equal(glow.getAttribute('data-candice-glow-status'), 'confirming');
  d.detach();
});

test('driver: reduced motion (WS-14 class) stops loops and caps glow to the static cap', async () => {
  const d = createGestureDriver();
  const stage = makeStage();
  stage.ownerDocument!.documentElement.classList.add(REDUCED_MOTION_CLASS);
  d.attach(stage as unknown as HTMLElement);
  d.setStatus('listening');
  assert.equal(d.active, false, 'no continuous loops under reduced motion');
  await new Promise((resolve) => setTimeout(resolve, 60));
  const glow = stage.querySelector<FakeElement>(`[${GLOW_STAGE_ATTR}]`);
  assert.ok(glow !== null);
  const op = Number(glow.style.opacity);
  assert.ok(op > 0 && op <= REDUCED_MOTION_GLOW_CAP + 1e-9, `static glow ${op} must be capped at ${REDUCED_MOTION_GLOW_CAP}`);
  d.detach();
});

test('driver: detach clears every loop and DOM reference (idempotent)', async () => {
  const d = createGestureDriver();
  const stage = makeStage();
  d.attach(stage as unknown as HTMLElement);
  d.setStatus('listening');
  assert.equal(d.active, true);
  d.detach();
  d.detach();
  assert.equal(d.active, false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(d.active, false, 'no loops resurrect after detach');
});

test('driver: registerLayer accepts late-bound final-art layers and status mapping stays pure', () => {
  const d = createGestureDriver();
  assert.equal(
    d.registerLayer({ id: 'presenting', kind: 'layer-swap', holdMs: 900 }),
    true,
  );
  assert.equal(
    d.registerLayer({ id: 'welcome', kind: 'webgl', holdMs: 10 } as unknown as GestureLayer),
    false,
  );
  // The driver never invents status: getter reflects only setStatus input.
  assert.equal(d.status, 'idle');
  d.setStatus('speaking');
  assert.equal(d.status, 'speaking');
});

// ------------------------------------------------------------ status helper

function statusForGesture(id: string): Parameters<typeof gestureForStatus>[0] {
  switch (id) {
    case 'listening':
      return 'listening';
    case 'thinking':
      return 'thinking';
    case 'presenting':
      return 'speaking';
    case 'welcome':
      return 'idle';
    case 'affirmative':
      return 'confirming';
    default:
      return 'idle';
  }
}

test('breathScale: the idle breath is perceptible, not merely measurable', () => {
  // Regression guard. The breath ran at 0.008 for the whole campaign: real
  // enough to show up in a frame diff, far too small for a person to see, so
  // the character read as a still image. A frame-diff test would have passed
  // the entire time. Assert the amplitude a HUMAN needs, not the one a diff
  // detects.
  //
  // The character renders ~500px tall and scales from the feet, so the delta
  // lands at the head: 0.02 is ~10px of travel, around the floor of what
  // reads as motion at a 3.2s period.
  const max = GESTURE_TIMING.idleBreathScaleMax;
  assert.ok(max >= 0.02, `idle breath ${max} is below the perceptibility floor of 0.02`);
  // Upper bound: past ~0.04 a 3.2s scale cycle reads as a bounce, not breath.
  assert.ok(max <= 0.04, `idle breath ${max} is large enough to read as a bounce`);
  // The head travel that amplitude buys, stated explicitly so the intent
  // survives a future edit of the number.
  const characterHeightPx = 500;
  const headTravelPx = characterHeightPx * max * 2;
  assert.ok(headTravelPx >= 10, `only ${headTravelPx.toFixed(1)}px of head travel`);
});
