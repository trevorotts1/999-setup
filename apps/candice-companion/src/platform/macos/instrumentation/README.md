# WS-24 — macOS resource/performance instrumentation

Owned lane: `apps/candice-companion/src/platform/macos/instrumentation/**`
(PROJECT-MANIFEST 9.2, WR-015 row, WS-24 glob). Apple Silicon reference
platform (Master Spec 0.3: "optimize/measure idle resource use on Apple
Silicon because this is the dominant fleet").

## What is proven

CHECKLIST E.1 WS-24: "idle/speaking/listening CPU + RSS measured on Apple
Silicon; regression thresholds present in CI."

1. CPU percent of one core measured from real process CPU deltas
   (`process.cpuUsage`) over wall time (`process.hrtime`) — never an
   approximation, never invented.
2. RSS measured in MiB (`process.memoryUsage().rss`, 1024-based, matching
   `ps -o rss` semantics on macOS).
3. Windowed sampling: N samples at fixed interval over a phase window,
   with mean/max aggregates.
4. Phase classification: WS-08 statuses map onto the three measured phases
   (idle/speaking/listening) via `nearestPhase`; the app window title is
   the phase carrier and the probe contract is stable
   (`Candice — Idle|Speaking|Listening`), read-only over the window
   system, permission-free in the default in-process mode.
5. Regression thresholds present, schema-versioned, machine-readable:
   `thresholds.ts` is the single source; the JSON registry is derived;
   `CI-PERF-THRESHOLDS-WS24.md` is the CI proposal fragment for the
   integration owner (`.github/workflows/**` is 9.4 shared — never
   applied by this lane).
6. Measured-baseline discipline (spec 19): thresholds are generous
   multiples of the re-measured EMULATED 2026-08-21 reference baseline
   (`baseline-capture.mjs`; provisional — real engine footprint lands
   when WS-45's phase-enforcing harness exists), not hardcoded
   unrealistic targets.

## Run

```bash
cd apps/candice-companion

# Unit tests (Node 26 strips types natively; Node 22/23 use
# --experimental-strip-types)
node --test src/platform/macos/instrumentation/__tests__/sampler.test.ts \
  src/platform/macos/instrumentation/__tests__/thresholds.test.ts \
  src/platform/macos/instrumentation/__tests__/window-probe.test.ts

# Live self-measurement of the current process (operator reference
# instrument; measures the measuring process itself)
node src/platform/macos/instrumentation/measure.mjs --duration-ms 5000 --interval-ms 500
```

## Files

| File | Purpose |
|---|---|
| `sampler.ts` | CPU/RSS sampling core (injectable process reader, pure math) |
| `thresholds.ts` | Measured baseline + regression thresholds + check/verify |
| `thresholds-registry.ts` | Machine-readable JSON registry (derived, schema-versioned) |
| `window-probe.ts` | Window-title phase probe (permission-free default) |
| `measure.mjs` | Live measurement CLI (operator/CI instrument) |
| `index.ts` | Public facade — the one import the rest of the app uses |
| `CI-PERF-THRESHOLDS-WS24.md` | CI fragment PROPOSAL for the integration owner (9.4) |
| `__tests__/` | Node built-in test suites (no test-runner dependency) |

## Degradation contract (spec 20)

Every entry point is total. A dead instrument yields an `error` field on
the window sample and a `null` phase with a one-line note from the probe —
the companion UI never depends on instrumentation, and no Candice failure
may stop Claude.
