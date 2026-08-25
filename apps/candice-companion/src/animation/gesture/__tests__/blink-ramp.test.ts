/**
 * Regression cover for the "blink is a 240ms hard cut" defect (WS-13).
 *
 * `gesture.test.ts` proved `eyeOpenRatio` produces a cosine ramp. The ramp
 * was still never rendered, because the driver only ever fed it three
 * quantized values — `{1, 0.5, 0}` — and `cos(0.5 * PI)` is zero, so TWO of
 * those three rendered fully closed. The eyelid snapped shut for 240ms and
 * snapped open again.
 *
 * The unit test could not catch it: it sampled `eyeOpenRatio(0.5)` and
 * required only `> 0`, which the float residue `6.123233995736766e-17`
 * satisfies. A test green on a floating-point epsilon certified a visual
 * behaviour that did not exist.
 *
 * So these tests assert the COMPOSED expression the driver evaluates —
 * `eyeOpenRatio(blinkClosedUnits(t))` — sampled across a real blink, plus
 * the interval schedule. `driver-continuous.test.ts` separately proves the
 * blink loop reaches `[data-candice-eye]`; together they cover calculator,
 * composition, and delivery.
 *
 *   node --test --experimental-strip-types \
 *     apps/candice-companion/src/animation/gesture/__tests__/blink-ramp.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GESTURE_TIMING } from '../config.ts';
import { blinkClosedUnits, blinkIntervalMs, blinkSpanMs, eyeOpenRatio } from '../motion.ts';

/** Exactly what the driver's blink loop computes for a given time offset. */
const eyelidAt = (t: number): number => eyeOpenRatio(blinkClosedUnits(t));

test('blink: the eyelid passes through visibly partial positions', () => {
  const span = blinkSpanMs();
  const samples: number[] = [];
  for (let t = 0; t <= span; t += 4) samples.push(eyelidAt(t));

  // The defect rendered ONLY 1 and 0 — never anything between. Requiring a
  // healthy count of genuinely intermediate frames is what the old
  // `> 0 && < 1` bound failed to do, because 6e-17 satisfied it.
  const partial = samples.filter((v) => v > 0.05 && v < 0.95);
  assert.ok(
    partial.length >= 8,
    `blink must ramp through partial eyelid positions, got ${partial.length} of ${samples.length}`,
  );

  assert.ok(Math.max(...samples) > 0.95, 'blink must reach fully open');
  assert.ok(Math.min(...samples) < 0.05, 'blink must reach fully closed');
});

test('blink: closes and reopens — a ramp in BOTH directions', () => {
  const close = GESTURE_TIMING.blinkCloseMs;
  const hold = GESTURE_TIMING.blinkClosedMs;

  // Closing sweep must strictly decrease.
  const closing = [0, close * 0.25, close * 0.5, close * 0.75].map(eyelidAt);
  for (let i = 1; i < closing.length; i += 1) {
    assert.ok(
      closing[i]! < closing[i - 1]!,
      `closing must descend; step ${i} went ${closing[i - 1]} -> ${closing[i]}`,
    );
  }

  // Fully closed across the hold.
  assert.ok(eyelidAt(close + hold * 0.5) < 0.05, 'eye must be shut during the hold');

  // Opening sweep must strictly increase — the old code had no open ramp at
  // all, it jumped straight from shut to open.
  const base = close + hold;
  const opening = [base + 15, base + 30, base + 45, base + 59].map(eyelidAt);
  for (let i = 1; i < opening.length; i += 1) {
    assert.ok(
      opening[i]! > opening[i - 1]!,
      `opening must ascend; step ${i} went ${opening[i - 1]} -> ${opening[i]}`,
    );
  }
});

test('blink: fully open outside the blink span, and never negative', () => {
  assert.equal(eyelidAt(-500), 1, 'resting between blinks');
  assert.equal(eyelidAt(0), 1, 'open at the instant the blink begins');
  assert.equal(eyelidAt(blinkSpanMs() + 1), 1, 'open once the blink is over');
  for (let t = -50; t <= blinkSpanMs() + 50; t += 3) {
    const v = eyelidAt(t);
    assert.ok(v >= 0 && v <= 1, `eyelid out of range at t=${t}: ${v}`);
  }
});

test('blink interval is irregular, not a metronome, and stays in range', () => {
  const gaps = Array.from({ length: 40 }, (_, i) => blinkIntervalMs(i));

  for (const [i, g] of gaps.entries()) {
    assert.ok(
      g >= GESTURE_TIMING.blinkIntervalMinMs && g <= GESTURE_TIMING.blinkIntervalMaxMs,
      `gap ${i} outside the configured range: ${g}`,
    );
  }

  // A fixed period is exactly what read as mechanical. Consecutive gaps
  // must actually differ, and the spread must be wide enough to perceive.
  for (let i = 1; i < gaps.length; i += 1) {
    assert.notEqual(gaps[i], gaps[i - 1], `gaps ${i - 1} and ${i} are identical`);
  }
  const spread = Math.max(...gaps) - Math.min(...gaps);
  assert.ok(spread > 1_000, `blink rhythm is too even to read as alive: ${spread}ms spread`);

  // Deterministic: same index, same gap. This is what makes an irregular
  // rhythm testable at all.
  assert.equal(blinkIntervalMs(7), blinkIntervalMs(7));
  assert.equal(blinkIntervalMs(0), gaps[0]);
});
