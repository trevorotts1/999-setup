# CONTROL / TODO — Live Work Inventory

<!-- CANDICE_RELEASE_REPAIR_STATUS: lifecycle=REPAIR_IN_PROGRESS open=24 complete=0 -->

> **FIX-001 release-truth override (2026-08-22):** This historical workstream
> inventory is not a release authority. The current repair inventory is 24
> open fixes and zero completed fixes. Release state is governed only by
> `CONTROL/release-gate.json` and `scripts/candice-release/status.mjs`.
> Legacy WS entries remain as implementation history and must not be read as
> present release evidence.

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

---

## LIVE INVENTORY ADDENDUM — 2026-08-26 (Opus defect-repair session)

Appended, not substituted. Nothing above is edited or removed; the FIX-001
release-truth override at the head of this file still governs. The status
marker is deliberately unchanged (`open=24 complete=0`): repairing defects is
not the same as closing fix ids, and a builder does not flip its own boxes.

### Closed this session (defects, with commits — NOT fix-id completions)

| Defect | Commit | Proof |
|---|---|---|
| Lip sync dead; mouth never opened | `d592326` | measured 1.01x vs control before; 28/48 spans were being dropped; tests on a committed real-TTS capture |
| Every wake spawned another Candice | `c37fcd0` | verified live on the operator box: second wake stood down, exit 0 |
| Character squeezed out of frame; options unclickable | `1c0d49b` | floor was on an element deleted at runtime; stack could exceed 640px |
| Registry copies drifted at the same version | `54e0ea1` | 12 entries differed; parity guard added and mutation-tested |
| Windows: no voice, unfindable app, console windows | `3247c83` | source-walking test enforces every spawn site |
| Wrong app version; unreadable profile read as first run | `9ff8804` | built bundle now carries 1.0.0-rc.1 |

### OPEN — cannot be closed from this seat

- **`macosSigningAndNotarization`** — the artifact is ad-hoc signed by operator
  decision (2026-08-23). Notarization needs Apple credentials.
- **`windowsSigningAndInteractiveSmoke`** — no Windows machine exists on this
  project. `scripts/package-windows/SIGNING-STATUS.md` records NOT SIGNED.
- **`independentQc` / FIX-024** — requires a reviewer who is not the builder.
- **`cleanMachine`** — requires a machine with no prior Candice state.

### OPEN — actionable, not yet done

- **STT is absent from the shipped artifact.** All three `whisper-cli` rows in
  `SPEECH-INVENTORY.json` are `sha256Status: absent`, `bundled: false`. Voice
  input does not exist until the installer lane places them. The macOS pin
  points at a Homebrew bottle, which would link Homebrew dylibs — needs
  checking before it is placed.
- **Microphone entitlement missing.** `scripts/package-macos/entitlements.plist`
  carries only the three `cs.*` keys. A hardened-runtime build denies mic
  access without `com.apple.security.device.audio-input`, regardless of the
  Info.plist usage string. Dev runs use the unhardened binary, which is why
  this has never been felt.
- **Windows `speech-assets` is bundled unconditionally**, so a Windows
  installer would carry a 378 MB macOS-arm64 Python. Needs platform-specific
  bundle resources.
- **Windows whisper DLLs are unpinned.** The upstream zip ships `whisper.dll`
  and `ggml*.dll`; the inventory has no rows for them, so the exe alone would
  fail with STATUS_DLL_NOT_FOUND.
- **`local-companion-bridge.test.js` hangs** with two failures. Pre-existing —
  confirmed by stashing and re-running at HEAD.
- **Packaged accessibility tier still BLOCKED.** The answer controls never
  appear in the packaged a11y tree; an AX dump showed only
  `WINDOW: Candice > group > group`. Untouched this session.
- **Duplicate window, remaining case.** Wake-only instance up, then an MCP
  bridge launch, still yields two windows. Closing it is routing work in the
  FIX-011/FIX-013 lane.
- **`AGENT_TEAM_CONSENT` never asks a question.** A consent prompt that states
  the consequences and stops is broken. A proposed rewrite adds "Shall I turn
  it on?"; that ADDS a sentence rather than simplifying, so it is an operator
  decision and was deliberately not applied.

### OPERATOR-REPORTED — 2026-08-26

- **The Voice-responses and Animation toggles do not take effect.** Reported
  from live use: both controls flip their label and neither changes what
  Candice does. Two causes found and fixed in `f650d64`; a third is named and
  still unproven.

  FIXED — *a preference only took effect if the disk write succeeded.*
  `interaction-composition`'s persist read `if (saved) current = next`, and
  `current` is what `voiceOutputEnabled()` returns — the gate `bridge.ts`
  consults before speaking. The answer-controls surface keeps its own copy and
  flips its label immediately, so a failed write left the button reading OFF
  while Candice kept speaking every subsequent question. The preference now
  applies in memory and the return value reports separately whether it will
  survive a restart, which is this codebase's own stated rule for the
  animation toggle ("a failed persist degrades to an in-memory-only toggle").

  FIXED — *nothing stopped the voice.* `onVoiceToggleChange` persisted and did
  nothing else, and the gate is only read when the NEXT question is delivered.
  Hitting the toggle because she is talking could not stop her. It now aborts
  speech in flight.

  FIXED — *the click never reached the animation toggle.* Measured with a
  synthesized mouse click at the control's own screen rectangle, against an
  accessibility press as the control: the press flipped the checkbox (1 to 0),
  the real click left it at 1. The voice toggle, a `<button>`, took the same
  synthesized click correctly — so this was specific to the animation control,
  not a general pointer failure.

  Cause: the checkbox is 14x14, so the rectangle published to the native hit
  test was 22x22 after padding, and the word "Animation" beside it — which has
  `cursor: pointer` and forwards clicks like any HTML label — was never
  published at all, because `CONTROL_SELECTOR` matched `input` but nothing
  covering the label or the group. Everywhere outside that 22px square the
  window is deliberately pointer-transparent, so clicking the label sent the
  click straight through Candice to whatever was behind her. The control
  looked live, was live in the accessibility tree, and did nothing when a
  person clicked the part of it they were aiming at.

  `.candice-animation-toggle` is now published whole, and the row has real
  padding so the visible affordance and the hit region agree.

  WORTH A SWEEP, not yet done: any other control whose visible target is
  larger than the element `CONTROL_SELECTOR` matches has the same defect, and
  it is invisible to every test that drives the UI through accessibility.
  Only a synthesized pointer click can find them.

- ~~**The first-run name prompt still mounts over a live question.**~~
  **DECIDED AND FIXED 2026-08-26 (`330b174`).** The ask is now DEFERRED while
  a question is pending, not skipped: nothing is persisted on that path, so
  `needsNameAsk` stays true and the ask happens on the next boot with no
  question waiting.

  Why this is not a reversal of spec 4. Spec 4 says the name is asked at most
  once per local user. It does not say the ask must happen ON TOP of something
  else. Deferring it preserves the ask exactly; only its timing moves. The
  earlier partial fix suppressed only the caption announce, which stopped
  Candice talking over the question but left the prompt mounted — so the two
  text inputs and the stolen caret both survived. Silence is not absence.
  The test that pinned the old wording was rewritten with the reasoning in it.
  TypeScript 527/527.

### PACKAGED TIER — root-caused and unblocked 2026-08-26 (`c96d38b`)

The 31 packaged-leg failures were ONE harness bug, not a product fault. The
driver looked for the answer controls at `text field 1 of group 1 of window 1`
— a direct child of the window's first group — while the real tree is
`AXWindow > AXGroup > AXGroup > AXScrollArea > AXWebArea > ... > AXTextField`,
because the UI is web content in a WKWebView and a scroll region adds an
AXScrollArea. The controls were present and correctly labelled the whole time.
Replaced with a depth-agnostic role+label search over the same public
accessibility tree a screen reader uses. `packaged-BUILD_TARGET` now PASSES
against the packaged binary — the first packaged-tier pass in this campaign.

Two process bugs fixed in the same file, both of which reached outside the
suite: `killAppProcesses` ran `pkill -f candice-companion`, which kills the
operator's own installed Candice and matches any rustc/cargo command line
mentioning the crate; `cleanStateGate` had the same flaw with `pgrep -x` and
reported the environment dirty because the operator's Candice was open.

### DECIDED 2026-08-26 — speech assets ship BUNDLED (`306e4be`)

The two sides were not in contradiction. `SPEECH-INVENTORY.json` already told
the truth: five rows `bundled: true` with real pins, three STT rows
`bundled: false` / `sha256Status: absent` with an `absentNote`. The manifest
was honest. The packaged LEG was the stale side — it still asserted
"zero pinned payloads ship inside the bundle (installer lane owns placement)"
from an installer posture this repo abandoned.

**Ruling: bundled is the design.** There is no installer lane anywhere in the
repo — no download step, no fetch on first run, no receipt-writing installer.
The alternative to bundling is not "deferred", it is a mute product. Decided
in the repair pass rather than escalated, per the operator's standing
instruction to make the calls and ship.

The leg now asserts what the manifest actually claims, and does it harder than
what it replaced: every `bundled: true` row is READ out of the packaged bundle
and its bytes hashed against its pin (the old check only counted files), and
pin/status agreement is enforced in both directions. Measured:
`verified=5 problems=0`, `bundled=5 absent=3`. Leg passes 7/7 checks.

Also relaxed the canonical-voice assertion, which demanded "approval-pending"
forever — a134db5 deliberately ended that when it approved `af_bella` so the
bundle could speak. It now accepts exactly `approved` or `approval-pending`
with a non-empty id. Case matters: `speech/mod.rs` resolves a speakable voice
only on lowercase `approved`.

**Cost accepted, and it is a real one:** ~347 MB of `speech-assets/` ships in
the artifact, and on Windows a large part of that is macOS-arm64 Python that
can never run. Windows packaging should carve the per-platform payload; that
is a build-script change, not a design reversal. Already tracked above as
"Windows `speech-assets` is bundled unconditionally".

Still open regardless: `whisper-cli` is `sha256Status: absent` in all three
STT rows, so voice INPUT does not exist in any build today.

### DECIDED 2026-08-26 — the `compact` leg stays BLOCKED, for the real reason

The leg's recorded blocker was wrong. It said "compact surface (FIX-014 appui
lane) not present ... dependency not yet landed". FIX-014's surface IS landed:
`src/ui/compact/` is complete and tested — view, controller, queue, status,
config, CONTRACT.md. Nothing about it is missing.

It is never mounted, and mounting it would be wrong. `CompactTransport.submit`
has no implementation anywhere in this product. The compact surface is a box
where the user types a message TO Claude, unprompted; every channel this
product owns runs the other way — Claude asks, the user answers, the answer
returns to the asking call. Verified across four sources, each with a control
that came back non-empty on the same instrument:

1. src-tauri commands (25) — all bridge-question lifecycle, window, prefs or
   speech. None sends user-initiated text.
   *control:* `cmd_submit_bridge_answer` found in `lib.rs` + `runtime.rs`.
2. the MCP plugin — exactly one tool, `candice.ask_user`. No inbound tool.
3. `packages/candice-protocol/schemas` — question, answer, status, lifecycle,
   preferences. No user-initiated message schema.
   *control:* `answer-event.schema.json` present.
4. source sweep for any `CompactTransport` implementor, `sendToClaude`,
   `injectPrompt`, `user_initiated` — zero hits outside `src/ui/compact/`.
   *control:* the same regex found `CompactTransport` in `controller.ts`.

**Not checked:** whether a future MCP revision adds a client-initiated message
tool. That is a product capability decision, not a defect.

**Ruling: do not mount it.** A text box that submits into nothing would ship a
control that silently eats what the user types — worse than shipping nothing.
The blocker text now names the real owner so the evidence trail stops implying
a UI lane owes work it already delivered.

