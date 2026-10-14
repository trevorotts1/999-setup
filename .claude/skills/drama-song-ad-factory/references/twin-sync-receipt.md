# TWIN-SYNC receipt — W3-twin-sync-U1 (Drama Fixes batch, 2026-10-13)

Unit `W3-twin-sync-U1` (BUILD-PLAN.md section W3-twin-sync-U1, Drama Fixes Oct 13):
skill 75 core twin sync with fingerprints and receipt. This file, the regenerated
`scripts/core/` and the regenerated core blocks of
`references/twin-sync-fingerprints.json` are this unit's whole change.

## What was compared

| Side | Repository | Tree | Commit |
|---|---|---|---|
| Canonical (source of truth) | `trevorotts1/openclaw-onboarding` | `75-drama-song-ad-factory/scripts/core/` | `26d49681bcba1f760817f6c0c3cefa56092c2ae7` (branch `batch/DSF-3`, head of PR #1957) |
| Packaged copy (this repo) | `trevorotts1/999-setup` | `.claude/skills/drama-song-ad-factory/scripts/core/` | `75ba61ca59427e9dae3ec550eb0e07f2ead53fa0` (`main`), packaged on branch `unit/DSF-W3-twin-sync-U1` |

**The source is a PENDING batch head, not `main`.** Trevor's order 2026-10-13 15:36:
"building never waits for a merge" — this sync copies from `origin/batch/DSF-3`, the
head of the still-open PR #1957, instead of waiting for it to land. The source SHA
above was read live (`git -C ~/openclaw-onboarding rev-parse origin/batch/DSF-3`) at
build time. **Conductor action after #1957 merges:** re-run
`tests/twin_sync_prove.py` with `--canonical` pointed at the new `origin/main`
`scripts/core`; if it reports any `only-canonical` path, re-run this unit's packager
against the new main before the batch merges.

Both checkouts are read-only for this unit. The source tree used here was exported
read-only with `git -C ~/openclaw-onboarding archive <sha> -- 75-drama-song-ad-factory/scripts/core`
into this unit's lane; `~/openclaw-onboarding` itself was neither branched, checked
out nor written.

## In scope vs deliberately out of scope

**In scope** — `scripts/core/` on both sides (the scope `references/parity-contract.md`
names and `tests/test_parity_layout.py` / `tests/twin_sync_prove.py` enforce), plus the
two metadata files this unit owns (`references/twin-sync-fingerprints.json` and this
receipt) and the one layout-alias symlink described below. Nothing else.

**Deliberately out of scope** (unchanged by this commit, each with its reason):

- `references/twin-sync-fingerprints.json` -> `studio_bridge_twin` block — that block
  pins `.claude/skills/drama-studio/`, owned by **W3-twin-sync-U2**, which copies the
  bridge bytes. Measured on this branch, and left for that unit:
  `shared-bridge/studio_claim.py` is already byte-identical to `batch/DSF-3`;
  `shared-bridge/studio_bridge.py` and the new `shared-bridge/approvals_bridge.py` are
  NOT (`studio_bridge.py` live sha256 `b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956`
  vs packaged `9dcef59746601dc7cb708835b790ae05228c0df437107e643c94930cec98597e`).
  `tests/test_studio_bridge_twin.py` therefore passes as written (recorded fingerprints
  enforced, live compare UNDETERMINED) and fails its optional live compare until U2 lands.
- `references/twin-sync-fingerprints.json` -> `round3_*` blocks and `layout_alias_added`
  — historical record of sync round 3 (unit TWINR3-U1). Carried through byte-for-byte.
- `VERSION`, `skill-version.txt`, `CHANGELOG.md`, `SKILL.md`, `INSTRUCTIONS.md`,
  `INSTALL.md`, `PREREQS.json` — per-repo wrapper documents that legitimately differ;
  the Drama Fixes batch adds one version bump and one CHANGELOG entry for the whole
  batch (SWARM-PLAN.md section 7). No version or CHANGELOG edit is in this commit.
- `adapters/`, `assets/`, `references/**` (other than the two files above), `tests/**`
  other than the provers' own behaviour, `mini-app/`, `shared-bridge/`,
  `timer-artifacts/`, `installer-registration/**` — onboarding-owned trees with no
  999 counterpart, or owned by other units.
- Skill 68/66/67/74 helper re-pins — the helper pins did not move with `scripts/core`;
  `installer-registration/helper-deps.py` was not run and `installer-registration/helpers/`
  is untouched.

## How it was regenerated

The repository's own packager, no hand edits (directive 2.4):

```
python3 installer-registration/package_core.py \
  --source <lane>/src/75-drama-song-ad-factory/scripts/core \
  --dest  <worktree>/.claude/skills/drama-song-ad-factory/scripts/core
-> package_core: OK  493 files (15 written, 0 stale removed) ...
   tree sha256 packaged=canonical=de72330e9227772853babb05477f0ffc5f0f4595ac68dba64a15ec95a8404b8c
python3 installer-registration/package_core.py ... --check
-> package_core --check: OK  493 files match canonical     (exit 0)
```

## Layout alias added (1 symlink, no bytes)

The canonical core's `scripts/core/choice_card/intake_card/channel_send.py` (the
`studio` channel from W1-box-bridge-U4) resolves `approvals_bridge` and
`studio_bridge` at `<skill root>/shared-bridge` — the onboarding layout. This
distribution mirrors `scripts/core/` only (`parity-contract.md`) and has never
shipped a `shared-bridge/` tree (`git log --all --diff-filter=A -- '*shared-bridge*'`
is empty). Synced as-is, the two canonical tests that exercise the channel's key
lookup therefore died here with
`ModuleNotFoundError: No module named 'studio_bridge'` (channel_send.py:126),
a failure the canonical tree cannot see.

Repair, one symlink inside this unit's own folder, the same shape and reason as the
`68-kie-audio` layout alias the last sync added:

| Alias | Target | Why |
|---|---|---|
| `.claude/skills/drama-song-ad-factory/shared-bridge` | `../drama-studio` | points the canonical `<skill root>/shared-bridge` at the 999 bridge copy in `.claude/skills/drama-studio/`, which **W3-twin-sync-U2** refreshes byte-for-byte from the same canonical `shared-bridge/` tree |

No bytes are duplicated, `scripts/core/` stays byte-identical, and nothing under
`.claude/skills/drama-studio/` is touched by this unit. Recorded in
`twin-sync-fingerprints.json` -> `layout_alias_added`. On a 999 install that has not
yet received `drama-studio` the link dangles and the studio channel fails loudly with
the same `ModuleNotFoundError` it would have raised anyway — no behaviour is removed.

## Regression (same command, before vs after)

`HOME=$(mktemp -d) python3 -m pytest -q .claude/skills/drama-song-ad-factory/scripts`
(the `drama-song-tests.yml` CI command), run on a detached `origin/main` worktree and
on this branch:

| Side | Result |
|---|---|
| `origin/main` `75ba61ca5` (baseline) | `1847 passed, 3 skipped, 58 subtests passed in 124.68s` |
| this branch | `1900 passed, 3 skipped, 58 subtests passed in 125.19s` |

+53 new tests (the 53 test functions the synced core carries that main did not),
zero new failures. `python3 -m pytest -q .claude/skills/drama-song-ad-factory/tests`
→ `13 passed`. `for p in .claude/skills/drama-studio/prove/*.py; do python3 "$p"; done`
→ all six provers exit 0 (`prove_heartbeat.py`, `prove_option2_monitor.py`,
`prove_option3_runner.py`, `prove_plugin_behaviour.py`, `prove_user_agent.py`,
`test_upload.py`).

## Normalisation

Exclusions `__pycache__/` and `*.pyc`, applied **identically on both sides** (the same
rule `tests/test_parity_layout.py` uses). **No other normalisation**: raw file bytes
hashed with sha256. No line-ending, whitespace or generated-marker rewriting, so no
real content difference can be hidden.

## Result

- Pre-sync (999 `main` vs canonical `batch/DSF-3`): **in_scope=493, same=478, differ=4,
  only-canonical=11, only-packaged=0 -> PARITY BROKEN** (this is the gap the unit closes;
  the 15 divergent paths are the tables below).
- Post-sync (branch `unit/DSF-W3-twin-sync-U1` vs canonical `batch/DSF-3`):
  **in_scope=493, match=493, differ=0, only-canonical=0, only-packaged=0 -> PARITY PROVEN.**
- Packaged tree sha256 == canonical == `de72330e9227772853babb05477f0ffc5f0f4595ac68dba64a15ec95a8404b8c`.
- The prover discriminates: `twin_sync_prove.py --selftest` -> `SELFTEST: PASS`
  (one planted byte and one planted extra file both caught).

### Added in-scope paths (11, absent on 999 main)

| In-scope path | canonical sha256 |
|---|---|
| `choice_card/intake_card/optional_extras.py` | `88799d3d97dee03aea0aac0c85d65523a85ea7e5415b90a87fafee49888cd75f` |
| `choice_card/intake_card/person_question.py` | `f7afd75f5043955e759e329a40bb878530e0059dc02faa4c0295251bf153e5c5` |
| `choice_card/intake_card/person_question_fixtures.json` | `7c7c7269a40ce5a5a338d9884bab005ca76c68d5bb1c3d98c6e491dad29875cb` |
| `choice_card/intake_card/test_channel_send_studio.py` | `6093a71e3e723a6d9a9bf66db317489604e475addead5c20bb33f01a656cc5a7` |
| `choice_card/intake_card/test_optional_extras_u10x.py` | `ca9c4ec6941100602011e098938a6e47e76cbfa14bb511f852aef3e9c810aad3` |
| `choice_card/intake_card/test_person_question_u9.py` | `589536cffb361450d295a0c9360c9db2f00713d9d2daabfbe85edd0cfefc8b37` |
| `ghl_sender/README.md` | `120eafc14c2acf1aef7a61ceab3f00f7f5b0245fcb8102b532255bc5f1771a77` |
| `ghl_sender/__init__.py` | `3d0374612594df14c5d8c45df97f7f1d119512a202d689132f730f722f6bd39b` |
| `ghl_sender/ghl_sender.py` | `c262a0040f209ad4250dff1d1380c3c2b9d665960174ae828cda702d4b3199fa` |
| `intake_preflight/test_factory_studio.py` | `56daa029d0186ae826b4680ad606dc32fac532af7beb93789c44aee110e3926b` |
| `test_cc_sync_studio.py` | `b16c030b3620f6d6f40fe8f3b0df4c5e0b708d913f72d83eb8af8ab1c01b9a5a` |

These are exactly the "8 onboarding files + the stale `music_qc/test_wwfix_u1.py`"
gap BUILD-PLAN.md names (`optional_extras.py`, `test_optional_extras_u10x.py`,
`person_question.py`, `person_question_fixtures.json`, `test_person_question_u9.py`,
`ghl_sender/README.md`, `ghl_sender/__init__.py`, `ghl_sender/ghl_sender.py`), plus the
three `batch/DSF-3` test files for the studio wiring merged by PR #1957
(`test_channel_send_studio.py`, `test_factory_studio.py`, `test_cc_sync_studio.py`).

### Changed in-scope paths (4, copied byte-for-byte from canonical)

| In-scope path | canonical sha256 | packaged sha256 (pre-sync) |
|---|---|---|
| `cc_sync.py` | `c1beb16f7678cc20b512edfe4e65b99a7d045f9927c73d4476d5befe4e9fff50` | `6d8d1ecc22f3174aa8b2a5c9f5f2cbe26551b5e0e99f545812b368e7415087e5` |
| `choice_card/intake_card/channel_send.py` | `5878cb15c990afd087933784ffe3245b8f323ab319c08470d80ddaeb56eb884e` | `1a0067bbc2d8f719cc7942db5f0cacd1947da0327ad6e205368ab8e65e6fac88` |
| `intake_preflight/factory.py` | `274dd5fc405f00b375e4c5e2bab1aff73626079812b46621a9174fc194edfbe2` | `b9963bd56d4f16e64c14e0270646c9648ee5e6d5bec8906f0b30a46bfdac94da` |
| `music_qc/test_wwfix_u1.py` | `8a621d291a6bff7b63b2c935423006a9898883e81622c0fef9816ec7715e907d` | `963fd0274794f61dc906dde130c0da7781e0b63347dc832195f325af8ae20b9f` |

Deleted in-scope paths: **0**. The full per-path two-sided table for all 493 in-scope
files is in `twin-sync-fingerprints.json` -> `files`; the pre-sync divergence is in
`pre_sync_999_main_divergence_from_canonical` (15 paths) and `pre_sync_summary`.

---

## Fingerprints refresh on the batch head (batch/DSF-5, 2026-10-13)

The `studio_bridge_twin` block above was **deliberately out of scope** for
W3-twin-sync-U1 and was left to W3-twin-sync-U2 (see "In scope vs deliberately out of
scope"). This section records the refresh the batch itself performs, because merging
U2 without it leaves `tests/test_studio_bridge_twin.py` red: U2 copies the packaged
`.claude/skills/drama-studio/studio_bridge.py` forward to the newer canonical bytes
while the fingerprint block still pinned the older pair.

**The single entry changed** (`twin-sync-fingerprints.json` -> `studio_bridge_twin.files.studio_bridge.py`,
both fields; every other entry in the file, including `files`, `pre_sync_*`, `round3_*`,
`layout_alias_added` and `studio_bridge_twin.files.studio_claim.py`, is untouched):

| Field | Before | After |
|---|---|---|
| `canonical_sha256` | `9dcef59746601dc7cb708835b790ae05228c0df437107e643c94930cec98597e` | `b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956` |
| `packaged_sha256` | `9dcef59746601dc7cb708835b790ae05228c0df437107e643c94930cec98597e` | `b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956` |

Both sides were read live on the batch head, not copied from either document:

- **packaged** — `shasum -a 256 .claude/skills/drama-studio/studio_bridge.py` in the
  batch worktree (`/Users/blackceomacmini/dsf-wt/batch-N-5`) after all seven member
  merges: `b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956`.
- **canonical** — `git -C ~/openclaw-onboarding show origin/main:75-drama-song-ad-factory/shared-bridge/studio_bridge.py | shasum -a 256`
  (`origin/main` = `5cd1d6145306d83cf8a9cbc532f4d64c22c7137e`): the same
  `b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956`.

The two digests agree, so the sync and the canonical side have **not** diverged — no
BLOCKED condition. `batch/DSF-3` (`26d49681bcba1f760817f6c0c3cefa56092c2ae7`), the
source this unit synced from, is an ancestor of `origin/main`, so the receipt's
"re-run against the new origin/main" action above has been satisfied: the canonical
core and the canonical bridge are now on `main`.

Proven on the batch head, both ways:

```
# recorded-fingerprints mode (no canonical tree on the machine)
python3 -I .claude/skills/drama-song-ad-factory/tests/test_studio_bridge_twin.py   -> exit 0
# live canonical compare (DSAF_CANONICAL_SHARED_BRIDGE = throwaway
# `git archive origin/main 75-drama-song-ad-factory/shared-bridge` export)
python3 -I .claude/skills/drama-song-ad-factory/tests/test_studio_bridge_twin.py   -> exit 0
```

`studio_claim.py` needed no edit — its recorded pair
`b2d8367116552b906f7d1c14ee1f4d884b6a03b1434a44517686cb237bccbb42` still matches both
the packaged file and `origin/main`. The third bridge U2 ships,
`approvals_bridge.py` (`f2a61598dff3b2ec013ff6977e55c3a2acf6cdd9ae3f1c5778944c88d0a90e1a`,
identical on both sides), is not part of this block: `test_studio_bridge_twin.py`
enforces exactly the entries `studio_bridge_twin.files` carries, and the record was
never extended beyond those two — extending it is a change to the contract, not a
refresh, and is left to its own unit.

---

## Archive — the previous core receipt (unit TWINR3-U1, kept verbatim)

# TWINR3-U1 twin-sync commit receipt

Unit `TWINR3-U1` ("Round-3 twin re-sync, same-scope fingerprints, 999/helper
commit receipt", order ORCH-TWIN-17-29, authority WW-ROUND3-FIX-PLAN.md lines
22-24 and 36). This file, the fingerprint artifact beside it
(`twin-sync-fingerprints.json`), the regenerated `scripts/core/`, the synced
round-3 data files, the re-vendored skill 68 helper, and the `VERSION` +
`CHANGELOG.md` bump all land in ONE commit on branch `unit/TWIN-R3` in
`trevorotts1/999-setup`.

## What was compared

| Side | Repository | Tree | Base commit |
|---|---|---|---|
| Canonical (source of truth) | `trevorotts1/openclaw-onboarding` | `75-drama-song-ad-factory/scripts/core/` | `4179b542db4020260d1857d1e0175a7d6344c105` |
| Packaged copy (this repo) | `trevorotts1/999-setup` | `.claude/skills/drama-song-ad-factory/scripts/core/` | `0e54bd73e7053aaa8f00880179af06b707f88de2` |

The onboarding checkout is read-only for this unit and was not mutated. It is a
FRESH clone inside this unit's lane at exactly
`4179b542db4020260d1857d1e0175a7d6344c105` (skill 75 v2.9.32, root v27.1.11). The `999-setup` side is also a
FRESH clone inside the lane; the operator's local `/Users/blackceomacmini/999-setup`
was not read or written.

## Round 3 (the gap this closes)

Round 3 landed on onboarding main after U18's canonical pin `68f686350…` and was
never mirrored: PR #1858 WWR3INT2 + WW-21 (`bc2829421`, ancestor ✓),
PR #1863 WWB-U1 (`1478eb8d2`, ancestor ✓), PR #1865 WW29 + WWC-U1
(`4179b542db4020260d1857d1e0175a7d6344c105`, ancestor ✓). Ancestry checked with
`git merge-base --is-ancestor <mergeCommit> 4179b542db4020260d1857d1e0175a7d6344c105`.

## In scope vs deliberately out of scope

**In scope** — `scripts/core/` on both sides, plus every round-3 file the twin
carries at the same relative path that is data consumed by that core. The scope
is derived, not guessed: `references/parity-contract.md` names `scripts/core/`
as the canonical core and its packaged copy, and `tests/test_parity_layout.py`
enforces byte-identity over exactly that scope.

**Deliberately out of scope** (measured, not assumed):

- `VERSION` / `skill-version.txt` — wrapper version files; the two distributions
  legitimately name their versions differently (2.7.45 here vs `v2.9.32` there).
  No twin `skill-version.txt` was invented.
- `CHANGELOG.md`, `CORE_UPDATES.md`, `SKILL.md`, `INSTRUCTIONS.md`, `INSTALL.md`,
  `PREREQS.json` — per-repo documentation that legitimately differs. Of these,
  round 3 changed `CHANGELOG.md`, `INSTRUCTIONS.md`, `SKILL.md` and
  `PREREQS.json`; all four are named here as the round-3 changes the twin does
  NOT carry, because the twin owns those files.
- `adapters/claude-nine/`, `adapters/claude-code/` — the parity contract
  explicitly permits runtime adapter guidance to differ.
- Onboarding-only trees with no 999 counterpart: `mini-app/` (49 files, changed
  by round 3 in `service/` and `ui/`), `shared-bridge/`, `timer-artifacts/`,
  the onboarding-only `tests/` trees, `scripts/camera_shot_rules/`,
  `scripts/camera_signatures/`, `scripts/two_strike*`, `scripts/openclaw_adapter.py`,
  `DEPENDENCY-MANIFEST.md`, `PACKAGING-DECISION.md`, `THIRD_PARTY_NOTICES.md`.
- 999-only files with no canonical counterpart: `VERSION`, the two adapter
  READMEs, `assets/example-brief.json` and the 999 test files
  (`tests/test_cli_smoke.py`, `test_launcher_plain_claude.py`,
  `test_master_provenance_h12.py`, `test_parity_layout.py`,
  `test_single_config_root.py`). `tests/twin_sync_prove.py` is the 999-only
  prover added by U18 and is unchanged here.

## Normalisation

Exclusions `__pycache__/` and `*.pyc`, applied **identically on both sides**
(the same rule `tests/test_parity_layout.py` uses). **No other normalisation**:
raw file bytes are hashed with sha256. No line-ending, whitespace or
generated-marker rewriting, so no real content difference can be hidden.

## Result

- Pre-sync (999 main vs canonical): **same=426, differ=45, only-canonical=11,
  only-packaged=0 → PARITY BROKEN.**
- Post-sync (branch `unit/TWIN-R3` vs canonical): **in_scope_files=482,
  match=482, differ=0, only-canonical=0, only-packaged=0 → PARITY PROVEN.**
- Packaged tree sha256 == canonical == `f069a2a767ec7a1b4b24cc487eb423447578d18488aef745b86c1c3f994c3703`.

`scripts/core/` regenerated with the repository's own tool
(`installer-registration/package_core.py --source <canonical core>`): **45 files
changed, 11 files added, 0 deleted** (482 canonical files; the tool reported
`56 written, 0 stale removed`).

### Added in-scope paths (11, absent on 999 main)

| In-scope path | canonical sha256 |
|---|---|
| `music_qc/pace_change.py` | `efbab106728600794d7f2ca011b4b7a019a22d7b2f4feb4be7d2ffa1236c86db` |
| `music_qc/rap_check.py` | `0da06f2bb67a7e2a035f7279308134e11cd4cf1c6d85b33e103eb78acfd27726` |
| `music_qc/test_ww1848f_rap_accept.py` | `a7606301a2a63c64e737b0ccad3726f88368468ae8786d0f700055495f8806a8` |
| `music_qc/test_wwfix_u1.py` | `963fd0274794f61dc906dde130c0da7781e0b63347dc832195f325af8ae20b9f` |
| `song_choices/overlap.py` | `ec650042c332ea4f6dbd7a07ce185bdb0e90dbc3d3b6d282329d8926bc7c0127` |
| `song_dispatch/test_song_dispatch_ww_u1.py` | `ea42a1d1bf4bd7253d7ab8f1bf16afe66ef9007ca0f808553b1cc2a5ba7bd1d7` |
| `story_coverage/__init__.py` | `88b754e538c357a5e1ae92daaffa652de3a1c991b249efcf5e7da31831007d4a` |
| `story_coverage/story_coverage.py` | `e0c69aabd8b9dc8e61bb038ddecea50b0a42713d5062321ba029406d75d4cbe1` |
| `story_coverage/test_story_coverage_markup.py` | `4ede83603e7eabed90f02fe7f24f538bd842bb6ebebab47b5cbc809aacc3285f` |
| `story_coverage/test_story_lexical_timeline.py` | `0e7190fcfab4e40ab8892d1fe29e26dfdc54001a97060544adabd954294a8c6d` |
| `test_music_createtask_ww30.py` | `d4303a9e8c432bbe04c2eaee7271494b03d3283ba838d6292538e4270d7c9c66` |

### Changed in-scope paths (45, copied byte-for-byte from canonical)

| In-scope path | canonical sha256 | packaged sha256 (pre-sync) |
|---|---|---|
| `acceptance-profile.json` | `664799e7fcab60920f18c08a4bfb6b7cc2d6830091355ebdaebfcddbedf5b4e4` | `8688ce3802f9d1c6f86727e5554df9ef5302bc2fc246f1eb5a45eb7c7a974c15` |
| `audio_c3/test_lyric_timing_f17.py` | `27c197a162c8b5c9710a8ae4f4e11ada13a6d59d7270405279fc18018beab4c3` | `3be7c5385e6a743c5992ef7375b34b79559d9f0c7d751cf8ee5973b021e8bb4b` |
| `character_bible/character_bible.py` | `d15fb52a63a75afd25f359516bc8986ab5f22af5e66cc6fcc6209a1cf431de03` | `d4536782f7c110cbb7263e948f1bc91a9e2d275baccd546ed28e44f1005eb632` |
| `delivery_checklist/test_song_mp3_u14.py` | `7178e75b9bbebc0f046f837bc5f65bf9aac46fd827b022f07ccaae36d35596bb` | `8b2b7b3febd389c1ef08683c0a0f816acfb394dabc50eefbbae289a0618cfe6b` |
| `face_emotion/face_emotion.py` | `9a3f5e03a65b91955cec0baa8b8b96b12e9c999c68a0fd14b1ec14293f8f3950` | `8c4dd0fc2dab1fd0b05eba901203ff45d3a40be9051f863d076c0bbaebf102cb` |
| `intake_preflight/factory.py` | `b9963bd56d4f16e64c14e0270646c9648ee5e6d5bec8906f0b30a46bfdac94da` | `dbee100091590a2c4f1b3ef5b32057716e19442953c2758b276c6f99158f5d7e` |
| `kie_dispatch/__init__.py` | `43db6afa70aaef4e657ebeb311c030a1ed96d2d39fe0860a3d90f438a571b035` | `6d97d83882e61c9396b0dd1cb13609dab5b6aebe915c760338d5cfb5aa5e8f3c` |
| `kie_dispatch/kie_dispatch.py` | `5ed775c05ff800526e6a60dd2c34f946e5a6da8144d72e8c0e58a080c9b8677c` | `d88b71f1da98b0dbe8da1d249519e1bb2b75aa8d329a38e62e46701905bd7855` |
| `kie_dispatch/test_kie_dispatch.py` | `4601a2a587ea318abef9737cab2c5d8217f2fbc41c7b3601ab446cc6ce7e6c5a` | `72d8351d45ef1ba6f1ee4ac323d1cd8f93cd2ea4b4106d399a7f3aeb7957951c` |
| `length_formula/__init__.py` | `00f2d0640a0e82a0b9b0e18843972c843b17c3c098baa2806477512fa34784d1` | `fc7403418cf0b20b86a3e026a4e54e42df1d50cc066b02bf0bbf18991bb360d4` |
| `length_formula/length_formula.py` | `21cf65d61a767a938f6add65f6b4c2b93b35d882895ac9166cdd9541747af77a` | `91e8ecf4a9b9ba463b3ea0d68d6b77d5c6cd0c28b225679f5a31ef37d8d906be` |
| `lip_sync/lip_gate/picture_gate.py` | `8335a13b208523ff7d873423b69048e247772b231e19c215fafacb0d3338877c` | `d0170fd5907a3d69f4e4c106fbfe337fca16d0d4387392ca4b90a545755cbfe6` |
| `lip_sync/lip_gate/test_picture_gate_lpg001.py` | `ac2c2046d682b3914aab897927c835a6f9714703bc0d293beccf76af801deb8e` | `ef754c246033f2abd1f93c806e7646734e66d318b2ce2a9919624160fb299e0e` |
| `lyric_writer/lyric_structure.py` | `8e61019510796fb3c830d946b749a21ef6661abb51390dde3c8998c4b382d090` | `b4f848a1ffdc87bb1604d15f88b9a700c337d957f04e770608ea4ad908304d9b` |
| `lyric_writer/lyric_writer.py` | `894580e0ce12380938f0edca85a48d2f2550055d2d79902b7a15eb4586a3d4d3` | `72f6a3182bf101864a2e9ab277ed5a49518ceb5af10e9856c44bb7df003ef61f` |
| `music_director/__init__.py` | `0716bb0bb93b614c40b1145edf71c5e2e79b9b26179f219c96372b1c9c43d6b1` | `d23a8e0c33e0c057ddc7f6d1af3b093430c0ab8ab786254b6f07fc426ed0acb1` |
| `music_director/test_prompt_limits_u6.py` | `29b22a89a351846282a794f6846c481b9cd2b651d0adea4927a67fa96ccecad3` | `534927cb770d6abbf2be385c256d9c4db65477f92f6854d10c8d23d6da63b0ca` |
| `music_qc/__init__.py` | `8db3f659e82911cf698b186e55a4c831df1ccd946c0862e53badbcc6ef75fb71` | `f4dcd045837c718586b32ea442675263e1ef89ca9ad607ff8c94f89815e9ca05` |
| `music_styles/test_delivery_map.py` | `c79b0b70c10d93b90bf2ee0442d0b7e69b24559a9a6ad0540e4c2aac56e89871` | `8dbe5144ccae4934b4d2e0320b6ee41203b482118393b89bb9ccd7c67a0c19a7` |
| `qc_voice_match/line_voice_fit.py` | `138d07bf4985ee327836dd66520db9cfbe86d3d050699009a31ba1e6edf220c4` | `8261286f1af13fb57729223a28e99a0b88a2f888122f6aa82a0898f4b313ce15` |
| `script_approval/script_approval.py` | `02c23c2973777dc63ba8bb4d2aa249fffec124e05116111f26e5a86d32dce370` | `f24d1ef5ecb071d34fc7335d41d9c365118eba9b543e68118aec582733a41f14` |
| `script_approval/test_script_approval.py` | `92b270027bf8d3e862827ceb32eea59aa213cfe7c08d0ed13a8c893c6065bd3c` | `d7cb8829159117ed124cb0aba6d4060e53d22bde8911d1a7cc9b792251013b0f` |
| `song_choices/song_choices.py` | `056ce02707dd56453dfcd2e055288b1aab209a6f5debad9e8a5015a326c168ec` | `d0022d0c9ac687a0c6c8c1b01845b2f1d43c73cba48b46e95316632b7b258631` |
| `song_choices/test_song_choices_fu_song.py` | `e36eda4026a08cea4736a8ea04995ed444e6bc37c52732cff93d101259132511` | `46d968d18f4ef488c1b4600f0e3dfe4117a596531efb3c236a53c2cb866307a6` |
| `song_choices/variants.json` | `484b7cc12b09c4aedc634b25dc49875715228452862d51a7e09491d2cae0e270` | `9c7ccac2e51dbc6b6c80b33ad126c0d502787a040acd45e47c62eef1959944cb` |
| `song_contract/__init__.py` | `f6fd01a9d004697e5c6aa7ea40863747ced4fe6d874a008e167151c83e916eae` | `84c7ea8b9f3f620c41366019f26388695029ead5776d9c1d8d7364040e81f553` |
| `song_contract/fixtures/rnb-flow-150-pass.txt` | `d68c36028523828e4941117beeefaa7e3d290abcdbad058cc0a3c519468afcdf` | `570106b0d81b84c1a1d06f54c0d378cdb82212e827f64b1c26085788c7084f20` |
| `song_contract/song_contract.py` | `73376246e601742cc0b216525968a1f49b3fc188a060180a3a4baf6b83a54275` | `28c8203d956aacd78b49e105903927426fc28066dd6b03e663b1a7f2d4f00221` |
| `song_contract/test_song_contract.py` | `aba81e3b0290a89873f441b35b3342f1ba00d022c7fb6bba9d5f391a6cd2d922` | `1030dd70661930bb8c7ba3b1d82943cac909a0920aaa0235709c7ea6c1c75bde` |
| `song_dispatch/song_dispatch.py` | `288b505d1c2023e4959f9d53d6a7dd8aa6c866ede7c5b9c007d1d092a9db0e97` | `f29ca5f84f9ff796ded6007c97dbb3d4d8ecf2775a961963bf5f44c6320e12a9` |
| `song_dispatch/test_song_dispatch.py` | `521ddc5e51e194226e3546bcf5f4c7d01b7afa2c543af7ab7307c9c81499d30d` | `347c3de2ed667afbeb6de67475b2bfc7abcf79309ed331ce4f994a45a0ea9c6c` |
| `spoken_share/spoken_share.py` | `c64c4c60ef0370d8c04d446b210dcc68a43812a423fde416a71d733509dcd313` | `5cb41719f57b14711c736be9bd2d91b23ddc22ff5ce23cc8c414ff2b43390c43` |
| `story_arc/story_arc.py` | `b4de87242e7a7c5ef5f7a280b9dc6e1a9c93335ea10ab11ad35b2cc50561d5d2` | `04c1ff306a99327ab0c0e43e6c4cc380e03c1cbda8e8ca02ccc9d8d7c09094b4` |
| `sung_hook/test_hook_placement.py` | `6058db0c25f34939bb00abea9e91861ba62559f8777e6261d05d2b405f4ded26` | `aa2074caa593543ea49d0f80fc9f1c12b9ced92d6a9b7ae1fa79fba7ff20d922` |
| `sung_hook/test_no_skip_and_goldens.py` | `9638ca171ceb9d7056ee10e09e38bad52fa6f3a6ad3376cabe03535960c231a0` | `1205192fea4fb36bc5f8920e8a4baf9e5e95b4285d8130a0ea8569600c658158` |
| `sung_hook/test_sung_hook.py` | `72e5dd8163a04c67f3440753fc431051adaa9fbdecb77e23f177e26744dd8417` | `2353ca4efdee5f50c1a4379a65a2eaa06fba6b0f10527e8caa3c96a9cd2a0913` |
| `suno_recipe/__init__.py` | `d9e95c5730284bbdab481574f6b0e9ce8e64144e638c69b962b58a6f5f37409f` | `31259b53bb135b70a7f527ee6fcb7b4ce3da73725b31b20638ec556ca6c54459` |
| `suno_recipe/suno_recipe.py` | `4672f0fb4385b07920f91fb50fc507c508afff913c7b03a30e5d9fc45ac4bae3` | `157084e06cf60caa59af1729595304caed77f38a71291b9934c601289ff02590` |
| `suno_recipe/test_suno_recipe.py` | `fa9cdd425a7d3a2d4b7cac9783827ea37d2a357e4760e54abc0e67896987c71d` | `b3812a303dc5770d00a6fe85d69df0c53774cbcf8c9b0551a75195cb26306d14` |
| `suno_recipe/test_suno_templates_u15d.py` | `7414e7bb5f73de8cf0f5d040c8b6192c4d4a5d157d46fb07807a05f1568132ff` | `511f59828d2e97ca7efb7790d5955331d515a3d19f73b0c19ff7a99a300ff355` |
| `suno_recipe/test_voice_tags_u5.py` | `3b89a1814350b7be92d201e2691479a082bd426c332bce9eda18736140a3d613` | `7c0025ec9bda14a7f5b3fbfb06ade81227fe83ea12254b83e4d933aad57d8ab5` |
| `target_engine/test_target_engine.py` | `e58fa0d5f11dcba32adc604de5719321a13d7518642b73814005a0f2152c069b` | `fcdf20eb0332187129d50f78e284e72798c294fc5dad4bce31ab1ebde47b1afb` |
| `timing_guard.py` | `a250e102f3deaaa1d8e128103dfefae7aa1be5e0c5b0151e0f89153b4b637c2a` | `e39232b8c72a56ce2810ce84b456be87eef3544bddcae4945d3724e201602498` |
| `words_fit/test_words_fit_g9.py` | `00d47effc9ec9dae9d9059627700638b2cdf99a260e195b17de59116ca0a5642` | `43d0ee56e78d0609f9ffd941b37d59fedab8997eb25b00155b7a8ad078f74bd1` |
| `words_fit/words_fit.py` | `300ce955b1fb23f3d08800f4f777301e049c34615f4696466f04b2180d1dbac4` | `061e9ecdce11df36c914edac94ed841ee5862c5c8da63e0b888fc57ffd1feba1` |

Deleted in-scope paths: **0**. Post-sync every path above carries the canonical
sha256 on both sides; the full per-path two-sided table (all 482 in-scope files)
is in `twin-sync-fingerprints.json`.

## Round-3 non-core files synced (12)

Byte-identical to canonical after this commit (fingerprints in
`twin-sync-fingerprints.json` → `round3_non_core_synced_files`):

| Path | Why it is in scope |
|---|---|
| `references/prompt-templates/models/suno-v6.json` | model data consumed by `scripts/core/suno_recipe` |
| `references/prompt-templates/music/soul-rise.json` | music data consumed by `scripts/core` |
| `references/prompt-templates/music/soul-ballad.json` | music data consumed by `scripts/core` |
| `references/prompt-templates/music/rnb-flow.json` | music data consumed by `scripts/core` |
| `references/prompt-templates/fixtures/suno-sheets/suno-60s-soul-ballad.json` | suno sheet fixture consumed by `scripts/core` |
| `references/prompt-templates/fixtures/suno-sheets/suno-90s-rnb-flow.json` | suno sheet fixture consumed by `scripts/core` |
| `references/prompt-templates/fixtures/suno-sheets/suno-120s-soul-rise.json` | suno sheet fixture consumed by `scripts/core` |
| `references/prompt-templates/fixtures/suno-sheets/suno-180s-soul-ballad.json` | suno sheet fixture consumed by `scripts/core` |
| `references/prompt-templates/fixtures/suno-sheets/suno-300s-rnb-flow.json` | suno sheet fixture consumed by `scripts/core` |
| `references/prompt-templates/fixtures/suno-sheets/suno-600s-soul-rise.json` | suno sheet fixture consumed by `scripts/core` |
| `references/choice-card-spec.md` | spec data for the choice-card/overlap modules |
| `references/stage-runbook.md` | stage runbook data for the shipped stage flow |

The twin's copies of all twelve were measured byte-identical to the PREVIOUS
canonical (`68f686350…`), so they were stale sync copies, not 999-owned
wrappers; syncing them is the contract-faithful repair.

## Skill 68 helper re-pin (before / after)

Re-vendored from the same pinned canonical revision and re-pinned with the
existing tool (`installer-registration/helper-deps.py repin`):

| Helper | version | treeSha256 | files | bytes |
|---|---|---|---|---|
| 68-kie-audio (before) | v2.3.1 | `1e1ff5aa00f98867ae2c9166c9e2ab33e3c9e99bc6f9c9983900f1b98da76a79` | 21 | 244041 |
| 68-kie-audio (after) | **v2.3.2** | `254fe9a4f9b8820b05f50329b36bc84b0892cac3b7f27f7db3a79c3d338f5272` | 21 | 248956 |

The round-3 delta in the helper is exactly six files (`CHANGELOG.md`, `SKILL.md`,
`models.json`, `references/music.md`, `scripts/validate_audio_request.py`,
`skill-version.txt`); the other fifteen are unchanged, and the pre-existing
vendored tree was byte-identical to canonical `68f686350…` before the re-vendor.

Every other helper is byte-identical to its existing pin and was retained
unchanged (re-pin reproduced them cell for cell):

| Helper | version | treeSha256 | files | bytes |
|---|---|---|---|---|
| 66-kie-image | v2.2.2 | `f22b99ce18322705434b324019d9275fc9ea3c3f7801d06ddc60c490abbfd348` | 21 | 341395 |
| 67-kie-video | v2.1.3 | `e0b23290b3858ab4506a16105f1551c4b2a0b8afdc3b1e3943aba012cf4e309d` | 21 | 323265 |
| 74-kie-live-adapter | v1.1.8 | `2befc6929a071fcaf1408b5cf71e12664c6211c8a0a34c526d08d10bf7c8dc40` | 35 | 771359 |
| 46-kie-callback-relay | v2.1.0 | `249badb74629aca0c11da58348f8357fe3a47637431bc39780071f73db1c9ee5` | 12 | 169310 |
| 07-kie-setup | v7.2.1 | `6673e129653c48ff74ce4566f27c7488b2a62c7cd508b3452371a54f0d6757d2` | 16 | 374144 |
| shared-utils | sha256:db74be3114ae | `db74be3114ae589a69e28f565f864436766df8032e0aa0fa2e53980f928d208c` | 4 | 67865 |

`installer-registration/check-helper-pins.py --onboarding <onboarding clone>
--ref origin/main` exits **0** on this head (it exited **1** on 999 main, naming
the stale `68-kie-audio` pin `v2.3.1` vs `v2.3.2`).

## Canonical core tests that needed a distribution-side fix (reported, not hidden)

Two files ADDED by round 3 assert on things that are NOT `scripts/core/` bytes,
and both were RED on the first synced tree. They are green on this head:

1. **`scripts/core/test_music_createtask_ww30.py` (`WW30-4a` / `WW30-4b`)** runs
   skill 68's pre-dispatch validator at
   `<scripts/core>/../../../68-kie-audio/scripts/validate_audio_request.py` —
   the INSTALLED skills-root layout, which exists in the onboarding checkout
   (skills at the repo root) but not in a bare 999 checkout. `SKILL_75` is
   defined by the test and never used; only the `68-kie-audio` path is read.
   Distribution-side fix: this repository now carries
   `.claude/skills/68-kie-audio` as a symlink to
   `../../installer-registration/helpers/68-kie-audio` — the same alias the repo
   already keeps at its root, pointing at the pinned, re-vendored helper. No
   `scripts/core/` byte was touched.
2. **`scripts/core/music_qc/test_wwfix_u1.py` (`WW29-U1`)** asserts the
   reconciled music direction is stated in `SKILL.md`, `INSTRUCTIONS.md` and
   `references/stage-runbook.md`. The third is canonical and was synced
   byte-for-byte; the first two are 999-owned wrapper documents, so the round-3
   document hunks the synced core implements were applied to them:
   recipe rule 2 now says the wordless vocalise is OPTIONAL and never a forced
   lead-in (the retired "after a wordless sung vocalise" wording is gone);
   `suno_recipe.style_text` / `music_block` / `model_block` replaces the retired
   `prompt_templates.suno_parts` wording; a "Story-first audio acceptance"
   section carries the WW-29 reconciled direction and the WW-21 FIVE-gate
   delivered-audio boundary; `negative_tags` transmission and `STYLE_TOO_LONG`
   are stated. `CHANGELOG.md` and `PREREQS.json` were NOT synced — they stay the
   999-owned documents they were.

Without these two fixes the synced head would have a `drama-song-tests` job that
is red on the head and green on main. With them, the whole CI step — every
`scripts/core/test_*.py` under a fresh empty HOME, `pytest scripts/`, `pytest
tests/`, the layout parity test and the W4 proof run — is green.

## Version

`VERSION` read live as `2.7.44`; the next patch `2.7.45` is written to `VERSION`
and to the `SKILL.md` frontmatter `version:`, with one `CHANGELOG.md` entry
(`## [2.7.45]`), all inside the one real-content commit. No bump-only commit
exists.

The 999-setup root version markers were checked and deliberately NOT bumped:
there is no root `VERSION` file, `CONTROL/bundled-components.json` carries no
`drama-song-ad-factory` entry, `README.md` states no per-skill version for it,
and `scripts/check-docs-fresh.sh` iterates only the eight named bundled skills
(`spec-protocol`, `nine-router-setup`, `kaizen`, `eli5`, `bro`,
`blackceo-signature-page`, `hook-skill`, `kiss`). U18 set the same precedent.

## Prover

`tests/twin_sync_prove.py` — stdlib only, no framework, no network. It compares
`scripts/core/` on both sides over the same scope with the same exclusions and
prints `PARITY: PROVEN` / `PARITY: BROKEN`; `--selftest` plants a one-byte change
and an extra file and proves the check catches both.

```bash
# before the sync (999 main vs canonical): BROKEN, exit 1
python3 tests/twin_sync_prove.py --canonical <canonical core>
# after the sync (branch vs canonical): PROVEN, exit 0
python3 tests/twin_sync_prove.py --canonical <canonical core>
# discrimination: PASS, exit 0
python3 tests/twin_sync_prove.py --selftest --canonical <canonical core>
```

With no canonical tree on the machine (a clean install), it prints
`PARITY UNDETERMINED` and exits 0 — undetermined is recorded as such, not as a
pass, matching `tests/test_parity_layout.py`.

---

## Re-sync after the client-folder fixes (unit DSF-521, Drama Fixes Oct 13)

Unit `DSF-521`. This section, the regenerated `scripts/core/`, the copied
`.claude/skills/drama-studio/approvals_bridge.py` and the refreshed blocks of
`references/twin-sync-fingerprints.json` are this unit's whole change.

### The defect (why the re-sync was needed)

Batch DSF-5 (999 PR #213) synced skill 75 from a canonical **cut taken before** the
six client-folder fixes landed on onboarding main (batch #1969). So 999's packaged
core fell behind the real canonical, and `tests/test_studio_bridge_twin.py` was red
on `approvals_bridge.py` while `tests/twin_sync_prove.py` reported a broken twin.

Reproduced first-hand on this branch, before any edit, against onboarding
`origin/main`'s core:

```
$ DSAF_CANONICAL_CORE=<onboarding origin/main>/75-drama-song-ad-factory/scripts/core \
    python3 .claude/skills/drama-song-ad-factory/tests/twin_sync_prove.py
  DIFFER          delivery_package/contract.py ...
  only-canonical  delivery_package/test_contract_not_clean.py ...
  only-canonical  delivery_variants/test_video_delivery_cleanup.py ...
  DIFFER          delivery_variants/video_delivery.py ...
  DIFFER          lip_sync/lip_gate/lip_process.py ...
  DIFFER          lip_sync/lip_gate/test_lip_process.py ...
  DIFFER          ready_post_kit/__init__.py ...
  DIFFER          ready_post_kit/ready_post_kit.py ...
  DIFFER          ready_post_kit/test_ready_post_kit.py ...
  summary: same=486 differ=7 only-canonical=2 only-packaged=0
[parity] PARITY: BROKEN                                     (exit 1)
```

and `.claude/skills/drama-studio/approvals_bridge.py` at `f2a61598dff3b2ec013ff6977e55c3a2acf6cdd9ae3f1c5778944c88d0a90e1a`
against canonical `1061783b7dc9685802e527d0c7995204aa4a8af9fb32dfba6b88ff450d227bc3`
(CF-6 changed the canonical bridge after DSF-5 synced).

### What was compared — the exact SHA this unit synced from

| Side | Repository | Tree | Commit |
|---|---|---|---|
| Canonical (source of truth) | `trevorotts1/openclaw-onboarding` | `75-drama-song-ad-factory/` | **`37344f5cd23fc51bf2a2603ebc8c7090b9b649f0`** (`origin/main`, `Merge pull request #1971`) |
| Packaged copy (this repo) | `trevorotts1/999-setup` | `.claude/skills/drama-song-ad-factory/` + `.claude/skills/drama-studio/` | `7ec07b782145d99529ca7be49ae8352980a0c058` (`origin/main`, PR #213 / batch DSF-5), packaged on branch `unit/DSF-521` |

The SHA above is `git -C ~/openclaw-onboarding rev-parse origin/main`, read live at
build time. It is **one merge past** the `56a22f226` (batch #1969) the batch plan
names; the extra merge (#1971, a docs-only change) does not touch skill 75, proven
before use:

```
$ git -C ~/openclaw-onboarding diff --stat 56a22f226 origin/main -- 75-drama-song-ad-factory/
(no output, exit 0)
```

`~/openclaw-onboarding` was neither branched, checked out nor written: the source
tree was exported read-only with
`git -C ~/openclaw-onboarding archive 37344f5cd -- 75-drama-song-ad-factory | tar -x`
into this unit's own lane folder.

### What was done

```
$ python3 installer-registration/package_core.py --source <lane>/onb-export/75-drama-song-ad-factory/scripts/core
package_core: OK  495 files (9 written, 0 stale removed) source=... dest=.claude/skills/drama-song-ad-factory/scripts/core
  tree sha256 packaged=92cf1c3e967bee5f8a9b942efca012a89babcfda0149f96ac0fbaa789d58eb27 canonical=92cf1c3e967bee5f8a9b942efca012a89babcfda0149f96ac0fbaa789d58eb27
  packaged tree only — no Claude config root was read or written
$ python3 installer-registration/package_core.py --source <...> --check
package_core --check: OK  495 files match canonical     (exit 0)
```

9 written = the 7 changed paths + the 2 paths that did not exist on 999; 0 stale
removed, so nothing was deleted.

`cmp` byte-for-byte, `.claude/skills/drama-studio/` against the same canonical
`shared-bridge/`: `studio_bridge.py` exit 0, `studio_claim.py` exit 0,
`approvals_bridge.py` exit 0.

No `VERSION`, `skill-version.txt` or `CHANGELOG.md` edit: the batch carries the bump
for the whole batch (SWARM-PLAN.md section 7).

### Fingerprints refresh

`references/twin-sync-fingerprints.json`, only the blocks this re-sync moved;
`round3_*`, `layout_alias_added`, `pre_sync_999_main_divergence_from_canonical`,
`pre_sync_summary` and the 486 unchanged `files` entries are byte-for-byte as the
previous round left them:

| Block | Change |
|---|---|
| `unit` | `W3-twin-sync-U1` -> `DSF-521` |
| `canonical.base_sha` / `.branch` | `26d49681bc` @ `batch/DSF-3` -> **`37344f5cd23fc51bf2a2603ebc8c7090b9b649f0`** @ `main` |
| `packaged.base_sha` / `.branch` | `75ba61ca59` @ `unit/DSF-W3-twin-sync-U1` -> `7ec07b7821` @ `unit/DSF-521` |
| `summary` | `in_scope_files 493 -> 495`, `match 493 -> 495`, `differ 0`, `only_canonical 0`, `only_packaged 0` |
| `files` | 7 entries re-digested, 2 entries added (`delivery_package/test_contract_not_clean.py`, `delivery_variants/test_video_delivery_cleanup.py`) -> 495 entries |
| `studio_bridge_twin.files` | `approvals_bridge.py` **added**; `studio_bridge.py` (`b8d3706cc…`) and `studio_claim.py` (`b2d836711…`) **left exactly as they were** |
| `studio_bridge_twin.canonical.base_sha` | `73fa96563d` -> `37344f5cd23fc51bf2a2603ebc8c7090b9b649f0` |
| `pre_sync_DSF521_999_main_divergence_from_canonical` | new: the 7 changed + 2 added core paths and `approvals_bridge.py`, each with its pre-sync packaged digest and its canonical digest |
| `pre_sync_DSF521_summary` | new: `in_scope_files 495, match 486, differ 7, only_canonical 2, only_packaged 0` |

The 9 pre-sync packaged digests recorded in the JSON were re-derived from git, not
from the transcript: `git show HEAD:<path> | shasum -a 256` on all 7 changed files and
`approvals_bridge.py` matched the recorded value every time, and `git cat-file -e
HEAD:<path>` returned 128 (absent) for both added files. `studio_bridge.py` /
`studio_claim.py` were read live on both sides before being left alone, and both
still hash to the pins already recorded.

### Proof (1) — twin parity, PARITY: PROVEN

```
$ DSAF_CANONICAL_CORE=<onboarding origin/main>/75-drama-song-ad-factory/scripts/core \
    python3 .claude/skills/drama-song-ad-factory/tests/twin_sync_prove.py
[parity] scope=scripts/core/ (excl __pycache__/*.pyc) on both sides
[parity] canonical=<lane>/onb-export/75-drama-song-ad-factory/scripts/core
[parity] packaged =/Users/blackceomacmini/dsf-wt/DSF-521/.claude/skills/drama-song-ad-factory/scripts/core
  summary: same=495 differ=0 only-canonical=0 only-packaged=0
[parity] PARITY: PROVEN (byte-identical over same scope)     (exit 0)
```

`same=486 -> 495, differ=7 -> 0, only-canonical=2 -> 0`.

### Proof (2) — studio-bridge twin, `bytes == live canonical` ×3

The test lives at `.claude/skills/drama-song-ad-factory/tests/test_studio_bridge_twin.py`
(there is no `drama-studio/prove/test_studio_bridge_twin.py`), and it is run **from its
permanent path in the worktree**, not from `/tmp`, where its build-tree default
resolution would collapse and it would print `VACUOUS PLANT`:

```
$ DSAF_CANONICAL_SHARED_BRIDGE=<onboarding origin/main>/75-drama-song-ad-factory/shared-bridge \
    python3 .claude/skills/drama-song-ad-factory/tests/test_studio_bridge_twin.py
ok: approvals_bridge.py packaged sha256 1061783b7dc9685802e527d0c7995204aa4a8af9fb32dfba6b88ff450d227bc3 == recorded canonical
ok: approvals_bridge.py bytes == live canonical 1061783b7dc9685802e527d0c7995204aa4a8af9fb32dfba6b88ff450d227bc3
ok: studio_bridge.py packaged sha256 b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956 == recorded canonical
ok: studio_bridge.py bytes == live canonical b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956
ok: studio_claim.py packaged sha256 b2d8367116552b906f7d1c14ee1f4d884b6a03b1434a44517686cb237bccbb42 == recorded canonical
ok: studio_claim.py bytes == live canonical b2d8367116552b906f7d1c14ee1f4d884b6a03b1434a44517686cb237bccbb42
                                                                   (exit 0)
```

Three negative controls, same binary, same tree, to prove that green is a real
result and not a vacuous one:

| Control | Result |
|---|---|
| canonical tree present, `approvals_bridge.py` given one planted comment line | `1 FAILED: approvals_bridge.py: recorded canonical 1061783b7… != live canonical 2dae7333c…` (exit 1) |
| `$DSAF_CANONICAL_SHARED_BRIDGE` set to a missing directory | `FAIL: … is set but the canonical shared-bridge tree is missing` (exit 1) |
| env unset (clean install) | 3 × `UNDETERMINED: … live byte compare skipped`, `SUMMARY: 0 live compares …` (exit 0) |

### Proof (3) — `cmp` against the onboarding originals

```
cmp .claude/skills/drama-studio/studio_bridge.py    <canonical>/shared-bridge/studio_bridge.py    -> exit 0
cmp .claude/skills/drama-studio/studio_claim.py     <canonical>/shared-bridge/studio_claim.py     -> exit 0
cmp .claude/skills/drama-studio/approvals_bridge.py <canonical>/shared-bridge/approvals_bridge.py -> exit 0
```

### Regression (this branch)

| Command | Result |
|---|---|
| `HOME=$(mktemp -d) python3 -m pytest -q .claude/skills/drama-song-ad-factory/scripts .claude/skills/drama-song-ad-factory/tests`, same command on a clean detached `origin/main` `7ec07b782` worktree (baseline) | baseline `1913 passed, 3 skipped, 1 warning, 58 subtests passed in 185.36s` (`checks: 404 ok, 0 failed`), exit 0 |
| same command on this branch | `1930 passed, 3 skipped, 1 warning, 58 subtests passed in 147.28s` (`checks: 404 ok, 0 failed`), exit 0 |

+17 net new tests, accounted for exactly by a collected-test-id diff between the two
runs: **+18** test functions the re-synced core carries that `main` did not (9 in the
new `delivery_package/test_contract_not_clean.py`, 4 in the new
`delivery_variants/test_video_delivery_cleanup.py`, 1 in
`lip_sync/lip_gate/test_lip_process.py`, 4 in `ready_post_kit/test_ready_post_kit.py`)
and **-1** (`ready_post_kit/test_ready_post_kit.py::Build::test_numbered_kit_files_land_in_the_delivery_folder`,
superseded by those same client-folder fixes). 1913 + 18 - 1 = 1930. **Zero new
failures**, same `checks: 404 ok, 0 failed`.

| Command | Result |
|---|---|
| `for p in .claude/skills/drama-studio/prove/*.py; do python3 "$p"; done` | all nine exit 0 — `prove_heartbeat.py`, `prove_option2_monitor.py`, `prove_option3_runner.py`, `prove_plugin_behaviour.py`, `prove_user_agent.py`, `test_check_option.py`, `test_link.py`, `test_option3_wired.py`, `test_upload.py` |

`prove_plugin_behaviour.py` printed no `VACUOUS PLANT` line, so its planted-bad
controls were really exercised.

### Reported, not fixed — `wake_agent.sh` has no 999 counterpart

Onboarding's `75-drama-song-ad-factory/shared-bridge/wake_agent.sh` (48 lines) has
**no counterpart in 999** — `find . -name 'wake_agent*'` in this repo is empty and
`grep -rn wake_agent .` finds nothing outside this receipt.

Does the 999 copy of the skill need it? **No, not as the skill is wired today**, and
the reason is the caller, not the script:

- `wake_agent.sh` does exactly one thing — it shells out to `openclaw agent --message`
  to start an OpenClaw agent turn.
- Its only in-repo caller is onboarding's `75-drama-song-ad-factory/timer-artifacts/run-timer.sh`
  (line 156: `WAKE="$SKILL_ROOT/shared-bridge/wake_agent.sh"`), plus prose in onboarding's
  `INSTRUCTIONS.md` and `timer-artifacts/README.md`.
- 999 ships **no `timer-artifacts/` tree and no `run-timer.sh`** (`timer-artifacts/` is
  named as an out-of-scope, onboarding-owned tree in the sync scope above), and nothing
  in the 999 skill calls `openclaw agent`.
- The 999 unattended path is different and already shipped and proven: the Claude Code
  side starts runs through `.claude/skills/drama-studio/option3_runner.py` (launchd
  `check` entry, per-client approval + lock + budget cap, proved by
  `prove_option3_runner.py`) and announces through the SessionStart hook
  `studio_check.py --hook` wired in `.claude/skills/drama-studio/hooks/hooks.json`
  (proved by `prove_plugin_behaviour.py`).

Carrying `wake_agent.sh` into 999 would add a script no 999 code path invokes, whose
whole job is to launch an OpenClaw turn. Not copied; conductor decides.

---

## R2-A twin re-sync — 2026-10-13 (batch/DSF-9, unit DSR-202)

Unit `DSR-202` is the N batch workflow (SWARM-PLAN.md section 7, repo
`trevorotts1/999-setup`, head `batch/DSF-9`). It carries member PR #216
(`DSR-106`, drama-studio pair fix, merged with `--no-ff` first) and this
re-sync of release group R2-A. One version bump (`2.7.52` -> `2.7.53`), one
CHANGELOG entry, one content commit.

### What was compared

| Side | Repository | Tree | Commit |
|---|---|---|---|
| Canonical (source of truth) | `trevorotts1/openclaw-onboarding` | `75-drama-song-ad-factory/scripts/core/` and `75-drama-song-ad-factory/shared-bridge/` | `cdef72c46944ecf2718b28df2f67219cdaa263fc` (branch `batch/DSF-8`, head of PR #2010, still OPEN when this sync ran) |
| Packaged copy (this repo) | `trevorotts1/999-setup` | `.claude/skills/drama-song-ad-factory/scripts/core/` and `.claude/skills/drama-studio/` | batch head `3ef04627619405c51f86061e1ff8011ae087aad1` (`batch/DSF-9`, the `--no-ff` merge of #216) |

Same rule as the W3 sync above: **the source is a PENDING batch head, not `main`** —
building never waits for a merge (Trevor's order 2026-10-13 15:36). The source SHA was
read live (`git -C ~/openclaw-onboarding rev-parse origin/batch/DSF-8`) after a
40-minute backoff poll for the branch to exist. Both checkouts are read-only for this
unit: the source was exported with
`git -C ~/openclaw-onboarding archive cdef72c46 -- 75-drama-song-ad-factory/scripts/core 75-drama-song-ad-factory/shared-bridge | tar -x`
into this unit's lane
(`run/lanes/DSR-202-lane/o-batch/`); `~/openclaw-onboarding` was never branched,
checked out or written.

**Conductor action after PR #2010 merges:** re-run
`DSAF_CANONICAL_CORE=<new origin/main core> python3 tests/twin_sync_prove.py`. If
onboarding's `main` tree for skill 75 differs from `cdef72c46`, re-run
`installer-registration/package_core.py` against that tree before the batch ships.

### What the re-sync found — and did not change

R2-A (DSR-101..DSR-104: enrollment at install, the client link hand-over, `--register`
timer installation, the pickup handoff) changed `install.sh`, `update-skills.sh`,
`INSTALL.md`, `INSTRUCTIONS.md`, `SKILL.md`, `timer-artifacts/**` and
`shared-bridge/**` — **every one of them outside `scripts/core/`.** So the packaged
core was already byte-identical to the new canonical cut: the repo's own packager
reported `0 written, 0 stale removed` and `--check: OK 495 files match canonical`,
tree sha256 `92cf1c3e967bee5f8a9b942efca012a89babcfda0149f96ac0fbaa789d58eb27` on both
sides. The `files` block, `summary` and `canonical`/`packaged` source metadata were
still re-pinned to `cdef72c46` / `batch/DSF-9`, and the `pre_sync_DSR202_*` blocks were
added (all-match: 495 in scope, 495 match, 0 differ, 0 only-canonical, 0 only-packaged).

The one byte that moved in this repo:

| Packaged path | old sha256 | new sha256 (= canonical on `batch/DSF-8`) |
|---|---|---|
| `.claude/skills/drama-studio/studio_bridge.py` | `b8d3706cc49de4ba4b07515d82dcdfc8fae5e282da70366bf3b97dc1a5cb4956` | `4ea9f8f306d355e8b234deabe408a3bdf6419f0148215c5fb9f9cfc393b4baa5` |

`approvals_bridge.py` (`1061783b7dc9685802e527d0c7995204aa4a8af9fb32dfba6b88ff450d227bc3`)
and `studio_claim.py` (`b2d8367116552b906f7d1c14ee1f4d884b6a03b1434a44517686cb237bccbb42`)
were byte-identical already and their recorded digests are untouched.

### `enroll-on-install.sh` — checked, deliberately NOT copied

Onboarding's `shared-bridge/` on `batch/DSF-8` holds `approvals_bridge.py`,
`enroll-on-install.sh`, `README.md`, `studio_bridge.py`, `studio_claim.py`,
`wake_agent.sh` and `checks/{run_checks,test_approvals_bridge,test_enroll_on_install,
test_poll,test_studio_handoff,test_upload}.py`. **None of the new shell material was
copied**, following the two rules this repo already applies to `shared-bridge`:

1. The packager's scope is `scripts/core/` only (`package_core.py`'s own header and
   `--check`), so nothing outside it is regenerated by a re-sync.
2. The only `shared-bridge` bytes 999 ships are the three Python modules the runtime
   actually imports, held in `.claude/skills/drama-studio/` behind the
   `drama-song-ad-factory/shared-bridge -> ../drama-studio` layout alias and recorded in
   `studio_bridge_twin`. That is exactly the set `wake_agent.sh` was excluded by in the
   DSF-521 sync ("Not copied; conductor decides"), and the reason is the caller:
   `enroll-on-install.sh`'s callers are onboarding's `install.sh` and `update-skills.sh`
   (DSR-101, +69 lines each), which 999 does not ship; `grep -rIl` over this repo for
   `enroll-on-install`, `wake_agent` and `timer-artifacts` returns nothing outside this
   receipt. `checks/test_enroll_on_install.py` and `checks/test_studio_handoff.py` live
   under `shared-bridge/checks/`, a tree 999 has no counterpart for. A copied script
   nothing in this distribution calls would be dead material behind an alias that points
   at the runtime bridge folder.

### Proof (1) — packaged core == canonical core

```
$ DSAF_CANONICAL_CORE=<lane>/o-batch/75-drama-song-ad-factory/scripts/core \
  python3 -I .claude/skills/drama-song-ad-factory/tests/twin_sync_prove.py
[parity] scope=scripts/core/ (excl __pycache__/*.pyc) on both sides
[parity] canonical=<lane>/o-batch/75-drama-song-ad-factory/scripts/core
[parity] packaged =<worktree>/.claude/skills/drama-song-ad-factory/scripts/core
  summary: same=495 differ=0 only-canonical=0 only-packaged=0
[parity] PARITY: PROVEN (byte-identical over same scope)
                                                                   (exit 0)
```

The prover's own discriminates control also passes:
`--selftest` -> `SELFTEST: PASS` (identical copy proven, one-byte change caught,
extra-file change caught), exit 0.

### Proof (2) — `test_studio_bridge_twin.py`, both modes, from a permanent path

Run from the batch worktree `dsf-wt/batch-N-9` (never `/tmp`, where the
prover fails closed with `VACUOUS PLANT`):

```
$ DSAF_CANONICAL_SHARED_BRIDGE=<lane>/o-batch/75-drama-song-ad-factory/shared-bridge \
  python3 -I .claude/skills/drama-song-ad-factory/tests/test_studio_bridge_twin.py
ok: approvals_bridge.py packaged sha256 1061783b… == recorded canonical
ok: approvals_bridge.py bytes == live canonical 1061783b…
ok: studio_bridge.py packaged sha256 4ea9f8f3… == recorded canonical
ok: studio_bridge.py bytes == live canonical 4ea9f8f3…
ok: studio_claim.py packaged sha256 b2d83671… == recorded canonical
ok: studio_claim.py bytes == live canonical b2d83671…
                                                                   (exit 0)

$ python3 -I .claude/skills/drama-song-ad-factory/tests/test_studio_bridge_twin.py
ok: … (recorded sha enforced) × 3
UNDETERMINED: … live byte compare skipped, canonical shared-bridge absent × 3
SUMMARY: 0 live compares (canonical absent) - recorded twin fingerprints enforced,
         live byte compare UNDETERMINED
                                                                   (exit 0)
```

### Proof (3) — `cmp` against the onboarding originals

```
cmp .claude/skills/drama-studio/studio_bridge.py    <lane>/…/shared-bridge/studio_bridge.py    -> exit 0
cmp .claude/skills/drama-studio/approvals_bridge.py <lane>/…/shared-bridge/approvals_bridge.py -> exit 0
cmp .claude/skills/drama-studio/studio_claim.py     <lane>/…/shared-bridge/studio_claim.py     -> exit 0
```

### Regression (this branch)

| Command | Result |
|---|---|
| `HOME=$(mktemp -d) python3 -m pytest -q .claude/skills/drama-song-ad-factory/scripts` | `1917 passed, 3 skipped, 1 warning, 58 subtests passed in 131.23s`, `checks: 404 ok, 0 failed`, exit 0 |
| `HOME=$(mktemp -d) python3 -m pytest -q .claude/skills/drama-song-ad-factory/tests` | `13 passed in 1.11s`, exit 0 |
| `for p in .claude/skills/drama-studio/prove/*.py; do python3 "$p"; done` | all ten exit 0: `prove_heartbeat` 6/6, `prove_option2_monitor` 6/6, `prove_option3_runner` 9 checks, `prove_plugin_behaviour` 12/12, `prove_user_agent` 4 checks, `test_check_option`, `test_link`, `test_option3_wired` 3 checks, `test_pair_address` (new, from #216), `test_upload` |
| `bash installer-registration/verify-registration.sh` | `RESULT: 27 passed, 0 failed`, exit 0 |

`prove_heartbeat.py`, `prove_option2_monitor.py` and `prove_plugin_behaviour.py` printed
no `VACUOUS PLANT` line when their full output was captured and grepped, so their
planted-bad controls really ran.

### Version and guards

`VERSION` `2.7.52` -> `2.7.53` and the `SKILL.md` frontmatter `version:`, with one
`CHANGELOG.md` entry (`## [2.7.53]`), all in this one content commit. No other version
marker moves: `check-docs-fresh.sh` pins only the eight named bundled skills
(`spec-protocol`, `nine-router-setup`, `kaizen`, `eli5`, `bro`,
`blackceo-signature-page`, `hook-skill`, `kiss`) and none of them changes here. The
local clone carries 1062 tags that are not on `origin` (origin has 98, latest `v1.37.0`
== spec-protocol `1.37.0`), so `scripts/check-docs-fresh.sh` run in this clone reports
those foreign tags as undocumented — the same failure it reports on a clean
`origin/main` here, and none on the CI checkout; it is an artefact of this clone's tag
set, not of this batch.

`check-docs-language.py` exits 0 (`1 changed doc file(s) vs HEAD^1 — 0 new unexplained
occurrences — PASS`). `qc-assert-no-client-names.sh --repo-root <this worktree>` reports
its hits against pre-existing lines of this repo (old CHANGELOG/SKILL.md text,
`FIX-LEDGER.md`, `evidence/`, `nine-router-setup/SKILL.md`); **no hit falls on a line
this batch adds** — the added lines are the `2.7.53` CHANGELOG entry, the `VERSION`
file, the `SKILL.md` frontmatter `version:` line, the fingerprint metadata and
`drama-studio/studio_bridge.py`. Neither guard was modified.

---

## R2-B twin re-sync — 2026-10-14 (batch/DSF-11, unit DSR-206)

Unit `DSR-206` is the N batch workflow (SWARM-PLAN.md section 7, repo
`trevorotts1/999-setup`, head `batch/DSF-11`). This batch has **no member PR**; its whole
job is the R2-B twin re-sync. One version bump (`2.7.53` -> `2.7.54`), one CHANGELOG
entry, one content commit.

### What was compared

| Side | Repository | Tree | Commit |
|---|---|---|---|
| Canonical (source of truth) | `trevorotts1/openclaw-onboarding` | `75-drama-song-ad-factory/scripts/core/` and `75-drama-song-ad-factory/shared-bridge/` | `82e34384042a3312c17318285c4bd71965204ec7` (**`origin/main`**, read live — also the merge commit of batch PR #2026 on `batch/DSF-10`) |
| Packaged copy (this repo) | `trevorotts1/999-setup` | `.claude/skills/drama-song-ad-factory/scripts/core/` and `.claude/skills/drama-studio/` | `d504e753a9a56584f7013a9bc6c8c1e6bd614aed` (`origin/main`, the commit `batch/DSF-11` was cut from — the packaged side *before* this commit, the same convention the R2-A section above uses for `3ef046276`) |

**The source is `main`, not a pending batch head.** Unlike the two syncs above, nothing is
waited on: release group R2-B (`DSR-105`, the studio page collecting the story brief) has
already landed, and its ancestry was verified live before anything was copied:

```
$ git -C ~/openclaw-onboarding fetch -q origin
$ git -C ~/openclaw-onboarding merge-base --is-ancestor 4d730e5b45e6828ff914709604fc65797ebd93c0 origin/main
   (exit 0 — PR #2003's head is an ancestor of origin/main)
$ git -C ~/openclaw-onboarding log --oneline -3 origin/main
82e343840 Merge pull request #2026 from trevorotts1/batch/DSF-10
5d8af1c44 Merge origin/main into batch/DSF-10; re-cut at v2.9.51 (batch #8 took v2.9.50)
a9808bc4c Merge pull request #2019 from trevorotts1/batch/auto-merge (merge train: #1981 #1996 #2010)
$ git -C ~/openclaw-onboarding log --oneline -1 82e34384042a3312c17318285c4bd71965204ec7
82e343840 Merge pull request #2026 from trevorotts1/batch/DSF-10
```

Both checkouts are read-only for this unit. The source was exported with
`git -C ~/openclaw-onboarding archive 82e34384 -- 75-drama-song-ad-factory/scripts/core 75-drama-song-ad-factory/shared-bridge | tar -x`
into this unit's lane (`run/lanes/DSR-206-lane/src/`); `~/openclaw-onboarding` was never
branched, checked out or written.

### What changed in skill 75 — and what that means here

R2-B (`DSR-105`) changed four things in skill 75:

1. `scripts/core/choice_card/intake_card/intake_card.py` stays the only question source and
   gains five typed **BRIEF** questions, so the card asks **14** instead of 9:
   `BRIEF_IDS = ("offer", "link", "audience", "character", "photos")`, built by
   `QUESTIONS = _brief_questions() + _questions()`.
2. `mini-app/ui/questions.json` regenerated from it; the drift check passes.
3. `mini-app/ui/studio.js` passes the question into `answerBox`, so the textarea shape comes
   from the typed contract rather than from sniffing option wording.
4. `mini-app/service/src/index.js` reads the brief out of the leading replies and stores it
   **beside** the replies, marking `brief_complete` false with `brief_missing` rather than
   refusing an order.

Only (1) lives under `scripts/core/`, the scope `parity-contract.md` names and the packager
mirrors. (2)-(4) are all under `mini-app/`, which this distribution has never shipped:
`find . -name mini-app` in this worktree is empty, `git ls-files | grep mini-app` is empty,
and `grep -rn 'questions.json'` over `.claude/` and the whole repo returns nothing.
`round3_non_core_left_unsynced` already records `mini-app/**` as "onboarding-only tree; no
999 counterpart".

### What this re-sync changed

| Change | Detail |
|---|---|
| Re-package | `python3 -I installer-registration/package_core.py --source <lane>/src/75-drama-song-ad-factory/scripts/core` -> `package_core: OK  496 files (17 written, 0 stale removed)`, then `--check` -> `package_core --check: OK  496 files match canonical`, tree sha256 `f4f4d68f8d075a9ab54faf612e959191f94bd91a7258564efaa5c1867b2983cd` on both sides, exit 0 |
| The 17 written | 16 changed + 1 new: `choice_card/intake_card/test_story_brief_dsr105.py` (the new DSR-105 test). The 16 are the paths listed under "Pre-sync divergence" below, plus nothing else |
| Bridges | `studio_bridge.py`, `approvals_bridge.py` and `studio_claim.py` copied byte-for-byte from the same archive. **All three were already byte-identical, so no byte moved** — `studio_bridge.py` did **not** change in this batch, and its recorded fingerprint is deliberately left where it is |
| Fingerprints | `references/twin-sync-fingerprints.json` refreshed (table below) |
| Version | `VERSION` `2.7.53` -> `2.7.54`, `SKILL.md` frontmatter `version:` alongside it, one `CHANGELOG.md` entry `## [2.7.54]` |

### Fingerprints refresh — exactly what moved

Changed top-level keys (structural diff against `HEAD`, nothing else):

| Key | Before | After |
|---|---|---|
| `unit` | `DSR-202` | `DSR-206` |
| `canonical.base_sha` / `.branch` | `cdef72c46944ecf2718b28df2f67219cdaa263fc` / `batch/DSF-8` | `82e34384042a3312c17318285c4bd71965204ec7` / `origin/main` |
| `packaged.base_sha` / `.branch` | `3ef04627619405c51f86061e1ff8011ae087aad1` / `batch/DSF-9` | `d504e753a9a56584f7013a9bc6c8c1e6bd614aed` / `batch/DSF-11` |
| `summary` | `495 / 495 / 0 / 0 / 0` | `496 / 496 / 0 / 0 / 0` |
| `files` | 495 entries | 496 entries; **17 re-digested**, 478 unchanged |

Added keys (appended, same position the DSF-521 and DSR-202 blocks were appended in):
`pre_sync_DSR206_999_main_divergence_from_canonical` (17 paths) and
`pre_sync_DSR206_summary` (`in_scope=496, match=479, differ=16, only_canonical=1,
only_packaged=0`).

**Not touched, asserted programmatically before the file was written:** `artifact`,
`scope`, `exclusions`, `normalisation`, `algorithm`, `studio_bridge_twin`, `files`-adjacent
`round3_*`, `layout_alias_added`, `pre_sync_999_main_*`, `pre_sync_summary`,
`pre_sync_DSF521_*`, `pre_sync_DSR202_*`. In particular
`studio_bridge_twin` compares **equal** before and after — `studio_bridge.py`'s recorded
pair `4ea9f8f306d355e8b234deabe408a3bdf6419f0148215c5fb9f9cfc393b4baa5` on both sides is
still the live truth, proved in Proof (2) below rather than assumed.

#### Pre-sync divergence (999 `origin/main` core vs canonical `origin/main` core) — 17 paths

| In-scope path | state |
|---|---|
| `choice_card/intake_card/intake_card.py` | differ |
| `choice_card/intake_card/test_ai_models.py` | differ |
| `choice_card/intake_card/test_intake_card_h9.py` | differ |
| `choice_card/intake_card/test_intake_step_i7.py` | differ |
| `choice_card/intake_card/test_intro_message.py` | differ |
| `choice_card/intake_card/test_length_question_flc.py` | differ |
| `choice_card/intake_card/test_one_spend_question.py` | differ |
| `choice_card/intake_card/test_studio_json_u1.py` | differ |
| `choice_card/intake_card/test_style_questions.py` | differ |
| `character_library/test_character_library_i6.py` | differ |
| `character_library/test_saved_character_question.py` | differ |
| `choice_card/video_models/test_video_models.py` | differ |
| `script_approval/test_script_approval.py` | differ |
| `script_approval/test_script_wiring.py` | differ |
| `song_choices/test_song_choices_fu_song.py` | differ |
| `storyboard_director/test_approval_runner.py` | differ |
| `choice_card/intake_card/test_story_brief_dsr105.py` | only-canonical (new) |

Exactly the 17 files the packager reported writing; `only_packaged=0`, so nothing stale
was dropped.

### Proof (1) — packaged core == canonical core

Pasted outputs below are verbatim except that the operator home prefix is written
`~` instead of its absolute spelling: `scripts/qc-assert-no-client-names.sh` carries
the operator machine home path as an always-on token that must never enter a committed file,
and this section's own four path lines were caught by it on the first run. The guard
was not changed; the file was.


```
$ DSAF_CANONICAL_CORE=<lane>/src/75-drama-song-ad-factory/scripts/core \
  python3 -I .claude/skills/drama-song-ad-factory/tests/twin_sync_prove.py
[parity] scope=scripts/core/ (excl __pycache__/*.pyc) on both sides
[parity] canonical=~/Downloads/DRAMA FIXES OCT 13/run/lanes/DSR-206-lane/src/75-drama-song-ad-factory/scripts/core
[parity] packaged =~/dsf-wt/batch-N-11/.claude/skills/drama-song-ad-factory/scripts/core
  summary: same=496 differ=0 only-canonical=0 only-packaged=0
[parity] PARITY: PROVEN (byte-identical over same scope)
                                                                   (exit 0)
```

### Proof (2) — `test_studio_bridge_twin.py`, both modes, from a permanent path

Run from the batch worktree `~/dsf-wt/batch-N-11` (never `/tmp`, where
the prover fails closed with `VACUOUS PLANT`):

```
$ env -u DSAF_CANONICAL_SHARED_BRIDGE python3 -I .claude/skills/drama-song-ad-factory/tests/test_studio_bridge_twin.py
ok: approvals_bridge.py packaged sha256 1061783b7dc9685802e527d0c7995204aa4a8af9fb32dfba6b88ff450d227bc3 == recorded canonical
UNDETERMINED: approvals_bridge.py live byte compare skipped, canonical shared-bridge absent: …/dsf-wt/onboarding/…
ok: studio_bridge.py packaged sha256 4ea9f8f306d355e8b234deabe408a3bdf6419f0148215c5fb9f9cfc393b4baa5 == recorded canonical
UNDETERMINED: studio_bridge.py live byte compare skipped, canonical shared-bridge absent
ok: studio_claim.py packaged sha256 b2d8367116552b906f7d1c14ee1f4d884b6a03b1434a44517686cb237bccbb42 == recorded canonical
UNDETERMINED: studio_claim.py live byte compare skipped, canonical shared-bridge absent
SUMMARY: 0 live compares (canonical absent) - recorded twin fingerprints enforced, live byte compare UNDETERMINED
                                                                   (exit 0)

$ DSAF_CANONICAL_SHARED_BRIDGE=<lane>/src/75-drama-song-ad-factory/shared-bridge \
  python3 -I .claude/skills/drama-song-ad-factory/tests/test_studio_bridge_twin.py
ok: approvals_bridge.py packaged sha256 1061783b… == recorded canonical
ok: approvals_bridge.py bytes == live canonical 1061783b…
ok: studio_bridge.py packaged sha256 4ea9f8f3… == recorded canonical
ok: studio_bridge.py bytes == live canonical 4ea9f8f3…
ok: studio_claim.py packaged sha256 b2d83671… == recorded canonical
ok: studio_claim.py bytes == live canonical b2d83671…
                                                                   (exit 0)
```

### Proof (3) — `cmp` against onboarding's own `origin/main` originals

Each original read straight out of git, not from the lane export:

```
$ git -C ~/openclaw-onboarding show origin/main:75-drama-song-ad-factory/shared-bridge/<f> > /tmp/dsr206-onb-<f>
$ cmp /tmp/dsr206-onb-<f> .claude/skills/drama-studio/<f>
cmp studio_bridge.py      (packaged vs onboarding origin/main) exit=0
cmp approvals_bridge.py   (packaged vs onboarding origin/main) exit=0
cmp studio_claim.py       (packaged vs onboarding origin/main) exit=0
```

**`studio_bridge.py` did not change in this batch** — `cmp` exit 0 and its recorded
fingerprint untouched, both ways.

### Proof (4) — the story brief reached the packaged copy

```
$ grep -n 'BRIEF_IDS = ' .claude/skills/drama-song-ad-factory/scripts/core/choice_card/intake_card/intake_card.py
252:BRIEF_IDS = ("offer", "link", "audience", "character", "photos")
$ python3 -I -c '…print BRIEF_IDS…'
BRIEF_IDS = ['offer', 'link', 'audience', 'character', 'photos']
all five present: True
missing: []
$ python3 -I -c '…import intake_card; print(len(intake_card.QUESTIONS))…'
len(QUESTIONS) = 14
ids = ['offer', 'link', 'audience', 'character', 'photos', 'models', 'length', 'music',
       'look', 'model', 'spend', 'storyboard', 'song', 'script']
```

**Reported plainly, not papered over:** the second check the batch spec asks for —
`mini-app/ui/questions.json` in the packaged tree listing 14 questions — **cannot be run
here, because 999-setup ships no `mini-app/`.** `find ~/dsf-wt/batch-N-11 -name mini-app`
and `find … -name questions.json` are both empty, `grep -rn 'questions.json' …/.claude` is
empty, and the parity contract records `mini-app/**` as onboarding-only with no 999
counterpart. The equivalent is proved on both sides instead: the **packaged**
`intake_card.py` builds 14 questions itself (above), and the **canonical**
`origin/main` `mini-app/ui/questions.json` carries
`{"question_count": …, "questions": [ … 14 entries … ]}` —
`git -C ~/openclaw-onboarding show origin/main:75-drama-song-ad-factory/mini-app/ui/questions.json`
parsed with `python3 -I` prints `questions len 14`. So the brief is present in this repo
where it belongs, and the file the spec names to check it does not exist here at all.

### Regression (this branch)

Run like-with-like: same interpreter, same `HOME` (`/tmp/dsr206-DSR-206-home`), the only
difference being which tree is on disk — a fresh `origin/main` clone in a path that does
**not** contain `Downloads`, and this batch worktree.

| Side | Command | Result |
|---|---|---|
| control, `origin/main` `d504e753a` | `HOME=/tmp/dsr206-DSR-206-home python3 -m pytest -q .claude/skills/drama-song-ad-factory/scripts` | `1917 passed, 3 skipped, 1 warning, 58 subtests passed in 115.14s`, `checks: 404 ok, 0 failed`, exit 0 |
| control, `origin/main` `d504e753a` | same, `.claude/skills/drama-song-ad-factory/tests` | `13 passed in 1.12s`, exit 0 |
| **this branch** | `HOME=/tmp/dsr206-DSR-206-home python3 -m pytest -q .claude/skills/drama-song-ad-factory/scripts` | `1928 passed, 3 skipped, 1 warning, 58 subtests passed in 113.95s`, `checks: 404 ok, 0 failed`, exit 0 |
| **this branch** | same, `.claude/skills/drama-song-ad-factory/tests` | `13 passed in 1.11s`, exit 0 |

**+11 tests, zero new failures** — the 11 test functions the re-synced core carries that
`origin/main` did not, including the new `choice_card/intake_card/test_story_brief_dsr105.py`.

**Instrument correction, recorded rather than buried.** The first control run was done in a
checkout under `~/Downloads` and came back `1 failed, 1916 passed` with
`AssertionError: ['no-operator-path-in-candidates']` from
`scripts/core/catalog_calculator/test_card_render.py`, whose check is literally
`all("Downloads" not in p for p in paths)`. That failure was a property of **where the
control sat**, not of `origin/main` — the target code was never at fault. Re-run from a
path with no `Downloads` component, control and branch are both green (table above).
| `for p in .claude/skills/drama-studio/prove/*.py; do python3 "$p"; done` | all ten exit 0: `prove_heartbeat` 6/6, `prove_option2_monitor` 6/6, `prove_option3_runner` 9 checks, `prove_plugin_behaviour` 12/12, `prove_user_agent` 4 checks, `test_check_option` 4 tests, `test_link` 5 tests, `test_option3_wired` 3 checks, `test_pair_address` 9 tests, `test_upload` 6 tests — `PROVE_ALL_rc=0` |
| `bash installer-registration/verify-registration.sh` | `RESULT: 27 passed, 0 failed`, exit 0 |

No prover printed `VACUOUS PLANT`; their planted-bad controls really ran.

### Version and guards

`VERSION` `2.7.53` -> `2.7.54` and the `SKILL.md` frontmatter `version:`, with one
`CHANGELOG.md` entry (`## [2.7.54]`), all in this one content commit. No other version
marker moves: there is no `scripts/bump-version.sh` in this repo, so the documented
equivalent is `scripts/check-docs-fresh.sh`, which pins only the eight named bundled skills
(`spec-protocol`, `nine-router-setup`, `kaizen`, `eli5`, `bro`, `blackceo-signature-page`,
`hook-skill`, `kiss`) — none of them changes here, and drama-song-ad-factory's `VERSION` is
not among them at all.

`check-docs-fresh.sh` run **in this local clone** exits 1 with 1041 failures, every one of
them a foreign tag (`FAIL: latest tag v27.1.1 != spec-protocol VERSION (1.37.0)` plus 1040
`has no CHANGELOG.md entry`); **none mentions this skill**, and the same 1041 lines are
produced on a clean `origin/main` in this clone. It is an artefact of this clone's tag set
(the same finding the R2-A section records), not of this batch. Judged the way CI judges it
— a checkout from `origin` carrying only `origin`'s tags — the control is clean and the
batch will be re-run there after push:

```
$ git clone https://github.com/trevorotts1/999-setup.git <lane>/ci-checkout && git fetch --tags --unshallow
$ (control, clean origin/main d504e753a) bash scripts/check-docs-fresh.sh
check-docs-fresh: OK                                                          (exit 0)
```

### The two pre-push guards, as CI judges them

Both guards live in `openclaw-onboarding` (`scripts/check-docs-language.py`,
`scripts/qc-assert-no-client-names.sh`), not in this repo, so both are run *against this
worktree* — `--repo-root <worktree>` — from the onboarding copy, exactly as the R2-A
receipt did.

**Guard 1 — docs language, must exit 0:**

```
$ python3 -I ~/openclaw-onboarding/scripts/check-docs-language.py --repo-root <worktree>
check-docs-language: 4 changed doc file(s) vs HEAD^1 — 0 new unexplained occurrences — PASS.
                                                                   (exit 0)
```

**Guard 2 — no client names, `GITHUB_ACTIONS=true`, no roster.** It exits 1 on this repo
and on clean `origin/main` alike: 142 hit lines across 17 files, **the same 142 and the
same 17 on both sides**, and **zero hits on any line this batch adds**.

| | hit lines | hit files |
|---|---|---|
| this batch (`GITHUB_ACTIONS=true`, `env -u OPENCLAW_CLIENT_ROSTER`) | 142 | 17 |
| control, clean `origin/main` `d504e753a`, same mode | 142 | 17 |
| batch-only hit files | — | **none** (`comm -23` empty both ways) |
| hits falling on a line this batch adds | — | **0 of 142** |

The 142 are pre-existing repository content — old `CHANGELOG.md` / `SKILL.md` history,
`FIX-LEDGER.md`, `CONTROL/backup-*`, `evidence/`, `nine-router-setup/SKILL.md` — none of
which this batch touches on a line basis.

**The guard caught this receipt, and the receipt was fixed, not the guard.** The first run
reported 4 hits on lines this section had just added, all of them absolute paths spelled
with the operator home prefix, which the guard carries as an always-on token ("operator
machine path — must never appear in committed files"). Those four lines were rewritten to
use `~`, and the note explaining that was written without spelling the token out; the
re-run is the 142/142 row above. `qc-assert-no-client-names.sh` was not modified.
