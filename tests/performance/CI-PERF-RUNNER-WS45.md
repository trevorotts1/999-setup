# CI fragment — WS-45 performance suite runner

**Status: APPLIED (FIX-021).** `.github/workflows/**` is integration
owned (PROJECT-MANIFEST 9.4 class 4). The matrix is wired in
`candice-ci.yml` with FIX-021 semantics: the Tauri release bundle is built
BEFORE this step, the step runs with `--require-bundle "<bundle path>"`, and
the perf JSON report is uploaded as an artifact on every run. Threshold
numbers live in the WS-24/WS-30 registries, never here.

## Job: `perf-smoke` (member of the WS-46 CI/release matrix)

Runs on: macOS Apple Silicon runner (the reference platform, spec 0.3).
Windows x64 numbers come from the WS-30 native probe on a Windows runner
when WS-46 adds one — until the probe wiring lands in this suite (unbuilt
seam, see CHECKPOINT-WS45.md QC-ws45 note), this job enforces macOS and
records the Windows phases as unavailable (release-blocking note already
carried by WS-30's own fragment).

```yaml
- name: WS-45 performance suite (measure + threshold gate)
  run: |
    cd <repo root>
    node tests/performance/run.mjs --quick
```

Environment: `CANDICE_PERF_IDLE_MS=3000`, `CANDICE_PERF_ENGINE_MS=3000`,
`CANDICE_PERF_INTERVAL_MS=300` (the `--quick` defaults) keep a CI run
under ~30 s. On a Windows runner the same command runs the suite; the
Windows phase gates then enforce the WS-30 registries once the WS-30
probe wiring lands in this lane (unbuilt seam — the registry import and
gate code exist; the probe invocation does not yet).

Gate semantics (enforced inside the suite, not in YAML):

- Exit 0 only when: unit tests pass, phase-harness title contract holds on
  the real WS-08 machine, all three latency metrics measured and within
  budget, all three macOS phase windows measured and within the WS-24
  thresholds.
- Exit 1 on any violation or missing required measurement. A measurement
  that could not run is a FAILURE, never a silent pass.
- Exit 3 = suite tooling failure (runner bug) — treated as infra, not as
  product verdict.

## Metrics enforced (Master Spec 19 + E.1 WS-45)

| Metric | Budget (ms) | Measured by |
|---|---|---|
| time-to-first-visible | 3000 | webview boot path (WS-46 interactive smoke / headless shell) |
| ptt-release-to-transcript | 5000 | real whisper-cli (WS-16 pinned runtime, canonical fixture) |
| first-spoken-audio | 2500 | real TTS engine first PCM (Kokoro worker or spec 7 system fallback) |

Latency budgets are regression gates on the real engine path — deliberate:
they catch double model loads and unoptimized runtime, not noise. Tuning
them is a CROSS-LANE-FINDING against this lane (comment in
`tests/performance/lib/latency.mjs`), never a silent YAML edit.

## Report artifact

The suite writes `tests/performance/reports/perf-<ts>.json`
(schemaVersion 1) — attach it as a CI artifact for the WS-46 matrix log;
it carries provenance per metric (which real engine/process produced the
number), so a Windows number can never be mistaken for a macOS one and
vice versa.
