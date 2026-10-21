# Changelog - drama-song-ad-factory (Skill 75)

## [v2.9.78] — twin sync of onboarding v2.9.78 (duration overshoot flag, client-authority song fork)
 - 2026-10-21

1. QC DURATION OVERSHOOT = FLAG, NOT STOP (`master_length`, `song_dispatch`,
   `qc_gate`, `final_assembler`). The one rule is
   `master_length.judge_duration`, used by the video master check and the song
   `length` gate. At or under the target passes clean; an overshoot of up to
   10 seconds PASSES and records the named warning `QC_DURATION_OVERSHOOT`
   ("62s of 60s — within the 10-second allowance"); an overshoot past 10
   seconds ALSO passes and records `QC_DURATION_OVERSHOOT_SEVERE` with the
   exact seconds over. Neither stops the run; `qc_gate.evaluate` and the
   assembler emit the warning through `loud_failure.warn` and carry it on the
   receipt. An undershoot is unchanged: the song gate keeps the 5/10 band
   (past 10 points is still FAIL) and the video master stays free on the short
   side.

2. SONG-FAILURE VERDICT BELONGS TO THE CLIENT (`song_choices`,
   `intake_preflight`). `one_variant` no longer regenerates a failed take: ONE
   generation per variant, the judge's named concerns on the result, and the
   paid take kept. `deliver_choices` presents every take — accepted ones on
   the offer surface, failed ones in `SONG-CHOICES/FOR-LISTENING/` — and asks
   the ONE fork "Want me to redo all of them, keep one of these three, or
   generate three new options?". The answer is recorded in
   `song-choices/fork-decision.json` (`song_choices.py fork`, or
   `pick --reply` with words). `factory.py music --action complete` WAITS on
   that answer instead of blocking (`SONG_FAILURE_AWAITING_CLIENT`, row
   WAITING_APPROVAL); `redo_all` / `new_three` reopen the row for a
   client-authorized round, and `keep_one` never writes a PASS — the WW-18 /
   WW-21 measured gates still hold and the documented `--operator-decision`
   route stays the only way to close them.

## [v2.9.73] — twin sync of onboarding v2.9.73 (lip-sync gate, slot hold, operator decision, model catalog, state reconcile)
 - 2026-10-21 - reliability fixes proven by the Voyage To Virtue run

Every fix below is proven by measured evidence from the Voyage To Virtue run
(13 shots, 65 lip-sync receipts, a 17-20 h stale session); no gate was weakened.

L1.1 - LIP-SYNC GATE CONDITIONAL (final_assembler). Live: a faceless 13x6.67 s
plan — zero lip_sync markers, zero speaker-keyed lines — was refused
LIPSYNC_COVERAGE_SHORT+LIPSYNC_LINES_TOO_FEW. `lipsync_gate` now mirrors
`face_speaks_gate`: a plan declaring no lip-sync work records
{verdict: NOT_APPLICABLE, reason_code: LIPSYNC_NOT_IN_PLAN, ...numbers} on the
receipt and advances; a plan that DECLARES lines keeps the hard gate unchanged
(declared-short still refuses, measured live).

L1.2 - HOLD CLIP TO SLOT (final_assembler). Live: planned 83.17 s from thirteen
6 s clips, render produced 68.70 s (EOF trimming). Inputs are now ffprobed
(readable-or-refuse), and a short source is held with tpad=stop_mode=clone to
its slot then trimmed back to the slot exactly. Measured: a 3.6 s clip in a
6.0 s slot rendered 6.533333 s (was 3.6 s); a 13x5.3 s-in-6.0 s voyage replica
rendered 78.0/78.0 planned with 13/13 holds; longer clips trim byte-for-byte as
before (7.34 s slot from a short source now renders 7.34 s, was 6.0 s).

L1.3 - LANE_SIZE_BROKEN SILENCED (final_assembler). Live: four
`size() missing 2 required positional arguments: 'runtime' and 'provider'`
warnings per assembly. The internal call now invokes
lane_size.size("claude-code","openrouter",units=999) — the same documented call
intake_preflight/factory.py makes — and a normal assembly prints zero
LANE_SIZE_BROKEN warnings (was 2 per dry assemble, 4 in the preflight+build
sequence).

L1.4 - HEADLESS + RECEIPT BESIDE OUTPUT (final_assembler). assemble() is now a
thin wrapper over _assemble() and the receipt is written beside the output on
EVERY non-dry-run outcome, error paths included: a headless CLI
assemble (stdin=devnull, no prompt, no browser) assembles and writes
<output>.receipt.json even on a gate refusal (was: refusal wrote no receipt).

L2 - WW-21 OPERATOR DECISION (song_dispatch, intake_preflight). Live: song
master delivered, summary PASS, stage music FAILED_BLOCKED
ACCEPTANCE_NOT_PROVEN, `music/acceptance/` held five empty dirs across 90 takes,
D5 measured FAIL across four estimators, `_MANUAL_SOURCES` forbids a relabel —
no honest way to close the stage. `factory.py music --action complete
--operator-decision <path>` now accepts a DOCUMENTED decision file recording
{decision: ACCEPTED_RISK, operator, at_utc, gates_not_proven,
measured_evidence_digest, reason}; the digest is CHECKED against the on-disk
measured-evidence records (a fabricated digest is refused, 13 fabrications
tested), the take-level records stay untouched (D5 verdict UNMEASURED kept),
`_MANUAL_SOURCES` stands, and an invalid or missing file writes nothing. A valid
decision measured: state FAILED_BLOCKED -> COMPLETE with the gates-not-proven
list recorded.

L3 - CARD OFFERS ONLY REGISTRY-RESOLVED MODELS (choice_card, style_defaults).
Live: the client's card said "MiniMax H3"; the live KIE registry (218 models)
does not carry it; the run stopped to ask a human at 21:57Z. choice_card's
video-model list is now built from the registry the skill already ships
(resolve/require/lock gated on the live table), the card question is built
fail-closed from require_choices(), and lock_choice refuses to write
video_model_lock for an unresolvable model. Measured: a registry without the
MiniMax entries refuses by name (MiniMax H3 named in the refusal), renders no
lock row, and the end-to-end `card --format text` renders RECOMMENDED pricing
from the live table on the live registry.

L4.1 - RECONCILE FROM ARTIFACTS (intake_preflight). Live: gate.json
approved_at 2026-10-20T21:56:49Z with 13 stills while the storyboard row said
NOT_STARTED, so `next` kept handing back the music command. `next` now
reconciles stage rows from proven artifacts on disk FIRST, through state_store's
version-CAS transitions (owner "reconcile", lease, events) — never a
hand-written sqlite UPDATE. Measured: storyboard NOT_STARTED -> COMPLETE with
13 approved shots and 13 stills found; unproven rows and lease rows are never
seized.

L4.2 - STALE-SESSION GUARD (intake_preflight). Live: sessions ran 17-20 h on
code older than the installed skill; three merged fixes could not reach them.
A process that booted on an older skill-version.txt than the one on disk now
refuses every stage command with SKILL_UPDATED naming both versions (e.g.
installed v2.9.72 > boot v2.9.71). Measured live end-to-end with exit 1.

L4.3 - WAITER TEMPLATE FIXED (references/stage-runbook.md). Live: two shells
spun ~8 h on `while pgrep -f "run_vtv_music.py"`, which matches its own command
line. The documented waiter now anchors on the interpreter with the bracket
trick (`pgrep -f "python.*[r]un_vtv_music\.py"`), never matching the waiter
shell's own pid, with an artifact-based second exit and a self-check command;
a test proves the OLD pattern reproduces the 8 h bug and the NEW one does not.

L4.4 - ATTEMPT CEILING (lip_sync/lip_gate). Live: 65 lip-sync attempts, all FAIL
FACE_COUNT, still retrying. After N=3 consecutive identical structural failures
the gate stops before another paid attempt: {cause: ATTEMPT_CEILING_REACHED,
structural_code: FACE_COUNT, count: 65, ceiling: 3, "no face in these stills —
choose a face-visible format"}.

L4.5 - SAFE-DEFAULT COST FORKS (intake_preflight). A cost/approval fork now
carries a safe DEFAULT bounded by the remaining spend-ledger balance and the
run's declared budget, recorded as a decision in control/fork-decisions.json:
cost 2000 of a 3500 remaining balance -> "proceed"; 999999 -> "wait" naming both
numbers (2000 < 3500 <= budget 5000, all live-measured).


## [v2.9.72] — 2026-10-20 — R&B Flow fits every length or is refused before stage 3; client brief words count

Twin sync of onboarding v2.9.72 (the same two defects, same fixes, same tests):

R1 — R&B Flow deadlocked at 30/45/60 s: the plan kept its rap reservation AND its
generic sung budget and missed the style's sung-share floor (60 s: sung 53 + rap 40
-> SHARE_OFF_TARGET 63.5% against 72.9%; 30/45 s -> WORDS_DO_NOT_FIT). The sung
allocation is now sized against the share words_fit checks, at the style's own
rates, never raising a word count. A card too short for both is refused up front by
music_director.build_generate_request with STYLE_TOO_SHORT_FOR_RAP naming the
shortest card that works (70 s). Soul Ballad, Soul Rise and no-style plans are
byte-identical.

R2 — client_word_runs now treats the research brief's sub-avatar client answers
(avatar, emotional_wound, desired_transformation) as exempt verbatim sources.
sub_avatar.notes stays excluded (the model-written provenance field).

New tests: length_formula/test_rnbflow_fit_v2972.py,
lyric_writer/test_brief_exemption_v2972.py.

## [v2.9.71] — 2026-10-20 — DSF-009: canonical sync from onboarding v2.9.71 (the music stage runs on a clean install)

This twin is what Laya Kelley and Jennifer Allen run. v2.9.70 opened the script gate; both runs then
hit the music stage and stopped there: on a clean install NOT ONE paid music job could be dispatched
and the bare `song_choices.py generate` CLI refused every run. Five defects, each proven on real
client data (Laya Kelley's Voyage To Virtue run, 2026-10-19; Jennifer Allen's runs of 2026-10-16/17,
`driver_dispatch*.py` workaround files, FAILURE-ANALYSIS-20261017 section 4.5). Laya's box agent
hand-patched five files between 09:56 and 10:25 EDT and her takes and word timings came back; this
sync carries the same repairs with the tests the patch never had. Sync source:
`trevorotts1/openclaw-onboarding` merged PR #2374 (head `32fa0fd9b94ba4a3e47739692c231b4c52ea64d8`,
Skill 74 v1.1.9 rides along through the installer-registration helper pin).

- `scripts/core/` regenerated with `installer-registration/package_core.py` from the onboarding
  canonical core at the merged PR #2374 head: 0 files hand-edited, 558 -> 560 files
  (+`song_transports.py`, +`test_music_clean_install_v2971.py`), one tree sha256
  `85a067e6adb639a48968e2e2dcd6754c9cbe6a38ed45db2701c660fb95ca5009` on both sides.
  It carries the five fixes, each proven on the real probe shapes:
  1. `song_choices` CARD RECEIPT attached: `song_choices._card_receipt` reads the run's OWN record
     (`control/card-receipt-block.json`, else `control/card-receipt.json` when it holds an `answers`
     dict, else `control/run-state.json["card_receipt"]`) and attaches it to every paid request —
     including the word-timing sub-calls. Laya's `probe/req.json` -> `CARD_UNANSWERED` before,
     `None` (dispatch proceeds) after. Nothing found attaches nothing: the gate still refuses and
     no receipt is ever fabricated.
  2. `script_words` fed the approved sheet's lyric LINES (`spec["sheet"][*]["lines"]`, fallback
     `sheet_text`; bracket headers are Suno directions, never lyrics), not the 247-word
     `client_text` research document (96 of 120 required words unsingable by any take).
     `client_text` stays the hook-vocabulary source in `build_requests`.
  3. `audio_c3.lyric_timing` OMITS `callBackUrl` when there is none instead of sending `""`, which
     Skill 74's `_cb_check` refuses as bad_request.
  4. SYNC createTask models dispatchable: `ai-music-api/timeStamped-lyrics` answers createTask
     synchronously with `alignedWords` and no taskId; Skill 74 reported it `bad_response` and
     `kie_dispatch`'s save step re-queried a local `sync-` id KIE never had, saving zero files.
     Skill 74 now returns `state=success data={"response": data, "sync": true}` and persists a
     URL-less payload as `<save_dir>/<task>_0.json`; `kie_dispatch` writes the submit envelope to
     `sync-info.json` and passes `--info` to save; CLI `save --info <file>`.
  5. PRODUCTION TRANSPORTS shipped: new `scripts/core/song_transports.py` (stdlib + numpy +
     ffmpeg: `make_measure`, `make_save`, `make_timings`, `build_pace_plan`) wires the `generate`
     CLI itself; the programmatic refusal for None stays exactly as it was.
- Helper pin: `74-kie-live-adapter` v1.1.8 -> v1.1.9 (sync createTask fix + `tests/test_sync_createtask.py`),
  vendored folder rsynced from onboarding; `07-kie-setup` v7.2.2 -> v7.2.3 rode along in the same
  merged PR ("SKILL_VERSIONS pin for Skill 74 follows") and its vendored folder follows too;
  `helper-deps.py repin` + `check-helper-pins.py` (origin/main) + `test-helper-pins.sh` all green.
- Doctrine: `references/stage-runbook.md` refreshed byte for byte from canonical (the music row is
  now the `song_choices.py generate` command — the ONE command the music stage runs);
  `references/twin-sync-fingerprints.json` core block regenerated (560/560 match, both tree hashes
  recorded). The canonical SKILL.md "music command" paragraph is carried in the twin's own wording
  under this entry because the twin's `SKILL.md` is its own document (OpenClaw runtime wording).
- Version markers move together: `VERSION`, `skill-version.txt` and the `SKILL.md` frontmatter
  `v2.9.70` -> `v2.9.71`, the canonical version of record.
- `intake_preflight/test_factory_method_agnes.py` rides the core regeneration (canonical test
  update so kie_dispatch resolves at call time — the suite is order-independent).

## [v2.9.70] — 2026-10-20 — DSF-002: canonical sync from onboarding v2.9.70 (stage-3 script-lyrics deadlock + hook_plan forwarding)

This twin is what Laya Kelley and Jennifer Allen run. Both runs sat in `script-lyrics` for hours and
never reached the song: Laya's Voyage To Virtue run about 9 hours (321 shell calls, 1.84 M output
tokens), Jennifer's 54-minute and 136-minute agents on the same errors. The stage-3 agent is told to
iterate until every gate passes and never edit a validator, and the shipped gates contradicted each
other. Sync source: `trevorotts1/openclaw-onboarding` `origin/main` `e13c70e4b` (v2.9.69) plus the
onboarding DSF-001 change set at v2.9.70 (branch `fix/dsf-stage3-deadlock`).

- `scripts/core/` regenerated with `installer-registration/package_core.py`: 0 files hand-edited,
  549 -> 558 files, one tree sha256
  `b63c4aff3089f3045fea86114b37e84625fec58eec36941f0aee8c3c9cd00bbf` on both sides, `--check` OK.
  It carries five fixes:
  1. `lyric_writer` first-person vs client hook: a line that is a contiguous run of at least 3 words
     of the client's own brief text (offer, website, claims, packet lines) is exempt from
     `line-not-first-person`, because `suno_recipe.check_hook` requires the hook to be the client's
     own words. Invented second-person lines and 2-word fragments still refuse. The comparison
     folds apostrophe variants (a brief pasted from Word carries U+2019 while the written lyric
     usually carries ASCII '), because `words` splits the curly form ("isn't" is one token,
     "isn\u2019t" is two) and the client's own line then silently refused itself.
  2. `lyric_writer` URL dot: a dot inside a word (`VoyageToVirtue.com/...`, `3.5`) is no longer a
     sentence break for `line-multi-idea`; "I rise. I fall" still refuses.
  3. Plan budget vs `words_fit`: `length_formula.plan(L, style_id=...)` priced words at 1.4 spoken /
     1.07 sung per second while `words_fit.preflight` prices Soul Ballad at 1.85 / 1.0 plus 8 s
     intro/outro, so the plan's own budget was refused `WORDS_DO_NOT_FIT` (60 s: 66 words = 65.7 s
     against 58 s; 90 s: 95 words = 90.1 s against 88 s). A named non-rap style now caps its words to
     what `preflight` admits; `plan(L)` with no style is byte-identical; rap styles are untouched.
     New check `length_formula/test_style_budget_fits_v2970.py`.
     Scope, stated plainly: this caps ONLY the plan the WRITER is handed
     (`length_formula.plan` with `style_id`). `suno_recipe.check_lyric_sheet`'s drafting tolerance
     (10 % + 2) is NOT that gate -- see fix 5.
  4. `hook_plan` forwarding (onboarding v2.9.65, missing from this twin at v2.9.61):
     `song_dispatch.validate_request` forwards `hook_plan` to `check_lyric_sheet` and `song_choices`
     attaches `_hook_plan` before `validate_request` -- the "hook appears 2 times, 88 s needs 4"
     refusal Laya hit on 2026-10-20. The v2.9.62-v2.9.69 canonical core changes ride along.
  5. The drafting allowance in `suno_recipe.check_lyric_sheet` stays on the UNCAPPED plan (the larger
     of the styled and unstyled totals, i.e. byte-for-byte the allowance origin/main applied). Pricing
     that row off fix 3's capped total shrank the allowance and refused a real approved 48 s sheet
     (58 words against 52.6), turning three shipped self-checks red: `sung_hook/test_three_walls.py`,
     `song_dispatch/test_remaining_defects_r1_r2_r4.py`, `suno_recipe/test_pace_direction_g11.py`.
     `words_fit.preflight` stays the ONE gate that decides whether a sheet FITS.
- Doctrine: `SKILL.md` and `INSTRUCTIONS.md` carry the canonical stage-3 STOP RULE paragraph verbatim
  (at most 3 validator rounds, then stop, report the exact gate and ask the client one question;
  never grid-search, never more than about 10 minutes, never edit a validator during a run).
  `references/stage-runbook.md` refreshed byte for byte from canonical (STOP RULE plus the music
  stage lifecycle paragraph). `references/twin-sync-fingerprints.json` core block regenerated
  (558/558 match, both tree hashes recorded). Canonical-only references stay unmirrored as recorded
  at v2.9.61.
- Version markers move together: `VERSION`, `skill-version.txt` and the `SKILL.md` frontmatter
  `v2.9.61` -> `v2.9.70`, the canonical version of record.

## [v2.9.61] — 2026-10-16 — BATCH-AGN-24H-N2: canonical sync of this twin from onboarding main `b16266d9`

Batch `BATCH-AGN-24H-N2` — one batch PR, one entry, no older entry rewritten. Window:
`2026-10-15T23:54:34Z` - `2026-10-16T23:54:34Z`. Sync source of truth: `trevorotts1/openclaw-onboarding`
`origin/main` `b16266d9dfc2d9aabcef40e1d780137350080df4` (repo tree
`7f2ae6c86c55a6e865690d562524b17b6038af98`; its `75-drama-song-ad-factory/` subtree is
`0994cb127b5317dc40b34edf6c4123a0d26a7f9d`, which live main `c0930ca6e1d9733525694a7c763fa78a56c9e7c7`
at build time still carries byte for byte).

- `scripts/core/` regenerated with `installer-registration/package_core.py`: 82 files written
  (48 canonical files this twin did not yet ship, 34 content updates), 0 removed, 501 -> 549 files,
  one tree sha256 `7c8c0d2f1b69feb35819d690555b122e2fd2a2acd23b502a71588c8638462d5a` on both sides.
  That carries the pace-order dispatch requirement (`music_qc/pace_change.py`,
  `music_qc/test_method_pace.py`, `song_dispatch/song_dispatch.py`, `song_dispatch/test_method_song.py`)
  plus the method and Agnes core batch that landed on canonical main after the previous sync pin.
- `references/` refreshed byte for byte where this twin mirrors the canonical tree: three proof
  receipts that are new since that pin (`agnes-platform-proof.md`, `agnes-proof-receipt.md`,
  `method-proof-receipt.md`) plus the updated `CLIENT-GUIDE.md` and `stage-runbook.md`.
  `agnes-path.md`, `drama-to-demand-method.md` and `QC.md` were already identical and are unchanged.
  One canonical receipt is deliberately NOT mirrored: `lipsync-cartoon-proof.md` names judge models
  six times and `tests/test_model_choice.py` fails any model pin in `references/*.md`, so carrying it
  would be a red build here while the guard itself may not be weakened. It stays canonical-side only.
- Version markers move together onto the canonical version of record: `VERSION` `2.7.57` -> `v2.9.61`,
  the `SKILL.md` frontmatter `version:` -> `v2.9.61`, and this twin gains the `skill-version.txt`
  the canonical skill carries, byte-identical at `v2.9.61`, so `QC.md`'s
  "skill-version.txt matches SKILL.md frontmatter version" line holds here as well. The three now
  agree, which is what `tests/test_parity_layout.py` ("frontmatter matches VERSION") and
  `scripts/qc-assert-skill-frontmatter-version.sh` check.
- Not synced as whole files, exactly as every earlier round recorded: this distribution's own
  `SKILL.md`, `INSTRUCTIONS.md`, `PREREQS.json` and `CHANGELOG.md` keep their Claude-Nine / Claude
  Code framing (only the canonical doc hunks and this entry were carried over), `VERSION` is this
  twin's own marker line, `adapters/`, `assets/`, `mini-app/` and `shared-bridge/` stay with their
  owners.


## [2.7.57] — 2026-10-15 — BATCH-AGN-24H-N: 24-hour batch window, member `#227` folded in

Batch bookkeeping release for repo `trevorotts1/999-setup`, head `batch/AGN-24H-N`, carrying
exactly one member pull request over the fixed 24-hour window
`2026-10-14T23:54:34.455Z` .. `2026-10-15T23:54:34.455Z`. Version `2.7.56` -> `2.7.57`, in
`VERSION` and the `SKILL.md` frontmatter `version:`, with this single entry; no older entry was
rewritten.

**Member, folded in this deliberate order** (its own head is the batch's second parent):

- **`unit/AGN-W3-twin-sync-U2`** (`#227`, head `098653d952`, 2 commits, 39 changed files) —
  vendors skills `63-agnes-image` and `64-agnes-video` as optional pinned helpers under
  `installer-registration/helpers/`, adds `installer-registration/helper-deps.py`, and repins
  `installer-registration/helpers/shared-utils/kie_prompt_gates.json` to
  `trevorotts1/openclaw-onboarding` `origin/main`. Every changed file lives under
  `installer-registration/`: this member touches no file under
  `.claude/skills/drama-song-ad-factory/`, so the merge carries zero content risk to Skill 75
  and the version bump here is batch bookkeeping, not a Skill 75 behaviour change.

Adopted without redo: `#228` (`unit/AGN-W3-twin-sync-U1`, tip commit `c7cedd6b`) was already on
`origin/main` at the window's batch start and is NOT re-merged and NOT counted as scope. Open
PR `#225` (`martin/skill71-item28-adaptation`) belongs to another program and is untouched by
this batch.

## [2.7.56] — 2026-10-14 — SWI-202: build hygiene never reaches the client (drift reports operator-only, silent)

`#226` (`unit/SWI-202`, W2-item12-U1) — the SPEC.md item-12 doctrine provision, mirrored into this
packaged twin because `references/parity-contract.md` lists **creative doctrine** and **the
enforced flow** among the items that must be identical across both distributions (its
byte-for-byte parity test covers `scripts/core/`, so this is the contract's identical-content
rule, not the re-copy rule).

`SKILL.md`, inside "Start here: the enforced flow" directly after the no-skip-gate paragraph,
now states that drift between the installed tree and its source is build hygiene and, during
a client run, the drift report is OPERATOR-ONLY and SILENT: no decision menu, no numbered
report-only / add-files / full-re-sync / type-your-own choice, no prompt that waits for an
answer, nothing about drift in the client's chat; the sync continues non-interactively on its
documented default and the drift is reported to the operator only, by named file and path.
The decision menu stays available on the explicit operator path (a named flag or an
operator-run sync outside a client run).

No code emitter exists to change in either repository: the four menu phrases ("Report only" /
"Add 5 files" / "Full re-sync" / "Type something") are absent from onboarding `origin/main`,
from this repo's `origin/main`, from the client box's `~/.claude/tools`, `~/.claude/skills`
and `~/.openclaw`, and from the installed OpenClaw package — the menu was composed at run time
by the agent. Version `2.7.55` -> `2.7.56`, in `VERSION` and the `SKILL.md` frontmatter
`version:`, with this single entry; no older entry was rewritten. `scripts/scrub-operator-chat-id.py`
does not exist in this repo (that guard is onboarding-only); it was recorded as absent, not created.

## [2.7.55] — 2026-10-14 — BATCH-SWI-N-1: count truth, intake doctrine, parity test hygiene (999)

One release batch for repo `trevorotts1/999-setup`, head `batch/SWI-N-1`, carrying three
QC-PASS member pull requests. Version `2.7.54` -> `2.7.55`, in `VERSION` and the `SKILL.md`
frontmatter `version:`, with this single entry.

**Members, merged in this deliberate order** (SWI-004 first, because SWI-007's companion
test reads the very strings SWI-004 repairs, so #222 stays red until #221 is in the tree):

- **`unit/SWI-004`** (#221, head `87f6a313e`) — count truth in the card strings: the
  `intake_card` package docstring, the `intake_card.py` argparse help and the `factory.py`
  card help derive their total from the live source, plus the 14-question companion
  assertions and the AST sweep of every help/description literal.
- **`unit/SWI-003`** (#220, head `e9bbe8648`) — intake doctrine in this `SKILL.md`:
  dramatizations, the never-ask-real rule, the client-claim carve-out, the permission rule,
  count truth and the overwork rule, plus item 9's parity exit-code documentation.
- **`unit/SWI-007`** (#222, head `fe2beb79b`) — `tests/test_parity_layout.py` resolves its
  root from the file location so the 2 real parity FAILs stay visible instead of silently
  skipping, and `test_intake_card_h9.py` gains the public `NUMBER_WORDS` / `COUNT_CLAIM` /
  `COUNT_SOURCES` companion contract with `test_no_help_or_docstring_claims_a_different_count`.

**The one conflict and how it was resolved.** `test_intake_card_h9.py` was edited by two
members at once. Both companion suites were kept: SWI-007's public helpers and its
`test_no_help_or_docstring_claims_a_different_count` survive unchanged, and SWI-004's
AST-based helpers survive renamed with an `_AST_` prefix alongside its sweep and live
`--help` count tests, with the colliding module-count test renamed
`test_module_count_equals_rendered_count_item10`. No assertion, helper or test was dropped.

## [2.7.54] — 2026-10-14 — BATCH-DSF-11: the R2-B story-brief twin re-sync (DSR-105)

One release batch for repo `trevorotts1/999-setup`, head `batch/DSF-11`, carrying **no
member PR** — its whole job is the R2-B twin re-sync. Version `2.7.53` -> `2.7.54`, in
`VERSION` and the `SKILL.md` frontmatter `version:`, with this entry, all in this one
commit.

**The sync source.** Release group R2-B is **`DSR-105`**, the studio page collecting the
story brief. It landed on onboarding `origin/main` as PR **#2003** (head
`4d730e5b45e6828ff914709604fc65797ebd93c0`, verified an ancestor of `origin/main`), carried
by batch PR **#2026** on branch `batch/DSF-10`, merged as
`82e34384042a3312c17318285c4bd71965204ec7`. That merge commit *is* `origin/main`'s head, and
it is the tree this re-sync was packaged from — read live with
`git -C ~/openclaw-onboarding archive 82e34384 …`, never from a document.

**What changed in skill 75 (why the twin drifted).** `scripts/core/choice_card/intake_card/intake_card.py`
stays the only question source and gains five typed **BRIEF** questions —
`BRIEF_IDS = ("offer", "link", "audience", "character", "photos")` — so the card asks **14**
instead of 9 (`QUESTIONS = _brief_questions() + _questions()`); `mini-app/ui/questions.json`
was regenerated from it and `mini-app/ui/studio.js` now passes the question into `answerBox`
so the textarea shape comes from the typed contract; and `mini-app/service/src/index.js`
reads the brief out of the leading replies and stores it *beside* them, marking
`brief_complete` false with `brief_missing` rather than refusing an order. `mini-app/**` is
onboarding-only and has no 999 counterpart (see `parity-contract.md` and the receipt), so
only the `scripts/core/` half of that change reaches this repo.

**What this commit does.**

| Change | Detail |
|---|---|
| Re-package the core | the repo's own `installer-registration/package_core.py --source <read-only git archive of origin/main>`: `496 files (17 written, 0 stale removed)`, `--check: OK 496 files match canonical`, tree sha256 `f4f4d68f8d075a9ab54faf612e959191f94bd91a7258564efaa5c1867b2983cd` on both sides |
| Re-copy the bridges | `drama-studio/{studio_bridge,approvals_bridge,studio_claim}.py` copied byte-for-byte from the same archive; all three were already identical, so **`studio_bridge.py` did not move** and its recorded fingerprint is untouched |
| Refresh the fingerprints | `references/twin-sync-fingerprints.json`: `unit` `DSR-202` -> `DSR-206`, `canonical` re-pinned to `82e34384` / `origin/main`, `packaged` to `d504e753a` / `batch/DSF-11`, `summary` 496/496/0/0/0, 17 `files` entries re-digested, `pre_sync_DSR206_*` added. Nothing else touched |
| Refresh the receipt | `references/twin-sync-receipt.md` gains the R2-B section below the R2-A one |

**Proof.** `DSAF_CANONICAL_CORE=<archive> python3 -I tests/twin_sync_prove.py` ->
`summary: same=496 differ=0 only-canonical=0 only-packaged=0` / `PARITY: PROVEN`, exit 0.
`tests/test_studio_bridge_twin.py` exits 0 in both modes, run from the permanent batch
worktree (never `/tmp`). `cmp` of each bridge against `origin/main`'s original -> exit 0
all three. The packaged card carries all five brief ids and `len(QUESTIONS) == 14`.

## [2.7.53] — 2026-10-13 — BATCH-DSF-9: drama-studio pair fix (#216) + the R2-A twin re-sync

One release batch for repo `trevorotts1/999-setup`, head `batch/DSF-9`, one member unit
merged with `--no-ff`. Version `2.7.52` -> `2.7.53`, in `VERSION` and the `SKILL.md`
frontmatter `version:`, with this entry, all in this one commit.

**The member:**

| PR | Unit | What it does |
|---|---|---|
| #216 | `DSR-106` | `/drama-studio pair CODE` works from the documented command (no `--studio` needed): `drama-studio/studio.py`, `drama-studio/studio_check.py`, `drama-studio/SKILL.md`, the new `drama-studio/prove/test_pair_address.py`, and the skill's own CI file `.github/workflows/drama-studio-tests.yml`. |

**The R2-A twin re-sync (this commit).** Release group R2-A ships on onboarding
`origin/batch/DSF-8` at `cdef72c46944ecf2718b28df2f67219cdaa263fc` — DSR-101..DSR-104
(#1998 #1993 #1997 #2000): enrollment at install and update, the client link hand-over,
`--register` timer installation, and the pickup handoff. Those changes all land
*outside* `scripts/core/` (`install.sh`, `update-skills.sh`, `INSTALL.md`,
`INSTRUCTIONS.md`, `SKILL.md`, `timer-artifacts/`, `shared-bridge/`), so the packaged
core was already byte-identical to that canonical cut — it was re-generated anyway with
this repo's own packager and re-proved. The one byte in this repo that moved is
`.claude/skills/drama-studio/studio_bridge.py`, the handoff fix, copied byte-for-byte
from canonical `shared-bridge/`: `b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956`
-> `4ea9f8f306d355e8b234deabe408a3bdf6419f0148215c5fb9f9cfc393b4baa5`.
`approvals_bridge.py` (`1061783b…`) and `studio_claim.py` (`b2d83671…`) are unchanged.

**Deliberately not copied.** `shared-bridge/enroll-on-install.sh` and its test
`shared-bridge/checks/test_enroll_on_install.py` stay onboarding-only, for the reason
the twin receipt already records for `wake_agent.sh`: 999 carries no `shared-bridge/`
tree (only the three Python bridges the runtime imports, behind the
`.claude/skills/drama-song-ad-factory/shared-bridge -> ../drama-studio` layout alias),
its caller is onboarding's `install.sh` / `update-skills.sh` which 999 does not ship,
and a repo-wide grep finds no 999 caller for it. The repo's packager
(`installer-registration/package_core.py`) writes `scripts/core/` only, and
`studio_bridge_twin` records packaged bridge bytes only.

**Parity on this batch head** (read-only `git archive origin/batch/DSF-8`):

- `tests/twin_sync_prove.py` -> `summary: same=495 differ=0 only-canonical=0 only-packaged=0`,
  `PARITY: PROVEN`, exit 0 (`--selftest` also `SELFTEST: PASS`).
- `tests/test_studio_bridge_twin.py` -> exit 0 in BOTH modes: with
  `DSAF_CANONICAL_SHARED_BRIDGE` set (3 × `bytes == live canonical`) and unset
  (recorded fingerprints enforced, live compare `UNDETERMINED`).
- `cmp` of the three bridges against the DSF-8 originals -> exit 0, 0, 0.

## [2.7.52] — 2026-10-13 — BATCH-DSF-6: the 999 twin re-sync after the client-folder fixes (#214)

One release batch for repo `trevorotts1/999-setup`, head `batch/DSF-6`, one member unit
merged with `--no-ff`. Version `2.7.51` -> `2.7.52`, in `VERSION` and the `SKILL.md`
frontmatter `version:`, with this entry, all in this one commit.

**The member:**

| PR | Unit | What it does |
|---|---|---|
| #214 | `DSF-521` | Re-syncs `.claude/skills/drama-song-ad-factory/scripts/core` and `.claude/skills/drama-studio/approvals_bridge.py` from onboarding `origin/main` at `37344f5cd23fc51bf2a2603ebc8c7090b9b649f0`, and refreshes `references/twin-sync-fingerprints.json` and `references/twin-sync-receipt.md`. |

**Why it was needed.** Batch DSF-5 (#213) synced skill 75 from a canonical cut taken
*before* the six client-folder fixes (`CF-1`..`CF-6`, onboarding batch #1969) landed, so
the packaged core sat behind canonical and `tests/test_studio_bridge_twin.py` was red on
`approvals_bridge.py` — `CF-6` had moved the canonical bridge after DSF-5 synced.

**What the re-sync carries.** The six client-folder fixes into skill 75's packaged core
and into the approvals bridge: 9 paths regenerated by the repo's own packager
(`installer-registration/package_core.py`), being 7 changed paths plus 2 paths 999 did
not have — `delivery_package/contract.py` (+ the new `delivery_package/test_contract_not_clean.py`),
`delivery_variants/video_delivery.py` (+ the new `delivery_variants/test_video_delivery_cleanup.py`),
`lip_sync/lip_gate/lip_process.py` and `lip_sync/lip_gate/test_lip_process.py`, and
`ready_post_kit/__init__.py`, `ready_post_kit/ready_post_kit.py`,
`ready_post_kit/test_ready_post_kit.py` — plus `.claude/skills/drama-studio/approvals_bridge.py`
copied byte-for-byte from canonical `shared-bridge/`.

**Parity on this batch head** (proven before the bump, against a read-only
`git archive` of onboarding `origin/main`):

- `tests/twin_sync_prove.py` -> `summary: same=495 differ=0 only-canonical=0 only-packaged=0`,
  `PARITY: PROVEN`, exit 0 (from `same=486 differ=7 only-canonical=2` on `origin/main`).
- `tests/test_studio_bridge_twin.py` -> `bytes == live canonical` for `approvals_bridge.py`,
  `studio_bridge.py` and `studio_claim.py`, exit 0.

## [2.7.51] — 2026-10-13 — BATCH-DSF-5: the drama-studio skill ships, and skill 75's core and bridges re-twin

One release batch for repo `trevorotts1/999-setup`, head `batch/DSF-5`, seven member
units merged with `--no-ff` (each member keeps its own named merge commit). Version
`2.7.50` -> `2.7.51`, in `VERSION` and the `SKILL.md` frontmatter `version:`, with this
entry, all in this one commit.

**The seven members:**

| PR | Unit | What it does |
|---|---|---|
| #208 | `W1-claude-skill-U1` | `.claude/skills/drama-studio/SKILL.md` becomes the "when you are invoked" procedure (bare, `link`, `link new`, `start`, `pair CODE`) with `${CLAUDE_PLUGIN_ROOT}` paths and the sibling factory root, the design material kept under a Reference heading, and `allowed-tools` gains the bridge and `factory.py`. |
| #209 | `W1-claude-skill-U2` | `studio.py` `link` prints and opens the personal link (`client.url`), `link --new` rotates it, `pair` mints one when missing, and `--print` keeps the no-browser behaviour. New `prove/test_link.py`. |
| #210 | `W1-claude-skill-U3` | `studio_check.py` keeps the option the studio sends in the hook state (so Option 2 can switch on from the studio) and adds `--order`, a fresh uncached order check. New `prove/test_check_option.py`. |
| #207 | `W1-claude-skill-U4` | `option3_runner.py` passes `real_runner` from its `check` path, so an approved Option-3 check really starts its run instead of writing an `exit_code: 0` receipt and starting nothing. New `prove/test_option3_wired.py`. |
| #206 | `W1-claude-skill-U5` | The 999 installer bundles `drama-studio` (`CONTROL/bundled-skills.txt`, `installer-registration/verify-registration.sh`) and `AGENT_INSTALL.md` gains the pairing step. |
| #212 | `W3-twin-sync-U1` | Skill 75 `scripts/core/` re-twin-synced from onboarding (493 files, 11 added, 4 changed, 0 deleted, 0 differences), with the regenerated `scripts/core/` fingerprints and the receipt, plus the `shared-bridge` -> `../drama-studio` layout alias the studio channel needs. |
| #211 | `W3-twin-sync-U2` | `.claude/skills/drama-studio/studio_bridge.py`, `approvals_bridge.py` and `studio_claim.py` copied byte-identical from onboarding `75-drama-song-ad-factory/shared-bridge/` at `origin/main`, and `prove/runtime-hook-hashes.txt` regenerated. |

**The fingerprints refresh (this commit, required by the merge).** Merging #211
moves the packaged `.claude/skills/drama-studio/studio_bridge.py` forward, so the
`studio_bridge_twin` block of `references/twin-sync-fingerprints.json` — which
W3-twin-sync-U1 deliberately left to U2 — was still pinning the older pair and would
have left `tests/test_studio_bridge_twin.py` red. Both fields of the one entry
`studio_bridge_twin.files.studio_bridge.py` were recomputed from the live trees and now
read the same digest:

- `canonical_sha256` and `packaged_sha256` = `b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956`
  (was `9dcef59746601dc7cb708835b790ae05228c0df437107e643c94930cec98597e` on both sides).

Every other entry in that file is untouched, `studio_claim.py`'s pair still matches and
needed no edit, and `approvals_bridge.py` (sha256
`f2a61598dff3b2ec013ff6977e55c3a2acf6cdd9ae3f1c5778944c88d0a90e1a`, identical on both
sides) is not part of that contract block, which still carries exactly its two files.
`references/twin-sync-receipt.md` gains the "Fingerprints refresh on the batch head"
section recording both digests, both live read commands, the proof, and the fact that
`batch/DSF-3` is now an ancestor of `origin/main`, which satisfies the re-run action the
original receipt recorded. Proven both ways on the batch head: recorded-fingerprints mode
(no canonical tree) exit 0, and with `DSAF_CANONICAL_SHARED_BRIDGE` set to a throwaway
`git archive origin/main 75-drama-song-ad-factory/shared-bridge` export, exit 0.

## [2.7.50] — 2026-10-12 — Drama Studio direct-upload bridge twin

The packaged bridge now sends file metadata and streams the returned signed PUT, with image/audio limits of 25 MB and video limits of 200 MB. It carries the canonical first-byte array, destination checks and secret-free receipt. Both bridge files are byte-identical to onboarding merged main `73fa96563dec1eb954f210c6ad383693812cfec5` (batch #1893). Six fake-transport upload tests are wired into the Drama Studio workflow.

## [2.7.49] - 2026-10-11 - HEARTBEATFIX-U1: prove_heartbeat.py was RED for a right reason and a wrong test; wire it into CI

`.claude/skills/drama-studio/prove/prove_heartbeat.py` reported `prover: 1/6 checks failed: check_install_writes` on 999 main `87f3453`, reproduced with a fresh temporary HOME (`HOME=$(mktemp -d)`) on the operator Mac Mini. The heartbeat job installer `heartbeat.py` is CORRECT; the prover was wrong, and no check was weakened to fix it.

- Root cause (the PROVER, not the installer): `prove_heartbeat.py` derived its "permanent" install-write scratch from `os.path.expanduser("~")` (`PERM_ROOT = ~/.drama-studio/prove-heartbeat`). `heartbeat.py` refuses, by design, to install a timer whose target sits inside ANY temporary root (`TEMP_DIRS` = `/tmp`, `/private/tmp`, `/var/tmp`, `/private/var/tmp`, `/var/folders`, `/private/var/folders`, plus the process `TMPDIR`): `AF-DS-HEARTBEAT refused: refusing to install a timer into a temporary path: /private/tmp/<home>/.drama-studio/prove-heartbeat/iw-live/com.blackceo.drama-studio.heartbeat.plist`, rc 2. With a temporary HOME the prover's own scratch was therefore temporary, so install refused it correctly and `check_install_writes` was red: `installed=False abs=False | dry-run wrote nothing=False | planted dry-run-writes caught=False`. Every caller runs the prover with `HOME=$(mktemp -d)` — `.github/workflows/drama-studio-tests.yml` does exactly that — so the check could never pass there.
- Fix (minimum diff, no check relaxed): `permanent()` now names a scratch BESIDE THE SKILL UNDER TEST (`<skill>/.prove-heartbeat-perm/<pid>`, chosen lazily on first use, removed in the same `finally`), and proves that choice with `heartbeat.py`'s OWN `is_temporary` — loaded once via `importlib.util` from the file under test, inert because `heartbeat.py`'s module body only defines constants and functions and its `main` is `__main__`-guarded. The prover and the guard it must satisfy now share one definition of "temporary" and cannot drift. If the skill under test is itself inside a temporary root, no permanent target exists, so the check fails CLOSED (`PlantError` -> `VACUOUS` -> exit 2) instead of passing vacuously. Nothing was weakened: `check_refuses_temp_install` still pins the temp-path refusal with its planted-bad control, every other planted-bad control is still required, and the write test still runs `install --no-load` into a scratch dir and never writes `~/Library/LaunchAgents`, the real HOME or launchd.
- Before/after, fresh temporary HOME: 999 main `87f3453` -> `prover: 1/6 checks failed: check_install_writes`, rc 2. Head -> `prover: 6/6 checks passed, every planted-bad control was caught`, rc 0. Negative control: a temporary copy of the head prover with ONLY the fix reverted (the 2.7.48 scratch root restored) -> `prover: 1/6 checks failed: check_install_writes`, rc 2.
- CI: `.github/workflows/drama-studio-tests.yml`, job `drama-studio`, now also runs `prove/prove_heartbeat.py` in the same per-prover `HOME=$(mktemp -d)` loop, and that job now runs on `macos-latest` instead of `ubuntu-latest`. `heartbeat.py`'s `install` builds a NATIVE timer and refuses every OS but darwin/win32 (`AF-DS-HEARTBEAT refused: unsupported OS for a native timer: linux`), so its two install checks cannot pass on ubuntu: measured on a NON-temporary skill copy with only `sys.platform` set to `"linux"`, the prover reports `2/6 checks failed: check_install_writes, check_refuses_temp_install`, rc 2 (`refuses-temp-install`'s planted-bad control stops being caught because the platform gate fires first). macOS is also the OS the operator canary installs the launchd job on, so it is the platform the check must run on. The job stays stdlib-only and hermetic — no apt, no pip, no network, no key, nothing installed. Repo precedent: `kaizen-tests` carries a platform-bound `windows-tests` job and `hook-skill-tests` / `spec-protocol-tests` use an `os` matrix. The comment that named the prover as deliberately excluded was corrected to say it is fixed and wired here: wiring a red check would have been worse than not wiring it, which is why CHECKIN-UA left it out, and it is wired only now that it is green.
- Same file, a SECOND defect this unit had to fix for that job to be green: the job's anti-vacuity control for `prove_user_agent.py` checked out `origin/main` as "the pre-change tree" and required the prover to be RED against it. That only held while CHECKIN-UA was an OPEN pull request; once #200 merged, `origin/main` carried the User-Agent too, the prover was GREEN against it and the job went RED on main — run `38199232601` (push, main): `prove_user_agent: 4 checks, every planted-bad control caught` then `FAIL: prove_user_agent.py is GREEN against the pre-change tree — vacuous`. A checkout of a moving branch is not a pre-change tree. The step now CONSTRUCTS one: a copy of the head with the UA constant drifted to `drama-studio-client/0.0.0-pre`, proved DIFFERENT from the head with `cmp -s` first (a no-op drift cannot pass vacuously), against which `prove_user_agent.py --skill` must exit non-zero — measured locally `rc=2`, `failed=constant,studio_pair,studio_check,studio_bridge` — and then exit 0 against this head. The job is green on the pushed head.
- `VERSION` `2.7.48` -> `2.7.49` and the `SKILL.md` frontmatter `version:` land in this ONE commit with this entry. `STUDIO_USER_AGENT` stays `drama-studio-client/2.7.48`: it is the client protocol string the studio server checks, `studio_bridge.py` must stay byte-identical with onboarding's canonical `shared-bridge/` copy, and `prove/prove_user_agent.py` pins those exact bytes — none of which this unit touches. The drama-studio skill still has no `VERSION` file and its `.claude-plugin/plugin.json` still carries no version field, so nothing is bumped there. `prove/runtime-hook-hashes.txt` is untouched: it hashes the four runtime hooks and two settings files, none of which changes.
- No onboarding paired unit, and why: `heartbeat.py` and `prove_heartbeat.py` live only in 999-setup's `.claude/skills/drama-studio/`. Onboarding main `e2f4d613` carries neither file (`find` over the whole clone: zero matches); the twin fingerprints `references/twin-sync-fingerprints.json` are scoped to `scripts/core/` (482 entries, none mentioning `heartbeat` or `drama-studio`); and onboarding's parity checks (`tests/distribution-parity-extended`, `tests/distribution-parity`) compare only the two packaged skill-75 distributions, recording distribution-unique paths UNDETERMINED, never a FAIL. So 2.7.49 is 999-only; no paired onboarding branch.

## [2.7.48] - 2026-10-11 - CHECKIN-UA: the three client scripts send the studio's one explicit User-Agent

Cloudflare in front of `https://studio.zerohumanworkforce.com` refuses Python's default User-Agent (`Python-urllib/3.x`) with HTTP 403 and the body `error code: 1010`; the same request with an explicit User-Agent gets 200. Measured read-only on 2026-10-11 (`GET /api/studio/health`, no key): bare `urllib.request.urlopen` -> `403 error code: 1010`, the same call with an explicit User-Agent -> `200 {"ok":true,"service":"drama-studio-service","version":"0.1.0"}`. A client script shipped without the header cannot pair or check in at all.

- ONE constant, `STUDIO_USER_AGENT = "drama-studio-client/2.7.48 (+https://studio.zerohumanworkforce.com)"`, now rides every urllib request this skill sends: `.claude/skills/drama-studio/studio.py` (`call_pair`), `.claude/skills/drama-studio/studio_check.py` (`fetch_checkin`, the session hook and the Option-2 watcher) and `.claude/skills/drama-studio/studio_bridge.py` (`_http`, every handshake, status, sync, upload and delivery call). A grep of both trees confirms these are the only three request sites. No other behaviour change.
- `studio.py` and `studio_check.py` carry an identical literal constant rather than importing the bridge's (an import would couple the pairing command and the session hook to the bridge's sibling `studio_claim` import, which the hook's silent-on-error contract must not depend on). The new prover asserts all three strings are equal, so it is still exactly one value.
- `studio_bridge.py` stays byte-identical with its canonical home, onboarding `75-drama-song-ad-factory/shared-bridge/studio_bridge.py` (sha256 `d190f092acfa2c3b400dde2711ef6130917a7ac47d0c4fd9f0076084fa6a6ee4` on both sides, canonical branch head `93f84e0e15a5a90328e9112968f2e8eed7e4e15c`). `references/twin-sync-fingerprints.json` `studio_bridge_twin` records the new hashes and the new canonical base, and `references/studio-bridge-twin-receipt.md` gains the CHECKIN-UA addendum. `tests/test_studio_bridge_twin.py` enforces the record unchanged.
- New `prove/prove_user_agent.py` (stdlib only, localhost only): a fake studio on `127.0.0.1` answers 403 `error code: 1010` to any request whose User-Agent is absent or starts with `Python-urllib`, and 200 JSON to a request carrying the one expected string. It drives the REAL request function of each of the three scripts at it and requires both the 200 and the exact string, each check paired with a planted-bad copy (header removed, or constant drifted) that must be caught. It takes `--skill <dir>`: RED against a pre-change copy of the skill (`AF-DS-UA-PROVE: failed=constant,studio_pair,studio_check,studio_bridge`, rc 2), GREEN on this head (4 checks, every planted-bad control caught, rc 0). It reaches no live host, sends no key and writes no state.
- CI: a NEW file `.github/workflows/drama-studio-tests.yml` (job `drama-studio`, triggered on `.claude/skills/drama-studio/**` and on the workflow file itself) runs THREE existing drama-studio provers (`prove/prove_plugin_behaviour.py`, `prove/prove_option2_monitor.py`, `prove/prove_option3_runner.py`) plus the new `prove/prove_user_agent.py`. `prove/prove_heartbeat.py` is EXCLUDED from that loop on this head because it is RED here (`1/6 checks failed: check_install_writes`); it is fixed and wired in 2.7.49. (Corrected in 2.7.49: this line first named `drama-song-tests.yml` and a `drama-studio-provers` job, which was never true — no job was added to `drama-song-tests.yml` and no `drama-studio-provers` job exists.) No workflow ran those provers before.
- Version `2.7.47` -> `2.7.48` and the `SKILL.md` frontmatter `version:` land in this ONE commit with this entry. The drama-studio skill still has no `VERSION` file and its `.claude-plugin/plugin.json` still carries no version field. `prove/runtime-hook-hashes.txt` is untouched: it hashes the four runtime hooks and two settings files, none of which this unit changes.

## [2.7.47] - 2026-10-11 - U19-BRIDGE: ship the Option-3 studio bridge (and its claim sibling) into the drama-studio skill root

`.claude/skills/drama-studio/option3_runner.py` was merged naming `<skill root>/studio_bridge.py` in its scoped command, but 999-setup main carried no `studio_bridge.py` under `.claude/skills/drama-studio/`, and with `CLAUDE_PLUGIN_ROOT` / `DRAMA_STUDIO_SKILL_ROOT` unset the skill root is that folder. Every Option 3 run therefore named a bridge file that did not exist. This unit ships the bridge in ONE commit, the same way U18/TWIN-R3 syncs the core: copy from the canonical source, never hand-edit.

- Canonical revision pinned: `openclaw-onboarding` main `1dc33aa720f8138ca21d5e14f60198f3b6466f3b`, synced from a read-only clone of exactly that revision.
- Added `.claude/skills/drama-studio/studio_bridge.py` (sha256 `737c6898e2dfdd14c172da82488558fa5cbe1d3c543504613fd5291fc6a903d7`) and `.claude/skills/drama-studio/studio_claim.py` (sha256 `b2d8367116552b906f7d1c14ee1f4d884b6a03b1434a44517686cb237bccbb42`), both byte-identical to onboarding `75-drama-song-ad-factory/shared-bridge/`. `studio_claim.py` is copied because `studio_bridge.py` imports it as a sibling; the bridge cannot import without it.
- Recorded in the twin parity fingerprints: `references/twin-sync-fingerprints.json` gains a `studio_bridge_twin` block (canonical repo/tree/base_sha, per-file sha256 on both sides). The human-readable receipt is `references/studio-bridge-twin-receipt.md`.
- New `tests/test_studio_bridge_twin.py` (run by the drama-song-tests `pytest "$SKILL/tests"` step) enforces the record: packaged sha256 == recorded canonical on every run, plus a live byte compare against the canonical tree when it is present (`DSAF_CANONICAL_SHARED_BRIDGE`, else `<build>/onboarding/75-drama-song-ad-factory/shared-bridge`); a set-but-missing canonical path is a resolve failure, never a silent pass. Negative controls: planted drift red, missing canonical dir red, live onboarding clone green.
- `prove/prove_option3_runner.py` gains a `bridge_present` check with its own planted-bad control (8 -> 9 checks, every planted-bad control caught, rc 0). A temp skill copy with `studio_bridge.py` removed makes the prover go RED (`failed=bridge_present`, rc 2).
- Version `2.7.45` -> `2.7.47` (open PR #195 claims `2.7.46`), `SKILL.md` frontmatter `version:` bumped in the same commit. The drama-studio skill has no `VERSION` file and its plugin manifest carries no version field, so nothing is bumped there. No onboarding paired unit: onboarding is the canonical side of this copy and its parity suite records distribution-unique paths as UNDETERMINED, never a FAIL.


## [2.7.46] - 2026-10-11 - OB-KIE-2: kie-rate-limit.md records the recordInfo and discovery limits

Joint-plan OB-KIE-2 (line 1066) paired change. The twin `references/kie-rate-limit.md`
is byte-identical to the onboarding skill 75 file in the same unit.

- `references/kie-rate-limit.md` now states all three KIE per-key limits with a
  per-number source: `createTask` 20 per 10 seconds per account (KIE docs "Rate
  Limit"), `recordInfo` **10 per second per task**, and discovery (`models`,
  `schema`, `price`, `success-rate`) **1 per second shared**. Both new numbers come
  from KIE's `kie-models` "Rate limits" section (fetched 2026-10-09), itself recorded
  in this repo at `installer-registration/helpers/07-kie-setup/references/kie-official-agent-docs-digest.md`
  rule 9 and `.../kie-common-rules.md` rule 3. No number was invented.
- Byte-identity proved: sha256 `e15a7592e5dff36bb032519c5f25decd7cc54628d3c0edca392cf4dd814df3aa`
  on both sides (`cmp` clean).
- `VERSION` 2.7.45 -> 2.7.46 and the `SKILL.md` frontmatter `version:` land in this
  ONE commit with this entry (no bump-only commit). No file under `scripts/core/` was
  touched, so cross-distribution core parity is unchanged.

## [2.7.45] - 2026-10-11 - TWINR3-U1: round-3 twin re-sync (packaged scripts/core + round-3 data files, skill 68 re-pinned)

Round 3 of the onboarding wave (#1858 WWR3INT2 / WW-21 five bound delivered-audio results, #1863 WWB-U1, #1865 WW29 + WWC-U1) never reached the 999 twin. This unit re-syncs it in ONE commit, the same way U18 (#187) did: regenerate the packaged copy from the canonical source, never hand-edit it.

- Canonical revision pinned: `openclaw-onboarding` main `4179b542db4020260d1857d1e0175a7d6344c105` (skill 75 v2.9.32, root v27.1.11), synced from a read-only clone of exactly that revision.
- `scripts/core/` regenerated with the repo's own tool (`installer-registration/package_core.py`): **45 files changed, 11 files added, 0 deleted**; all **482** in-scope paths are now byte-identical on both sides (packaged tree sha256 == canonical == `f069a2a767ec7a1b4b24cc487eb423447578d18488aef745b86c1c3f994c3703`), proved by `tests/twin_sync_prove.py` (`PARITY: PROVEN`).
- New canonical modules land for the first time: `story_coverage/` (`story_coverage.py` + the two WW-22 markup/lexical-timeline tests), `music_qc/pace_change.py`, `music_qc/rap_check.py` (+ its WWFIX-U1 acceptance test), `song_choices/overlap.py`, `song_dispatch/test_song_dispatch_ww_u1.py` and `test_music_createtask_ww30.py`. The WW-21 fail-closed acceptance boundary (`song_dispatch.accept_audio_results`, `AUDIO_RESULTS == ("D1","D2","D3","D4","D5")`) and the WW-30 createTask retirement now ship in the packaged core.
- Round-3 non-core data files the twin carries at the same relative path are synced byte-for-byte too (12 files): `references/prompt-templates/models/suno-v6.json`, the six `references/prompt-templates/fixtures/suno-sheets/*.json`, the three `references/prompt-templates/music/*.json`, `references/choice-card-spec.md` and `references/stage-runbook.md`.
- Round-3 per-repo documents the twin owns are NOT synced as whole files and are named here: `CHANGELOG.md` and `PREREQS.json` (plus onboarding-only `skill-version.txt` and `mini-app/**`, which have no 999 counterpart). No twin `skill-version.txt` was invented; the parity contract lets per-repo docs and version files differ.
- **Two new canonical core tests are layout- and wrapper-doc-dependent, and both are green here.** `scripts/core/test_music_createtask_ww30.py` (`WW30-4a`/`WW30-4b`) dispatches skill 68's validator at `<core>/../../../68-kie-audio/scripts/validate_audio_request.py` -- the INSTALLED skills-root layout -- so this repo now carries `.claude/skills/68-kie-audio -> ../../installer-registration/helpers/68-kie-audio`, the same alias the repo already keeps at its root, pointing at the pinned re-vendored helper. `scripts/core/music_qc/test_wwfix_u1.py` `WW29-U1` asserts the reconciled direction in `SKILL.md` and `INSTRUCTIONS.md`; those are 999-owned wrapper docs, so the round-3 doc hunks the synced core implements were applied to them (recipe rule 2: the vocalise is OPTIONAL, never a forced lead-in; `suno_recipe.style_text`/`music_block`/`model_block` replaces the retired `prompt_templates.suno_parts` wording; the story-first audio acceptance section with the WW-29 reconciled direction and the WW-21 FIVE-gate delivered-audio boundary; `negative_tags` transmission; `STYLE_TOO_LONG`). No file under `scripts/core/` was hand-edited.
- Skill 68 helper re-pinned through the existing pin tool (`installer-registration/helper-deps.py repin`) after re-vendoring from the same canonical revision: `68-kie-audio` **v2.3.1 -> v2.3.2**, treeSha256 `1e1ff5aa…` -> `254fe9a4…`, 21 files, 244041 -> 248956 bytes (the WW-30 createTask retirement). The other six helpers are byte-identical to their existing pins and were retained unchanged; `installer-registration/check-helper-pins.py` now exits 0.
- Same-scope fingerprints for every in-scope path on both sides, plus the synced round-3 data files, are recorded in `references/twin-sync-fingerprints.json`; the human-readable receipt is `references/twin-sync-receipt.md`.

## [2.7.44] - 2026-10-11 - U14: the Drama Studio Option-2 watcher (skill-local permissions only)

The `drama-studio` skills-folder plugin gains its Option-2 monitor. The code, this CHANGELOG entry and the `VERSION` bump land in one commit (no bump-only commit). Because end-to-end production is still gated on the runnable U18 bridge, the monitor is proven in isolation against the check-in contract.

- New `.claude/skills/drama-studio/monitors/monitors.json`: one monitor `drama-studio-option2`, armed `when: always`, running `"${CLAUDE_PLUGIN_ROOT}"/studio_check.py --watch --every 120`. The host delivers each stdout line to the model as a task event. No `monitors` key is added to `.claude-plugin/plugin.json` — the default `monitors/monitors.json` at the plugin root is loaded.
- `.claude/skills/drama-studio/studio_check.py`: `--watch` is now the Option-2 watcher. **Option handling** — the option resolves flag -> `DRAMA_STUDIO_OPTION` -> state -> default, and Option 1 (wait) is the default, so anything but Option 2 stays silent and spends no network call. **Deduplication** — one line per order, via `watch_announced` in `~/.drama-studio/state.json`. **Claimed state** — an order that leaves the waiting line, or is recorded with the new `studio_check.py --claim <id>`, is marked `watch_claimed` and never announced again by a later watcher. **Interactive fallback** — when the host declares it does not honour the skill's allowed-tools (`DRAMA_STUDIO_SKILL_LOCAL_PERMS`, or `skill_local_perms` in state), the watcher stops with the interactive-approval / Monitor-tool line; it never fabricates a settings exception. `--hook` and `--desktop` are unchanged.
- Permissions stay **skill-local only** (the two `Bash(...)` entries in the plugin's `allowed-tools`); no `option2-settings.json` exists anywhere, and neither studio script writes a settings file.
- New test `.claude/skills/drama-studio/prove/prove_option2_monitor.py` — six checks, each with a planted-bad control. It takes `--skill <dir>`, so the same checks run against a pre-change copy of the skill and there FAIL (option, dedup, claimed, fallback and the monitor manifest do not exist yet) and against this skill PASS.
## [2.7.44] - 2026-10-11 - U18: final core twin sync - packaged scripts/core regenerated from the canonical onboarding core

U18 brings the packaged copy into byte-for-byte agreement with the frozen, reviewed canonical core (`openclaw-onboarding` `75-drama-song-ad-factory/scripts/core/` at base `68f686350e8f8f4f513333c159a4cbb6b9825dd5`), exactly as `references/parity-contract.md` requires: the copy is regenerated from the canonical source, never hand-edited.

- Eleven `scripts/core/` paths changed; the other 460 in-scope paths were already identical and are untouched. All 471 in-scope paths are now byte-identical on both sides, proved by `tests/twin_sync_prove.py` (`PARITY: PROVEN`).
- Brought in from the canonical core: the U1 studio-shaped intake export (`choice_card/intake_card/intake_card.py`, now re-exporting `studio_json`, `studio_questions`, `StudioExportError` through the package `__init__.py`, plus `test_studio_json_u1.py`), the U11 channel-neutral send path (`choice_card/intake_card/channel_send.py`, `README-channel-send.md`, `test_channel_send_u11.py`), and the plan 3.17 dual-presence hybrid validator (`style_bibles/hybrid/hybrid_bible.py`, its `__init__.py`, `test_hybrid_dual_presence.py`).
- Same-scope fingerprints for every in-scope path on both sides (`__pycache__`/`*.pyc` excluded, no other normalisation) are recorded in `references/twin-sync-fingerprints.json`; the human-readable receipt is `references/twin-sync-receipt.md`.
- Reported consequence (`references/twin-sync-receipt.md`, "Known canonical gap"): the canonical core does not yet carry the N99-CB refuse-before-write fix released in 2.7.43, so regenerating the copy removes that hand-edit from the packaged tree. The fix is preserved in 999 history at `ebb90a4ad`; its correct home is the canonical onboarding core, which needs a separate port unit before it ships again.
## [2.7.44] - 2026-10-11 - U16: the Option-3 runner, shipped OFF

The Claude Code / claude-nine half of Drama Studio gains its **Option-3 runner** —
the background scheduled run that starts a run with nobody present. It ships **OFF**:
`check` exits 0 silently and does nothing at all — no order lookup, no lock, no child
process, no spend — until Trevor has approved **that one client by name** and the
studio admin page has recorded it in this computer's protected state.

- **Named approval.** The runner reads `<state>/option3-approval.json` and needs a
  non-empty client name, who approved it, the date, `background: true`, a positive
  `cap_usd` and an absolute `run_root`. Anything else is refused `AF-DS-OPT3-APPROVAL`
  and nothing starts. The runner never writes that record: the admin page owns it.
- **Scoped command.** One fixed argv, exactly as JOINT PLAN 3.10 states it: the
  launcher, `-p` with the order prompt, `--permission-mode dontAsk`,
  `--permission-prompts none`, `--allowedTools` with exactly two script rules
  (`Bash(python3 <skills>/drama-song-ad-factory/scripts/core/intake_preflight/factory.py *)`
  and `Bash(python3 <skills>/drama-studio/studio_bridge.py *)`) plus `Read`,
  `--max-budget-usd <cap>`, `--output-format json` and `--name drama-studio-<id>`.
  The bare flag and the bypass permission mode are structurally impossible:
  `assert_scoped` rejects them on every build.
- **Lock.** One run at a time under `<state>/option3.lock.json`; a second `check`
  while the lock is fresh does nothing, and a lock older than six hours is reclaimed
  so a killed run cannot wedge the job forever.
- **Cap.** `--max-budget-usd` comes from the approval record. There is **no default
  cap**: a record without a positive number is refused `AF-DS-OPT3-CAP`.
- **Log receipt.** Every run writes its raw log and one JSON receipt under
  `<state>/option3-runs/`. The receipt carries the client, the order, the exit code,
  the cap, the launcher, the selected root, the allowed tools and the command's
  sha256 — never the machine key and never the child environment.
- **Selected-root child environment.** The child runs with its working directory set
  to the approved `run_root` and with `DRAMA_STUDIO_SELECTED_ROOT`,
  `DRAMA_STUDIO_STATE`, `DRAMA_STUDIO_SKILL_ROOT` and `CLAUDE_PLUGIN_ROOT` exported.
  `CLAUDE_CONFIG_DIR` is dropped, so claude-nine reuses the same Claude config root
  as plain claude (999-setup rule 10).
- **Nothing activates it.** The runner installs no job, loads no job and writes no
  approval. `print-job` prints the launchd plist as text and touches nothing.
- **Proven in isolation.** `python3 prove/prove_option3_runner.py` runs **8 checks**,
  each paired with a planted-bad copy of the module carrying exactly that one defect
  that the check must catch (exit 2 if a planted copy stays green). Production
  end-to-end is still gated on the runnable U18 bridge, so no run is attempted here.
## [2.7.44] - 2026-10-11 - U15: Drama Studio heartbeat job (launchd / Task Scheduler) — requested notice only, absolute paths, never starts Claude

The Drama Studio plugin gains its heartbeat: a native timer that runs `.claude/skills/drama-studio/studio_check.py --desktop` on an interval. This is the 999-setup unit U15 of the joint plan (row 1081), the consumer of the U13 hand-off (PR #183).

- New `.claude/skills/drama-studio/heartbeat.py`: `install` / `uninstall` / `status` / `beat` plus `print-plist` and `print-task-xml`. Native timer patterns only — a macOS LaunchAgent plist (`StartInterval`, `ProgramArguments`, `RunAtLoad` false) and a Windows Task Scheduler XML (`TimeTrigger` repetition `PTnM`, `Exec`). `--dry-run` writes nothing; `--no-load` writes the timer without loading it.
- Absolute paths throughout: the timer's `ProgramArguments` / `Exec` name the absolute interpreter and the absolute `studio_check.py`; a relative path or a bare program name is refused (`AF-DS-HEARTBEAT`). launchd and Task Scheduler run with no PATH and no working directory, so this is required, not cosmetic.
- Requested desktop notice only: the heartbeat emits nothing itself. It runs `studio_check.py --desktop`, which stays silent unless the client opted in, so an unsolicited notice is impossible on this path.
- Never starts Claude: no code path launches, execs or spawns a Claude process. The timer runs exactly two things — the interpreter and `studio_check.py` — and `beat` refuses any program whose name starts with `claude`.
- New runnable proof `.claude/skills/drama-studio/prove/prove_heartbeat.py` (exit 0 pass / 2 fail-or-vacuous / 3 cannot run). Five checks, each proven on the real script and on a planted-bad copy: native timer, absolute paths, requested-only, never-starts-Claude (a live PATH trap of fake `claude` launchers over every subcommand, plus a source scan for spawn/exec of a claude binary), and install-writes. It installs nothing live: no `launchctl` / `schtasks`, with the sink and timer dirs under `/tmp`.
- Version markers: this `VERSION` + SKILL.md frontmatter 2.7.43 -> 2.7.44.

## [2.7.43] - 2026-10-10 - N99-CB: character bible refuses BEFORE any write on a missing reference picture

The 2.7.41 sentence ("a missing reference picture is a refusal, never an empty directory") was false in code: `character_bible.write_delivery` rendered the PDF and created `02 - Character Bible Images/` before raising `NO_REFERENCE_IMAGES`, leaving both contract artifacts behind on a refusal.

- `write_delivery` now computes the full ship plan (every shippable reference file, existence and non-zero size checked) BEFORE creating the delivery directory, rendering the PDF, or creating the images directory. No shippable picture raises `NO_REFERENCE_IMAGES` with a completely untouched filesystem.
- New tests in `scripts/core/character_bible/test_character_bible_del02.py` (`RefuseBeforeAnyWrite`): three planted missing-reference cases (no pictures, only broken paths, zero-byte file) each assert the exception AND that no PDF and no images directory exist; a clean case still delivers both contract files.
- Version markers: this `VERSION` + SKILL.md frontmatter 2.7.42 -> 2.7.43.

## [2.7.42] - 2026-10-10 - KIE batch train (KIE-U1..U5): two-root adapter docs, kie front-door skill, client-owned KIE key

Released with the 999 KIE batch PR (units KIE-U1 #173, KIE-U2 #171, KIE-U3 #170, KIE-U4 #174, KIE-U5 #172), paired with openclaw-onboarding #1809 (unit KIE-U0, ported KIE official agent docs: 07 v7.2.0, 74 v1.1.6, 66 v2.2.2, 68 v2.3.1).

- KIE-U4 (U4-a..U4-g): new `.claude/skills/kie/SKILL.md` front-door skill plus `tests/test_front_door_docs.py` (40 required doc elements, both adapter READMEs, negative controls green); the two drama-factory adapter READMEs (`adapters/claude-code/README.md`, `adapters/claude-nine/README.md`) now state both config roots and drop the old single-shared-root claim.
- KIE-U4 test halves: `tests/test_launcher_plain_claude.py` and `tests/test_single_config_root.py` updated for the same two-root contract.
- This bump is the skill-75 release for that batch train. Version markers: this `VERSION` + SKILL.md frontmatter 2.7.41 -> 2.7.42.


## [2.7.41] - 2026-10-10 - PKG-11 attempt 4: twelve REAL produce_delivery paths, real-run e2e (pairs with openclaw-onboarding v27.1.1, skill 75 v2.9.18)

Released with onboarding v27.1.1 (follow-up to the v2.7.39 batch; closes the delivery package naming gap flagged there).

- ONE naming scheme, `NN - Label.ext`, defined in `scripts/core/delivery_package/contract.py`. All 12 producers' deliver paths emit the `contract.PACKAGE_ITEMS` names. Attempt 2 failed because only 5 of 12 did and the adapters wrote fixture bytes.
- `produce_delivery` adapters call each producer's real deliver path (no fixture bytes).
- `test_delivery_package_e2e` runs the REAL producers into a folder and passes `contract.verify_folder` for all 12 items, plus a negative control.
- Shared files (scripts/core, references) byte-identical with the onboarding batch (diff -rq empty). The onboarding wording scrub touches onboarding-only files (two_strike module, skills 47/53/54/71); nothing to change here.
- Every `produce_delivery(run_dir, item)` adapter (all twelve) now calls THAT producer's own real deliver path on the contents of `run_dir`: `build_audio_versions` + `write_version_docs` (DEL-01), `character_bible.write_delivery` (DEL-02), `script_pdf.render` (DEL-03), `storyboard_grid.deliver` (DEL-04), `build_video_delivery` + `write_video_docs` (DEL-05), `deliver_clips` (DEL-06), `ready_post_kit.prepare` + `write_kit` (DEL-07), `build_cover` + `write_cover_docs` (DEL-08), `lyric_sheet.write_delivery` (DEL-09), `export_captions_srt` (DEL-10), `copy_character_images` (DEL-11), `welcome_sheet.build_welcome_sheet` (DEL-12). New `scripts/core/delivery_package/run_inputs.py` is the ONE place that says where each producer's real inputs live in a run (approved script and approval record, approved storyboard records and stills, character brief and records, `music/` audio and `music/word-timings.json`, `edit/ad.mp4` + `edit/timeline.json`, card answers) and how a deliver path's output is handed back to the packaging call (`stage`, fail closed when a file never landed). No adapter imports `contract.produce_item` and no deliver path writes fixture bytes (`PDF_BYTES`, `SRT_TEXT`, `NOTE_BYTES`, `MEDIA_BYTES`, `PNG_BYTES`): `produce_item` remains only as the clearly named test-fixture helper behind `write_reference_package`.
- DEL-02 now ships BOTH of its contract files through its own real path: `write_delivery` renders `02 - Character Bible.pdf` and copies the run's reference pictures into `02 - Character Bible Images/` (one file per view, a copy never a re-encode). No reference picture in the run is a refusal (`NO_REFERENCE_IMAGES`), never an empty directory.
- `test_delivery_package_e2e.py` BUILDS a non-empty run folder with the real producer inputs (media through ffmpeg, records as JSON), runs `package_run` over it and proves `contract.verify_folder` reports all twelve items present with zero missing and every file opening -- with no skip anywhere. The negative control removes one REAL produced item from a copy of that package and `verify_folder` must fail naming exactly it. A second packaging run runs with `contract.produce_item` replaced by a raiser: all twelve adapters still produce every item from the run, and no produced file carries fixture bytes.
- Shared docs state the one scheme everywhere they name a delivery file (`QC.md`, `references/stage-runbook.md`, `references/character-bible.md`, `references/choice-card-spec.md`), byte-identical with the onboarding copy: `01 - Instrumental.mp3`, `01 - Voice Only.mp3`, `01 - About These Audio Files.txt`, `02 - Character Bible.pdf` + `02 - Character Bible Images/`, `04 - Storyboard.pdf`, `05 - Video Captioned.mp4` / `05 - Video Clean.mp4`, `06 - Clip 60s.mp4` / `06 - Clip 90s.mp4`, `08 - Cover Thumbnail.png`.
- Proof: `python3 scripts/core/delivery_package/test_delivery_package_e2e.py` runs 9 tests green (real run, no skip); the skill 75 tree in ONE pytest process is green with no new skip; the per-file empty-`HOME` loop is green. Version markers: this `VERSION` + SKILL.md frontmatter land at 2.7.41 on this follow-up batch (its own train, paired with onboarding skill 75 v2.9.18). Shared files stay byte-identical with openclaw-onboarding.

## [2.7.39] - 2026-10-09 - Batch PKG roll-up (pairs with openclaw-onboarding v27.1.0, skill 75 v2.9.15)

Released as one batch. Units: FU-DEL-01 three audio versions and note (#165); FU-DEL-02 character bible PDF and image bible (#163); FU-DEL-03 script PDF (#162); FU-DEL-04 storyboard grid PDF (#157); FU-DEL-05 video twice, captioned and clean (#160); FU-DEL-06 60 and 90 second clips (#164); FU-DEL-07 ready-to-post kit (#161); FU-DEL-08 cover image (#159); FU-DEL-09 lyric sheet PDF (#154); FU-DEL-10 caption file (#155); FU-DEL-11 character images (#153); FU-DEL-12 welcome sheet and package list (#156); FU-DEL-13 delivery folder contract and the 12-item hard gate (#158); FU-DEL-14-U2 no-blur-fill refusal gates (#166); unit/PKG-05-U1 full height by crop-in; unit/PKG-07-U1 camera vocabulary data file (byte-identical with onboarding).

Twin sync (same method as 2.7.38): scripts/core and the shared references (CLIENT-GUIDE.md, choice-card-spec.md, price-menu.md) copied byte for byte from the onboarding batch so the two distributions carry zero drift. That brings in the shared code of onboarding units that have no 999 branch: PKG-05-U3 (core/no_blur_fill and the no_blur_fill check in qc_gate.py) and PKG-06 (catalog_calculator storyboard picture budget with storyboard-config.json, price and choice card wording). The 999 docs half of PKG-05-U3 (unit/PKG-10-U1: the "No blur fill" sections in SKILL.md and QC.md, byte-identical with the onboarding copy) is included in this batch; the 999 test halves of those units are not.

## [2.7.39] - 2026-10-09 - FU-DEL-11: character images as separate full-resolution delivery files

- New `scripts/core/character_images/` package: every character picture reaches the delivery folder as its OWN full-resolution file (`11-character-<slug>-<view>.<ext>` — close-up, side profile, three-quarter, full standing), byte-for-byte `shutil.copyfile` from an existing `character_library` record. No generation, no crop, no resize, no re-encode, no contact sheet; the page screenshots are untouched.
- View selection, in order of trust: an explicit `views` mapping on the record, else the whole view words in the reference file's own name (`close-up.png`, `side.png`, `three-quarter.png`, `standing.png`, `lipsync-closeup.png`). One file never claims two views.
- Fail closed: a missing view names exactly the missing views and leaves the delivery folder untouched (the whole plan is computed before any write); the same for NO_CHARACTERS, SOURCE_MISSING, BAD_IMAGE and DUPLICATE_SLUG. Receipt rows carry source basename + bytes, never an absolute path.
- New `test_character_images_del11.py` (14 unit tests). `scripts/core/character_images/` is byte-identical to the openclaw-onboarding copy (skill 75 v2.9.14).

## [2.7.39] - 2026-10-09 - FU-DEL-09: the lyric sheet PDF

- New `scripts/core/lyric_sheet/`: the run's approved `creative/script.json` rendered into the delivery folder as `09 - Lyric Sheet.pdf`. Section headings come from the song's own tags — one break per block, in song order — the approved title and lines print verbatim, and nothing on the page is under 12 pt. Bright page: white paper, near-black ink, gold eyebrow and rule, a footer on every page.
- Stdlib-only PDF writer (this core is stdlib-only), deterministic bytes: no date and no random id, so the same approved sheet renders identical every run.
- Refuses fail-closed: `MONEY_ON_PAGE` (chrome wording), `TOOL_NAME_ON_PAGE` (a tool or model name reaching the page), `SCRIPT_MISSING` / `SCRIPT_UNREADABLE` / `EMPTY_SHEET`. A lyrics-only run reuses `lyric_writer.lyric_structure.parse_sheet`, so both approved inputs give the same section structure.
- Page law: `c.need(74.0)` before each heading keeps the section header and its first line up together, so a page break never lands between a section heading and its body and no heading is orphaned at the foot of a page. Section order, heading sequence and the 12 pt floor are held by the 17 unit tests in `test_lyric_sheet.py`.
- Shared core stays byte-identical to the OpenClaw copy (`tests/test_parity_layout.py`, tree sha256 match). VERSION and SKILL.md frontmatter: 2.7.39.

## [2.7.39] - 2026-10-09 - DEL-10: caption file (.srt) in the delivery folder

- New `delivery_variants/caption_srt.py`: a finished run exports its caption file into the delivery folder as `10 - Captions.srt` (slot `FILE_NUMBER`, one constant to renumber), built from the measured caption cues by `captions_burn.build_srt` — the same builder the caption burn uses, so the exported file and the burned captions cannot drift. No measured cues is a refusal receipt and NO file (F18: no clock is ever invented); the text is parsed back before it is written, so what lands is valid SRT by construction. `check_captions_srt` / `python3 scripts/core/delivery_variants/caption_srt.py check <dir>` fails a missing, empty or broken file (exit 5). `delivery_variants` exports `export_captions_srt` / `check_captions_srt` / `parse_srt` / `srt_file_name`. Test: `scripts/core/delivery_variants/test_caption_srt_del10.py` (22 tests over fixture `fixtures/caption_srt_del10.json`: generic sample sheet, measured word timings, golden SRT bytes; structure re-checked by the test's own parser). Docs: `references/stage-runbook.md` + the QC.md checklist. Version: onboarding `skill-version.txt` + SKILL.md frontmatter v2.9.13 -> v2.9.14 (G3 gates a skill-content change on that bump); the 999 copy bumps its own VERSION train 2.7.38 -> 2.7.39 with its SKILL.md frontmatter (its CI has no such gate, but its parity-contract re-sync procedure requires the bump).

## [2.7.39] - 2026-10-09 - DEL-12 one-page welcome sheet + the canonical 12-item package list

- `scripts/core/delivery_package/package_items.py`: `PACKAGE_ITEMS` / `PACKAGE_FILES` -- the canonical numbered file-name list for all 12 package items (01..12), ONE shared constant. Every file name is exact, carries its own item number and is unique; `delivery_checklist` re-exports it and gains `missing_package_files(delivery_dir)`, so the delivery gate and the printed page read one list instead of two.
- `scripts/core/delivery_package/welcome_sheet.py`: the one-page client WELCOME SHEET PDF built from that constant -- stdlib PDF 1.4 writer, base-14 Helvetica, US Letter single page, deterministic bytes, 13 pt body type, hard 12 pt floor (`MIN_PDF_POINT_SIZE`), title, gold rule, then every file with its number badge and one sentence on what it is for.
- New `scripts/core/delivery_package/test_welcome_sheet_del12.py` (11 tests): one page, all 20 file names and all 12 numbers present, no type below 12 pt, no client/model/tool name, no price or income claim, byte-identical rebuild, checklist shares the same objects.
- Shared `delivery_package/` and `delivery_checklist/` content byte-identical to the openclaw-onboarding twin (v2.9.14), verified with cmp. Version bump per repo convention: VERSION 2.7.38 -> 2.7.39 with the matching SKILL.md frontmatter stamp (`tests/test_parity_layout.py` asserts it).

## [2.7.39] - 2026-10-09 - DEL-04: the storyboard delivered as one grid PDF

- New `scripts/core/storyboard_grid/`: the approved storyboard becomes `04-storyboard.pdf` in the run's delivery folder — a page grid of the scene pictures, each captioned with shot number and timecode, the lyric line it plays over and what happens, in song order. Built only from the run's approval records (`storyboard/gate.json`, `contracts.json`, `stills.json`, `shot-list.json`); a run never approved refuses `STORYBOARD_NOT_APPROVED`.
- New `scripts/core/pdf_kit/`: the shared stdlib PDF writer every DEL document composes with — base-14 Helvetica with real AFM widths, PNG alpha composited onto white, JPEG embedded unchanged, and a **12 pt floor that refuses `FONT_TOO_SMALL`** rather than drawing small.
- `forbidden_text()` refuses a model/tool name, a dollar amount or an income promise before a byte is written (`CLIENT_TEXT_FORBIDDEN`).
- `references/stage-runbook.md` and `QC.md` carry the wiring. Shared `scripts/` and `references/` files are byte-identical to the onboarding copy (verified with `cmp`). VERSION and SKILL.md frontmatter: 2.7.38 to 2.7.39.

## [2.7.39] - 2026-10-09 - FU-DEL-13 delivery folder contract (Q12 gate)

- `scripts/core/delivery_package/`: the client delivery folder contract -- 12 numbered package items, exact file names, and what "opens" means per kind (PDF header, SRT cue block, non-empty media, image directory). `packaging.package_run(run_dir, out_dir)` is the one packaging call: it discovers each item's `produce_delivery()` component, writes the canonical numbered files, and verifies the folder. Fail closed: `COMPONENT_MISSING` (naming every item still owed, before any write), `COMPONENT_FAILED`, `PACKAGE_INCOMPLETE`.
- `delivery_checklist` gains Q12 `PACKAGE_COMPLETE` (`CHECKLIST_PACKAGE_INCOMPLETE`): the receipt names the delivery folder and Q12 reads it -- all 12 items present and opening, one missing item fails the run and is named. The gate is hard; the 11 human checklist questions are unchanged.
- New `test_delivery_package_e2e.py`: a run through the packaging entry point. (Its behavior moved with DEL-13's producers: at 2.7.41 the test builds a non-empty run and runs the twelve real deliver paths with no skip -- see the 2.7.41 entry.) A raising producer or a folder that does not verify still fails. `QC.md` records the package-items line.
- Shared core byte-identical to the onboarding copy (v2.9.14).

## [2.7.39] - 2026-10-09 - DEL-08: one cover image (thumbnail) per delivery folder

- New `scripts/core/delivery_variants/cover_image.py`: at the end of the run, build the ONE cover image into the delivery folder — frame from the approved storyboard stills (`storyboard/stills.json`, gated by `approval_runner.gate_open`, face-visible shot first), title from the approved script (`creative/script.json`, brief title as fallback, never invented). One ffmpeg pass through `load_governor.run_ffmpeg` writes `<safe ad name>-cover.png` (default 1280x720, 16:9), title inside the title-safe inset via `drawtext=textfile=` with `expansion=none` (data, never filter syntax). A build whose ffmpeg has no drawtext refuses `COVER_DRAWTEXT_UNAVAILABLE`.
- `check_cover_image` is the delivery QC gate (measured IHDR pixels, matching sha256, README listing; the row's own claim never passes). `qc_gate` gains the `cover_image` check; the stage runbook gains the run row. Exactly one cover thumbnail per delivery folder.
- Local runner variable named `runner_fn` (not `launch`) so the onboarding agent-browser headless-only guard does not false-positive on the bare `launch(` token; shared scripts/core and references stay byte-identical with openclaw-onboarding 75-drama-song-ad-factory v2.9.14. VERSION and SKILL.md frontmatter: 2.7.38 to 2.7.39.

## [2.7.39] - 2026-10-09 - FU-DEL-05: the delivery folder ships the video twice — captioned and clean

- New `scripts/core/delivery_variants/video_delivery.py`: one delivery folder per run carries TWO numbered files — `1 - <Ad> - Ad (captioned).mp4` and `2 - <Ad> - Ad (clean, no captions).mp4`. Both are rendered from the ONE caption site (`final_assembler/captions_burn`): the captioned cut burns that plan, the clean cut is the same plan with `style.enabled` False, so neither variant invents its own words or look.
- Nothing is called delivered until `delivery_audio.check_delivery_audio()` has passed it (AAC-LC, 48 kHz, faststart, not silent). A refused file is deleted and the step raises `DELIVERY_AUDIO_REFUSED`, fail closed — a half-delivered pair is never handed over.
- `check_video_delivery()` is the QC row (PASS / FAIL / UNAVAILABLE, same contract as `song_files`) and `write_video_docs()` lists both files in `delivery-receipt.json` and `README.md`. The caption SRT rides in the receipt, not as a third file.
- `qc_gate` now requires `video_delivery` on the delivery gate; `final_assembler/captions_burn` grew the off plan the clean cut renders.
- VERSION and SKILL.md frontmatter: 2.7.39. Shared `scripts/core` stays byte-identical to the openclaw-onboarding copy.

## [2.7.39] - 2026-10-09 - DEL-07 ready-to-post kit

- `scripts/core/ready_post_kit/` builds the READY-TO-POST KIT a client posts from: `07 - Ready-to-Post Kit.pdf` plus `07 - Ready-to-Post Kit.json`, written into the ad's delivery folder. It carries which version to post where (every delivered file plus the cutdowns `clip_cutdown.clips_for(length)` schedules), the link (brief aliases -> a URL in the offer -> the `Banner link` line `batch_zip` publishes), a caption and suggested hashtags for YouTube, Instagram, TikTok and Facebook, and the YouTube block done properly: title <= 100 characters, description with the link and hashtags, tags <= 500 characters, counts shown. Bright page, every glyph >= 12 pt (enforced in the layout as `KIT_FONT_FLOOR` and read back out of the finished PDF by the test). Reuses `clip_cutdown`, `batch_zip`, `delivery_checklist`, `character_library`, the storyboard gate, the script-approval record, the card answers and the approved caption words; never re-implements them. Fail closed by name: `KIT_NO_LINK`, `KIT_STORYBOARD_NOT_APPROVED`, `KIT_NO_SCRIPT`, `KIT_DELIVERY_RECEIPT_MISSING`, `KIT_CHECKLIST_FAILED` (a measured "no"), `KIT_BANNED_TEXT` (a tool or model name, a dollar amount or an income promise anywhere in the copy). Contract: `references/ready-post-kit.md`; proof: `scripts/core/ready_post_kit/test_ready_post_kit.py` (19 cases). `scripts/core` stays byte-identical to the openclaw-onboarding 75-drama-song-ad-factory copy (cmp-verified, 426/426 shared files).

## [2.7.38] - 2026-10-09 - Train 2.7.38: delivery audio gate on every delivered video

All notable changes to this skill are documented here. The version of
record is `skill-version.txt` (kept in agreement with the `SKILL.md`
frontmatter `version:` field).

---

## [2.7.39] - 2026-10-09 - DEL-01: three audio versions + plain-English note in the delivery folder

- The delivery folder now ships the song three clearly-labelled ways, all from EXISTING pipeline output (the finished mix, the instrumental the run made, the vocal stem saved for every take; nothing re-synthesised): `delivery_variants.build_audio_versions(mix, delivery_dir, instrumental, vocal_stem)` encodes `01 - Full Song.mp3`, `02 - Instrumental.mp3` and `03 - Voice Only.mp3` (MP3 320 kbps each) and writes `00 - About These Audio Files.txt`, the short plain-English note on how the three differ; `write_version_docs` lists them in `delivery-receipt.json` and `README.md` (merge, never clobber). Every source is required -- a missing mix, instrumental or vocal stem raises `ValueError`, never a two-version delivery dressed up as three.
- `check_audio_versions` / `python3 scripts/core/delivery_variants/song_files.py check-versions <dir>` fails a missing version, a missing note, or anything unlisted in the receipt or README (exit 5). The check is registered as `audio_versions` in `qc_gate.CHECKS` so the delivery gate can require it. `delivery_variants` exports `build_audio_versions` / `check_audio_versions` / `write_version_docs` / `version_note_text` / `expected_version_files` / `version_file_name` / `DELIVERY_VERSIONS` / `VERSION_NOTE_NAME`.
- Test: `scripts/core/delivery_variants/test_audio_versions_del01.py` (13 tests: the three numbered MP3s and note, fail-closed on a missing/empty source, the note is plain English with no model/tool names or dollar amounts, one table drives labels/note/QC so they cannot drift, missing file/unlisted/rewrite-once/bitrate/duration/receipt-shape, and the `qc_gate.CHECKS` registration). Skill version v2.9.14.

## v2.9.13 - 2026-10-09 - Batch MGB023 follow-up 2 (no more silent ads)

- Delivery audio gate on EVERY path that hands the client a video: the final assembler (already), the 60 and 90 second clip cutdowns (`clip_cutdown.run_clips`, a refused clip is deleted), the batch zip (captioned ad and clean master) and the delivery checklist. Each one calls `delivery_audio.check_delivery_audio()` and fails closed.
- `check_delivery_audio()` now enforces what the order says: AAC-LC, 48 kHz, moov before mdat (faststart), and not silent. New codes `DELIVERY_AUDIO_NOT_48K` and `DELIVERY_NOT_FASTSTART`; new `require_delivery_audio()` raises `DeliveryAudioRefused`.
- `clip_cutdown.build_argv` used a bare `-c:a aac`; it now uses `AUDIO_OUT_ARGS` + `FASTSTART_ARGS`.
- New `test_delivery_gate_paths.py` (one MP3-audio refusal test per delivery path) (shared core is now byte-identical to the 999 copy v2.7.38; `delivery_fixture.py` removed, tests build their own fixtures).

## v2.9.12 - 2026-10-09 - Batch MGB022 follow-up

- FU-AAC-FINAL-MUX (#1785) plus the question-count wording fix: the intake card closing example ("1, 1, ...") is now built from the real question list (9, or 10 with a saved character) and the docstrings, help text and choice-card-spec say nine. New test `test_closing_example_answer_count_matches_question_count`.

## v2.9.11 - 2026-10-09 - Batch MGB021 roll-up

- FU-U3, FU-RNBFLOW-SONG, FU-HOOK-PLACEMENT, FU-U11, U15g, FU-ONE-SPEND-QUESTION, FU-STYLE-QUESTIONS, FU-VIDEO-MODEL-CHOICES, FU-STORYBOARD-SHOWS-BOTH, FU-SONG-APPROVAL, FU-SCRIPT-APPROVAL, FU-CLIENT-GUIDE, FU-AI-MODELS-QUESTION and FU-TEST-TMP-ISOLATION land together. The intake card is AI MODELS, LENGTH, MUSIC STYLE, VIDEO STYLE, VIDEO MODEL, BUDGET, STORYBOARD APPROVAL, SONG APPROVAL, SCRIPT APPROVAL (nine questions; ten with a saved character, which sits second).
- Integration fixes: the video model price follows the LENGTH answer by question id (not position); song-choices requests carry the style and hook plan to the judge; the client's own lines are checked before the recipe guard.

## Unreleased

- **U12: docs in lockstep with the code.** SKILL.md gains the tag-grammar /
  style-plan / voice-tag / per-style-band bullets in the Suno recipe, the
  "Request and prompt limits" section, the early-captions paragraph (with
  FU-U9 named as NOT built) and the book-orientation bullets (FU-U11, open
  branch); QC.md gains one section; the onboarding SOP DS-2/4/5/6/7/9 is
  brought to the same facts (DS-4 step 5 now says 6 to 8 clips of 4 to 6
  seconds); `references/choice-card-spec.md` gains 2.3 (options come from the
  registry; the fit card FU-U4 is not built) and the machine-checked
  "Offered lengths (seconds): 60, 90, 120, 180, 300, 600." line. SKILL.md
  closes with a "Sections marked TODO" block naming FU-U3, FU-U4, FU-U9 and
  FU-U11 as the sections to refresh when those land. New test
  `scripts/core/prompt_templates/test_docs_u12.py`.

## Unreleased - FU-U4: client lines are a contract; the STOP card lists only real options

- Client lines are a contract: concept mode requires `packet_lines` (`PACKET_REQUIRED_IN_CONCEPT_MODE`) in `lyric_writer` and `music_director`, and a missing client line is refused NAMING its id instead of being invented. New `choice_card/intake_card` fit card plus `factory` card `--fit` (exit 2, one row per style), registry-only options (no option invented at the card), an intake mode flag, and intake notices for sfx, echo voice, length-not-offered and fps. The STOP card lists only options the registry actually offers. Spec `references/choice-card-spec.md` section 2.3. New test `scripts/core/choice_card/intake_card/test_fit_card_u4.py`.

## Unreleased - FU-U3: bands per music style; rap is its own delivery; silence is not speech

- Per-style bands under the SAME locked 5/10 band: `spoken_share.STYLE_TARGETS` holds Soul Ballad and Soul Rise at exactly 22.5 runtime spoken / 77.5 sung-of-voice; R&B Flow's target is the documented default flagged as a TREVOR-DECISION ITEM in plan 18 section 9 item 1 -- the share planned from the approved sheet (the U2 plan's word counts at the style's measured rates), not a new number invented here -- and sung-of-voice on a rap sheet is recorded, not gated (hook content, not a planned share); the 6 s sung stretch and the hook count stay hard. `measure_share(segments, style_id=...)` reports rap separately for a rap style and counts plain spoken against its target; `segments_from_sung_stretches(voiced=)` turns music-only time into a fourth delivery `none` that counts in runtime and never in voice time (a music-only gap no longer counts as spoken); the rap-versus-speech split is measured word timestamps x the sheet's delivery labels, recorded as basis `aligned`, never `measured`. `song_dispatch.judge_take` / `run_takes` and `suno_recipe.score_take` carry `style_id` (+ `plan`) through validate and judge. New test `scripts/core/spoken_share/test_style_bands_u3.py` with the g1b segment fixture from SONG-RECEIPT (fails on the base tree: `voiced=` did not exist).

## v2.9.9 - 2026-10-09 - FU-SAVED-CHARACTER-QUESTION

- The saved-character intake question now reads "Do you want to create a new character for this ad, or use one you've used before?" with "You have N character(s) saved with us." and numbered options: "Create a new character (recommended)" first, then "Use <Name> - <description>" for each saved character. With no saved characters nothing is asked; one line says a new character will be created and saved for next time. Same recap ("Character: new" / "Character: <Name> (saved)") and same effect of each answer. Test: `character_library/test_saved_character_question.py`.

## v2.9.9 - 2026-10-09 - FU-LENGTH-CLIPS: clearer length question; 3 minutes now comes with 60s and 90s clips

- New `core/clip_cutdown`: the 3, 5 and 10 minute ads cut an automatic 60-second and 90-second clip (whole lines, at most L-2 s, hook placement kept, never into the end card; FFmpeg only, free). Before this the card promised clips for 5 and 10 minutes but no code cut them.
- The LENGTH question is now a full question ("How long do you want your ad to be? ...") with numbered options that say what the client gets; 3 minutes now comes with the clips; the recap reads "Length: 3 minutes + 60s and 90s clips". The Clips card row lists clips for 3 minutes and says they are included in the price.
- Docs (SKILL.md, INSTRUCTIONS.md, choice-card-spec.md, price-menu.md, stage-runbook.md) now agree with the code.

## v2.9.9 - 2026-10-09 - FU-INTRO-MESSAGE

- Every new interactive run opens with a short one-time intro of what the factory makes, sent as its own message before question 1 (`factory.py card --step --run-state-file`); never on resume, recap, batch or CLI-only paths.

---
## v2.9.10 - 2026-10-09 - FU-HOOK-PLACEMENT + FU-RNBFLOW-SONG

- **FU-HOOK-PLACEMENT: the hook is the payoff, never the opener** (Trevor 2026-10-09: "THE HOOK HAS TO MAKE SENSE AND BE PLACED CORRECTLY"). New `core/sung_hook/hook_placement.py`. (1) Build-up, always on: before the first hook the sheet carries a verse, plus a pre-chorus/build where the style's section plan has one and the length plan has pre-choruses; checked in `suno_recipe.prepare`/`build_request`, `guard_request` and `check_payload`. (2) Story sense, always on: the `hook_plan` (`{"true_at_beat": beat}`, shape in SKILL.md) names the U16 beat where the hook's words become true (never the opening beat); the gate MEASURES each hook block's planned position (words before it at the style's rates, as a share of the sheet, mapped onto the arc) and fails a first hook before that beat, whatever beats a plan claims (`plan_for` writes the measured beats as a receipt). The count is `hook_placement.hook_target`: `sung_hook.hook_count` for the length, reduced to what fits after that beat starts. `music_director.build_generate_request(true_at_beat=...)` emits the plan and carries it as `_hook_plan`; `song_dispatch.run_takes` moves it into the judge's plan and never sends it to KIE. (3) After Suno, always on: `song_dispatch.judge_take` gate `hook_placement` fails a take where Suno added hook blocks, moved a hook earlier, sang the first hook inside the build-up window or before the beat's start second. (4) No gate switches itself off: a missing style, length, sheet, `hook_plan` or `true_at_beat` is a FAIL reading `UNMEASURED: <field>`. (5) The Suno style text says "Sing the sections in the order written; the song never opens with the hook: build up through the verse first". `sung_hook.measure` strips Suno's inline section headers before reading words. Replays: v1 sheet with its honest plan (true at the turn) FAILS (first hook at 16% of the song; 6 hooks where 3 fit); a built-up sheet with its first hook about a quarter in, true at the turn, FAILS; v2 sheet FAILS (hook before any verse); v2 take g2a FAILS (9 hook blocks against 6, added at 13.6 s, 46.3 s, 94.8 s; first hook at 8.9 s inside the 17.7 s window); v1 take FAILS at the turn (first hook sung at 23.8 s, the turn starts at 84.6 s).
- **FU-RNBFLOW-SONG: every sheet and returned song held to its music style's own definition** (new `core/song_contract`): every chorus is the hook plus at least one other real line; the sung sections the length plan calls for are present (R&B Flow's verses are rap); the planned sung share of voice is a per-style floor (Soul Ballad and Soul Rise 77.5%, so a Soul sheet may be almost all sung; R&B Flow the share its own length plan holds after its rap budget); rap blocks are cued "rhythmic rap on the beat", never conversational; an upbeat style never asks for "slow"; a spoken outro says "no melody". Run by `suno_recipe.guard_request`, `song_dispatch.validate_request` and gate `song_contract` in `judge_take`.
- **Golden sheets**: all six pass `guard_request` (recipe + hook placement + contract), `song_contract` and `music_director.build_generate_request` at their delivered length: every Hook block carries a second real line, R&B Flow rap cues say "rhythmic rap on the beat", no "slow" in an R&B Flow sung block. Each names the beat where its hook ("You can rest and still rise") pays off, `the_turn` when the book arrives (60 s: `lowest_point`, since two hooks cannot fit after the turn starts), carries `hook_target` hooks (2/2/3/4/6/11 at 60/90/120/180/300/600 s) with the build-up and the product passage before the first hook, fits its delivered length, and FAILS the story-beat check if its first hook is moved up. `song_contract/test_song_contract.py` and `sung_hook/test_no_skip_and_goldens.py` run all six.
- **No gate switches itself off, and the director measures every style by its own rule**: `guard_request` with no `style_id` refuses a sheet with sung or rap sections (`UNMEASURED: style_id`); `check_payload` with no `music_style` is `UNMEASURED: music_style`; `check_returned`/`judge_take` FAIL a `true_at_beat` that is not a beat or is the opening beat, as `check_story` does. The director's words-fit check holds the sung share to the style's own floor (`words_fit.style_sung_target_pct`, the one copy `song_contract.sung_target` reads), and its spelling check reads a held vowel ("re-est", "lo-ook", "mi-ine") as its word while real misspellings are still refused; "n't" contractions join the dictionary extras.
- **FU-U11: book printed pages, the plan hash, the card block and the excerpt seam.** `book_shot.check_pages` / `check_pages_sequence` add the calibrated printed-vs-white page test (`BOOK_BLANK_PAGES`): a page of real body text has no empty grid cell, a white page does (both re-measured from the shipped fixture generator: printed ink 0.1640 with 0 empty cells, white ink 0.0031 with 40 of 48; a page carrying only a caption line sits in the same empty-cell band by design and needs its own fixture to reproduce), and more than one blank page among the sampled open frames fails. `plan_spec` / `plan_sha256` / `plan_card_rows` hash the approved plan and render the card rows; the prompt wording itself lives in the `references/prompt-templates/models/minimax-h3.json` fragments `PRINTED_PAGES`, `BOOK_CLOSED` and `BOOK_OPEN_MOTION`, read by `prompt_templates` (U15b) — this unit authors no prompt wording, it MEASURES the rendered frames. `kie_dispatch.book_shot_refusal` now ACTIVATES the plan-hash requirement U10 shipped dormant — a book video job with no `book_plan_sha256`, or one whose hash does not match the approved plan, is refused `BOOK_PLAN_NOT_APPROVED`. `intake_book` takes an OPTIONAL `excerpt_lines` (client-supplied only, max 3, provenance "provided", spelling-checked with the caption gate's dictionary; it adds no question). Both card faces carry the Book shots APPROVAL BLOCK — approvals and notices only, never a new choice. The excerpt reaches the render as DATA through the single named U9 hook `final_assembler.captions_burn.overlay_excerpt`; no second burn module and no OCR binding was added, and while U9's artifact is absent the call site reports PENDING rather than burning. New test `scripts/core/book_shot/test_book_pages_d1.py` proves all four D1 cases (white fails / printed passes, no-plan refused, changed plan refused until re-approved, excerpt never in the video prompt).
## v2.9.9 - 2026-10-09 - FU-VIDEO-MODEL-CHOICES: four video models, each with a price for your chosen length

- The VIDEO MODEL intake question now lists four models with H3 first and RECOMMENDED: MiniMax H3, Seedance 2.5, Seedance 2.0 Mini, Google Veo 3.1. Each line carries one plain descriptor and "about $X" for the length the client already chose (same formula as the card: video + one keyframe per shot + one song, +20% redo allowance). The recap reads `Video model: Seedance 2.5 - about $68.40`. Seedance is ByteDance's video model (Seedream is image only). Seedance 2.0 Fast is not offered (clip range unconfirmed, not on the price menu); Mini is the lite tier.
- One price for the question and the final card: `card_render.price_envelope` prices the chosen model from the rates table at the resolution the factory renders (H3 768P, Seedance 2.5 720p, Mini 720p, Veo 3.1 Fast 720p), with keyframes, character reference pictures, the song and the 20% redo allowance; the question quotes that exact total. Skill 74 `price` (highest tier) is unchanged for other skills.
- The client's pick is stored in run state at intake (`intake_card.conversation(..., state_store, run_id)`), read by the card's Video model row and by `kie_dispatch`, which submits that model's provider id and resolution (`video_models.request_for_run`, `apply_locked_choice`).
- One rates table with source URL and date: `scripts/core/choice_card/video_models/video_model_rates.json`.
- `prompt_limits.MARKET_ALIASES`: the market id `veo-3-1` is held to the dedicated `veo3_fast` catalog entry; before this, a Veo 3.1 dispatch refused `PROMPT_LIMIT_NO_CATALOG`.
- New test `scripts/core/choice_card/video_models/test_video_models.py` (13 checks: question = card total for 4 models x 60 s / 3 min, pick -> card row and payload, payload tests run through `kie_dispatch.dispatch` with a fake Skill 74; zero paid calls).
## v2.9.9 - 2026-10-09 - Storyboard approval shows each shot's card and its still

- FU-STORYBOARD-SHOWS-BOTH: new `storyboard_director/approval_package.py` builds the approval message with the written card and the still image for every shot, in order; stills come before approval and video after it; approve opens the video gate; a shot edit regenerates and re-sends only that shot. Documented in SKILL.md, choice-card-spec.md and stage-runbook.md.
- Wired into the live run: `storyboard_director/approval_runner.py:run` (via `factory.py storyboard`) sends the message plus each still through `openclaw message send`, records the video stage WAITING_APPROVAL, applies GO / `shot N: change ...`, auto-approves on No, and `factory.py next` withholds the video command until approved. End-to-end test: `test_approval_runner.py`.
## v2.9.9 - 2026-10-09 - FU-SONG-APPROVAL: hear and pick the song before any video

- New intake question 7 of 7, SONG APPROVAL ("Do you want to hear and pick the song before any video is made?"). The card, recap and "number of a line to change it" carry it; the count is now 7 (8 with the saved-character question).
- On Yes the song stage makes three arrangement variants of the same lyric sheet in parallel (`scripts/core/song_choices/`, data table `variants.json`), each judged by `song_dispatch`, a failed one regenerated once then reported; delivered as `SONG-CHOICES/N - LABEL (description).mp3` with title tags and `README.txt`.
- The gate: `factory.py next` and `kie_dispatch` refuse picture timing, image, video and lip-sync work with `SONG_PICK_MISSING` until the client's pick is recorded; a missing or changed pick never defaults. On No nothing changes.
- The card price adds the two extra song generations (`Song picks` row).
- Tests: `song_choices/test_song_choices_fu_song.py`; the H9 and I6 card tests move to 7 and 8.
- Wiring: the confirmed recap writes the SONG APPROVAL answer to the run (`intake_card.conversation(..., run_dir=)` / `factory.py card --step --run-dir` -> `song_choices.record_card_answer`), so Yes turns the gate on without a manual step; a recap change replaces it, a resume keeps it once versions exist. `deliver_choices(..., target=)` / `send_choices` send the message plus the three files in order through `openclaw_send_argv` (`--media`, same `openclaw message send` path as the card). Tests: `song_choices/test_song_wire_fu_song2.py`.

---
## v2.9.10 - 2026-10-09 - FU-SCRIPT-APPROVAL (wired)

- New card question SCRIPT APPROVAL (last question): the client can read and approve the story and song lyrics before the song is made. Yes sends the script and pauses before any song generation; edits are applied, re-checked and re-sent; missing approval fails closed (`SCRIPT_NOT_APPROVED`) in `kie_dispatch.dispatch` and `song_dispatch.run_takes`. No: unchanged.
- Wired, nothing is called by hand: `factory.py next` runs `script_approval.stage.run_stage` when `music` is next and the card answer is Yes (checks, `request_approval`, send through `openclaw message send` or back to the chat, run recorded as waiting, outcome `waiting`). New `factory.py script-reply` carries the client's answer (`approve` or an edit that is re-checked and re-sent). Resume stays waiting and never re-sends a delivered script. The dispatch gates read the record from the run folder (`record_near`, `run_dir=`).
- New `scripts/core/script_approval/` with `test_script_approval.py` and `test_script_wiring.py`.
## v2.9.9 - 2026-10-09 - Client guide

- FU-CLIENT-GUIDE: added references/CLIENT-GUIDE.md (opening, checklist, every question with examples and prep). Docs only.
## v2.9.9 - 2026-10-09 - FU-AI-MODELS-QUESTION

- New first intake question, AI MODELS: which AI builds the video and which checks the work. OpenRouter is recommended (faster), Ollama is allowed, unknown names are refused politely, and the checker must differ from the builder.
- Honest scope: the run still uses the session's own model. The answer is recorded as `ai_models` in the approved intake summary, as a preference for the operator.
- The card now has seven questions (eight with a saved character, which comes second). Tests: `choice_card/intake_card/test_ai_models.py`; card-count checks in `test_intake_card_h9.py`, `test_intake_step_i7.py`, `test_character_library_i6.py` updated.

## v2.9.10 - 2026-10-09 - FU-AAC-FINAL-MUX

- Every delivered video is AAC-LC 48 kHz 256k with +faststart (QuickTime played MP3-in-MP4 silent): new core/delivery_audio.py shared argv constants plus a delivery gate (refuses non-aac or silent audio) wired into final_assembler.assemble and delivery_checklist.delivery_battery(video_path=).

---

## v2.9.8 - 2026-10-09 - Batch MGB018 roll-up

- FU-PARITY: shared files aligned with 999 (v2.7.28 test fixes, delivery_checklist blank lines).
- sfx-f4: the U15 fail-first guards no longer call sys.exit at module level, so one failing guard cannot raise INTERNALERROR across the whole test tree.
- `prompt_templates.book_fragments(spec, st, frag)` is the ONE wording home for a book prompt: it reads `BOOK_CLOSED`, `BOOK_OPEN_MOTION` and `PRINTED_PAGES` from `models/minimax-h3.json` and returns the `book`/`pages` sections both assemblers (`assemble_h3`, `assemble_kling_video`) `.update()`. A shot type that declares `required_blocks_when_book` (product-book) now REFUSES `BOOK_FRAGMENTS_REQUIRED` when the spec does not carry the block, when `book=` is a value the assembler does not know (`closed`/`open` only) or when an open book has no `pages: texture` block — previously such a spec assembled with NO contract wording and PASSed the band. Non-book shot types are untouched.
- Kling no longer scales or trims the fixed `book`/`pages` fragments (`section_scale` 0.38 and `_KLING_TRIM_ORDER` cut the U10 contract sentences in half; design `never_trim` lists `book` and `pages`). The fragments now arrive whole on the Kling path.
- New test `scripts/core/prompt_templates/test_prompt_book_fragments_u15g.py` (26 checks; the (a) refusal checks fail on the base tree).

## v2.9.7 - 2026-10-09 - load-governor test no longer sleeps

- `test_load_governor.py` resets the poll limiter after the fake-clock poll checks. They left it near 1003 s, so the later real-clock polls slept until the machine had been up that long (about 464 s on a fresh CI runner). No check was weakened.

## v2.9.6 - 2026-10-09 - Batch MGB015 roll-up

One version for the MGB015 units: FU-U2 (style-aware length plan), FU-U8 (captions caught early), FU-U15i (docs in lockstep with the prompt). FU-U2 x the scaled CTA cap: a rap style keeps the fixed OUTRO_MAX_WORDS cap and the unspent allowance becomes the rap budget (matches 999 v2.7.29).

### FU-U2: style-aware length plan and words fit

- Style-aware length plan and words fit: `length_formula.plan(L, spoken_share_pct=None, style_id=None)` gives a rap style (R&B Flow, from the style's own `deliveries` in `core/music_styles`) a rap budget for the verses by splitting the D15 spoken-STYLE allowance with the [Intro]/[Outro] spoken block caps, at the calibrated `core/words_fit` rate, and returns `words {spoken, rap, sung}` plus `rap_s`; `words_fit.STYLE_RATES` is keyed by STYLE ID with `rates_for()` normalizing through `music_styles.style()` and `CARD_LENGTHS_S` now re-exports `music_styles.OFFERED_LENGTHS_S` (one copy, gain 120 s); `music_director.build_generate_request` passes `style_id` into `words_fit.preflight_sheet` and `suno_recipe.check_lyric_sheet` passes it into `plan`; Soul Ballad and Soul Rise plans are BYTE-IDENTICAL (65 words at L=60). New test `scripts/core/length_formula/test_style_plan_u2.py`.
### FU-U8: captions caught early (display spellings, intake, the sheet, on-screen text, grammar flags)

- Every string that reaches the screen is now caught before a paid call: `_tokens()` maps U+2019/U+2018 and NFKC-normalises ("could’ve" is one word, not "could"+"ve"); the new `display_text()` turns performance spelling into the caption ("Girl, I got you-u" burns as "Girl, I got you", a wordless vocalise makes no cue) and `build_captions`/`check_captions` use it; `check_lyrics_spelling` refuses a misspelled lyric word with `LYRIC_MISSPELLED` inside `music_director.build_generate_request` BEFORE the recipe guard and any payload; `check_confusables` FLAGS the two confusions a token proves wrong (never a fix); `intake.client_typo_question` sends a client typo BACK AS ONE QUESTION ("Your storyboard says 'kitchan'...") and never rewrites the client's words; `kie_dispatch.onscreen_text_refusal` refuses `ONSCREEN_TEXT_NOT_CHECKED` a keyframe/video whose on-screen text is not in the checked receipt; and `qc_gate` requires a `spelling_grammar` record at the Script stage (new `required_checks`, schema enum, contract updated). New test `scripts/core/test_captions_early_u8.py` (24 checks; 18 fail on the base tree).

## v2.9.5 - 2026-10-09 - Batch MGB012 roll-up

One version for the MGB012 units: FU-U1 (pytest-clean rap-aware tag grammar test), FU-U7 (video/avatar prompt caps at the caller), FU-U15e (Kling avatar template), FU-U15d (Suno V6 templates per style and per length), FU-U15b (H3 assembler and the 5,000-6,800 band), FU-U15f (Kling as the card's video model), U15h (length classes, product seconds, lanes in one table; prompt compliance), and FU-U5 (voice tags come from the cast). Merge notes: suno_recipe is the union of FU-U1's tag grammar and rap rule with FU-U15d's data-driven styles; bible.compile_visual_prompt keeps FU-U10's own-motion kinds on the image path next to U15b's video path; qc_gate.evaluate takes both campaign_type and ledger_jobs. Entries follow.

- FU-U1: `test_tag_grammar_u1.py` is now pytest-clean. `test_b_lyric_gate_counts_rap_in_the_budget` took the sheet as a required argument, so under pytest it ran standalone with no sheet and errored `fixture 'sheet' not found`. It now defaults to `None` and builds the sheet from the fixture itself; a parse failure still fails the check loudly (never a skip). Script mode is unchanged.

- FU-U15d: Suno V6 templates per style and per length (references/prompt-templates/music/*.json, models/suno-v6.json); suno_recipe reads style lead, cues and gender words from data, not constants; no-voice sections render as a tag only; caps are measured last.

- FU-U15e: Kling avatar template (prompt_templates.assemble_kling_avatar / check_kling_avatar): who from the look's mode, three sentences, one emotion.

- Caller-side guards in `kie_dispatch.dispatch`: the FINAL video/avatar payload is measured against the U6 table (`prompt_limits.check_request`) before any other gate, so an over-cap prompt is refused `PROMPT_OVER_CAP` (field, chars, cap, source, status; never truncated) and a paid video/avatar job on an install without the table refuses `PROMPT_LIMIT_UNAVAILABLE`; nothing is reserved, nothing reaches Skill 74, and the ok receipt carries the measured `prompt_caps` rows. Table gains only what the catalogs lack for video: Hailuo family prefix 2,000, `kling-2.6/image-to-video` 2,500, and the Kling 2.5 Turbo `negative_prompt` 2,500 the catalog does not declare. New test `kie_dispatch/test_prompt_cap_u7.py` (fails on the base tree; 5/5 after).


- U15b (H3 assembler, band of record 5,000-6,800): `prompt_templates.assemble_h3/check/expand/receipt` build every MiniMax H3 prompt from the template layers plus the shot spec's facts, guard the owner band (under 5,000 = FLAG then `H3_THIN_SPEC`, never padding; over 6,800 = TRIM; over 7,000 = REFUSE `H3_OVER_HARD_MAX`), and write a prompt receipt (sha256 + template version + section char map). The six golden specs assemble to 5,578-6,740. `shot_planner.prompt_spec_for` writes the facts (`shot["prompt_spec"]`); `kie_dispatch` refuses `PROMPT_NOT_TEMPLATED` when the prompt's sha256 has no receipt or the receipt says REFUSE/TRIM, and re-measures the final payload cap just before spend. The video prompt path carries no square-bracket markers and no generic `[MOTION]` line (`bible.compile_visual_prompt(video=True)`, the three style bibles' `compile_prompt(video=True)`); `assert_compiled` accepts a matching receipt. New `shot-types/villain.json` carries the U16 villain guidance into the assembler. `music_styles` soul-ballad base text ends with a period.

- U15f (Kling as the card's video model, design 3.5): `prompt_templates.assemble_kling_video` builds a Kling prompt in H3's section order scaled by `models/kling-video.json`'s `section_scale` (0.38, per-section budgets `kling_section_limits()` derived from H3's own table, never a second one), aims it into the manifest band (1,800-2,500; hard max 3,072 omni VERIFIED, 2,500 for 3.0/video UNVERIFIED, 2,500 for 2.5 turbo VERIFIED), and differs from H3 in exactly the three ways the design names: the camera is PLAIN WORDS after the subject's motion (no bracket group anywhere), the look is the mode's `kling_block`, and the negatives STAY IN the prompt (no `negative_prompt` field). `check_kling` refuses `KLING_BRACKET_SYNTAX`, `KLING_OVER_HARD_MAX`, banned phrases, duplicate sentences and run-on 8-grams, and flags under-floor `KLING_BELOW_FLOOR`; `band_cap` prints each cap's VERIFIED/UNVERIFIED provenance and never promotes one. The six golden specs re-assembled for `kling-3.0-omni/image-to-video` land at 1,842-2,183, PASS. New test `scripts/core/prompt_templates/test_prompt_templates_u15f.py` (fails on the base tree: no `assemble_kling_video`).

- U15i (docs in lockstep with the template system; last unit of the U15 set): `SKILL.md` gains the "Prompt templates" section (data under `references/prompt-templates/`, the assembler `scripts/core/prompt_templates/`, the H3 band 5,000-6,800 with hard max 7,000, the prompt receipt, `PROMPT_NOT_TEMPLATED`, the `prompt_compliance` gate) and the Suno recipe and lip-sync bullets now point at it. `references/choice-card-spec.md` 3.1 names `references/prompt-templates/length-classes.json` as the ONE length table (its list equals the table's keys) and 3.3 points at `looks/` and `modes/`. `references/style-bibles/realism-cinematic.md` keeps the recipe as the source of the `realism` mode, moves the Chanel identity into a "worked example" heading, deletes the nine "(Restated for emphasis.)" duplicate blocks, and states the camera as per shot. `QC.md` carries the bands, the receipt, `PROMPT_NOT_TEMPLATED` and the required `prompt_compliance` record. ONB SOP `DS-5`/`DS-6` point at the same files. New doc test `prompt_templates/test_docs_u15i.py` (fails on the base tree: no "Prompt templates" section, the restated duplicates still present, the card's 3.3 with no `looks/`).


- U15h (length classes, product seconds and lanes in ONE table; prompt compliance at final QC): `references/prompt-templates/length-classes.json` is CORRECTED so every row equals the code (`length_formula.plan`, `lipsync_clips.budget`, `shot_planner.plan_generation_count` = ceil(D/4), lanes via `lane_planner` when the module is on the tree, the 10-15% product band). The U15a port had drifted at 180/300/600 s (spoken share 16.9/10.1/5.0% before U15d's CTA scale landed; rows now 22.5%) and at 600 s the song plan is `1 base + 3 extends`. `prompt_templates.length_class(L)` is the one reader: it computes the row and raises `PROMPT_LENGTH_CLASS_DRIFT` naming each drifted field, so a stale table can never be read silently. `length_formula.class_check`, `lipsync_clips.class_check` and `shot_planner.class_check` cross-check their own module against the table (never a second formula). `qc_gate` requires a `prompt_compliance` record at final QC: `prompt_compliance_rows`/`prompt_compliance_record` build one row per paid ledger job matched to its receipt (logical_key+attempt_id, else request_digest, else prompt_sha256; REFUSE/TRIM receipts never count), and `evaluate(..., ledger_jobs=[...])` requires the check. `check_product_seconds` proves the shot plan's product seconds fall inside 10-15% of D. New `prompt_templates/test_length_classes_u15h.py`.

- **FU-U5: voice tags come from the cast.** `suno_recipe.check_voice_tags(sheet_text, cast_genders)` refuses a sheet whose voice tag gender disagrees with the cast record (`VOICE_TAG_MISMATCH`, naming both sides) and refuses a character tag whose gender cannot be checked at all (`VOICE_TAG_UNCHECKED`, fail closed); `suno_recipe.guard_request` takes `cast_genders=` and refuses at that seam, and `protected_names.cast_genders(brief)` builds the map from `brief.characters[].gender`. Brackets that name no cast character ([Hook], [Intro], [End]) are never judged; no cast record means the check is off, exactly as today. 2026-10-08 One-Check Chanel as the LIVE cast record has it (the 2026-10-08 voice recast, CAST.md): the BOX COWORKER bracket tagged "Female voice" against a cast that says man is now refused; the desk neighbour "Female" and the manager "Male" tags match the live cast and pass. The plan unit row's own acceptance is also asserted on the pre-recast (plan-time) cast, where the desk neighbour tagged "Female" against a cast that says man is refused. All Suno is unchanged: one `vocal_gender`, same KIE params, no new voice option. Test: `scripts/core/suno_recipe/test_voice_tags_u5.py` (5 of 6 blocks fail on the base tree: no `parse_voice_tags` / `check_voice_tags`, `guard_request` has no `cast_genders`).
## v2.9.4 - 2026-10-09 - Batch MGB010 roll-up

One version for the MGB010 units: TESTHYG-75 (skill 75 tests pytest-collectable and green in one process), FU-U14 (song mp3 part of every deliverable), FU-U10 (book orientation contract), FU-U6 (Suno request limits, fail closed), FU-U15a (template data layer), FU-U16 (story doctrine: villain, pain, rise), U15c (owner prompt band) and qc-kie-docs-host (F14 scanner exempts the docs host only). FU-U1 (rap-aware tag grammar) was held out: its test_tag_grammar_u1.py is not pytest-clean. Entries follow.

## v2.9.3 - 2026-10-09 - Batch MGB009 roll-up

One version for four units that each carried v2.9.2: W-G-003-amend (singing detector aligned to Appendix A), W-G-008 (parallel minute-lanes for ads 120 s and up), W-F-U2 (whole-track retakes only, PARTIAL_SUNO_JOB gate) and FU-U13 (story arc rule and product-connection target). Their entries follow unchanged.

## v2.9.2 - 2026-10-09 - W-G-008: parallel minute-lanes for ads 120 s and up

Owner order (Trevor, 2026-10-08): "this type of intelligence should be built
into skill 75 for all video 2 minutes and up". Reference run wf_9134d15e-b8e
(the fixer split a 3-minute ad into parallel minute-lanes).
- **`scripts/core/lane_planner.py` (new).** Below 120 s of song NOTHING
  changes: one lane, today's flow. At 120 s and up, `plan_lanes(shots,
  song_length_s)` cuts the shot list into N = ceil(L / 60) lanes of about 60 s,
  every cut ON a shot boundary (a shot is never split; an unreachable boundary
  fails closed `LANE_BOUNDARY_INSIDE_SHOT`). Shared steps run ONCE before the
  split (`SHARED_STEPS_BEFORE`: song, song-checker, plan-shot-list, character,
  closeup-picture-gate); each lane makes its own stills, motion clips and
  lip-sync segments AT THE SAME TIME, on the same character, through the
  picture gate, at most 2 lip-sync jobs per segment then the best take, with
  mouth strips. Fan-in runs ONCE after the lanes (`SHARED_STEPS_AFTER`): one
  edit over the full song, one independent checker for the whole ad (hard
  audio-length rule, captions = lyrics, face through the call to action), one
  repair.
- **`SharedGovernor` (one governor across all lanes).** At most 20 NEW
  generation requests per rolling 10 s in total; per-lane share floor(18 / N)
  (3 lanes -> 6 each); every submit rides `load_governor.kie_request`, so a 429
  is backed off and RESUBMITTED, never dropped. Heavy local jobs (ffmpeg) stay
  at most 2 at once across all lanes through the EXISTING machine-wide gate
  (`load_governor.heavy_slot`, re-exported as `lane_planner.heavy_slot`) -- no
  second limiter.
- **Resume and reuse.** `classify_tag(db_path, run_id, logical_key, ...)`
  reads the run's spend ledger: a tag already in the ledger is POLLED, never
  resubmitted; a finished file is REUSED, so a re-run never pays twice; every
  lane plans against the ONE ledger run, so spend stays under the run cap
  across all lanes together.
- Tests: `scripts/core/test_lane_planner.py` (180 s -> 3 lanes on shot
  boundaries; 90 s -> 1 lane; shared governor <= 20 per 10 s across 3 lanes on
  a fake clock with a 429 resubmitted; a ledger-known tag is polled, a
  finished file reused). Boundary battery: 119 stays 1, 120 splits, 179 stays
  3, 180 stays 3.
- Docs: SKILL.md "Parallel minute-lanes" section; the pipeline SOP
  (`23-ai-workforce-blueprint/templates/role-library/video/sops/SOP--drama-song-ad-pipeline.md`
  DS-7 step 6) + `_index.json` content manifest restamp.

## v2.9.2 - 2026-10-08 - FU-U13: story arc rule + product-connection target

Trevor's order: never forget to connect the product to the story, and spend at
least 10-15% of the time connecting the dots to the product and promoting it -
a target, not a hard cap.

- Story arc rule in the lyric/script and shot-plan stages: struggle -> what
  changed -> the product is why -> get the product. The product is named and
  connected in the lyrics AND on screen (cover, title, link), never only on an
  end card.
- `length_formula.plan_product_connection(plan, shots, lyric_lines)`: totals
  product-tagged lyric lines and product-tagged shots, returns seconds and
  percent of runtime, PASS/FLAG against the 10-15% band, plus the spoken-word
  and struggle-motion-shot requirements. The plan carries it as
  `product_connection`; the choice card shows the seconds and percent.
- `delivery_checklist.measure_product_connection(shots, lyrics, runtime_s)`:
  measures the delivered run, reports row `PRODUCT_CONNECTION` in the
  receipt/checklist output with the measured seconds and percent. Outside the
  band is FLAG, never a blocker by itself, never a repair directive.
- Docs: SKILL.md, references/choice-card-spec.md, references/stage-runbook.md,
  QC.md, and the onboarding-only SOP
  (23-ai-workforce-blueprint/.../SOP--drama-song-ad-pipeline.md).
- Test: `scripts/core/length_formula/test_story_arc_u13.py`.
## v2.9.4 (included) - FU-U6: Suno request limits, fail closed, measured last

- New `scripts/core/prompt_limits.py`: one limit table read from the catalogs (`68-kie-audio/models.json` suno-generate: lyrics 5000, style 1000, title 80, duration 10-360; `67-kie-video/models.json` vendor caps per model), plus a skill-75 override table for what the catalogs lack (`negativeTags` 1000 and `kling/ai-avatar-standard` 2500, both stamped UNVERIFIED with source URL and the free docs re-read step). `check_request(model, request)` measures EVERY text field of the FINAL payload and refuses over-cap with `PROMPT_OVER_CAP: field, chars, cap, source, status`; it never truncates.
- `music_director.build_generate_request` now measures the payload AFTER `ending_qc.with_clean_ending` appends the ending to the style (the E.2 order-of-mutation hole: a 1000-char style passed the old guard, the ending pushed it to 1054, and the final style was never re-measured).
- `suno_recipe.build_request` measures its payload too; `song_dispatch.run_takes` compares the request duration with the G9 headroom (`words_fit.max_suno_duration(plan)`) as the plan default allows, while a patch/short duration is still refused.
- Gate registered in `shared-utils/kie_prompt_gates.json`; the shared enforcer is called ceiling-only through the module (the 80 percent floor must not apply: the 67 house floor of 5000 sits above Kling's 2500 hard cap).
- New test `music_director/test_prompt_limits_u6.py` (fails on the base tree: no `prompt_limits` module, 5001-char lyrics, a 1054-char final style and an 81-char title all built).
## v2.9.4 (included) - qc-kie-docs-host: F14 scanner exempts the docs host only

- `scripts/qc-no-direct-kie.sh`: the endpoint pattern `(https?://)?(api\.)?kie\.ai` matched a bare `docs.kie.ai` host, so the KIE documentation provenance URLs in `scripts/core/prompt_limits.py` (added by FU-U6) were reported as direct-KIE calls and the check exited 2 on a clean tree. The scan now extracts each host occurrence (`grep -oE`) and drops exactly the `docs.kie.ai` host — the exemption is decided per OCCURRENCE, so a line carrying both a docs URL and a real api URL still fails on the api record (a line-level `grep -v` would discard the whole line and let the real call escape). Every other host still bites: `api.kie.ai`, any other subdomain including ones nobody has thought of yet, and bare `kie.ai`. No filename exemption: a real direct call added to `prompt_limits.py` later is still caught.
- New test `scripts/core/kie_dispatch/test_qc_docs_host.py` (fails on the base tree: the docs fixture exits 2). Covers the docs citation passing, the api call still failing by name, the mixed one-line docs+api case failing per occurrence, unknown subdomains and bare `kie.ai` failing, and the real core tree staying clean. Existing `test_model_lock_f14.py::test_qc_no_direct_kie` regression stays green.

## v2.9.1 - 2026-10-09 - Batch MGB008: W-G-007-amend, W-G-002-amend

- Delivery checklist consumes the amended receipt fields (W-G-007-amend); kept-take tags merged with the calibrated verdict gate.
- Delivery-named tag grammar in lyric_structure (W-G-002-amend).

## v2.9.0 - 2026-10-08 - Batch MGB007: LSC001: one consolidated lip-sync change (LPG001 + LSL001 + LSR001)

No version bump. Replaces onboarding #1697, #1698, #1699 (999-setup #72, #73, #86), which overlapped and partly contradicted each other.
- **Sync gate = `sync_check` (LSL001, calibrated on real controls).** `lip_gate.judge` maps SYNCED / WEAK / NOT_SYNCED to PASS / ACCEPT_WITH_FLAG / FAIL, a sung line that is WEAK or NOT_SYNCED to UNDETERMINED (held for a person, no paid redo), UNMEASURABLE never a pass. LSR001's `event_sync` moved to `lip_gate/event_sync.py` as an ADVISORY measure: recorded in the row as `advisory_event_sync`, never gating (its thresholds were synthetic-only; `calibrate_events.py` prints its real-control table, see the PR body).
- **Picture gate = `picture_gate` (LPG001, calibrated, enforced in the dispatcher).** `image_gate.check_image` no longer has close-up thresholds of its own: `picture_gate.check_numbers` judges face count, face height, roll, yaw, jawOpen, smile, teeth and sharpness; `image_gate` adds only size (720x1280, 9:16), occlusion, mouth shadow, light, background, same character and provenance. ONE rule set.
- **LSR001 non-gate improvements kept:** `lipsync_clips.choose_window`, `MAX_TRIES = 2`, `count_jobs`, `check_try_limit`, cost default `attempts=2`; `lip_gate.kling_prompt` ("sings" / "says"); the padded cut (0.30 s lead-in, 0.20 s tail) is the default input of try 1; try 2 only on a hard defect and only with a changed input (`retry_input`); `KEPT_BEST_OF_2` receipt rows with flag and mouth-strip path; `qc_check` accepts them and rejects more than 2 jobs; every paid submit through `load_governor.kie_request`; QC.md H4, QC checklist items 8 and 11 (keep-best carve-out), `delivery_checklist` Q8 aligned to the sync_check verdicts.
- **InfiniTalk:** the A/B third job is removed from the code. Every doc mention now says manual backup only, not on by default. `kling/ai-avatar-standard` is THE lip-sync model.
- Tests: `test_lip_gate_h2.py`, `test_image_gate.py`, `test_delivery_checklist.py`, `test_lipsync_closeup.py` updated; `test_event_sync.py` (advisory), `test_choose_window.py`, `test_lipsync_clips.py`, `test_sync_check.py`, `test_picture_gate_lpg001.py` kept.

## v2.9.0 (included) - LPG001 / LPG002 / LPG003 - lip-sync picture gate enforced in the dispatcher

Owner order (Trevor, 2026-10-08). No version bump. Two close-ups (30-Day Reset: face 28%, smile 0.62; Perfect Daughter: face 34%, teeth, roll -7.8) were never measured before paid Kling lip-sync.
- `lip_gate/picture_gate.py` + `picture_measure.py`: real mediapipe measurement, sha256 receipt (`<dir>/.lipgate/<sha256>.json`), one free crop, at most 2 paid regenerations through `kie_dispatch` (ledger cap, `load_governor.kie_request`), upload bound to the measured bytes. Same files, constants block and test as the 999-setup copy.
- LPG003 loosened the rules (Trevor: "loosen the checks so it's not as strict"): PASS / ACCEPT_WITH_FLAG / FAIL. FAIL only for face count not 1, face under 20%, |roll| over 20, |yaw| over 0.25, jawOpen over 0.30, sharpness under 60. Smile, teeth, small face, mild tilt are flags, never a paid regeneration. Calibrated so every Trevor-approved Kiesett version 2 and LeAnne Dolce picture passes or flags.
- LPG003 F14: `kling/ai-avatar-standard` (the locked lip-sync model) no longer hits `MODEL_NOT_ON_MENU`; it passes the F14 video lock and goes to the picture gate.
- `kie_dispatch.dispatch` hard-blocks lip-sync models without a PASS or ACCEPT_WITH_FLAG receipt (`LIPSYNC_PICTURE_NOT_GATED`).
- `lip_gate/install_face_model.py` + PREREQS entries + INSTALL step 2b: mediapipe and Google's `face_landmarker.task` (pinned sha256) ship with the skill; a missing/corrupt model refuses and names the install command.
- Test: `lip_gate/test_picture_gate_lpg001.py`.

## v2.8.5 - 2026-10-08 - G4-WIRE: target engine on Trevor's 5/10 band, wired into music_director + retake_manager

G4's engine was on main but (a) its accept line was the single 5-point grace with a
keep-the-closest-with-a-warning endgame, which G11 (Trevor order 12:30, consolidated order
1240 item 3) replaces, and (b) nothing called it. Skill bump v2.8.4 to v2.8.5.

- `core/target_engine`: `score()` now returns `worst_pts` and a `band`
  (ACCEPT / FLAG / REDO) judged by `spoken_share.judge_gap` -- one constants module, no
  second band. `steer()`: within 5 points = ACCEPT; past 5 up to 10 = ACCEPT_WITH_FLAG with
  the flag written into the receipt; after the bounded rounds past 10 = REDO with the closest
  take's measurements attached (REPLACES keep-the-closest-with-a-warning; the engine still
  never raises and never cancels -- REDO means regenerate). New exports: `VERDICT_FLAG`,
  `VERDICT_REDO`, `ACCEPT_PTS`, `FLAG_PTS`, `BAND_*`, `band_for_gap()`.
- Call path (order 1150 names music_director + retake_manager): `music_director.select_best`
  takes optional `target_metrics`/`targets` and judges the winning take through the engine
  (receipt block `target`: verdict / band / worst_pts / flags). `retake_manager.plan` takes
  optional `target_gap_pts` and rejects an in-band retake with `TARGET_IN_BAND` (within 5
  accept, 5-10 flag, past 10 the retake proceeds).
- Tests: `test_target_engine.py` proves accept/flag/redo at 5 / 6 / 10 / 14 points (both
  boundaries), all-spoken reject-and-regenerate to REDO, closest-of-N, single-source band
  constants, and both call paths; suite green with `HOME=$(mktemp -d)`.

## v2.8.4 - 2026-10-08 - Batch MGB005: song recipe v2, load governor, G5, G9, H10, G2, H3-TEST

One batch release of nine units. #1653 CIO002 run each check once per commit (push main-only, per-PR concurrency, 93 fast guards folded); #1678 G5 honest receipts (measured sung/spoken/rap/no-voice, target, gap, every take); #1681 song recipe v2, song length formula and song dispatcher; #1684 G9 words-fit preflight before spend and Suno duration with 15% headroom; #1685 H10 each line's voice must fit the character on screen; #1687 H3-TEST fps policy (30 fps master, Kling pass-through, per-segment duplicate gate); #1688 KIE rate limit reference; #1689 G2 the builder enforces the lint it ships; #1690 load governor (machine-wide heavy-job gate, bounded ffmpeg, stage cleanup, KIE pacing). Integration: the song dispatcher sends every generation through the load governor (new requests use the 20 per 10 s bucket, a 429 is resubmitted).

## v2.8.3 - 2026-10-08 - Batch MGB004: F3, G8, G1, F16, W4-PROOF, doubled lip-sync, user model choice, orchestrate-only

One batch release of eight units (#1674 F3 lipsync_cuts, #1675 G8 audio shares, #1676 user model choice, #1677 orchestrate-only and no silent failure, #1679 F16 video model gate, #1680 W4-PROOF, #1682 G1 delivery map, #1683 doubled lip-sync and image gate). Entries below are each unit's own notes. Skill 75 is now v2.8.3.

### Doubled lip-sync and the lip-sync image gate (#1683)

Owner order (Trevor, 2026-10-08). No version bump in this unit.

- **Doubled lip-sync, more pieces not longer ones.** A 60 s ad carries 6-8 clips of 4-6 s
  (30-40 s in all, was 15-20 s), scaled linearly with ad length, no clip over 6 s. One source:
  new `core/lipsync_clips.py` (the operator's length-formula module is not on main; swap
  `scale()` when it lands). `shot_planner/face_speaks.py` (band, planner: every sung hook, the
  spoken opener and closing first, each cut to 6 s) and `final_assembler/lipsync_coverage.py`
  (E6 floor: 50% of runtime, 6 clips per 60 s) follow it; the old 15-20 s plan now FAILS.
- **Spend.** `lipsync_clips.check_budget` refuses loudly past the cap, unknown price or unknown
  cap; the price card refuses a clip over 6 s (`LIPSYNC_CLIP_OVER_CAP`); price-menu snapshot and
  every doc that held 15-20 s updated.
- **Lip-sync image gate** `lip_sync/lip_gate/image_gate.py`: runs on every source picture before
  any paid job (`run_gate` now requires `source_image` and `image_check`); measurable checks
  (size, 9:16, face-box share 30-45%, frontal pose, mouth open ratio, occlusion, light, shadow,
  background, same character, sharpness, provenance); unmeasured = refused. Prompt template
  `closeup_prompt()` makes the picture this way.
- Tests: `test_lipsync_clips.py`, `lip_gate/test_image_gate.py`, `extensions/test_lipsync_cap.py`;
  H2, H4, E6 tests updated to the doubled numbers.

## v2.8.2 - 2026-10-08 - G3b: sung detector v2

The sung detector no longer reads gap-free speech as sung (unit #1666). Skill bump v2.8.1 to v2.8.2.

## v2.8.1 - 2026-10-08 - Batch MGB002: LPC001, BND001, W-G-003 (G3), SPK001

One combined release of four units (#1654, #1655, #1656, #1659), one skill bump from v2.8.0 to v2.8.1. Each unit's own entry follows.

### Lip-sync close-up in every reference set (LPC001)

Same change as 999-setup drama-song-ad-factory 2.7.13. Owner order (Trevor, 2026-10-08): every
character gets a close-up where the lips can clearly be seen, because the lip-sync step works
best from it.

- `catalog_calculator.image_plan`: reference set is 7 per character (3 angles, 3 expressions,
  1 `lipsync-closeup`); image count and cost estimate include it.
- `lip_gate.run_gate(source_image=)`: Kling avatar attempts and the InfiniTalk A/B use the
  close-up as source image by default. `lip_gate.check_reference_set`: a set with no close-up,
  or one whose mouth is not clear, fails.
- SKILL.md rule; test `lip_sync/lip_gate/test_lipsync_closeup.py` (mocked, $0);
  `catalog_calculator/test_image_plan_i3.py` updated.

### SPK001: spoken share cut to 20-25%, singing judged against voice time (builds on BND001 / #1655)

Trevor, 2026-10-08: "Okay, let's go to your recommendation that cut it to about 20-25%." Why: Suno turns spoken lyric lines into long talking, and the old targets did not add up (spoken 35-40% of runtime plus a music-only intro and end card left at most about 50% for singing, never the 55-60% goal). Six chapter songs came back 15-30% sung.

- `core/spoken_share` (the one G10 constants set): `SPOKEN_TARGET_PCT` 45 -> 22.5 (band 20-25); redo edges `SPOKEN_MIN_PCT` / `SPOKEN_MAX_PCT` 12.5 / 32.5 (target -/+ 10, reporting only, no absolute floor); `SUNG_TARGET_PCT` = 77.5 (75-80), now a share of VOICE time, sung / (sung + spoken): a music-only intro, gaps and the end card never count against it. New `sung_of_voice_pct`, `check_sung_of_voice`, `LYRIC_SPOKEN_WORD_PCT` = (15, 18), `spoken_word_budget`, `check_spoken_word_budget`; `check_plan` also judges sung-of-voice.
- `final_assembler/sung_vocal_guard`: sung coverage is sung / (sung + spoken) from the 12.4 timing map (`spoken_section_ids` names the spoken sections); default target 77.5. Only other hard reject stays: no sung stretch of 6 s.
- `lyric_writer.spoken_word_budget`: spoken lines budgeted at about 15-18% of the lyric words. `suno_recipe.score_take` judges sung-of-voice and passes the spoken-share flag through. `music_styles`, the `spoken_share_card_docs` card line and docs wording, the `intake_book` spoken-share menu range, `target_engine` notes, SKILL.md, the choice-card spec and the QC checklist carry the new numbers.
- Trevor's band on both numbers: within 5 accept, 5 to 10 accept with a flag, over 10 redo. Hard reject only: no sung stretch of 6 s.
- Tests: spoken 22% accept / 31% flag / 37% redo; sung of voice 76% accept / 69% flag / 60% redo; a 10 s intro plus 5 s end card is not penalized. Same rule in 999-setup drama-song-ad-factory 2.7.17.


### BND001: sung share judged only by Trevor's band; H6 first real singing 15% (supersedes #1637)

Trevor, 2026-10-08: "It's not an absolute 55% or 20% ... within about 5 percentage points" and "We always want to try to be within 5% of the goal. Once you get past 5%, 5% to 7% gets a flag. Once you get past 10%, it's got to be redone." Batch #1652 had kept a hard 55% sung floor (E7-AMEND); that contradicted him.

- `final_assembler/sung_vocal_guard`: `MIN_SUNG_COVERAGE` (the 55% hard floor) and the `min_coverage` / `goal` arguments are removed. Sung share is judged ONLY against the ad's own sung target (`target=`, or `sung_target` / `sung_target_pct` on the choice card, default `spoken_share.SUNG_TARGET_PCT`): within 5 points accept, over 5 up to 10 accept with a flag, over 10 redo (`SUNG_COVERAGE_LOW`). The only other hard reject stays H8's: no sung stretch of 6 s (`VOCAL_MISSING`).
- `core/spoken_share`: one G10 constants block holds the target and band numbers (`ACCEPT_PTS`, `FLAG_PTS`, `FIRST_SUNG_TARGET_PCT`, `SUNG_TARGET_PCT`, `NO_REAL_SINGING_STRETCH_S`).
- H6 (#1637) merged with H8: `check_first_sung` measures the first real singing (first sung stretch of 6 s or more) as a share of runtime against the 15% target with the same band (accept 10-20%); `FIRST_SUNG_WITHIN_SECONDS` is retired. Adds `steer_first_sung`, `segments_from_sung_stretches`, `lyric_writer.steer_opening`, and the card and docs wording.
- Tests: 50 vs target 60 flag, 48 vs 60 redo, 57 vs 60 accept, no floor, no 6 s sung stretch redo, first sung 18% accept / 22% flag / 27% redo.

### W-G-003 (G3) calibrated sung detector

- Added `scripts/core/singing_detector/` (detector, `__init__`, self-test): measures sung seconds per second and per line from the isolated vocal stem (pitch stability, voicing continuity, note alignment; ffmpeg + numpy, no ASR, no spend, Part D load guard). Every share it returns carries `source: measured` and is never computed from section labels. Calibrated against the reference fixtures (bsw sung lines, O3 spoken lines). Test: `scripts/core/singing_detector/test_singing_detector.py`.

## v2.8.0 - 2026-10-08 - Batch MGB001: Part H (H1-H5, H8, H9, H7, H11-H14), Part I (I1-I8), G4/G6/G12, E7-AMEND

One combined release of every unit below (each unit's own entry follows, unchanged except one heading level deeper). The H6 unit (#1637) is held out of this batch: it conflicts with H8 (#1635) in `spoken_share` and ships separately.

<!-- #1627 -->
### #1627: v2.6.1 - 2026-10-08 - H14 song files in every delivery

- Added `delivery_variants/song_files.py`: builds the full mastered mix as MP3 320 kbps + WAV named after the ad (plus the instrumental pair when one exists), lists them in `delivery-receipt.json` and `README.md`, and `check_song_files` fails a delivery missing any of them. New `song_files` QC check in `qc_gate` and `qc-schema.json`. Test: `scripts/core/delivery_variants/test_song_files_h14.py`.

<!-- #1628 -->
### #1628: [v2.6.1] - 2026-10-08 - Part H H11: delivery checklist Q8-Q11

The final QC gate 4 delivery checklist (G7, check `delivery_checklist`) grows
from 7 to 11 measured questions: Q8 lip-sync measured (offset <= 0.05 s,
correlation >= 0.55 and >= 0.25 above the wrong-audio control, no frozen face
> 0.75 s), Q9 first-sung % of runtime (goal 15%), Q10 pictures match words
(shot / Suno time / line / match, no slow-motion above 1.15x), Q11 every
numeric goal judged by Trevor's band (within 5 accept; over 5 to 10 accept
WITH a flag shown in the receipt; over 10 REDO, never keep the closest). Q2
uses the same band. No new gate or framework.

<!-- #1629 -->
### #1629: [v2.6.2] - 2026-10-08 - Part H H2 measured lip-sync gate

- New `scripts/core/lip_sync/lip_gate/`: every lip-sync clip is measured
  against the FINAL MIX envelope. PASS needs |offset| <= 0.05 s, correlation
  >= 0.55 AND >= 0.25 above a wrong-audio control, no frozen face > 0.75 s.
  Below it: regenerate once with better input (single clean line, front-facing
  tight crop, still image), then InfiniTalk only through a one-time single-line
  A/B that keeps whichever measures better; still failing = `FAIL_REPLACE`.
  Numbers ride the receipt row; `qc_check` fails a missing or failed row.
- Test: `lip_sync/lip_gate/test_lip_gate_h2.py` (shifted clip fails, good clip
  passes, A/B once per run). Assembler/Q8 wiring is H11's.

<!-- #1630 -->
### #1630: [v2.6.1] - 2026-10-08 - Part H H13: cross-fades vs words

`first_word_s` per segment shrinks the fade into a lip-sync clip to end >= 0.1 s before its first word; gates FADE_COVERS_FIRST_WORD and LONG_GAP_CUTAWAY (inner gap > 0.5 s must be held on one lip-sync clip). Test `scripts/core/final_assembler/test_fade_words_h13.py`.

<!-- #1631 -->
### #1631: [v2.6.1] - 2026-10-08 - Part H H12: no hand-written pipeline scripts

- New `scripts/core/final_assembler/master_provenance.py`: the assembler receipt
  now carries `produced_by` (module `final_assembler.assembler`) and
  `master_sha256`; `check_master_provenance(run_dir, master)` FAILS a run whose
  master has no matching skill receipt, or whose run folder holds a script that
  calls ffmpeg or writes captions itself (the Kiesett `edit/final.py` case).
  `master_provenance_qc_record` emits the `final_edit` record for `qc_gate`.
- Test: `scripts/core/final_assembler/test_master_provenance_h12.py`.

<!-- #1632 -->
### #1632: [v2.6.1] - 2026-10-08 - Part H H1 lip-sync stem offset

- New `scripts/core/lip_sync/stem_offset/`: `measure_offset` (envelope
  cross-correlation, offset > 0 = the vocal stem runs LATE vs the full mix;
  Kiesett measured +0.066 s) and `cut_plan` (cut the stem at mix word start +
  offset minus lead-in; place the clip at the line's real Suno start minus
  the lead-in, never re-timed).
- `final_assembler.validate_lipsync_placement` (gate `LIPSYNC_RETIMED`): a
  lip-sync segment carrying `lip_lead_s` must sit within one frame of its
  line start minus that lead. Runs in `assemble()` after the E5 atomic gate.
- Tests: `lip_sync/stem_offset/test_stem_offset_h1.py`,
  `final_assembler/test_lipsync_placement_h1.py`.

<!-- #1633 -->
### #1633: [v2.6.1] - 2026-10-08 - Part H H5: pictures match the words

- New `scripts/core/shot_planner/timestamp_plan.py`: `plan_from_timestamps` (shots from REAL Suno timestamps; planned timings refused), `match_table` / `pictures_match_gate` (shot / time / line / match, `PICTURE_LINE_MISMATCH`), `check_stretch` (no slow motion above 1.15x, `SLOWMO_OVER_LIMIT`).
- Assembler `h5_gates`: blocks both before any render; the receipt carries the stretch rows and the match table.
- INSTRUCTIONS.md: stage order is audio, timestamps, shot plan, pictures.
- Test: `python3 scripts/core/shot_planner/test_timestamp_plan_h5.py`.

<!-- #1634 -->
### #1634: [v2.6.1] - 2026-10-08 - H9 readable intake card

- New `scripts/core/choice_card/intake_card/`: builds the six intake questions
  (length, music style, video style, video model, spend limit, storyboard
  approval) as one block per question, one numbered option per line,
  RECOMMENDED marked, blank line between questions, a closing "how to answer"
  line. Plain text so no sender strips line breaks; split between questions
  under Telegram's limit; exact `openclaw message send` argv and Bot API body.
- `factory.py card` prints the raw card (Claude Code chat) or send payloads.
- Intake and book `question_message` now use the same layout (they were a
  single `"\n".join`, no blank lines).
- Test: `choice_card/intake_card/test_intake_card_h9.py`.

<!-- #1635 -->
### #1635: [v2.6.1] - 2026-10-08 - H8: one singing rule, one tolerance band

- The only hard reject when singing was chosen is "no real singing" (no
  6-second sung stretch). Constant `NO_REAL_SINGING_STRETCH_S` lives in
  `scripts/core/spoken_share/spoken_share.py` (the Part G constants module)
  and is read by the plan check, the sung-vocal guard and the lip-sync check.
- Every share, first-sung, length and lip-sync-seconds goal uses Trevor's
  band (`ACCEPT_PTS=5`, `FLAG_PTS=10`): within 5 accept, over 5 up to 10
  accept WITH A FLAG in the receipt, over 10 REDO (never keep the closest).
  `check_share`, `check_first_sung`, `check_plan`, `sung_vocal_guard` and
  `lipsync_coverage` return `flags` for the receipt.
- Flagged outputs: share verdict `FLAG` (accepted); a flagged lip-sync or
  sung-coverage result passes and carries the flag text.

<!-- #1636 -->
### #1636: [v2.6.3] - 2026-10-08 - Part H H4 every speaking face is a lip-sync clip + coverage target

- New `scripts/core/shot_planner/face_speaks.py`: `check_face_speaks` lists
  every shot where a face is visibly speaking (shot / time / line / lip-sync)
  and fails `FACE_SPEAKS_NO_LIPSYNC` for any that is not a lip-sync clip of
  that character's own line (`LIPSYNC_WRONG_FACE` for a lip-sync clip whose
  speaker is not on screen). Back of head, hands, another character or an
  off-screen narrator are the allowed alternatives.
- `plan_lipsync_lines` picks enough own-face lines to reach the lip-sync
  target (15-20 s in a 60-90 s ad, scaled by runtime, with the 5-point
  grace); `check_coverage_band` is the QC measurement
  (`LIPSYNC_COVERAGE_BELOW_BAND`). Part E E6 floors are unchanged.
- Assembler: `face_speaks_gate` runs when timeline `lines` carry `speaker`;
  segments then declare `faces_on_screen` (and `speaking_faces`), a missing
  declaration fails closed `FACE_DATA_MISSING`.
- Test: `shot_planner/test_face_speaks_h4.py` (Kiesett S01/S02/S08 flagged,
  planner reaches the target, band measured, assembler gate).

<!-- #1638 -->
### #1638: [v2.6.4] - 2026-10-08 - Part H H7: captions use the approved words + protected names

Kiesett's Stop Stale ad captioned "the house went still" for "Stale": the lyric
sheet itself said "still" (136 Suno requests), Suno sang it, the caption copied
the sheet. Fixed at the source.

### Added
- `scripts/core/protected_names.py` (+ `test_protected_names_h7.py`): sheet BUILD
  gate, sung-take words check, sheet-text captions timed from Suno timestamps,
  caption QC. Codes `PROTECTED_NAME_CHANGED`, `PACKET_LINE_REWRITTEN`,
  `PROTECTED_NAME_SUNG_WRONG`, `CAPTION_MISMATCH`, `CAPTION_SOURCE_NOT_SHEET`.

### Changed
- `lyric_writer.validate_lyrics`: brief `packet_lines` + protected names reject a changed name or rewritten packet line.
- `music_director.build_generate_request(..., protected=)`: no Suno request from a bad sheet.
- `music_qc.check_song_qc(..., protected=)`: a take that sang a protected name wrong FAILS.
- `delivery_variants.checks.check_captions(..., protected=, text_source=)`: speech-to-text source or any mismatch FAILS.
- `QC.md` / `SKILL.md`: H7 gate row and rule.

<!-- #1642 -->
### #1642: [v2.6.1] - 2026-10-08 - G12 Suno song recipe is the default for every Suno style

- New `scripts/core/suno_recipe/` (module + tests): one gate every Suno
  style goes through. Style text carries the sung/spoken map, the lyric sheet
  needs a repeated sung hook built from the client's own words, singing starts
  early (15% of runtime target, 5/10 band), and a take is judged only from
  measured segments, never labels.
- `music_director.build_generate_request` takes `style_id` and `client_text`
  and refuses a raw Suno style prompt that skipped the recipe.
- Only the Velvet Voiceover id (`velvet_voiceover`) is exempt.
- `SKILL.md` and `references/choice-card-spec.md` gain the "Suno song recipe" section.

<!-- #1643 -->
### #1643: [2.6.1] - 2026-10-08 - Part I I5: clean endings, never "drops off a cliff"

- New `scripts/core/ending_qc/`: `with_clean_ending` adds an `[Outro]` section, a final
  `[Resolve on final chord]` tag and "natural resolved ending" style words to every sung
  song request (`music_director.build_generate_request`); `check_ending` measures the last
  2 s of the master (audio level must decay, last word not cut, picture fades to the end
  card, end card 4-5 s and finished by target length minus 2 s).
- Done-when test: `python3 scripts/core/ending_qc/test_ending_qc.py` (abrupt cut fails,
  resolved ending passes).

<!-- #1644 -->
### #1644: [2.6.1] - 2026-10-08 - Part I I2 scenes must match the song and the faces

- New `scripts/core/scene_match/`: each shot carries line, meaning, place and action, and face
  emotion at storyboard time (`check_cards`); after clips exist, sampled frames are checked
  against them (`qc_scene_match`). A scene that is off-topic, or a smiling face under a pain
  line, fails, and only the failing shots are regenerated. A shot with no sampled frames never
  passes unseen. Test: `python3 scripts/core/scene_match/test_scene_match_i2.py`.
- Includes `scripts/core/face_emotion/` (Part G G6) which it builds on.
- `SKILL.md` gains the "Scenes must match the song and the faces" section.

<!-- #1645 -->
### #1645: [v2.6.2] - 2026-10-08 - Part I I6 character library

- New `scripts/core/character_library/`: after a character is approved, one question ("Do you want to save <character> to your character library so you can reuse them in future ads?"), then a name; saves reference images, description and voice notes under the client's own data folder; later cards list "Use a saved character?".
- `factory.py character` subcommand (ask, save, list, use, card); `card --client-dir` adds the saved-character question where the H9 intake card exists.
- Test: `scripts/core/character_library/test_character_library_i6.py` (save + reuse round trip).

<!-- #1646 -->
### #1646: [v2.6.1] - 2026-10-08 - I3 storyboard pictures

- Per main character the planner now lists a reference set (front, three-quarter,
  side, plus neutral, sad-tired and happy-relieved faces) and one keyframe picture
  per shot per shape, all before any video. Same image model as before.
- The cost estimate counts these pictures (Skill 74 price, no local rates) and the
  choice card shows an Images line with the added reference-picture cost.
- Up to 6 main characters; none or more fails closed. Test:
  `catalog_calculator/test_image_plan_i3.py`.

<!-- #1647 -->
### #1647: [v2.6.6] - 2026-10-08 - I7 one question at a time

- `intake_card.conversation(replies)` and `factory.py card --step --reply ...`:
  the intake is a conversation. Each message holds one question, a
  one-sentence why, numbered options one per line, the RECOMMENDED option with
  its reason; then it waits. After the sixth answer, a recap and a request for
  "yes"; a line number reopens just that question. Same code in claude-nine
  and OpenClaw (Telegram: `--format openclaw-json`).
- Test: `choice_card/intake_card/test_intake_step_i7.py`.

### #1647: [v2.6.1] - 2026-10-08 - H9 readable intake card

- New `scripts/core/choice_card/intake_card/`: builds the six intake questions
  (length, music style, video style, video model, spend limit, storyboard
  approval) as one block per question, one numbered option per line,
  RECOMMENDED marked, blank line between questions, a closing "how to answer"
  line. Plain text so no sender strips line breaks; split between questions
  under Telegram's limit; exact `openclaw message send` argv and Bot API body.
- `factory.py card` prints the raw card (Claude Code chat) or send payloads.
- Intake and book `question_message` now use the same layout (they were a
  single `"\n".join`, no blank lines).
- Test: `choice_card/intake_card/test_intake_card_h9.py`.

<!-- #1648 -->
### #1648: [v2.6.5] - 2026-10-08 - Part I I1: captions spell-checked; exact website asked and kept

The client's website was misspelled in the captions ("wakeuphappysis.com").

### Added
- `protected_names.check_spelling`: every caption word must be a real word
  (bundled `english_words.txt.gz` plus simple endings) or a protected word
  (names, brands, the client's website). An unknown word fails QC
  (`CAPTION_MISSPELLED`) with the word shown. Wired into
  `delivery_variants.checks.check_captions`.
- `protected_names.check_website`: the exact address must appear verbatim in the
  lyrics, captions and end card (`WEBSITE_NOT_VERBATIM`).
- Intake asks "What is the exact website address you want people to go to?" when
  the ad sends people to a website; stored as `website` and as a protected word.
- Test: `scripts/core/test_caption_spelling_i1.py`.


### #1648: [v2.6.4] - 2026-10-08 - Part H H7: captions use the approved words + protected names

Kiesett's Stop Stale ad captioned "the house went still" for "Stale": the lyric
sheet itself said "still" (136 Suno requests), Suno sang it, the caption copied
the sheet. Fixed at the source.

### Added
- `scripts/core/protected_names.py` (+ `test_protected_names_h7.py`): sheet BUILD
  gate, sung-take words check, sheet-text captions timed from Suno timestamps,
  caption QC. Codes `PROTECTED_NAME_CHANGED`, `PACKET_LINE_REWRITTEN`,
  `PROTECTED_NAME_SUNG_WRONG`, `CAPTION_MISMATCH`, `CAPTION_SOURCE_NOT_SHEET`.

### Changed
- `lyric_writer.validate_lyrics`: brief `packet_lines` + protected names reject a changed name or rewritten packet line.
- `music_director.build_generate_request(..., protected=)`: no Suno request from a bad sheet.
- `music_qc.check_song_qc(..., protected=)`: a take that sang a protected name wrong FAILS.
- `delivery_variants.checks.check_captions(..., protected=, text_source=)`: speech-to-text source or any mismatch FAILS.
- `QC.md` / `SKILL.md`: H7 gate row and rule.

<!-- #1650 -->
### #1650: [v2.6.7] - 2026-10-08 - I8 sung hook and repeat formula

- New `scripts/core/sung_hook/` (module + tests). Every sung style gets ONE
  hook (4-10 words, client's own words, protected names exact), sung
  `clamp(1 + floor(L / 25), 2, 12)` times (L = delivered seconds). First hook
  by 15% of runtime, last at 90%, rest evenly spaced.
- `suno_recipe.check_lyric_sheet` / `prepare` / `guard_request` take
  `length_s` and enforce the exact count; `music_director.build_generate_request`
  passes it through. `suno_recipe.hook_target` returns 0 for the exempt
  Velvet Voiceover style.
- `suno_recipe.score_take` measures how many hooks were actually sung (Suno
  aligned words + detector segments): count met = accept, one short = accept
  with a flag, two or more short = regenerate. The receipt carries hook text,
  target, measured count and times.
- `SKILL.md` gains the "Sung hook" section.

### #1650: [v2.6.1] - 2026-10-08 - G12 Suno song recipe is the default for every Suno style

- New `scripts/core/suno_recipe/` (module + tests): one gate every Suno
  style goes through. Style text carries the sung/spoken map, the lyric sheet
  needs a repeated sung hook built from the client's own words, singing starts
  early (15% of runtime target, 5/10 band), and a take is judged only from
  measured segments, never labels.
- `music_director.build_generate_request` takes `style_id` and `client_text`
  and refuses a raw Suno style prompt that skipped the recipe.
- Only the Velvet Voiceover id (`velvet_voiceover`) is exempt.
- `SKILL.md` and `references/choice-card-spec.md` gain the "Suno song recipe" section.

<!-- #1651 -->
### #1651: [v2.6.1] - 2026-10-08 - Part I I4: masters end 2 seconds early

- New `scripts/core/master_length/`: a chosen length L delivers a master of at
  most L-2 seconds (60 to 58, 30 to 28, 90 to 88, 120 to 118). Hard maximum,
  not a band. Song, shot plan and end card are planned to L-2; QC (`final_edit`
  record, reason `MASTER_TOO_LONG`) fails any longer master.
- Intake summary now carries `master_max_s`.
- Enforcement (repair): `qc_gate.evaluate(..., master={chosen_length_s, measured_s})`
  is mandatory whenever `final_edit` is required (CLI `--chosen-length-s`,
  `--master-s`); a 62 s master on a 60 s video fails `MASTER_TOO_LONG`, a missing
  master is `MASTER_LENGTH_MISSING`. `final_assembler.assemble(chosen_length_s=)`
  (or timeline key `chosen_length_s`) refuses an over-long plan, an end card that
  starts at or after L-2, and an over-long rendered file, before spend where it
  can. `shot_planner.bind_plan(chosen_length_s=)` rejects a song or shot past L-2
  (`SONG_PAST_MASTER_END`, `SHOT_PAST_MASTER_END`).

---

## v2.6.1 - 2026-10-08 - H14 song files in every delivery

- Added `delivery_variants/song_files.py`: builds the full mastered mix as MP3 320 kbps + WAV named after the ad (plus the instrumental pair when one exists), lists them in `delivery-receipt.json` and `README.md`, and `check_song_files` fails a delivery missing any of them. New `song_files` QC check in `qc_gate` and `qc-schema.json`. Test: `scripts/core/delivery_variants/test_song_files_h14.py`.


## [Unreleased] - 2026-10-07 - v2 BUILD-OUT packaged into this copy

Regenerated `scripts/core/` from the canonical build core — 120 files, tree sha256 `351575f76825de6df4bfd2c7520dcc9ed06631e5f3a040a5f246149fabe735e7` (both copies byte-identical).

Packaging unit `BO-PKG2-U2` regenerated `scripts/core/` from the canonical
build core (`<build>/core/`) so this copy carries the version 2 BUILD-OUT
outputs, byte-identical to the Claude-Nine / Claude Code copy; entrypoint,
exit map and the 14 production modules unchanged.

### Added (BUILD-OUT owned outputs, whole modules)
- `audio_c3/extend/`, `audio_c3/voice_packs/`, `batch_mode/`,
  `catalog_calculator/extensions/`, `choice_card/looks/`, `intake_book/`,
  `kie_dispatch/unknown_resolution/`, `shot_planner/speaker_check/`,
  `style_bibles/canvas_to_3d/`, `style_bibles/canvas_to_life/`
- import closure those modules need to load: `audio_c3/voice_casting.py`,
  `choice_card/stl_voice_guard/`, `lip_sync/narrator_rule/`, `music_styles/`,
  `qc_voice_match/` (root package only), `spoken_share/`, `style_bibles/hybrid/`,
  `style_defaults/`, `voice_velvet_echo/`

### Changed
- `SKILL.md` exit-map note: removed the dead build-tree test path
  (`tests/distribution-parity/run_parity.sh`), plan G5 packaging step.

### Not shipped here, on record
- `core/docs_rename_velvet_voiceover/` — build-tree sweep tool carrying
  operator absolute paths; build tooling, never client skill code.
- `core/lip_sync/kling_first/`, `core/qc_voice_match/octave_guard/` — not yet
  present in build core (unit outputs still in their lanes).
- `core/kie_dispatch/kie_dispatch.py` — packaging owned by unit `A2-R2-U2`,
  whose canonical module is under fix; shipped only from the fixed core.

`version:` stays `v2.3.0`: the release bump belongs to the V2-W4 ship lane.


## [v2.4.3] - 2026-10-07 - audio-fix wave D36-D38: no-echo rule, spoken-share band, reverb-tail QC, pitch ban, Sketch-to-Life voice guard

### Added
- `scripts/core/audio_c3/no_echo/` - every Suno request (song and voice-pack) stamps dry close-microphone vocals plus the seven negative tags and refuses spacious / cinematic / choir in spoken parts (D22a).
- `scripts/core/smp/no_echo/` - the same no-echo rule on the Skill 35 weekly drama-song request.
- `scripts/core/qc_reverb_tail/` - QC measures the reverb tail after each spoken line; a ringing line fails QC (D22a).
- `scripts/core/qc_voice_match/pitch_ban/` - pitch ban guard for voice-match QC.
- `scripts/core/spoken_share/` - spoken share retarget: target 45 percent, band 40-55, rap counts as spoken, first sung line within about 10 seconds (D15).
- `scripts/core/spoken_share_card_docs/` - card and docs lines carrying that spoken-share rule.
- `scripts/core/smp/spoken_share/` - the same spoken-share rule on the Skill 35 planner wave (D15).
- `scripts/core/choice_card/stl_voice_guard/` - Sketch to Life is always All Suno; Velvet Voiceover is refused for that look (D25).

## [v2.4.2] - 2026-10-07 - fix: style bible compiler routes its prompt cap through the one KIE enforcer

### Fixed
- `scripts/core/product_style_bible/bible.py` imports `shared-utils/kie_prompt_enforcer.py` and calls `KPE.check(...)` (kind verbatim, ceiling only) on every compiled prompt, as the KIE prompt enforcer guard (rule 12) requires of a declared gate module. The cap values (20000 sunburst, 25000 legacy) and compile behavior are unchanged.

## [v2.4.1] - 2026-10-07 - docs: PACKAGING-DECISION wording

### Fixed
- `PACKAGING-DECISION.md` no longer cites the retired legacy updater path literally (single-update-skills-entrypoint guard, section C). No behavior change.

## [v2.3.0] - 2026-10-07 - docs: directive 2.1 document set landed

### Added
- `INSTRUCTIONS.md` - operating instructions: the mandatory TYP gate, the
  eleven build-directive section 25 runtime steps, the shared
  intake/preflight controls and section 24.3 intake rules, exit-code
  envelope contract, section 17 QC non-negotiables, and the skill's
  never-do list.
- `EXAMPLES.md` - twelve verified examples using only the implemented
  entrypoint (`scripts/core/intake_preflight/factory.py`) and the repo's
  shipped `check-skill-prereqs.sh` / `qc-prereqs-json.sh`; every shown
  outcome was executed and captured (intake ok/waiting/rejected, resume
  ok/parked, preflight pass/tool-unavailable/credential-missing/
  approval-missing/approval-expired/reference-outside, checker rc 0/2/3,
  lint PASS on 24 PREREQS.json files).
- `QC.md` - install-time rubric (10 points, gate 8.5), file/version and
  credential checks, control-layer smoke, 9-question knowledge check,
  and the campaign QC gate checklist mapped to build-directive sections
  17.1-17.9 with anti-patterns.
- `INSTALL.md` - first install (`install.sh` one-liner / checkout),
  update (`update-skills.sh`), canonical credential paths, helper-skill
  install law (section 2.4), verification steps, run-storage root,
  version bookkeeping and rollback via installer backups.
- `CORE_UPDATES.md` - surgical allowlist (AGENTS.md / TOOLS.md /
  MEMORY.md) with exact text blocks; core persona files never touched.
- `PREREQS.json` - executable prerequisite mirror per INSTALL-CONTRACT
  Rule 16: skills 01/02/07/24/25/27/30/46/66/67/68/74 (folder form),
  KIE_API_KEY (required), FISH_AUDIO_API_KEY (optional), python3 and
  ffmpeg binaries, faster-whisper advisory note; every required `satisfy`
  names the action, canonical secrets path and config command.

### Changed
- `DEPENDENCY-MANIFEST.md` - helper dependency table now carries version
  + git tree hash per helper pinned at source commit
  `cc2e595f1de87c1411dfb44e9542f0017f3b5acc` (2026-10-07), cross-linked
  to `PREREQS.json` as the executable mirror. Scaffold notes for
  release-time pins (W5-02) are preserved.

---

## [v2.3.0] - 2026-10-06 - feat: OpenClaw distribution (W3-02)

- Initial Skill 75 folder: `SKILL.md` (route boundaries, control
  entrypoint contract, section 24.3 intake rules, paid-generation
  boundaries, department wiring), `scripts/core/` shared canonical core
  (state_store, artifact_graph, spend_ledger, job_recovery, contracts,
  acceptance-profile, intake_preflight, qc_gate, timing_guard),
  `DEPENDENCY-MANIFEST.md`, `THIRD_PARTY_NOTICES.md`,
  `skill-version.txt` = v2.3.0. Exit-table correction and CI guard
  repairs followed the same day (commits `2dd07e409`..`37a6926c8`).

---

Format follows `46-kie-callback-relay/CHANGELOG.md`: newest first,
`## [version] - date - type: summary`, sections `### Added` /
`### Changed` / `### Fixed` / `### Tests`.
