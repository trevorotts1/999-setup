# FIX-019 e2e-acceptance report

- Verdict: **FAIL**
- Generated: 2026-08-22T20:19:17.685Z
- Repository: 999-setup-audit
- Commit SHA: recorded-at-run-time
- Run id: suite-1787429957684
- Launcher: node tests/e2e-acceptance/suite.js

## Tier verdicts

| Tier | Required | Verdict | Legs |
| --- | --- | --- | --- |
| UNIT | yes | **FAIL** | 22 |
| INTEGRATION | yes | **PASS** | 6 |
| PACKAGED_AUTOMATED | yes | **BLOCKED** | 6 |
| HUMAN_HARDWARE | yes | **BLOCKED** | 8 |

## Blocked details

- BLOCKED PACKAGED_AUTOMATED - typed-build-target
- BLOCKED PACKAGED_AUTOMATED - wrong-session
- BLOCKED PACKAGED_AUTOMATED - duplicate
- BLOCKED PACKAGED_AUTOMATED - fallback
- BLOCKED PACKAGED_AUTOMATED - restart
- BLOCKED PACKAGED_AUTOMATED - compact
- BLOCKED HUMAN_HARDWARE - default-mode-claude
- BLOCKED HUMAN_HARDWARE - default-mode-claude-nine
- BLOCKED HUMAN_HARDWARE - advanced-mode-claude
- BLOCKED HUMAN_HARDWARE - advanced-mode-claude-nine

## Leg details

### UNIT (FAIL)

- [PASS] (required) contract-schema — unit suite: contract/schema
- [PASS] (required) contract-keys — unit suite: contract/keys
- [PASS] (required) contract-registry-authority — unit suite: contract/registry-authority
- [PASS] (required) contract-interview-inventory — unit suite: contract/interview-inventory
- [PASS] (required) contract-exactly-one — unit suite: contract/exactly-one
- [PASS] (required) contract-secret — unit suite: contract/secret
- [PASS] (required) same-session-no-second-ai — unit suite: same-session/no-second-ai
- [FAIL] (required) same-session-provider-identity — unit suite: same-session/provider-identity — test file failed or exited nonzero
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

- [BLOCKED] (required) typed-build-target — packaged-automated: typed-build-target — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) wrong-session — packaged-automated: wrong-session — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) duplicate — packaged-automated: duplicate — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) fallback — packaged-automated: fallback — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) restart — packaged-automated: restart — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun
- [BLOCKED] (required) compact — packaged-automated: compact — screen is locked (CGSSessionScreenIsLocked=1) — macOS degrades AX window enumeration box-wide while locked; unlock the screen and rerun

### HUMAN_HARDWARE (BLOCKED)

- [SKIPPED] (required) default-mode-claude — human/hardware: default-mode-claude interview — no filled trace template supplied for default-mode-claude
- [SKIPPED] (required) default-mode-claude-nine — human/hardware: default-mode-claude-nine interview — no filled trace template supplied for default-mode-claude-nine
- [SKIPPED] (required) advanced-mode-claude — human/hardware: advanced-mode-claude interview — no filled trace template supplied for advanced-mode-claude
- [SKIPPED] (required) advanced-mode-claude-nine — human/hardware: advanced-mode-claude-nine interview — no filled trace template supplied for advanced-mode-claude-nine
- [PASS] (required) clarification-loop — human/hardware: clarification round trip returns to the pending governed question (spec 15)
- [PASS] (required) ceiling-count — human/hardware: counted sequence respects the mode wall and R1-first order
- [PASS] (required) input-mode-per-question — human/hardware: one input mode per question, recorded per answer
- [PASS] (required) final-write-through — human/hardware: final write-through document exists and was verified

## Notes

Aggregating suite run. commitSha recorded-at-run-time: the packaged runner pins the built binary SHA.

---

Authoritative aggregate: `report.json`. QC recomputes from the JSON, never from this prose.
