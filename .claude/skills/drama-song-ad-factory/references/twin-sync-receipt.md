# U18 twin-sync commit receipt

Unit `U18-U1` ("Final core twin sync, same-scope fingerprints, 999/helper
commit receipt"). This file, the fingerprint artifact beside it
(`twin-sync-fingerprints.json`), the regenerated `scripts/core/` and the
`VERSION` + `CHANGELOG.md` bump all land in ONE commit on branch `unit/U18`
in `trevorotts1/999-setup`.

## What was compared

| Side | Repository | Tree | Base commit |
|---|---|---|---|
| Canonical (source of truth) | `trevorotts1/openclaw-onboarding` | `75-drama-song-ad-factory/scripts/core/` | `68f686350e8f8f4f513333c159a4cbb6b9825dd5` |
| Packaged copy (this repo) | `trevorotts1/999-setup` | `.claude/skills/drama-song-ad-factory/scripts/core/` | `9603065d24237fda1d37b27edc381b6027bcc143` |

The onboarding checkout is read-only for this unit and was not mutated: it was
read via `git archive` from the onboarding **main** commit, never from the
working tree (the shared onboarding checkout sits on a stale branch
`unit/FU-U11`, 370 commits behind main, with 8 dirty entries — it is NOT the
canonical content).

## In scope vs deliberately out of scope

**In scope** — `scripts/core/` on both sides. This is derived, not guessed:
`references/parity-contract.md` names `scripts/core/` as the canonical core and
its packaged copy, and `tests/test_parity_layout.py` enforces byte-identity over
exactly that scope. Plan section 5.4 states the same: "Byte parity over same
shared-core scope; wrapper/version differences legitimate."

**Deliberately out of scope** (measured, not assumed):

- `VERSION` / `skill-version.txt` — wrapper version files; the two distributions
  legitimately name their versions differently (2.7.44 here vs `v2.9.2` there).
- `CHANGELOG.md`, `CORE_UPDATES.md`, `SKILL.md`, `INSTRUCTIONS.md`, `INSTALL.md`,
  `PREREQS.json` — per-repo documentation that legitimately differs.
- `adapters/claude-nine/` and `adapters/claude-code/` — the parity contract
  explicitly permits runtime adapter guidance to differ.
- Onboarding-only application/service trees with no 999 counterpart:
  `mini-app/` (49 files), `shared-bridge/` (4), `timer-artifacts/` (7),
  the onboarding-only `tests/` trees (26), `scripts/two_strike*`,
  `scripts/camera_shot_rules/`, `scripts/camera_signatures/`,
  `scripts/openclaw_adapter.py`, `DEPENDENCY-MANIFEST.md`,
  `PACKAGING-DECISION.md`, `THIRD_PARTY_NOTICES.md`.
- 999-only files with no canonical counterpart: `assets/example-brief.json`,
  two adapter READMEs, and the 999 test files (`tests/test_cli_smoke.py`,
  `test_launcher_plain_claude.py`, `test_master_provenance_h12.py`,
  `test_parity_layout.py`, `test_single_config_root.py`).

"Sync frozen reviewed core only" means exactly this: `scripts/core/`, nothing
else from onboarding is dragged in.

## Normalisation

Exclusions `__pycache__/` and `*.pyc`, applied **identically on both sides**
(the same rule `tests/test_parity_layout.py` uses). **No other normalisation**:
raw file bytes are hashed with sha256. No line-ending, whitespace or
generated-marker rewriting, so no real content difference can be hidden.

## Predecessors checked (all merged into onboarding main)

| Predecessor | Proof |
|---|---|
| U5 | `openclaw-onboarding` PR #1820, `unit/U5-U1`, mergeCommit `b9128b988c8cad0926539f4fd3ed4ce363eaa9fb`, ancestor of main ✓ |
| U8 | `openclaw-onboarding` PR #1822, `unit/U8-U1`, mergeCommit `bd5db170aed9af2b245a2ced90a5ae6c0af3dd03`, ancestor of main ✓ |
| U10 (required) | `openclaw-onboarding` PR #1823, `unit/U10-U1`, mergeCommit `fba302c302073d35255ae48de8d4f00e2bcaf6fc`, ancestor of main ✓ |
| U11 | `openclaw-onboarding` PR #1819, `unit/U11-U1`, mergeCommit `d4054f050fcf41f68dc12dd52f64abfe91059e79`, ancestor of main ✓ |

Ancestry checked with `git merge-base --is-ancestor <mergeCommit> 68f686350…`.

## Result

- Pre-sync (999 main vs canonical): **same=460, differ=6, only-canonical=5,
  only-packaged=0 → PARITY BROKEN.**
- Post-sync (branch `unit/U18` vs canonical): **same=471, differ=0,
  only-canonical=0, only-packaged=0 → PARITY PROVEN.**

The 11 paths that changed (each copied byte-for-byte from canonical; the other
460 in-scope paths were already identical and were not touched):

| In-scope path | canonical sha256 | packaged sha256 (pre-sync) |
|---|---|---|
| `character_bible/character_bible.py` | `d4536782f7c110cbb7263e948f1bc91a9e2d275baccd546ed28e44f1005eb632` | `86f867f955104378fe3e836e837b2e89296bcb261fee30105890be963e87f7b8` |
| `character_bible/test_character_bible_del02.py` | `590e7c6e6d585dce041f071277f0d6c335602377f46f8a4fb86c021efa875f97` | `4f521352bedd6385e294e5b2cdd00102e4fb0f8a257d91b1c851279c83686afd` |
| `choice_card/intake_card/README-channel-send.md` | `91ccf03daeb2921cc992ae7db7dd6ea2b9049c09efe41cc26bfb87a12c02887d` | *(absent — added)* |
| `choice_card/intake_card/__init__.py` | `2ae85e57043f897d686c7e3f9b73786190f19ca4e1dc27b58c324b94b394b459` | `ffb65de187f5847e05399997b9f353e526774e30de074cb5ec52c88ea8306a75` |
| `choice_card/intake_card/channel_send.py` | `1a0067bbc2d8f719cc7942db5f0cacd1947da0327ad6e205368ab8e65e6fac88` | *(absent — added)* |
| `choice_card/intake_card/intake_card.py` | `9c2a8b1758b1b13e3392e58c68bd30d62e12df6d2530ee35a8e912c4a77564a3` | `445b60050c84755dbbd48593902142409e7e1a92b159b2acb158709d1794a23f` |
| `choice_card/intake_card/test_channel_send_u11.py` | `bd50c33b6a4f7df1c7de88739798d3f50db44ef9cbf51fbe12bf11515a5cbf48` | *(absent — added)* |
| `choice_card/intake_card/test_studio_json_u1.py` | `f188467ddc9af85081b2b5e72b5fbad3fdc3777cef670afc2458d4ed8ca3553e` | *(absent — added)* |
| `style_bibles/hybrid/__init__.py` | `1f291176e3cd153d5d98d71219439a0b7122f3420ecf7fb7160cee8362666941` | `f686ef2bb0c2f57944a5eb22fb91def0db59b021860b7053de784df86ea99bb5` |
| `style_bibles/hybrid/hybrid_bible.py` | `744a13bf14e37e00847911eb2a2fc34283e48980a2f5fe6cc0cac8d09c6aaca9` | `2ea19300c8244eaea74fa4356b25722edd337a24987fd43b81b83a39fb2ee9f4` |
| `style_bibles/hybrid/test_hybrid_dual_presence.py` | `14c12f5210f42cb9d3427678975db3245a926a93c3ec825c410562ae39f7f30a` | *(absent — added)* |

Post-sync every one of these carries the canonical sha256 on both sides; the
full per-path two-sided table (all 471 in-scope files) is in
`twin-sync-fingerprints.json`.

## Known canonical gap (reported, not hidden)

The divergence is bidirectional. Five of the six differing paths and all five
added paths are cases where the canonical core is AHEAD (U1, U11, dual-presence
landed in onboarding). But two paths — `character_bible/character_bible.py` and
`character_bible/test_character_bible_del02.py` — were cases where **999 was
AHEAD**: 999 main carried the **N99-CB** refuse-before-any-write fix released in
`2.7.43` (999 history `ebb90a4ad`, 2026-10-10), and the canonical onboarding core
does **not** carry it (no trace in onboarding history for any branch).

`references/parity-contract.md` forbids hand-editing the packaged copy and
requires regenerating it from the canonical source. Regenerating therefore
**removes the N99-CB hand-edit from the packages tree**. That is the correct,
contract-faithful result for this unit, but it is a real behaviour change to the
shipped distribution and must not be silent, so it is recorded here, in
`CHANGELOG.md` 2.7.44, and in the pull request body:

- The fix is **not lost** — it is preserved at `ebb90a4ad` in 999 history.
- Its correct home is the canonical onboarding core. A separate onboarding unit
  must port N99-CB upstream; until it does, a clean 999 install from this tree
  will not have the refuse-before-write guarantee.

## Prover

`tests/twin_sync_prove.py` — stdlib only, no framework, no network. It compares
`scripts/core/` on both sides over the same scope with the same exclusions and
prints `PARITY: PROVEN` / `PARITY: BROKEN`; `--selftest` plants a one-byte change
and an extra file and proves the check catches both.

```bash
# before the sync (999 main vs canonical): BROKEN, exit 1
python3 tests/twin_sync_prove.py --canonical <onboarding main core> --packaged <999 main core>
# after the sync (branch vs canonical): PROVEN, exit 0
python3 tests/twin_sync_prove.py --canonical <onboarding main core>
# discrimination: PASS
python3 tests/twin_sync_prove.py --selftest
```

With no canonical tree on the machine (a clean install), it prints
`PARITY UNDETERMINED` and exits 0 — undetermined is recorded as such, not as a
pass, matching `tests/test_parity_layout.py`.
