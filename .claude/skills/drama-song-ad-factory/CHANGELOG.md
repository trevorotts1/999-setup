# Changelog: drama-song-ad-factory

## [2.4.6] - 2026-10-08 - H10 voice matches the character on screen

- `scripts/core/qc_voice_match/line_voice_fit.py` (+ test): each line's median pitch is measured in the vocal stem against the declared band of the character shown; Trevor's 5/10 target rule (<=5 accept, 5-10 accept with flag, >10 `VOICE_FACE_MISMATCH` -> regenerate that take, never keep the closest); numbers in the receipt. Mirrors onboarding skill 75 v2.6.2.

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
