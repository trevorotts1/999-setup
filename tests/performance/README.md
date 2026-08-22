# WS-45 — performance/load/resource test suite

Owned glob: `tests/performance/**` (PROJECT-MANIFEST 9.2, WR-020 row). L3,
deps WS-16 (STT runtime), WS-19 (TTS runtime), WS-24 (macOS instrumentation),
WS-30 (Windows instrumentation).

## What is proven

CHECKLIST E.1 WS-45: "performance suite measures time-to-first-visible,
PTT-release-to-transcript, first-spoken-audio, idle/speaking/listening
CPU+RSS on both platforms; thresholds enforced in CI."

1. **Phase-enforcing harness** (`lib/phase-harness.mjs`): drives the real
   WS-08 state machine (`apps/candice-companion/src/state/machine.ts`, the
   same code the app runs) with real status events to enter idle/speaking/
   listening, and enforces the WS-24 window-title phase contract
   (`Candice — Idle|Speaking|Listening`). This is the harness WS-24's
   cross-lane finding says is missing ("real-app windows require the WS-45
   phase-enforcing harness"). While in each phase, the harness runs the
   REAL engine the app invokes (whisper.cpp for listening; Kokoro/system
   TTS for speaking) and samples its footprint.
2. **Real resource measurements** (`lib/engines.mjs` + `lib/platform.mjs`):
   CPU as percent of one core from cumulative CPU-time deltas over wall
   time (never `ps %cpu`, which on macOS is a lifetime average), RSS in
   MiB, windowed mean/max — same math contract as WS-24. Idle app window
   measured against the real release artifact when present.
3. **Latency instruments** (`lib/latency.mjs`): first-visible, PTT-release-
   to-transcript (real whisper-cli wall time on the WS-16 canonical 16 kHz
   fixture), first-spoken-audio (real TTS engine first-PCM latency).
4. **Threshold enforcement without drift** (`lib/thresholds-gate.mjs`):
   imports the WS-24/WS-30 registries directly (never copies numbers),
   applies `verifyReport`/`checkThresholds`. Missing measurement window =
   FAIL (never a silent pass).
5. **Report + CI runner fragment** (`run.mjs`, `CI-PERF-RUNNER-WS45.md`):
   one command produces a schema-versioned JSON report and a gate verdict.

## Honesty rules (this lane)

- A metric that cannot be measured on this host is `unavailable` with a
  reason and the gate FAILS — it is never a zero, never a silent pass.
- Every measured number carries `provenance`: which real engine/process
  produced it. No fabricated baselines, no proxy numbers presented as app
  numbers (WS-24's QC rejection of fabricated constants is the precedent
  this lane follows).
- Windows x64 real numbers are release-blocking at the WS-46 interactive
  smoke (WS-30's own declared obligation). This lane ships the instrument
  and the gate; the instrument records `unavailable` until a real Windows
  host runs it. HONEST SCOPE LIMIT (QC-ws45): the WS-30 probe invocation
  is an unbuilt seam in this lane — the suite imports the WS-30 registry
  and enforces its gates, but no code path calls the Windows native probe
  yet; wiring it is owed before the WS-46 smoke.

## Run

```bash
# Full suite: unit tests + live measurement + threshold gate + report
node tests/performance/run.mjs

# Quick run (short windows, CI-friendly)
node tests/performance/run.mjs --quick

# Unit tests only
node --test tests/performance/unit/

# Live measurement + gate only (no unit tests)
node tests/performance/run.mjs --live-only

# JSON report path
node tests/performance/run.mjs --report jobs/perf-<ts>.json
```

Environment overrides: `CANDICE_PERF_IDLE_MS` (default 8000),
`CANDICE_PERF_ENGINE_MS` (default 5000), `CANDICE_PERF_INTERVAL_MS`
(default 500), `CANDICE_PERF_ALLOW_APP_LAUNCH=0` (disable launching the
release binary), `CANDICE_PERF_APP_BIN` (explicit app binary path),
`CANDICE_PERF_STT_BIN` / `CANDICE_PERF_STT_MODEL` / `CANDICE_PERF_STT_FIXTURE`
(real STT engine overrides).

Exit codes: 0 = all gates green; 1 = threshold/metric violation or missing
required measurement; 2 = suite misuse; 3 = live measurement instruments
could not be constructed at all (tooling failure, not a violation).

## Report

`run.mjs` prints a one-line verdict plus the full JSON report (default
`tests/performance/reports/perf-<timestamp>.json`). Report schema version is
1 (`report/schema.mjs`); a schema bump is an explicit diffable change.
