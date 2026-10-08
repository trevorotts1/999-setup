# Changelog: drama-song-ad-factory

## [2.7.15] - 2026-10-08 - Port onboarding skill 75 core into 999 (999-port)

Four port commits from onboarding 75-drama-song-ad-factory (origin/main 1c5d829f), merged onto 2.7.14. Where the port and main overlapped, main wins (BND001 band, H3 30 fps, LPC001 lip-sync close-up); the port's own additions stay.

- Ported: `final_assembler` E2-E7/M7 pieces main lacked, `shot_planner` E2/E4 (shot beats, no-reuse), `kie_dispatch` submit/wait/save + modality budgets + resolver zero-settle evidence, `smp/initial_questions`, and operator paths removed from 6 core files.
- Tests: `final_assembler/conftest.py` supplies the `tmp_root` fixture so `test_assemble_timeout_default_and_override`, `test_gate_wiring` and `test_marker_validation` run under pytest as well as as scripts.

## [2.7.14] - 2026-10-08 - Sung share judged only by Trevor's band, no absolute floor (BND001)

Owner order (Trevor, 2026-10-08): "It's not an absolute 55% or 20% ... within about 5 percentage points" and "Once you get past 10%, it's got to be redone."

- `final_assembler/sung_vocal_guard`: the hard 70% floor (`MIN_SUNG_COVERAGE`) is removed. Sung share is judged ONLY against the ad's own sung target (`target=`, or `sung_target` / `sung_target_pct` on the choice card; default `spoken_share.SUNG_TARGET_PCT` = 100 - spoken target = 55): within 5 points accept, over 5 up to 10 accept with a flag, over 10 redo (`SUNG_COVERAGE_LOW`). The only other hard reject is H8's: no sung stretch of 6 s (`VOCAL_MISSING`).
- `core/spoken_share`: the G10 constants block is the one set (`TARGET_ACCEPT_PCT` / `TARGET_FLAG_PCT` / `REAL_SINGING_STRETCH_S` are the same numbers as `ACCEPT_PTS` / `FLAG_PTS` / `NO_REAL_SINGING_STRETCH_S`); adds `SUNG_TARGET_PCT`; `judge_gap(measured, target)` also returns `verdict`.
- Tests: 50 vs target 60 flag, 48 vs 60 redo, 57 vs 60 accept, no floor, no 6 s sung stretch redo, first sung at 18% accept / 22% flag / 27% redo. Same rule ships in onboarding skill 75 v2.8.1.

## [2.7.13] - 2026-10-08 - Lip-sync close-up in every reference set (LPC001)

Owner order (Trevor, 2026-10-08): "make sure you create a close-up one where their lips can
clearly be seen, because when you're doing the lip sync, they really like that."

- `catalog_calculator.image_plan`: reference set is now 7 per character (3 angles, 3
  expressions, 1 `lipsync-closeup`); the image count and cost estimate include it.
- `lip_gate.run_gate(source_image=)`: Kling avatar attempts and the InfiniTalk A/B all take the
  close-up as their source image. `lip_gate.check_reference_set`: a set with no close-up, or a
  close-up whose mouth is not clear (injected detection), fails.
- SKILL.md rule; tests `lip_sync/lip_gate/test_lipsync_closeup.py` (mocked, $0) and updated
  `catalog_calculator/test_image_plan_i3.py`.

## [2.7.12] - 2026-10-08 - Red suites repaired (R75001)

Five skill 75 suites failed on a clean main. Causes and fixes:

- `audio_c3/test_lyric_timing_f17.py`: the scan it calls, `scripts/qc-no-local-asr.sh`, was never
  committed (the F17 test arrived in e6690bf without it). Added the script: exit 2 and name the file
  when a run folder or the core imports `whisper` / `openai_whisper`, or imports `faster_whisper`
  anywhere but `audio_c3/lyric_timing.py`.
- `intake_preflight/test_factory_next.py`: `factory.py next` reads `references/stage-runbook.md`,
  which was never committed. Added the 12-row runbook (same stage order as `batch_mode` STAGES).
- `kie_dispatch/test_all_at_once_f5.py`: SKILL.md never carried the F5 rule the test and the
  `submit_all_ready` docstring cite. Added the "Submit all ready jobs at once" section.
- `tests/test_launcher_plain_claude.py`: compared the repo core with the operator Mac's
  `~/.claude-nine` install. It now compares the core each repo adapter resolves.
- `tests/test_master_provenance_h12.py`: Part I I4 (85854ba) made `qc_gate.evaluate` require the
  measured master length when `final_edit` is required, so the fixture returned BLOCKED, not FAIL.
  The test now passes a valid master (60 s chosen, 57 s measured); the provenance rule is unchanged.

## [2.7.11] - 2026-10-08 - Part H H6 first real singing is a measured 15% target

Same change as onboarding Skill 75 v2.6.5: `core/spoken_share` replaces the
fixed-seconds `FIRST_SUNG_WITHIN_SECONDS = 10` label check with
`FIRST_SUNG_TARGET_PCT = 15`, measured on the vocal stem (first sung stretch of
at least 6 s) and judged with the owner's 5/10 band: within 5 points accept,
over 5 up to 10 accept with a FLAG line for the receipt, over 10 redo.
`steer_first_sung` / `lyric_writer.steer_opening` steer the lyric-sheet builder.
Tests: `spoken_share/test_spoken_share.py`, `lyric_writer/test_steer_opening.py`.
`core/smp/spoken_share` becomes the same thin re-export of core `spoken_share`
that the onboarding copy already is (its old 999-only copy kept its own
`FIRST_SUNG_WITHIN_SECONDS = 10` and shadowed the canonical names, which broke
`music_styles`); its test follows.

## [2.7.10] - 2026-10-08 - Part I I4: masters end 2 seconds early

- New `scripts/core/master_length/` (same module and tests as OpenClaw skill 75 v2.6.1): a chosen
  length L delivers a master of at most L-2 seconds (60 to 58, 30 to 28, 90 to 88, 120 to 118).
  Hard maximum, not a band. Song, shot plan and end card are planned to L-2; QC (`final_edit`
  record, reason `MASTER_TOO_LONG`) fails any longer master.
- Intake summary now carries `master_max_s`.
- Enforcement (repair): `qc_gate.evaluate(..., master={chosen_length_s, measured_s})` is mandatory
  whenever `final_edit` is required (CLI `--chosen-length-s`, `--master-s`); a 62 s master on a 60 s
  video fails `MASTER_TOO_LONG`, a missing master is `MASTER_LENGTH_MISSING`.
  `final_assembler.assemble(chosen_length_s=)` (or timeline key `chosen_length_s`) refuses an over-long
  plan, an end card at or after L-2, and an over-long rendered file. `shot_planner.bind_plan(chosen_length_s=)`
  rejects a song or shot past L-2.

## [2.7.9] - 2026-10-08 - I8 sung hook and repeat formula

- New `scripts/core/sung_hook/` (same module and test as OpenClaw skill 75 v2.6.7). Every sung
  style gets ONE hook (4-10 words, client's own words), sung `clamp(1 + floor(L / 25), 2, 12)`
  times, first by 15% of runtime, last near the end. `suno_recipe` takes `length_s` and enforces
  the count; `suno_recipe.score_take` measures sung hooks (accept / accept with flag / regenerate).
  Velvet Voiceover is exempt. `SKILL.md` gains the "Sung hook" section.

## [2.7.8] - 2026-10-08 - I3 storyboard pictures

- Same change as OpenClaw skill 75 v2.6.1: per main character a reference set (front,
  three-quarter, side, neutral, sad-tired, happy-relieved) plus one keyframe picture per
  shot per shape; the cost estimate counts them and the choice card shows an Images line.
  Test: `scripts/core/catalog_calculator/test_image_plan_i3.py`.

## [2.7.7] - 2026-10-08 - Part I I1: captions spell-checked; exact website asked and kept

- `core/protected_names.py` gains `check_spelling` (every caption word is a real word or a protected
  word; unknown word fails `CAPTION_MISSPELLED` with the word shown) and `check_website` (the exact
  address verbatim in lyrics, captions and end card). Bundled `core/english_words.txt.gz`.
- `delivery_variants.checks.check_captions` runs the spelling check.
- Intake asks "What is the exact website address you want people to go to?" when the ad sends people
  to a website; stored as `website` and as a protected word.
- Test: `core/test_caption_spelling_i1.py` (same module and test as OpenClaw skill 75 v2.6.5).

## [2.7.6] - 2026-10-08 - I7 intake asked one question at a time

- `intake_card.conversation(replies)` and `factory.py card --step --reply ...` (same module and
  test as OpenClaw skill 75 v2.6.6): each message holds one question, a one-sentence why,
  numbered options one per line, the RECOMMENDED option with its reason, then waits. After the
  sixth answer, a recap and a request for "yes"; a line number reopens just that question.
- `INSTRUCTIONS.md` and `references/choice-card-spec.md` section 2.2 tell claude-nine to ask
  this way. Test: `scripts/core/choice_card/intake_card/test_intake_step_i7.py`.

## [2.7.5] - 2026-10-08 - I2 scenes must match the song and the faces

- New `scripts/core/scene_match/` (same module and test as OpenClaw skill 75): each shot carries
  line, meaning, place and action, face emotion at storyboard time; after clips exist, sampled
  frames are checked against them (off-topic scene or a smile under a pain line fails) and only
  the failing shots are regenerated.
- Adds `scripts/core/face_emotion/` (Part G G6), which `scene_match` builds on.
- `SKILL.md` gains the "Scenes must match the song and the faces" section.

## [2.7.4] - 2026-10-08 - Part I I6 character library

- New `scripts/core/character_library/`: after a character is approved, one question ("Do you want to save <character> to your character library so you can reuse them in future ads?"), then a name; saves reference images, description and voice notes under the client's own data folder; later cards list "Use a saved character?".
- `factory.py character` subcommand (ask, save, list, use, card); `card --client-dir` adds the saved-character question where the H9 intake card exists.
- Test: `scripts/core/character_library/test_character_library_i6.py` (save + reuse round trip).

## [2.7.3] - 2026-10-08 - Part I I5: clean endings, never "drops off a cliff"

- New `scripts/core/ending_qc/` (same module and test as OpenClaw skill 75 v2.6.1): every sung
  song request gets an `[Outro]`, a `[Resolve on final chord]` tag and resolved-ending style
  words (`music_director.build_generate_request`); `check_ending` measures the last 2 s of the
  master (level decays, last word not cut, picture fades to the end card, 4-5 s end card done by
  target length minus 2 s). Test: `python3 scripts/core/ending_qc/test_ending_qc.py`.

## [2.7.2] - 2026-10-08 - G12 Suno song recipe is the default for every Suno style

- New `scripts/core/suno_recipe/` (same module and tests as OpenClaw skill 75 v2.6.1): style
  text carries the sung/spoken map, the lyric sheet needs a repeated sung hook built from the
  client's own words, singing starts early (15% of runtime, 5/10 band), takes are judged from
  measured segments only, never labels.
- `music_director.build_generate_request` takes `style_id` and `client_text` and refuses a raw
  Suno style prompt that skipped the recipe (kept alongside the H7 `protected` check).
- Only the Velvet Voiceover id (`velvet_voiceover`) is exempt.
- `SKILL.md` and `references/choice-card-spec.md` gain the "Suno song recipe" section.

## [2.7.1] - 2026-10-08 - Part H H3: 30 fps master, Kling pass-through, H3 interpolation

`scripts/core/` synced from the onboarding H3 core (commit 4685158b7); the H13 fade-vs-words
and H12 master-provenance code in `final_assembler/assembler.py` and the H2
lip_gate, H14 song_files, qc_gate.py and qc-schema.json changes are kept.

- Master 30 fps; Kling clips pass through untouched; MiniMax H3 24 fps
  clips motion-interpolated to 30 (never the plain `fps` filter); per-segment
  mpdecimate duplicate check (2% cap, `hold` exempt); master duplicate gate
  now measures the rendered file. See the onboarding CHANGELOG v2.6.1.
- `SKILL.md` frame-rate rule added (E1 wording updated); `VERSION` and
  frontmatter `version:` 2.6.11 -> 2.7.1 (follows onboarding `skill-version.txt`).

## [2.6.11] - 2026-10-08 - H9 readable intake card

- New `scripts/core/choice_card/intake_card/` (same module as the OpenClaw
  copy): the six intake questions, one block per question, one numbered option
  per line, RECOMMENDED marked, blank line between questions, closing "how to
  answer" line; plain text; split under Telegram's limit; exact
  `openclaw message send` argv and Bot API body.
- `factory.py card` prints the raw card; intake `question_message` uses the
  same layout. Test: `choice_card/intake_card/test_intake_card_h9.py`.

## [2.6.10] - 2026-10-08 - Part H H7: captions use the approved words + protected names

Same fix as onboarding Skill 75 v2.6.4 (Kiesett "Stale" captioned "still").
New `scripts/core/protected_names.py` + `test_protected_names_h7.py`: sheet
build gate, sung-take words check, sheet-text captions timed from Suno
timestamps, caption QC. Wired into `lyric_writer`, `music_qc`,
`delivery_variants` (byte-identical to canonical) and `music_director`
(`build_generate_request(packet_lines=, protected=)`; this packaged copy still
predates the F7 `words_match` guard, a full re-package from canonical is a
separate step).

## [2.6.9] - 2026-10-08 - Part H H4 every speaking face is a lip-sync clip

Same change as onboarding Skill 75 Part H H4: `scripts/core/shot_planner/face_speaks.py`
lists every shot where a face is visibly speaking and fails
`FACE_SPEAKS_NO_LIPSYNC` unless it is a lip-sync clip of that character's own
line; `plan_lipsync_lines` picks lines to reach the 15-20 s lip-sync target (5-point
grace) and `check_coverage_band` measures it. Test:
`shot_planner/test_face_speaks_h4.py`. The assembler wiring (`face_speaks_gate`)
ships with the onboarding core; this copy's assembler predates Part E, so it
lands with the next core resync.

## [2.6.8] - 2026-10-08 - Part H H1 lip-sync stem offset

- New `scripts/core/lip_sync/stem_offset/` (`measure_offset`, `cut_plan`):
  measures the vocal-stem vs full-mix offset (offset > 0 = stem LATE;
  Kiesett +0.066 s) and cuts/places lip-sync clips compensated, at the
  line's real Suno timestamp, never re-timed. Same files as onboarding
  skill 75 v2.6.1.
- `final_assembler`: plan carries `lip_sync_line_ids` / `lip_lead_s`; new
  gate `LIPSYNC_RETIMED` (`validate_lipsync_placement`) runs in `assemble()`.
- Tests: `lip_sync/stem_offset/test_stem_offset_h1.py`,
  `final_assembler/test_lipsync_placement_h1.py`.

## [2.6.7] - 2026-10-08 - H8: one singing rule, one tolerance band

`scripts/core/spoken_share/` (the constants module) now holds the single
singing rule (`NO_REAL_SINGING_STRETCH_S` = 6 s, the only hard reject when
singing was chosen) and Trevor's band (`ACCEPT_PTS=5`, `FLAG_PTS=10`):
within 5 accept, over 5 up to 10 accept WITH A FLAG, over 10 redo.
`check_share`, `check_first_sung` and `check_plan` use it and return `flags`.
Same files as the onboarding copy (skill v2.6.1). The sung-vocal guard and
lip-sync coverage modules are not in this distribution yet; they pick the
band up when they are ported.

## [2.6.6] - 2026-10-08 - Part H H5: pictures match the words

- New `scripts/core/shot_planner/timestamp_plan.py` (`plan_from_timestamps`,
  `pictures_match_gate`, `check_stretch`); the assembler blocks slow motion
  above 1.15x and picture/line mismatches before any render.
- INSTRUCTIONS.md section 6b: stage order audio, timestamps, plan, pictures.

## [2.6.5] - 2026-10-08 - Part H H11: delivery checklist (G7 + Q8-Q11)

Ships the final QC gate 4 delivery checklist (`scripts/core/delivery_checklist/`,
`references/QC-CHECKLIST-BEFORE-DELIVERY.md`, `delivery_checklist` check in
`qc_gate.py` and `qc-schema.json`), byte-identical to the onboarding copy
(skill 75 v2.6.1). 11 measured questions: the G7 seven plus Q8 lip-sync
measured (H2 numbers), Q9 first-sung % (H6), Q10 pictures match words (H5),
Q11 every numeric goal judged by Trevor's band (within 5 accept; over 5 to 10
accept with a flag shown in the receipt; over 10 redo).

## [2.6.4] - 2026-10-08 - Part H H12: no hand-written pipeline scripts

- New `scripts/core/final_assembler/master_provenance.py`; the assembler receipt
  carries `produced_by` and `master_sha256`; `check_master_provenance` fails a
  run whose master has no matching skill receipt or whose run folder holds an
  ffmpeg or caption script. Test: `tests/test_master_provenance_h12.py`.

## [2.6.3] - 2026-10-08 - Part H H13: cross-fades vs words

`final_assembler`: per-segment `first_word_s` shrinks the fade into a lip-sync clip to end >= 0.1 s before its first word; gates FADE_COVERS_FIRST_WORD and LONG_GAP_CUTAWAY. Test `scripts/core/final_assembler/test_fade_words_h13.py`.

## [2.6.2] - 2026-10-08 - Part H H2 measured lip-sync gate

Same change as onboarding Skill 75 v2.6.2: `scripts/core/lip_sync/lip_gate/`
measures every lip-sync clip (|offset| <= 0.05 s, correlation >= 0.55 and
>= 0.25 above a wrong-audio control, no frozen face > 0.75 s); regenerate with
better input, then a one-time single-line InfiniTalk A/B keeping whichever
measures better. Test: `lip_sync/lip_gate/test_lip_gate_h2.py`.

## [2.4.6] - 2026-10-08 - H14 song files in every delivery

- Core `delivery_variants/song_files.py` (shared with the OpenClaw copy): MP3 320 kbps + WAV of the full mix named after the ad, plus the instrumental pair if one exists, listed in `delivery-receipt.json` and `README.md`; `song_files` QC check fails a delivery missing them. Test: `scripts/core/delivery_variants/test_song_files_h14.py`.

## [2.4.5] - 2026-10-08 - version linked to the onboarding source (manual M5)

`VERSION` `1.0.0` -> `2.4.5`: this distribution now carries the
`skill-version.txt` version of the onboarding skill it was packaged from
(leading `v` dropped), so the fleet roll and the parity test can tell which
onboarding release a 999 user has.

packaged_from: c73637ddf1b59dda8f0e3168b3b904b1281f2b18

- `SKILL.md` frontmatter `version:` follows `VERSION` (change-control rule in
  `INSTALL.md` / `CORE_UPDATES.md`; asserted by `tests/test_parity_layout.py`).

## [Unreleased] - 2026-10-07 - v2 BUILD-OUT packaged into this copy

Packaging unit `BO-PKG2-U2` regenerated `scripts/core/` from the canonical
build core (`<build>/core/`) so this copy carries the version 2 BUILD-OUT
outputs, byte-identical to the OpenClaw copy; entrypoint, exit map and the
14 production modules unchanged.

Regenerated `scripts/core/` from the canonical build core — 120 files, tree sha256 `351575f76825de6df4bfd2c7520dcc9ed06631e5f3a040a5f246149fabe735e7` (both copies byte-identical).

### Added (BUILD-OUT owned outputs, whole modules)
- `audio_c3/extend/`, `audio_c3/voice_packs/`, `batch_mode/`,
  `catalog_calculator/extensions/`, `choice_card/looks/`, `intake_book/`,
  `kie_dispatch/unknown_resolution/`, `shot_planner/speaker_check/`,
  `style_bibles/canvas_to_3d/`, `style_bibles/canvas_to_life/`
- import closure those modules need to load: `audio_c3/voice_casting.py`,
  `choice_card/stl_voice_guard/`, `lip_sync/narrator_rule/`, `music_styles/`,
  `qc_voice_match/` (root package only), `spoken_share/`, `style_bibles/hybrid/`,
  `style_defaults/`, `voice_velvet_echo/`

### Not shipped here, on record
- `core/docs_rename_velvet_voiceover/` — build-tree sweep tool carrying
  operator absolute paths; build tooling, never client skill code.
- `core/lip_sync/kling_first/`, `core/qc_voice_match/octave_guard/` — not yet
  present in build core (unit outputs still in their lanes).
- `core/kie_dispatch/kie_dispatch.py` — packaging owned by unit `A2-R2-U2`,
  whose canonical module is under fix; shipped only from the fixed core.

`VERSION` stays `1.0.0`: the release bump belongs to the V2-W4 ship lane.

## [1.0.0] - 2026-10-06

Initial release: the Claude-Nine / Claude Code distribution of the BlackCEO
drama-song ad factory, built to directive section 2.2 (skill shape),
section 26 (both runtime adapters, one control entrypoint), and
section 35.2 (999 distribution process).

- Skill shape: `SKILL.md`, `INSTRUCTIONS.md`, `CHANGELOG.md`, `VERSION`,
  `references/`, `scripts/`, `tests/`, `assets/`, and the two runtime
  adapters `adapters/claude-nine/README.md` +
  `adapters/claude-code/README.md`. One skill folder; no second config root,
  no independently maintained duplicate.
- Same CLI as the OpenClaw distribution (W3-02): `scripts/core/` is a
  byte-identical packaged copy of
  `onboarding/75-drama-song-ad-factory/scripts/core/` — 15 files, tree sha256 `ccaacbfedc4d33cf47408fc1f7cdbb696b40e6be0341e0652294153a2fab419d`
  on both sides at packaging time (`__pycache__` excluded). Entrypoint:
  `scripts/core/intake_preflight/factory.py` (`intake` / `preflight`,
  JSON envelope, exit codes 0/1/2/3/4).
- References: `references/cli-contract.md` (envelope, arguments, reason
  codes, live-verified results) and `references/parity-contract.md`
  (what must match across distributions, source path, re-sync procedure).
- Registry: registered in `CONTROL/bundled-skills.txt` alongside
  `motion-video-plus`, so source presence becomes automatic installation
  (directive 2.4). `CONTROL/bundled-components.json` is release-manifest
  territory and is intentionally not touched by this unit.
- Tests: `tests/test_cli_smoke.py` (packaged CLI behavior) and
  `tests/test_parity_layout.py` (layout, registry, adapter hygiene,
  byte parity with the canonical core; reports `PARITY UNDETERMINED` when
  the canonical tree is absent instead of claiming a pass).
- Runtime: Claude-Nine adapter follows router laws and live catalog
  resolution with no hardcoded model table; plain Claude Code adapter keeps
  `claude` non-routed and never sets a separate config directory.
- Directive doc set complete (directive 2.1/2.2): `INSTALL.md` (registry-based
  install, verification, update and removal contract), `EXAMPLES.md`
  (intake/preflight/resume/injection-verified examples with exit codes),
  `QC.md` (shape, registry, parity, envelope, adapter hygiene, secrets and
  change-control checklist), `CORE_UPDATES.md` (regenerate `scripts/core/` from
  canonical, never hand-edit, contract-bump migration notes, lockstep rule),
  `PREREQS.json` (machine-readable prerequisites: Python 3 stdlib-only, shared
  config root, registry entry, approved storage root, authorization receipt,
  presence-only credentials, helper skills 46/66/67/68/74, FFmpeg, live model
  discovery, no committed secrets).
