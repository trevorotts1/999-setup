# Vendored: skill-department-map.json

Only the department registry is vendored; this 999 package does not ship the
rest of `23-ai-workforce-blueprint`.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source ref: `origin/main`
- Source commit: `c4bf7530f6af9bcd0c3e1b55c7b0ae25761f2b8a`
- Git blob: `ce4d5d105a4cf48f946489e545d17fb9e99960e7`
- SHA-256: `ddee7a81ebb251c16f91bb6672491e68a7a69ddaa0d3ca9c63aa56bf219e2165`
- Entries: 83 (skill 01 through 83, including `signature-downsell`,
  `signature-thank-you` and `black-friday-launcher`)

Vendored verbatim. Do not edit it here: the Launcher dependency preflight reads
it for registry lines, and a local edit would drift from the canonical
registry. Refresh by re-vendoring from the source commit.

Why the full registry rather than a launcher-scoped subset: a subset would pass
the preflight without being the department registry, and any consumer reading
this path would then see an incomplete inventory. The map is the real artifact;
vendoring it whole keeps the check honest.

The three bullets above describe this one file, and only this file. The map was
not refreshed by the Launcher resync below; it still carries the 83 entry text
from the source commit named above, and it still has to be re-vendored from
onboarding (CON-25) by whoever owns that path.

# Vendored: Black Friday Launcher tree

`.claude/skills/black-friday-launcher/` is a copy of onboarding
`83-black-friday-launcher/`, made by the onboarding launch-family sync
(`scripts/sync_launch_family_to_999.py --family launcher`). Every file is a
byte copy, version files included (`skill-version.txt`, `skill.json`,
`registration.json`), except the declared 999 divergences:

- `launcher_core/cli.py` is the onboarding file with the 999 `questions` path
  (`_experience`, `--answers-file`, `--mode`) and the `REPO_ROOT` import kept.
  The plan surface (`def cmd_plan`, `--launch-plan`, `--page-only`) is the
  onboarding code, unchanged.
- `scripts/generate_dist02_manifest.py` and
  `tests/verify_installer_python_deps.sh` exist only in 999.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source commit: `35643344ddbd8dcea31bc4913dfb0378e93ef141` (branch
  `integration/bfl-onboarding-fix-g83`: onboarding integration head
  `2ac7be161eea5e148c31c20c410339fef74f713d` plus the finished launcher fix,
  including the plan/dispatch APPROVAL-HASH fix; not yet on `origin/main`)
- Source version: `0.2.12`
- Source tree (`83-black-friday-launcher/` at that commit): 87 files, digest
  `sha256:502119c3bc3513668a3392cdc10f734e7f6e16279693f38f182a10af70e8338a`
- This tree: 89 files (the two 999-only files above), digest
  `sha256:f2bbf874b53ba309929ccf0060d1d9208658e44f83ace9a0ef5cedd7111a2681`

The digest is the generator's: SHA-256 over the newline-terminated, path-sorted
lines `<file sha256>  <relative path>`.

The launcher family's `shared-utils/` trees (`signature_launch`,
`signature_launch_contract`, `client_intake`, `ghl`, `fab_qc.py`,
`fab_artifact.py`) are synced from the same commit by unit U-sync-999-01b, not
by this tree copy.

This commit is the fix-branch head, not merged `main`. The onboarding batch PR
bumps versions and CI mints the Skill 49 pin on `main` after that merge. During
the 999 batch PR, re-copy the tree from that merged commit (version and pin
files are minted there, never here), then replace the commit, version and
digests above with the merged ones.
`python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py --onboarding <onboarding checkout>`
then records the same commit and digests in `DIST-02-PACKAGING-MANIFEST.json`,
and `--check` fails whenever a vendored entry's 999 version differs from its
source version.
