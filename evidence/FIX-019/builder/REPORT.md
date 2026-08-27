# FIX-019 e2e-acceptance report

- Verdict: **BLOCKED**
- Generated: 2026-08-26T19:50:52.733Z
- Repository: 999-setup-audit
- Commit SHA: recorded-at-run-time
- Run id: suite-1787773852732
- Launcher: node tests/e2e-acceptance/suite.js

## Tier verdicts

| Tier | Required | Verdict | Legs |
| --- | --- | --- | --- |
| UNIT | yes | **PASS** | 22 |
| INTEGRATION | yes | **PASS** | 6 |
| PACKAGED_AUTOMATED | yes | **BLOCKED** | 26 |
| HUMAN_HARDWARE | yes | **BLOCKED** | 8 |

## Blocked details

- BLOCKED PACKAGED_AUTOMATED - compact
- BLOCKED PACKAGED_AUTOMATED - compact
- BLOCKED HUMAN_HARDWARE - default-mode-claude
- BLOCKED HUMAN_HARDWARE - default-mode-claude-nine
- BLOCKED HUMAN_HARDWARE - advanced-mode-claude
- BLOCKED HUMAN_HARDWARE - advanced-mode-claude-nine
- BLOCKED HUMAN_HARDWARE - clarification-loop
- BLOCKED HUMAN_HARDWARE - ceiling-count
- BLOCKED HUMAN_HARDWARE - input-mode-per-question
- BLOCKED HUMAN_HARDWARE - final-write-through

## Leg details

### UNIT (PASS)

- [PASS] (required) contract-schema — unit suite: contract/schema
- [PASS] (required) contract-keys — unit suite: contract/keys
- [PASS] (required) contract-registry-authority — unit suite: contract/registry-authority
- [PASS] (required) contract-interview-inventory — unit suite: contract/interview-inventory
- [PASS] (required) contract-exactly-one — unit suite: contract/exactly-one
- [PASS] (required) contract-secret — unit suite: contract/secret
- [PASS] (required) same-session-no-second-ai — unit suite: same-session/no-second-ai
- [PASS] (required) same-session-provider-identity — unit suite: same-session/provider-identity
- [PASS] (required) same-session-same-session — unit suite: same-session/same-session
- [PASS] (required) same-session-session-authority — unit suite: same-session/session-authority
- [PASS] (required) failure-matrix-app-crash — unit suite: failure-matrix/app-crash
- [PASS] (required) failure-matrix-app-missing — unit suite: failure-matrix/app-missing
- [PASS] (required) failure-matrix-claude-busy — unit suite: failure-matrix/claude-busy
- [PASS] (required) failure-matrix-corrupt-checksum — unit suite: failure-matrix/corrupt-checksum
- [PASS] (required) failure-matrix-mcp-unavailable — unit suite: failure-matrix/mcp-unavailable
- [PASS] (required) failure-matrix-mic-denied — unit suite: failure-matrix/mic-denied
- [PASS] (required) failure-matrix-no-device — unit suite: failure-matrix/no-device
- [PASS] (required) failure-matrix-plugin-missing — unit suite: failure-matrix/plugin-missing
- [PASS] (required) failure-matrix-speech-model-missing — unit suite: failure-matrix/speech-model-missing
- [PASS] (required) failure-matrix-temp-unwritable — unit suite: failure-matrix/temp-unwritable
- [PASS] (required) failure-matrix-wrong-session — unit suite: failure-matrix/wrong-session
- [PASS] (required) tier-self-test — unit: tier framework fail-closed self-test

### INTEGRATION (PASS)

- [PASS] (required) happy1-first-run-name-ask — integration: happy1-first-run-name-ask
- [PASS] (required) happy2-answer-surfaces — integration: happy2-answer-surfaces
- [PASS] (required) happy3-captions-voice-toggle — integration: happy3-captions-voice-toggle
- [PASS] (required) happy4-local-audio-privacy — integration: happy4-local-audio-privacy
- [PASS] (required) happy5-no-second-ai-same-session — integration: happy5-no-second-ai-same-session
- [PASS] (required) happy6-fresh-user-runs-skill — integration: happy6-fresh-user-runs-skill

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

### HUMAN_HARDWARE (BLOCKED)

- [SKIPPED] (required) default-mode-claude — human/hardware: default-mode-claude interview — no filled trace template supplied for default-mode-claude
- [SKIPPED] (required) default-mode-claude-nine — human/hardware: default-mode-claude-nine interview — no filled trace template supplied for default-mode-claude-nine
- [SKIPPED] (required) advanced-mode-claude — human/hardware: advanced-mode-claude interview — no filled trace template supplied for advanced-mode-claude
- [SKIPPED] (required) advanced-mode-claude-nine — human/hardware: advanced-mode-claude-nine interview — no filled trace template supplied for advanced-mode-claude-nine
- [BLOCKED] (required) clarification-loop — human/hardware: clarification round trip returns to the pending governed question (spec 15) — no interview runs supplied — no evidence for cross-run checks
- [BLOCKED] (required) ceiling-count — human/hardware: counted sequence respects the mode wall and R1-first order — no interview runs supplied — no evidence for cross-run checks
- [BLOCKED] (required) input-mode-per-question — human/hardware: one input mode per question, recorded per answer — no interview runs supplied — no evidence for cross-run checks
- [BLOCKED] (required) final-write-through — human/hardware: final write-through document exists and was verified — no interview runs supplied — no evidence for cross-run checks

## Notes

Aggregating suite run. commitSha recorded-at-run-time: the packaged runner pins the built binary SHA.

---

Authoritative aggregate: `report.json`. QC recomputes from the JSON, never from this prose.
