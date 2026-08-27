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



### OPEN after the 2026-08-26 voice/copy/UI pass

**Windows cannot hear or speak, and that is a payload problem, not a bug.**
The app now stays honest about it (no HOLD TO TALK, no per-question speech
failure), but closing it needs real work:
- no `whisper-cli.exe` and no `whisper-cli-win32/` ship; all three STT rows
  are `sha256Status: absent`.
- no Windows Python ships. The interpreter probe already looks in the right
  places (`python\python.exe`, `python\Scripts\python.exe`); the payload
  is a Mach-O arm64 build.
- `system_tts_available` is hardcoded `false` off macOS and
  `speak_system_tts` is a no-op there -- the WR-016 adapter lane never
  registered itself. A Windows SAPI path would give her a voice even with
  no Kokoro runtime.
- `speech-assets/` is bundled wholesale to every target, so ~164 MB of
  macOS-arm64 Python ships inside the Windows NSIS installer today. Tauri
  per-platform config (`tauri.windows.conf.json`) can carve it; NOT done
  here because it cannot be verified from this seat and the macOS build is
  the one currently installed and working.

**Registry copy was left untouched, on purpose.** A copy review flagged
real problems in `packages/candice-protocol/schemas/question-keys.json`:
options rendering as routing codes ("Simple ghl", "Complex vercel then
embedded"), template placeholders sitting inside SPOKEN strings that TTS
would read aloud ("question less-than N greater-than"), a backticked file
path in a spoken string, a 559-character monologue that never asks its
question, a context-free "keep, or change?", and developer words spoken to
non-technical clients ("repo", "push", "branch", "provider path"). These
are byte-pinned with digest stamps against the skill source, and
`canonicalQuestion` copies `display` verbatim with no substitution
mechanism -- so changing them means changing the skill's interview.md and
re-stamping in the same move. That is a coordinated change across two
repos, not a repair-pass edit.

**The `text-fallback` caption duplicates the spec-5.1 button label.**
"Answer in Claude instead" reads like a menu item rather than Candice
speaking. `captions.test.ts` asserts it renders "the exact spec-5.1 label"
verbatim, so changing it is a spec decision. Raised, not changed.

**Consent-blocked copy appears to be unreachable.** The strings in
`ui/answer-controls/consent.ts` are wired to an `onBlocked` callback that
neither the orchestrator nor the bridge supplies, so a user whose
microphone is denied may see nothing at all. Wording and wiring want
fixing together; not attempted here because the wiring is a behaviour
change, not a copy change.

**The compact lane, if it is ever mounted**, needs more than a transport:
its text has no backdrop (it predates FIX-008 and its own contract test
still bans one), its expand affordance is not in `CONTROL_SELECTOR` so the
click would pass through to the desktop, its hold-to-talk has no keyboard
path and no document-level release, and its mute button flips a label
while the controller's handler does nothing. Recorded so nobody mounts it
believing it is finished.

**`#app`'s scrollbar cannot be grabbed.** It is the overflow safety valve
for a 420x640 column at Large text, but the gutter sits outside every
published region, so the window is pointer-transparent there. Wheel and
trackpad still work over any published card. Noted mainly so nobody
"fixes" it by publishing the whole window, which would make Candice a
solid rectangle. `native-input-regions.ts` also observes mutation, resize
and load but not scroll, so regions can be stale for up to 500ms after a
scroll.


---

## RECONCILIATION — the 2026-08-26 "finish everything" pass

Nothing above is deleted. This section says which of those entries the pass
CLOSED and what it left or added. Where an entry above is now stale, it is
marked here rather than edited in place, so the reasoning trail survives.

### CLOSED by this pass

- **`system_tts_available` hardcoded false off macOS / WR-016 adapter never
  registered.** CLOSED (`423c940`). Windows now speaks through
  `System.Speech.Synthesis.SpeechSynthesizer` via PowerShell, text on
  stdin. Full event contract: start with an empty timing array, drain on
  child exit. Announces the substitution once per session.
  **Still unobserved on Windows** — see OPEN below.

- **`speech-assets/` bundled wholesale to every target (~164 MB of
  macOS-arm64 Python in the Windows installer).** CLOSED (`8e3eb0e`) via
  `apps/candice-companion/tauri.windows.conf.json`, using JSON Merge Patch
  (RFC 7396) where a null value removes a key. The entry above says this
  was "NOT done here because it cannot be verified from this seat" — what
  changed is that the *macOS* side is now verifiable, and it was verified:
  a fresh macOS bundle still carries the full 378 MB, so the override is
  inert on macOS. The Windows side remains unverified.

- **Template placeholders inside SPOKEN strings.** CLOSED (`cb27e23`) for
  the five registry entries (INTERVIEW_MODE, CAPACITY_PLAN_RECALL,
  LOOP_FOLDER, COLLAPSE_CONFIRM_B/C). `interview.md` was NOT touched: it is
  correct, and defines these as asker fill-ins at lines 397 and 1391. The
  class is now unshippable — `tests/contract/speakable.test.js`.

- **Consent-blocked copy appears to be unreachable.** CLOSED (`4789ae1`).
  `announceCaptureBlocked` is supplied by composition, threaded through
  `BridgeSpeechHooks` as `onBlocked`, and the three explanations were
  rewritten in plain language, each ending "You can still type your
  answer."

- **The compact lane needs more than a transport.** CLOSED (`c6240c4`) as a
  unit: backdrop, `.candice-compact` in `CONTROL_SELECTOR`, keyboard path,
  pointer capture with pointercancel/lostpointercapture/blur release, real
  mute with `aria-pressed`, expand with `aria-expanded`, 44px targets.
  The **do-not-mount ruling above still stands** — the lane is repaired,
  not enabled. Mounting still requires an inbound message capability that
  does not exist.

- **`native-input-regions.ts` does not observe scroll.** CLOSED (`c170e06`)
  — capturing `scroll` listener added, so the click map no longer points at
  pre-scroll positions for up to 500ms.

- **Two option labels reading as routing codes.** PARTIALLY closed
  (`d54b915`): "Claude code" → "Claude Code", "$40 year" → "$40 a year",
  "Claude nine" → "Claude-Nine". Formatting only. See OPEN below for the
  rest.

### OPEN — carried forward

- **Windows is entirely unobserved.** No Windows machine exists in this
  project and no Windows bundle has been produced. `System.Speech`, the
  NSIS install path, `CREATE_NO_WINDOW`, and the resources override are all
  reasoned from documented behaviour, not measured. First Windows box that
  becomes available should run: a bundle build, an install, one spoken
  question, and a check that no console window flashes.

- **Windows STT is still absent.** No `whisper-cli.exe` ships, and all three
  STT rows remain `sha256Status: absent`. The system-voice fallback covers
  output only; there is no input equivalent. HOLD TO TALK correctly stays
  unmounted there.

- **Registry copy: the per-option rewrite belongs to the registry owner.**
  `simple-ghl` / `complex-vercel-then-embedded` still render as routing
  codes. This pass deliberately did NOT rewrite them: the natural wording
  ("Put it on Convert and Flow") was inferred from a slug, not read from
  any source, and the existing "never invents wording" test caught it. The
  owner of `interview.md` must supply the intended labels; changing them
  means changing the skill and re-stamping the digest in the same move.
  Also still open from the same review: the 559-character monologue that
  never asks its question, the context-free "keep, or change?", and the
  developer vocabulary ("repo", "push", "branch", "provider path").

- **`text-fallback` caption duplicates the spec-5.1 button label.**
  Unchanged. `captions.test.ts` pins it verbatim; changing it is a spec
  decision, not a repair-pass edit.

- **`#app`'s scrollbar cannot be grabbed.** Unchanged and intentional — the
  gutter sits outside every published region. Do not "fix" it by publishing
  the whole window; that would make Candice a solid rectangle. Wheel and
  trackpad work over any published card.

### NEW — found during this pass

- **`candice-macos-permissions` is not wired into the app.** Verified across
  three sources, with `candice-capture` found at `Cargo.toml:27` as the
  control. The crate compiles and its tests pass, but nothing depends on
  it. Either wire it or retire it; leaving it is how dead code acquires
  the appearance of coverage. A `#[cfg(windows)]` split added to it during
  this pass was reverted for exactly that reason.

- **The permissions crate needs its own manifest to be tested at all.**
  `cargo test --manifest-path src-tauri/Cargo.toml` does not reach it, so
  the headline "75/75" has never included it. Run
  `cargo test --manifest-path src-tauri/permissions/Cargo.toml` (20/20) or
  add it to a workspace. Until then any report that cites 75/75 as whole-
  project coverage is overstating.

- **`build-macos-bundle.sh` does not build the frontend.** It packages and
  signs whatever is already on disk, and exits 0 when that tree is stale.
  Running it alone produced a byte-identical SHA to the previous build —
  a "fix" containing no fixes, caught only by comparing SHAs. The correct
  sequence is `npm run tauri:build` first. Worth a guard in the script.

### OPEN — from the 2026-08-26 speech-fallback review (commit 19a8f53)

- **A superseded utterance's drain can end the NEXT utterance's speaking
  state.** `src/runtime/bridge.ts:652` guards markers against
  `activeUtteranceId`, but that variable is only assigned when the START
  EVENT arrives (bridge.ts:629). Between `speakQuestion(B)` setting
  `speakingFor` (bridge.ts:403) and B's start event being delivered,
  `activeUtteranceId` still holds A — so A's late drain matches, passes the
  guard, and calls `endSpeaking()` while B is audible: bust vanishes, lip
  sync stops, HOLD TO TALK unblocks mid-word. This is the exact scenario
  the guard's own comment says it prevents.

  **Pre-existing, and NOT introduced by WR-016.** WR-016 did widen it —
  an unkilled system-voice child drained at end-of-sentence, seconds late —
  but `19a8f53` kills the child on stop, so the drain now lands within one
  50 ms poll and the window is back to Kokoro's (tens of ms).

  **Deliberately not fixed here.** `speakingFor` is a question-identity key
  in a different namespace from `activeUtteranceId`, and the bridge never
  learns B's utterance id synchronously — it is generated inside the
  orchestrator. Closing it means an "awaiting start" latch that rejects all
  markers until B's start arrives, and every path that fails to clear that
  latch leaves her permanently unable to leave the speaking state. That is a
  worse bug than the one it fixes, and it cannot be exercised from this seat
  without launching windows the operator has asked not to see. Owner of the
  bridge lane should take it with a real interactive test.

- **`createSpeechTarget().stop` can pass `requestId = null`**
  (`src/runtime/speech-orchestrator.ts:449-453`), and
  `speak_release_slot(state, None)` releases WHOEVER holds the slot
  (`src-tauri/speech/mod.rs:987`, arm `(_, None) => true`). If the duplex
  stop-timeout limb fires after `abortSpeech` nulled the utterance id while
  a NEW utterance holds the slot, single-flight breaks. **UNDETERMINED** —
  reachability was not traced; `DuplexController`'s tick/stop ordering was
  not read. Flagged to the duplex lane owner rather than asserted as a bug.

### Gate markers: deliberately unmoved

`lifecycle=REPAIR_IN_PROGRESS open=24 complete=0` is unchanged at the top of
this file. Closing a gate requires `independentQc`, which this seat cannot
run on its own work. Also outside this seat: macOS notarization (Apple
Developer ID), Windows signing (certificate + Windows machine), and
`cleanMachine` (a machine that has never had this app).

---

## Session 2026-08-27 — closed, and what it left open

### Closed this session

- **No off button.** `shell::cmd_quit_app` + `src/ui/power/` (352b627).
- **Every string named Claude.** `src-tauri/src/harness.rs` measures the
  harness; `src/harness/name.ts` owns the wording (352b627, a304fdc).
- **A repo install installed nothing.** Availability separated from
  integrity in the app leg; release mode now completes without a published
  app (3fbe41d).
- **Stale `spec-protocol` pin** breaking every release install. Pins now
  derive from each skill's VERSION file, with a proven guard (08b99fb).
- **`plugin-mcp` demanded a readiness flag unconditionally.** Now checks the
  claim matches reality — stricter (3fbe41d).
- **Stale bridge-leak test** failing on a 15s ceiling around a 20s budget.
  Budget injected; discrimination re-proven (8186302).
- **Placeholder install URL** (`https://YOUR-LINK-HERE/...`) in the client
  docs. Both docs now lead with the real command (b70e561).

### Open — needs the operator

- **Windows signing.** `windowsSigningAndInteractiveSmoke` is an exact-match
  `PASS` requirement with no ad-hoc alias, so a certificate and a Windows
  machine are still required for a full authority pass. The operator has
  declined the certificate cost; until that changes this gate cannot pass as
  the schema is written.
- **`independentQc`** cannot be run by the seat that did the work.
- **`cleanMachine`** needs a machine that has never had this app.

### Open — not blocked, just not done

- **No app artifact is published.** The bootstrap installs everything except
  the app, and says so. Publishing requires a built, signed artifact plus a
  manifest record carrying an Ed25519 signature under the release-authority
  key. Nothing in that chain needs a paid certificate (see the correction
  below); it needs the 24 fix gates closed.
- **The compact surface is dead code.** `ui/compact` has no importer outside
  its own directory, so it is tree-shaken out of the bundle entirely —
  "Hold to talk", `candice-compact-btn` and `setBusyHint` are all absent from
  `src-tauri/dist/assets/`. The harness-aware `busyHintText()` and
  `returnToHarnessLabel()` changes are correct but do not ship until the
  FIX-014 appui lane lands.
- **`speechStatusText` / `voiceApprovalStatusText`** carry the worst jargon in
  the app and were deliberately NOT simplified: nothing renders them. Their
  only references are their own definitions and their tests.

### CORRECTION: macOS notarization is not a blocker

Earlier entries in this file list "macOS notarization (Apple Developer ID)"
among the things outside this seat. That is WRONG, and it has been repeated
to the operator more than once after he had already ruled the cost out.

`scripts/candice-release/status.mjs` (QFIX-adhoc, lines 280-317) accepts
`macosSigningAdhoc` as an honest alias for `macosSigningAndNotarization`.
Exactly one of the two must be recorded and PASS. An Apple Developer ID is
not required by the release authority.
