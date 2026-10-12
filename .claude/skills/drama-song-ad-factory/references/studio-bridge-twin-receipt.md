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

---

## CHECKIN-UA addendum — the bridge now sends the studio's one explicit User-Agent

Unit `CHECKIN-UA` / `CHECKIN-UA-U1` (order ORCH-CHECKIN-22-27, under Trevor's order
"FINISH THIS MAX SWARM USE THE TERMINAL WINDOW"). The record above still describes the
U19-BRIDGE copy that first brought these bytes into 999; this section records the ONE
later change to `studio_bridge.py` and the new hashes. Nothing above is rewritten.

Cloudflare in front of `https://studio.zerohumanworkforce.com` refuses Python's default
User-Agent (`Python-urllib/3.x`) with HTTP 403 and the body `error code: 1010`; an
explicit User-Agent gets 200. Measured read-only on 2026-10-11 (`GET /api/studio/health`,
no key): bare `urllib.request.urlopen` -> `403 error code: 1010`; the same call with an
explicit User-Agent -> `200 {"ok":true,"service":"drama-studio-service","version":"0.1.0"}`.
A 999 install whose bridge sent the default User-Agent could not check in at all.

Both sides of this twin changed in the same unit, one commit per repository, and the
canonical side changed FIRST so the 999 fingerprint could pin it:

| Side | Repository | Tree | Branch head |
|---|---|---|---|
| Canonical (source of truth) | `trevorotts1/openclaw-onboarding` | `75-drama-song-ad-factory/shared-bridge/` | `unit/CHECKIN-UA` `93f84e0e15a5a90328e9112968f2e8eed7e4e15c` |
| Packaged copy (this repo) | `trevorotts1/999-setup` | `.claude/skills/drama-studio/` | `unit/CHECKIN-UA` (this commit) |

Byte-identical after the change (raw bytes, sha256, no normalisation):

| Packaged path | canonical path | sha256 (both sides) |
|---|---|---|
| `.claude/skills/drama-studio/studio_bridge.py` | `75-drama-song-ad-factory/shared-bridge/studio_bridge.py` | `d190f092acfa2c3b400dde2711ef6130917a7ac47d0c4fd9f0076084fa6a6ee4` |
| `.claude/skills/drama-studio/studio_claim.py` | `75-drama-song-ad-factory/shared-bridge/studio_claim.py` | `b2d8367116552b906f7d1c14ee1f4d884b6a03b1434a44517686cb237bccbb42` (unchanged) |

The change is one constant and one header:

```python
STUDIO_USER_AGENT = "drama-studio-client/2.7.48 (+https://studio.zerohumanworkforce.com)"
...
    req.add_header("User-Agent", STUDIO_USER_AGENT)      # in _http, before urlopen
```

`studio.py` and `studio_check.py` live only in 999 and each carry an identical literal
constant at their own request site (an import would couple the pairing command and the
session hook to the bridge's sibling `studio_claim` import; the spec allows the literal
form when one constant is kept equal). `prove/prove_user_agent.py` asserts all three
strings are equal before it drives a request, so the "one constant" holds by proof.

The onboarding side gained check F in `shared-bridge/checks/run_checks.py`, which drives
the real `_http` at a fake studio on `127.0.0.1` and requires both the 200 and the exact
string on the wire, with two controls on the same server: bare urllib refused 403/1010,
and a planted-bad bridge copy with the header line removed refused too. On main the same
run is RED (`FAIL F one explicit User-Agent`, rc 1, checks A-E still pass), so the check
discriminates against exactly this change.

Version: `VERSION` 2.7.47 -> 2.7.48 and the `SKILL.md` frontmatter `version:`, with one
`CHANGELOG.md` entry, all inside this ONE commit. The drama-studio skill still carries no
`VERSION` file and its `.claude-plugin/plugin.json` still has no version field, so nothing
is bumped there. `prove/runtime-hook-hashes.txt` is untouched: it hashes the four
`~/.claude/hooks/*.py` runtime hooks and two settings files, none of which this unit
changes.


## Direct-upload twin — 2026-10-12

Unit `DRAMA-UPLOADS-TWIN`, canonical onboarding merged main `73fa96563dec1eb954f210c6ad383693812cfec5` (batch #1893, skill 75 v2.9.43). The two bridge files are copied as raw bytes and recorded in `studio_bridge_twin`; `studio_claim.py` is unchanged. The upload command sends metadata, then streams a scoped R2 PUT, enforcing the service size limits and returning only the upload ID and object path. Six fake-transport tests run in the Drama Studio workflow. Packaged skill version 2.7.50 and both CHANGELOG entries land in this same content commit.
