---
name: drama-song-ad-factory
description: Build a complete drama-song ad - a sung direct-response story with music, storyboard, generated clips, assembly and delivery - through the shared Python control layer (intake, preflight, spend ledger, state store, QC gates). This is the Claude-Nine / Claude Code distribution of the same canonical BlackCEO methodology the OpenClaw skill ships: one skill folder, one control CLI, two runtime adapters, no second config root. Use when asked to produce a drama song ad or song-driven video ad, or to run intake, preflight, resume or QC gates for an existing drama-song campaign run. Not for motion graphics (use motion-video-plus) or landing pages (use blackceo-signature-page).
version: 2.7.22
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
intake cards list saved characters under "Use a saved character?" (`character
--client-dir <dir> card`; `factory.py card --client-dir <dir>` where the
intake card exists). `character --client-dir <dir> use --name <name>` prints
the brief fields (name, description, reference images, voice notes) to reuse.

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
the numbers: `scripts/core/spoken_share/spoken_share.py`.

The only exemption is the Velvet Voiceover version (the spoken Google voice
over the song, id `velvet_voiceover`), which keeps its own flow. Almost
nobody asks for it. Every other style, including the All Suno voice default,
uses the recipe.

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
  product line, the call to action and the chorus hook, DOUBLED (owner order 2026-10-08): more pieces, not longer ones. A 60 s ad carries 6 to 8 clips of 4 to 6 seconds (30 to 40 seconds, was 15 to 20), scaled linearly with the ad length, no clip over 6 seconds (`core/lipsync_clips.py`); clips go first on every sung hook, the spoken opener and the spoken closing line. Each clip is a paid job, so the cost roughly doubles and a plan past the spend cap is refused loudly (`lipsync_clips.check_budget`). Chosen by the factory and listed on the approval
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
- **Lip-sync close-up (owner order 2026-10-08):** the character reference set always
  includes one lip-sync close-up per speaking/singing character. It is MADE from the
  template `lip_gate.closeup_prompt()` and CHECKED by the lip-sync image gate
  (`lip_gate/image_gate.py`) before any paid lip-sync job: face looking straight at the
  camera; head-and-shoulders, portrait 9:16, face about 35-40% of the frame height
  (accepted 30-45%); mouth closed or slightly parted, neutral, no big toothy smile; nothing
  over the mouth or jaw (hand, microphone, hair, hat brim); soft even light, no hard shadow
  across the mouth, background separated from the head; the same 3D character as the
  storyboard reference; sharp, at least 1080x1920, never cropped out of a wide shot. A
  picture that fails any point, or cannot be measured, is refused LOUDLY with every reason
  and no paid job runs (`lip_gate.run_gate(..., source_image=, image_check=)` raises
  `LipsyncImageRefused`). Every lip-sync job (Kling avatar, InfiniTalk) then uses it as its
  source image. QC: its mouth region must be
  sharp and unobstructed (`lip_gate.check_reference_set`); a set without it fails.
- **Lip-sync sync check (owner order 2026-10-08, looser):** `lip_sync/lip_gate`
  measures mouth opening (mediapipe face landmarks, through the load governor) against
  the voice with the validated `sync_check` algorithm. Verdicts: PASS (SYNCED);
  ACCEPT_WITH_FLAG (WEAK: accepted and used, note in the receipt); FAIL (NOT_SYNCED on
  a SPOKEN line); UNDETERMINED (a SUNG line that is WEAK or NOT_SYNCED: held for a
  person to look at a mouth strip, NO automatic paid redo). UNMEASURABLE (no mediapipe,
  no face model, cartoon face, silent audio, too short) is reported, never a pass. At
  most 2 paid lip-sync jobs per segment, then the best-measured take is kept.
- **Lip-sync model order (decision 33):** Kling avatar
  (`kling/ai-avatar-standard`) first - a front-facing close-up image plus
  that character's own isolated line; InfiniTalk (`infinitalk/from-audio`)
  as backup; **Volcengine is dropped**. Tight close-ups only. The lip-sync
  input contains only the on-screen speaker's line: never a narrator, never
  another character, never a mixed vocal stem. Narrator, phone, voicemail
  and laptop voices may play as voice-over but are never lip-synced onto a
  person.
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
