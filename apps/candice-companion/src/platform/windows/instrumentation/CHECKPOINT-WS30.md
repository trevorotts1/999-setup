# CHECKPOINT — WS-30 (Windows resource/performance instrumentation)

Builder: B-WR-011-WS-30 (opus/max) — first Candice production fan-out.
Worktree: `worktrees/wr001-bootstrap` @ `aa23ed9` (branch `candice/wr001-bootstrap`).
Date: 2026-08-21.

## Files created (all under owned glob `apps/candice-companion/src/platform/windows/instrumentation/**`)

- `sampler.ts` — Windows sampler core: Win32_Process 100ns-tick counter math
  (`cpuPercentBetween`, exact percent-of-one-core), `bytesToMiB` (1024-based),
  `parseCounterLine` (CSV: ProcessId, Name, KernelModeTime, UserModeTime,
  WorkingSetSize), `summarize` (mean/max aggregates), `sampleWindow`
  (duration/interval honored, deadline-inclusive), native PowerShell backend
  `powershellProbeBackend` via `powershell.exe -NoProfile -NonInteractive
  -ExecutionPolicy Bypass` + `Get-CimInstance Win32_Process` — process-scoped
  policy only, machine-wide execution policy never weakened (spec 0.3);
  `execFile` with argument array, PID passed numerically — no shell, no
  injection surface; backend candidates `powershell.exe`, `pwsh.exe`; never
  sysctl/nproc/POSIX tools, never Git Bash/WSL (spec 0.3 P0).
- `probe.ts` — three-phase report: `measurePhase`, `runPhaseReport`,
  `reportFromWindows`; per-phase windows idle/speaking/listening; a failed
  window degrades to `status: 'unavailable'` with a note, never throws
  (spec 20).
- `thresholds.ts` — `REGRESSION_THRESHOLDS` per phase (generous multiples of
  a DECLARED PROVISIONAL baseline
  `PROVISIONAL_BASELINE_WINDOWS_X64_2026_08_21`; idle cpuMean 0.5% / RSS
  74 MiB; speaking 7.0% / 80 MiB; listening 10.5% / 78 MiB),
  `checkThresholds`, `verifyReport` (missing window = violation, never a
  skip), `THRESHOLDS_SCHEMA_VERSION = 1`. The baseline is NOT a claimed
  Windows measurement — it is a placeholder anchored to the WS-24 macOS
  measured reference plus an x64 allowance. The real Windows x64 capture
  is a release-blocking obligation at the WS-46 interactive smoke gate,
  filed through this lane only. Adjustable only through this lane.
- `index.ts` — public surface barrel.
- `__tests__/sampler.test.ts` — 16 tests (parsing incl. blank-field
  rejection, CPU math, MiB conversion, summarize, deterministic injected
  window, absolute-counter seed regression pin, live-seed lifetime-spike
  pin, one-snapshot-per-sample pin, spec-20 degradation).
- `__tests__/probe.test.ts` — 11 tests (three-phase report, unavailable
  degradation, threshold verdicts, regression-class defect detection).
- `CI-PERF-THRESHOLDS-WS30.md` — proposal fragment for the integration owner
  (manifest 9.4; `.github/workflows/**` is integration class — NOT applied
  by this lane).
- `CHECKPOINT-WS30.md` — this note.

## Verification (primary-source evidence)

```text
$ node --test "src/platform/windows/instrumentation/__tests__/*.test.ts"
exit=0  tests 22  pass 22  fail 0

$ npx tsc --noEmit --allowImportingTsExtensions --module nodenext \
    --moduleResolution nodenext --target es2022 --strict \
    src/platform/windows/instrumentation/*.ts \
    src/platform/windows/instrumentation/__tests__/*.ts
exit=0 (clean)
```

Runner is plain Node 26 (type-stripping native, node:test); no external test
dependency, so the suite runs in any CI container without the app toolchain.
On Node <22.6 run with `--experimental-strip-types`. Note: Node 26 requires
the quoted glob form for the test path — a bare directory path fails with
"Cannot find module".

## QC-011 blind-verdict fixes (2026-08-21, applied by QC lane)

Backup of pre-fix files: `.qc-backup-ws30-20260821/` (6 files) under this
directory.

1. **Live-seed defect (sampler.ts).** The reader-less live path seeded
   `previousTicks = 0`, so the very first live sample reported the
   process's ABSOLUTE lifetime CPU ticks over the first wall step —
   a massive invented CPU spike. Fixed: a supplied reader (injected or
   explicit live) now seeds the absolute counter baseline before the loop;
   the reader-less default keeps the zero-seed so the first sample covers
   only loop-time delta (the PowerShell working-set probe cost is never
   attributed to CPU). Regression pin added (sampler.test.ts, absolute-
   counter seed test). **SUPERSEDED by QC-031:** the reader-less live
   branch itself was later found to still zero-seed against absolute
   Win32 counters — the lifetime spike persisted on the default path.
   QC-031 seeds the live branch absolutely and pins it with a test.
2. **Fabricated baseline (thresholds.ts).** The header claimed an
   "operator-fleet reference measurement campaign" for Windows; no such
   Windows measurement exists anywhere in the repo and no Windows runner
   was used this wave. The baseline is now DECLARED PROVISIONAL — anchored
   to the WS-24 macOS measured reference plus an x64 allowance — and the
   real Windows x64 capture is recorded as a release-blocking obligation
   (WS-46 interactive smoke gate, through this lane only).
3. Documentation sync: CHECKPOINT + CI fragment updated to match.

## Acceptance mapping (CHECKLIST E.1 WS-30)

- "Windows resource instrumentation measures idle/speaking/listening CPU + RSS
  using native Windows APIs" — `probe.ts` measures all three phases;
  `sampler.ts` reads Win32 counters (`Get-CimInstance Win32_Process`
  KernelModeTime/UserModeTime/WorkingSetSize) through native PowerShell —
  the native Windows API path (spec 0.3 P0); thresholds present in the lane
  registry + CI fragment (spec 19 regression thresholds; WS-24 macOS lane
  parity, same shape).
- Spec 19 measurement set: idle/speaking/listening CPU + RSS covered; time-to-
  first-visible and PTT-latency are WS-45 (`tests/perf/**`, WR-020) — noted in
  cross-lane findings.
- Spec 20: all entry points total; phase failure degrades, never throws.

## CROSS-LANE-FINDING (proposal, NOT applied)

```text
CROSS-LANE-FINDING
source workflow/lane: WR-011 WS-30 (windows instrumentation)
affected unit: WR-020 WS-45 (tests/perf/**) + release CI (manifest 9.4)
evidence: spec 19 requires seven measurements: idle RSS/CPU, speaking
  CPU/RSS, listening CPU/RSS (this lane) PLUS time to first visible Candice,
  time from PTT release to transcript, time to first spoken audio (latency
  trio). The latency trio is not an instrumentation-lane deliverable: it
  needs the app shell (WR-012) + speech stack (WR-014) live and belongs in
  WS-45's perf suite. CI enforcement (spec 19 "regression thresholds in CI")
  for the WS-30 numbers ships here as CI-PERF-THRESHOLDS-WS30.md; the
  integration owner applies it at fan-in (9.4).
severity: low (coverage split, no defect)
recommended action: WR-020 WS-45 must include the latency trio in
  tests/perf/** when its dependencies land; the WS-30 CI fragment is applied
  by the integration owner, never by this lane.
```

```text
CROSS-LANE-FINDING
source workflow/lane: WR-011 WS-30 (windows instrumentation)
affected unit: WR-016 WS-29 (packaging/windows) + WR-015 WS-23 (scripts/package-macos — corrected 2026-08-21 authority resolution; previously abbreviated as packaging/macos)
evidence: spec 19 baseline discipline says "establish the baseline on a
  modern Windows x64 machine" before hardcoding targets. The threshold
  registry in this lane carries a DECLARED PROVISIONAL placeholder
  (anchored to the WS-24 macOS measured reference plus an x64 allowance,
  NOT a Windows measurement); the values are deliberately generous upper
  bounds. If the WS-29 packaging lane changes the runtime profile (e.g.
  release flags, engine wiring) before the first real Windows
  measurement, the WS-30 baseline should be re-measured and the registry
  updated through this lane only.
severity: low (timing, no defect)
recommended action: at Windows interactive-smoke time (WS-46/WS-29 gate),
  re-run the WS-30 phase probe on the release artifact and file any threshold
  adjustment as a CROSS-LANE-FINDING to this lane.
```

## QC-030 blind-verdict fixes (2026-08-21, applied by QC lane)

Backup of pre-fix files: `.qc-backup-030-ws30-20260821/` (8 files) under
this directory. Blind verdict below is the ORIGINAL verdict — this lane
recorded FAIL, took the write baton, fixed, and the repaired unit now
requires a FRESH independent recheck.

**BLIND VERDICT: FAIL** on one correctness defect (E.1-fatal, fail-open
silent pass) and one evidence-defect (fabricate-flavored const name).

1. **Silent zero-window fabrication (sampler.ts, FAIL-open).** The live
   path called `probeLiveProcess()`, which converts every backend failure
   into `{cpuTicks: 0, workingSetBytes: 0}`. On a host without
   `powershell.exe`/`pwsh.exe` (or any spawn failure), `sampleWindow`
   then emitted a full window of zero CPU/RSS samples and `measurePhase`
   reported `status: 'ok'` — a fabricated healthy measurement from a dead
   instrument. A regression gate reading that window would PASS. Fixed:
   (a) the live loop now rejects when the native path reads
   `cpuTicks === 0 && workingSetBytes === 0` ("live instrument
   unavailable"), so `measurePhase` degrades to `unavailable` and
   `verifyReport` fails the phase (fail-closed); (b) `parseCounterLine`
   rejects blank/whitespace numeric fields (`Number('') === 0` could
   otherwise fabricate zeros from a failed WMI read); (c) the backend
   rejects non-finite counter values; (d) `sampleWindow` accepts an
   injectable `backend` so this path is testable deterministically.
   Proven by QC live control on this macOS host (no PowerShell): before
   fix, three phases `ok` with all-zero windows; after fix, three phases
   `unavailable` with `complete: false`. Two regression pins added.
2. **Fabricate-flavored const name (thresholds.ts).** The provisional
   placeholder was exported as
   `MEASURED_BASELINE_WINDOWS_X64_2026_08_21` with fields `measuredAt`
   and `machine: 'operator-fleet-reference ...'` — a name that claims a
   measurement the checkpoint itself admits does not exist. No behavior
   depended on the name, but the export surface read as fabricated
   evidence. Renamed to
   `PROVISIONAL_BASELINE_WINDOWS_X64_2026_08_21` with `provisionalAt` +
   `basis` fields; barrel and CI fragment updated. Behavior unchanged.

## QC-031 fixes (2026-08-21, applied by this QC lane)

Backup of pre-fix files: `.qc-backup-031-ws30-20260821-tests/` under this
directory (sampler.ts, probe.ts, both test files). This lane recorded the
findings during its blind review of the QC-030-repaired unit; fixes are
now applied and the unit requires a FRESH independent recheck.

1. **Live-seed lifetime spike (sampler.ts).** The QC-011 note claimed the
   live-seed defect was fixed, but the fix only covered the
   reader-supplied branch. The reader-less live branch still seeded
   `previousTicks = 0` against Win32_Process ABSOLUTE lifetime counters,
   so the first sample of every default live window reported the
   process's entire lifetime CPU over the first wall step — the exact
   invented spike the note said was gone. Fixed: the live branch now
   seeds the absolute baseline via an up-front `probeLiveProcess` before
   the loop (its bounded probe cost lands in the first wall step — an
   over-measure, never an invented lifetime spike). Regression pin added.
2. **Double PowerShell spawn per sample (sampler.ts).** The live loop
   called `liveCpuTicks` and `liveWorkingSetBytes` separately — two
   `probeLiveProcess` calls (two PowerShell round trips) per interval
   for one snapshot. Fixed: one `probeLiveProcess` per sample supplies
   both counters from the same Win32_Process read. Dead helpers removed.
   Regression pin added (backend call count = 1 + sampleCount).
3. **Header doc inaccuracies (sampler.ts).** Removed the
   `[Environment]::ProcessorCount` claim (the probe script never uses
   it) and the stale `-Property` explicit-label parse claim (the
   backend formats with `-f`); corrected the spec-20 wording
   ("never throws" → rejects, phase probe degrades).

## Fresh verification (this lane, 2026-08-21)

```text
$ node --test "src/platform/windows/instrumentation/__tests__/*.test.ts"
tests 27  pass 27  fail 0

$ npx tsc --noEmit --allowImportingTsExtensions --module nodenext \
    --moduleResolution nodenext --target es2022 --strict \
    src/platform/windows/instrumentation/*.ts \
    src/platform/windows/instrumentation/__tests__/*.ts
exit=0 (clean)
```

## Notes for the conductor

- No commit made (per builder instructions). Branch `candice/wr001-bootstrap`
  remains at `aa23ed9`; all files are working-tree additions under
  `apps/candice-companion/src/platform/windows/instrumentation/**`.
- No root release files, CONTROL/ carriers, CHANGELOG.md, README.md, VERSION,
  tags, .github/, or shared-file single-writer classes touched.
- No path outside the owned glob was created or modified.
- Depends on nothing this wave has not produced: dependency-free Node, mirrors
  the WS-24 macOS lane shape exactly (sampler/thresholds/tests/CI fragment).
