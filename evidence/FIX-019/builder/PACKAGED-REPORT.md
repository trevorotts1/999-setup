# FIX-019 e2e-acceptance report

- Verdict: **FAIL**
- Generated: 2026-08-27T18:15:06.664Z
- Repository: 999-setup-audit
- Commit SHA: packaged-suite-run
- Packaged binary SHA-256: 0c9e091a31b5ecea041faa0e974afe838fed36f8f62b47bba371218a875c8494
- Run id: packaged-suite-1787854506663
- Launcher: node tests/e2e-acceptance/packaged/suite.js

## Tier verdicts

| Tier | Required | Verdict | Legs |
| --- | --- | --- | --- |
| PACKAGED_AUTOMATED | yes | **FAIL** | 17 |

## Leg details

### PACKAGED_AUTOMATED (FAIL)

- [PASS] (required) typed-build-target — packaged-automated: typed-build-target (run 1)
- [PASS] (required) wrong-session — packaged-automated: wrong-session (run 1)
- [PASS] (required) duplicate — packaged-automated: duplicate (run 1)
- [PASS] (required) fallback — packaged-automated: fallback (run 1)
- [PASS] (required) restart — packaged-automated: restart (run 1)
- [SKIPPED] (skippable) compact — packaged-automated: compact (run 1) — compact surface is not mounted in this release; CompactTransport has no implementation and no user-initiated channel to Claude exists (verified: 25 src-tauri commands, 1 MCP tool candice.ask_user, 11 protocol schemas, full source sweep, zero non-test importers)
- [PASS] (required) speech-assets — packaged-automated: speech-assets (run 1)
- [PASS] (required) speech-keyboard — packaged-automated: speech-keyboard (run 1)
- [PASS] (required) typed-build-target — packaged-automated: typed-build-target (run 2)
- [PASS] (required) wrong-session — packaged-automated: wrong-session (run 2)
- [PASS] (required) duplicate — packaged-automated: duplicate (run 2)
- [PASS] (required) fallback — packaged-automated: fallback (run 2)
- [PASS] (required) restart — packaged-automated: restart (run 2)
- [SKIPPED] (skippable) compact — packaged-automated: compact (run 2) — compact surface is not mounted in this release; CompactTransport has no implementation and no user-initiated channel to Claude exists (verified: 25 src-tauri commands, 1 MCP tool candice.ask_user, 11 protocol schemas, full source sweep, zero non-test importers)
- [PASS] (required) speech-assets — packaged-automated: speech-assets (run 2)
- [PASS] (required) speech-keyboard — packaged-automated: speech-keyboard (run 2)
- [FAIL] (required) trace-3565efbe97a5 — packaged-automated: trace integrity — compact: run 1 and run 2 traces differ modulo ts — compact: run 1 and run 2 traces differ modulo ts

## Notes

Two clean-state runs per leg (EXECUTION-PLAN.md exact fix). Traces at evidence/FIX-019/builder/packaged-traces/.

---

Authoritative aggregate: `report.json`. QC recomputes from the JSON, never from this prose.
