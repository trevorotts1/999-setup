# Vendored: skill-department-map.json

Only the department registry is vendored; this 999 package does not ship the
rest of `23-ai-workforce-blueprint`.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source ref: `prep/bfl-onboarding-pr2` (3aa7e07f0) plus the cli.py divergence
  retirement commit fb469241 (the 999 combined re-sync source; not yet on
  `origin/main`)
- Source commit: `69ae6927a616edbb4cf42edb2dd092f10c81a914` (the map is byte-identical to the one at `5c41646b0`)
- Git blob: `c9085e12742af812082f7aec44f5dcc2fdfe182f`
- SHA-256: `59805fec8476714918a89d96ffa4553e976794e5c01a2e0fc8939603810c61e7`
- Entries: 78 (skill numbers 01 through 83; the archived skills are no longer
  shipped, as in the source), including `signature-downsell`,
  `signature-thank-you` and `black-friday-launcher`

Vendored verbatim. Do not edit it here: the Launcher dependency preflight reads
it for registry lines, and a local edit would drift from the canonical
registry. Refresh by re-vendoring from the source commit.

Why the full registry rather than a launcher-scoped subset: a subset would pass
the preflight without being the department registry, and any consumer reading
this path would then see an incomplete inventory. The map is the real artifact;
vendoring it whole keeps the check honest.

The map was re-vendored byte for byte from the source commit above by the 999
combined re-sync, so its `black-friday-launcher` entry matches
`.claude/skills/black-friday-launcher/repo-integration/skill-department-map-entry.json`
(CON-25).

# Vendored: Black Friday Launcher tree

`.claude/skills/black-friday-launcher/` is a copy of onboarding
`83-black-friday-launcher/`, made by the onboarding launch-family sync
(`scripts/sync_launch_family_to_999.py --family launcher`). Every file is a
byte copy, version files included (`skill-version.txt`, `skill.json`,
`registration.json`), including `launcher_core/cli.py`: it is a pinned Skill 49
file (`front_door.py` hashes every `launcher_core/*.py`), so it cannot be a
declared divergence and 999 receives the pin only through the sync. The only
999-only files are:

- `scripts/generate_dist02_manifest.py` and
  `tests/verify_installer_python_deps.sh` exist only in 999.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source commit: `69ae6927a616edbb4cf42edb2dd092f10c81a914` (`prep/bfl-onboarding-pr2` 3aa7e07f0 plus the cli.py
  divergence retirement commit fb469241; not yet on `origin/main`)
- Source version: `0.2.13`
- Source tree (`83-black-friday-launcher/` at that commit): 90 files, digest
  `sha256:55741fc80ec984486d226786eac1d62da984e9eb6d36eb8829616253acdc9d7d`
- This tree: 92 files (the two 999-only files above), digest
  `sha256:cc4c0cf461bcc2eb5455832cd8adcf00ce7dee12a42690215867f683d6968222`

The digest is the generator's: SHA-256 over the newline-terminated, path-sorted
lines `<file sha256>  <relative path>`.

The launcher family's `shared-utils/` trees (`signature_launch`,
`signature_launch_contract`, `client_intake`, `ghl`, `fab_qc.py`,
`fab_artifact.py`) are synced from the same commit by the same combined re-sync
(`shared-utils/ghl`, `fab_qc.py` and `fab_artifact.py` are plain byte copies: the
sync script's launcher family lists only `signature_launch`,
`signature_launch_contract` and `client_intake`).

This commit is an integration head, not merged `main`. The onboarding batch PR
bumps versions and CI mints the Skill 49 pin on `main` after that merge. During
the 999 batch PR, re-copy every family from that merged commit (version and pin
files are minted there, never here), then replace the commit, version and
digests above with the merged ones.
`python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py --onboarding <onboarding checkout>`
then records the same commit and digests in `DIST-02-PACKAGING-MANIFEST.json`,
and `--check` fails whenever a vendored entry's 999 version differs from its
source version.
