# Candice Companion — Project Manifest

**Canonical source of truth:** `SPEC/MASTER-SPEC-2026-08-21.md` (V6 FINAL LOCKED, verbatim copy of the operator's supplied file; SHA-256 `dbc14f54b86ca7fb1ba27a5aa846b41e23ac14ebba283be22d0cd91e4e031d53` — re-verified 2026-08-21, matches).
**Baseline:** `999-setup` main `6bb00ec70af69510fab5a9c2ef332751e260d036` (2026-08-21 planning snapshot; re-fetch `main` before execution). Worktree HEAD `aa23ed9bf253c0f422e0a2f8b25b4e468d49f943` (branch `candice/wr001-bootstrap`).
**Status:** PLANNING. Not EXECUTING until the Section 29B bootstrap gates pass. Live board: `CONTROL/EXECUTION-PLAN.md` section 1 (board runs WR-001..WR-008; W1 launch IDs = snapshot slice IDs WR-008/WR-009/WR-012; WR-030..WR-032 RETIRED by the ID-collision correction).

This manifest is a structured index of the Master Spec — architecture summary, task graph outline, workflow definitions, ownership map, model seats. It is not a second spec and must not drift from the Master Spec. The Master Spec is the authority on every rule; the native task graph snapshot (`CONTROL/task-graph-snapshot.json`, 50 nodes, 116 edges, base `6bb00ec`) is the authority on workstream levels, dependencies, and owned paths.

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

Rules: no bare/unpinned agent calls; do not hardcode DeepSeek IDs in workflow scripts (opus/sonnet are routing seats; Nine-router decides provider); route proven by canary before dispatch; max-thinking proven on both seats before dispatch (0A, 0H). Canaries recorded: WR-004 COMPLETED 2026-08-21 — opus route PASS, sonnet route PASS, max-thinking PASS both seats (`CONTROL/project_state.json` candice namespace, `CAPACITY-LEDGER.md`).

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

Safe live width = min(500, builder_width + qc_width, measured harness, measured provider) — computed per the repository's current capacity resolver/profiler + Capacity Ledger; never exceed measured usable capacity or real runnable work; padding forbidden (every agent needs unique responsibility, evidence/input, deliverable, binary acceptance criterion). Live values 2026-08-21 (WR-004): safe width 50, visible runs 5, client cap 10, budget 1,000, reserve 300, epoch budget 700.

Wave forecast (planning aid, not barrier; dependency graph governs release):

| Logical wave | Primary purpose | Approx. useful width | Levels (snapshot wave_map) |
|---|---|---|---|
| W1 | Independent foundations/components | 300–500 | L0–L1 (17 workstreams) |
| W2 | Cross-component integration + rolling QC/fix | 250–400 | L2–L3 (23 workstreams) |
| W3 | End-to-end user journeys + system repair | 150–300 | L4–L5 (8 workstreams) |
| W4 | Cross-platform/update/failure/privacy hardening | 75–200 | L6 (1 workstream) |
| W5 | Final fan-in/release verification | 10–50 | L7 (1 workstream) |

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

Visibility: every run gets a WR-NNN id, meaningful label, appears on the WORKFLOW LAUNCH BOARD (`CONTROL/EXECUTION-PLAN.md` `## 1. CANDICE WORKFLOW-RUN BOARD`), real tool handle/tree captured and verified, machine state in `CONTROL/project_state.json`. `VISIBILITY-FAIL` runs are not counted as capacity. No raw Agent-tool substitute; no silent workflows.

---

## 5. Ownership map doctrine (Master Spec 0C)

Collision-free ownership is non-negotiable. Default isolation: one Git worktree/branch per workflow run or write-collision domain. Per-unit worktrees only when units overlap paths, a tool rewrites shared files, independent history is needed, or isolation is otherwise impossible.

Writer baton lifecycle: BUILDER OWNS -> checkpoint + handoff -> BUILDER RELEASES -> QC READS/VERDICTS -> (pass) ACCEPTED / (fail) QC TAKES BATON -> fix + repair commit -> QC RELEASES -> FRESH QC RECHECK -> ACCEPTED or REPAIR AGAIN. Builder and QC never edit the same unit simultaneously.

Identity convention:

```text
workflow-run: WR-033
slice:        candice-w1a-protocol-plugin-shell
branch:       candice/w1a-protocol-plugin-shell
worktree:     <run-root>/worktrees/w1a-protocol-plugin-shell
units:        WS-01, WS-02, WS-06 -> exact owned paths
```

Shared/single-writer (integration-owned; workers propose, one final writer applies): root/version release files, final `CHANGELOG.md`, final README release/version sections, Git tags, global component manifest/checksum file, whole-file lockfiles, non-partitionable CI/release files, final consolidated Spec Protocol `SKILL.md`.

Cross-lane rule: a defect outside your unit -> record CROSS-LANE-FINDING (source lane, affected unit, evidence, severity, recommended action); never silently edit the other unit.

Branch/worktree cleanup: retire accepted worker branches/worktrees per repo policy after integration; never delete the sole copy of unmerged work.

---

## 6. Task graph outline — 50 workstreams (Master Spec 0E)

The native task graph snapshot is the authority for levels and dependencies. Summary by level:

| Level | WS | Domain | Requires (artifact/evidence) |
|---|---|---:|---|
| L0 | WS-01 | event/question/answer schemas | — (contract root) |
| L0 | WS-02 | Claude plugin manifest + hook registration | — |
| L0 | WS-06 | Tauri application shell | — |
| L0 | WS-16 | whisper.cpp runtime integration | pinned whisper build/model (bundled or checksum download) |
| L0 | WS-17 | local microphone capture + PTT | — |
| L0 | WS-19 | Kokoro runtime + canonical voice | pinned runtime/voicepack; **voice approval is late-bound — engine ships versioned, voice swappable** (spec 7) |
| L0 | WS-48 | boss-cron portability repair | current repo tooling audit (WR-001 baseline) |
| L1 | WS-03 | session lifecycle + binding bridge | WS-01, WS-02 |
| L1 | WS-07 | transparent/frameless window behavior | WS-06 |
| L1 | WS-08 | Candice app state machine | WS-01, WS-06 |
| L1 | WS-11 | asset manifest + final-art loader | WS-06; 16 supplied art PNGs (present, 11A/11B) |
| L1 | WS-23 | macOS packaging/signing/notarization | WS-06; production signing creds = external operator input, late-bound |
| L1 | WS-24 | macOS resource/performance instrumentation | WS-06 |
| L1 | WS-28 | Windows microphone/audio/device path | WS-17 |
| L1 | WS-29 | Windows packaging/signing/SmartScreen | WS-06; signing creds late-bound |
| L1 | WS-30 | Windows resource/performance instrumentation | WS-06 |
| L1 | WS-40 | user name/preferences/local profile | WS-01 |
| L2 | WS-04 | structured `ask_user` MCP path | WS-01, WS-02, WS-03 |
| L2 | WS-05 | same-session free-conversation/terminal fallback adapter | WS-01, WS-03 |
| L2 | WS-09 | floating answer controls + PTT UI | WS-01, WS-08, WS-17 |
| L2 | WS-10 | compact progress-companion mode | WS-01, WS-03, WS-08 |
| L2 | WS-12 | mouth/viseme animation | WS-11, WS-19 (TTS timing/viseme classes) |
| L2 | WS-13 | blink/idle/head/gesture animation | WS-08, WS-11 |
| L2 | WS-15 | visual/transparent-background test harness | WS-06, WS-07, WS-11 |
| L2 | WS-20 | speech interruption, duplex safety, audio cleanup | WS-08, WS-17, WS-19 |
| L2 | WS-21 | macOS terminal-window discovery/binding | WS-03, WS-06 |
| L2 | WS-26 | Windows Win32 window discovery/binding | WS-03, WS-06 |
| L2 | WS-33 | bundled-component manifest/checksums/rollback | WS-02, WS-06 |
| L2 | WS-34 | version/preferences/schema migrations | WS-01, WS-40 |
| L3 | WS-14 | accessibility/reduced-motion/captions | WS-01, WS-08, WS-12, WS-13 |
| L3 | WS-18 | transcription confirmation/edit/retry | WS-01, WS-04, WS-16, WS-17 |
| L3 | WS-22 | macOS permissions + degraded floating mode | WS-06, WS-21 |
| L3 | WS-25 | macOS Terminal/iTerm compatibility | WS-21 |
| L3 | WS-27 | Windows Terminal/PowerShell/CMD compat + native deterministic-tool parity | WS-26 (+ P0 native-tool parity work, spec 0.3) |
| L3 | WS-31 | fresh-install Candice bootstrap | WS-02, WS-06, WS-23, WS-29, WS-33 |
| L3 | WS-35 | crash/restart/recovery/update rollback | WS-08, WS-33 |
| L3 | WS-36 | Spec Protocol Candice integration | WS-01, WS-02, WS-04, WS-05 |
| L3 | WS-41 | contract/schema test suite | WS-01, WS-04, WS-05 |
| L3 | WS-44 | privacy/security/secrets audit | WS-04, WS-17, WS-20, WS-40 |
| L3 | WS-45 | performance/load/resource test suite | WS-16, WS-19, WS-24, WS-30 |
| L4 | WS-32 | existing-user upgrade bootstrap | WS-31, WS-33, WS-34 |
| L4 | WS-37 | Kaizen Candice integration | WS-04, WS-05, WS-36 |
| L4 | WS-42 | same-session Claude + Claude-Nine test suite | WS-02, WS-03, WS-04, WS-05, WS-36 |
| L4 | WS-43 | failure/fallback/chaos test suite | WS-04, WS-16, WS-17, WS-19, WS-22, WS-35 |
| L5 | WS-38 | ELI5 Candice integration | WS-04, WS-05, WS-36, WS-37 |
| L5 | WS-46 | cross-platform CI/release matrix | WS-23, WS-29, WS-41, WS-42 |
| L5 | WS-47 | upgrade/backward-compatibility fixtures | WS-32, WS-34 |
| L5 | WS-49 | installer/updater regression + rollback validation | WS-31, WS-32, WS-33 |
| L6 | WS-39 | Bro Candice integration | WS-04, WS-05, WS-36, WS-37, WS-38 |
| L7 | WS-50 | end-to-end nontechnical-user acceptance harness | WS-31, WS-36, WS-37, WS-38, WS-39, WS-42 |

Full 50-workstream domain table and per-node owned paths: `CONTROL/task-graph-snapshot.json` (50 nodes, 116 edges; generated 2026-08-21, base `6bb00ec`; verified 50/50 against `CONTROL/EXECUTION-PLAN.md` section 6.1 by the qc-dag unit).

Slicing rule: workstreams are domains, not workflow files. Slice runnable units into visible runs of up to 5 builder+QC pairs; multiple disjoint workstreams may share a run; one workstream may need several runs; launch only as many runs as the Capacity Ledger allows in one conductor turn; never pad units to fill seats.

Regrouping permitted after reading the real repo, preserving: max safe parallelism, 5+5 shape, model pins, visibility, isolated ownership, one final release (0E "Dynamic remapping"). W1 launch IDs = snapshot slice IDs (binding ID-COLLISION CORRECTION, `CONTROL/EXECUTION-PLAN.md` section 1): W1-A -> WR-008 (WS-01/02/06), W1-B -> WR-009 (WS-16/17/19), W1-C -> WR-012 (WS-48). The earlier QC-FIX ROUND 1 re-keying (W1-A -> WR-031, W1-B -> WR-030, W1-C -> WR-032) is RETIRED — it collided with the manifest 9.2 row IDs and the snapshot slice IDs. Next-free launch IDs after the snapshot set: WR-033+ in launch order. Manifest 9.2 row IDs remain the owned-glob authorities, not launch IDs.

---

## 7. Control plane (Master Spec 0J, 29B)

Canonical files only — never create duplicate root-level `TODO.md`/`CHECKLIST.md`/`LIVE-LEDGER.md`/`SESSION.md`. Closed 17-document apparatus; other documents per `references/documents.md`.

```text
SPEC/MASTER-SPEC-2026-08-21.md       # THIS spec, canonicalized once (done: SPEC/MASTER-SPEC-2026-08-21.md)
SPEC/PROJECT-MANIFEST.md             # this file
CONTROL/EXECUTION-PLAN.md            # waves, live workflow-run board (section 1), parallelism plan, release strategy
CONTROL/TODO.md                      # ordered work queue; states PENDING/BLOCKED/IN_PROGRESS/BUILT_AWAITING_QC/QC_REPAIR/RECHECK/COMPLETE
CONTROL/CHECKLIST.md                 # binary proven-done boxes; flips only on deliverable+tests+evidence+independent QC+acceptance+state
CONTROL/LEDGER.md                    # current state + QC verdict blocks + merge record + literal restart steps
CONTROL/SESSION-LOG.md               # append-only narrative / corrections / history
CONTROL/dispatch-log.md              # before-send dispatch record
CONTROL/HEARTBEAT.md                 # agent progress heartbeat
CONTROL/CHANGELOG.md                 # release/batch history (spec 0J lists it; NOT yet created — created at release stamp, not before)
CONTROL/project_state.json           # machine-readable run truth (namespaced Candice fields; live, last_reconciliation 2026-08-21)
CONTROL/task-graph-snapshot.json     # native task graph export / reconciliation input (50 nodes, 116 edges, base 6bb00ec)
CAPACITY-LEDGER.md                   # computed width, role seats, execution budget, provenance (2026-08-21: width 50, runs 5)
```

`CONTROL/CHANGELOG.md` is listed by spec 0J as a canonical carrier; it does not yet exist in the repo (root `CHANGELOG.md` holds release history). It is created at the first release/batch stamp, not pre-created during planning.

Reconciliation heartbeat before first dispatch, after each launch batch, after fan-in, before/after compaction or epoch rollover, before wave change, before final integration, before release stamp, after merge. Compaction is never permission to re-plan from memory.

Bootstrap gates before `RUN_STATUS=EXECUTING` (29B): `ULTRA_CODE_REQUIRED=true`, `WORKFLOW_MODE_REQUIRED=true`, `RAW_HIDDEN_SWARM_FORBIDDEN=true`, `CONDUCTOR_DIRECT_IMPLEMENTATION_FORBIDDEN=true`, `ALL_SUBSTANTIVE_TASKS_REQUIRE_WORKFLOW=true`, `RUN_STATUS=PLANNING`, `RELEASE_READY=false`; latest `origin/main` fetched, baseline SHA + versions + tests recorded (baseline: WR-006, 5/5 suites PASS), Ultra Code PASS, Workflow probe PASS, task-graph probe PASS (snapshot present), Capacity Ledger PASS (WR-004), Opus/Sonnet canaries PASS (WR-004), max-thinking recorded, budget/epoch plan declared, control-plane reconciled, collision-free slices, visible run handles. Then Wave 1 may dispatch.

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

Baselines re-verified against live `VERSION` stamps 2026-08-21: spec-protocol `1.16.3`, nine-router-setup `1.16.3`, kaizen `1.0.1`, eli5 `1.0.0`, bro `1.0.0` (worktree `.claude/skills/*/VERSION`, matches root).

If `main` moved, derive bumps from current versions instead of forcing these numbers.

---

## 9. OWNERSHIP MAP (workstream slice map — Master Spec 0C, 0E, 0F, 0G)

Appended by the WR-003 planning/architecture run, 2026-08-21; reconciled to the native task graph snapshot by the ownership-map recheck unit 2026-08-21. Section 5 remains the doctrine (writer baton lifecycle, cross-lane rule, worktree/branch policy). The planned WR-NNN labels below are planning labels from this map; the conductor re-keys them to live board IDs at dispatch (0E dynamic remapping). **The owned globs are authoritative, not the run numbers.**

**Reconciliation note 2026-08-21 (ownership-map recheck):** the prior Plan-QC FAIL verdict (checks 1/2/5) and its repairs are recorded below. This revision re-verifies every row against `CONTROL/task-graph-snapshot.json` (50 nodes; owned_paths + deps + level per node) and `CONTROL/EXECUTION-PLAN.md` section 6.1 (qc-dag-reconciled, verified 50/50 against the snapshot): wave/dep column corrected to snapshot levels/deps; zero-dep set corrected from 12 to 7 units (WS-01, WS-02, WS-06, WS-16, WS-17, WS-19, WS-48 — WS-17 is zero-dep; WS-11/21/24/26/28/40 are L1, not L0); owned globs reconciled to snapshot owned_paths. Snapshot paths supersede the earlier hand-drawn src-layout naming where they differ (e.g. `src-tauri/stt/`, `src-tauri/tts/`, `src-tauri/audio/`, `src-tauri/binding/`, `src-tauri/recovery/`, `src-tauri/permissions/`, `src/animation/`, `src/profile/`, `scripts/candice-*/` app-level). The 9.2 rows below are the authoritative slice map; the snapshot slice field (`WR-008`..`WR-024`) is the graph's own planning grouping and does not override this map.

### 9.1 Writer roles

| Role | Seat | Writes | Applies |
|---|---|---|---|
| Builder B1-B5 | opus/max | owned unit globs in 9.2 | checkpoint commit on unit handoff |
| QC-as-fixer | sonnet/max | owned unit globs in 9.2 | blind verdict; on FAIL takes write baton, repair commit, releases to fresh recheck |
| Run integration owner | one designated writer per run | within-run shared set (9.3) | checkpoint commits after safe fan-in |
| Integration owner (0G fan-in) | integration workflow | shared classes (9.4) | one integration branch, one merged state |
| Release owner (0G stamp) | release workflow | version/stamp files (9.4) | one coordinated bump, one tag |
| Conductor | claude-nine | none | CONTROL/**, SPEC/MASTER-SPEC-2026-08-21.md, SPEC/PROJECT-MANIFEST.md, CAPACITY-LEDGER.md only (0J, 0.0A) |

### 9.2 Slice map — one row per planned run; owned globs disjoint by construction

Owned globs = snapshot `owned_paths` per workstream, normalized to globs. Wave/dep column = snapshot level + deps (L0 zero-dep set has 7 units). Existing repo trees `tests/{interview,macos,windows}/**`, `tests/README.md`, `spec/**`, `templates/**`, `holding/**`, `FIX-LEDGER.md` remain untouched by all lanes (regression-protected; changes only via CROSS-LANE-FINDING to the conductor).

| WR | Slice | Workstreams | Owned globs (exact) | Seats | Wave/dep (snapshot truth) |
|---|---|---|---|---|---|
| WR-010 | candice-protocol-schemas | WS-01 | `packages/candice-protocol/schemas/question-event.schema.json`, `packages/candice-protocol/schemas/answer-event.schema.json`, `packages/candice-protocol/schemas/status-event.schema.json`, `packages/candice-protocol/schemas/preferences.schema.json` (B1: question-event + answer-event + shared event envelope; B2: status-event + preferences.schema.json + schema index) | 2+2 | L0 — zero-dep |
| WR-011 | candice-plugin-core | WS-02, WS-03, WS-04, WS-05 | `plugins/candice-integration/.claude-plugin/**` + `plugins/candice-integration/hooks/hooks.json` + `plugins/candice-integration/bin/**` (WS-02; bin claim added by reconciliation 2026-08-21 — WR-008 WS-02 QC WARN: wake-candice.sh handler was unclaimed by any slice row, ownership fix closes it), `plugins/candice-integration/session/**` (WS-03), `plugins/candice-integration/mcp/**` incl. `plugins/candice-integration/.mcp.json` (WS-04), `plugins/candice-integration/fallback/**` + `plugins/candice-integration/README.md` (WS-05) | 4+4 | WS-02: L0 zero-dep; WS-03: L1 (needs WS-01, WS-02); WS-04: L2 (needs WS-01, WS-02, WS-03); WS-05: L2 (needs WS-01, WS-03) |
| WR-012 | candice-app-shell | WS-06, WS-07, WS-08, WS-09, WS-10 | `apps/candice-companion/src-tauri/*` (root-level Tauri files only: `Cargo.toml`, `tauri.conf.json`, `build.rs`, `icons/**`; NOT `macos/**`, `windows/**`, `binding/**`, `permissions/**`, `stt/**`, `tts/**`, `audio/**`, `recovery/**`, `window-config/**` — WR-015/WR-016/WR-017/WR-014/WR-018/WR-013) + `apps/candice-companion/src-tauri/src/**` (WS-06) + `apps/candice-companion/src/*` root-level entry files (WS-06), `apps/candice-companion/src/window/**` (WS-07), `apps/candice-companion/src/state/**` (WS-08), `apps/candice-companion/src/ui/answer-controls/**` + `apps/candice-companion/src/ui/ptt/**` (WS-09), `apps/candice-companion/src/ui/compact/**` (WS-10) | 5+5 | WS-06: L0 zero-dep; WS-07: L1 (needs WS-06); WS-08: L1 (needs WS-01, WS-06); WS-09: L2 (needs WS-01, WS-08, WS-17); WS-10: L2 (needs WS-01, WS-03, WS-08) |
| WR-013 | candice-assets-anim | WS-11, WS-12, WS-13, WS-14, WS-15 | `apps/candice-companion/assets/candice/**` — manifest + loader + derived derivatives; source PNGs READ-ONLY, never written (11A) (WS-11) + `apps/candice-companion/src/loader/**` (WS-11), `apps/candice-companion/src/animation/viseme/**` (WS-12), `apps/candice-companion/src/animation/gesture/**` (WS-13), `apps/candice-companion/src/a11y/**` + `apps/candice-companion/src/ui/captions/**` (WS-14), `apps/candice-companion/tests/visual/**` (WS-15) | 5+5 | WS-11: L1 (needs WS-06); WS-12: L2 (needs WS-11, WS-19); WS-13: L2 (needs WS-08, WS-11); WS-14: L3 (needs WS-01, WS-08, WS-12, WS-13); WS-15: L2 (needs WS-06, WS-07, WS-11) |
| WR-014 | candice-speech | WS-16, WS-17, WS-18, WS-19, WS-20 | `apps/candice-companion/src-tauri/stt/**` (WS-16), `apps/candice-companion/src-tauri/audio/capture/**` (WS-17), `apps/candice-companion/src/ui/transcript/**` (WS-18), `apps/candice-companion/src-tauri/tts/**` (WS-19), `apps/candice-companion/src-tauri/audio/duplex/**` + `apps/candice-companion/src-tauri/audio/cleanup/**` (WS-20) | 5+5 | WS-16: L0 zero-dep; WS-17: L0 zero-dep; WS-19: L0 zero-dep (late-bound voice swap); WS-18: L3 (needs WS-01, WS-04, WS-16, WS-17); WS-20: L2 (needs WS-08, WS-17, WS-19) |
| WR-015 | candice-macos | WS-21, WS-22, WS-23, WS-24, WS-25 | `apps/candice-companion/src-tauri/binding/macos/**` (WS-21), `apps/candice-companion/src-tauri/permissions/**` (WS-22), `apps/candice-companion/scripts/package-macos/**` (WS-23), `apps/candice-companion/src/platform/macos/instrumentation/**` (WS-24; snapshot owned_paths — supersedes the earlier `scripts/instrument-macos/**` naming), `apps/candice-companion/tests/terminal-compat/**` (WS-25) | 5+5 | WS-21: L2 (needs WS-03, WS-06); WS-22: L3 (needs WS-06, WS-21); WS-23: L1 (needs WS-06); WS-24: L1 (needs WS-06); WS-25: L3 (needs WS-21) |
| WR-016 | candice-windows | WS-26, WS-27, WS-28, WS-29, WS-30 | `apps/candice-companion/src-tauri/binding/windows/**` (WS-26), `tools/windows-parity/**` + `apps/candice-companion/tests/windows-shell-compat/**` (WS-27; deterministic-tool parity fixes are proposals to WR-019 lane, 0.3 P0), `apps/candice-companion/src-tauri/audio/capture-windows/**` (WS-28), `apps/candice-companion/scripts/package-windows/**` (WS-29), `apps/candice-companion/scripts/instrument-windows/**` (WS-30) | 5+5 | WS-26: L2 (needs WS-03, WS-06); WS-27: L3 (needs WS-26); WS-28: L1 (needs WS-17); WS-29: L1 (needs WS-06); WS-30: L1 (needs WS-06) |
| WR-017 | candice-bootstrap-upgrade | WS-31, WS-32, WS-33 | `AGENT_INSTALL.md` + `scripts/candice-bootstrap/**` (WS-31; note: `AGENT_INSTALL.md` is root-level, 9.4 item 1 class — WS-31 proposes, integration owner applies), `scripts/candice-upgrade/**` (WS-32), `CONTROL/bundled-components.json` fragment (proposal to the 9.4 owner, never applied by this lane) + `scripts/candice-updater/checksums/**` + `scripts/candice-updater/rollback/**` (WS-33) | 3+3 | WS-31: L3 (needs WS-02, WS-06, WS-23, WS-29, WS-33); WS-32: L4 (needs WS-31, WS-33, WS-34); WS-33: L2 (needs WS-02, WS-06) |
| WR-018 | candice-migrations | WS-34, WS-35, WS-40 | `apps/candice-companion/src/preferences/migrations/**` + `tests/migrations/**` (WS-34; schema version additions are proposals against WR-010-owned `packages/candice-protocol/schemas/**`), `apps/candice-companion/src-tauri/recovery/**` (WS-35), `apps/candice-companion/src/profile/**` (WS-40; preferences.schema.json changes proposed to WR-010) | 3+3 | WS-40: L1 (needs WS-01); WS-34: L2 (needs WS-01, WS-40); WS-35: L3 (needs WS-08, WS-33) — deps in full: WS-34 deps = WS-01, WS-40 |
| WR-019 | candice-skills | WS-36, WS-37, WS-38, WS-39, WS-48 | `.claude/skills/spec-protocol/SKILL.md` + `.claude/skills/spec-protocol/references/candice-companion.md` + `.claude/skills/spec-protocol/references/candice-question-contract.md` (WS-36; receives WS-27/WS-48 proposals; final SKILL.md consolidation is 9.4, not lane-applied), `plugins/candice-integration/integrations/kaizen/**` (WS-37), `plugins/candice-integration/integrations/eli5/**` (WS-38), `plugins/candice-integration/integrations/bro/**` (WS-39), `tools/boss-cron/**` + `tests/portability/**` (WS-48; portability fixes to `.claude/skills/spec-protocol/scripts/**` are proposals to WS-36) | 5+5 | WS-48: L0 zero-dep (baseline audit in hand); WS-36: L3 (needs WS-01, WS-02, WS-04, WS-05); WS-37: L4 (needs WS-04, WS-05, WS-36); WS-38: L5 (needs WS-04, WS-05, WS-36, WS-37); WS-39: L6 (needs WS-04, WS-05, WS-36, WS-37, WS-38) |
| WR-020 | candice-tests | WS-41, WS-42, WS-43, WS-45, WS-47 | `tests/contract/**` (WS-41), `tests/same-session/**` (WS-42), `tests/failure-matrix/**` (WS-43), `tests/performance/**` (WS-45), `tests/upgrade-fixtures/**` (WS-47) | 5+5 | WS-41: L3 (needs WS-01, WS-04, WS-05); WS-42: L4 (needs WS-02, WS-03, WS-04, WS-05, WS-36); WS-43: L4 (needs WS-04, WS-16, WS-17, WS-19, WS-22, WS-35); WS-45: L3 (needs WS-16, WS-19, WS-24, WS-30); WS-47: L5 (needs WS-32, WS-34) |
| WR-021 | candice-final-validation | WS-44, WS-46, WS-49, WS-50 | WS-44: READ-ONLY audit lane — `tests/privacy-audit/**` + `docs/privacy-audit/**` findings recorded as CROSS-LANE-FINDING + fix tickets. WS-46: proposal-only — `.github/workflows/candice-ci.yml` is 9.4 class; no write ownership. `tests/installer-regression/**` (WS-49), `tests/e2e-acceptance/**` (WS-50) | 2+2 write + 2 proposal lanes | WS-44: L3 (needs WS-04, WS-17, WS-20, WS-40); WS-46: L5 (needs WS-23, WS-29, WS-41, WS-42); WS-49: L5 (needs WS-31, WS-32, WS-33); WS-50: L7 (needs WS-31, WS-36, WS-37, WS-38, WS-39, WS-42) |

**Plan-QC blind verdict 2026-08-21 (independent sonnet/max, no conferral with planners): FAIL** — check 1 (completeness: `scripts/**` orchestrator edits and platform test paths unowned), check 2 (disjointness: `bin/**` nested overlap in WR-011; `src-tauri/src/platform/**` double-claimed), check 5 (DAG ordering: wave/dep column contradicted the declared DAG in `CONTROL/EXECUTION-PLAN.md` 6.1 for 8 L0 workstreams and 6 dependency lists). Checks 3 (acceptance criteria binary/checkable), 4 (board rows match 0D columns), 6 (under-width template complete) PASS. QC took the write baton and repaired rows WR-011..WR-021, the platform-boundary note, and 9.4. **FRESH RECHECK REQUIRED** by a different sonnet/max QC agent before implementation fan-out. **Recheck outcome 2026-08-21 (ownership-map recheck):** rows re-verified and re-reconciled against the native task graph snapshot; wave/dep column now matches snapshot levels/deps; zero-dep set corrected to the 7-unit truth (WS-01, WS-02, WS-06, WS-16, WS-17, WS-19, WS-48); residual WR-012-vs-WR-015/016 exclusion list tightened to the snapshot's exact `src-tauri` subdirectories. Rows WR-010..WR-021 above are the current authoritative state. **FRESH RECHECK still REQUIRED** by an independent sonnet/max QC agent before implementation fan-out (per QC lifecycle, this planning deliverable is RELEASED not ACCEPTED).

**Platform adapter boundary (spec 18):** shared code owns UI/state/captions/input/preferences/speech orchestration/protocol/MCP contract/temp cleanup/error fallback; platform modules own only window tracking/anchoring, permissions, install paths, startup, signing/package format, platform audio plumbing. Boundary rework paths mapped per snapshot owned_paths: shared `apps/candice-companion/src/**` platform-neutral modules -> owning WR of that directory; `apps/candice-companion/src-tauri/binding/**` -> WR-015 (macos) / WR-016 (windows); `apps/candice-companion/src-tauri/permissions/**` -> WR-015 (WS-22); `apps/candice-companion/src-tauri/window-config/**` -> WR-013 (WS-07); `apps/candice-companion/src-tauri/audio/**` -> WR-014 (capture/duplex/cleanup) / WR-016 (capture-windows); `apps/candice-companion/src-tauri/stt/**` + `src-tauri/tts/**` -> WR-014; `apps/candice-companion/src-tauri/recovery/**` -> WR-018 (WS-35); `apps/candice-companion/scripts/**` -> WR-015 (`package-macos`) / WR-016 (`package-windows`); `apps/candice-companion/src/platform/{macos,windows}/instrumentation/**` -> WR-015 (WS-24) / WR-016 (WS-30) per snapshot owned_paths (supersedes the earlier `instrument-macos`/`instrument-windows` script naming); `scripts/candice-*/**` (app-level) -> WR-017; `scripts/**` (repo-level) + `.github/workflows/**` -> 9.4 item 4 (integration/release owner; worker lanes propose fragments only, never apply). Source PNGs under `assets/candice/` are READ-ONLY for all lanes (9.4 item 8).

### 9.3 Within-run shared set (run integration owner of that run)

Files more than one unit in the same run legitimately touches; one designated writer per run applies final versions:

- `apps/candice-companion/package.json`, `apps/candice-companion/tauri.conf.json`, `apps/candice-companion/Cargo.toml`, app root configs (tsconfig/vite/rustfmt), any lockfile a package-manager rewrites whole-file;
- `plugins/candice-integration/.mcp.json` (consolidated endpoint registration);
- `apps/candice-companion/assets/candice/asset-manifest.json` (final consolidation; per-unit fragment proposals only).

### 9.4 Shared-file single-writer list — integration/release owner (0C classes, 0G release files; exact repo paths)

Workers propose fragments; ONLY the integration owner (fan-in) and release owner (stamp) apply these:

1. Root release/version docs: `CHANGELOG.md`, `README.md` (release/install/version sections), `AGENT_INSTALL.md`, `THIRD_PARTY_NOTICES.md` (WS-31/WS-32 proposals against `AGENT_INSTALL.md` land here)
2. Version files: `.claude/skills/{spec-protocol,kaizen,eli5,bro}/VERSION`; version fields in `apps/candice-companion/package.json`, `apps/candice-companion/tauri.conf.json`, `plugins/candice-integration` manifests
3. Component manifest/checksums: `CONTROL/bundled-components.json`, `CONTROL/bundled-skills.txt`
4. Global CI, non-partitionable: `.github/workflows/**` (incl. `.github/workflows/candice-ci.yml` — WS-46 proposes, owner applies); `scripts/**` orchestrators per spec 22 (`scripts/setup-macos.sh`, `scripts/setup-windows.ps1` as spec-named paths; live copies at `.claude/skills/nine-router-setup/scripts/`), `scripts/common/**`, repo-level `scripts/**` — unclaimed by any 9.2 row, edits are proposal-driven through the owning lane's cross-lane finding, applied only here
5. Final consolidated `.claude/skills/spec-protocol/SKILL.md` — multiple draft overlap (WS-36, WS-27/WS-48 portability proposals)
6. `launchers/**` — install/launch surface, unclaimed by any slice
7. Git tags — one final tag at release stamp
8. Read-only for ALL lanes (never written): `apps/candice-companion/assets/candice/` source PNGs (11A)

### 9.5 Control-plane files — never builder-owned

`CONTROL/**`, `SPEC/MASTER-SPEC-2026-08-21.md`, `SPEC/PROJECT-MANIFEST.md`, `CAPACITY-LEDGER.md`: conductor/QC-planning only (0J). Builders and QC-fixers never edit these; plan corrections flow through the conductor.

### 9.6 Disjointness invariant

Every owned glob appears in exactly one slice row of 9.2. The only multi-owner files are the enumerated 9.3 within-run set and the 9.4 shared classes. Before creating ANY new path under `apps/candice-companion/src/**` (EXCEPT the `src-tauri` subdirectories enumerated in the 9.2 exclusion lists and the platform-boundary mapping above), `packages/candice-protocol/**`, `plugins/candice-integration/**`, `tests/**`, or `scripts/**`, claim it in this map first — append the glob to the owning slice row (or add a row) before dispatch. A path claimed by two slices is a dispatch blocker until reconciled here.
