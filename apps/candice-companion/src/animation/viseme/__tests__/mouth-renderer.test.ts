/**
 * Outcome tests for the viseme→mouth renderer.
 *
 * These drive the REAL `VisemeScheduler` over real phoneme timings and
 * assert what a person would see on the bust: the mouth changes shape while
 * a sentence is being spoken, and it is closed at every other moment. They
 * deliberately do not assert internals — a renderer that satisfied the
 * mechanism but left the mouth frozen would pass a mechanism test and fail
 * every test here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MOUTH_STATE_FOR_VISEME,
  NEUTRAL_MOUTH_STATE,
  createMouthRenderer,
} from "../mouth-renderer.ts";
import { VisemeScheduler } from "../scheduler.ts";

/**
 * Phonemes chosen so consecutive spans resolve to DIFFERENT cutouts, and
 * spelled in the alphabet the pinned TTS actually emits.
 *
 * This fixture used to read a / o / aa / m. Only two of those are real
 * espeak-ng output: "aa" is ARPAbet and never arrives, and bare "a" is the
 * open vowel of "my", not the mid vowel this row wants. A fixture written
 * in an alphabet the app never receives is how the dead-mouth bug survived
 * a passing test.
 */
const UTTERANCE = [
  { phoneme: "ə", startSec: 0.0, endSec: 0.2 }, // ai   -> open-small  (schwa, "hello")
  { phoneme: "o", startSec: 0.2, endSec: 0.4 }, // oh   -> open-medium (rounded, "go")
  { phoneme: "æ", startSec: 0.4, endSec: 0.6 }, // wide -> open-wide   ("cat")
  { phoneme: "m", startSec: 0.6, endSec: 0.8 }, // mm   -> closed      (lips together)
];

interface Harness {
  advanceTo(ms: number): void;
  tick(): void;
  writes: string[];
  scheduler: VisemeScheduler;
  renderer: ReturnType<typeof createMouthRenderer>;
  setVisible(v: boolean): void;
  setMotionOff(v: boolean): void;
  cancelled(): boolean;
}

function makeHarness(surfaceThrows = false): Harness {
  let t = 0;
  let visible = true;
  let motionOff = false;
  let cancelled = false;
  let captured: ((elapsedMs: number) => void) | null = null;
  const writes: string[] = [];

  const clock = { now: () => t };
  const scheduler = new VisemeScheduler({ clock });

  const surface = {
    setMouthState(state: string) {
      if (surfaceThrows) throw new Error("surface is gone");
      writes.push(state);
    },
    get visible() {
      return visible;
    },
  };

  const renderer = createMouthRenderer({
    scheduler,
    surface,
    clock,
    motionOff: () => motionOff,
    schedule: (_ms, fn) => {
      captured = fn;
      return {
        cancel() {
          cancelled = true;
        },
        get cancelled() {
          return cancelled;
        },
      };
    },
  });

  return {
    advanceTo(ms: number) {
      t = ms;
    },
    tick() {
      captured?.(16);
    },
    writes,
    scheduler,
    renderer,
    setVisible(v: boolean) {
      visible = v;
    },
    setMotionOff(v: boolean) {
      motionOff = v;
    },
    cancelled() {
      return cancelled;
    },
  };
}

test("the mouth changes shape while a sentence is being spoken", () => {
  const h = makeHarness();
  h.scheduler.start(UTTERANCE);
  h.renderer.start();

  const seen: string[] = [];
  for (const ms of [100, 300, 500, 700]) {
    h.advanceTo(ms);
    h.tick();
    seen.push(h.renderer.currentState);
  }

  assert.deepEqual(seen, [
    MOUTH_STATE_FOR_VISEME.ai,
    MOUTH_STATE_FOR_VISEME.oh,
    MOUTH_STATE_FOR_VISEME.wide,
    MOUTH_STATE_FOR_VISEME.mm,
  ]);
  assert.ok(
    new Set(seen).size >= 3,
    `mouth only reached ${new Set(seen).size} distinct shapes across the ` +
      `utterance; a mouth that barely moves is not lip sync`,
  );
});

test("the mouth is closed before a word is ever spoken", () => {
  const h = makeHarness();
  h.renderer.start();
  h.advanceTo(50);
  h.tick();
  assert.equal(h.renderer.currentState, NEUTRAL_MOUTH_STATE);
});

test("the mouth returns to neutral the instant playback ends", () => {
  const h = makeHarness();
  h.scheduler.start(UTTERANCE);
  h.renderer.start();
  h.advanceTo(300);
  h.tick();
  assert.notEqual(h.renderer.currentState, NEUTRAL_MOUTH_STATE);

  // Natural end: speech-drain stops the scheduler.
  h.scheduler.stop();
  h.tick();
  assert.equal(
    h.renderer.currentState,
    NEUTRAL_MOUTH_STATE,
    "mouth stayed open after audio finished",
  );
});

test("the mouth closes even if drain/boundary NEVER fire (playback panic)", () => {
  // engines.rs emits drain on natural end and boundary on interrupt, and the
  // branch is exhaustive — but a panic inside play_f32_pcm would kill the
  // playback thread before either fires, leaving the scheduler started with
  // stale events. The mouth must still close. It does, and NOT because of a
  // timeout I invented: past the last scheduled span the scheduler's own
  // event horizon returns "closed", so the worst case is bounded by the
  // utterance's own length.
  const h = makeHarness();
  h.scheduler.start(UTTERANCE);
  h.renderer.start();
  h.advanceTo(300);
  h.tick();
  assert.notEqual(h.renderer.currentState, NEUTRAL_MOUTH_STATE, "mouth should be moving");

  // No scheduler.stop() — simulate the drain that never arrives.
  h.advanceTo(900); // past the 0.8s utterance end
  h.tick();
  assert.equal(
    h.renderer.currentState,
    NEUTRAL_MOUTH_STATE,
    "mouth hung open after the utterance elapsed with no drain event",
  );
});

test("interrupting parks the mouth closed without waiting for a tick", () => {
  const h = makeHarness();
  h.scheduler.start(UTTERANCE);
  h.renderer.start();
  h.advanceTo(500);
  h.tick();
  assert.notEqual(h.renderer.currentState, NEUTRAL_MOUTH_STATE);

  h.renderer.stop();
  assert.equal(h.renderer.currentState, NEUTRAL_MOUTH_STATE);
  assert.equal(h.writes.at(-1), NEUTRAL_MOUTH_STATE);
  assert.equal(h.renderer.running, false);
});

test("animation off holds the mouth closed mid-utterance", () => {
  const h = makeHarness();
  h.scheduler.start(UTTERANCE);
  h.renderer.start();
  h.setMotionOff(true);
  h.advanceTo(500);
  h.tick();
  assert.equal(
    h.renderer.currentState,
    NEUTRAL_MOUTH_STATE,
    "lip sync is animation; the toggle and reduced motion must stop it",
  );
});

test("a hidden bust holds the mouth closed", () => {
  const h = makeHarness();
  h.scheduler.start(UTTERANCE);
  h.renderer.start();
  h.setVisible(false);
  h.advanceTo(500);
  h.tick();
  assert.equal(h.renderer.currentState, NEUTRAL_MOUTH_STATE);
});

test("a failing surface stops the renderer instead of throwing out of a tick", () => {
  const h = makeHarness(true);
  h.scheduler.start(UTTERANCE);
  h.renderer.start();
  h.advanceTo(300);
  assert.doesNotThrow(() => h.tick(), "a render tick must never throw (spec 20)");
  assert.equal(h.renderer.running, false, "renderer kept polling a dead surface");
});

test("the renderer does not rewrite the same cutout every tick", () => {
  const h = makeHarness();
  h.scheduler.start(UTTERANCE);
  h.renderer.start();
  h.advanceTo(100);
  for (let i = 0; i < 8; i++) h.tick();
  assert.equal(
    h.writes.length,
    1,
    `swapped the layer ${h.writes.length} times for one unchanged viseme`,
  );
});

test("every viseme resolves to an operator-approved cutout", () => {
  const reg = JSON.parse(
    readFileSync(
      new URL("../../../../assets/candice/layers/build/registration.json", import.meta.url),
      "utf8",
    ),
  );
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../../assets/candice/layers/build/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const approvedFiles = new Set(
    manifest.layers
      .filter(
        (l: { approval?: string; synthesized?: boolean }) =>
          l.approval === "operator-approved" && l.synthesized !== true,
      )
      .map((l: { file: string }) => l.file),
  );

  for (const [viseme, state] of Object.entries(MOUTH_STATE_FOR_VISEME)) {
    const entry = reg.mouthStates[state];
    assert.ok(entry, `viseme "${viseme}" -> unknown mouth state "${state}"`);
    assert.ok(
      approvedFiles.has(entry.file),
      `viseme "${viseme}" would mount "${entry.file}", which is not an ` +
        `operator-approved, non-synthesized layer`,
    );
  }

  const neutral = reg.mouthStates[NEUTRAL_MOUTH_STATE];
  assert.equal(neutral.source, "03", "neutral must be 03-mouth-neutral-closed");
  assert.ok(approvedFiles.has(neutral.file));
});
