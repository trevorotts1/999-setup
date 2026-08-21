# CONTROL / CHECKLIST — Binary Proven-Done Boxes

Project: Candice Companion AI (spec-protocol build, 999-setup repo)
Canonical Master Spec: /Users/blackceomacmini/Downloads/CANDICE_COMPANION_AI_IMPLEMENTATION_SPEC_V6_FINAL_LOCKED.md (canonicalized as SPEC/MASTER-SPEC-2026-08-21.md)
Created: 2026-08-21 (pre-dispatch baseline). Every box below is UNCHECKED — nothing is proven yet.
Base/integration SHA: 6bb00ec70af69510fab5a9c2ef332751e260d036

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

Nothing may be dispatched to implementation until all of these are proven. All unchecked.

- [ ] Capacity Ledger/profiler result is current.
- [ ] Opus route canary confirms the expected builder route.
- [ ] Sonnet route canary confirms the expected QC route.
- [ ] Max-thinking configuration is proven on both seats.
- [ ] Native task graph exists.
- [ ] Workflow Launch Board section exists in CONTROL/EXECUTION-PLAN.md.
- [ ] Every planned workflow has unique ownership.
- [ ] Worktree/branch isolation plan exists.
- [ ] Shared-file single-writer list exists.
- [ ] Safe live width is calculated.
- [ ] No agent is padding.

## B. POST-CREATION GATES (Master Spec 0H — "After workflow creation")

All unchecked.

- [ ] Every real workflow has a returned workflow ID.
- [ ] Every real workflow run appears on the visible board and has a real tool handle/tree.
- [ ] Workflow-run handle/tree visibility verification passes.
- [ ] Builder/QC model pins are explicit.
- [ ] Every live agent has a unit, deliverable, evidence/input, and acceptance criterion.

## C. EXECUTION GATES (Master Spec 0H — "During execution")

All unchecked.

- [ ] No two writers own the same unit simultaneously.
- [ ] QC begins per-unit on handoff, not at an all-builders barrier.
- [ ] QC repairs local defects.
- [ ] Repaired QC output receives a fresh independent recheck.
- [ ] Free seats take runnable work.
- [ ] New waves exist only for documented dependencies.

## D. PRE-FINAL-MERGE GATES (Master Spec 0H — "Before final merge")

All unchecked.

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
- Model pins (0A): every builder call pins opus/max; every QC call pins sonnet/max; never a bare/unpinned call; route proven by canary before dispatch.
- One final fan-in (0G, override): no periodic intermediate merges to main; one integration branch, one stamp, one merge. Worker workflows may commit on isolated branches/worktrees only.
- Trunk freshness gate (0G): fetch origin/main immediately before final release stamping; if main moved, integrate the delta and rerun affected tests; never force-push over unrelated main work.
- Self-enforced CI gate (0G): inspect actual CI results for the integration commit; missing/failed CI is a release blocker unless the exact test is proven locally and the operator explicitly authorizes an exception.
- Ultra Code is REQUIRED for this build (0I); verify enabled and usable before creating production workflows. Anti-downgrade gate at every compaction/recovery checkpoint: ULTRA_CODE_REQUIRED=true, WORKFLOW_MODE_REQUIRED=true, RAW_HIDDEN_SWARM_FORBIDDEN=true.
- 0J reconciliation heartbeat runs: before first dispatch; after each launch batch; after meaningful fan-in; before/after compaction or epoch rollover; before changing dependency wave; before final integration; before release stamp; after merge.
- Windows-native parity (0.3): no mandatory Spec Protocol/Candice runtime path may depend exclusively on Bash; cross-platform golden-fixture tests prove semantic equivalence.
- Mac regression in the primary Terminal.app + claude-nine path is a release blocker (0.3).
