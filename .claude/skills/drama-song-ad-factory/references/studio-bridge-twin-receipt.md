# U19-BRIDGE-U1 studio-bridge twin receipt

Unit `U19-BRIDGE-U1` (order ORCH-BRIDGE-21-18, under Trevor's order "FINISH THIS MAX
SWARM USE THE TERMINAL WINDOW"; U19 canary blocker 2). This file, the fingerprint
block beside it (`twin-sync-fingerprints.json` -> `studio_bridge_twin`), the two
bridged files, the new prover check, the new twin test, and the `VERSION` +
`SKILL.md` + `CHANGELOG.md` bump all land in ONE commit on branch `unit/U19-BRIDGE`
in `trevorotts1/999-setup`.

## The defect (real code defect in merged work)

`.claude/skills/drama-studio/option3_runner.py` was merged with the Option-3
background run. Its scoped command names `<skill root>/studio_bridge.py`:

```python
def bridge_path(root):
    return os.path.join(root, "studio_bridge.py")       # line 134
```

and with `CLAUDE_PLUGIN_ROOT` and `DRAMA_STUDIO_SKILL_ROOT` unset the skill root is
the runner's own folder (lines 84-87, `dirname(abspath(__file__))`). But 999-setup
main carried **no** `studio_bridge.py` under `.claude/skills/drama-studio/`, and the
only copy of the U5 bridge lives in onboarding skill 75's `shared-bridge/`. Every
Option 3 run therefore named a bridge file that did not exist.

Proven live on the pre-fix tree (env unset):

```
resolved root : .../999-setup/.claude/skills/drama-studio
bridge_path   : .../999-setup/.claude/skills/drama-studio/studio_bridge.py
bridge exists : False
claim exists  : False
```

## What was compared / copied

| Side | Repository | Tree | Base commit |
|---|---|---|---|
| Canonical (source of truth) | `trevorotts1/openclaw-onboarding` | `75-drama-song-ad-factory/shared-bridge/` | `1dc33aa720f8138ca21d5e14f60198f3b6466f3b` |
| Packaged copy (this repo) | `trevorotts1/999-setup` | `.claude/skills/drama-studio/` | `1e7db338d37668a3bb7967ba39b59cba37f30e6b` |

Byte-identical copies added (raw bytes, sha256, no normalisation):

| Packaged path | canonical path | sha256 (both sides) |
|---|---|---|
| `.claude/skills/drama-studio/studio_bridge.py` | `75-drama-song-ad-factory/shared-bridge/studio_bridge.py` | `737c6898e2dfdd14c172da82488558fa5cbe1d3c543504613fd5291fc6a903d7` |
| `.claude/skills/drama-studio/studio_claim.py` | `75-drama-song-ad-factory/shared-bridge/studio_claim.py` | `b2d8367116552b906f7d1c14ee1f4d884b6a03b1434a44517686cb237bccbb42` |

`studio_claim.py` is copied because `studio_bridge.py` imports it as a sibling
(`from studio_claim import ClaimLedger, LedgerError, message_id`, after inserting its
own directory on `sys.path`). Without it the bridge cannot import at all. No other
sibling import exists (both modules are otherwise stdlib-only).

Both files are also importable from the new root (verified):
`python3 -c "import studio_bridge, studio_claim"` exits 0 with the env unset.

## Recorded in the twin parity fingerprints

`references/twin-sync-fingerprints.json` gains a top-level `studio_bridge_twin` block
(canonical repo/tree/base_sha, the packaged tree, the two per-file sha256s, and the
`enforced_by` test). It is additive: the existing TWINR3-U1 `scripts/core/` fingerprint
data is untouched.

## CI coverage

`tests/test_studio_bridge_twin.py` (new, stdlib only) enforces the record on every
`drama-song-tests` run (the `pytest "$SKILL/tests"` step):

- ALWAYS: each packaged file's sha256 must equal the recorded canonical sha256 - a
  drifted packaged copy is a red build with no network needed.
- LIVE, when the canonical shared-bridge tree is present: the packaged bytes must also
  be byte-identical to the canonical file, and the recorded canonical sha256 must match
  that live file (a stale pin is caught too). Canonical resolves from
  `DSAF_CANONICAL_SHARED_BRIDGE`, else `<build>/onboarding/75-drama-song-ad-factory/shared-bridge`.
- A set-but-missing canonical path is a resolve FAILURE, never a silent pass. With the
  env unset and the build-tree default absent (a clean install), the live compare is
  recorded UNDETERMINED and only the recorded twin fingerprint is enforced.

Negative controls (run live on this box, box=TrevelynsMini2, copies under
`/tmp/TrevelynsMini2-U19BRIDGE-U1-*`, real trees never touched, temp copies removed):

| # | Injection | Result |
|---|---|---|
| NC1 | append a byte to a copy's `studio_bridge.py` | rc 1 - packaged sha256 != recorded canonical |
| NC2 | `DSAF_CANONICAL_SHARED_BRIDGE=/nonexistent` | rc 1 - resolve failure |
| NC3 | live canonical = onboarding clone at `1dc33aa7` | rc 0 - bytes == live canonical on both files |

## Prover (U16 option3 runner)

`prove/prove_option3_runner.py` gains one check, `bridge_present`, with its own
planted-bad control (the plant renames the bridge in `bridge_path`). The prover goes
from 8 checks to 9, every planted-bad control caught (`rc 0`). Planted-bad control on a
temp skill copy with `studio_bridge.py` removed: the prover goes RED
(`AF-DS-OPT3-PROVE: failed=bridge_present`, rc 2), and GREEN with the file present.

## Onboarding (paired entry decision)

No onboarding change is needed, stated plainly: onboarding is the CANONICAL side of
this copy, so it already holds the bytes. Onboarding's own parity suite
(`tests/distribution-parity-extended/`) enumerates distributions A (`75-drama-song-ad-factory`)
and B (`999-setup/.claude/skills/drama-song-ad-factory`) and records distribution-unique
paths (such as A's `shared-bridge/`) as UNDETERMINED, never a FAIL - it does not require
999 to carry a counterpart, and it does not read `.claude/skills/drama-studio/` at all. So
this unit ships 999-side only and no `unit/U19-BRIDGE` branch is opened on onboarding.

## Version

`VERSION` read live as `2.7.45`; open PR #195 (unit/OB-KIE-2) claims `2.7.46`, so this
unit writes the next patch `2.7.47` to `VERSION` and to the `SKILL.md` frontmatter
`version:`, with one `CHANGELOG.md` entry (`## [2.7.47]`), all inside the one
real-content commit. No bump-only commit exists.

The drama-studio skill carries no `VERSION` file and its `.claude-plugin/plugin.json`
has no version field, so there is nothing to bump there.

The 999-setup root version markers were checked and deliberately NOT bumped: there is no
root `VERSION` file, `CONTROL/bundled-components.json` carries no `drama-song-ad-factory`
entry, `README.md` states no per-skill version for it, and `scripts/check-docs-fresh.sh`
iterates only the eight named bundled skills. U18/TWIN-R3 set the same precedent.
