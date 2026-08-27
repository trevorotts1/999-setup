# FIX-019 e2e-acceptance report

- Verdict: **BLOCKED**
- Generated: 2026-08-27T16:05:48.950Z
- Repository: 999-setup-audit
- Commit SHA: packaged-suite-run
- Packaged binary SHA-256: 7fa3ebf61b69683853a91b71fe16810cd9d4e1b314220c1db058a4e327ce32e7
- Run id: packaged-suite-1787846748950
- Launcher: node tests/e2e-acceptance/packaged/suite.js

## Tier verdicts

| Tier | Required | Verdict | Legs |
| --- | --- | --- | --- |
| PACKAGED_AUTOMATED | yes | **BLOCKED** | 16 |

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
- [PASS] (required) speech-assets — packaged-automated: speech-assets (run 1)
- [PASS] (required) speech-keyboard — packaged-automated: speech-keyboard (run 1)
- [PASS] (required) typed-build-target — packaged-automated: typed-build-target (run 2)
- [PASS] (required) wrong-session — packaged-automated: wrong-session (run 2)
- [PASS] (required) duplicate — packaged-automated: duplicate (run 2)
- [PASS] (required) fallback — packaged-automated: fallback (run 2)
- [PASS] (required) restart — packaged-automated: restart (run 2)
- [BLOCKED] (required) compact — packaged-automated: compact (run 2) — leg exited 2
- [PASS] (required) speech-assets — packaged-automated: speech-assets (run 2)
- [PASS] (required) speech-keyboard — packaged-automated: speech-keyboard (run 2)

## Notes

Two clean-state runs per leg (EXECUTION-PLAN.md exact fix). Traces at evidence/FIX-019/builder/packaged-traces/.

---

Authoritative aggregate: `report.json`. QC recomputes from the JSON, never from this prose.
