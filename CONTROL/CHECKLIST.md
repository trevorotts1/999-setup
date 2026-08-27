# CONTROL / CHECKLIST — Binary Proven-Done Boxes

<!-- CANDICE_RELEASE_REPAIR_STATUS: lifecycle=REPAIR_IN_PROGRESS open=24 complete=0 -->

> **FIX-001 release-truth override (2026-08-22):** The historical WS boxes
> below are not release authorization. Current Candice repair state is 24 open
> fixes and zero completed fixes. Only `CONTROL/release-gate.json` plus a zero
> exit from `scripts/candice-release/status.mjs` can authorize distribution.

Project: Candice Companion AI (spec-protocol build, 999-setup repo)
Canonical Master Spec: /Users/blackceomacmini/Downloads/CANDICE_COMPANION_AI_IMPLEMENTATION_SPEC_V6_FINAL_LOCKED.md (canonicalized as SPEC/MASTER-SPEC-2026-08-21.md)
Created: 2026-08-21 (pre-dispatch baseline). Refreshed 2026-08-21 (planning recheck): gates A and B (all five B gates) flipped from primary-source evidence; prebuild truth gate fresh independent sonnet/max recheck PASSED (SESSION-LOG 2026-08-21). Refreshed 2026-08-21 (acceptance-criteria QC-FIX — post TRUTH CONTRADICTION RESOLUTION): gate counts re-derived from the reconciled machine truth (23 intended handles, max agents per workflow 10) and the run-ID rekeying to snapshot slice IDs (WR-008/WR-009/WR-012 launch IDs; next free WR-033+). Refreshed 2026-08-21 (acceptance-criteria FRESH FIXER — post fresh-recheck FAIL on record-staleness, 0.1 override 2): run-liveness counts re-derived from live machine truth — 24 run dirs, 23 terminal records (21 completed, 2 killed), 0 active, 0 live. Nothing is implemented yet — every E box remains UNCHECKED.
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

Nothing may be dispatched to implementation until all of these are proven. Status per the 2026-08-21 prebuild truth gate (blind sonnet/max QC FAIL six-part fix list → QC-FIX ROUND 1 applied → fresh independent sonnet/max recheck PASS — SESSION-LOG 2026-08-21).

- [x] Capacity Ledger/profiler result is current. — CAPACITY-LEDGER.md 2026-08-21: clientCap 10, safe width 50, budget 700, role-aware runs 10.
- [x] Opus route canary confirms the expected builder route. — PASS, WR-004 `wf_b9f59642-d5c` COMPLETED.
- [x] Sonnet route canary confirms the expected QC route. — PASS, WR-004 `wf_b9f59642-d5c` COMPLETED.
- [x] Max-thinking configuration is proven on both seats. — PASS both seats, WR-004 `wf_b9f59642-d5c` COMPLETED.
- [x] Native task graph exists. — CONTROL/task-graph-snapshot.json, schema candice/task-graph-snapshot@1, 50 nodes/116 edges, generated 2026-08-21 by WR-007 planning, revalidated 2026-08-21 (rolling recheck, PASS).
- [x] Workflow Launch Board section exists in CONTROL/EXECUTION-PLAN.md. — section 1 "CANDICE WORKFLOW-RUN BOARD", all 10 spec-0D columns.
- [x] Every planned workflow has unique ownership. — task-graph slices disjoint-owned paths; EXECUTION-PLAN 3.4 run-ID hygiene + 6.2 ownership columns.
- [x] Worktree/branch isolation plan exists. — EXECUTION-PLAN 3.4 (0C: one worktree/branch per run or collision domain).
- [x] Shared-file single-writer list exists. — EXECUTION-PLAN 3.4 + section 6 (0C integration-owned list).
- [x] Safe live width is calculated. — 50 (spec 0A formula; CAPACITY-LEDGER 2026-08-21; role_aware_runs 10 governs dispatch).
- [x] No agent is padding. — all four agent properties nameable per unit; 6.4 under-width table records why the W1 slices are sub-10-agent.

## B. POST-CREATION GATES (Master Spec 0H — "After workflow creation")

Apparatus runs (WR-001..WR-008 + 10 audit/watchdog/repair/reconcile runs) are post-creation; these gates are proven for them. Implementation runs do not exist yet (zero build slices dispatched; next free launch IDs WR-033+) — these gates re-open for every new launch batch.

- [x] Every real workflow has a returned workflow ID. — 23/23 real handles in CONTROL/project_state.json candice `intended` + board section 1 (TRUTH CONTRADICTION RESOLUTION 2026-08-21 enumeration; max agents per workflow 10 invariant). Live machine truth 2026-08-21: 24 run dirs on disk, 23 terminal records (21 completed, 2 killed — wf_edc5ea4c-947, wf_40977ba0-353), 0 active, 0 live.
- [x] Every real workflow run appears on the visible board and has a real tool handle/tree. — 23/23 board rows; handles recorded; VISIBILITY-FAIL list empty after QC-FIX ROUND 1 and TRUTH CONTRADICTION RESOLUTION 2026-08-21.
- [x] Workflow-run handle/tree visibility verification passes. — fresh recheck verified every intended handle counted in board (min 2 hits each) and all rows carry 0D columns; 2026-08-21 reconciliation re-verified all 23 enumerated handles have board rows; run-liveness re-verified against live machine truth 2026-08-21: 24 run dirs, 23 terminal records (21 completed, 2 killed), 0 active, 0 live.
- [x] Builder/QC model pins are explicit. — every launched run pins opus/max builder + sonnet/max QC seats (board columns); canaries proved routes before dispatch.
- [x] Every live agent has a unit, deliverable, evidence/input, and acceptance criterion. — proven for apparatus runs; re-proven per implementation run at dispatch (0H/0A no-padding bar).

## C. EXECUTION GATES (Master Spec 0H — "During execution")

Not yet reached — zero implementation units dispatched (WS-01..WS-50 all PENDING, TODO.md). All unchecked; these open at WR-009+ dispatch.

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
- Model pins (0A): every builder call pins opus/max; every QC call pins sonnet/max; never a bare/unpinned call; route proven by canary before dispatch.
- One final fan-in (0G, override): no periodic intermediate merges to main; one integration branch, one stamp, one merge. Worker workflows may commit on isolated branches/worktrees only.
- Trunk freshness gate (0G): fetch origin/main immediately before final release stamping; if main moved, integrate the delta and rerun affected tests; never force-push over unrelated main work.
- Self-enforced CI gate (0G): inspect actual CI results for the integration commit; missing/failed CI is a release blocker unless the exact test is proven locally and the operator explicitly authorizes an exception.
- Ultra Code is REQUIRED for this build (0I); verify enabled and usable before creating production workflows. Anti-downgrade gate at every compaction/recovery checkpoint: ULTRA_CODE_REQUIRED=true, WORKFLOW_MODE_REQUIRED=true, RAW_HIDDEN_SWARM_FORBIDDEN=true.
- 0J reconciliation heartbeat runs: before first dispatch; after each launch batch; after meaningful fan-in; before/after compaction or epoch rollover; before changing dependency wave; before final integration; before release stamp; after merge.
- Windows-native parity (0.3): no mandatory Spec Protocol/Candice runtime path may depend exclusively on Bash; cross-platform golden-fixture tests prove semantic equivalence.
- Mac regression in the primary Terminal.app + claude-nine path is a release blocker (0.3).

---

## E. ACCEPTANCE CRITERIA (Master Spec 0E workstreams, 0H agent bar, product sections 4-11, 28)

Every criterion is binary: PASS only when the stated evidence exists and the stated check is green. A box flips per the Box-flip rule at the top of this file — deliverable exists, tests pass, primary-source evidence exists, independent QC passes, acceptance criteria pass, project state updated. All E boxes remain UNCHECKED (2026-08-21, planning — nothing implemented yet); the box-flip rule requires a passing independent QC verdict per workstream before any E box flips.

### E.1 Per-workstream PASS criteria (one per WS; WS-16 is the canonical example)

- [ ] WS-01 PASS: `question-event`, `answer-event`, `status-event`, `preferences` JSON schemas exist in `packages/candice-protocol/schemas/`, validate against fixtures, and question keys are stable (WS-41 contract suite green).
- [ ] WS-02 PASS: Candice plugin manifest + hooks registered; the wake-up hook detects `/spec-protocol`, `/kaizen`, `/eli5`, `/bro` and raises Candice within a few seconds, before preflight completes.
- [ ] WS-03 PASS: `begin_session`/`end_session` lifecycle works; the bridge binds the app to the Claude session ID; session identity is the routing authority, never the window.
- [ ] WS-04 PASS: `candice.ask_user` MCP path delivers a question and returns exactly one answer to the owning session.
- [ ] WS-05 PASS: same-session free-conversation/terminal fallback adapter delivers the question normally in Claude when MCP is unavailable, without double-counting.
- [ ] WS-06 PASS: Tauri 2 shell launches from a prebuilt artifact on macOS Apple Silicon and Windows x64 with no build toolchain on the customer machine.
- [x] WS-07 PASS: Candice window is transparent and frameless, always-on-top, no baked terminal/UI background. *(WS-06 shell-apply wf_29a7def2-1b2 OK: tauri.conf.json window transparent=true/decorations=false/alwaysOnTop=true/shadow=false + macOSPrivateApi=true; capabilities/main.json core:window:allow-set-always-on-top + allow-start-dragging; npm run build rc=0; npx tauri build --debug --no-bundle rc=0)*
- [ ] WS-08 PASS: state machine covers idle, listening, transcribing, confirming, thinking, speaking, compact, recovering, text-fallback; all transitions driven by real status events, never invented progress.
- [ ] WS-09 PASS: every question offers both HOLD TO TALK and TYPE ANSWER; listening state is unmistakable (glow/pulse + "LISTENING — LET GO WHEN FINISHED"); release shows transcript with USE ANSWER / EDIT / TRY AGAIN.
- [ ] WS-10 PASS: compact companion remains after the interview, accepts voice and typed questions, can submit `/bro` and `/eli5`, and expands on click.
- [ ] WS-11 PASS: `asset-manifest.json` maps all 16 supplied assets (9 first-batch + 7 second-batch) with stable production filenames, source→derived mapping, and checksums; no ChatGPT download filenames in production code (Master Spec 11/11A/11B).
- [ ] WS-12 PASS: mouth/viseme states synchronize to TTS timing; face-state registration was measured before whole-frame speech animation was used.
- [ ] WS-13 PASS: blink/idle/head/gesture animation is lightweight (sprite/transform-based), lazy-loaded, and works on light and dark backgrounds.
- [ ] WS-14 PASS: captions always shown regardless of voice state; OS reduced-motion setting is respected.
- [ ] WS-15 PASS: transparent-background test harness proves alpha edges on both light and dark desktop backgrounds.
- [ ] WS-16 PASS: whisper.cpp pinned + bundled/deterministic model + checksum verify + local transcription test green.
- [ ] WS-17 PASS: microphone is live only while HOLD TO TALK is pressed; device enumeration and no-device fallback work; typing remains available when mic is denied.
- [ ] WS-18 PASS: no voice transcription is submitted to the skill until the user confirms; EDIT and TRY AGAIN work; confirmed answer counted exactly once.
- [ ] WS-19 PASS: Kokoro 82M-compatible ONNX runtime pinned; the operator-approved canonical Candice voice is the same voice on macOS and Windows; voicepack/version replaceable without bridge/UI contract change.
- [ ] WS-20 PASS: pressing PTT while Candice speaks stops her speech immediately; Candice's own TTS output never feeds STT; temp audio is discarded after transcription.
- [ ] WS-21 PASS: Candice anchors beside Terminal.app and follows move/resize/minimize/monitor changes; iTerm2 supported where installed.
- [ ] WS-22 PASS: Accessibility denied → movable independent floating companion with plain-language optional-permission explanation; Claude never stops.
- [x] WS-23 PASS: macOS artifact signed with Developer ID + notarized + Gatekeeper-accepted, or the missing-credentials limitation is recorded as an external release blocker (Gatekeeper never disabled). *(fresh recheck PASS 7/7 — relocation to `scripts/package-macos/**`, provenance 8/8, self-test 11/11, cargo 2/2 — wf_e364c020-184)*
- [ ] WS-24 PASS: idle/speaking/listening CPU + RSS measured on Apple Silicon; regression thresholds present in CI.
- [ ] WS-25 PASS: Terminal.app + `claude-nine` end-to-end path passes (release blocker if broken); plain `claude` path also passes with plain Claude routing untouched.
- [ ] WS-26 PASS: Win32 APIs bind to the top-level host window for visual anchoring; host window is never treated as session identity; multi-tab/panes cannot cross-route Candice input between Claude sessions; injection disables itself when the exact target session cannot be proven.
- [ ] WS-27 PASS: native Windows matrix (Windows Terminal + PS 5.1/PS 7/CMD, standalone console hosts) resolves and launches both `claude` and `claude-nine.cmd`; no mandatory Spec Protocol/Candice runtime step requires Git Bash or WSL; golden-fixture tests prove macOS/Windows semantic equivalence.
- [x] WS-28 PASS: Windows microphone/device path works with PTT; no-device and permission-denied paths fall back to typing. *(fresh recheck PASS 6/6, winner B-Rust, chain 4+6 — wf_e121baf0-14a)*
- [ ] WS-29 PASS: Windows installer/executable is Authenticode-signed, or the limitation is recorded and the installer is not misrepresented as trusted.
- [ ] WS-30 PASS: Windows resource instrumentation measures idle/speaking/listening CPU + RSS using native Windows APIs.
- [ ] WS-31 PASS: fresh 999 setup installs bundled skills, Candice plugin, companion app, pinned STT/TTS assets, launch command, and version/checksum metadata automatically; no source compile on the customer machine.
- [ ] WS-32 PASS: existing-user update detects newer Spec Protocol, self-updates safely, installs missing/stale Candice components on next invocation, refreshes stale skills; plain `claude` settings untouched.
- [ ] WS-33 PASS: `CONTROL/bundled-components.json` (or equivalent) carries versions + SHA-256 checksums; downloads come only from operator-controlled locations; install is atomic; rollback works; downgrade rejected.
- [ ] WS-34 PASS: preferences use a versioned JSON schema with migration tests; schema bumps migrate without data loss.
- [ ] WS-35 PASS: crash recovery restores the exact pending question in Claude without re-asking/double-counting; startup cleanup removes stale temp audio from crashed sessions.
- [ ] WS-36 PASS: Spec Protocol `SKILL.md` change is concise (activation, availability check, bridge rules, fallback, reference to `references/candice-companion.md`); Spec Protocol remains the interview authority.
- [ ] WS-37 PASS: Kaizen integration is minimal and never modifies question order or rules; Candice surfaces only.
- [ ] WS-38 PASS: ELI5 integration is minimal; activatable from compact Candice; no rule changes.
- [ ] WS-39 PASS: Bro integration is minimal; activatable from compact Candice; no rule changes.
- [ ] WS-40 PASS: preferred name is asked at most once per local user, never inferred from the OS username, stored in the local profile, changeable later, and used naturally ("Welcome back, <name>").
- [ ] WS-41 PASS: contract suite green — schemas validate, question keys stable, voice/typed/terminal paths each return exactly one answer, Answer-in-Claude does not double-count, secret-bearing question is never read aloud.
- [ ] WS-42 PASS: same-session suite green under both `claude` and `claude-nine` — the same session owns question and answer, no second independent AI conversation is created, routed provider identity does not change Candice behavior.
- [ ] WS-43 PASS: failure/chaos suite green for app missing, app crash, speech model missing, corrupt checksum, mic denied, no audio device, temp unwritable, plugin missing, MCP unavailable, wrong session target, Claude busy — Claude is never blocked, reset, or destroyed.
- [ ] WS-44 PASS: privacy/security audit green — raw audio never retained/uploaded/logged; no API keys, router tokens, env secrets, or unrelated terminal output logged; secret prompts not read aloud.
- [ ] WS-45 PASS: performance suite measures time-to-first-visible, PTT-release-to-transcript, first-spoken-audio, idle/speaking/listening CPU+RSS on both platforms; thresholds enforced in CI.
- [ ] WS-46 PASS: CI/release matrix builds and tests macOS Apple Silicon + Windows x64 artifacts; all Candice CI green; at least one interactive Windows 10/11 desktop smoke (Windows Terminal + PS 5.1/PS 7/CMD + standalone console hosts, both `claude` and `claude-nine.cmd`, tabs/panes, mic, PTT, transparency, minimize/restore/monitor move, install/update/uninstall cleanup) passes before Windows is labeled production-ready.
- [ ] WS-47 PASS: upgrade fixtures prove old Spec Protocol → new bootstrap installs Candice, skills refresh, plain Claude config untouched, rollback works after injected failure.
- [ ] WS-48 PASS: `tools/boss-cron` portability repair ships — no generic runtime file contains a developer-specific absolute home path (e.g. `/Users/blackceomacmini/...`); arbitrary macOS/Windows usernames work; the historical six-wave campaign governs no generic customer project; two unrelated projects cannot read/stop each other (Master Spec 0E WS-48, section 24).
- [ ] WS-49 PASS: installer/updater regression suite green — update detection, checksum verification, atomic install, backup, rollback, uninstall cleanup.
- [ ] WS-50 PASS: end-to-end nontechnical-user acceptance harness green — a fresh user runs a supported skill, Candice appears and reports setup checking, answers by voice and by type, and the answer reaches the same Claude session.

### E.2 Product-level PASS criteria (Master Spec product sections 2-11, 27 — cross-cutting items 0.3/21/28 live in E.3)

- [ ] First-run name ask once: the name question appears at most once per local OS user (until answered), is not inferred from the computer username, persists in local preferences, and is changeable later (spec 4).
- [ ] HOLD-TO-TALK + TYPE-ANSWER: both controls are available on every question, switchable question by question; the last-used method may be remembered but is never a lock (spec 5.1).
- [ ] Answer-in-Claude: the same question falls back to the terminal/Claude input surface without losing state and without counting the question twice (spec 5.1).
- [ ] Voice toggle persists: Voice responses ON/OFF is a separate persistent preference, independent of answer method; all four voice/type combinations work (spec 5.2).
- [ ] Captions always: the spoken/asked content is always shown as a caption even when voice output is disabled (spec 5.2).
- [ ] Whisper local only: transcription is local/offline via pinned whisper.cpp with bundled or deterministically downloaded checksum-verified model; no cloud speech endpoint is used or required (spec 7).
- [ ] Audio never retained/uploaded/logged: raw audio is never kept as project memory, never uploaded to a cloud speech API, never logged; the microphone is live only while the talk control is held (spec 8).
- [ ] Temp-audio cleanup tested: if temp audio files are used they live only in a Candice-owned per-session temp dir with restrictive permissions, are deleted immediately after transcription succeeds or fails, cleaned again at session end and at startup for crash leftovers; the cleanup path has automated tests proving no abandoned audio accumulates (spec 8).
- [ ] Kokoro canonical voice pinned + license gate: the exact Kokoro runtime/model/voicepack versions and licenses are recorded, required notices included, and the selected voice is confirmed legally redistributable before production release; one canonical Candice voice identical on macOS and Windows; no unverified voice clone; system TTS is used only as clearly-marked fallback (spec 7).
- [ ] 16 assets in manifest: the 16 supplied RGBA PNGs (9 first-batch + 7 second-batch) are inventoried, normalized to stable names, and mapped in `asset-manifest.json`; no seventeenth image is required; the multi-pose sheet is split only into useful states, never used blindly as a runtime atlas (spec 11/11A/11B).
- [ ] Reduced-motion: OS reduced-motion settings are respected; compact mode uses minimal animation; no always-running unnecessary GPU work (spec 10).
- [ ] No second-AI-conversation invariant: Candice never creates a second independent AI conversation to conduct the interview; the active Claude session and invoked skill remain the brain, rules, memory, and source of truth (spec 2).
- [ ] No competing project memory invariant: the local preference profile (name, voice toggle, volume, rate, last method, text size, motion, position) is never used as project/conversation memory; the active Claude skill/project files remain the durable source of truth for project decisions and answers (spec 9).
- [ ] Question-order invariant: Candice never modifies the question order or rules of Spec Protocol or Kaizen (spec 2).
- [ ] Candice appears quickly: activation on a supported slash command shows Candice within a few seconds with the setup-check message (also as caption) before the skill's long preflight completes (spec 3).
- [ ] Same-session answer routing: answers go to the same Claude Code session that asked; a Candice crash mid-question recovers the exact pending question without re-ask or double-count (spec 13/17/20).
- [ ] Interactive Windows smoke: at least one interactive Windows 10/11 desktop run passes before Windows is labeled production-ready; CI alone is not Windows production proof (spec 18).
- [ ] Native Windows launch parity: Windows CMD resolves and launches both `claude` and `claude-nine.cmd`; no mandatory Spec Protocol/Candice runtime step requires Git Bash or WSL (spec 0.3/17).

### E.3 Cross-cutting acceptance criteria (spec 28, 0G, 0I, 0J — enforced alongside E.1/E.2)

- [ ] Windows native deterministic-tool parity: capacity probing/resolution, task/anchor reconciliation, env sweep, ledger/state, update/self-update, and watchdog/heartbeat have a native Windows (PowerShell/Node) path; cross-platform golden-fixture tests prove macOS/Windows semantic equivalence; no mandatory Spec Protocol/Candice runtime step requires Git Bash or WSL (spec 0.3 P0).
- [ ] Windows capacity probes use native APIs ([Environment]::ProcessorCount, Get-CimInstance, Known Folders, [System.IO.Path]::GetTempPath(), Get-Command/where), never sysctl/nproc (spec 0.3).
- [ ] Mac primary-path regression blocker: Terminal.app + `claude-nine` failure fails the release (spec 0.3).
- [ ] Existing-user update path: GitHub `main` update alone never installs a new desktop companion; the existing-user flow (self-update → next invocation bootstrap installs/repairs missing Candice components → stale skills refresh → fast health check after) works end-to-end (spec 21).
- [ ] Component manifest `CONTROL/bundled-components.json` (or equivalent) carries versions + SHA-256 checksums; downloads only from operator-controlled release locations (GitHub Releases default); install atomic; rollback works; downgrades rejected (spec 21/33).
- [ ] One final fan-in: no periodic intermediate merges to main; one integration branch, one coordinated version/stamp/tag, one merge to `main` (spec 0.1 override 1/0G).
- [ ] Trunk freshness gate: `origin/main` fetched immediately before final stamping; if moved, delta integrated and affected tests rerun; no force-push over unrelated main work (spec 0G).
- [ ] Self-enforced CI gate: actual CI results for the integration commit inspected; missing/failed CI blocks release unless the exact test is proven locally and the operator explicitly authorizes an exception (spec 0G).
- [ ] Workflow-only execution: every substantive Candice task runs inside visible Workflow runs with seat pins; the conductor never implements directly; no raw Agent-tool fallback; no `DIRECT` implementation tasks (spec 0.0A/0D/29B).
- [ ] Ultra Code proven enabled before production workflow dispatch; anti-downgrade gate (`ULTRA_CODE_REQUIRED=true`, `WORKFLOW_MODE_REQUIRED=true`, `RAW_HIDDEN_SWARM_FORBIDDEN=true`) active at every compaction/recovery checkpoint (spec 0I).
- [ ] 17-document apparatus without duplicates: no duplicate root TODO/CHECKLIST/LEDGER/SESSION files; canonical carriers carry the state (spec 0J).
- [ ] Reconciliation heartbeat ran at every trigger (before first dispatch; after each launch batch; after meaningful fan-in; before/after compaction or epoch rollover; before changing dependency wave; before final integration; before release stamp; after merge) (spec 0J).
- [ ] Gate 0H gate-set discipline: A/B gates above re-verified at every dispatch point; a CHECKLIST/QC mismatch reopens the item (spec 0J reconciliation repairs).


---

## EVIDENCE ANNEX — 2026-08-26 "finish everything" pass

**No box above is flipped by this pass, and that is deliberate.** The
box-flip rule requires five things; this seat can satisfy at most three of
them (deliverable exists, required tests pass, primary-source evidence
exists). It cannot satisfy `independent QC passes`, because independent QC
of my own work by me is not independent. The annex therefore records
evidence AGAINST named boxes so a QC seat can flip them from it, and states
plainly where the evidence stops.

### Boxes with evidence now standing

**E.2 "Kokoro canonical voice pinned + license gate" — partial evidence,
one clause only.** The clause "system TTS is used only as clearly-marked
fallback" is now implemented and enforced: `speak` falls back to the system
synthesizer only when the bundled engine is absent, and the fallback
announces itself once per session in the user's hearing ("I'm using your
computer's built-in voice — my own voice isn't installed on this machine").
Commit `423c940`. The rest of the box — runtime/model/voicepack version
pins, licence recording, redistributability confirmation, macOS/Windows
voice identity — is UNTOUCHED and still unmet. **Do not flip this box on
this evidence.**

**E.2 "Captions always" — supporting evidence.** Blocked-microphone states
now reach the caption lane instead of failing silently: `announceCaptureBlocked`
is supplied by composition and threaded through `BridgeSpeechHooks`
(`4789ae1`). This closes a hole where a denied microphone produced no
visible or audible explanation at all.

**E.2 "HOLD-TO-TALK + TYPE-ANSWER: both controls are available on every
question"** — this box is now KNOWN TO BE FALSE on the shipped build, and
knowing it is the progress. `whisper-cli` is `sha256Status: absent` on all
three platform rows, so HOLD TO TALK never worked on any build. It is now
gated on the measured `stt_engine_ready` fact rather than mounting a dead
control. **The box stays unchecked and should stay unchecked until an STT
payload actually ships.** Recording it here so nobody flips it from "the
control renders".

**E.1 WS-46 / E.2 "Interactive Windows smoke" / E.3 Windows parity rows —
no movement, and no claim of movement.** Windows now has a speech-output
path (`423c940`) and no longer receives 378 MB of macOS-arm64 Python in its
installer (`8e3eb0e`). Neither has been observed on Windows. There is no
Windows machine in this project. Cross-compilation was attempted and
failed: `cargo check --target x86_64-pc-windows-msvc` dies in `ring`'s
build script for want of an MSVC toolchain and never reaches this code.
**Every Windows box above remains correctly unchecked.**

### Test state at the close of this pass

TypeScript 552/552 · Rust 75/75 (main crate) · `candice-macos-permissions`
20/20 **under its own manifest** · contract suite green across 8 files
including the new `tests/contract/speakable.test.js` · e2e happy legs 1–6
PASS · plugin launch-command PASS.

**A caveat that belongs on the number, not in a footnote:** the headline
"75/75" has never included the permissions crate — `cargo test
--manifest-path src-tauri/Cargo.toml` does not reach it. Any prior reading
of 75/75 as whole-project coverage was overstating. It is now measured
separately and reported separately.

The full packaged suite was NOT re-run this pass. It launches sixteen
Candice windows; the operator objected to seeing them, and that objection
stands until he lifts it.

### What no seat here can close

`independentQc` (FIX-024), macOS notarization (needs an Apple Developer
ID), Windows signing (needs a certificate and a Windows machine), and
`cleanMachine` (needs a machine that has never had this app). These are
the reason `lifecycle=REPAIR_IN_PROGRESS open=24 complete=0` is unchanged
at the top of this file.
