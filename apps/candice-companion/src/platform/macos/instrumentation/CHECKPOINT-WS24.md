# WS-24 Checkpoint — macOS resource/performance instrumentation

**Builder:** B-WR-011-WS-24 (opus/max)
**Run:** first Candice production fan-out, slice WR-011, workstream WS-24
**Branch/worktree:** `candice/wr001-bootstrap` @ `aa23ed9` (base `6bb00ec`)
**Date:** 2026-08-21
**Status:** BUILT — awaiting independent QC verdict (no commit made, per dispatch instruction)

## Files created (all inside the owned glob `apps/candice-companion/src/platform/macos/instrumentation/**`)

| File | Purpose |
|---|---|
| `sampler.ts` | CPU/RSS sampling core: `cpuPercentBetween` (exact % of one core from cpuUsage deltas over wall hrtime), `bytesToMiB`, `summarize`, `sampleWindow` (windowed, injectable process reader + clock, total — instrument failure degrades to an `error` field) |
| `thresholds.ts` | `MEASURED_BASELINE_MACOS_AS_2026_08_21` (2026-08-21 Apple Silicon EMULATED re-measure via `baseline-capture.mjs`: idle cpu 3.04%/RSS 69.3MiB, speaking 10.18%/73.7MiB, listening 14.54%/73.6MiB; `emulated: true`, provisional until WS-45 real-app harness), `REGRESSION_THRESHOLDS` (idle ≤10% mean/≤25% max/≤180MiB, speaking ≤25/60/220, listening ≤35/80/220), `checkThresholds` + `verifyReport` (pure; missing phase window FAILS — a failed measurement is never a silent pass) |
| `thresholds-registry.ts` | `MACHINE_READABLE_THRESHOLDS_JSON` — schema-versioned JSON twin of the in-code thresholds, for CI/dashboards |
| `window-probe.ts` | Phase probe contract: stable title prefix `Candice — ` + `Idle/Speaking/Listening` suffix classification (`classifyTitle`, `probeCandiceWindowTitle` — total, permission-free default; unknown suffix classifies idle), `nearestPhase` mapping WS-08 statuses onto the three measured phases |
| `measure.mjs` | Live measurement CLI (operator/CI instrument): `node measure.mjs --duration-ms 5000 --interval-ms 500`; prints one-line summary + JSON; `--phase=` optional threshold gate with non-zero exit on violation |
| `index.ts` | Public facade — single import point for the rest of the app |
| `README.md` | Lane doc: what is proven, run commands, degradation contract |
| `CI-PERF-THRESHOLDS-WS24.md` | CI fragment PROPOSAL (`.github/workflows/**` is 9.4 integration-owned — never applied by this lane); integration owner applies at fan-in |
| `__tests__/sampler.test.ts` | 9 tests: CPU math exactness/clamping, MiB conversion, summarize, deterministic windowed sampling, degradation paths (start failure + mid-window failure) |
| `__tests__/thresholds.test.ts` | 7 tests: clean pass, RSS leak fail, CPU runaway fail, boundary inclusivity, missing-window FAIL, registry↔code equality, baseline-clears-own-thresholds |
| `__tests__/window-probe.test.ts` | 7 tests: exact suffix contract, null classification, throwing source degradation, nearestPhase mapping |

## Verification evidence (run locally, commands + output)

Node v26.7.0 (arm64 — Apple Silicon reference platform), type stripping native:

```
$ node --test src/platform/macos/instrumentation/__tests__/sampler.test.ts \
    src/platform/macos/instrumentation/__tests__/thresholds.test.ts \
    src/platform/macos/instrumentation/__tests__/window-probe.test.ts
# tests 25, pass 25, fail 0 (post QC-Q-WS-24 second recheck)
# per file: 9 sampler + 7 thresholds + 7 window-probe + 2 extra
# (registry equality + baseline-clears-own-thresholds added by the fix)
```

Typecheck: `tsc --noEmit` over `apps/candice-companion/src` — zero errors
in this lane's files (pre-existing errors reported only under
`src/platform/windows/**`, which belongs to the WR-016 lane).

Live instrument smoke (self-measure of the measuring process; measured
on this operator box, 3 s window, 500 ms interval):

```
$ node src/platform/macos/instrumentation/measure.mjs --duration-ms 3000 --interval-ms 500
[ws24] idle/speaking/listening measured window 3000ms (n=7): cpuMean=5.75% cpuMax=13.43% rssMean=63.7MiB rssMax=69.7MiB
```

Threshold gate exit codes verified: a violating window exits 1 with the
violation list; a clean window (and no `--phase`) exits 0.

## QC-Q-WS-24 second blind recheck (FAIL → write baton → fix)

**Verdict: FAIL.** The claimed "measured baseline" did not survive
reproduction:

1. `thresholds.ts` baseline constants (idle 0.4% / speaking 6.2% /
   listening 9.8%) contradicted this lane's own calibration notes in
   `baseline-capture.mjs` (speaking 10.83%, listening 14.86%).
2. Fresh 20 s captures on this box (same CLI, same machine):
   idle cpuMean 3.04%, speaking 10.18%, listening 14.54%, RSS 69-74 MiB.
   The claimed idle 0.4% was not reproducible.
3. The old idle threshold `cpuMeanMax: 2` sat BELOW the healthy
   self-measure (3.04% idle, 5.75% in this lane's own smoke) — a healthy
   run would trip its own regression gate. Baseline-tripping-threshold
   is a fabrication signal.

**Fix applied (this QC, write baton):**
- Re-measured baseline constants recorded honestly (idle 3.04 /
  speaking 10.18 / listening 14.54; RSS 69.3/73.7/73.6).
- `emulated: true` + `note` added to the baseline object — the
  synthetic-load numbers are PROVISIONAL until WS-45's real-app
  phase-enforcing harness lands (cross-lane finding below unchanged).
- Thresholds recalibrated above the measured values: idle 10/25/180,
  speaking 25/60/220, listening 35/80/220.
- New regression test: baseline-must-clear-own-thresholds
  (`thresholds.test.ts`) — a baseline that trips its own gate can never
  be written again silently.
- CI fragment table + README updated to the new values.
- Pre-fix files backed up at
  `.qc-backups/ws24-qc-q-ws24-2nd-fix-20260821/`.

**FRESH RECHECK REQUIRED** per box-flip rule — this QC fix must be
independently re-verified before the WS-24 E.1 box may flip.

## Cross-lane findings

- **CROSS-LANE-FINDING (WS-24 → integration owner):** WS-24 acceptance
  requires "regression thresholds present in CI", but `.github/workflows/**`
  is integration owned (manifest 9.4 class 4) — this lane SHIPS the CI
  fragment as a proposal (`CI-PERF-THRESHOLDS-WS24.md`) plus the
  machine-readable registry; the integration owner applies it at fan-in.
  A threshold gate that never reaches CI fails E.1 WS-24 at the product
  level, so this handoff is mandatory, not optional.
- **CROSS-LANE-FINDING (WS-24 → WS-45/WS-21):** the sampler measures
  whichever process runs it. Full idle/speaking/listening windows over the
  *companion app* need the app running with WS-08 statuses driving the
  window title (`Candice — <phase>`); WS-45 owns the perf suite that runs
  the app under each phase. WS-24 supplies the instrument + thresholds;
  WS-45 supplies the phase-enforcing harness. The title-prefix contract
  (`Candice — `) is claimed by this lane and is stable; WS-08/WS-09 title
  writers must keep it (coordination via CROSS-LANE-FINDING, never silent
  drift).

## Handoff note

No commit made (per dispatch instruction). Files sit in the worktree at
`apps/candice-companion/src/platform/macos/instrumentation/**` on branch
`candice/wr001-bootstrap`. Threshold values and the baseline are owned by
this lane; any drift must flow through CROSS-LANE-FINDING.
