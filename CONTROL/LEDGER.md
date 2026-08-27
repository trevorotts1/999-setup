# CONTROL / LEDGER — Live State, Verdicts, Restart Truth

<!-- CANDICE_RELEASE_REPAIR_STATUS: lifecycle=REPAIR_IN_PROGRESS open=24 complete=0 -->

> **FIX-001 release-truth override (2026-08-22):** The historical workflow
> ledger below does not authorize a release. Current Candice repair state is
> 24 open fixes and zero completed fixes. The enforced release authority is
> `CONTROL/release-gate.json` evaluated by `scripts/candice-release/status.mjs`.

Project: Candice Companion AI (spec-protocol build, 999-setup repo)
Canonical Master Spec: `/Users/blackceomacmini/Downloads/CANDICE_COMPANION_AI_IMPLEMENTATION_SPEC_V6_FINAL_LOCKED.md` (canonicalized as `SPEC/MASTER-SPEC-2026-08-21.md` — see SESSION-LOG)
Last updated: 2026-08-21 (TRUTH CONTRADICTION RESOLUTION — section 1 refreshed per enumeration; 1-run/15-agent contradiction resolved, option A)

---

## 1. CURRENT STATE VIEW (regenerated; the first operational truth)

| Field | Value |
|---|---|
| Logical wave | pre-build (wave 0 — apparatus/planning; implementation waves W1-W5 per EXECUTION-PLAN.md) |
| Execution epoch | 0 |
| Safe live width | **50 committed** (CAPACITY-LEDGER 2026-08-21: WR-004 `wf_b9f59642-d5c` COMPLETED — clientCap 10, runs 5, role_aware_runs 10, budget 700) |
| Intended workflow runs | 23 (all 23 real run handles enumerated in the live workflow store; board rows in EXECUTION-PLAN.md section 1) |
| Visible workflow runs | 23 (every real run handle has a board row — VISIBILITY-FAIL list empty per truth-update reconciliation 2026-08-21) |
| Active workflow runs | 3 (WR-007 planning `wf_66e51e17-7cc` just-completed transition, planning rolling recheck `wf_bef69fc1-fd8` 5 opus builders, truth lane `wf_d6dd0a72-000` 1 opus — children of the WR-007 tree, not a 10-agent workflow) |
| Completed workflow runs | 20 (WR-001 `wf_bb855713-af9`, WR-002 `wf_9529b3f1-4bb`, WR-003 `wf_40977ba0-353` STOPPED-RESTARTED as WR-007, WR-004 `wf_b9f59642-d5c`, WR-005 `wf_9cdd60f8-358`, WR-006 `wf_63e7cd35-51c`, WR-007 `wf_66e51e17-7cc`, WR-008 `wf_046b1be8-ea3`, audits `wf_7cb74348-fec` / `wf_d99de8ad-90b` / `wf_7920d06d-4c9` / `wf_1b5a3a00-e4b` / `wf_8222a8fa-215`, audit-repair `wf_61fe0666-d88`, watchdog `wf_edc5ea4c-947` STOPPED conductor-killed, spec discovery `wf_587604e9-de8` NOT_FOUND, repair + two-truth `wf_802e202c-116`, watchdog-v8 + truth-gate `wf_ecc575ed-cf9`, truth-gate QC-FIX + recheck `wf_13ee1ba1-624`, truth-gate audit `wf_da0ccfb6-3c0`, state reconcile `wf_9f089d63-c0e` — all 20 completed entries in project_state.json) |
| Max agents per workflow | **10** (invariant — 5 builders + 5 QC; WR-007 `wf_66e51e17-7cc` peak = 10 concurrent, all resulted; no run ever exceeded 10; resolution record below) |
| Integration SHA | `6bb00ec70af69510fab5a9c2ef332751e260d036` (HEAD of main, verified 2026-08-21) |
| Pending builder handoffs | none |
| Pending rechecks | prebuild truth-gate fresh recheck pending (QC-FIX ROUND 1 fixes applied; fresh independent sonnet/max recheck dispatched by the conductor) |
| Severe blockers | none |

### Exact next conductor actions (in order)

1. Let the planning-rolling-recheck (`wf_bef69fc1-fd8`, 5 opus builders re-validating the WR-007 planning deliverables) land and QC its handoffs; WR-007 `wf_66e51e17-7cc` itself is COMPLETED (all 10 seats resulted; 5 blind QC FAILs since re-checked per EXECUTION-PLAN.md sections 7-9).
2. Proceed to implementation dispatch — build fan-out starts at WR-033+ per the dependency-dag re-verification (launch IDs = snapshot slice IDs WR-008/WR-009/WR-012 for W1; next free WR-033+). 0H gates MET: canaries + max-thinking PASS (WR-004), task graph PRESENT, ledger current, board rows with real handles.
3. Keep board rows current per EXECUTION-PLAN.md section 1 rules (0D visibility gate).
4. Continue waves per EXECUTION-PLAN.md step 3/4.

---

## 1b. TRUTH CONTRADICTION RESOLUTION — 2026-08-21 (1-run/15-agent)

**Contradiction:** a mid-flight report claimed 1 workflow run with 15 live agents — a breach of the 10-agent per-workflow cap.

**Resolution: OPTION A** (per the truth-enumeration agent, 2026-08-21, wf_d6dd0a72-000 — full record in SESSION-LOG.md "TRUTH CONTRADICTION RESOLUTION 2026-08-21"). The 1-run/15-agent figure was a **mid-flight snapshot artifact**, not a cap breach.

**Evidence:**
- Truth-gate enumeration (wf_da0ccfb6-3c0, agent ab3fb39eb3aac92ed) walked the live workflow store: the 15 un-resulted agents were spread across **5 run dirs** whose terminal records had not yet been written — `wf_7920d06d-4c9` 5, `wf_8222a8fa-215` 5, `wf_9f089d63-c0e` 4, `wf_b9f59642-d5c` 3, `wf_9cdd60f8-358` 3 = 20 started / 15 un-resulted at 09:53Z; all cwd-resolved to the executing audit-family tree (descendant spawns sharing a parent tree, NOT one run exceeding 10). All 5 runs since completed (started == resulted; terminal records completed).
- Final enumeration of all 23 run dirs (journal started/resulted counts, meta models, terminal records): 19 completed, 2 killed (wf_edc5ea4c-947, wf_40977ba0-353), 2 live (wf_bef69fc1-fd8, wf_d6dd0a72-000).
- **REAL_ACTIVE_RUNS=2, REAL_ACTIVE_AGENTS=6, MAX_AGENTS_IN_ANY_ONE_WORKFLOW=10** (WR-007 `wf_66e51e17-7cc`: 5 opus builders + 5 sonnet QC concurrently, all 10 resulted; the 11th file is an interrupted post-completion retry, never concurrent).
- No option-B cap breach ever existed.

**Consequence (recorded, not blocking):** `max_agents_per_workflow = 10` set in project_state.json candice namespace as the invariant value; board/LEDGER counts refreshed (Active 3 incl. the just-completed WR-007 transition + 2 child lanes; Completed 20; intended/visible 23).

---

## 2. QC VERDICT BLOCKS (durable)

- **2026-08-21 blind QC — prebuild truth gate: FAIL (six-part fix list).** Fixes applied in QC-FIX ROUND 1 (2026-08-21): board row added for `wf_d99de8ad-90b`, VISIBILITY-FAIL closed; this LEDGER section 1 + restart steps regenerated (width 50 committed, WR-007 sole active, 12 completed, dispatch WR-009+); plan-row IDs assigned (WR-005-plan→WR-031, WR-006-plan→WR-030, WR-007-plan→WR-032); WATCHDOG-PROOF.md corrected (root boss-cron carries the flock guard, backup named); role-aware formula added to CAPACITY-LEDGER. Fresh independent recheck required. Verdict text in SESSION-LOG.md (QC-FIX ROUND 1 section).

---

## 3. MERGE / RELEASE RECORDS

None yet. No merges or releases for the Candice build as of 2026-08-21.

---

## 4. LITERAL RESTART STEPS (cold resuming conductor — run in this order)

1. **Read this file** (`CONTROL/LEDGER.md`) — current state + verdicts + merge record (above).
2. **Read the workflow board** — `CONTROL/EXECUTION-PLAN.md`, named section "CANDICE WORKFLOW-RUN BOARD". This is the live board of intended/visible/active/completed workflow runs.
3. **Read machine truth** — `CONTROL/project_state.json`: the `candice` namespace (added 2026-08-21 reconciliation) holds the Candice run/epoch/wave state with real handles; the prior `999-master-fix` residue fields are preserved untouched per spec 0J. Backup of the pre-reconciliation file: `CONTROL/project_state.json.bak-candice-bootstrap`.
4. **Re-fetch main per spec 0G freshness** — run `git fetch origin main` (or `git pull --ff-only` on main) in `/Users/blackceomacmini/Downloads/999-setup`.
5. **Verify SHAs** — confirm the working tree HEAD matches the integration SHA in section 1 (`6bb00ec70af69510fab5a9c2ef332751e260d036`). If it differs, the newer SHA wins: update section 1 and the board, and note the delta in SESSION-LOG.
6. **Resume dispatch** — DO NOT re-run completed runs: WR-004 (capacity), WR-005 (setup-ci-fix), WR-006 (baseline), WR-007 (planning, COMPLETED per truth-update 2026-08-21), WR-008 (census-fix) and all audit runs are COMPLETED per section 1. Active runs: planning-rolling-recheck `wf_bef69fc1-fd8` (5 opus builders, child of WR-007) and truth lane `wf_d6dd0a72-000`. Next dispatch action: implementation build fan-out starting at WR-033+ (launch IDs = snapshot slice IDs WR-008/WR-009/WR-012 per EXECUTION-PLAN.md section 6.2; next-free WR-033+ per the dependency-dag re-verification). No completion-run is ever re-dispatched.
7. If the ledger was interrupted mid-write, re-verify pending builder handoffs and pending rechecks against TODO/CHECKLIST before dispatching anything.

---

## 5. SESSION RECORD — 2026-08-26 defect repair (Opus, operator-directed)

**Not a release authority.** Nothing below flips a checklist box or a gate in
`CONTROL/release-gate.json`. The box-flip rule (Master Spec 0J, restated at the
head of CHECKLIST.md) reserves promotion for the conductor acting on
independent QC; a builder recording its own work is not that. Lifecycle stays
`REPAIR_IN_PROGRESS`, open=24, complete=0.

**Branch:** `candice/integration`. Commits `d592326`, `c37fcd0`, `1c0d49b`,
`54e0ea1`, `3247c83`, `9ff8804` on top of `0497ba5`.

### Defects found and repaired, with the evidence

1. **`d592326` — lip sync was completely dead.** Measured first: a frame
   difference over the mouth during speech came out 1.01x a same-size cheek
   patch on the same face, i.e. pure global drift, the cutout never swapping.
   Root cause was one false belief held independently in three places — that
   phonemes are ASCII. The pinned voice (kokoro-onnx 0.6.1 + espeak-ng) emits
   IPA. `engines.rs` required `is_ascii_graphic()` inside a `filter_map` and so
   DROPPED 28 of a measured utterance's 48 spans, silently and per-span;
   `speech_timing.rs` and `speech-timing.ts` each kept their own copy of the
   same rule; and the viseme table held 13 plain-ASCII keys, drawing a CLOSED
   mouth for 17 of the 20 spans that did survive. 85% of the audio played
   against a shut mouth. The phoneme rule now lives in ONE place and is a
   deny-list, not an allow-list of today's alphabet. Tests are built on a
   committed capture of real worker output and assert it is still genuine IPA,
   so a future "fix" that rewrites the fixture into ASCII fails instead of
   going green.

2. **`c37fcd0` — every wake opened another Candice.** Operator observed the
   count go 2, then 3. Each `/bro` fired the plugin wake hook, which launched a
   second process and a second window. Guarded, std-only, no new dependency
   (the supply-chain gate is PENDING and trading a visible bug for an
   unaudited crate is a bad trade). Registration is unconditional; only a
   wake-only launch stands down. Bridge launches deliberately still proceed —
   handing a session id and capability token to a process started for a
   different session is the cross-session leak the per-launch socket prevents.
   VERIFIED LIVE on the operator box: a second `--wake` printed
   `already running (pid 644); raised it instead of opening a second window`
   and exited 0, with one process on screen.

3. **`1c0d49b` — the character-height fix had been applied to the wrong
   element.** The floor sat on `#candice-stage`, which `composition.ts` removes
   when the gesture stage mounts; the container that outlives it still had
   `min-height: 0`, and it was the only row allowed to shrink. Also: the bottom
   of the control stack could fall outside the 640px window, which is what
   "the options are hard to select" actually was — offscreen buttons are
   unclickable. Plus 44px hit targets, a visible hover state, a caption
   scrollbar that is actually visible, and a real bug where clearing a caption
   left the highlight state set so a later progress tick re-announced an
   answered question into an aria-live region.

4. **`54e0ea1` — the two registry copies had drifted.** Twelve entries differed
   while BOTH files declared `registryVersion 3.0.0`; `verifyQuestion` compares
   delivered text with `equal()`, so this breaks delivery outright, and the
   stale side still contained un-substituted placeholders that would have been
   read aloud. Synced, and `tests/contract/vendored-parity.test.js` now asserts
   byte equality (mutation-tested: it names the drifted entry). Eleven
   questions rewritten plainer, 485 characters shorter. Three stale digests
   re-stamped — `interview-inventory` was RED AT HEAD before this change,
   verified by stashing.

5. **`3247c83` — Windows would have shipped unusable.** Console windows over a
   transparent character on every wake, STT run and for the whole duration of
   speech; the bundled interpreter unfindable because both call sites
   hardcoded the POSIX `python/bin/python3`; and the app unfindable after a
   normal install on BOTH platforms, because the resolver never probed
   `/Applications` (what the DMG tells users to do) or Tauri's NSIS default.
   Reasoned, not observed — there is no Windows machine — but enforced by a
   test that walks the source and fails on any unguarded spawn.

6. **`9ff8804`** — the injected app version was a hand-stamped `0.2.0` against
   a real `1.0.0-rc.1`; and `cmd_load_profile` reported every read error as a
   first run, so a transient permissions failure led to defaults being written
   over real preferences.

### Corrections made to claims during this session

- A Fable review called the quadratic `recording_to_wav` a ship-blocker
  costing "minutes of CPU" and wedging the capture worker past its 5-second
  release timeout. **Measured, that is wrong.** `FlatMap::nth` advances inner
  slice iterators a chunk at a time, so the cost is O(frames x chunks): ~15ms
  for a ten-second hold, ~540ms at the 60-second limit. Still quadratic, still
  worth deleting, never near the timeout. Fixed anyway; the measurement is
  recorded in the code so nobody re-derives the scary number.
- A first draft of the single-instance guard registered only wake launches,
  which would have left a bridged companion advertising nothing and reproduced
  the exact duplicate it was written to prevent. Caught and corrected before
  commit.
- The guard's first liveness check asked only "is that pid alive?". A pid is
  not an identity, and on Windows pid reuse would have pinned the lock forever
  and left the user with NO Candice — worse than the duplicate. It now stores
  and checks the executable name too.

### Test state at the end of the session

- TypeScript: **526/526** (was 508 passing of 518 at session start).
- Rust: **75/75** (was 66 before the new modules).
- Contract suite: **7/7 files** (was 6/7 — `interview-inventory` was red).
- Packaged/e2e accessibility tier: **still BLOCKED**, unchanged and untouched.

### What is NOT done, stated plainly

- `release-gate.json` remains `REPAIR_IN_PROGRESS`, 24 open fix ids, all nine
  required gates PENDING. Several cannot be satisfied from here at all:
  macOS notarization, Windows signing and interactive smoke, cleanMachine, and
  `independentQc`/FIX-024, which by construction requires someone other than
  the builder.
- STT ships dead: `SPEECH-INVENTORY.json` records all three whisper-cli
  binaries as `sha256Status: absent`, and the installer lane has not placed
  them. Voice input does not exist in the current artifact.
- The hardened-runtime entitlement set has no `com.apple.security.device.audio-input`,
  so microphone access would be denied on a properly signed build.
- `local-companion-bridge.test.js` hangs with two failures. Confirmed
  pre-existing by stashing and re-running; not touched.
- Duplicate-window gap remaining: a wake-only instance already up, followed by
  an MCP bridge launch, still yields two windows. Closing that is routing work
  in the FIX-011/FIX-013 lane and needs independent QC.

---

## 6. SESSION RECORD — 2026-08-26 (continued): the packaged tier opens

**Still not a release authority.** Lifecycle stays `REPAIR_IN_PROGRESS`,
open=24, complete=0. No gate marker is moved.

**Branch:** `candice/integration`, pushed to `origin` (the branch had never
existed on the remote before this session). Commits `7925958`, `caf4890`,
`c96d38b`, `f650d64`, `42c14af`, `b3c2fd1`.

### The packaged tier was never testing the product

All 31 packaged-leg failures traced to ONE cause: the driver asked for the
answer controls at `text field 1 of group 1 of window 1` — a direct child of
the window's first group — while the real tree is `AXWindow > AXGroup >
AXGroup > AXScrollArea > AXWebArea > ... > AXTextField`, because the UI is web
content in a WKWebView and a scroll region adds an AXScrollArea. A live dump
showed the element present and correctly labelled the entire time. A required
ship gate had been reading FAIL — a verdict about the product — for a
hardcoded path in the harness.

The AppleScript repair does not exist: `entire contents` returns a flat list
that cannot be filtered by element class (System Events answers -1700/-1728).
The search moved to `ax-driver.swift`, which walks the same public
accessibility tree a screen reader walks, by role and label, at any depth.

Result: **six of eight legs now pass** (typed-build-target, wrong-session,
duplicate, fallback, restart, speech-keyboard) where zero did. `compact` is
BLOCKED on a surface that has not landed. `speech-assets` fails on a real
design contradiction, recorded in TODO as an operator decision.

Two of those six needed their assertions corrected, both verified against
SessionManager before touching them: `restart` asserted the pre-lease
recovery contract in two places (a second recovery is REFUSED by the FIX-013
lease rather than returning nothing, and releasing a pending record requires
an acknowledged handoff, not a resume). Neither was a product fault.

### Two harness bugs that reached outside the harness

`killAppProcesses` ran `pkill -f candice-companion` — a bare substring match
against every command line on the box. It kills the operator's own installed
Candice, and it matches rustc/cargo/tauri command lines that merely mention
the crate, so a suite run could tear down a build in progress. `cleanStateGate`
had the same flaw with `pgrep -x` and reported the environment dirty because
the operator's own Candice was open. Both are now scoped to the packaged
binary's full path.

### Operator-reported defect: the toggles did nothing

Two causes found and fixed; one still open and named. A preference only took
effect if the disk write succeeded (`if (saved) current = next`), while the
control surface flipped its label regardless — so a failed write left the
button reading OFF while Candice kept speaking. And nothing stopped speech
already in flight, because the gate is read only when the NEXT question is
delivered. Whether a real pointer click reaches the controls at all is the
remaining candidate and is not claimed either way.

### UI pass

Eight review findings, each verified still open at HEAD first; five of the
reviewers' findings were already fixed and were not re-fixed. The permanent
"Candice session bridge is available." chip is gone when nothing is wrong and
every degraded message is out of engineering vocabulary; EDIT was a dead
button and now fills the type box; the caption stopped re-announcing itself
once per spoken sentence and now scrolls the highlight into view; option
buttons no longer rebuild on unrelated renders (which silently swallowed
clicks) and now show the chosen answer; Enter is IME-safe in all three inputs.

One review recommendation was deliberately NOT taken: the first-run name
prompt still mounts over a live question, because the repo's own test pins
that as spec 4. Raised in TODO instead.

### Three questions would have been read aloud with the brackets in

`CAPACITY_AGENT_COUNT`, `REPO_AMBIGUITY` and `LOOP_DONE_CONDITION` still
carried literal `<measured>` / `<the candidates found>` / `<the checkable
list>` slots. There is no substitution step anywhere in the registry —
`canonicalQuestion` sets `text: e.display` verbatim and `verifyQuestion`
compares with `equal()` — so either delivery was refused or Candice read the
angle brackets out loud. Rewritten in both registry copies byte-identically;
interview.md updated to match and its 39 pinned digests plus the inventory's
`doctrineDigest` re-stamped. The other three pinned source documents were not
touched and keep their digests.

### Test state at the end of this record

TypeScript 527/527. Rust 75/75. Contract suite 7/7 files green, including
vendored-parity and interview-inventory. Packaged tier 6/8 legs passing,
1 BLOCKED, 1 failing on the recorded design decision.

### Closing state of this session

Installed on the operator box and verified: sha
`2392036a336c465e8120ab020d546b75c341535b148e03fdf09840ecc2daaf57`, ad-hoc
signed, `codesign --verify --deep --strict` clean, microphone entitlement
embedded. Backups at `~/Library/Application Support/BlackCEO/999/
app-backup-20260826-105729`, `-153924` and `-154642`.

Two further defects closed after the packaged work:

- **The microphone was denied before the prompt could appear.** The packaged
  app ships with the hardened runtime on (`flags=0x10002(adhoc,runtime)`) and
  carried no `com.apple.security.device.audio-input`. The Info.plist usage
  string is only what the user is shown when the system ASKS; it grants
  nothing. Push-to-talk could not work in any packaged build, and a dev run
  uses the unhardened binary, which is why it was never felt.

- **The Animation toggle's click went through Candice.** Measured against a
  control: an accessibility press flipped it, a synthesized mouse click at the
  same rectangle did not; the voice toggle, a `<button>`, took the same click
  correctly. The checkbox is 14x14, so its published hit rectangle was 22x22,
  and the label beside it was never published at all — outside a published
  rectangle the window is deliberately pointer-transparent, so the click hit
  whatever was behind her. Fixed and re-verified at the same coordinates.

  This class of bug is invisible to every test that drives the UI through the
  accessibility tree. A sweep of every remaining pointer-cursor control found
  no others: they are all `<button>`, which `CONTROL_SELECTOR` matches whole.

## 7. Closing the last two open decisions (2026-08-26)

Both were escalated to the operator earlier in this session and both came back
as "make the call and ship". Recorded here as decisions, with what they cost.

- **Speech assets ship BUNDLED** (`306e4be`). The manifest was never dishonest
  — five rows `bundled: true` with real pins, three STT rows `bundled: false`
  / `sha256Status: absent` with an `absentNote`. The packaged LEG was the
  stale side, still asserting "zero pinned payloads ship inside the bundle"
  from an installer posture the repo abandoned. There is no installer lane
  here — no download step, no first-run fetch, no receipt-writing installer —
  so the alternative to bundling is a mute product.

  The leg now checks harder than what it replaced: every `bundled: true` row
  is read out of the packaged bundle and its bytes hashed against its pin,
  where the old check only counted files. Measured `verified=5 problems=0`,
  `bundled=5 absent=3`. Cost accepted and real: ~347 MB in the artifact, and
  on Windows much of it is macOS-arm64 Python that can never run. Carving the
  per-platform payload is a build-script change, already tracked.

- **The first-run name prompt is DEFERRED, not skipped** (`330b174`). It used
  to mount on top of a live question, putting two text inputs in a 420px
  column and taking the caret into the wrong one — so the first thing a user
  typed while reading a question went into the name box. The earlier partial
  fix silenced only the caption announce, which left both the collision and
  the stolen focus intact. Spec 4 says the name is asked at most once per
  local user; it does not say it must be asked on top of something else.
  Nothing is persisted on that path, so the ask simply happens on the next
  quiet boot. The test that pinned the old wording was rewritten with the
  reasoning in it.

- **`compact` stays BLOCKED, and the recorded reason was wrong.** It read
  "FIX-014 appui lane ... not yet landed". FIX-014's surface IS landed and
  tested — view, controller, queue, status, config, CONTRACT.md. What does
  not exist is `CompactTransport.submit`, anywhere in the product. The
  compact surface is a box for the user to message Claude unprompted, and
  every channel this product owns runs the other way. Verified across four
  named sources, each with a control that returned non-empty on the same
  instrument: 25 src-tauri commands (control: `cmd_submit_bridge_answer`
  found), one MCP tool `candice.ask_user`, 11 protocol schemas (control:
  `answer-event.schema.json` present), and a source sweep with zero
  `CompactTransport` implementors outside its own lane (control: the same
  regex found it in `controller.ts`). Not checked: whether a future MCP
  revision adds a client-initiated tool — a capability decision, not a defect.
  Ruling: do not mount it. A text box that submits into nothing would
  silently eat what the user types. The blocker text now names the real owner.

Final measured state: TypeScript 527/527, Rust 75/75, contract suite 7/7 files
green, plugin launch-command green, e2e aggregate UNIT PASS (22 legs) +
INTEGRATION PASS (6 legs). PACKAGED_AUTOMATED is 7 of 8 legs passing, BLOCKED
on `compact` alone — not for missing UI, but because the product has no
user-initiated channel to Claude in any tier. HUMAN_HARDWARE is BLOCKED
because it needs a person. Lifecycle unchanged: REPAIR_IN_PROGRESS, open=24,
complete=0 — no gate is marked closed by this pass, because closing one
requires `independentQc`, which this seat cannot run on its own work.


## 8. The voice tier, the copy pass, and a UI review (2026-08-26)

### The two dead facts

The app was measuring whether it could hear and whether it could speak,
and then throwing both answers away.

`SpeechHealth.stt_engine_ready` and `tts_engine_ready` are computed in
Rust and parsed into `capabilities.*` in TypeScript. Nothing read either
one. The consequences were not subtle:

- **HOLD TO TALK was a dead end on every build we ship.** All three
  whisper-cli rows in SPEECH-INVENTORY.json are `sha256Status: absent`,
  and `speech-assets/stt/` holds only the 31 MB model. So a user pressed
  the button, was taken through an OS microphone permission prompt,
  spoke, let go, and read "Answer in Claude instead". Every time. The
  failure was soft and honest, which is exactly why it survived review:
  nothing crashed and nothing lied. `pttUsable` was `!delegateActive` and
  consulted nothing else.
- **On Windows she would have narrated the same failure forever.** No
  Windows Python ships (the interpreter probe is already Windows-aware;
  the only interpreter in the tree is a Mach-O arm64 binary), and
  `system_tts_available` is hardcoded false off macOS because the WR-016
  adapter never landed. So every `speak` rejects, and the bridge announced
  "Candice could not speak this question aloud: <raw engine error>" on
  every question of the interview.

Both now gate on the measured fact, with the same rule on each side:
UNPROBED is not ABSENT. A dev run or a failed probe passes `undefined`
and behaves exactly as before; only a report that actually says false
suppresses anything. `root.dataset.sttEngineReady` / `.ttsEngineReady`
carry the facts for the packaged tier to read.

The reason-carrying failure text stays as it is. `bridge.test.ts` pins it
("the REASON must survive"), and for a rare one-off failure on a machine
that normally speaks, the reason is the useful part. What was wrong was
attempting the impossible and then narrating it forever, not the wording.

### What this means for a Windows client, stated plainly

Windows ships a Candice who displays captions and takes typed answers.
The bridge, the questions, the answer round trip and the recovery lane
all work. She cannot hear (no whisper-cli.exe) and cannot speak (no
Windows Python, no system-TTS adapter). She now says nothing about either
instead of offering controls that cannot work. Closing that gap needs
per-platform payloads and the WR-016 adapter, not a repair.

### A UI review, verified before acting

Two reviews were run over the copy and the UI. Nothing was taken on
trust: each finding was checked in the code first, with a control that
had to come back non-empty on the same instrument, and the ones that
turned out to be non-issues were dropped (the `Idle` and
`Compact companion` status labels, for instance, are never rendered --
gesture-stage.ts:313 emits an empty string for both).

The worst of what was found and fixed:

- **After one interrupted sentence, screen readers went deaf.** Sentence
  highlighting sets `aria-live: off` deliberately. The only code that
  turned it back on was `setSpokenProgress(null)`, which returns early
  when `highlighted === -1` -- exactly what a new caption sets. So one
  interrupted utterance latched the region off for the rest of the
  session and every later caption, including every later QUESTION,
  mutated a dead live region. No visible symptom: sighted users read it
  fine. This was my own bug, introduced with the highlight work.
- **A fix that worked everywhere except where it shipped.**
  `window/style.ts` set `color-scheme: light dark` directly on `body`,
  beating the `dark` inherited from `:root` -- and scoped to a class only
  added in the real native window, never the dev browser. The fix in
  styles.css:18 held in every place it was verified and was reversed in
  every place it shipped.
- **The open microphone was inaudible.** The PTT button's `aria-label`
  was set once and never updated, and aria-label overrides content, so a
  blind user was never told "LISTENING".
- **My own toggle fix had made the row narrower.** The repair added a
  second CSS rule instead of editing the first; it won on source order
  and cut horizontal padding from 10px to 4px.
- **A settings checkbox sat between the question and its answers**, and
  since DOM order is tab order, keyboard users tabbed through it to reach
  every answer.
- Option pills washed out on hover (an undefined custom property made the
  colour declaration invalid), USE ANSWER / EDIT / TRY AGAIN rendered
  touching with no rule at all on their row, the transcript was
  re-announced on every render, the remembered-method marker painted
  nothing, and several controls sat under the 44px target -- which on a
  pointer-transparent window means a near miss clicks the desktop.

### The copy pass

The operator asked for the opening line to be shorter and the same pass
everywhere else. The greeting went from 228 characters to 134 (44 words
to 26) with the fairy-godmother idea and the wish/real pairing intact;
what came out was one idea said three ways plus a sentence of framing for
a metaphor that framed itself. Beyond that: state-machine words that
reached the screen (`Waiting for user`, `Text fallback`, `Transcribing`),
an all-caps `RECOVERING` caption, passive transcript errors, and a
failure card written in status-page language.

The `text-fallback` caption was deliberately NOT reworded: it duplicates
the spec-5.1 button label and captions.test.ts asserts it renders "the
exact spec-5.1 label" verbatim. Worth revisiting, but a spec decision.

The registry questions were left alone entirely. They are byte-pinned
with digest stamps against the skill source, so rewording them is a
change to the skill and the registry together -- listed in TODO.md, not
attempted here.

### Measured at the close of this session

TypeScript 539/539 · Rust 75/75 · contract suite 7/7 files green · plugin
launch-command green · e2e happy legs 1-6 all PASS. PACKAGED_AUTOMATED is
7 of 8, BLOCKED on `compact` alone and for the proven reason recorded in
section 7. HUMAN_HARDWARE still needs a person.

Lifecycle unchanged: REPAIR_IN_PROGRESS, open=24, complete=0. No gate is
marked closed, because closing one requires `independentQc` and this seat
cannot run that on its own work.


## 9. Shipped to the operator box (2026-08-26 17:07)

Built, signed and installed. The first attempt at this was WRONG and is
worth recording, because the failure was silent:
`scripts/package-macos/build-macos-bundle.sh` does not build the
frontend -- it packages and signs an .app that already exists ("run
first: npm run tauri build"). Running it alone produced a bundle whose
SHA was byte-identical to the previous build, because it had simply
re-signed a stale tree: `src-tauri/dist/assets/` was from 15:43 and the
session's edits were 16:46-16:52. Exit code 0 the whole way. Caught by
comparing the SHA against the installed one and finding them equal, which
is the only reason it was not shipped as a fix that contained no fixes.

The real sequence is `npm run tauri:build` (tsc + vite + cargo release +
bundle), THEN the packaging script.

Verified before installing:
- the emitted chunk `index-CrvJDMXL.js` CONTAINS the new greeting, the
  new status labels and `sttEngineReady`, and does NOT contain the old
  greeting or "Waiting for user" -- positive and negative both checked.
- hardened + ad-hoc: `flags=0x10002(adhoc,runtime)`, `Signature=adhoc`.
- `codesign --verify --deep --strict` rc=0, on the built bundle AND again
  on the staged copy after `cp -R`, because a copy can strip a signature.
- four entitlements, including `com.apple.security.device.audio-input`.

Installed by two renames on one filesystem, NOT with the atomic-install
engine. The engine replaces its whole `--to` tree, and
`.../BlackCEO/999/app/` holds fifteen of the operator's own backups
alongside the live bundle; pointing the engine at that directory would
have destroyed all of them. Only `Candice Companion.app` was replaced.

  live:    .../BlackCEO/999/app/Candice Companion.app
           sha 1509bba9c2336e7f55783e5e708c088aaa7c7c1b018da278ee128404a2f71b7d
  backup:  .../BlackCEO/999/app/Candice Companion.app.bak-preuipass-20260826-170735
           sha 2392036a336c465e8120ab020d546b75c341535b148e03fdf09840ecc2daaf57

Sixteen backups present afterwards (the fifteen that were there, plus
this one). `~/.local/bin/candice-companion` resolves to the new binary.
No Candice process was running, so nothing was launched on the operator's
screen and no restart is owed.

Rollback is one command:

  cd ~/Library/Application\ Support/BlackCEO/999/app && \
    mv "Candice Companion.app" "Candice Companion.app.rejected" && \
    mv "Candice Companion.app.bak-preuipass-20260826-170735" "Candice Companion.app"


## 10. "Finish everything" pass (2026-08-26 17:30-18:15)

Seven commits, `4789ae1..8e3eb0e`, on top of the section-9 install. Two of
them close bugs of the same shape, and that shape is worth naming because
it is the one this codebase keeps producing: **a fact the app measured and
then never read.**

### 10.1 The two dead facts

`speech_health` reports `stt_engine_ready` and `tts_engine_ready`. Both
were computed correctly, emitted correctly, and consumed by nothing.

**STT.** HOLD TO TALK mounted unconditionally. `whisper-cli` is `absent`
on all three platform rows of the speech inventory -- there is no build in
which it ships -- so every user who held that button got silence and no
explanation. The button is now gated on the measured fact.

**TTS.** The same read on the other side, and worse on Windows: with no
engine present, `speak` returned a raw engine error which the caption lane
would have narrated at the user, on every question.

The gate is written as **UNPROBED is not ABSENT**: `undefined` (health
never arrived) keeps the old behaviour, and only an explicit `false`
suppresses. A health probe that fails must not silently amputate the UI.

### 10.2 WR-016 -- Windows gets a voice

Rather than leave Windows mute, `speak` now falls back to the system
synthesizer already on the machine: PowerShell
`System.Speech.Synthesis.SpeechSynthesizer` on Windows, `say` on macOS.
Text goes in over **stdin**, never as a command-line argument, so an
apostrophe or a quote in a question cannot terminate or reshape the
command.

It honours the full event contract, which is the part that is easy to get
wrong: `emit_speech_start` with an EMPTY timing array (there are no word
timings from a system voice, and a fabricated one would desynchronise the
mouth), and `emit_speech_drain` from a thread that waits on the child.
`Speak()` is synchronous, so child exit is genuinely end-of-audio. Without
that drain the speaking flag never clears and HOLD TO TALK stays disabled
forever -- a fallback that bricks the input lane is worse than no
fallback.

**And it says so.** The first time the substitute voice is used, she says:
"I'm using your computer's built-in voice -- my own voice isn't installed
on this machine." Once per session, not per utterance. The recorded
project decision is that a voice substitution is never concealed; a silent
swap would have satisfied the code and broken the decision.

### 10.3 The gate that cancelled the feature it protects

`ttsAvailable` was computed from `ttsEngineReady` alone. On Windows that is
false -- which is exactly when the new system voice is supposed to run --
so the bridge returned BEFORE calling speak, and 10.2 would have been
unreachable code that passed all its own tests. The gate now means "can
she speak at all": `ttsEngineReady || capabilities.systemTtsAvailable`.

This is recorded at length because it was self-inflicted, in the same
session, by the fix immediately preceding it.

### 10.4 The registry read author templates aloud

Five entries in `packages/candice-protocol/schemas/question-keys.json`
shipped unfilled templates into strings a TTS engine reads: `[date]`,
`Question <N>`, `<folder>` and two more. `interview.md` is CORRECT and was
NOT touched -- it defines these as fill-ins for the asker (lines 397 and
1391). Only the registry, which is the runtime copy, was wrong. The
vendored duplicate was rewritten byte-identically, sha `7e492f8c...`.

`tests/contract/speakable.test.js` (new) now makes the whole class
unshippable: no angle/square/brace/printf placeholder in display or
spoken text, and no backtick, filesystem path or `underscore_identifier`
in anything spoken.

Its first control was WRONG -- it asserted a total pattern count of 5 and
measured 3, because the path pattern requires leading whitespace and the
sample buried its path in backticks. Rewritten to exercise each pattern
against a purpose-built sample, plus a clean sentence that must trip
nothing.

### 10.5 The compact lane, and a boundary that held

The compact lane was repaired as a unit rather than left half-built:
pointer capture with `pointercancel`/`lostpointercapture`/`blur` release,
a keyboard path, a real mute with `aria-pressed`, an expand control with
`aria-expanded`, opaque scrims, 44px targets, and `.candice-compact` added
to `CONTROL_SELECTOR` so its clicks stop passing through to the desktop.
`native-input-regions.ts` now also observes **scroll** (capturing), which
it did not -- so the click map could be stale for up to 500ms after any
scroll, meaning clicks landed at the previous positions.

**A boundary that was NOT crossed.** The option-label pass wanted to
rewrite `simple-ghl` as "Put it on Convert and Flow". An existing test
("never invents wording") stopped it, correctly: that routing was inferred
from a slug, not read from the registry. The rewrite was narrowed to
formatting only -- "Claude code" to "Claude Code", "$40 year" to "$40 a
year" -- and the rest handed to the registry owner in TODO. Being right
about the wording is not authority over the registry.

### 10.6 Windows packaging (see commit 8e3eb0e)

`speech-assets/` no longer goes into the Windows bundle: an arm64 Mach-O
CPython (5 .dylib, 25 .so, ZERO .pyd) plus a 31MB model for an engine that
is `absent` on every platform. Removed via a platform config using JSON
Merge Patch (RFC 7396), where a null VALUE removes a key -- so the shared
config is untouched. Windows speech is covered by 10.2 instead.

The staging step became a FILE because the inline `node -e` grew a
template literal, npm handed it to a shell, the shell ate the backticks as
command substitution, and node got `const s=;` -- a syntax error that
killed the build AFTER the frontend had rebuilt.

### 10.7 What was proven, and what was not

Cross-compilation was NOT available: `cargo check --target
x86_64-pc-windows-msvc` dies in `ring`'s build script for want of an MSVC
toolchain and never reaches this code. The Windows branches were instead
type-checked by temporarily flipping their `#[cfg]` guards so they compile
on macOS (every API used is cross-platform), then restored, then verified
to contain zero stray `cfg(all())`/`cfg(any())`.

**No Windows machine exists in this project. No Windows bundle has been
produced. Nothing in 10.2 or 10.6 has been observed running on Windows.**

`cargo test --manifest-path src-tauri/Cargo.toml` does NOT run the
`candice-macos-permissions` crate -- the 75/75 figure says nothing about
it. Run separately: 20/20.

That crate is also **not wired into the app at all** (verified across
three sources, with `candice-capture` found at Cargo.toml:27 as the
control). A `#[cfg(windows)]` split added to it during this pass was
therefore REVERTED as misleading dead code.

### 10.8 Measured at the close

TypeScript 552/552 (was 539). Rust 75/75 main crate; permissions crate
20/20 under its own manifest. Contract suite green across 8 files
including the new `speakable.test.js`. e2e happy legs 1-6 PASS. Plugin
launch-command PASS.

The full packaged suite was NOT re-run. It launches sixteen Candice
windows and the operator objected to seeing them; that objection stands
until he lifts it.

### 10.9 Installed (2026-08-26 18:08)

Built fresh with the bundle directory removed first, because the previous
build had left a stale artifact that nearly produced a false negative
about macOS bundling. The fresh macOS bundle still carries the full 378MB
`speech-assets`, proving the Windows override is inert on macOS.

Chunk `index-iGyLu8Dw.js` contains "fairy godmother for building things",
"sttEngineReady", "computer's built-in voice", "not allowed to use your
microphone", "Claude-Nine". Negative controls all 0: "always dreamed
about", "Question <N>", "[date]", "Waiting for user". ("a folder called
projects" is 0 for a proven reason -- the registry is JSON the plugin
reads at runtime, never compiled into the webview chunk.)

`codesign --verify --deep --strict` rc=0 on the built bundle and again on
the staged copy.

  live:   .../BlackCEO/999/app/Candice Companion.app
          sha 1afc4545c1889459676de65b3797ba65f97cd845b5e5dff6487e1b1ab3ef9c70
  backup: .../BlackCEO/999/app/Candice Companion.app.bak-prefinish-20260826-180850
          sha 1509bba9c2336e7f55783e5e708c088aaa7c7c1b018da278ee128404a2f71b7d

Seventeen backups present. Again only `Candice Companion.app` was replaced
by two renames -- never the containing directory, which holds the
operator's own backups.

Rollback is one command:

  cd ~/Library/Application\ Support/BlackCEO/999/app && \
    mv "Candice Companion.app" "Candice Companion.app.rejected" && \
    mv "Candice Companion.app.bak-prefinish-20260826-180850" "Candice Companion.app"

### 10.10 Gate markers deliberately unmoved

Lifecycle stays `REPAIR_IN_PROGRESS open=24 complete=0`. Closing a gate
requires `independentQc`, and this seat cannot run that on its own work.
Also outside this seat: macOS notarization (needs an Apple Developer ID),
Windows signing (needs a certificate and a Windows machine), and
`cleanMachine` (needs a machine that has never had this app).


## 11. Fable gap review, and the fix that would have broken the build
    (2026-08-26 18:15-19:05)

Five Fable reviewers over `4789ae1..8e3eb0e`, distinct lenses, read-only.
All five returned. Every finding was re-verified in the source before
anything was touched; nothing below is recorded on a reviewer's word.

### 11.1 The worst finding was mine, and it was silent

`tauri.windows.conf.json` -- the file written in section 10.6 to stop 378MB
of dead payload shipping to Windows -- carried a top-level `$comment` array
explaining itself. Tauri's `Config` is
`#[serde(rename_all = "camelCase", deny_unknown_fields)]`
(tauri-utils-2.9.3/src/config.rs:3586), and the CLI merges the overlay as
raw JSON and THEN deserializes the merged value. One unknown key fails the
whole parse, before cargo runs.

MEASURED on the real toolchain:

  $ npx tauri info    # comment key present
  Error `"tauri.conf.json"` error: Additional properties are not allowed
        ('$comment' was unexpected)
  $ npx tauri info    # same file, key removed
  (no error)

`$schema` is not a counter-example: `Config` gives it an explicit field
(`#[serde(rename = "$schema")]`, config.rs:3589).

So the fix for a payload bug would have produced NO WINDOWS INSTALLER AT
ALL -- a worse outcome than the bug -- on the one platform nobody here can
test. Nothing would have caught it: no CI job stages a platform overlay
before checking, so the parse failure cannot surface in automation.

Rationale moved to `apps/candice-companion/TAURI-PLATFORM-CONFIG.md`.
`tests/contract/tauri-platform-config.test.js` fails the suite if a comment
key returns, and also pins the RFC 7396 null removal, the MAP shape of the
base `bundle.resources` (a null patch against the array form would replace
the whole list), and that BOTH staging paths cover overlays. Proven
non-vacuous by putting the key back and watching it fail.

### 11.2 stop() returned success while she kept talking

`TtsEngine::stop()` flipped an AtomicBool read only by Kokoro's in-process
audio callback (engines.rs:698, :1188). The system voice is a separate
PROCESS whose handle was moved into a detached thread blocked in `wait()`.
Nothing could reach it. Three failures wearing one coat: barge-in recorded
her own voice into the user's answer; the voice-OFF toggle was ignored
until the sentence ended; and stop freed the admission slot while the old
child spoke on, so the next question was admitted and two voices read two
questions at once, with nothing capping it at two.

The engine holds the child now. The watcher POLLS rather than blocking,
because a thread parked in `wait()` owns the child and puts it out of reach
of the thing that must kill it. Taking the handle is also what ends the
watcher, so an interrupt still yields exactly one drain -- promptly.

Also fixed in the same pass: the watcher used `std::thread::spawn`, which
PANICS on OS refusal, after speech-start and with the slot held (mute for
the session, HOLD TO TALK dead); the probe used `.output()` with no
deadline inside a sync command holding the slot, and re-ran every
utterance; `say` was handed the question as argv with no `--` (MEASURED:
`say -o out.aiff "-f /etc/hosts"` makes say READ that path); and a failed
stdin write abandoned a live child that would speak a truncated question.

### 11.3 The collapsed compact surface could open the microphone

`opacity: 0; pointer-events: none` stops the MOUSE and nothing else. Every
control stayed in the tab order and the accessibility tree, so a keyboard
user tabbing past "Open" landed on five invisible controls -- and the first
is HOLD TO TALK, so Space opened the MICROPHONE with nothing on screen.
`aria-expanded="false"` claimed the content was closed throughout. The
keyboard path added in 10.5 is what made this reachable. `inert` plus
`aria-hidden` now, at birth and on every toggle.

The mute button announced the inverse of its state: label "Unmute" WITH
`aria-pressed="true"` reads as "unmute is engaged", i.e. sound ON. A name
that is a verb cannot carry a pressed state. The accessible name states the
state now, reusing the app's existing "Voice responses ON/OFF" pair, pinned
equal to the answer-controls lane by a test.

### 11.4 Windows would have spoken mojibake

Rust writes UTF-8; `[Console]::In` decodes redirected stdin with
Console.InputEncoding, which under CREATE_NO_WINDOW is the hidden console's
OEM code page. A curly apostrophe would arrive as three characters and the
synthesizer would READ THEM ALOUD. The registry is ASCII, but its blanks
are filled at runtime with names, dates and Claude's own prose, and Claude
emits curly quotes constantly. The script now opens the stream and names
the encoding, which cannot throw the way setting Console.InputEncoding on
redirected input can.

The utterance write also moved off the main thread: sync Tauri commands run
there, a pipe holds ~4KB, MAX_SPEAK_CHARS is 8192, and PowerShell does not
drain until Add-Type finishes (1-3s cold start).

### 11.5 Guards that could not see, and a double that lied

`build.rs` mirrored only `tauri.conf.json`, so `cargo tauri build` -- what
CI and a fresh clone naturally run -- SUCCEEDED with no overlay and would
silently re-ship the 378MB. Verified by deleting the staged file,
rebuilding, watching build.rs restore it; controlled by confirming a
platform file with no source is NOT created.

The spawn-site guard walked six hardcoded paths, so a spawn added anywhere
else passed vacuously and a renamed file silently left coverage. It
discovers the tree now. Controlled: a spawn planted in a file the old list
could never have named is caught, and goes green when removed.

`build-macos-bundle.sh` had no freshness check -- the section-9 "fix
containing no fixes" was fully reproducible. It now refuses to package a
tree older than its sources, naming the offending file, with
`CANDICE_ALLOW_STALE_BUNDLE=1` for a deliberate re-sign. Proven both
directions: refuses stale, passes fresh.

`FakeElement` did not model `className` AT ALL, so every class the view
assigns that way vanished and class-based queries silently found nothing.
My own new test's control caught it -- it asserted the surface must exist
before testing it, and that assertion fired.

### 11.6 A tampering signal is no longer routed around

The canonical-voice conflict check sat BELOW the system-voice branch, so a
user-writable manifest declaring a voice the operator never approved was
answered by speaking anyway -- in the system voice -- whenever the bundled
engine was absent. The disclosure notice made that feel safe; it is not the
point. A manifest that disagrees with the signed bundle is a tampering
signal, and the answer to tampering is to stop.

### 11.7 Recorded, not changed

Registry copy (owner's call, byte-pinned across repos). The unmounted
compact lane's missing live regions and its `${inputMode}: ${text}`
rendering. The `var(--candice-ui-surface)` fallback question -- that lane's
own style test BANS a hex fallback, so "add one" would fail the contract it
is meant to satisfy. `describeSpeechFailure` carrying the native reason
into the caption: pre-existing and pinned by tests whose comment says "this
is the assertion the old catch failed", so the leak was fixed at the SOURCE
(all six of my new native error strings now follow the app's user-facing
convention) rather than by reversing that decision. `ttsFallbackActive` is
never set by WR-016 -- real inconsistency, but nothing consumes the flag,
so fixing it changes nothing observable and risks more than it returns.

### 11.8 Measured, and installed (2026-08-26 19:02)

Rust 80/80 (was 75). TypeScript 555/555 (was 552). Permissions 20/20 under
its own manifest. Contract suite green across 9 files. Plugin green.
Windows branches type-checked by cfg-flip, and THAT check was controlled:
injecting a fault into the windows-only body produced an error.

Built after removing the bundle dir. Frontend chunk `index-CMoltBEi.js`
(146,614 bytes, existence proven before grepping -- the first attempt at
this check read a path that does not exist, and every "0" it produced was a
missing-file error, not an absence). Positives all present, negatives all
zero, with a control proving the instrument discriminates.

  live:   .../BlackCEO/999/app/Candice Companion.app
          sha 1d04d976132333210472108691776f77...
  backup: .../Candice Companion.app.bak-review-20260826-190209
          sha 1afc4545c1889459676de65b3797ba65...

Eighteen backups present, all accounted for. The install script printed
"16" using a `*.bak-*` glob that misses two older `.backup-` named
directories; the true total went 17 to 18. Nothing was deleted, and again
only `Candice Companion.app` was replaced, by two renames.

Rollback:

  cd ~/Library/Application\ Support/BlackCEO/999/app && \
    mv "Candice Companion.app" "Candice Companion.app.rejected" && \
    mv "Candice Companion.app.bak-review-20260826-190209" "Candice Companion.app"

### 11.9 Lifecycle unchanged

Still `REPAIR_IN_PROGRESS open=24 complete=0`. See section 12 for what
stands between this build and a client.


## 12. WHAT IS LEFT BEFORE WE SHIP (verified 2026-08-26 19:05)

Every claim below was measured in this repo, not relayed. The code is done
and pushed; what remains is almost entirely not code.

### 12.1 There is no authorized artifact

`CONTROL/bundled-components.json` carries NO Candice Companion app payload.
MEASURED -- its eight components are: stt-assets, tts-assets,
nine-router-setup, spec-protocol, kaizen, eli5, bro, candice-integration.
The file's own note says the 0.2.0 app records were quarantined by FIX-001
and "a new application payload may be added only after
scripts/candice-release/status.mjs accepts the exact candidate".

`node scripts/candice-release/status.mjs` -> NOT_RELEASE_READY: 24 open
fixes, nine gates PENDING, no candidate, no signed artifacts, and the
operator release authority pin is literally UNCONFIGURED.

So the scripted installer cannot install the app. It fails closed, which is
correct, and it means nothing can be handed to a client that installs
unaided. **Needs: FIX-024 operator authority (an operator-owned key) plus
independent QC. Neither is mine to do.**

### 12.2 Gatekeeper, with no instructions anywhere

MEASURED on the fresh bundle: `Signature=adhoc`, `TeamIdentifier=not set`.
Ad-hoc is a recorded operator decision (QFIX-adhoc 2026-08-23), not a
defect. The consequence is: a downloaded DMG carries the quarantine
attribute, and first launch shows "Apple could not verify..." with only
Done / Move to Trash. On macOS 15+ the right-click-Open bypass no longer
works for unnotarized apps -- the client must fail a launch, then go to
System Settings and choose Open Anyway. `minimumSystemVersion` is 12.0, so
macOS 12-14 clients still have right-click-Open.

No client-facing first-launch document exists in this repo. **Needs EITHER
an Apple Developer ID plus notarization, OR a written instruction sheet.
The instruction sheet I can write today on the word go.**

### 12.3 The update channel is a dead end as committed

Three things in the repo cannot all be true and still produce an update:

  a) the committed trust anchor's private key is documented DISCARDED
     (scripts/candice-release/updater-sign.mjs:9, :98-99;
     apply-release-config.mjs:11);
  b) the release workflow REFUSES to build unless the signing secret's
     pubkey is byte-identical to that committed pubkey
     (.github/workflows/candice-release.yml:106-130);
  c) signing requires the mate of that discarded key.

Also `"createUpdaterArtifacts": false` in the committed config
(tauri.conf.json:51).

If (a) holds, the lane is unsatisfiable as committed. Repairing it means
committing a NEW pubkey -- after which **every client who installed the
current artifact carries the dead anchor and can never auto-update**, only
manually reinstall, which re-enters 12.2. **Needs an operator decision
before any client install happens, not after.**

### 12.4 Voice input is not in the box

MEASURED: `Resources/speech-assets/stt/` holds only the 31MB
`ggml-tiny.en-q5_1.bin`. All three whisper-cli rows in SPEECH-INVENTORY.json
are `sha256Status: absent` on every platform. HOLD TO TALK is correctly
hidden rather than dead, and the degrade message is honest -- but a
headline feature is absent while 31MB of unusable model ships. TODO.md
adds that the pinned macOS binary is a Homebrew bottle that would link
dylibs clients do not have. **Needs the installer lane to place a
non-Homebrew-linked engine.**

### 12.5 Windows has never been built, signed, or run

No Windows machine on this project. Today's review caught that the Windows
config overlay would have failed config parse outright (section 11.1) --
which is exactly the class of thing that only a real build finds. CI does
not close this: `candice-ci.yml`'s Windows jobs run cargo checks WITHOUT
staging the overlay, so that parse failure could not have surfaced there,
and the interactive Windows smoke is `if: false`. **Needs a Windows
machine and a code-signing certificate.**

### 12.6 What can still be done here, without the operator

- the first-launch instruction sheet (12.2)
- the privacy suite (WS-44, tests/privacy-audit/)
- supply chain: npm audit, cargo-deny, SBOM two-run determinism
- most of the 24 FIX items are code work; CLOSING them is not, because the
  box-flip rule requires independent QC per item
- a CI job that stages the platform overlay and parses the merged config,
  so 11.1's class is caught by automation rather than by a reviewer

### 12.7 What can never be done here

`independentQc` (reviewing my own work is not independent), `cleanMachine`
(a machine that has never had this app), notarization (Apple Developer ID),
Windows signing (certificate plus a real Windows box), and `ciRequiredChecks`
(hosted Actions runs on the exact candidate commit, whose evidence record is
written after independent QC).


## 13. Four of the five ship blockers closed (2026-08-26 19:05-19:30)

Operator instruction: "FIX ALL FIVE ISUUES AND SHIP", then "DO UR OWN QC
WORK I DONT HAVE TIME". Section 12 listed five blockers. Four are closed.
The fifth needs hardware and credentials that do not exist on this project.

### 13.1 Voice input works (blocker 12.4 CLOSED for macOS)

`stt-binary-macos` had been `sha256Status: absent` since the beginning, so
HOLD TO TALK has never worked on any build. TODO.md recorded why nobody
simply copied the binary in: the Homebrew bottle links dylibs a client does
not have (`@rpath/libwhisper.1.dylib`,
`/opt/homebrew/opt/ggml/lib/libggml*.dylib`), so a straight copy dies with a
dyld error at the first push-to-talk.

`apps/candice-companion/scripts/relocate-whisper-macos.mjs` walks the
dependency closure, stages every non-system library beside the binary, and
rewrites every install name to `@loader_path`. It refuses to stage a
partially-resolved engine, and refuses to report success while any external
reference remains.

MEASURED, end to end. Real speech generated to a 16 kHz WAV, transcribed by
the engine inside the SIGNED bundle: "The quick brown fox jumps over the
lazy dog.", rc=0.

CONTROL: hiding one staged dylib produces
`dyld: Library not loaded: @loader_path/libwhisper.1.9.2.dylib`, rc=134. It
does NOT fall back to Homebrew's copy — which is the entire point, because
falling back is what would make a developer machine pass while a client
machine fails. Cost: 2.3 MB.

The payload stays out of git, matching the existing convention; the script
is the reproducible source of truth, and the engine is mirrored into
`~/Library/Application Support/BlackCEO/999/speech-assets-source/stt/`.

### 13.2 The inventory tells the truth about it

What ships is NOT the bottle — relocation changes the bytes — so recording
the bottle digest as its pin would be a false statement in the one file
whose whole job is to be true. The upstream digest is kept as `derivedFrom`
provenance; the shipped bytes carry their own measured hash.

That exposed a real defect: the generator read `entry.sha256 ?? sha256Of()`,
PREFERRING the declared pin and measuring only when none was declared. A
present file disagreeing with its pin was recorded as `pinned` carrying a
hash it did not have.

**And my first fix was worse than no fix.** I put the throw inside the `try`
whose `catch` sets `present = false`, so a tampered artifact was swallowed
and recorded as ABSENT — an integrity failure presenting as "not shipped",
which the app then degrades politely around. My own control caught it: one
corrupted byte, generator exited 0, model came back `absent`. The check now
lives outside that catch and the control fires: `is pinned to c77c5766`,
rc=1.

### 13.3 The update channel is alive (blocker 12.3 CLOSED)

The committed anchor's private key was documented discarded while the
release workflow refuses to build unless the signing secret's pubkey matches
it byte for byte — unsatisfiable as committed.

Rotated NOW precisely because nothing has reached a client. An install
carrying a dead anchor can never auto-update, only be reinstalled by hand,
so rotating after shipping would strand every client. New keypair generated;
the private half lives at `~/.ssh/candice-release/updater.key`, mode 600,
never read, printed or committed. The comments asserting the discarded-key
guarantee are corrected rather than left to mislead: separation now rests on
`createUpdaterArtifacts: false` plus the secret existing only inside the
protected release workflow.

**Operator action required to complete the lane:** set the GitHub secrets
`TAURI_SIGNING_PRIVATE_KEY` (contents of that file) and
`CANDICE_UPDATER_PUBKEY` (contents of `updater.key.pub`). Verified the
workflow's own matcher accepts the pair: committed === would-be secret, with
a control proving the comparison discriminates.

### 13.4 Operator release authority configured (blocker 12.1, key half)

Derived the PUBLIC half of the operator-owned Ed25519 key at
`~/.ssh/candice-release/release-authority.key` with `openssl pkey -pubout`,
committed it as `CONTROL/release-authority.pub`, and pinned its whole-file
SHA-256 in `status.mjs`. The private half was never read, copied, printed or
committed.

This does NOT authorize a release. Every other gate still applies; a
matching hash only makes later signature verification meaningful. The
"operator release authority is not configured" error is gone from the gate
output; CONTROL: tampering with the .pub brings an authority error back, and
restoring it clears it.

The status tests are STRONGER than before, not merely updated: the forged-
document test asserts the authority error that now actually applies, and two
new tests use the injectable pin to cover both states permanently — an
unconfigured pin still fails closed, and a key whose hash misses the pin is
rejected while one that matches is not. That pair carries its own control,
because an authority rejecting everything unconditionally would satisfy the
rejection assertion while proving nothing.

### 13.5 A client can be told how to install it (blocker 12.2, doc half)

`docs/client/INSTALL-MACOS.md`, written for a non-technical owner: the
Gatekeeper warning is expected and is not a virus alert, the System Settings
route for macOS 15+, the right-click shortcut for macOS 14 and earlier, the
microphone prompt, and what happens to their voice data. Swept for developer
vocabulary with an instrument proven to fire on a positive sample.

Notarization itself still needs an Apple Developer ID.

### 13.6 CI can now catch what slipped through (blocker 12.5, partly)

The `$comment` defect reached a green commit because `windows-x64` runs
cargo checks WITHOUT staging the overlay — the broken file was never read
there. The new `windows-config-parse` job stages the overlays exactly as a
build does and makes the CLI load the merged config on Windows. It asserts
the overlay is present first (or the check would be vacuous), then injects
the exact defect and requires the CLI to reject it, so the job cannot
silently stop working.

### 13.7 What is still genuinely blocked

- **Windows signing and interactive smoke**: needs a code-signing
  certificate and a real Windows 10/11 machine. Neither exists here.
- **macOS notarization**: needs an Apple Developer ID.
- **cleanMachine**: needs a machine that has never had this app.
- **independentQc**: the operator delegated QC to this seat. Every check was
  run here and every finding verified in source, and fresh reviewer agents
  were used as the outside eyes — that is what caught the config defect in
  11.1, which this seat had written and could not see. But a builder
  reviewing their own work is not what the gate's word "independent" means,
  and the gate is not flipped on my say-so.

### 13.8 Measured and installed (2026-08-26 19:19)

Rust 80/80. TypeScript 555/555. Contract suite green across 9 files.
Release suite 130/130. Packaged, nested dylibs individually signed,
`codesign --verify --deep --strict` rc=0 on the built bundle, the staged
copy and the live install.

  live:   .../BlackCEO/999/app/Candice Companion.app
          sha 146a98944ba71defc4e6fe8bb7b019f6...
  backup: .../Candice Companion.app.bak-fivefix-20260826-191949

Nineteen backups present, all namings counted. Rollback:

  cd ~/Library/Application\ Support/BlackCEO/999/app && \
    mv "Candice Companion.app" "Candice Companion.app.rejected" && \
    mv "Candice Companion.app.bak-fivefix-20260826-191949" "Candice Companion.app"

Key hygiene verified within a bounded scope: zero private-key files tracked
in HEAD, one public key tracked, no private-key header in any file touched
by commit 00bc29f, each with a control proving the instrument fires. A
full-history scan timed out on this 11 GB tree and was NOT completed — that
broader claim is undetermined, not proven clean.
