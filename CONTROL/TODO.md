# CONTROL / TODO — Live Work Inventory

Project: Candice Companion AI (spec-protocol build, 999-setup repo)
Canonical Master Spec: /Users/blackceomacmini/Downloads/CANDICE_COMPANION_AI_IMPLEMENTATION_SPEC_V6_FINAL_LOCKED.md (canonicalized as SPEC/MASTER-SPEC-2026-08-21.md)
Source of this inventory: Master Spec Section 0E — CANDICE WORKSTREAM MAP (50 workstreams, maximum decomposition envelope).
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

## Workstream queue (WS-01 .. WS-50)

All workstreams are currently PENDING. The zero-dependency runnable set, safe live width, and run slices are computed by the Capacity Ledger and the native task graph before any dispatch (0E: do not pre-launch all 50 merely because 50 exist; slice into paired runs of at most 5 build units).

- WS-01 | Candice event/question/answer schemas | PENDING
- WS-02 | Claude plugin manifest and hook registration | PENDING
- WS-03 | session lifecycle + binding bridge | PENDING
- WS-04 | structured ask_user MCP path | PENDING
- WS-05 | same-session free-conversation/terminal fallback adapter | PENDING
- WS-06 | Tauri application shell | PENDING
- WS-07 | transparent/frameless window behavior | PENDING
- WS-08 | Candice application state machine | PENDING
- WS-09 | floating answer controls + PTT UI | PENDING
- WS-10 | compact progress-companion mode | PENDING
- WS-11 | asset manifest + final-art loader | PENDING
- WS-12 | mouth/viseme animation | PENDING
- WS-13 | blink/idle/head/gesture animation | PENDING
- WS-14 | accessibility/reduced-motion/captions | PENDING
- WS-15 | visual/transparent-background test harness | PENDING
- WS-16 | whisper.cpp runtime integration | PENDING
- WS-17 | local microphone capture + push-to-talk | PENDING
- WS-18 | transcription confirmation/edit/retry | PENDING
- WS-19 | Kokoro runtime + canonical Candice voice | PENDING
- WS-20 | speech interruption, duplex safety, audio cleanup | PENDING
- WS-21 | macOS terminal-window discovery/binding | PENDING
- WS-22 | macOS permissions + degraded floating mode | PENDING
- WS-23 | macOS packaging/signing/notarization path | PENDING
- WS-24 | macOS resource/performance instrumentation | PENDING
- WS-25 | macOS Terminal/iTerm compatibility | PENDING
- WS-26 | Windows Win32 window discovery/binding | PENDING
- WS-27 | Windows Terminal/PowerShell/CMD compatibility + native deterministic-tool parity | PENDING
- WS-28 | Windows microphone/audio/device path | PENDING
- WS-29 | Windows packaging/signing/SmartScreen path | PENDING
- WS-30 | Windows resource/performance instrumentation | PENDING
- WS-31 | fresh-install Candice bootstrap | PENDING
- WS-32 | existing-user upgrade bootstrap | PENDING
- WS-33 | bundled-component manifest/checksums/rollback | PENDING
- WS-34 | version/preferences/schema migrations | PENDING
- WS-35 | crash/restart/recovery/update rollback | PENDING
- WS-36 | Spec Protocol Candice integration | PENDING
- WS-37 | Kaizen Candice integration | PENDING
- WS-38 | ELI5 Candice integration | PENDING
- WS-39 | Bro Candice integration | PENDING
- WS-40 | user name/preferences/local profile | PENDING
- WS-41 | contract/schema test suite | PENDING
- WS-42 | same-session Claude + Claude-Nine test suite | PENDING
- WS-43 | failure/fallback/chaos test suite | PENDING
- WS-44 | privacy/security/secrets audit | PENDING
- WS-45 | performance/load/resource test suite | PENDING
- WS-46 | cross-platform CI/release matrix | PENDING
- WS-47 | upgrade/backward-compatibility fixtures | PENDING
- WS-48 | operator-specific boss-cron portability repair | PENDING
- WS-49 | installer/updater regression and rollback validation | PENDING
- WS-50 | end-to-end nontechnical-user acceptance harness | PENDING

---

## Reconciliation notes (0J heartbeat — before first dispatch and at each stated trigger)

Reconcile: MASTER SPEC <-> PROJECT MANIFEST; PROJECT MANIFEST <-> TODO; TODO <-> native task graph; task graph <-> EXECUTION-PLAN workflow board; workflow board <-> actual Workflow handles/trees; project_state ownership <-> actual branches/worktrees; builder handoffs <-> ledger QC verdict/recheck state; QC evidence <-> CHECKLIST; CHECKLIST <-> project_state; project_state <-> actual tests/Git state; LEDGER restart state <-> all current truth.

Required repairs: checklist says complete but QC proof missing -> reopen; TODO item missing from task graph -> restore it; board claims a run but no handle/tree proves it -> visibility drift; two writers claim the same unit -> freeze conflicting writes and reconcile ownership; completed item has a failing required test -> reopen; ledger/restart steps stale -> regenerate before further dispatch.

Compaction is never permission to re-plan from conversational memory (0J).
