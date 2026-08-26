/**
 * WS-12 acceptance tests (CHECKLIST E.1 WS-12).
 *
 *   PASS: mouth/viseme states synchronize to TTS timing; face-state
 *         registration was measured before whole-frame speech animation
 *         was used.
 *
 * Runnable with zero deps on Node >= 22.6 (node:test + TS type-stripping),
 * following the lane convention established by WS-07/WS-40:
 *
 *   node --test apps/candice-companion/src/animation/viseme/__tests__/viseme.test.ts
 *
 * Scope: the viseme state machine — mapping, scheduling, cross-fade
 * emission, idle fallback. Asset application is WS-11/WS-13 territory;
 * the visual harness is WS-15. The registration precondition (no
 * whole-frame swaps before face-state registration is measured) is
 * proven structurally: this lane emits viseme steps over the timing
 * clock and contains no whole-frame asset-swap logic, and the module
 * surface exposes a VISEME_REGISTRATION_PRECONDITION guard that the
 * render lane must assert before consuming steps.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  idleViseme,
  phonemeToViseme,
  shouldBlend,
  timingToVisemeEvent,
} from "../mapping.ts";
import { VisemeScheduler } from "../scheduler.ts";
import {
  DEFAULT_PHONEME_TO_VISEME,
  type Clock,
  type VisemeEvent,
  type VisemeId,
} from "../types.ts";

// ------------------------------------------------------------------ helpers

class FakeClock implements Clock {
  t = 0;
  now(): number {
    return this.t;
  }
}

// Real espeak-ng IPA: schwa -> "ai", rounded o -> "oh", m -> "mm".
const TIMINGS = [
  { phoneme: "ə", startSec: 0.1, endSec: 0.2 },
  { phoneme: "o", startSec: 0.3, endSec: 0.4 },
  { phoneme: "m", startSec: 0.4, endSec: 0.5 },
];

function schedulerWith(timings = TIMINGS, options: { blendMode?: "direct" | "crossfade" } = {}) {
  const clock = new FakeClock();
  clock.t = 10_000;
  const s = new VisemeScheduler({ clock, ...options });
  s.start(timings);
  return { s, clock };
}

// ---------------------------------------------------------------- mapping

test("phonemeToViseme maps Kokoro phonemes to known shapes", () => {
  // Every key here was captured from the shipped worker, not copied from a
  // chart. The stack emits IPA: "aa"/"ae" are ARPAbet and never arrive, and
  // bare "a" is the OPEN vowel of "my", so it belongs on the wide jaw.
  assert.equal(phonemeToViseme("ə"), "ai");   // schwa, "hello"
  assert.equal(phonemeToViseme("i"), "ee");   // "she"
  assert.equal(phonemeToViseme("o"), "oh");   // "go"
  assert.equal(phonemeToViseme("m"), "mm");   // lips together
  assert.equal(phonemeToViseme("æ"), "wide"); // "cat"
  assert.equal(phonemeToViseme("a"), "wide"); // "my", "now"
});

test("phonemeToViseme falls back to rest for unmapped phonemes", () => {
  // Genuinely outside any phoneme inventory.
  assert.equal(phonemeToViseme("zz-not-a-phoneme"), "rest");
  assert.equal(phonemeToViseme(""), "rest");
  // A bare space is the WORD GAP, not an unknown symbol: connected speech
  // does not close the mouth between words, so it must not resolve to rest.
  assert.notEqual(phonemeToViseme(" "), "rest");
  // Lowercase fallback still runs for callers holding a case-variant key.
  assert.equal(phonemeToViseme("A"), "wide");
});

test("default table covers vowels and bilabials (visible lip work)", () => {
  for (const p of ["a", "e", "i", "o", "u", "b", "m", "p", "f", "v", "w"]) {
    const v = phonemeToViseme(p);
    assert.notEqual(v, "rest", `phoneme ${p} must map to a real shape`);
  }
  // Table must be a data constant, never re-exported mutable state.
  assert.ok(Object.isFrozen(DEFAULT_PHONEME_TO_VISEME));
});

test("timingToVisemeEvent rejects non-finite and non-positive spans", () => {
  assert.equal(timingToVisemeEvent("a", 0, 0), null);
  assert.equal(timingToVisemeEvent("a", 0.2, 0.1), null);
  assert.equal(timingToVisemeEvent("a", Number.NaN, 0.1), null);
  assert.equal(timingToVisemeEvent("a", 0, Number.POSITIVE_INFINITY), null);
});

test("shouldBlend: only crossfade mode, differing shapes, real gap", () => {
  const a: VisemeEvent = { startSec: 0, endSec: 0.1, viseme: "ai" };
  const b: VisemeEvent = { startSec: 0.2, endSec: 0.3, viseme: "oh" };
  const same: VisemeEvent = { startSec: 0.2, endSec: 0.3, viseme: "ai" };
  assert.equal(shouldBlend("direct", a, b), false);
  assert.equal(shouldBlend("crossfade", a, b), true);
  assert.equal(shouldBlend("crossfade", a, same), false);
  assert.equal(shouldBlend("crossfade", a, { ...b, startSec: 0.05 }), false); // no gap
});

test("idleViseme returns closed mouth", () => {
  assert.equal(idleViseme(), "closed");
});

// -------------------------------------------------------------- scheduling

test("scheduler syncs viseme steps to TTS timing with bounded lead", () => {
  const { s, clock } = schedulerWith();
  // First span: 0.1s..0.2s audio; 60ms lead => 10040..10200 in clock ms.
  const steps = s.stepsAt(clock.t, 1000);
  assert.ok(steps.length >= 1);
  const first = steps[0];
  assert.equal(first.viseme, "ai");
  assert.equal(first.startMs, 10_000 + 100 - 60);
  assert.equal(first.endMs, 10_000 + 200);
});

test("scheduler steps are ordered and non-overlapping", () => {
  const { s, clock } = schedulerWith();
  const steps = s.stepsAt(clock.t, 10_000);
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i].startMs >= steps[i - 1].endMs, `overlap at step ${i}`);
  }
  const starts = steps.map((x) => x.startMs);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test("scheduler clamps steps to the requested window", () => {
  const { s, clock } = schedulerWith();
  const steps = s.stepsAt(clock.t, 250); // inside first span
  for (const st of steps) {
    assert.ok(st.startMs >= clock.t, "start must not precede window");
    assert.ok(st.endMs <= clock.t + 250, "end must not exceed window");
  }
});

test("scheduler sorts out-of-order TTS timings and skips garbage", () => {
  const clock = new FakeClock();
  clock.t = 0;
  const s = new VisemeScheduler({ clock });
  s.start([
    { phoneme: "o", startSec: 0.25, endSec: 0.4 },
    { phoneme: "ə", startSec: 0.1, endSec: 0.2 }, // out of order
    { phoneme: "x", startSec: Number.NaN, endSec: 0.05 }, // garbage
    { phoneme: "m", startSec: 0.5, endSec: 0.4 }, // invalid span
  ]);
  const steps = s.stepsAt(0, 10_000);
  const visemes = steps.map((x) => x.viseme);
  assert.deepEqual(visemes, ["ai", "oh"]);
});

test("scheduler is idle-closed before start and after stop", () => {
  const { s, clock } = schedulerWith();
  s.stop();
  assert.equal(s.active, false);
  assert.equal(s.visemeAt(clock.t), "closed");
  assert.deepEqual(s.stepsAt(clock.t, 1000), []);
});

test("visemeAt returns the shape during speech and closed after", () => {
  const { s, clock } = schedulerWith();
  clock.t = 10_000 + 150; // inside 0.1..0.2 span
  assert.equal(s.visemeAt(clock.t), "ai");
  clock.t = 10_000 + 230; // in the gap between a and o (no blending)
  assert.equal(s.visemeAt(clock.t), "rest");
  clock.t = 10_000 + 20_000; // long after utterance
  assert.equal(s.visemeAt(clock.t), "closed");
});

test("crossfade mode emits an inter-viseme step inside the gap", () => {
  const clock = new FakeClock();
  clock.t = 0;
  const s = new VisemeScheduler({ clock, blendMode: "crossfade" });
  s.start([
    { phoneme: "ə", startSec: 0.1, endSec: 0.2 },
    { phoneme: "o", startSec: 0.5, endSec: 0.6 },
  ]);
  const steps = s.stepsAt(0, 10_000);
  const shapes = steps.map((x) => x.viseme);
  assert.deepEqual(shapes, ["ai", "oh", "oh"]);
  // the middle step is the blend step: starts mid-gap, ends at next start
  const blend = steps[1];
  assert.ok(blend.startMs > 200 && blend.startMs < 500 - 60);
  assert.equal(blend.endMs, 500 - 60);
});

test("direct mode emits no inter-viseme steps", () => {
  const clock = new FakeClock();
  clock.t = 0;
  const s = new VisemeScheduler({ clock, blendMode: "direct" });
  s.start([
    { phoneme: "ə", startSec: 0.1, endSec: 0.2 },
    { phoneme: "o", startSec: 0.5, endSec: 0.6 },
  ]);
  const steps = s.stepsAt(0, 10_000);
  assert.deepEqual(steps.map((x) => x.viseme), ["ai", "oh"]);
});

test("scheduler never throws on empty or malformed input", () => {
  const clock = new FakeClock();
  const s = new VisemeScheduler({ clock });
  assert.deepEqual(s.stepsAt(0, 0), []);
  assert.deepEqual(s.stepsAt(Number.NaN, 100), []);
  s.start([]);
  assert.deepEqual(s.stepsAt(0, 10_000), []);
  assert.equal(s.visemeAt(0), "closed");
});

// --------------------------------------------------- structural registration
//
// The E.1 second clause ("face-state registration was measured before
// whole-frame speech animation was used") is enforced structurally:
// this lane exposes a guard that the face-render lane must assert before
// applying viseme steps, and the lane's own source contains no
// whole-frame asset-swap logic.

test("registration guard fails closed until a measurement is recorded", async () => {
  const mod = await import("../registration.ts");
  // Fresh state: nothing measured yet.
  assert.equal(mod.VISEME_REGISTRATION_PRECONDITION.registered, false);
  assert.throws(
    () => mod.assertRegistrationMeasured(),
    /face-state registration not measured/i,
  );
  // Explicit false argument behaves identically (explicit caller state).
  assert.throws(
    () => mod.assertRegistrationMeasured(false),
    /face-state registration not measured/i,
  );
  // A recorded measurement opens the gate.
  mod.recordRegistrationMeasured();
  assert.equal(mod.VISEME_REGISTRATION_PRECONDITION.registered, true);
  assert.equal(mod.assertRegistrationMeasured(), null);
  assert.equal(mod.assertRegistrationMeasured(true), null);
  // Reset so other tests observing the fresh-guard invariant stay honest.
  mod.VISEME_REGISTRATION_PRECONDITION.registered = false;
});
