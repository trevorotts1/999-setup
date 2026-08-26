# FIX-019 e2e-acceptance report

- Verdict: **BLOCKED**
- Generated: 2026-08-26T19:37:20.923Z
- Repository: 999-setup-audit
- Commit SHA: packaged-suite-run
- Packaged binary SHA-256: 5f3de2b401e83c9e0c7e5732e9d115359d83cb7c4b1a0dfe2903e592320600fe
- Run id: packaged-suite-1787773040923
- Launcher: node tests/e2e-acceptance/packaged/suite.js

## Tier verdicts

| Tier | Required | Verdict | Legs |
| --- | --- | --- | --- |
| PACKAGED_AUTOMATED | yes | **BLOCKED** | 26 |

## Blocked details

- BLOCKED PACKAGED_AUTOMATED - compact
- BLOCKED PACKAGED_AUTOMATED - compact

## Leg details

### PACKAGED_AUTOMATED (BLOCKED)

- [PASS] (required) typed-build-target — packaged-automated: typed-build-target (run 1)
- [PASS] (required) wrong-session — packaged-automated: wrong-session (run 1)
- [PASS] (required) duplicate — packaged-automated: duplicate (run 1)
- [PASS] (required) fallback — packaged-automated: fallback (run 1)
- [PASS] (required) restart — packaged-automated: restart (run 1)
- [BLOCKED] (required) compact — packaged-automated: compact (run 1) — leg exited 2
- [FAIL] (required) speech-assets — packaged-automated: speech-assets (run 1) — leg exited 1
- [PASS] (required) speech-keyboard — packaged-automated: speech-keyboard (run 1)
- [PASS] (required) typed-build-target — packaged-automated: typed-build-target (run 2)
- [PASS] (required) wrong-session — packaged-automated: wrong-session (run 2)
- [PASS] (required) duplicate — packaged-automated: duplicate (run 2)
- [PASS] (required) fallback — packaged-automated: fallback (run 2)
- [PASS] (required) restart — packaged-automated: restart (run 2)
- [BLOCKED] (required) compact — packaged-automated: compact (run 2) — leg exited 2
- [FAIL] (required) speech-assets — packaged-automated: speech-assets (run 2) — leg exited 1
- [FAIL] (required) speech-keyboard — packaged-automated: speech-keyboard (run 2) — leg exited 1
- [FAIL] (required) speech-keyboard-determinism — packaged-automated: speech-keyboard run determinism (run 1 vs run 2) — leg speech-keyboard passed one run and failed the other — packaged behavior is not deterministic across clean-state runs
- [FAIL] (required) trace-27835c88963a — packaged-automated: trace integrity — typed-build-target: run 1 and run 2 traces differ modulo ts — typed-build-target: run 1 and run 2 traces differ modulo ts
- [FAIL] (required) trace-812e5ed4f1c9 — packaged-automated: trace integrity — wrong-session: run 1 and run 2 traces differ modulo ts — wrong-session: run 1 and run 2 traces differ modulo ts
- [FAIL] (required) trace-16a6d097d709 — packaged-automated: trace integrity — duplicate: run 1 and run 2 traces differ modulo ts — duplicate: run 1 and run 2 traces differ modulo ts
- [FAIL] (required) trace-567d14298fd8 — packaged-automated: trace integrity — fallback: run 1 and run 2 traces differ modulo ts — fallback: run 1 and run 2 traces differ modulo ts
- [FAIL] (required) trace-0744dda5a94b — packaged-automated: trace integrity — restart: run 1 and run 2 traces differ modulo ts — restart: run 1 and run 2 traces differ modulo ts
- [FAIL] (required) trace-3565efbe97a5 — packaged-automated: trace integrity — compact: run 1 and run 2 traces differ modulo ts — compact: run 1 and run 2 traces differ modulo ts
- [FAIL] (required) trace-a1c8c909e847 — packaged-automated: trace integrity — speech-assets run 1: trace missing — speech-assets run 1: trace missing
- [FAIL] (required) trace-89bebd5c9d09 — packaged-automated: trace integrity — speech-assets run 2: trace missing — speech-assets run 2: trace missing
- [FAIL] (required) trace-d2a28970b0cc — packaged-automated: trace integrity — speech-keyboard: run 1 and run 2 traces differ modulo ts — speech-keyboard: run 1 and run 2 traces differ modulo ts

## Notes

Two clean-state runs per leg (EXECUTION-PLAN.md exact fix). Traces at evidence/FIX-019/builder/packaged-traces/.

---

Authoritative aggregate: `report.json`. QC recomputes from the JSON, never from this prose.
