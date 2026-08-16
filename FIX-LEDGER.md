# FIX-LEDGER — 999 master fix execution

Absolute path per PART 2.1: `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md`.
Spec: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md`.
One line per claim/result. The boss cron (PART 4) reads this ledger every 5 minutes.
A claim without its ledger line is a violation; a ledger line without its claim never happens.

CREATED: 2026-08-16 (wave 1, per PART 2.1 item 1)

## LOCKED WAVE TABLE (PART 2 — immutable count 6)

| Wave | Issues | Workflows | Dependencies |
|---|---|---|---|
| WAVE 1 | 1, 2 | WF-1A Issue 1 verification; WF-1B Issue 2 verification | None — verify-only, landed in 8fac6ce |
| WAVE 2 | 3, 4, 5, 11, 12 | WF-2A entry gate; WF-2B mode offer; WF-2C counter enforcement; WF-2D wording; WF-2E RESEARCH-READY gate | Wave 1 |
| WAVE 3 | 6, 7, 8, 9, 10 | WF-3A design brief; WF-3B image lane; WF-3C staged pipeline; WF-3D GHL media; WF-3E orphan accounting | Wave 2 |
| WAVE 4 | 13, 14, 15, 17, 18 | WF-4A anti-drift; WF-4B fan-out; WF-4C wave lock; WF-4D QC protocol; WF-4E boss cron | Waves 1-3 |
| WAVE 5 | 16, 19, batch merge | WF-5A unleash table; WF-5B gauntlet weave; WF-5C batch merge (PART 3, single serial workflow) | Waves 1-4 |
| WAVE 6 | 20 | WF-6A status-line both stores + shared script + task-progress wiring + validation | Wave 5 |

Additional waves only via a documented `NEW-WAVE-N` ledger line naming the dependency (PART 2).

## BASELINE (verified before Wave 1)

- `BASELINE: commit 6bf371c on main` — spec-protocol progress visibility capability (Issue 20) committed 2026-08-16.
- `BASELINE: commit 590eb41 on main` — transcript-alive rule + native task-graph rebuild committed 2026-08-16.
- `BASELINE: commit 8fac6ce on main` — Issues 1+2 fixes landed (wave 1 is verify-only).
- `BASELINE: live skill ~/.claude/skills/spec-protocol/ synced byte-identical to repo` — diff verified 2026-08-16.

## WAVE 1 — verify-only (Issues 1, 2)

_(lines written as each claim is verified)_

## WAVE 2

_(not started)_

## WAVE 3

_(not started)_

## WAVE 4

_(not started)_

## WAVE 5

_(not started)_

## WAVE 6

_(not started)_
