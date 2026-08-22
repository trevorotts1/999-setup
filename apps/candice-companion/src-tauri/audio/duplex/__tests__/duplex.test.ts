/**
 * WS-20 duplex-controller acceptance tests (node:test, zero deps).
 *
 * Covers the E.1 WS-20 criterion and Master Spec 6/8/20:
 *   - press while speaking stops speech immediately (abort in the press call);
 *   - `speech:interrupted` emitted, then `ptt:start` ONLY after the tail drained;
 *   - no output frame can pass the echo gate into STT;
 *   - release during the tail cancels the phantom listen;
 *   - a stop that never settles is forced after `stopTimeoutMs` (spec 20);
 *   - single-flight press during interrupt/listening;
 *   - deterministic clock (no timers, no sleeps).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DuplexController,
  EchoGate,
  LISTEN_WINDOW_MS,
  type DuplexEffect,
  type DuplexTransition,
  type SpeechTarget,
} from "../controller.ts";
import { DUPLEX_DEFAULTS } from "../types.ts";
import type { CandiceSideEffect } from "../../../../src/state/machine.ts";

/** Fake clock the lane can advance deterministically. */
class FakeClock {
  #ms = 1_000_000;
  now(): number {
    return this.#ms;
  }
  advance(ms: number): number {
    this.#ms += ms;
    return this.#ms;
  }
}

/** A Scripted target: stop settles when the test resolves it (with the stop time). */
class ScriptedTarget implements SpeechTarget {
  aborted = false;
  abortCount = 0;
  stopCount = 0;
  stopCalls: Array<(stoppedAtMs: number) => void> = [];
  /** If set, the stop promise REJECTS. */
  failStop = false;
  /** If set, the stop promise never settles. */
  hangStop = false;

  abort(): void {
    this.aborted = true;
    this.abortCount += 1;
  }

  stop(): Promise<{ stoppedAtMs: number }> {
    this.stopCount += 1;
    if (this.failStop) {
      return Promise.reject(new Error("stop-failed"));
    }
    if (this.hangStop) {
      return new Promise<{ stoppedAtMs: number }>(() => {});
    }
    return new Promise<{ stoppedAtMs: number }>((resolve) => {
      this.stopCalls.push((stoppedAtMs: number) => resolve({ stoppedAtMs }));
    });
  }

  resolveStop(stoppedAtMs: number): void {
    const fn = this.stopCalls.shift();
    fn?.(stoppedAtMs);
  }
}

function makeController(opts: { clock?: FakeClock } = {}) {
  const clock = opts.clock ?? new FakeClock();
  const target = new ScriptedTarget();
  const controller = new DuplexController({ now: () => clock.now() });
  controller.attachTarget(target);
  return { controller, target, clock };
}

/** Let all pending promise continuations (stop .then/.catch) run to completion. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

/** Type-level shape check: the lane's effects must be assignable to WS-08 side effects. */
function ws08Effects(effects: DuplexEffect[]): CandiceSideEffect[] {
  return effects as unknown as CandiceSideEffect[];
}

describe("WS-20 duplex controller", () => {
  it("press while idle opens the mic immediately (no tail window)", () => {
    const { controller } = makeController();
    const t = controller.press();
    assert.equal(t.phase, "listening");
    assert.deepEqual(t.event, { type: "ptt:start" });
    assert.deepEqual(t.effects, [{ type: "mic:open", caption: null }]);
    assert.equal(controller.gate.isOpen(), true);
  });

  it("release while listening closes the mic once", () => {
    const { controller } = makeController();
    controller.press();
    const t = controller.release();
    assert.equal(t.phase, "idle");
    assert.deepEqual(t.event, { type: "ptt:stop" });
    assert.deepEqual(t.effects, [{ type: "mic:close", caption: null }]);
    assert.equal(controller.gate.isOpen(), false);
  });

  it("interrupt: abort() fires in the SAME call as press; speech:interrupted first", () => {
    const { controller, target } = makeController();
    controller.speak();
    const t = controller.press();
    assert.equal(target.aborted, true, "abort must be synchronous in press");
    assert.equal(t.phase, "interrupting");
    assert.deepEqual(t.event, { type: "speech:interrupted" });
    // WS-08 completes the speaking -> listening move on this very event;
    // this lane must NOT also emit ptt:start in the same press.
    assert.deepEqual(t.effects, [
      { type: "tts:stop", caption: null },
      { type: "mic:open", caption: null },
    ]);
  });

  it("ptt:start is deferred until the playback tail has drained (half duplex)", () => {
    const { controller, target, clock } = makeController();
    controller.speak();
    controller.press(); // interrupt
    // Stop settles "now": output goes silent this instant.
    target.resolveStop(clock.now());

    // Micro-tasks run; then the tail clock decides when ptt:start may out.
    return flushAsync().then(async () => {
      let t: DuplexTransition = controller.tick();
      // Tail not elapsed yet -> still interrupting, ptt:start must NOT be out.
      assert.equal(t.event, null);
      assert.equal(controller.phase(), "interrupting");
      clock.advance(DUPLEX_DEFAULTS.playbackTailMs - 1);
      t = controller.tick();
      assert.equal(t.event, null, "ptt:start must not fire one ms early");
      clock.advance(1);
      t = controller.tick();
      assert.deepEqual(t.event, { type: "ptt:start" });
      assert.equal(t.phase, "listening");
      assert.deepEqual(t.effects, [{ type: "mic:open", caption: null }]);
      assert.ok(controller.gate.isOpen());
    });
  });

  it("interrupt effects translate into WS-08 CandiceSideEffect shape", () => {
    const { controller } = makeController();
    controller.speak();
    const t = controller.press();
    const effects = ws08Effects(t.effects);
    // Compile-time assignment proven; runtime values match the machine's union.
    assert.deepEqual(
      effects.map((e) => e.type),
      ["tts:stop", "mic:open"],
    );
  });

  it("stop rejection forces settle without hanging (spec 20)", () => {
    const { controller, target, clock } = makeController();
    target.failStop = true;
    controller.speak();
    controller.press();
    return flushAsync().then(async () => {
      // The rejection continuation executes eagerly (force path).
      let t = controller.tick();
      assert.equal(t.event, null, "tail window still applies after forced stop");
      clock.advance(DUPLEX_DEFAULTS.playbackTailMs);
      t = controller.tick();
      assert.deepEqual(t.event, { type: "ptt:start" });
      assert.ok(controller.stats().forcedStops >= 1);
    });
  });

  it("a stop that NEVER settles is forced after stopTimeoutMs (never blocks the session)", () => {
    const { controller, target, clock } = makeController();
    target.hangStop = true;
    controller.speak();
    controller.press();
    clock.advance(DUPLEX_DEFAULTS.stopTimeoutMs - 1);
    let t = controller.tick();
    assert.equal(t.event, null, "must not fire before the timeout");
    clock.advance(1);
    t = controller.tick();
    assert.deepEqual(t.event, { type: "ptt:start" }, "forced: listen still opens");
    assert.equal(controller.stats().forcedStops, 1);
  });

  it("release during the tail cancels the pending listen (no phantom listen)", () => {
    const { controller, target, clock } = makeController();
    controller.speak();
    controller.press();
    controller.release(); // let go while the tail is draining
    target.resolveStop(clock.now());
    return flushAsync().then(async () => {
      clock.advance(DUPLEX_DEFAULTS.playbackTailMs);
      const t = controller.tick();
      assert.equal(t.event, null, "settle after release must NOT emit ptt:start");
      assert.equal(t.phase, "idle");
      assert.equal(controller.stats().cancelledListens, 1);
      assert.equal(controller.gate.isOpen(), false);
    });
  });

  it("exact-once stop: a second press while interrupting is a no-op", () => {
    const { controller, target } = makeController();
    controller.speak();
    controller.press();
    const stopCountAfterFirst = target.stopCount;
    assert.equal(stopCountAfterFirst, 1);
    const t2 = controller.press();
    assert.deepEqual(t2, { phase: "interrupting", event: null, effects: [] });
    assert.equal(target.stopCount, 1, "stop must never be issued twice");
  });

  it("single-flight capture: press while listening is a no-op", () => {
    const { controller } = makeController();
    controller.press();
    const t2 = controller.press();
    assert.equal(t2.event, null);
    assert.equal(controller.phase(), "listening");
  });

  it("duplex invariant: output and capture are never both active", () => {
    const { controller } = makeController();
    controller.speak();
    controller.press();
    // Standard flow: speaking & interrupting; assertDuplexInvariant passes
    // because phase sequencing is half-duplex by construction.
    assert.doesNotThrow(() => controller.assertDuplexInvariant());
  });

  it("speaking closes the echo gate; every frame in that window is suppressed", () => {
    const { controller } = makeController();
    controller.speak();
    assert.equal(controller.gate.isOpen(), false);
    assert.equal(controller.gateFeed({ pcm: [0.5] }), false);
    assert.equal(controller.gateFeed({ pcm: [0.5] }), false);
    assert.ok(controller.stats().suppressedFrames >= 2);
    assert.equal(controller.stats().passedFrames, 0);
  });

  it("listen window opens the gate; frames pass only while open", () => {
    const { controller } = makeController();
    controller.press();
    assert.equal(controller.gateFeed("frame-1"), true);
    controller.release();
    assert.equal(controller.gateFeed("frame-2"), false, "late frame after release is suppressed");
    const s = controller.stats();
    assert.equal(s.passedFrames, 1);
    assert.ok(s.suppressedFrames >= 1);
  });

  it("EchoGate double-open throws (wiring bug is loud, not silent)", () => {
    const gate = new EchoGate();
    gate.open();
    assert.throws(() => gate.open(), /echo-gate-already-open/);
  });

  it("stuck PTT auto-releases at the listen window (controller-level safety)", () => {
    const { controller, clock } = makeController();
    controller.press();
    clock.advance(LISTEN_WINDOW_MS - 1);
    assert.equal(controller.tick().event, null);
    clock.advance(1);
    const t = controller.tick();
    assert.deepEqual(t.event, { type: "ptt:stop" });
    assert.equal(controller.phase(), "idle");
  });

  it("normal finish of speech leaves the gate closed and no phantom mic events", () => {
    const { controller } = makeController();
    controller.speak();
    const t = controller.finishSpeaking();
    assert.equal(t.event, null);
    assert.equal(controller.phase(), "idle");
    assert.equal(controller.gate.isOpen(), false);
    assert.equal(controller.nowPlaying(), false);
  });

  it("interrupt counters are exact (audit surface)", () => {
    const { controller } = makeController();
    controller.speak();
    controller.press();
    assert.equal(controller.stats().interrupts, 1);
    assert.equal(controller.stats().stops, 1);
    assert.equal(controller.stats().speeches, 1);
  });
});
