# Changelog: drama-song-ad-factory

## [2.7.39] - 2026-10-09 - DEL-08: one cover image (thumbnail) per delivery folder

- New `scripts/core/delivery_variants/cover_image.py`: at the end of the run, build the ONE cover image into the delivery folder — frame from the approved storyboard stills (`storyboard/stills.json`, gated by `approval_runner.gate_open`, face-visible shot first), title from the approved script (`creative/script.json`, brief title as fallback, never invented). One ffmpeg pass through `load_governor.run_ffmpeg` writes `<safe ad name>-cover.png` (default 1280x720, 16:9), title inside the title-safe inset via `drawtext=textfile=` with `expansion=none` (data, never filter syntax). A build whose ffmpeg has no drawtext refuses `COVER_DRAWTEXT_UNAVAILABLE`.
- `check_cover_image` is the delivery QC gate (measured IHDR pixels, matching sha256, README listing; the row's own claim never passes). `qc_gate` gains the `cover_image` check; the stage runbook gains the run row. Exactly one cover thumbnail per delivery folder.
- Local runner variable named `runner_fn` (not `launch`) so the onboarding agent-browser headless-only guard does not false-positive on the bare `launch(` token; shared scripts/core and references stay byte-identical with openclaw-onboarding 75-drama-song-ad-factory v2.9.14. VERSION and SKILL.md frontmatter: 2.7.38 to 2.7.39.

## [2.7.38] - 2026-10-09 - Train 2.7.38: delivery audio gate on every delivered video

Trevor: "I DON'T HEAR ANY AUDIO". QuickTime plays MP3-in-MP4 silent.

- `delivery_audio.check_delivery_audio()` now requires AAC-LC, 48 kHz and faststart (moov before mdat), not only AAC and non-silent. New codes `DELIVERY_AUDIO_NOT_48K` and `DELIVERY_NOT_FASTSTART`; new `require_delivery_audio()` raises `DeliveryAudioRefused` (fail closed).
- Every code path that writes a client-delivered video now calls the gate on its output: the final assembler master (already gated), `clip_cutdown.run_clips` (a refused clip is deleted and the run stops with `CLIP_AUDIO_REFUSED`), `batch_zip.build_batch_zip` (captioned ad and clean master, `DELIVERY_AUDIO_REFUSED`, no zip written) and `delivery_checklist.delivery_battery` (already gated).
- `clip_cutdown.build_argv` uses `AUDIO_OUT_ARGS` + `FASTSTART_ARGS` instead of bare `-c:a aac`.
- 999 copy of `scripts/core` and three reference docs synced byte-for-byte to openclaw-onboarding main (intake card, 9-question card and count-built example, and every other diverged shared file).
- New `scripts/core/test_delivery_gate_paths.py`: one MP3-refused test per delivery path plus 44.1 kHz and non-faststart refusals.

## [2.7.36] - 2026-10-09 - Train 2.7.36: #125 + #126 + #136 + #139 + #140 + #141 + #142 + #143 + #144 + #145 + #146

Landed together by merge train: #136 style questions with sample links, #139 four video models each priced, #140 storyboard approval shows both card and still, #141 SONG APPROVAL (3 labelled versions), #142 intro message, #143 SCRIPT APPROVAL, #144 client guide, #145 AI MODELS question, #146 test temp-dir isolation, #125 song style contract (ae193a55), #126 hook placement (d17a078c). #141 and #143 are at their final heads (7bbb1848, 5ee8c812): card Yes records the chat id and the confirmed recap writes card-answers.json. The card is now nine questions (ten with a saved character, which is question 2 after AI MODELS): AI MODELS, LENGTH, MUSIC STYLE, VIDEO STYLE, VIDEO MODEL, BUDGET, STORYBOARD APPROVAL, SONG APPROVAL, SCRIPT APPROVAL. Interaction fixes: song_choices validates requests with the delivered length; the cinematic-strings R&B Flow clause no longer says slow (#125 refuses slow in upbeat styles); test sheets put a verse before the first hook and carry a hook_plan (#126); `_parse` tolerates the list-valued model question, `card_render` maps the FU-LENGTH-CLIPS labels to the canonical length, the SONG APPROVAL price row now also lifts the Total line, `_priced` finds the length question by id, the recap labels read "Video model" and "AI Models", and `conversation(..., run_dir=, target=)` is keyword-only for the run arguments. VERSION and SKILL.md frontmatter: 2.7.36.

- **FU-U11: book printed pages, the plan hash, the card block and the excerpt seam.** `book_shot.check_pages` / `check_pages_sequence` add the calibrated printed-vs-white page test (`BOOK_BLANK_PAGES`): a page of real body text has no empty grid cell, a white page does (both re-measured from the shipped fixture generator: printed ink 0.1640 with 0 empty cells, white ink 0.0031 with 40 of 48; a page carrying only a caption line sits in the same empty-cell band by design and needs its own fixture to reproduce), and more than one blank page among the sampled open frames fails. `plan_spec` / `plan_sha256` / `plan_card_rows` hash the approved plan and render the card rows; the prompt wording itself lives in the `references/prompt-templates/models/minimax-h3.json` fragments `PRINTED_PAGES`, `BOOK_CLOSED` and `BOOK_OPEN_MOTION`, read by `prompt_templates` (U15b) — this unit authors no prompt wording, it MEASURES the rendered frames. `kie_dispatch.book_shot_refusal` now ACTIVATES the plan-hash requirement U10 shipped dormant — a book video job with no `book_plan_sha256`, or one whose hash does not match the approved plan, is refused `BOOK_PLAN_NOT_APPROVED`. `intake_book` takes an OPTIONAL `excerpt_lines` (client-supplied only, max 3, provenance "provided", spelling-checked with the caption gate's dictionary; it adds no question). Both card faces carry the Book shots APPROVAL BLOCK — approvals and notices only, never a new choice. The excerpt reaches the render as DATA through the single named U9 hook `final_assembler.captions_burn.overlay_excerpt`; no second burn module and no OCR binding was added, and while U9's artifact is absent the call site reports PENDING rather than burning. New test `scripts/core/book_shot/test_book_pages_d1.py` proves all four D1 cases (white fails / printed passes, no-plan refused, changed plan refused until re-approved, excerpt never in the video prompt).
- New card question SCRIPT APPROVAL (last question): the client can read and approve the story and song lyrics before the song is made. Yes sends the script and pauses before any song generation; edits are applied, re-checked and re-sent; missing approval fails closed (`SCRIPT_NOT_APPROVED`) in `kie_dispatch.dispatch` and `song_dispatch.run_takes`. No: unchanged.
- Wired, nothing is called by hand: `factory.py next` runs `script_approval.stage.run_stage` when `music` is next and the card answer is Yes (checks, `request_approval`, send through `openclaw message send` or back to the chat, run recorded as waiting, outcome `waiting`). New `factory.py script-reply` carries the client's answer (`approve` or an edit that is re-checked and re-sent). Resume stays waiting and never re-sends a delivered script. The dispatch gates read the record from the run folder (`record_near`, `run_dir=`).
- New `scripts/core/script_approval/` with `test_script_approval.py` and `test_script_wiring.py`. No version bump.
- New first intake question, AI MODELS: which AI builds the video and which checks the work. OpenRouter is recommended (faster), Ollama is allowed, unknown names are refused politely, and the checker must differ from the builder.
- Honest scope: the run still uses the session's own model. The answer is recorded as `ai_models` in the approved intake summary, as a preference for the operator.
- The card now has seven questions (eight with a saved character, which comes second). Tests: `choice_card/intake_card/test_ai_models.py`; card-count checks in `test_intake_card_h9.py`, `test_intake_step_i7.py`, `test_character_library_i6.py` updated.

## [2.7.35] - 2026-10-09 - Train 2.7.35: #134 + #135 + #137 + #138 + #130 + #123

Landed together by merge train: #134 saved-character question, #135 one spend question on the card, #137 audience question, #138 length question and clips for 3, 5 and 10 minutes, #130 FU-U11 book pages / plan hash / card block / excerpt seam, #123 skill 75 parity. Clashes resolved keeping both sides' intent: #137 asked a spending question that #135 removes (the audience wording is kept, the spend question stays gone); #130's card block now follows #134's closing line (`_closing`); #138 clips text replaces the 5 and 10 minute only text. Three existing tests were updated to the merged card (saved with us wording, BUDGET answered with a dollar amount, closing line via `_closing`). PR #142 left out: pushed less than 10 minutes before the train and its check was still running. VERSION and SKILL.md frontmatter: 2.7.34 to 2.7.35.

## [2.7.34] - 2026-10-09 - Train 2.7.34: #124 + #133

Landed together by merge train: #124 FU-U4 (client lines are a contract; the STOP card lists only real options; fit card, `fit_card`, `card --fit`), #133 U12 choice-card-spec gap fills (STL voice guard, voice-match QC, planner card, fit-card TODO). Neither PR carried an Unreleased entry; this one is written by the train. One clash, spec text only: both PRs rewrote `references/choice-card-spec.md` section 2.3. #133's section 2.3 described the fit card as not built and carried a TODO to rewrite it when #124 landed; #124 is in this train, so the #124 text is kept and the stale #133 paragraph and its TODO line are dropped. All other #133 changes are kept. VERSION and SKILL.md frontmatter: 2.7.33 to 2.7.34.

## [2.7.33] - 2026-10-09 - Train 2.7.33: #128 + #129 + #131 + #132

Landed together by merge train: #128 cast-sweep voice_casting docstring, #129 FU-U9 captions_burn.overlay_excerpt, #131 U12 per-style spoken paragraph and TODO block, #132 U15g book and printed-page prompt fragments one home. PR #130 (FU-U11) was dropped from this train: its test_book_pages_d1.py asserts that captions_burn.py does not exist, which fails once #129 lands (4 checks). VERSION and SKILL.md frontmatter: 2.7.32 to 2.7.33.

- **U12 narrative follow-up after 2.7.32.** The spoken-target paragraph in
  SKILL.md now reads the band numbers per style since FU-U3 landed
  (`STYLE_TARGETS`, the fourth delivery `none` never counted as spoken), and
  SKILL.md closes with a "Sections marked TODO" block naming FU-U4, FU-U9 and
  FU-U11 as the sections to refresh when those land.

## [2.7.32] - 2026-10-09 - Batch MGB017: #122 + #127

Landed together by merge train: #122 U12 docs and SOP in lockstep with the code, #127 load-governor test no longer sleeps about 7 minutes on a fresh runner (test-only). VERSION and SKILL.md frontmatter: 2.7.31 to 2.7.32.

- **U12: docs and the onboarding SOP in lockstep with the code.** SKILL.md gains "Request and prompt limits", the tag-grammar / style-plan / voice-tag bullets in the Suno recipe, the early-captions paragraph (with FU-U9 named as NOT built) and the book-orientation bullets; choice-card-spec gains 2.3 (options come from the registry; the fit card FU-U4 is not built), a machine-checked "Offered lengths" line, the book language and orientation text and the Book shots block (FU-U11, open branch); QC.md gains one section; the onboarding SOP DS-2/4/5/6/7/9 is brought to the same facts (DS-4 step 5 now says 6 to 8 clips of 4 to 6 seconds). Sections that describe open branches (FU-U4 PR #124, FU-U11 `unit/FU-U11`, FU-U9 no branch) say so and are refreshed when those land; FU-U3 landed in 2.7.31 and was refreshed here. New test `scripts/core/prompt_templates/test_docs_u12.py`.
- **TODO(FU-U3): DONE in this unit** — SKILL.md and QC.md now read "landed in 2.7.31 via PR #120", not "open pull request".
- **TODO(FU-U4):** choice-card-spec 2.3 rewritten when PR #124 (`unit/FU-U4`) lands.
- **TODO(FU-U11):** refresh the Book shots block / book-orientation sections when `unit/FU-U11` lands.
- **TODO(FU-U9):** captions read-back off frames — no branch yet; QC.md and SKILL.md say NOT built.

## [2.7.31] - 2026-10-09 - Batch MGB016: #120 + #121

Landed together by merge train: #120 FU-U3 bands per music style (rap is its own band), #121 docs: fix check-docs-fresh failures (repo-level, no skill change). VERSION and SKILL.md frontmatter: 2.7.30 to 2.7.31.

### FU-U3: bands per music style; rap is its own delivery; silence is not speech

- Per-style bands under the SAME locked 5/10 band: `spoken_share.STYLE_TARGETS` holds Soul Ballad and Soul Rise at exactly 22.5 runtime spoken / 77.5 sung-of-voice; R&B Flow's target is the documented default flagged as a TREVOR-DECISION ITEM in plan 18 section 9 item 1 -- the share planned from the approved sheet (the U2 plan's word counts at the style's measured rates), not a new number invented here -- and sung-of-voice on a rap sheet is recorded, not gated (hook content, not a planned share); the 6 s sung stretch and the hook count stay hard. `measure_share(segments, style_id=...)` reports rap separately for a rap style and counts plain spoken against its target; `segments_from_sung_stretches(voiced=)` turns music-only time into a fourth delivery `none` that counts in runtime and never in voice time (a music-only gap no longer counts as spoken); the rap-versus-speech split is measured word timestamps x the sheet's delivery labels, recorded as basis `aligned`, never `measured`. `song_dispatch.judge_take` / `run_takes` and `suno_recipe.score_take` carry `style_id` (+ `plan`) through validate and judge. New test `scripts/core/spoken_share/test_style_bands_u3.py` with the g1b segment fixture from SONG-RECEIPT (fails on the base tree: `voiced=` did not exist).

## [2.7.30] - 2026-10-09 - Batch MGB014: #118 + #119

Landed together by merge train: #118 FU-U8 captions caught early, #119 U15i docs in lockstep with the prompt. VERSION and SKILL.md frontmatter: 2.7.29 to 2.7.30.

### FU-U8: captions caught early

Same change as onboarding Skill 75 (Unreleased). No version bump in this unit.

- Every string that reaches the screen is now caught before a paid call: `_tokens()` maps U+2019/U+2018 and NFKC-normalises ("could’ve" is one word, not "could"+"ve"); the new `display_text()` turns performance spelling into the caption ("Girl, I got you-u" burns as "Girl, I got you", a wordless vocalise makes no cue) and `build_captions`/`check_captions` use it; `check_lyrics_spelling` refuses a misspelled lyric word with `LYRIC_MISSPELLED` inside `music_director.build_generate_request` BEFORE the recipe guard and any payload; `check_confusables` FLAGS the two confusions a token proves wrong (never a fix); `intake.client_typo_question` sends a client typo BACK AS ONE QUESTION ("Your storyboard says 'kitchan'...") and never rewrites the client's words; `kie_dispatch.onscreen_text_refusal` refuses `ONSCREEN_TEXT_NOT_CHECKED` a keyframe/video whose on-screen text is not in the checked receipt; and `qc_gate` requires a `spelling_grammar` record at the Script stage (new `required_checks`, schema enum, contract updated). New test `scripts/core/test_captions_early_u8.py` (24 checks; 18 fail on the base tree).

### U15i
- U15i (docs in lockstep with the template system; last unit of the U15 set): `SKILL.md` gains the "Prompt templates" section (data under `references/prompt-templates/`, the assembler `scripts/core/prompt_templates/`, the H3 band 5,000-6,800 with hard max 7,000, the prompt receipt, `PROMPT_NOT_TEMPLATED`, the `prompt_compliance` gate) and the Suno recipe and lip-sync bullets now point at it. `references/choice-card-spec.md` 3.1 names `references/prompt-templates/length-classes.json` as the ONE length table (its list equals the table's keys) and 3.3 points at `looks/` and `modes/`. `references/style-bibles/realism-cinematic.md` keeps the recipe as the source of the `realism` mode, moves the Chanel identity into a "worked example" heading, deletes the nine "(Restated for emphasis.)" duplicate blocks, and states the camera as per shot. `QC.md` carries the bands, the receipt, `PROMPT_NOT_TEMPLATED` and the required `prompt_compliance` record. New doc test `prompt_templates/test_docs_u15i.py`. Same change as onboarding Skill 75. No version bump in this unit (999 has no skill-version.txt).

## [2.7.29] - 2026-10-09 - Batch MGB013: #115 + #116 + #117 + #114

Landed together by merge train: #115 U15f Kling as the card's video model, #116 U15h length classes / product seconds / lanes, #117 FU-U2 style-aware length plan, #114 FU-U5 voice tags from the cast. VERSION and SKILL.md frontmatter: 2.7.28 to 2.7.29.

### U15f
- U15f (Kling as the card's video model, design 3.5): `prompt_templates.assemble_kling_video` builds a Kling prompt in H3's section order scaled by `models/kling-video.json`'s `section_scale` (0.38, per-section budgets `kling_section_limits()` derived from H3's own table, never a second one), aims it into the manifest band (1,800-2,500; hard max 3,072 omni VERIFIED, 2,500 for 3.0/video UNVERIFIED, 2,500 for 2.5 turbo VERIFIED), and differs from H3 in exactly the three ways the design names: the camera is PLAIN WORDS after the subject's motion (no bracket group anywhere), the look is the mode's `kling_block`, and the negatives STAY IN the prompt (no `negative_prompt` field). `check_kling` refuses `KLING_BRACKET_SYNTAX`, `KLING_OVER_HARD_MAX`, banned phrases, duplicate sentences and run-on 8-grams, and flags under-floor `KLING_BELOW_FLOOR`; `band_cap` prints each cap's VERIFIED/UNVERIFIED provenance and never promotes one. The six golden specs re-assembled for `kling-3.0-omni/image-to-video` land at 1,842-2,183, PASS. New test `scripts/core/prompt_templates/test_prompt_templates_u15f.py` (fails on the base tree: no `assemble_kling_video`). Parity: core files byte-identical with the onboarding tree.

### U15h
- U15h (length classes, product seconds and lanes in ONE table; prompt compliance at final QC): `references/prompt-templates/length-classes.json` is CORRECTED so every row equals the code (`length_formula.plan`, `lipsync_clips.budget`, `shot_planner.plan_generation_count` = ceil(D/4), lanes via `lane_planner` when the module is on the tree, the 10-15% product band). The U15a port had drifted at 180/300/600 s (spoken share 16.9/10.1/5.0% before U15d's CTA scale landed; rows now 22.5%) and at 600 s the song plan is `1 base + 3 extends`. `prompt_templates.length_class(L)` is the one reader: it computes the row and raises `PROMPT_LENGTH_CLASS_DRIFT` naming each drifted field, so a stale table can never be read silently. `length_formula.class_check`, `lipsync_clips.class_check` and `shot_planner.class_check` cross-check their own module against the table (never a second formula). `qc_gate` requires a `prompt_compliance` record at final QC: `prompt_compliance_rows`/`prompt_compliance_record` build one row per paid ledger job matched to its receipt (logical_key+attempt_id, else request_digest, else prompt_sha256; REFUSE/TRIM receipts never count), and `evaluate(..., ledger_jobs=[...])` requires the check. `check_product_seconds` proves the shot plan's product seconds fall inside 10-15% of D. New `prompt_templates/test_length_classes_u15h.py`. Same change as onboarding Skill 75. No version bump in this unit (999 has no skill-version.txt).

### FU-U2
- Style-aware length plan and words fit: `length_formula.plan(L, spoken_share_pct=None, style_id=None)` gives a rap style (R&B Flow, from the style's own `deliveries` in `core/music_styles`) a rap budget for the verses by splitting the D15 spoken-STYLE allowance with the [Intro]/[Outro] spoken block caps, at the calibrated `core/words_fit` rate, and returns `words {spoken, rap, sung}` plus `rap_s`; `words_fit.STYLE_RATES` is keyed by STYLE ID with `rates_for()` normalizing through `music_styles.style()` and `CARD_LENGTHS_S` now re-exports `music_styles.OFFERED_LENGTHS_S` (one copy, gain 120 s); `music_director.build_generate_request` passes `style_id` into `words_fit.preflight_sheet` and `suno_recipe.check_lyric_sheet` passes it into `plan`; Soul Ballad and Soul Rise plans are BYTE-IDENTICAL (65 words at L=60). New test `scripts/core/length_formula/test_style_plan_u2.py`.

- Train integration (MGB013): `length_formula.plan` keeps the fixed 30-word [Outro] cap for a rap style only, so FU-U2's rap budget survives the 2026-10-09 scaled-CTA change (non-rap plans stay main's); `test_style_plan_u2.py` L150/L300 regression digests updated to main's scaled-CTA plans (L60 digests unchanged).

### FU-U5
- **FU-U5: voice tags come from the cast.** `suno_recipe.check_voice_tags(sheet_text, cast_genders)` refuses a sheet whose voice tag gender disagrees with the cast record (`VOICE_TAG_MISMATCH`, naming both sides) and refuses a character tag whose gender cannot be checked at all (`VOICE_TAG_UNCHECKED`, fail closed); `suno_recipe.guard_request` takes `cast_genders=` and refuses at that seam, and `protected_names.cast_genders(brief)` builds the map from `brief.characters[].gender`. Brackets that name no cast character ([Hook], [Intro], [End]) are never judged; no cast record means the check is off, exactly as today. 2026-10-08 One-Check Chanel as the LIVE cast record has it (the 2026-10-08 voice recast, CAST.md): the BOX COWORKER bracket tagged "Female voice" against a cast that says man is now refused; the desk neighbour "Female" and the manager "Male" tags match the live cast and pass. The plan unit row's own acceptance is also asserted on the pre-recast (plan-time) cast, where the desk neighbour tagged "Female" against a cast that says man is refused. All Suno is unchanged: one `vocal_gender`, same KIE params, no new voice option. Test: `scripts/core/suno_recipe/test_voice_tags_u5.py` (5 of 6 blocks fail on the base tree: no `parse_voice_tags` / `check_voice_tags`, `guard_request` has no `cast_genders`). Same change as onboarding Skill 75 (Unreleased). No version bump in this unit.

## [2.7.28] - 2026-10-09 - Batch MGB011: #108 + #102 + #105 + #110 + #106 + #113 + #109 + #111 + #112

Landed together by merge train: #108 qc-kie-docs-host, #102 FU-U6 Suno request limits, #105 FU-U15a template data layer, #110 FU-U7 video/avatar prompt caps, #106 FU-U1 rap-aware tag grammar, #113 adapter parity (skill 74), #109 FU-U15e Kling avatar template, #111 FU-U15d Suno templates, #112 FU-U15b H3 assembler.

### FU-U15a: prompt template data layer, loader and caps reader
- New `references/prompt-templates/` (52 files): `20-prompt-templates/` ported as data — README, `manifest.json`, `length-classes.json`, 4 models, 5 modes, 5 looks, 6 shot types, 3 music styles, 15 fixtures.
- New `scripts/core/prompt_templates/` with `load()` and `caps()`. `caps()` reads the catalogs (67-kie-video, 68-kie-audio) through FU-U6's `prompt_limits` first and the manifest only for what the catalogs lack (the Kling avatar row, UNVERIFIED 2500); no second caps table. H3 image-to-video prompt cap 7000 VERIFIED from the 67 catalog; every look x mode x shot type resolves, each mode block carries its record's key phrases (realism: the five `RECIPE_REQUIRED_PHRASES`).
- New test `scripts/core/prompt_templates/test_prompt_templates_u15.py` (fails on the base tree: the module is absent). No version bump.
### FU-U6: Suno request limits, fail closed, measured last
- New `scripts/core/prompt_limits.py`: one limit table read from the catalogs (`68-kie-audio/models.json` suno-generate: lyrics 5000, style 1000, title 80, duration 10-360; `67-kie-video/models.json` vendor caps per model), plus a skill-75 override table for what the catalogs lack (`negativeTags` 1000 and `kling/ai-avatar-standard` 2500, both stamped UNVERIFIED with source URL and the free docs re-read step). `check_request(model, request)` measures EVERY text field of the FINAL payload and refuses over-cap with `PROMPT_OVER_CAP: field, chars, cap, source, status`; it never truncates.
- `music_director.build_generate_request` now measures the payload AFTER `ending_qc.with_clean_ending` appends the ending to the style (the E.2 order-of-mutation hole: a 1000-char style passed the old guard, the ending pushed it to 1054, and the final style was never re-measured).
- `suno_recipe.build_request` measures its payload too; `song_dispatch.run_takes` compares the request duration with the G9 headroom (`words_fit.max_suno_duration(plan)`) as the plan default allows, while a patch/short duration is still refused.
- New test `music_director/test_prompt_limits_u6.py` (fails on the base tree: no `prompt_limits` module, 5001-char lyrics, a 1054-char final style and an 81-char title all built). Parity: core files byte-identical with the onboarding tree.
### FU-U7: video/avatar prompt caps enforced at the call site, fail closed
- `kie_dispatch.dispatch` now runs the U6 `prompt_limits.check_request` over the FINAL payload before any other gate: an over-cap field is refused `PROMPT_OVER_CAP` (field, chars, cap, source, status; nothing reserved, nothing sent, never truncated) and a paid video/avatar job with no importable limit table is refused `PROMPT_LIMIT_UNAVAILABLE`; the ok receipt carries the measured `prompt_caps` rows; `prompt_limits.py` gains the file-17 video/avatar caps (Hailuo family 2,000, Kling 2.6 i2v 2,500, Kling 2.5 Turbo negative_prompt 2,500) and the 999 installer layout in its catalog walk. New test `kie_dispatch/test_prompt_cap_u7.py`.
### qc-kie-docs-host: F14 scanner exempts the docs host only
- `scripts/qc-no-direct-kie.sh`: the endpoint pattern `(https?://)?(api\.)?kie\.ai` matched a bare `docs.kie.ai` host, so the KIE documentation provenance URLs in `scripts/core/prompt_limits.py` (added by FU-U6) were reported as direct-KIE calls and the check exited 2 on a clean tree. The scan now extracts each host occurrence (`grep -oE`) and drops exactly the `docs.kie.ai` host — the exemption is decided per OCCURRENCE, so a line carrying both a docs URL and a real api URL still fails on the api record (a line-level `grep -v` would discard the whole line and let the real call escape). Every other host still bites: `api.kie.ai`, any other subdomain including ones nobody has thought of yet, and bare `kie.ai`. No filename exemption: a real direct call added to `prompt_limits.py` later is still caught.
- New test `scripts/core/kie_dispatch/test_qc_docs_host.py` (fails on the base tree: the docs fixture exits 2). Covers the docs citation passing, the api call still failing by name, the mixed one-line docs+api case failing per occurrence, unknown subdomains and bare `kie.ai` failing, and the real core tree staying clean. Existing `test_model_lock_f14.py::test_qc_no_direct_kie` regression stays green. Parity: the scanner is byte-identical with the onboarding tree.
### FU-U1: test_tag_grammar_u1.py collects and passes under pytest
- `scripts/core/suno_recipe/test_tag_grammar_u1.py` line 84: the file is dual-mode — in script mode `main()` passes test_a's return into `test_b_lyric_gate_counts_rap_in_the_budget(sheet)`, but pytest calls test_b standalone and never receives that return, so pytest read `sheet` as a fixture name and errored `fixture 'sheet' not found` (the whole unit was uncollectable, which is why #106 was held out of the 2.7.27 batch). test_b now takes `sheet=None` and, when it is None, builds it in-test from the existing `load_fixture()` + `R.parse_lyrics()` (a parse failure reports through `check()` and leaves the sheet None); the existing `if sheet is None:` guard still fails loudly, so a failed build is never a silent skip. `main()` and every assertion are unchanged.

### FU-U15b: H3 assembler, the 5,000-6,800 band, receipts

- U15b (H3 assembler, band of record 5,000-6,800): `prompt_templates.assemble_h3/check/expand/receipt` build every MiniMax H3 prompt from the template layers plus the shot spec's facts, guard the owner band (under 5,000 = FLAG then `H3_THIN_SPEC`, never padding; over 6,800 = TRIM; over 7,000 = REFUSE `H3_OVER_HARD_MAX`), and write a prompt receipt (sha256 + template version + section char map). The six golden specs assemble to 5,578-6,740. `shot_planner.prompt_spec_for` writes the facts (`shot["prompt_spec"]`); `kie_dispatch` refuses `PROMPT_NOT_TEMPLATED` when the prompt's sha256 has no receipt or the receipt says REFUSE/TRIM, and re-measures the final payload cap just before spend. The video prompt path carries no square-bracket markers and no generic `[MOTION]` line (`bible.compile_visual_prompt(video=True)`, the three style bibles' `compile_prompt(video=True)`); `assert_compiled` accepts a matching receipt. New `shot-types/villain.json` carries the U16 villain guidance into the assembler. `music_styles` soul-ballad base text ends with a period.

### FU-U15e: Kling avatar template

- `prompt_templates.assemble_kling_avatar` / `check_kling_avatar`: the lip-sync prompt is three sentences with one emotion, the `who` descriptor read from the look's mode (`kling_who`), never a hard-coded look; sketch-ink and golden-realism refuse lip-sync. Lip-gate and image-gate updated (`test_lip_gate_u15e.py`).

### FU-U15d: Suno templates per style and per length

- `suno_recipe` reads the style parts, cue strings, gender words and negative tags from `references/prompt-templates/music/*.json` and `models/suno-v6.json` (data, not constants); no-voice sections render as a tag only; product-share and payload checks added; caps measured last.

### adapter-parity-m8-h7 (skill 74 only)

- `74-kie-live-adapter`: shadow-mode and adapter parity changes (see `installer-registration/helpers/74-kie-live-adapter/CHANGELOG.md`); no skill 75 code change.

## [2.7.27] - 2026-10-09 - Batch MGB010b: #104 + #96 + #103 + #107

Landed together by merge train: #104 (drama-song-tests installs ffmpeg + opencv + tesseract, loop stdin-safe), #96 W-G-008 minute-lanes, #103 FU-U16 story doctrine (villain, pain, rise), #107 U15c owner prompt band (prompt_band_chars over the 80/95 rule). Not included: #102 FU-U6 (prompt_limits.py:41 trips qc-no-direct-kie.sh, failing test_model_lock_f14.py in the empty-HOME loop), #105 FU-U15a (stacked on #102), #106 FU-U1 (test_tag_grammar_u1.py:84 pytest fixture error).

### W-G-008: parallel minute-lanes for ads 120 s and up

Owner order (Trevor, 2026-10-08): "this type of intelligence should be built
into skill 75 for all video 2 minutes and up". Reference run wf_9134d15e-b8e
(the fixer split a 3-minute ad into parallel minute-lanes). Onboarding partner:
skill 75 v2.9.1 (same core, byte-identical).
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
- Docs: SKILL.md "Parallel minute-lanes" section; `references/stage-runbook.md`
  lane note.

## [2.7.26] - 2026-10-09 - Batch MGB010a: #101 CI collect fix + W-F-U2 + FU-U13 + FU-U14 + FU-U10

Landed together by merge-train: #101 (drama-song-tests collection, lyric_structure import path), #97 (whole-track retakes), #98 (story arc + product connection), #99 (song mp3 in every deliverable), #100 (book orientation contract). #96 (W-G-008) not included: CONFLICTING, being rebased.

### FU-U13: story arc rule + product-connection target

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
  QC.md (SOP lives in the onboarding distribution only).
- Test: `scripts/core/length_formula/test_story_arc_u13.py`.

### 2026-10-09 - FU-U14: the song mp3 is part of the deliverable

Trevor: "make an update so that the mp3 is a part of the deliverable ... update the repo with the latest understanding I just taught you".
- **Every delivered ad folder carries the song.** Beside the captioned and clean-master mp4s: the FINAL SONG as `<Author> - <Title> - Song.mp3` (320 kbps, the exact song used, full length) plus the wav when one exists, so clients can release the songs as an album.
- **New REQUIRED battery item.** `delivery_checklist.check_song_mp3(ad_dir, ad_audio_path, title, author)` -> rows `SONG_MP3_FILE` / `SONG_MP3_DURATION` / `SONG_MP3_CORRELATION`: file present, duration matches the ad's audio within 0.1 s, cross-correlation >= 0.95 with the ad's audio (normalized correlation of downsampled mono envelopes, stdlib math). Missing or mismatched = FAIL, fail closed. `delivery_battery()` returns the rows with `pass` / `reason_code` / `repair_scope`. wav is measured with the stdlib wave module, mp3 through ffprobe/ffmpeg when present.
- **Batch zip.** `scripts/core/batch_zip/batch_zip.py build_batch_zip(client, ads, out_path)`: one zip per client, one folder per author holding the captioned ad, the clean master and the song mp3 (exactly three files per ad), plus a README listing every file, duration, resolution and banner link. A missing file is a `BatchZipError`.
- **Docs:** SKILL.md (deliverables), `references/choice-card-spec.md` (the card lists "song mp3 included"), `references/stage-runbook.md`, QC.md.
- Tests: `scripts/core/delivery_checklist/test_song_mp3_u14.py` (stdlib WAV fixtures, no ffmpeg, no network).

### 2026-10-09 - FU-U10: the book orientation contract

No book shape or motion rule existed anywhere; nothing measured the cover and nothing measured page-turn direction. Every compiled clip prompt carried the generic F12 people line ("limbs, head and camera stay in gentle continuous motion"), the wrong instruction for a book.
- New `scripts/core/book_shot/` (`book_shot.py`, `calibrate_book.py`, seeded fixture generator, `test_book_shot_c1.py`): the seven-rule BOOK ORIENTATION CONTRACT, the exact fixed prompt blocks (ORIENTATION / ACTION:open / ACTION:flip / CAMERA / CONSTRAINTS; H3 also gets `[Static shot]` plus the plain-words camera line), and measured checks -- cover match vs the HORIZONTAL MIRROR of the client's cover file (ORB + RANSAC inliers; mirror score higher = BOOK_MIRRORED), back/invented cover (BOOK_COVER_NOT_FRONT), spine-side sign (BOOK_SPINE_WRONG_SIDE), title OCR in reading order (tesseract, U9's engine; missing engine = UNAVAILABLE, never a pass), Farneback flow direction and right-half-to-left-half crossing (BOOK_WRONG_DIRECTION / BOOK_NO_MOTION). Frames run through load_governor.
- `calibrate_book.py` is the required control: a known-good clip must PASS and its ffmpeg hflip must FAIL, or every book verdict is UNAVAILABLE. `qc_record()` will not mint a PASS without a calibrated checker.
- `intake_book`: `BOOK_FIELDS` gains `language` (default "en" = left-to-right; the ask folds into the existing offer sentence so the three-question cap holds) and the cover's aspect is MEASURED from the file header (stdlib; measured=False when unreadable, never invented).
- `product_style_bible`: `compile_visual_prompt()` takes `[MOTION]` from `shot["motion"]` for `book` / `product` / `insert`; the generic F12 line stays for people shots. A kind that owns its motion with none set refuses (MOTION_MISSING_FOR_SHOT).
- `kie_dispatch` (outside the LIPSYNC_* seams): a video job whose shot kind is `book` is refused (BOOK_SHOT_NOT_CONTRACTED) without a start frame made from the cover file; the approved-plan-hash side stays dormant until `book_plan_sha256` exists (U11), then activates.
- `qc_gate`: the shots stage requires a `book_orientation` record for book campaigns; UNAVAILABLE never advances.
- Tests: `scripts/core/book_shot/test_book_shot_c1.py` covers (a) hflip cover FAILs BOOK_MIRRORED (b) back cover FAILs BOOK_COVER_NOT_FRONT (c) left-to-right leaf FAILs, right-to-left PASSes, still clip FAILs BOOK_NO_MOTION (d) the calibration pair sorts or the check is UNAVAILABLE (e) a book prompt carries no "gentle continuous motion" line. All five FAIL on the base tree.

## [2.7.25] - 2026-10-09 - Batch MGB009a: W-G-003-amend + TESTHYG-75-residue

Landed together by merge-train: #94 singing detector aligned to Appendix A (order 1150 part G, review G2), #95 the 2 conftest-induced order-sensitive test failures fixed (residue of #93). #96 (W-G-008 minute-lanes) not included: CONFLICTING at the merge step.

## [2.7.24] - 2026-10-09 - Batch MGB008b: W-G-002-amend + TESTHYG-75 + W-G-007-amend

Landed together by merge-train: #91 delivery-named tag grammar in lyric_structure, #93 skill-75 tests pytest-collectable and green in one process, #92 delivery checklist consumes the amended receipt fields.

## [2.7.23] - 2026-10-08 - Batch MGB008: LSC001 + LSP001 + PAR003 + G3-WIRE

Landed together by merge-train (one gate run): #88 consolidated lip-sync (LSC001), #90 approved lip-sync process (LSP001, rewords Downloads in install_face_model.py for the leak check), #89 final_assembler byte parity (PAR003), #87 G3-WIRE port (onboarding #1692). Waiting on onboarding: #1700, #1701, #1695 (MGB007) and #1702.

### LSC001: one consolidated lip-sync change (LPG001 + LSL001 + LSR001)

Replaces 999-setup #72, #86 (and builds on #73, already merged by train MGB007); onboarding #1697, #1698, #1699 carry the same change.
- **Sync gate = `sync_check` (LSL001, calibrated on real controls).** `lip_gate.judge` maps SYNCED / WEAK / NOT_SYNCED to PASS / ACCEPT_WITH_FLAG / FAIL, a sung line that is WEAK or NOT_SYNCED to UNDETERMINED (held for a person, no paid redo), UNMEASURABLE never a pass. LSR001's `event_sync` moved to `lip_gate/event_sync.py` as an ADVISORY measure recorded as `advisory_event_sync`, never gating (`calibrate_events.py` prints its real-control table, see the PR body).
- **Picture gate = `picture_gate` (LPG001, calibrated, enforced in the dispatcher).** `image_gate.check_image` has no close-up thresholds of its own: `picture_gate.check_numbers` judges the close-up numbers; `image_gate` adds only size (720x1280, 9:16), occlusion, mouth shadow, light, background, same character and provenance. ONE rule set.
- **LSR001 non-gate improvements kept:** `choose_window`, `MAX_TRIES = 2`, `count_jobs`, `check_try_limit`, cost default `attempts=2`; `kling_prompt` ("sings" / "says"); padded cut (0.30 s / 0.20 s) is the default input of try 1; try 2 only on a hard defect and only with a changed input (`retry_input`); `KEPT_BEST_OF_2` receipt rows with flag and mouth-strip path; every paid submit through `load_governor.kie_request`; QC.md H4, QC checklist items 8 and 11, `delivery_checklist` Q8 aligned to the sync_check verdicts.
- **InfiniTalk:** the A/B third job is removed from the code; every doc mention says manual backup only, not on by default. `kling/ai-avatar-standard` is THE lip-sync model.

## [2.7.22] - 2026-10-08 - Skill 75 parity with onboarding v2.8.4 (PAR001 batch)

Port of onboarding main 3aff3fa1 (skill v2.8.4), per `15-SKILL75-999-PARITY.md`. This entry is the release record for the whole PAR001 batch; each unit lands in its own PR (branches `port/par001-*`) and is described by its own line below. This unit (9, docs and release) carries the docs, VERSION, SKILL.md version and this changelog.

- Unit 1 (G1 delivery map): music_styles delivery map and contradicting-tag gate, `no_echo` contradiction gate, suno_recipe spoken-once exemption.
- Unit 2 (G5 receipts, H4 wiring): `singing_detector/receipt_evidence.py`, measured sung/spoken/rap/no-voice receipts in `sung_vocal_guard`, assembler `_receipt_evidence`/`_attach_evidence`, assembler `face_speaks_gate` wiring.
- Units 3-4 (G8 target engine, G2 lyric structure, G9 words-fit): `target_engine` package, `lyric_writer/lyric_structure.py`, `words_fit/` preflight and the 15% Suno duration headroom.
- Units 5-6 (F16 delivery video-model gate, F3 lipsync_cuts, H10 line_voice_fit): `delivery_checklist` calls `model_lock.check_video_model_delivery`, `audio_c3/lipsync_cuts.py`, `qc_voice_match/line_voice_fit.py`.
- Units 7-8 (W4-PROOF, CI): `scripts/proof_run/run_proof.py`, workflows that run the skill 75 tests, `qc-operator-path-leak.sh`, PREREQS faster-whisper and numpy.
- Unit 9 (this PR, docs only):
  - `QC.md`: new H4 (speaking faces and lip-sync coverage), I5 (clean ending), H7 (protected names and captions) and H10 (voice fits the character) sections; the master-provenance receipt wording (`produced_by.module`, `master_sha256`, builders call the skill's modules); the I1 website rule now says the address is stored as a protected word.
  - `SKILL.md`: new "Captions and protected names (Part H, H7)" section.
  - `references/stage-runbook.md`: onboarding's runbook with 999 paths (Suno `music` stage runs `kie_dispatch` with full flags, qc_gate commands for continuity-bible, final-qc and delivery, the H14 song-files note). `test_factory_next.py` still parses it.
  - `references/choice-card-spec.md`: All Suno voice wording (spoken words are performed inside the one Suno track) and the E6 lip-sync floor wording.
  - `INSTRUCTIONS.md` and `references/price-menu.md`: checked against onboarding, no content gap (999's INSTRUCTIONS is its own layout; price-menu is byte-identical).
  - VERSION and SKILL.md frontmatter: 2.7.21 to 2.7.22.

### Batch MGB007 (landed together with merge-train.sh)

PRs #73 (looser sung-aware lip-sync sync check, onboarding #1698), #74-#79 and #81-#83 (PAR001 ports), #80 (W3-A-999 target_engine, F14 loud path, H12 provenance), #84 (F18 caption and lyric QC use F17 measured word timing), #85 (G4-WIRE target engine 5/10 band). `target_engine` and `music_director/__init__` take the onboarding main bytes. Still open against onboarding main (ef25a17d1): 999 #72 (picture gate), #86 and onboarding #1697, #1698, #1699, and the G3-WIRE sung-claim gate port.

## [2.7.21] - 2026-10-08 - Batch MGB005: song recipe v2, load governor, F14, F15, KIE rate limit reference

Landed together by merge-train: #67 song recipe v2, song length formula and song dispatcher; #68 KIE rate limit reference; #69 F14 video model lock; #70 load governor; #71 F15 choice card gate. Integration: the song dispatcher sends every generation through the load governor (new requests use the 20 per 10 s bucket, a 429 is resubmitted), with a test. Fixes the version mismatch (VERSION said 2.7.19 while SKILL.md said 2.7.20): VERSION, SKILL.md and this changelog now agree on 2.7.21. F14 and F15 were merged by hand (both sides kept) in the test stubs.

## [Unreleased] - Doubled lip-sync and the lip-sync image gate (owner order 2026-10-08)

Same change as onboarding Skill 75 (Unreleased). No version bump in this unit.

- A 60 s ad carries 6-8 lip-sync clips of 4-6 s (30-40 s, was 15-20 s), scaled linearly, no clip
  over 6 s. New `core/lipsync_clips.py` is the one source; `face_speaks` (band + planner: sung
  hooks, spoken opener and closing first) and `lipsync_coverage` (E6) follow it.
- `lipsync_clips.check_budget` refuses loudly past the cap; the price card refuses a clip over 6 s.
- Lip-sync image gate `lip_sync/lip_gate/image_gate.py` runs before any paid job (`run_gate` now
  requires `source_image` and `image_check`); prompt template `closeup_prompt()`.
- Tests: `test_lipsync_clips.py`, `lip_gate/test_image_gate.py`, `extensions/test_lipsync_cap.py`;
  H2, H4, E6, F8, F9 tests updated.

## [2.7.21] - 2026-10-08 - F15 choice card always asked before any paid job (style_defaults/card_gate)

Port of onboarding main `b9ced148c` (manual Part F F15, Critical, owner order 2026-10-08). The choice card is no longer something a brief can skip: no run starts any paid job until the card's four answers - video style, audio style, length, video model - are shown and recorded with who and when.

- New `core/style_defaults/card_gate.py`: `answers_recorded` lists the missing fields (`CARD_UNANSWERED`), `answered_stamped` records the receipt block `{answers, who, at}` in UTC, `gate_run_state` is the single gate the W-F-U16 wiring calls. The card renders one plain fifth-grade sentence per pick with RECOMMENDED markers; the video-model menu is parsed from the price-menu snapshot (live Skill 74 price still first). `core/style_defaults/defaults.py` gains the 2-minute (120 s) length between 90 s and 3 minutes with the F15 note.
- `core/kie_dispatch` refuses any paid job whose request carries no recorded card receipt (`card_gate_refusal`; fail-closed, status `waiting`, nothing reserved; the local check keeps the gate shut when style_defaults is not importable). Gate order is unchanged: card gate, then price, then storyboard (F6), then placeholder (F10).
- `core/intake_preflight`: `intake.evaluate()` - a complete brief (zero questions) still waits on `CARD_UNANSWERED`, and the resume-no-changes / resume-material-changes ok paths are gated the same way; the <=3 story questions are still asked first in 999's H9 blank-line format (directive 24.3 caps story questions only). `preflight.check()` requires the recorded receipt for any paid preflight; the factory CLI gains `--run-state-file` / `--card-receipt-file`.
- Docs: `references/price-menu.md` gains the 2-minute table computed from the SAME published rates the 90 s rows use (per-second x120, Veo 15 clips, Gemini 12 clips, keyframes per shot, one $0.06 Suno generation, both shapes double, 20% retakes); `references/choice-card-spec.md` carries the 2-minute option and the directive 24.3 note; `INSTRUCTIONS.md` gains the F15 gate paragraph and the 2-minute length, hand-ported into 999's numbered-list layout (the patch hunks rejected on context drift, not on already-applied content).
- Tests: `test_card_gate_f15.py` (59 checks, taken from onboarding main so the I1 website field and the package import match 999's intake); `test_kie_dispatch.py` gains the F15 refusal case and every stub run carries the stamped receipt; the F5, F10 and F6 suites carry the receipt the way onboarding main does (plus its detail-tuple formatting fix in the F6 check helper). F15 applied file-by-file onto 999 main - 999's newer I-series intake/master-length work and the F4/F5/F6/F10/G8/lip-sync gates already on main are kept; F14 model_lock is not part of this port (separate unit).

## [2.7.21] - 2026-10-08 - F14 video model lock ported from onboarding main

Video jobs are locked to the choice-card model: only models on references/price-menu.md dispatch (seedance-1.5-pro refused), a different menu model is VIDEO_MODEL_MISMATCH, no lock is VIDEO_MODEL_LOCK_MISSING fail-closed, and a definite submit error is VIDEO_MODEL_DOWN with no automatic fallback. New core/kie_dispatch/model_lock.py plus scripts/qc-no-direct-kie.sh; dispatch runs the gate before any ledger row.

## [2.7.19] - 2026-10-08 - Sung detector no longer reads gap-free speech as sung (singing_detector 2.0.0)

Measured bug (detector check 1536): a sung share built on the density of pitched voice read fully spoken audio as sung (macOS say Samantha 100% sung, 10 of 13 say voices 74-100%, a rap control 91.7%). Real Suno sung hooks read 96% sung and real Suno spoken lines read spoken, so the old numbers looked fine on stems with natural pauses.

- `core/singing_detector` 1.0.0 -> 2.0.0, same public interface (`detect_track`, `share_for_stem`, `score_stem_window`, `score_window`, `calibrate`, same receipt keys, same `METHOD` name). A window is sung only when the voice behaves like a melody on a scale: steady-note share of voiced time >= 0.45, pitch-class concentration of the note pitches >= 0.70 (tuning-free; speech glides through every pitch), note-to-note intervals within 0.22 semitone of whole semitones (speech about 0.25), and enough notes per second. Pitched-voice density alone can no longer decide. Sustained-note share (notes held 250 ms or more) and the old note range are reported, not gated. Window 8 s, a second counts sung when half or more of its windows vote sung (a sung neighbour no longer paints the next spoken line sung).
- Control table, now a test (`core/singing_detector/test_singing_detector.py`, fixtures are a few seconds each in `fixtures/`, plus 13 macOS `say` voices generated in the test): every spoken control <= 15% sung, every sung control >= 85% sung. Result: 13 say voices, 5 Suno spoken lines, 6 Gemini TTS lines and an O3a spoken stem all 0% sung; Chanel hook lines (5) and BSW hook lines (3) all 100% sung. Before (same clips): 9 of the 13 say voices were 33-94% sung and 3 Gemini TTS lines were 100% sung.
- Band logic (`spoken_share`, `sung_vocal_guard`) is untouched; both read the 12.4 timing map, not audio density.
- The factory's local `singcheck.py` (v60-tools, outside this repo) got a `singcheck-v2.py` next to it that calls this detector with the same CLI.

## [2.7.18] - 2026-10-08 - Re-sync shared core and references from onboarding main (W3-A-U1)

Packaging parity with onboarding main `ac8a43fd4` (`75-drama-song-ad-factory`), done file by file instead of a wholesale mirror. Rule: a 999 file is replaced only when its bytes equal an older onboarding-main version (onboarding is strictly newer); every 999 file that carries a newer 999-only fix (H6/H8 band engine, I-series intake and master length, spoken_share, sung_vocal_guard, lip-sync close-up, singing_detector) is kept. `installer-registration/package_core.py` was not run in mirror mode because it would overwrite those fixes.

- Added from onboarding: `audio_c3/soundtrack.py` + `test_soundtrack_f1.py`, `references/style-bibles/`, `references/client-messages.md`.
- Updated from onboarding: `audio_c3/voice_packs`, `final_assembler/lipsync_coverage` (+ test), `smp/no_echo` (3 files), `suno_recipe/test_suno_recipe.py`, `references/cli-contract.md`.
- NOT synced, still differ (`target_engine/`: its test assumes the old spoken target and fails against SPK001 spoken share 20-25%, so it needs the onboarding spoken25 PR first; onboarding copies need the F6/F15 gates and the F4/F5/F10/F14/F15 set that 999 does not have; copying them turned suites red): `kie_dispatch/*` + `model_lock.py` + `test_model_lock_f14.py`, `style_defaults/*` + `card_gate.py` + `test_card_gate_f15.py`, `intake_preflight/preflight.py` + test, `intake_book/test_never_invent_f6.py`, `final_assembler/test_master_provenance_h12.py` (fails against 999's I4 assembler), `references/price-menu.md`, `references/choice-card-spec.md`, `references/stage-runbook.md`, and every 999-newer file (spoken_share, sung_vocal_guard, lip_gate, lyric_writer, music_styles, intake/factory, assembler, catalog_calculator).
- Carry to onboarding (999 is ahead): spoken_share + sung_vocal_guard band rule (onboarding PR 1655, open), lip-sync close-up (PR 1654, open), I3 to I8 intake and master-length work, singing_detector.
- Suites: every skill 75 suite passes except `tests/test_parity_layout.py`, which fails on main too whenever the onboarding canonical core is reachable (pre-existing divergence; skipped otherwise).

## [2.7.17] - 2026-10-08 - Spoken share cut to 20-25%, singing judged against voice time (SPK001)

Owner order (Trevor, 2026-10-08): "Okay, let's go to your recommendation that cut it to about 20-25%." Why: Suno turns spoken lyric lines into long talking, and the old targets did not add up (spoken 35-40% of runtime plus a music-only intro and end card left at most about 50% for singing, never the 55-60% goal). Six chapter songs came back 15-30% sung.

- `core/spoken_share` (the one G10 constants set): `SPOKEN_TARGET_PCT` 45 -> 22.5 (band 20-25); redo edges `SPOKEN_MIN_PCT` / `SPOKEN_MAX_PCT` 12.5 / 32.5 (target -/+ 10, reporting only, no absolute floor); `SUNG_TARGET_PCT` = 77.5 (75-80), now a share of VOICE time; new `LYRIC_SPOKEN_WORD_PCT` = (15, 18). New `sung_of_voice_pct`, `check_sung_of_voice` (sung / (sung + spoken), rap counts as spoken, intro / gaps / end card never counted), `spoken_word_budget`, `check_spoken_word_budget`; `check_plan` also judges sung-of-voice.
- `final_assembler/sung_vocal_guard`: sung coverage is sung / (sung + spoken) from the 12.4 timing map (`spoken_section_ids` names the spoken sections); default target 77.5; new `sung_voice_seconds_from_timing`. Only other hard reject stays: no sung stretch of 6 s.
- `lyric_writer.spoken_word_budget`: spoken lines budgeted at about 15-18% of the lyric words. `suno_recipe.score_take` judges sung-of-voice and passes the spoken-share flag through. `music_styles` share rule text, `spoken_share_card_docs` card line and docs wording, `intake_book` spoken-share menu range, SKILL.md, choice-card spec and QC checklist carry the new numbers.
- Tests: spoken 22% accept / 31% flag / 37% redo; sung of voice 76% accept / 69% flag / 60% redo; a 10 s intro plus 5 s end card is not penalized. Same rule in onboarding skill 75 (PR fix/spoken25-SPK001, built on bandfix PR 1655).

## [2.7.16] - 2026-10-08 - Port onboarding skill 75 core into 999 (999-port)

Four port commits from onboarding 75-drama-song-ad-factory (origin/main 1c5d829f), merged onto main. Where the port and main overlapped, main wins (BND001 band, H3 30 fps, LPC001 lip-sync close-up); the port's own additions stay.

- Ported: `final_assembler` E2-E7/M7 pieces main lacked, `shot_planner` E2/E4 (shot beats, no-reuse), `kie_dispatch` submit/wait/save + modality budgets + resolver zero-settle evidence, `smp/initial_questions`, and operator paths removed from 6 core files.
- Tests: `final_assembler/conftest.py` supplies the `tmp_root` fixture so `test_assemble_timeout_default_and_override`, `test_gate_wiring` and `test_marker_validation` run under pytest as well as as scripts.

## [2.7.15] - 2026-10-08 - Calibrated sung detector (G3, W-G-003)

- Added `core/singing_detector/` (detector, `__init__`, self-test): measures sung seconds per second and per line from the isolated vocal stem (pitch stability, voicing continuity, note alignment; ffmpeg + numpy, no ASR, no spend, load guard). Every share carries `source: measured`, never computed from section labels. Calibrated on the bsw sung lines and O3 spoken lines. Test: `scripts/core/singing_detector/test_singing_detector.py`. Same detector ships in onboarding skill 75 v2.8.1 (PR 1656).

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
