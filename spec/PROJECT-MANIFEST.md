# Candice Companion — Project Manifest

**Canonical source of truth:** `SPEC/MASTER-SPEC-2026-08-21.md` (V6 FINAL LOCKED, verbatim copy of the operator's supplied file; SHA-256 `dbc14f54b86ca7fb1ba27a5aa846b41e23ac14ebba283be22d0cd91e4e031d53`).
**Baseline:** `999-setup` main `6bb00ec70af69510fab5a9c2ef332751e260d036` (2026-08-21 planning snapshot; re-fetch `main` before execution).
**Status:** PLANNING. Not EXECUTING until the Section 29B bootstrap gates pass.

This manifest is a structured index of the Master Spec — architecture summary, task graph outline, workflow definitions, ownership map, model seats. It is not a second spec and must not drift from the Master Spec. The Master Spec is the authority on every rule.

---

## 1. Architecture summary (Master Spec sections 2, 3, 7, 10, 12, 13, 14, 17, 18)

Product: local visual + voice companion for BlackCEO Claude Code skills.

Division of labor:

```text
Claude Code session (plain `claude` or `claude-nine`) = brain, rules, memory, source of truth
Spec Protocol / Kaizen / ELI5 / Bro                  = governed behavior
Candice Companion app                                 = face, voice, ears, controls, progress companion
whisper.cpp                                           = local ears (STT)
Kokoro 82M-compatible local ONNX                      = local signature voice (TTS)
16 supplied RGBA PNG art assets (batch 1: 9, batch 2: 7) = lightweight animated body (late-bound)
```

Hard constraints:

- Candice is never a second AI conversation; never a competing project memory; never rewrites question order/rules of Spec Protocol or Kaizen.
- Workflow-only execution law (0.0A): conductor orchestrates, never implements. `WORKFLOW REQUIREMENT: WORKFLOW` mandatory for every substantive task; `DIRECT` forbidden.
- Ultra Code required and proven before production dispatch (0I); anti-downgrade gate active across compaction/recovery.
- One final coordinated fan-in, one version/release stamp/tag, one merge to `main` (0G, 0.1 override 1). Periodic intermediate merges disabled.
- Mac-first, Windows-native, both launchers (0.3). No WSL as product path. Mac Terminal.app + `claude-nine` is the reference path; its regression is a release blocker.
- Failure never stops Claude (20): every Candice failure degrades to text/terminal.

Key architecture pieces:

- Desktop shell: Tauri 2, one shared cross-platform codebase (12, 18); no game engine, no transparent-video character loop (10).
- Integration: local Claude Code plugin with hooks (immediate wake-up on `/spec-protocol`, `/kaizen`, `/eli5`, `/bro`), MCP structured bridge (`candice.status`, `candice.begin_session`, `candice.ask_user`, `candice.show_message`, `candice.set_progress`, `candice.compact`, `candice.end_session`) (13).
- Versioned question/answer/status/preferences JSON schemas; raw audio never in the response contract (14).
- Speech: whisper.cpp STT, Kokoro TTS — local, offline, pinned versions, checksum-verified models, canonical operator-approved voice (7).
- Privacy: PTT-only v1; mic live only while HOLD TO TALK pressed; audio `microphone -> in-memory/ring buffer -> whisper.cpp -> transcript -> discard`; no audio/secret logging (8).
- Window binding: macOS Accessibility native APIs (Terminal.app primary, iTerm2 where available; Accessibility denied -> movable floating mode); Windows Win32 top-level host window binding — host window is visual anchoring only, session ID is routing authority (17).
- Asset contract: `apps/candice-companion/assets/candice/asset-manifest.json`, stable production filenames, optimized derivatives, source PNGs untouched (11/11A/11B).
- Release: GitHub Releases in `trevorotts1/999-setup` default channel; cross-platform updater + `CONTROL/bundled-components.json`; signed/notarized Mac, Authenticode-preferred Windows (21, 22, 23, 26).
- Portability repair (24): remove operator-specific absolute paths and historical six-wave boss-campaign enforcement from generic runtime; P0 Windows native parity for deterministic tools (`sysctl`/`nproc` -> native APIs) (0.3 P0, 27).

---

## 2. Model seats (Master Spec 0, 0A, 0B, 0.3)

| Seat | Model pin (agent call must pin) | Thinking | Nine-router route (current) | Role |
|---|---|---|---|---|
| Builder | `opus` | max | DeepSeek V4 Flash | Build owned units; commit checkpoints; hand off |
| QC/fixer | `sonnet` | max | DeepSeek V4 Pro | Blind-verdict, then may take write baton, fix, re-test, release to fresh recheck |
| Fresh QC recheck | `sonnet` | max | DeepSeek V4 Pro | Independent recheck of any repaired unit; never the same agent that fixed |
| Conductor | `claude-nine` | — | — | Dispatch/reconcile/report ONLY (0.0A) |

Rules: no bare/unpinned agent calls; do not hardcode DeepSeek IDs in workflow scripts (opus/sonnet are routing seats; Nine-router decides provider); route proven by canary before dispatch; max-thinking proven on both seats before dispatch (0A, 0H).

---

## 3. Structural caps and safe width (Master Spec 0A, 0F)

```text
MAX_WORKFLOW_RUNS          = 50
MAX_AGENTS_PER_WORKFLOW    = 10
MAX_BUILDERS_PER_WORKFLOW  = 5
MAX_QC_PER_WORKFLOW        = 5
MAX_BUILDERS_GLOBAL        = 250
MAX_QC_GLOBAL              = 250
MAX_SUBAGENTS_GLOBAL       = 500
```

Safe live width = min(500, builder_width + qc_width, measured harness, measured provider) — computed per the repository's current capacity resolver/profiler + Capacity Ledger; never exceed measured usable capacity or real runnable work; padding forbidden (every agent needs unique responsibility, evidence/input, deliverable, binary acceptance criterion).

Wave forecast (planning aid, not barrier; dependency graph governs release):

| Logical wave | Primary purpose | Approx. useful width |
|---|---|---|
| W1 | Independent foundations/components | 300–500 |
| W2 | Cross-component integration + rolling QC/fix | 250–400 |
| W3 | End-to-end user journeys + system repair | 150–300 |
| W4 | Cross-platform/update/failure/privacy hardening | 75–200 |
| W5 | Final fan-in/release verification | 10–50 |

Waves require a documented dependency (WAVE-N-BLOCKED-BY: unit / requires output from / exact artifact). Epochs (session-budget rollovers) are separate from waves.

---

## 4. Workflow definitions (Master Spec 0A, 0B, 0D)

Default primitive: `pipeline()`. Default shape:

```text
WORKFLOW WF-NN (up to 10 seats)
B1..B5 builder opus/max -> Q1..Q5 QC/fixer sonnet/max (default pairing Bn -> Qn)
```

QC lifecycle per unit:

```text
blind verdict -> [pass: ACCEPTED] | [fail: QC takes baton -> fix -> tests -> repair commit -> release baton -> FRESH QC recheck]
```

Reusable parameterized workflow scripts only — launch multiple visible runs with deterministic args/slices; never 50 copy-pasted scripts. Scripts: plain JavaScript, no bare agent() calls, no unjustified top-level sequential chains, no forbidden nondeterministic calls, pass pre-dispatch validation (read `.claude/skills/spec-protocol/references/workflows.md` first). Sibling runs launched by the conductor in the same turn; workflow scripts cannot launch siblings.

Visibility: every run gets a WR-NNN id, meaningful label, appears on the WORKFLOW LAUNCH BOARD (`CONTROL/EXECUTION-PLAN.md` `## CANDICE WORKFLOW-RUN BOARD`), real tool handle/tree captured and verified, machine state in `CONTROL/project_state.json`. `VISIBILITY-FAIL` runs are not counted as capacity. No raw Agent-tool substitute; no silent workflows.

---

## 5. Ownership map (Master Spec 0C)

Collision-free ownership is non-negotiable. Default isolation: one Git worktree/branch per workflow run or write-collision domain. Per-unit worktrees only when units overlap paths, a tool rewrites shared files, independent history is needed, or isolation is otherwise impossible.

Writer baton lifecycle: BUILDER OWNS -> checkpoint + handoff -> BUILDER RELEASES -> QC READS/VERDICTS -> (pass) ACCEPTED / (fail) QC TAKES BATON -> fix + repair commit -> QC RELEASES -> FRESH QC RECHECK -> ACCEPTED or REPAIR AGAIN. Builder and QC never edit the same unit simultaneously.

Identity convention:

```text
workflow-run: WR-007
slice:        candice-ui-a
branch:       candice/wr007-ui-a
worktree:     <run-root>/worktrees/wr007-ui-a
units:        U1..U5 -> exact owned paths
```

Shared/single-writer (integration-owned; workers propose, one final writer applies): root/version release files, final `CHANGELOG.md`, final README release/version sections, Git tags, global component manifest/checksum file, whole-file lockfiles, non-partitionable CI/release files, final consolidated Spec Protocol `SKILL.md`.

Cross-lane rule: a defect outside your unit -> record CROSS-LANE-FINDING (source lane, affected unit, evidence, severity, recommended action); never silently edit the other unit.

Branch/worktree cleanup: retire accepted worker branches/worktrees per repo policy after integration; never delete the sole copy of unmerged work.

---

## 6. Task graph outline — 50 workstreams (Master Spec 0E)

| WS | Domain | | WS | Domain |
|---|---|---|---|---|
| WS-01 | event/question/answer schemas | | WS-26 | Windows Win32 window discovery/binding |
| WS-02 | Claude plugin manifest + hook registration | | WS-27 | Windows Terminal/PowerShell/CMD compat + native deterministic-tool parity |
| WS-03 | session lifecycle + binding bridge | | WS-28 | Windows microphone/audio/device path |
| WS-04 | structured `ask_user` MCP path | | WS-29 | Windows packaging/signing/SmartScreen path |
| WS-05 | same-session free-conversation/terminal fallback adapter | | WS-30 | Windows resource/performance instrumentation |
| WS-06 | Tauri application shell | | WS-31 | fresh-install Candice bootstrap |
| WS-07 | transparent/frameless window behavior | | WS-32 | existing-user upgrade bootstrap |
| WS-08 | Candice application state machine | | WS-33 | bundled-component manifest/checksums/rollback |
| WS-09 | floating answer controls + PTT UI | | WS-34 | version/preferences/schema migrations |
| WS-10 | compact progress-companion mode | | WS-35 | crash/restart/recovery/update rollback |
| WS-11 | asset manifest + final-art loader | | WS-36 | Spec Protocol Candice integration |
| WS-12 | mouth/viseme animation | | WS-37 | Kaizen Candice integration |
| WS-13 | blink/idle/head/gesture animation | | WS-38 | ELI5 Candice integration |
| WS-14 | accessibility/reduced-motion/captions | | WS-39 | Bro Candice integration |
| WS-15 | visual/transparent-background test harness | | WS-40 | user name/preferences/local profile |
| WS-16 | whisper.cpp runtime integration | | WS-41 | contract/schema test suite |
| WS-17 | local microphone capture + push-to-talk | | WS-42 | same-session Claude + Claude-Nine test suite |
| WS-18 | transcription confirmation/edit/retry | | WS-43 | failure/fallback/chaos test suite |
| WS-19 | Kokoro runtime + canonical Candice voice | | WS-44 | privacy/security/secrets audit |
| WS-20 | speech interruption, duplex safety, audio cleanup | | WS-45 | performance/load/resource test suite |
| WS-21 | macOS terminal-window discovery/binding | | WS-46 | cross-platform CI/release matrix |
| WS-22 | macOS permissions + degraded floating mode | | WS-47 | upgrade/backward-compatibility fixtures |
| WS-23 | macOS packaging/signing/notarization path | | WS-48 | operator-specific boss-cron portability repair |
| WS-24 | macOS resource/performance instrumentation | | WS-49 | installer/updater regression and rollback validation |
| WS-25 | macOS Terminal/iTerm compatibility | | WS-50 | end-to-end nontechnical-user acceptance harness |

Slicing rule: workstreams are domains, not workflow files. Slice runnable units into visible runs of up to 5 builder+QC pairs; multiple disjoint workstreams may share a run; one workstream may need several runs; launch only as many runs as the Capacity Ledger allows in one conductor turn; never pad units to fill seats.

Regrouping permitted after reading the real repo, preserving: max safe parallelism, 5+5 shape, model pins, visibility, isolated ownership, one final release (0E "Dynamic remapping").

---

## 7. Control plane (Master Spec 0J, 29B)

Canonical files only — never create duplicate root `TODO.md`/`CHECKLIST.md`/`LIVE-LEDGER.md`/`SESSION.md`. Closed 17-document apparatus; other documents per `references/documents.md`.

```text
SPEC/MASTER-SPEC-YYYY-MM-DD.md     # THIS spec, canonicalized once (done: SPEC/MASTER-SPEC-2026-08-21.md)
SPEC/PROJECT-MANIFEST.md           # this file
CONTROL/EXECUTION-PLAN.md          # waves, live workflow-run board, parallelism plan, release strategy
CONTROL/TODO.md                    # ordered work queue; states PENDING/BLOCKED/IN_PROGRESS/BUILT_AWAITING_QC/QC_REPAIR/RECHECK/COMPLETE
CONTROL/CHECKLIST.md               # binary proven-done boxes; flips only on deliverable+tests+evidence+independent QC+acceptance+state
CONTROL/LEDGER.md                  # current state + QC verdict blocks + merge record + literal restart steps
CONTROL/SESSION-LOG.md             # append-only narrative / corrections / history
CONTROL/dispatch-log.md            # before-send dispatch record
CONTROL/HEARTBEAT.md               # agent progress heartbeat
CONTROL/CHANGELOG.md               # release/batch history
CONTROL/project_state.json         # machine-readable run truth (namespaced Candice fields)
CONTROL/task-graph-snapshot.json   # native task graph export / reconciliation input
CAPACITY-LEDGER.md                 # computed width, role seats, execution budget, provenance
```

Reconciliation heartbeat before first dispatch, after each launch batch, after fan-in, before/after compaction or epoch rollover, before wave change, before final integration, before release stamp, after merge. Compaction is never permission to re-plan from memory.

Bootstrap gates before `RUN_STATUS=EXECUTING` (29B): `ULTRA_CODE_REQUIRED=true`, `WORKFLOW_MODE_REQUIRED=true`, `RAW_HIDDEN_SWARM_FORBIDDEN=true`, `CONDUCTOR_DIRECT_IMPLEMENTATION_FORBIDDEN=true`, `ALL_SUBSTANTIVE_TASKS_REQUIRE_WORKFLOW=true`, `RUN_STATUS=PLANNING`, `RELEASE_READY=false`; latest `origin/main` fetched, baseline SHA + versions + tests recorded, Ultra Code PASS, Workflow probe PASS, task-graph probe PASS, Capacity Ledger PASS, Opus/Sonnet canaries PASS, max-thinking recorded, budget/epoch plan declared, control-plane reconciled, collision-free slices, visible run handles. Then Wave 1 may dispatch.

Acceptance gates (0H) and the Section 28 acceptance checklist gate the merge; final merge per Section 29 completion rule.

---

## 8. Version plan (Master Spec 26 — re-read current versions before changing)

| Component | Baseline (planning snapshot) | Target |
|---|---|---|
| Spec Protocol | 1.16.3 | 1.17.0 |
| Nine-router setup | 1.16.3 | 1.17.0 (if installer/update behavior changes) |
| Kaizen | 1.0.1 | 1.1.0 |
| ELI5 | 1.0.0 | 1.1.0 |
| Bro | 1.0.0 | 1.1.0 |
| Candice Integration plugin | — | 1.0.0 |
| Candice Companion app | — | 1.0.0 |

If `main` moved, derive bumps from current versions instead of forcing these numbers.
