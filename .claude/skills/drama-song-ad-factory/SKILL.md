---
name: drama-song-ad-factory
description: Build a complete drama-song ad - a sung direct-response story with music, storyboard, generated clips, assembly and delivery - through the shared Python control layer (intake, preflight, spend ledger, state store, QC gates). This is the Claude-Nine / Claude Code distribution of the same canonical BlackCEO methodology the OpenClaw skill ships: one skill folder, one control CLI, two runtime adapters, no second config root. Use when asked to produce a drama song ad or song-driven video ad, or to run intake, preflight, resume or QC gates for an existing drama-song campaign run. Not for motion graphics (use motion-video-plus) or landing pages (use blackceo-signature-page).
version: 2.7.33
---

# Drama Song Ad Factory

Claude-Nine / Claude Code distribution of the BlackCEO drama-song ad factory.
One canonical methodology, two distributions: this folder and the OpenClaw
skill share the same creative doctrine, project/run schema, provider
abstraction, stage names, retry and QC logic, failure semantics, campaign
artifact contract and licensing decisions. Only the runtime adapters differ.
The lockstep is enforced by `tests/test_parity_layout.py`, not by hope.

Default production mode name: `drama-song-vsl`. Never make a third-party
brand name the public product identity.

## Creative doctrine: villain, pain, rise (Trevor order 2026-10-08)

> "People don't care about the hero until they meet the villain." - Trevor Otts

These are **not music videos**. They are compelling true stories told through
the animation, the music and the lyrics - songs strong enough to sell as a
soundtrack on their own (the Grey's Anatomy standard: you watch the show and
you buy the music). Every ad has a compelling plot and a villain that evokes
a visceral response, and every ad carries the **pain AND the rise**, so the
audience feels the pain and the problem in the depth of their soul.

- **The villain contract.** Every ad names its VILLAIN in the story plan. A
  villain is a person OR not a person: cancer, debt, a layoff, a lie,
  burnout, fear, the inner critic, a system. The villain must be (a) named
  in the story plan, (b) shown on screen in concrete, visceral visual form
  with its OWN shots - never implied, (c) felt in the lyrics with real
  stakes and consequences, and (d) escalating, then confronted, then
  defeated or transformed at the rise.
- **The arc.** hook -> the world -> the villain arrives -> the pain deepens
  (visceral, specific, from the source material) -> the lowest point -> the
  turn (the product or book as the key) -> the rise -> the call to action.
- **The numbers.** `length_formula.plan_villain_doctrine` fails CLOSED when
  no villain is named or when the villain has no shot - the only two hard
  cases. The pain share of runtime is a target band of 20-35 percent;
  outside it is a FLAG carrying the measured seconds, never a block. Pain
  gets real screen time; the rise is earned, never rushed.
- **The checker.** `delivery_checklist.measure_villain_doctrine` reports a
  `VILLAIN_DOCTRINE` row: villain shots, villain screen seconds, pain
  seconds and rise seconds. The approval card carries
  `Villain: <name>, shown in N shots`.

## Route boundaries

Use this skill for song-driven direct-response video ads: a twelve-stage
drama story carried by a sung lyric script, then storyboard, clip generation,
assembly and delivery.

Route elsewhere when the assignment is:

- motion graphics or code-driven animation -> `motion-video-plus`
- a single landing / funnel page -> `blackceo-signature-page`
- an OpenClaw department run -> the OpenClaw `drama-song-ad-factory` skill
  (same core, OpenClaw runtime)

## Main window orchestrates only; nothing fails silently (operator rule)

When this skill runs in Claude Code or claude-nine, the MAIN window only
operates and orchestrates. ALL work is done by VISIBLE workflows and agents.
Things that are wrong, broken or not working are NEVER allowed to fail
silently.

- The main session never does hands-on work: no media generation, no file
  edits, no renders, no hand-run pipeline commands. It launches a visible
  workflow (the Workflow tool) or named agents (shown in /workflows), reads
  their verdicts, and reports them. The user chooses the agents and models;
  the skill never names or forces a model of its own.
- A workflow or agent that is wrong, broken or not working is reported by
  name, with its error, in the same message. Never retry quietly, never skip
  the step, never substitute a result.
- Every failed or skipped gate lands in the final receipt as a named
  `failures` entry (the run becomes `outcome: error`). The only fail-soft
  paths are the documented ones (for example a Command Center board that is
  unreachable); those still print a `WARNING <CODE>: ...` line and sit in the
  receipt's `warnings` list. Code: `scripts/core/loud_failure.py`; proof:
  `tests/test_loud_failure.py`.

## Start here: the enforced flow

```text
intake -> preflight -> claim eligible stage -> perform authorized stage work
       -> register artifacts/results -> independent QC -> guarded transition
       -> queued board event -> acknowledgement -> next eligible stage
```

Nothing skips a gate. A runtime prompt or worker cannot bypass a failed
shared guard: every adapter invokes the same Python control entrypoint and
the same exit codes before the affected action, not as an after-the-fact audit.

## The control CLI (one entrypoint)

```text
scripts/core/intake_preflight/factory.py
```

Two subcommands, standard library only, JSON envelope on every command:

```bash
python3 scripts/core/intake_preflight/factory.py intake   --brief-file brief.json
python3 scripts/core/intake_preflight/factory.py preflight --root "$STORAGE"
```

| Outcome | Exit code | Meaning |
|---|---:|---|
| `ok` | 0 | accepted for this command |
| `error` | 1 | failure with a reason code |
| `waiting` | 2 | human answer needed (batched questions) |
| `parked` | 3 | blocked until a decision or state is repaired |
| `rejected` | 4 | refused on policy, trust or authorization |

Full field list, argument list and reason codes:
`references/cli-contract.md`, asserted in-skill by
`tests/test_cli_smoke.py`.

## What the model does vs what the code owns

The model does high-level reasoning: creative judgment, story, lyrics,
shot intent, repair plans.

Deterministic code owns: schemas, validation, task IDs, hashes, state
transitions, cost arithmetic, dependency invalidation, retry counters,
filesystem paths, payload validation, manifest generation, QC result
recording, board API calls and no-double-spend logic. Prose prompts are
never the only place an invariant lives.

The packaged control layer lives in `scripts/core/`:

| Module | Runs when | Owns |
|---|---|---|
| `intake_preflight/factory.py` | every entry | envelope, `intake` / `preflight` subcommands |
| `intake_preflight/intake.py` | new campaign or changed brief | brief normalization, provenance, max-3 questions, summary digest |
| `intake_preflight/preflight.py` | before work, on config change | NAMES-only dependency, storage, profile, credential-presence, approval checks |
| `state_store.py` | stage claim / completion / invalidation | legal transitions, expected-version checks, worker ownership |
| `artifact_graph.py` | asset registration or upstream change | hashes, dependency binding, targeted invalidation |
| `spend_ledger.py` | before any paid submission | transactional reservations, ceilings, duplicate-job rejection |
| `job_recovery.py` | provider completion / timeout / restart | correlation, dedup, no automatic repeat of uncertain submissions |
| `timing_guard.py` | after song approval, before assembly/export | lyric coverage, timestamps, drift against the acceptance profile |
| `qc_gate.py` | before each material stage advances | required PASS/FAIL records, reviewer independence, critical failures |
| `cc_sync.py` | stage events, handbacks, resume | durable board outbox, stable IDs, no duplicate cards |

`delivery_verify.py` and `release_check.py` are named in the directive and
are not in this package yet; treat any claim of them as unimplemented.

## Packaged production modules (14)

`scripts/core/` also ships the fourteen production modules, copied
byte-identical from the canonical source `drama-song-factory-build/core/`
(regenerate from that source on core changes; never hand-edit the copy):

`research_engine`, `story_arc`, `lyric_writer`, `music_director`,
`music_qc`, `character_continuity`, `product_style_bible`,
`style_bible_integration`, `shot_planner`, `storyboard_director`,
`video_router`, `final_assembler`, `delivery_variants`, `retake_manager`.

Cross-distribution sha256 equality with the OpenClaw packaging is checked by
`tests/test_parity_layout.py` and the workspace parity suite; when the
canonical tree is absent the result is `PARITY UNDETERMINED`, not a pass.

## Character library (Part I, I6)

When the client approves a character, ask exactly one question, in plain words:
"Do you want to save <character> to your character library so you can reuse
them in future ads?" On yes, ask "What name should I save <character> under?",
then save the approved reference images, the description and the voice notes
with `python3 scripts/core/intake_preflight/factory.py character --client-dir
<client data folder> save --name <name> --description <text> --image <file>
[--image ...] --voice-notes <text>`. The library lives inside that client's own
data folder (`character-library/<name>/`), never shared between clients. Later
intake cards open with a CHARACTER question when the client has saved characters ("Do you want to create a new character for this ad, or use one you've used before? You have N characters saved with us.", option 1 = create a new character, recommended, then one "Use <Name> - <description>" option per saved character; the recap reads "Character: new" or "Character: <Name> (saved)"). With none saved there is no question: one line says a new character will be created and saved for next time (`character
--client-dir <dir> card`; `factory.py card --client-dir <dir>` where the
intake card exists). `character --client-dir <dir> use --name <name>` prints
the brief fields (name, description, reference images, voice notes) to reuse.

## Prompt templates (every paid prompt is assembled, never written)

A prompt is never hand-written. It is assembled from data layers plus the
facts of one shot or one song, and every assembled payload gets a receipt.
The layers and the assembler are the same in the OpenClaw distribution
(U15a-U15i):

- **Data:** `references/prompt-templates/` - `manifest.json` (caps with their
  source and status, owner bands, layer order, quality rules), `models/`
  (minimax-h3, kling-video, kling-ai-avatar-standard, suno-v6), `modes/` (the
  five render modes the looks are built from), `looks/` (the five card looks),
  `shot-types/`, `music/` (the three styles), and `length-classes.json`
  (60/90/120/180/300/600 s: shots, H3 clips, lip-sync clips and seconds,
  lanes, hooks, song words, spoken share, product seconds).
- **Code:** `scripts/core/prompt_templates/prompt_templates.py` - `load`,
  `caps`, `band`, `assemble_h3`, `check`, `expand`, `receipt`,
  `length_class`, `check_product_seconds`. The shot planner writes the FACTS
  (`shot_planner.prompt_spec_for` writes `shot["prompt_spec"]`), never prose.
- **MiniMax H3 band** (Trevor, 2026-10-08): **5,000-6,800 characters**, hard
  max 7,000. Under 5,000 = FLAG then expand from the spec (real detail only,
  never padding), and `H3_THIN_SPEC` when the spec has no facts left; over
  6,800 = TRIM in the documented priority order; over 7,000 = REFUSE
  `H3_OVER_HARD_MAX` before any spend.
- **Receipt.** Every payload returns a prompt receipt (`prompt_sha256`, the
  template version, the per-section character map, the band verdict).
  `kie_dispatch` refuses a paid job whose prompt hash has no matching receipt
  or whose receipt says REFUSE or TRIM: `PROMPT_NOT_TEMPLATED`.
- **Final QC** requires a `prompt_compliance` record: one row per paid ledger
  job matched to its receipt (`qc_gate`). A paid job with no receipt fails the
  final gate; it is never a pass.
- **One length table.** `references/prompt-templates/length-classes.json` is
  the only table; the card, the planner and QC read it, and
  `prompt_templates.length_class(L)` raises `PROMPT_LENGTH_CLASS_DRIFT` rather
  than let a stale row be read silently.

## Suno song recipe (read this first when you build audio)

Every Suno music style (Soul Ballad, R&B Flow, Soul Rise, and any Suno style
added later) follows this recipe by default. It is what made the Kiesett and
LeAnne Dolce songs land. The code is `scripts/core/suno_recipe/`; every Suno
request goes through `suno_recipe.prepare()` and the `music_director` seam
refuses a raw Suno style that skipped it.

The four rules (recipe v2, replaces G12):

1. Spoken tags only in [Intro] and [Outro]; spoken is named once in the style
   text, and the style says the full band keeps playing under the spoken lines.
2. Sung lines are short (5-6 syllables aimed, 8 at most), rhymed, with
   hyphen-held vowels, after a wordless sung vocalise.
3. The first hook comes after the vocalise, never at 0 s; the hook is the
   client's own words, repeated by length (`core/sung_hook`).
4. Each take's singing is measured, not taken from its labels.

Word budget, section plan, hook repeats, spoken placement, instrumental breaks
and the extend plan for any length come from ONE function,
`core/length_formula.plan(L, spoken_share_pct)`; L=60 gives the measured
65-word recipe. Style text is 1000 characters or less. Negative tags are
`rap, rapping, choir, reverb, echo, band dropout, acapella sections,
talk-singing, monotone delivery` (never "spoken word"; the rap style drops the
rap pair). KIE (snake_case input, checked against the live docs): model V6, custom_mode
true, instrumental false, style_weight 0.75, weirdness_constraint 0.3, variety
0, vocal_gender per brief, duration 10-360 s. A longer song is a base take plus
extends: extend input is audio_id, continue_at (seconds, inside the source
take) and model (must equal the source take's model); extend has no duration
field, so the extended length is measured, never assumed. Trevor's dry close-vocal rule stays.
`core/song_dispatch` judges EVERY take (singcheck v2, spoken share band, sung
of voice, 6 s stretch, hook sung 2+, script words, length, music under speech,
clean ending, first sung), stops at the first pass, saves the stem and
timestamps of every take, regenerates whole tracks only, and refuses
openai-whisper.

The targets (Trevor, 2026-10-08, SPK001): speaking is **20-25% of the
runtime** by default (center 22.5; each ad can set its own, Black Successful
Women uses 15-20), and the lyric writer derives its spoken word budget from the ad's
own spoken target and the length formula's measured word rates (no fixed
word percent). Singing is measured against **voice time**, sung / (sung + spoken),
with a default target of **77.5%** (75-80): a music-only intro, gaps and the
end card never count against it. Both numbers use Trevor's band: within 5
points accept, over 5 up to 10 accept with a flag, over 10 redo. The only
hard reject is no sung stretch of at least 6 seconds. One constants set holds
the numbers: `scripts/core/spoken_share/spoken_share.py`. Since FU-U3 landed
(2.7.31) those numbers are read per style: `spoken_share.STYLE_TARGETS` gives
Soul Ballad and Soul Rise 22.5 / 77.5, R&B Flow the share planned from the
approved sheet, and counts the fourth delivery `none` (music-only intro, gaps,
end card) in runtime and never in voice time; a music-only gap never counts as
spoken.

Tag grammar and the checks around it (FU-U1, FU-U2, FU-U5, FU-U6; what main does):

- **One tag grammar.** A lyric sheet is parsed once, by `suno_recipe`, and
  `words_fit`, `lyric_structure` and `music_styles.sheet_deliveries` read that
  same parse. A bracket tag names its delivery: `[Name (sung|spoken|rap): note]`
  or `[Sung|Spoken|Rap - ...]`; the earliest delivery word wins. A lyric line
  under a bracket the grammar cannot classify is refused
  `UNTAGGED_LYRIC_LINES` (naming the lines), never dropped. Rule 1 above holds
  for plain spoken lines; rap is its own delivery and is allowed only where the
  style's data says `rap_allowed` (R&B Flow). The rap negative tags drop for a
  rap style only.
- **Style-aware length plan.** `length_formula.plan(L, spoken_share_pct,
  style_id)` gives a rap style a rap budget; `words_fit.STYLE_RATES` is keyed by
  style id; the offered lengths are `music_styles.OFFERED_LENGTHS_S`
  (60, 90, 120, 180, 300, 600). Soul Ballad and Soul Rise plans are unchanged
  (65 words at L=60).
- **Voice tags come from the cast.** `suno_recipe.check_voice_tags` refuses a
  character tag whose gender disagrees with the cast record
  (`VOICE_TAG_MISMATCH`) or cannot be checked (`VOICE_TAG_UNCHECKED`).
- **Request limits, measured last.** See "Request and prompt limits" below.
- **Per-style bands (FU-U3, landed in 2.7.31 via PR #120).** The
  5/10 band is unchanged. Soul Ballad and Soul Rise stay at 22.5 runtime spoken
  and 77.5 sung of voice. R&B Flow is judged against the share planned from the
  approved sheet (a Trevor decision item in the plan, no new number invented),
  rap is counted separately from plain speech, and a music-only gap is a fourth
  delivery, `none`, that counts in runtime and never in voice time. The 6 s sung
  stretch and the hook count stay hard. `spoken_share.STYLE_TARGETS` holds the
  numbers.

The only exemption is the Velvet Voiceover version (the spoken Google voice
over the song, id `velvet_voiceover`), which keeps its own flow. Almost
nobody asks for it. Every other style, including the All Suno voice default,
uses the recipe.

The Suno payload itself is assembled the same way: `prompt_templates.suno_parts(style_id, length_s, vocal_gender)` reads
`references/prompt-templates/music/<style>.json` and `models/suno-v6.json`, so the style text,
the delivery cues, the negative tags and the caps are data and not constants; the caps are
measured on the FINAL payload, after `ending_qc`. See "Prompt templates" above.

## Scenes must match the song and the faces (Part I I2)

Plain rules, no exceptions:

1. At storyboard time every shot carries four facts: the exact line, what the
   viewer must understand from it, where the person is and what they are doing,
   and the emotion on their face. A shot missing any of the four is not
   approved and no clip money is spent on it (`scene_match.check_cards`).
2. A pain line never gets a smiling face. Warm is a lighting word, never a
   face word. A joyful line may smile.
3. After the clips exist, quality control samples at least three frames per
   shot and checks two things against the line: the picture shows the planned
   place and action, and the face shows the planned emotion
   (`scene_match.qc_scene_match`, built on the face-emotion gate).
4. A shot that fails either check is regenerated by itself. The other shots
   and the song are never redone for one bad shot, and a shot with no sampled
   frames is never passed unseen.

## Sung hook (I8)

Every sung style carries ONE catchy hook: 4-10 words, only the client's own
words (protected names exact), singable, the brand-promise payoff line. The
hook is sung `count = clamp(1 + floor(L / 25), 2, 12)` times, where L is the
delivered length in seconds (chosen length minus 2).

| Delivered | 28 s | 58 s | 88 s | 118 s | 178 s | 298 s | 598 s |
|-----------|------|------|------|-------|-------|-------|-------|
| Hook sung | 2    | 3    | 4    | 5     | 8     | 12    | 12    |

First hook by 15% of runtime, last hook near the end (about 90%) before the
call to action, the rest evenly spaced. Build the sheet with
`core/sung_hook.build_lyric_sheet`. After a take is chosen, count the hook
occurrences that were actually sung (Suno timestamps plus the singing
detector): count met = accept, one short = accept with a flag, two or more
short = regenerate. The receipt shows hook text, target, measured count and
times. The Velvet Voiceover version is exempt.

## Caption and lyric QC on measured timing

- **Caption and lyric QC run on measured timing (Part F F18):** word timings
  come from the ONE transcription step (`audio_c3/lyric_timing.provide_word_timings`,
  F17 — Suno alignedWords → faster-whisper local → client cloud STT). Pass
  that receipt as `timing=` and the caption check builds its cue clock from
  the measured timestamps (text still the sheet's own, `caption_timing.captions`,
  reported as "cue timing measured from <source>") while the lyric check
  judges coverage, critical words and ad-libs from the measured words
  (`caption_timing.lyric_observed`, `lyric_diff.observed_source =
  "measured-timing:<source>"`). Timing the check cannot use is UNAVAILABLE,
  never a PASS; without a `timing` argument each check keeps its text
  comparison, and a run measures first via `caption_timing.captions(sheet)` /
  `lyric_observed(approved_lines)`.

## Creative doctrine (shared, not adapter-specific)

- Twelve-stage arc, in order: Ordinary World; Humiliation / Emotional Wound;
  Wound Deepens; Frozen; Seeing It Too; Failed Solutions; Mentor / Trusted
  Guide; Gift / Mechanism / Product Introduction; Doubt; Climb /
  Transformation; Vindication; Return / Pitch / CTA.
- Written for one specific sub-avatar. Product reveal happens after the story
  earns it, normally late in the piece. Pitch follows emotional investment.
- Lyrics are sales copy: first person, short conversational lines, one idea
  per line, product words pronunciation-tested, truthfulness preserved.
- The song is the master timeline; lip-sync is applied to selected lines
  only (owner decision D10, superseded 2026-10-07): the pain peak, the
  product line, the call to action and the chorus hook, DOUBLED (owner order 2026-10-08): more pieces, not longer ones. A 60 s ad carries 6 to 8 clips of 4 to 6 seconds (30 to 40 seconds, was 15 to 20), scaled linearly with the ad length, no clip over 6 seconds (`core/lipsync_clips.py`); clips go first on every sung hook, the spoken opener and the spoken closing line. Each clip is a paid job, so the cost roughly doubles and a plan past the spend cap is refused loudly (`lipsync_clips.check_budget`, priced at the worst case of 2 tries per clip, `lipsync_clips.MAX_TRIES`). Chosen by the factory and listed on the approval
  card. Every other shot stays exactly as the video model made it, and the
  song remains narrator / internal voice while characters act. The version 1
  rule this replaces read "no lip-sync by default"; it is kept here only so
  the change is visible.
- Never fabricate testimonials, clinical results, credentials or product
  facts. Creative beats stay separate from production stages.

## Version 2 production options (owner BUILD-OUT 2026-10-07)

Everything in this section is shared doctrine: identical in both
distributions. Field-level rules live in `references/choice-card-spec.md`;
human price snapshot in `references/price-menu.md`; stage order and QC in the
OpenClaw SOP `SOP--drama-song-ad-pipeline.md`.

- **Intake.** Quick mode by default (one sentence), Concept mode for a
  client with their own story. At most three questions total, and ONE choice
  card with every default pre-selected, so a client can approve with one
  click.
- **Lengths:** 60 seconds, 90 seconds, 3 minutes, 5 minutes, and a
  **10-minute long version**. Each length is its own song and timing map.
- **Ends 2 seconds early (Part I, I4):** the master for a chosen length L is
  at most L-2 seconds (60 becomes 58, 30 becomes 28, 90 becomes 88, 120
  becomes 118), because a 60-second video that runs to 1:02 cannot be used in
  Stories, Reels or a Facebook ad. This is a hard maximum, not a band: the
  song, the shot plan and the end card are all planned to L-2, and final QC
  fails any master longer than that (`core/master_length`).
- **Shapes:** 9:16, 16:9, or both, each generated natively - never a crop of
  the other.
- **Frame rate (Part H H3, replaces the old "output = the clips' native
  rate" line):** the master is always 30 fps. Kling clips are native 30 and
  pass through with no conform filter (every lip-sync frame kept); MiniMax H3
  clips are native 24 and are motion-interpolated to 30 (never the plain
  `fps` filter). The assembler refuses any other timeline rate unless the
  choice card sets it, and checks every segment with mpdecimate (at most 2%
  duplicated frames; a deliberate still is marked `hold`).
- **Clips:** automatic 60- or 90-second clips are offered for the **5-minute
  and 10-minute lengths only**. Cutting a clip is free (FFmpeg); the AI that
  picks the moments runs on the client's own AI plan.
- **Five looks (decision 29):** Lifelike 3D (default), 2D Hand-Painted,
  Sketch to Life, Canvas to Life, Canvas to 3D. Each look owns its style
  bible block, its own switching rules and its own QC. The three hybrids
  switch sketch or paint to realism (or to lifelike 3D for Canvas to 3D) on
  matched poses, 0.3-0.4 s dissolve, at least 3 seconds held per style, no
  flicker, identity locked; golden realism carries the transformation and
  payoff.
- **Music (decision 30):** Soul Ballad (default), R&B Flow, Soul Rise.
- **Voice (decisions 27, 31):** All Suno (default) - sung and spoken lines
  all from Suno, spoken lines over the music bed only, no singing-underneath
  layer - or **Velvet Voiceover**: Google text-to-speech for the spoken
  lines, one distinct voice per character, the sung version of each spoken
  line playing softly underneath with the music bed dipped, **no echo effect
  and no reverb**. The option was renamed from its earlier echo-flavoured name; that earlier string is
  forbidden everywhere. Velvet Voiceover is the only exception to the
  all-Suno rule.
- **Per-character voice packs:** no two characters share a voice, in any look
  or music style.
- **Close-up picture gate, enforced in the dispatcher (LPG001/LPG002/LPG003, 2026-10-08):** the
  30-Day Reset close-up (face 28% of frame, smile 0.62) and the Perfect Daughter close-up
  (34%, teeth, roll -7.8) went to paid lip-sync unmeasured. Now
  `lip_gate/picture_gate.gate_picture()` MEASURES every close-up with mediapipe
  FaceLandmarker (one rule set: the constants block at the top of `picture_gate.py`, same
  names in the onboarding repo). LPG003 loosened it (Trevor: "loosen the checks so it's not
  as strict"), calibrated so every Trevor-approved Kiesett version 2 and LeAnne Dolce
  picture passes or flags. Three verdicts. FAIL (refused) is for clear problems only: face
  count not 1, face height under 20%, |roll| over 20 deg, |yaw| over 0.25 (side profile),
  jawOpen over 0.30 (wide-open mouth), sharpness under 60. ACCEPT_WITH_FLAG (goes to Kling,
  flags written to the receipt): smile over 0.60, lip gap over 1.0% (teeth), face under 25%,
  |roll| over 5, |yaw| over 0.12, jawOpen over 0.15, sharpness under 100. Auto-fix only for a
  FAIL: ONE free local crop for a too-small face, then at most 2 paid regenerations
  (`make_regenerate()`: gpt-image-2 image-to-image from the 3D character, "neutral
  expression, lips closed, facing camera, head level", dispatched through `kie_dispatch` so
  it reserves against the author's cap and the ledger and rides `load_governor.kie_request`)
  for a FAIL a crop cannot fix, then refuse. Smile and teeth never trigger a regeneration.
  Every picture tried gets a receipt (`<dir>/.lipgate/<sha256>.json`). `upload_measured()`
  uploads the exact measured bytes (hashed at upload time, refused on mismatch) and returns
  the URL for `input.image_url`. `kie_dispatch.dispatch` REFUSES any `ai-avatar` job (or a manual
  `infinitalk` job) with `LIPSYNC_PICTURE_NOT_GATED` unless `request["lipsync_image_path"]`
  has a PASS or ACCEPT_WITH_FLAG receipt for its exact bytes and `input.image_url` is that
  bound upload. The locked lip-sync model `kling/ai-avatar-standard` passes the F14 video
  lock (it is not a menu video model) and goes to this gate. No receipt, FAIL, changed
  file, or mediapipe / face model missing = refused, never a silent pass. Install the model:
  `python3 scripts/core/lip_sync/lip_gate/install_face_model.py` (sha256-pinned, from
  Google's official bucket, to `assets/face_landmarker.task`); mediapipe is declared in
  `PREREQS.json` (`python-mediapipe`, `face-landmarker-model`).
- **Lip-sync sync check (owner order 2026-10-08, looser):** `lip_sync/lip_gate`
  measures mouth opening (mediapipe face landmarks, through the load governor) against
  the voice with the validated `sync_check` algorithm. Verdicts: PASS (SYNCED);
  ACCEPT_WITH_FLAG (WEAK: accepted and used, note in the receipt); FAIL (NOT_SYNCED on
  a SPOKEN line: the take is kept and flagged, see the process bullet below, never
  re-rolled by the checker); UNDETERMINED (a SUNG line that is WEAK or NOT_SYNCED: held for a
  person to look at a mouth strip, NO automatic paid redo). UNMEASURABLE (no mediapipe,
  no face model, cartoon face, silent audio, too short) is reported, never a pass. At
  most 2 paid lip-sync jobs per segment, then the best-measured take is kept
  (`KEPT_BEST_OF_2`, below). Controls: `lip_gate/calibrate_sync.py` (read-only, real
  clips). `lip_gate/event_sync.py` is an ADVISORY extra measure recorded in the receipt
  row as `advisory_event_sync`; it never gates and never triggers a redo.
- **Lip-sync close-up (owner order 2026-10-08):** the character reference set always
  includes one lip-sync close-up per speaking/singing character, MADE from the template
  `lip_gate.closeup_prompt()` (chest-up portrait 9:16, face about 30-40% of the frame
  height, straight at the camera, lips relaxed and very slightly parted) and CHECKED before
  any paid lip-sync job by `lip_gate/image_gate.py`, which holds NO close-up thresholds of
  its own: `picture_gate.check_numbers` judges the numbers (ONE rule set, the picture-gate
  bullet above). `image_gate` adds only: at least 720x1280 and 9:16, nothing over the mouth
  or jaw, no hard shadow across the mouth, soft even light, background separated from the
  head, same 3D character as the storyboard, no upscaled picture. A picture that fails or
  cannot be measured is refused LOUDLY with every reason and no paid job runs
  (`lip_gate.run_gate(..., source_image=, image_check=)` raises `LipsyncImageRefused`).
  Once a take exists, a picture-gate number alone is never a reason for a new paid job.
- **Lip-sync model and the two-try rule (decision 33; Trevor 2026-10-08, "only allow 2 try twice per thing it creates after that it goes with whatever is the best one"):** Kling avatar
  (`kling/ai-avatar-standard`) is THE lip-sync model (Trevor: clearly the best option) - a front-facing close-up image plus
  that character's own isolated line, cut from the LEAD-VOCAL STEM (never the mix) on phrase boundaries
  from the Suno word timestamps (`lipsync_clips.choose_window`) with 0.30 s lead-in and 0.20 s tail from try 1
  (placed with `stem_offset.cut_plan`). The prompt says SINGS on sung lines and SAYS on spoken ones, one emotion,
  minimal head movement, steady camera (`lip_gate.kling_prompt`). The avatar prompt itself is assembled by `prompt_templates`
  (`assemble_kling_avatar`): three sentences, one emotion, and the `who`
  descriptor taken from the look's mode - see "Prompt templates" above. **At most 2 paid Kling jobs per segment,
  every name variant of the segment counted; the code refuses a 3rd** (`lip_gate.run_gate`, `lipsync_clips.count_jobs`).
  Try 2 runs ONLY on a PERSON'S call (rule 4 of the lip-sync process bullet below: a person marks a visible
  defect such as frozen or garbled face, text across the chest, hand over the mouth, wrong face), never on a checker verdict
  (FAIL included), and ONLY with a changed input (the next-best window or a new close-up); an identical resubmit is refused. After the tries the best-measured take is kept and the receipt says
  `KEPT_BEST_OF_2 (tN)` with the verdict, the numbers, the flag and an 8-frame mouth strip. Every paid call goes through
  `load_governor.kie_request(generation=True)`; the landmark extraction goes through `heavy_slot`. The price card is worst case
  seconds x the Skill 74 rate x 2 tries. **Sync is measured by `sync_check`** (the calibrated gate, sync-check bullet above); `event_sync` is advisory only.
  InfiniTalk (`infinitalk/from-audio`) is a MANUAL backup only: never called by the code, never on by default.
  **Volcengine is dropped**.
  Tight close-ups only. The lip-sync
  input contains only the on-screen speaker's line: never a narrator,
  never another character, never a mixed vocal stem. Narrator, phone, voicemail
  and laptop voices may play as voice-over but are never lip-synced onto a
  person.
- **Lip-sync process (Trevor approved, 2026-10-08, first used on the Stephanie Brown
  ads; LSP001, built on LSC001).** Every run follows these six rules
  (`lip_sync/lip_gate/lip_process.py`):
  1. **Reuse first.** Before any paid lip-sync job, re-measure every take already on
     disk for the segment with the sync check and keep the best: SYNCED, then WEAK,
     then NOT_SYNCED, then by correlation; a take with a visible defect flag is dropped.
     No new job where a usable take exists (`pick_kept`, `retry_allowed`).
  2. **Keep the best.** A SUNG line the checker cannot confirm keeps its best take,
     tagged `KEPT_BEST (UNDETERMINED, sung)`. A borderline spoken line is kept, flagged
     (`KEPT_BEST (spoken, margin)`). A WEAK take is kept with the WEAK flag.
  3. **Mouth strips.** Every UNDETERMINED or flagged segment gets an 8-frame mouth strip
     image at `<delivery folder>/mouth-strips/<segment>.png` (`mouth_strip_argv`), and
     the receipt lists every strip path for a person to look at.
  4. **Retry only on a person's call.** A paid retry happens only when a person marks a
     visible defect on that segment (a defects file, or a receipt field
     `person_verdict` = "DEFECT"), AND the segment has had fewer than 2 jobs (all name
     variants counted), AND the retry uses a CHANGED input (a new phrase-boundary cut or
     a new close-up). No automatic paid retry on any checker verdict.
  5. **Edit placement.** Trim each Kling clip to its audio length (Kling pads the
     tail); place it at the Suno word timestamp, corrected by the measured stem offset
     (`stem_offset.py`; it was 66 ms late); upscale 720x1280 to 1080x1920 with lanczos;
     conform to the native fps by DROPPING frames, never inventing them (no
     minterpolate on lip-sync clips); all ffmpeg through `load_governor` (`heavy_slot`,
     bounded threads) (`edit_plan`).
  6. **QC.** Checklist items 8 and 11 accept `KEPT_BEST` and flagged rows that carry a
     strip path (`lip_gate.qc_check`). A receipt row lists the take kept, jobs used
     (n of 2), the verdict and numbers, the flag and the strip path (`receipt_row`).
- **Speaker contract:** the person visible while a line plays is the one
  speaking it, or the voice's source device. QC checks the picture for every
  spoken line, and measures pitch against the character's gender range with
  an octave-error guard.
- **Suno extend** is used only to hit an exact length or to repair a
  section, never as routine billing.
- **Unknown KIE job results** are resolved by querying KIE task status;
  they are never left open and never blindly re-submitted.
- **Book campaigns and batch mode (decision 34):** the cover is the product
  image; one choice card covers the whole batch; one ad per book with its own
  campaign folder, receipt, spend-ledger run and Command Center deliverable;
  books and authors are never mixed; the card shows the batch total.
  - **Book orientation contract (FU-U10, on main).** `scripts/core/book_shot/`
    carries the seven-rule BOOK ORIENTATION CONTRACT and fixed prompt blocks
    (left and right from the camera's view; front cover faces the camera; at
    most one camera move, none for book shots). A book clip is accepted only
    with a PASS `book_orientation` record from a calibrated checker:
    `BOOK_MIRRORED`, `BOOK_COVER_NOT_FRONT`, `BOOK_SPINE_WRONG_SIDE`,
    `BOOK_WRONG_DIRECTION`, `BOOK_NO_MOTION`. `calibrate_book.py` must sort a
    known-good clip and its mirror, or every verdict is UNAVAILABLE. A book video
    job without a start frame made from the cover file is refused
    `BOOK_SHOT_NOT_CONTRACTED`. Intake takes `language` (default `en`).
  - **Printed pages, plan hash and Book shots block (FU-U11, open branch
    `unit/FU-U11`; refresh when it lands).** `check_pages` fails
    `BOOK_BLANK_PAGES`; the approved plan is hashed (`plan_sha256`) and a book
    video job whose hash is missing or stale is refused `BOOK_PLAN_NOT_APPROVED`;
    both cards carry a Book shots approval block (approvals and notices, never a
    new choice); an optional client-supplied `excerpt_lines` (max 3) goes to the
    overlay only and is never sent to a video model.
- **The song mp3 is part of the deliverable (FU-U14):** every delivered ad
  folder holds, beside the captioned and clean-master mp4s, the FINAL SONG as
  an mp3 (320 kbps, the exact song used in the ad, full length) plus the wav
  when one exists, named `<Author> - <Title> - Song.mp3` — clients release the
  songs as an album. `delivery_checklist.check_song_mp3()` gates it (present,
  duration matches the ad audio within 0.1 s, cross-correlation >= 0.95 with
  the ad's audio; missing or mismatched = FAIL, fail closed). When a
  book/batch campaign finishes, one zip per client ships every ad's three
  files in one folder per author plus a README listing every file, duration,
  resolution and banner link: `scripts/core/batch_zip/batch_zip.py
  build_batch_zip(client, ads, out_path)`.
- **Pricing:** every figure on the card - video, both shapes, lip-sync
  close-ups, voice packs, clips and the batch total - comes from Skill 74
  `price`. This skill never computes or hard-codes a rate.
- **Command Center:** one deliverable per ad, one Kanban card per ad and one
  parent card per batch; department lead role
  `vsl-video-sales-letter-specialist`.

## Submit all ready jobs at once (Part F F5)

Independent KIE jobs go out together. `kie_dispatch.submit_all_ready(jobs)` submits all ready jobs in
one pass (17 ready clips means 17 at once) and names every job it excluded as not ready, with the
reason. Never run a "test batch first" unless the owner orders one. Only a provider cap the caller
passes as `max_concurrency` limits the pass, and the receipt names that cap. The stage order stays
reference images, then keyframes, then clips; the single clips pass is the last one.

- **KIE rate limit:** new generation submits are paced to 20 or fewer per rolling 10 s per KIE key; a 429 means not run and not queued, so resubmit after a wait. See `references/kie-rate-limit.md`.

## Provider policy (KIE first, not KIE lock-in)

```text
IMAGE  -> BlackCEO KIE Image (Skill 66)  -> capability-selected KIE model
VIDEO  -> BlackCEO KIE Video (Skill 67)  -> capability-selected KIE model
MUSIC  -> BlackCEO KIE Audio (Skill 68)  -> Suno via KIE
TTS    -> Fish Audio (Skill 30) when spoken voice is required
ALIGN  -> verified local/approved alignment path; never invent a KIE STT endpoint
```

An optional direct Suno path exists only when the user explicitly chooses it
and a verified provider is configured. No hard dependency on any one image or
video model.

Provider helper skills are **not** bundled in this folder. A clean install
receives the control layer itself; if a required helper is absent, preflight
returns `tool-unavailable` / `module-unavailable` with an actionable error
instead of a silent substitution. Model/role selection for agent work is
resolved by the live runtime rules of the current mode, never by a hardcoded
table in this skill.

## Request and prompt limits (FU-U6, FU-U7, fail closed)

`scripts/core/prompt_limits.py` is the one limit table. It reads the KIE
catalogs (`68-kie-audio` for Suno, `67-kie-video` for video models) and adds a
small override table for what the catalogs lack; every row carries its source
and a VERIFIED or UNVERIFIED status.

- **Suno:** lyrics 5,000 characters, style 1,000, title 80, `negativeTags`
  1,000 (UNVERIFIED until the docs are re-read), duration 10-360 s. The final
  payload is measured AFTER `ending_qc.with_clean_ending` appends the ending, so
  a style that fit before the ending and not after is refused.
- **Video and avatar:** the vendor cap per model (Hailuo family 2,000, Kling 2.6
  image-to-video 2,500, MiniMax H3 7,000 with the owner band 5,000-6,800,
  `kling/ai-avatar-standard` 2,500 UNVERIFIED). `kie_dispatch.dispatch` measures
  the FINAL payload before any other gate.
- A refusal is `PROMPT_OVER_CAP` naming field, characters, cap, source and
  status. Nothing is ever truncated, and a paid video or avatar job with no
  importable limit table is refused `PROMPT_LIMIT_UNAVAILABLE`.

## Captions and protected names (Part H, H7)

Captions are the approved lyric sheet's own words, timed by the Suno
timestamps. Speech-to-text is never a caption text source. Character and
brand names (for example Stale, Stop Stale) are protected words:

- When the lyric sheet is BUILT, the lyric writer may not change a protected
  name or rewrite a packet line (`core/protected_names.py::check_sheet`,
  called by `lyric_writer.validate_lyrics` and by
  `music_director.build_generate_request(packet_lines=..., protected=...)`,
  so no Suno request is built from a bad sheet).
- The words check rejects a take where Suno sang a protected name wrong
  (`music_qc.check_song_qc(..., protected=...)`).
- Build captions with `protected_names.build_captions(sheet, aligned_words)`;
  QC fails any caption mismatch (`delivery_variants.checks.check_captions(...,
  protected=...)`): "the house went still" for "Stale" is a FAIL.

Captions caught early (FU-U8; what main does). `protected_names._tokens` folds
U+2019 and U+2018 and normalises NFKC, so "could\u2019ve" is one word.
`display_text()` turns performance spelling into the caption ("Girl, I got you-u"
burns as "Girl, I got you"; a wordless vocalise makes no cue), and
`build_captions` / `check_captions` use it. `check_lyrics_spelling` refuses a
misspelled lyric word `LYRIC_MISSPELLED` inside
`music_director.build_generate_request`, before any Suno payload exists.
`intake.client_typo_question` sends a client typo back as ONE question and never
rewrites the client's words. `kie_dispatch.onscreen_text_refusal` refuses
`ONSCREEN_TEXT_NOT_CHECKED` for a keyframe or video whose on-screen text has no
checked receipt, and the Script gate always requires a `spelling_grammar`
record.

NOT built on main (FU-U9, no branch yet): reading the burned caption text back
off the rendered frames. Until it lands, the delivered caption text is checked
against the approved sheet, not against the pixels; do not tell a client the
frames were read. The checker that reports this is `UNAVAILABLE`, never PASS.

## Story arc rule and product-connection target (FU-U13, owner order 2026-10-08)

Every ad's story runs struggle -> what changed -> the product is why -> get
the product. The product is named and connected inside the lyrics AND on
screen (cover, title, link) - never only on an end card.

The lyric/script and shot-plan stages plan the spoken-word parts (inside the
spoken band) and the motion shots showing the character's struggle, taken from
the source material, and plan how many seconds connect the story to the
product: aim for 10-15% of runtime
(`length_formula.plan_product_connection`, carried on the plan as
`product_connection`, shown on the choice card).

That band is a TARGET, never a hard cap: the delivery checklist measures the
delivered run (`delivery_checklist.measure_product_connection`, row
`PRODUCT_CONNECTION` in the checklist output) and reports the seconds and
percent. Inside the band is PASS, outside is a FLAG with the measured numbers,
never a blocker by itself and never a repair directive.

## No hand-written pipeline scripts (Part H H12)

Assembly, lip-sync placement and captions run only through the skill's own
modules (`final_assembler/assembler.py` and its siblings). A run folder with its
own ffmpeg or caption script, or a master whose receipt lacks
`produced_by.module` and a matching `master_sha256`, fails QC
(`final_assembler/master_provenance.py`).

## Model and agent choice: the user's choice wins

This skill never picks, forces or recommends a model, an alias or an agent.

- Workflows, subagents and checkers run on the model the session is already
  using, or on an alias the user has configured and chosen. A model or alias
  the user did not choose is never added, pinned or fallen back to.
- If the build needs a model, alias or agent that is not configured on this
  box, stop and tell the user in plain words which one is missing, then let
  the user pick. Never silently swap in a different one, and never name a
  model the user has not set up.
- If the user names a model or agent, use exactly that one.

## Main window: orchestrate only, all work visible, no silent failure

- The main window only operates and orchestrates. It does not do the build
  work itself; every piece of work runs in a visible workflow or visible
  agent that the user can watch.
- A workflow, agent or model that is wrong, broken or not working is never
  allowed to fail silently. Report it right away, in plain words, with what
  broke and what was trying to run. Do not retry quietly, skip the step,
  swap to another model, or carry on as if it worked.

## Runtime modes

One skill folder, two adapters, no second config root:

- `adapters/claude-nine/README.md` - routed mode: router laws, live catalog
  resolution, orchestrator dispatches the build.
- `adapters/claude-code/README.md` - plain mode: plain `claude` stays
  non-routed, same folder, discovery verified.

Do not duplicate this skill into an independently maintained second root, and
never set a separate `CLAUDE_CONFIG_DIR`.

## Local load safety (enforced in code, not advice)

Heavy local jobs (any ffmpeg render, encode, concat or decode, audio cutting and stem
separation, the singing detector, transcription, image and video post-processing) go
through `scripts/core/load_governor/`. Nothing can skip it: the call sites in this skill
already route through it, and a test fails if one stops.

- At most 2 heavy jobs run at once across the whole Mac, every window and process
  together (file locks in `~/.cache/drama-song-ad-factory/heavy-slots/`; the cap can be
  changed with `DSAF_HEAVY_SLOTS`).
- A job never starts while system free memory is under 30%. It waits and re-checks every
  15 seconds, prints one visible line when it waits, starts and ends, and after 20 minutes
  fails loudly naming the job. It never runs anyway and never skips silently. The wait
  time goes into the run receipt.
- Every ffmpeg command carries `nice -n 10` and `-threads 4` (or a lower sized value).
- Intermediate render files are deleted as soon as the next stage has used them and its
  output is verified. Masters, SRT files, the song, stems needed for lip-sync and receipts
  are never deleted. Every deletion is logged in the receipt; a failed one prints a WARNING.
- KIE pacing follows `references/kie-rate-limit.md`. Only NEW generation requests (submit
  and create task: image, video, lip-sync, music, extend) draw from the bucket of at most 20
  per rolling 10 seconds, shared across all processes, one bucket per KIE key. Status polls,
  health checks and record-info reads use a separate gentler limiter (1 request per second
  per process by default, `DSAF_KIE_POLL_INTERVAL_S`) and never consume generation tokens.
  A 429 on a generation request means the job did NOT run and is not queued: back off and
  resubmit. It is never counted as submitted and never dropped; if retries run out the run
  fails loudly naming the job.
- Never the OpenAI whisper stack. Transcription is faster-whisper through `lyric_timing.py`.

## Parallel minute-lanes (ads 120 s and up, W-G-008)

A song **under 120 seconds** keeps today's flow exactly: **one lane, nothing
changes**. At **120 s and up** the ad runs as **N = ceil(L / 60)** parallel
minute-lanes, about 60 seconds each (`scripts/core/lane_planner.py`). The split
is planned by `lane_planner.plan_lanes(shots, song_length_s)` and every cut
lands **on a shot boundary** — a shot is never split; an unreachable boundary
fails closed (`LANE_BOUNDARY_INSIDE_SHOT`), never cuts mid-shot.

**Shared steps run ONCE, before the split** (`SHARED_STEPS_BEFORE`): song +
song checker, plan/shot list, character, close-up picture gate. Each lane then
makes its own stills, motion clips and lip-sync segments **at the same time**
as the others, on the same character, through the picture gate, with **at most
2 lip-sync jobs per segment then the best take**, and mouth strips (the LSP001
process above, unchanged). **Then once, over the whole ad**
(`SHARED_STEPS_AFTER`): ONE edit over the full song, ONE independent checker
for the whole ad (hard audio-length rule, captions = lyrics, face through the
call to action), and one repair.

- **ONE shared KIE governor across all lanes** (`SharedGovernor`): at most 20
  NEW generation requests per rolling 10 s in total, **per-lane share
  floor(18 / N)** (so 3 lanes -> 6 each), and every submit rides
  `load_governor.kie_request`, so a 429 is backed off and **resubmitted, never
  dropped**.
- **Heavy local jobs (ffmpeg) at most 2 at once across all lanes**, through the
  existing machine-wide gate `load_governor.heavy_slot` — no new limiter.
- **Resume and reuse:** `lane_planner.classify_tag(db, run_id, tag)` answers
  against the run's spend ledger — a job tag already in the ledger is **polled,
  never resubmitted**; a finished file is **reused**, so a re-run never pays
  twice. Every lane plans against the ONE ledger run, so spend stays under the
  run cap across all lanes together.
- Tests: `python3 scripts/core/test_lane_planner.py` (180 s -> 3 lanes on shot
  boundaries; 90 s -> 1 lane; shared governor <= 20 per 10 s across 3 lanes on a
  fake clock; a ledger-known tag is polled).

## Tests

```bash
python3 tests/test_cli_smoke.py        # packaged CLI envelope + exit codes
python3 tests/test_parity_layout.py    # layout, registry, adapter hygiene,
                                       # byte parity with the OpenClaw core
```

`test_parity_layout.py` prints `PARITY UNDETERMINED` and exits 0 when the
canonical OpenClaw tree is not on this machine; that is an undetermined
check, not a pass. Run it where the canonical source exists to prove parity.

## Version and provenance

- `VERSION` - this distribution's version (mirrored in the `SKILL.md`
  frontmatter).
- `CHANGELOG.md` - what shipped, when, and from which source.
- `scripts/core/` - packaged copy of the OpenClaw distribution's control
  layer; regenerate it from the canonical source when the core changes, then
  re-run the parity test. Do not hand-edit the copy.

## Sections marked TODO (refresh when the named unit lands)

- `references/choice-card-spec.md` 2.3 and its `TODO(FU-U4)` line - the fit
  card's stop-card form: refresh when FU-U4 lands (PR #124).
- "Captions and protected names" - "NOT built on main (FU-U9...)" for
  reading burned caption text back off frames: refresh when FU-U9 lands.
- Book bullets and `QC.md` book line - FU-U11's `BOOK_BLANK_PAGES`,
  `BOOK_PLAN_NOT_APPROVED` and the Book shots block are described as an open
  branch: refresh when FU-U11 lands.
