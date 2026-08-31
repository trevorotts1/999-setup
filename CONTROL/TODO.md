# CONTROL / TODO — Live Work Inventory

Created: 2026-08-21 (pre-dispatch baseline; nothing implemented yet)
Base/integration SHA: 6bb00ec70af69510fab5a9c2ef332751e260d036

---

## State model (per Master Spec 0J)

A work item progresses through these states:

    PENDING
    BLOCKED
    IN_PROGRESS
    BUILT_AWAITING_QC
    QC_REPAIR
    RECHECK
    COMPLETE

A builder return is BUILT_AWAITING_QC, never COMPLETE. Completion is declared only by the conductor from QC evidence (Master Spec 0J: "The conductor flips final completion boxes from evidence; builders do not self-promote").

Do not remove a task from this TODO merely because code exists. Follow the repository's completion/delivery rules (0J). A COMPLETE item with a failing required test reopens (0J reconciliation repairs).

---

## Reconciliation notes (0J heartbeat — before first dispatch and at each stated trigger)

Reconcile: MASTER SPEC <-> PROJECT MANIFEST; PROJECT MANIFEST <-> TODO; TODO <-> native task graph; task graph <-> EXECUTION-PLAN workflow board; workflow board <-> actual Workflow handles/trees; project_state ownership <-> actual branches/worktrees; builder handoffs <-> ledger QC verdict/recheck state; QC evidence <-> CHECKLIST; CHECKLIST <-> project_state; project_state <-> actual tests/Git state; LEDGER restart state <-> all current truth.

Required repairs: checklist says complete but QC proof missing -> reopen; TODO item missing from task graph -> restore it; board claims a run but no handle/tree proves it -> visibility drift; two writers claim the same unit -> freeze conflicting writes and reconcile ownership; completed item has a failing required test -> reopen; ledger/restart steps stale -> regenerate before further dispatch.

Compaction is never permission to re-plan from conversational memory (0J).

---

LIVE INVENTORY ADDENDUM and all later repair-session sections removed 2026-08-30 (eradication sweep):
every appended entry (2026-08-26 defect-repair, speech, compact, UI passes; 2026-08-27 session) inventoried
defects of the removed app. The 50-item workstream queue likewise removed — all 50 were build
workstreams for the removed app.
