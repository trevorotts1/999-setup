# CROSS-LANE-FINDING — WS-45 real measurements vs WS-24 emulated thresholds

From: WR-020 / WS-45 lane (`tests/performance/**`).
To: WR-015 / WS-24 lane (`apps/candice-companion/src/platform/macos/instrumentation/**`)
— and, for the Windows record, WR-016 / WS-30.

Date: 2026-08-21. Status: FINDING — no file outside this lane's owned glob
was edited. Threshold constants remain owned by WS-24; this lane never
touches them.

## What was measured (real, on this Apple Silicon reference box)

Run: `node tests/performance/run.mjs` (report artifact:
`tests/performance/reports/perf-*.json`).

| Metric | Real measured | Engine / provenance |
|---|---|---|
| ptt-release-to-transcript | 294 ms | whisper-cli 1.9.2 (pinned WS-16 model ggml-tiny.en-q5_1.bin, sha256 verified) on canonical jfk.wav |
| listening cpuMean | 72.4% of one core | rusage user+sys 0.12+0.08 s over 0.26 s wall (exact, not ps-slurred) |
| listening peak RSS | 163.8 MiB | rusage maximum resident set size |
| first-spoken-audio | 561 ms | `say` (spec 7 fallback engine), first AIFF-payload growth |
| speaking cpuMean | 13.9% / peak RSS 37.0 MiB | real say synthesis |
| time-to-first-visible | 1281 ms | release app window mapped (CGWindowList, permission-free) — under the 3000 ms budget |
| idle cpuMean | 0.00% / RSS 98.8 MiB (steady state) | real release binary idle window |

## The violation

The WS-45 gate (which imports WS-24's registry and runs its own
`checkThresholds`) reports:

```
listening: cpuPercentMean 72.4 > 35
```

`REGRESSION_THRESHOLDS.listening.cpuMeanMax = 35` was calibrated against the
EMULATED baseline-capture.mjs self-measure (synthetic STT-ish load, 14.54%).
The real whisper.cpp run on this box is a short, hot burst: ~170 MiB model
load + 294 ms decode at ~72% of one core. The emulated constant is now
provably unrepresentative — exactly the case the WS-24 file header declares
("When WS-45's real-app harness lands, this lane re-measures the REAL engine
footprint and updates these constants through CROSS-LANE-FINDING — never
silent drift").

## What WS-24 should do (its lane, its constants)

Re-measure the real listening window per the WS-24 measurement contract and
recalibrate `REGRESSION_THRESHOLDS.listening` (and re-run the emulated-data
question for idle/speaking against the real say numbers: speaking 13.9%
cpuMean / 37.0 MiB is well under the current 25/220 limits — idle 0%/98.8 MiB
is well under 10/180). The observed real listening footprint with a
regression-class margin (e.g. 2.5x) lands around cpuMeanMax ~180,
rssMiBMax ~250 on this footprint — WS-24 owns the final numbers, schema bump
to `THRESHOLDS_SCHEMA_VERSION = 2`, and the CI fragment twin.

While the emulated listening constant stands, the WS-45 gate FAILS loudly on
this box (correct behavior: enforcement exists, the constant is what is
wrong, and it is not this lane's to change).

## Windows record (WS-30)

`tests/performance/run.mjs` records the three Windows phases as
`unavailable` on this macOS host and reports them via the skip note
"requires a real Windows x64 host (WS-30 native probe; release-blocking at
WS-46 smoke)". HONEST SCOPE LIMIT (QC-ws45 correction 2026-08-21): no code
path yet invokes the WS-30 native probe — even on a real Windows host the
suite would record `unavailable` because the Windows measurement wiring is
an unbuilt seam (registry import works; probe call does not exist). Wiring
it is this lane's owed work before the WS-46 smoke; Windows real numbers
remain WS-30's declared release-blocking obligation — this finding does not
change that.

## Re-proven by this run

- WS-45 phase-harness enforces the WS-24 window-title contract against the
  REAL WS-08 state machine (`Candice — Idle|Speaking|Listening` labels
  match; probe round-trip classifies correctly). NOTE for WS-08/WS-06: the
  app's own webview still reports plain title `Candice` (no phase suffix is
  written yet) — the WS-24 phase-title carrier is contract-defined but not
  yet emitted by the app; the WS-46 smoke should verify the real window
  bearing the phase suffix once the bridge writes it.
- STT model sha256 verification is enforced before any engine run (same
  constant as the WS-16 runtime: c77c5766…).
