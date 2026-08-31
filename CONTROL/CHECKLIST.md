# CONTROL / CHECKLIST — Binary Proven-Done Boxes

Base/integration SHA: 6bb00ec70af69510fab5a9c2ef332751e260d036 (HEAD of main, re-verified 2026-08-21)

---

## Box-flip rule (Master Spec 0J — QC-controlled promotion)

A box flips only when ALL apply:
- required deliverable exists;
- required tests pass;
- primary-source evidence exists;
- independent QC passes;
- acceptance criteria pass;
- required project state is updated.

If QC fixes a failure, the box stays unchecked until a fresh independent recheck passes. The conductor flips final completion boxes from evidence; builders do not self-promote. A CHECKLIST/QC mismatch reopens the item (0J reconciliation repairs).

---

## A. PRE-DISPATCH GATES (Master Spec 0H — "Before any implementation dispatch")

Nothing may be dispatched to implementation until all of these are proven. Prior-campaign statuses cleared 2026-08-30 (eradication sweep); all A boxes re-open.

- [ ] Capacity Ledger/profiler result is current. — prior-campaign evidence cleared 2026-08-30 (eradication sweep); re-prove at next dispatch.
- [ ] Opus route canary confirms the expected builder route. — prior-campaign evidence cleared 2026-08-30; re-prove at next dispatch.
- [ ] Sonnet route canary confirms the expected QC route. — prior-campaign evidence cleared 2026-08-30; re-prove at next dispatch.
- [ ] Max-thinking configuration is proven on both seats. — prior-campaign evidence cleared 2026-08-30; re-prove at next dispatch.
- [ ] Native task graph exists. — prior-campaign evidence cleared 2026-08-30 (eradication sweep); regenerate per campaign.
- [ ] Workflow Launch Board section exists in CONTROL/EXECUTION-PLAN.md. — prior board removed 2026-08-30 (eradication sweep); create at next campaign.
- [x] Every planned workflow has unique ownership. — EXECUTION-PLAN 3.4 collision-free ownership rules.
- [x] Worktree/branch isolation plan exists. — EXECUTION-PLAN 3.4 (0C: one worktree/branch per run or collision domain).
- [x] Shared-file single-writer list exists. — EXECUTION-PLAN 3.4 (0C integration-owned list).
- [ ] Safe live width is calculated. — prior-campaign evidence cleared 2026-08-30; re-calculate at next dispatch.
- [ ] No agent is padding. — all four agent properties nameable per unit; record any under-width run in a per-campaign under-width table.

## B. POST-CREATION GATES (Master Spec 0H — "After workflow creation")

Post-creation gates re-open for every new launch batch; prior-campaign run evidence cleared 2026-08-30 (eradication sweep).

- [ ] Every real workflow has a returned workflow ID. — prior-campaign run evidence cleared 2026-08-30 (eradication sweep); re-prove per launch batch.
- [ ] Every real workflow run appears on the visible board and has a real tool handle/tree. — prior-campaign board removed 2026-08-30; re-prove per launch batch.
- [ ] Workflow-run handle/tree visibility verification passes. — prior-campaign evidence cleared 2026-08-30; re-prove per launch batch.
- [x] Builder/QC model pins are explicit. — every launched run pins builder + QC seats (board columns); canaries prove routes before dispatch.
- [ ] Every live agent has a unit, deliverable, evidence/input, and acceptance criterion. — prior-campaign evidence cleared 2026-08-30; re-proven per implementation run at dispatch (0H/0A no-padding bar).

## C. EXECUTION GATES (Master Spec 0H — "During execution")

Not yet reached — no implementation units dispatched. All unchecked; these open at implementation dispatch.

- [ ] No two writers own the same unit simultaneously.
- [ ] QC begins per-unit on handoff, not at an all-builders barrier.
- [ ] QC repairs local defects.
- [ ] Repaired QC output receives a fresh independent recheck.
- [ ] Free seats take runnable work.
- [ ] New waves exist only for documented dependencies.

## D. PRE-FINAL-MERGE GATES (Master Spec 0H — "Before final merge")

Not yet reached — no accepted units exist (accepted_units empty, integration base only). All unchecked; these open after implementation fan-in.

- [ ] Every accepted unit has passing evidence.
- [ ] Accepted-commit inventory is complete.
- [ ] One integration branch contains the combined implementation.
- [ ] Full-suite tests pass.
- [ ] Final system-level QC passes.
- [ ] Versions/stamps are computed once from integrated state.
- [ ] One final tag/release stamp is prepared.
- [ ] One merge to main is performed.
- [ ] Post-merge smoke checks pass.

---

## Additional binding context (not boxes — enforce alongside the gates above)

- WORKFLOW-ONLY EXECUTION LAW (0.0A): conductor never implements; every substantive task runs inside visible Workflow runs. DIRECT implementation is forbidden for this build; raw Agent-tool execution is not an implementation fallback (0D).
- Model pins (0A): every builder call and every QC call is seat-pinned; never a bare/unpinned call; route proven by canary before dispatch.
- One final fan-in (0G, override): no periodic intermediate merges to main; one integration branch, one stamp, one merge. Worker workflows may commit on isolated branches/worktrees only.
- Trunk freshness gate (0G): fetch origin/main immediately before final release stamping; if main moved, integrate the delta and rerun affected tests; never force-push over unrelated main work.
- Self-enforced CI gate (0G): inspect actual CI results for the integration commit; missing/failed CI is a release blocker unless the exact test is proven locally and the operator explicitly authorizes an exception.
- Ultra Code is REQUIRED for this build (0I); verify enabled and usable before creating production workflows. Anti-downgrade gate at every compaction/recovery checkpoint: ULTRA_CODE_REQUIRED=true, WORKFLOW_MODE_REQUIRED=true, RAW_HIDDEN_SWARM_FORBIDDEN=true.
- 0J reconciliation heartbeat runs: before first dispatch; after each launch batch; after meaningful fan-in; before/after compaction or epoch rollover; before changing dependency wave; before final integration; before release stamp; after merge.
- Windows-native parity (0.3): no mandatory Spec Protocol runtime path may depend exclusively on Bash; cross-platform golden-fixture tests prove semantic equivalence.
- Mac regression in the primary Terminal.app + claude-nine path is a release blocker (0.3).

---

## E. ACCEPTANCE CRITERIA (Master Spec 0E workstreams, 0H agent bar, product sections 4-11, 28)

Every criterion is binary: PASS only when the stated evidence exists and the stated check is green. A box flips per the Box-flip rule at the top of this file — deliverable exists, tests pass, primary-source evidence exists, independent QC passes, acceptance criteria pass, project state updated. Per-workstream and product-level boxes (E.1/E.2) were removed 2026-08-30 (eradication sweep — they described the removed app); the box-flip rule above governs every remaining box.

### E.1 Per-workstream PASS criteria — REMOVED 2026-08-30 (eradication sweep: all 50 workstream rows were build acceptance criteria for the removed app)
### E.2 Product-level PASS criteria — REMOVED 2026-08-30 (eradication sweep: all rows were product acceptance criteria for the removed app)
### E.3 Cross-cutting acceptance criteria (spec 28, 0G, 0I, 0J — enforced alongside the gate sections above)

- [ ] Windows native deterministic-tool parity: capacity probing/resolution, task/anchor reconciliation, env sweep, ledger/state, update/self-update, and watchdog/heartbeat have a native Windows (PowerShell/Node) path; cross-platform golden-fixture tests prove macOS/Windows semantic equivalence; no mandatory Spec Protocol runtime step requires Git Bash or WSL (spec 0.3 P0).
- [ ] Windows capacity probes use native APIs ([Environment]::ProcessorCount, Get-CimInstance, Known Folders, [System.IO.Path]::GetTempPath(), Get-Command/where), never sysctl/nproc (spec 0.3).
- [ ] Mac primary-path regression blocker: Terminal.app + `claude-nine` failure fails the release (spec 0.3).
- [ ] Component manifest `CONTROL/bundled-components.json` (or equivalent) carries versions + SHA-256 checksums; downloads only from operator-controlled release locations (GitHub Releases default); install atomic; rollback works; downgrades rejected (spec 21/33).
- [ ] One final fan-in: no periodic intermediate merges to main; one integration branch, one coordinated version/stamp/tag, one merge to `main` (spec 0.1 override 1/0G).
- [ ] Trunk freshness gate: `origin/main` fetched immediately before final stamping; if moved, delta integrated and affected tests rerun; no force-push over unrelated main work (spec 0G).
- [ ] Self-enforced CI gate: actual CI results for the integration commit inspected; missing/failed CI blocks release unless the exact test is proven locally and the operator explicitly authorizes an exception (spec 0G).
- [ ] Workflow-only execution: every substantive task runs inside visible Workflow runs with seat pins; the conductor never implements directly; no raw Agent-tool fallback; no `DIRECT` implementation tasks (spec 0.0A/0D/29B).
- [ ] Ultra Code proven enabled before production workflow dispatch; anti-downgrade gate (`ULTRA_CODE_REQUIRED=true`, `WORKFLOW_MODE_REQUIRED=true`, `RAW_HIDDEN_SWARM_FORBIDDEN=true`) active at every compaction/recovery checkpoint (spec 0I).
- [ ] 17-document apparatus without duplicates: no duplicate root TODO/CHECKLIST/LEDGER/SESSION files; canonical carriers carry the state (spec 0J).
- [ ] Reconciliation heartbeat ran at every trigger (before first dispatch; after each launch batch; after meaningful fan-in; before/after compaction or epoch rollover; before changing dependency wave; before final integration; before release stamp; after merge) (spec 0J).
- [ ] Gate 0H gate-set discipline: A/B gates above re-verified at every dispatch point; a CHECKLIST/QC mismatch reopens the item (spec 0J reconciliation repairs).


---

EVIDENCE ANNEX removed 2026-08-30 (eradication sweep): both annexes recorded evidence for the removed app-build acceptance criteria.

