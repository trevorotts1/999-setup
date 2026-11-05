# Vendored: skill-department-map.json

Only the department registry is vendored; this 999 package does not ship the
rest of `23-ai-workforce-blueprint`.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source ref: `origin/main` of onboarding, the merge of pull request 2809
- Source commit: `7c21e86ba848f1c1f953d98451ee538d63057de2` (this map replaces the one from `96866c532`: the
  `black-friday-launcher` entry now carries the plain-English client line the synced
  `repo-integration/skill-department-map-entry.json` carries, and skill 84 is listed)
- Git blob: `e10745e4e0079773aa8d45af9e7980ba3fa4e044`
- SHA-256: `40cb461724f88e76230f27dd830b2a7192b224ab4dbf5b0d02956ac01c632e20`
- Entries: 79 (skill numbers 01 through 84; the archived skills are no longer
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
- Source commit: `c13bcd7a49d1845b83111b9ec50a6764ee5fdfe6` (onboarding `origin/main`, merge of pull request 2811)
- Source version: `0.2.16`
- Source tree (`83-black-friday-launcher/` at that commit): 95 files, digest
  `sha256:5c7c83dec91dfd470f9d97493ece32c426c1eb56375ea8b954fe0ed166369426`
- This tree: 97 files (the two 999-only files above), digest
  `sha256:6c40b98fc75bafb62012a3cf028296d90d51228c5d1817b1fe65bb187f3a855b`

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
files are minted there, never here). That commit bumps Skill 83 to 0.2.16 and Skill 49 to
v2.1.31, and the SF-PROVER pin file here is the one the pin workflow minted on onboarding
(`e93c90d564656a6604cfb5c101929f0b687a2fb564f8cbb4a862041738488933`).
`python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py --onboarding <onboarding checkout>`
then records the same commit and digests in `DIST-02-PACKAGING-MANIFEST.json`,
and `--check` fails whenever a vendored entry's 999 version differs from its
source version.
