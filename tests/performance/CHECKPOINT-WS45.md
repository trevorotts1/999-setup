# CHECKPOINT — WS-45 performance/load/resource test suite

Lane: WR-020 WS-45 (L3; deps WS-16, WS-19, WS-24, WS-30).
Date: 2026-08-21. Builder: WS-WS-45 (opus/max).
Owned glob (manifest 9.2): `tests/performance/**` — everything here.

## Deliverables

| File | Purpose |
|---|---|
| `README.md` | lane overview, honesty rules, run instructions |
| `run.mjs` | single-command suite: unit tests -> harness -> real measurements -> threshold gate -> JSON report |
| `lib/schema.mjs` | report schema v1 (metric + phase-gate + verdict shapes) |
| `lib/platform.mjs` | POSIX process CPU/RSS reader (cumulative CPU-time deltas — never `ps %cpu` lifetime average), rusage exact-measurement path for short-lived engines, sample window math |
| `lib/engines.mjs` | real engine drivers: whisper.cpp STT (sha256-verified pinned model, canonical fixture), say/Kokoro TTS (first-AIFF-growth first-audio poll), real release-app idle + first-visible |
| `lib/macos-window.mjs` | permission-free CGWindowList window probe (compile-once) for time-to-first-visible |
| `lib/phase-harness.mjs` | THE phase-enforcing harness WS-24's cross-lane finding declares missing: drives the REAL WS-08 state machine via real status events, enforces the WS-24 title contract |
| `lib/latency.mjs` | latency instruments + regression budgets (3 metrics of E.1 WS-45) |
| `lib/thresholds-gate.mjs` | imports WS-24/WS-30 registries directly — never copies numbers; missing window = FAIL |
| `unit/*.test.mjs` | 30 node:test unit tests (math, gate semantics, real-module harness, rusage parser) |
| `CI-PERF-RUNNER-WS45.md` | CI fragment proposal (9.4 owner applies at fan-in; step + gate semantics) |
| `CROSS-LANE-FINDING-WS45-REAL-MEASUREMENTS.md` | finding: real measured numbers vs WS-24 emulated thresholds |
| `reports/perf-*.json` | generated reports (gitignored) |

## Evidence

- Unit tests: 30/30 green (`node --test tests/performance/unit/*.test.mjs`).
- Full suite `node tests/performance/run.mjs` -> GATE FAIL **by design** with
  one violation, documented in the cross-lane finding — real measured
  `listening cpuPercentMean 72.4 > WS-24 emulated 35`. All other gates PASS:
  - ptt-release-to-transcript 294 ms <= 5000 (real whisper-cli, pinned model
    sha256-verified, canonical jfk.wav fixture, verbatim transcript)
  - first-spoken-audio 561 ms <= 2500 (real say, first AIFF payload)
  - time-to-first-visible 1281 ms <= 3000 (real release app window mapped,
    permission-free CGWindowList)
  - speaking cpuMean 13.9% / peak RSS 37.0 MiB (real say window)
  - idle cpuMean 0.00% / peak RSS 98.8 MiB (real release binary window)
  - phase-harness: WS-08 machine reachable phases idle/speaking/listening;
    title contract enforced; probe round-trip OK
- The WS-45 gate fails LOUDLY on the stale WS-24 emulated constant rather
  than silently passing — enforcement proof. Recusal: this lane never
  edited WS-24/WS-30 files (read-only imports only). Recalibration is
  WS-24's lane action, filed above.

## Honesty rules honored

- No fabricated number anywhere: every metric carries provenance (which
  real engine/process produced it).
- STT model sha256 mismatch -> refuses to run (same constant as WS-16
  runtime).
- Windows phases recorded `unavailable` + skip note on this macOS host —
  not fake zeros. HONEST SCOPE LIMIT (QC-ws45 finding): no Windows code
  path invokes the WS-30 native probe yet — the suite imports the WS-30
  registry and on a real Windows host the phase windows still record
  `unavailable` (the probe wiring is an unbuilt seam owed by this lane
  before the WS-46 smoke). The runner path that would call the probe is
  the intended extension point, but it does not exist in code today —
  earlier doc wording overstated it.

## QC-fix note (blind QC seat wf_c3b3ed8b-978, 2026-08-21)

Verdict on builder output: FAIL — documentation claimed a Windows
code path that does not exist. Fixes applied (write baton, backup at
`tests/performance/.qc-backup-ws45-qc-20260821/`): (1) this checkpoint's
Windows-probe claim corrected to the honest scope limit; (2)
`CROSS-LANE-FINDING-WS45-REAL-MEASUREMENTS.md` Windows section corrected;
(3) `CI-PERF-RUNNER-WS45.md` probe-wiring wording corrected in both
places; (4) `README.md` honesty-rules section gains the same scope note;
(5) dead unused `labelName` variable removed from
`lib/phase-harness.mjs` (no behavior change). No cross-lane file edited —
thresholds constants and the WS-30 registry remain the owning lanes'.
Independent recheck verdicts on file edits: unit 30/30 PASS, full suite
GATE FAIL by design (WS-24 stale listening constant, exit 1). Per 0J:
repaired output requires a fresh independent QC recheck before the E.1
WS-45 box flips. CI wiring remains a proposal (manifest 9.4 class 4).
- Missing measurement window = FAIL, never silent pass.
