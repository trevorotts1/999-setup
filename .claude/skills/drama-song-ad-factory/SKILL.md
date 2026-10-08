---
name: drama-song-ad-factory
description: Build a complete drama-song ad - a sung direct-response story with music, storyboard, generated clips, assembly and delivery - through the shared Python control layer (intake, preflight, spend ledger, state store, QC gates). This is the Claude-Nine / Claude Code distribution of the same canonical BlackCEO methodology the OpenClaw skill ships: one skill folder, one control CLI, two runtime adapters, no second config root. Use when asked to produce a drama song ad or song-driven video ad, or to run intake, preflight, resume or QC gates for an existing drama-song campaign run. Not for motion graphics (use motion-video-plus) or landing pages (use blackceo-signature-page).
version: 2.7.9
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

The four rules:

1. Suno is told plainly which lines to sing and which to speak.
2. A repeated sung hook is built from the client's own words.
3. Singing starts early.
4. Each take's singing is measured, not taken from its labels.

In plain terms: tag every lyric section Sung or Spoken, and put the same map
in the style text ("SUNG: Hook. SPOKEN: Verse 1, Verse 2."). Write one short
hook out of words the client actually said and repeat it. Get to the first
sung line early (target: 15% of the runtime). After Suno returns a take, run
the detector and judge the sung and spoken shares from what it measured.

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
  product line, the call to action and the chorus hook - three to four lines,
  about 15 to 20 seconds, chosen by the factory and listed on the approval
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

## No hand-written pipeline scripts (Part H H12)

Assembly, lip-sync placement and captions run only through the skill's own
modules (`final_assembler/assembler.py` and its siblings). A run folder with its
own ffmpeg or caption script, or a master whose receipt lacks
`produced_by.module` and a matching `master_sha256`, fails QC
(`final_assembler/master_provenance.py`).

## Runtime modes

One skill folder, two adapters, no second config root:

- `adapters/claude-nine/README.md` - routed mode: router laws, live catalog
  resolution, orchestrator dispatches the build.
- `adapters/claude-code/README.md` - plain mode: plain `claude` stays
  non-routed, same folder, discovery verified.

Do not duplicate this skill into an independently maintained second root, and
never set a separate `CLAUDE_CONFIG_DIR`.

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
