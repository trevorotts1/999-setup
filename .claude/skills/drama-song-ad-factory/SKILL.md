---
name: drama-song-ad-factory
description: Build a complete drama-song ad - a sung direct-response story with music, storyboard, generated clips, assembly and delivery - through the shared Python control layer (intake, preflight, spend ledger, state store, QC gates). This is the Claude-Nine / Claude Code distribution of the same canonical BlackCEO methodology the OpenClaw skill ships: one skill folder, one control CLI, two runtime adapters, no second config root. Use when asked to produce a drama song ad or song-driven video ad, or to run intake, preflight, resume or QC gates for an existing drama-song campaign run. Not for motion graphics (use motion-video-plus) or landing pages (use blackceo-signature-page).
version: 1.0.0
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
`references/cli-contract.md` (mirrors `docs/operating-and-recovery/OPERATING.md`
in the build tree).

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

## Creative doctrine (shared, not adapter-specific)

- Twelve-stage arc, in order: Ordinary World; Humiliation / Emotional Wound;
  Wound Deepens; Frozen; Seeing It Too; Failed Solutions; Mentor / Trusted
  Guide; Gift / Mechanism / Product Introduction; Doubt; Climb /
  Transformation; Vindication; Return / Pitch / CTA.
- Written for one specific sub-avatar. Product reveal happens after the story
  earns it, normally late in the piece. Pitch follows emotional investment.
- Lyrics are sales copy: first person, short conversational lines, one idea
  per line, product words pronunciation-tested, truthfulness preserved.
- The song is the master timeline; no lip-sync by default (the song is
  narrator / internal voice while characters act).
- Never fabricate testimonials, clinical results, credentials or product
  facts. Creative beats stay separate from production stages.

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
