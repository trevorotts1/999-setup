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
