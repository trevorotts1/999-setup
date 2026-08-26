/**
 * Minimal timer helper (Master Spec 0E WS-13, spec section 24).
 *
 * Pause-safe in the background because Tauri (like any desktop shell)
 * throttles hidden pages — requestAnimationFrame alone can freeze, so
 * blend ticks carry a real timestamp and compute per-tick progress from
 * it. `setInterval` is the only timer type; never the static
 * `performance.now`, never `Date.now` inside the reducer-shaped callbacks
 * (WS-08 determinism is respected by shape even though gesture ticks are
 * presentation, not the state machine).
 *
 * Every schedule call returns a handle with a `cancel()` that is idempotent
 * and null-safe: the loop detaches everything on teardown.
 *
 * @module
 */

export interface ScheduledLoop {
  /** Cancels the loop. Idempotent; safe to call repeatedly. */
  cancel(): void;
  readonly cancelled: boolean;
}

/** Clock interface so tests can drive time deterministically. */
export interface Clock {
  now(): number;
}

/** Default clock: millisecond epoch counter, monotonic where available. */
export function monotonicClock(): Clock {
  return { now: () => performance.now() };
}

/**
 * Schedule a fixed-interval loop with a real elapsed-ms delta per tick.
 * The first tick fires after `intervalMs`; the callback always receives a
 * positive delta (min 1) and is never re-entered.
 */
export function scheduleLoop(
  intervalMs: number,
  tick: (elapsedMs: number) => void,
  clock: Clock = monotonicClock(),
): ScheduledLoop {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('scheduleLoop: intervalMs must be a positive number');
  }
  let cancelled = false;
  let last = clock.now();
  const id = setInterval(() => {
    if (cancelled) return;
    const now = clock.now();
    const elapsed = Math.max(1, now - last);
    last = now;
    tick(elapsed);
  }, intervalMs);
  return {
    get cancelled() {
      return cancelled;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      clearInterval(id);
    },
  };
}

/**
 * Delay helper with an early-cancel contract (blink closed-eye hold,
 * gesture hold, debounces). The callback never fires after cancel.
 */
export function scheduleDelay(
  delayMs: number,
  done: () => void,
): ScheduledLoop {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    throw new Error('scheduleDelay: delayMs must be a positive number');
  }
  let cancelled = false;
  const id = setTimeout(() => {
    if (cancelled) return;
    cancelled = true;
    done();
  }, delayMs);
  return {
    get cancelled() {
      return cancelled;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(id);
    },
  };
}
