# CI fragment PROPOSAL — WS-24 performance thresholds (macOS)

**Status: PROPOSAL — not applied.** `.github/workflows/**` is integration
owned (PROJECT-MANIFEST 9.4 class 4). The integration owner applies this
fragment at fan-in; this lane never writes CI. Source of truth for the
threshold numbers is `thresholds.ts` (this lane) — the fragment below must
stay byte-identical to `MACHINE_READABLE_THRESHOLDS_JSON` at apply time.

## Job: `perf-smoke-macos` (proposed, matrix member of the WS-46 CI/release
matrix; macOS Apple Silicon runner)

Steps:

1. `npm ci` under `apps/candice-companion` (or the monorepo root install
   the matrix uses).
2. Build: `npm run build` (tsc --noEmit + vite build).
3. Live measurement (self-measure of the smoke job's own node process is
   NOT a Candice measurement; the smoke gate is the module-level gate):
   `node --input-type=module -e "..."` importing
   `apps/candice-companion/src/platform/macos/instrumentation/measure.mjs`
   is the operator instrument only.
4. Threshold gate (the actual CI regression check — runs in the perf
   suite lane WR-020/WS-45 against the companion's real idle/speaking/
   listening windows; threshold values come from this lane's registry):

```yaml
- name: WS-24 threshold gate (idle/speaking/listening, Apple Silicon)
  run: |
    node --experimental-strip-types -e "
      import('./apps/candice-companion/src/platform/macos/instrumentation/thresholds.ts')
        .then((m) => {
          const ok = m.verifyReport({
            idle:     process.env.CANDICE_PERF_IDLE_WINDOW     ? JSON.parse(process.env.CANDICE_PERF_IDLE_WINDOW)     : null,
            speaking: process.env.CANDICE_PERF_SPEAKING_WINDOW ? JSON.parse(process.env.CANDICE_PERF_SPEAKING_WINDOW) : null,
            listening: process.env.CANDICE_PERF_LISTENING_WINDOW ? JSON.parse(process.env.CANDICE_PERF_LISTENING_WINDOW) : null,
          });
          if (!ok.ok) { console.error(JSON.stringify(ok.results.filter(r => !r.ok), null, 2)); process.exit(1); }
          console.log('[ws24] threshold gate PASS');
        })"
```

Thresholds (single source: `thresholds.ts`; JSON twin in
`thresholds-registry.ts`; EMULATED baseline re-measured 2026-08-21
Apple Silicon reference via `baseline-capture.mjs` — provisional until
WS-45's real-app phase harness lands; the cross-lane finding then
re-measures the real engine footprint):

| Phase | cpuMeanMax | cpuMaxMax | rssMiBMax |
|---|---|---|---|
| idle | 10 | 25 | 180 |
| speaking | 25 | 60 | 220 |
| listening | 35 | 80 | 220 |

A missing measurement window FAILS the gate (`verifyReport` treats a
missing phase as a violation) — a failed measurement is never a silent
pass. CI thresholds are adjustable only via this lane
(CROSS-LANE-FINDING), never locally in the workflow file.
