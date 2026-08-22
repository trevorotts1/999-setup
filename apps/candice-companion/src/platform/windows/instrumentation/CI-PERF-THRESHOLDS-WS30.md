# CI-PERF-THRESHOLDS-WS30 — Windows performance regression gate (PROPOSAL FRAGMENT)

Source lane: WR-016 WS-30 (`apps/candice-companion/src/platform/windows/instrumentation/**`).
Owner of application: integration owner (`manifest 9.4` — `.github/workflows/**` is
integration class; this lane ships the fragment, never applies it).

## What to apply

In the Windows performance smoke workflow step that runs the instrumentation
suite, add a step that verifies the WS-30 thresholds against the Windows x64
baseline. The machine-readable registry lives in
`apps/candice-companion/src/platform/windows/instrumentation/thresholds.ts`
(export `REGRESSION_THRESHOLDS`,
`PROVISIONAL_BASELINE_WINDOWS_X64_2026_08_21`,
`THRESHOLDS_SCHEMA_VERSION = 1`). A dedicated CI step should import that
registry — the CI fragment must not duplicate the numbers, so the lane and CI
cannot drift apart.

**Baseline status: PROVISIONAL, NOT a measured Windows baseline.** No real
Windows x64 measurement of the companion exists yet (no Windows runner in
this wave; app shell/speech stack not live). The registry numbers are a
declared placeholder anchored to the WS-24 macOS measured reference plus an
x64 allowance. Before Windows is labeled production-ready (WS-46 interactive
smoke gate), the WS-30 phase probe must be run on a modern Windows 10/11 x64
machine against the release artifact and this registry updated with the REAL
measured baseline through this lane only.

## Registry (authoritative; CI reads, never copies)

```ts
// PROVISIONAL placeholder baseline (anchored to WS-24 macOS measured
// reference + x64 allowance) — NOT a claimed Windows measurement.
// Real Windows x64 capture is release-blocking (WS-46 smoke gate).
PROVISIONAL_BASELINE_WINDOWS_X64_2026_08_21 = {
  platform: 'windows-x64',
  provisionalAt: '2026-08-21',
  basis: 'WS-24 macOS measured reference + x64 headroom allowance',
  idleCpuPercentMean: 0.5,   idleRssMiB: 74,
  speakingCpuPercentMean: 7.0, speakingRssMiB: 80,
  listeningCpuPercentMean: 10.5, listeningRssMiB: 78,
}

REGRESSION_THRESHOLDS = {
  idle:     { cpuMeanMax: 2.5,  cpuMaxMax: 10, rssMiBMax: 190 },
  speaking: { cpuMeanMax: 22,   cpuMaxMax: 65, rssMiBMax: 240 },
  listening:{ cpuMeanMax: 32,   cpuMaxMax: 85, rssMiBMax: 240 },
}
```

## Gate semantics

- A phase with no measurement window is a FAILURE (violation), never a skip
  (`verifyReport` behavior).
- All three phases (idle/speaking/listening) must pass for the step to be
  green (CHECKLIST E.1 WS-30: idle/speaking/listening CPU + RSS measured with
  native Windows APIs).
- Threshold adjustments happen ONLY through the WS-30 lane (CROSS-LANE-FINDING),
  never edited in `.github/workflows/**`.

## Runner note for the CI step

The suite is dependency-free plain Node (`node --test
"apps/candice-companion/src/platform/windows/instrumentation/__tests__/*.test.ts"`;
Node 26 requires the glob form — a bare directory path fails with "Cannot
find module"), Node >= 22.6 (Node 26 strips types natively; older Node needs
`--experimental-strip-types`). Runs in any CI container without the app
toolchain; live native measurement additionally requires a Windows runner.
