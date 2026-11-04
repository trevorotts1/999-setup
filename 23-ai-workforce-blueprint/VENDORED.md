# Vendored: skill-department-map.json

Only the department registry is vendored; this 999 package does not ship the
rest of `23-ai-workforce-blueprint`.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source ref: `origin/main` of onboarding, the merge of pull request 2806 (`prep/bfl-onboarding-pr2`,
  head 975d820ef)
- Source commit: `96866c532b32b68c3675456d860f46e70fcc4bd5` (the map is byte-identical to the one at `d37c35a7f` and `5c41646b0`)
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
- Source commit: `96866c532b32b68c3675456d860f46e70fcc4bd5` (onboarding `origin/main`, merge of pull request 2806)
- Source version: `0.2.13`
- Source tree (`83-black-friday-launcher/` at that commit): 90 files, digest
  `sha256:d6d27b67f185519f754dc66cd882c0cca6a37c844b083ac9e80c0ba9720900ca`
- This tree: 92 files (the two 999-only files above), digest
  `sha256:4f7d46111da3a10a3e72dc1274f0c1244f50203e33abf780cae3b54d08b6c3e9`

The digest is the generator's: SHA-256 over the newline-terminated, path-sorted
lines `<file sha256>  <relative path>`.

The launcher family's `shared-utils/` trees (`signature_launch`,
`signature_launch_contract`, `client_intake`, `ghl`, `fab_qc.py`,
`fab_artifact.py`) are synced from the same commit by the same combined re-sync
(`shared-utils/ghl`, `fab_qc.py` and `fab_artifact.py` are plain byte copies: the
sync script's launcher family lists only `signature_launch`,
`signature_launch_contract` and `client_intake`).

`shared-utils/signature_launch/experience/progress_report.py` is now a byte copy
of the source (no longer divergence D3): the neutral `delivery_report.py` calls its
CON-19 API (`RowsRefused`, `--manifest`, `--emit-rows`), which the older D3 copy
lacked. `render_question.py`, `test_experience.py` and `README.md` under
`experience/` stay D3.

The families were re-copied from the merged onboarding commit above (version and pin
files are minted there, never here), and the commit, version and digests above are the
merged ones.
`python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py --onboarding <onboarding checkout>`
then records the same commit and digests in `DIST-02-PACKAGING-MANIFEST.json`,
and `--check` fails whenever a vendored entry's 999 version differs from its
source version.
