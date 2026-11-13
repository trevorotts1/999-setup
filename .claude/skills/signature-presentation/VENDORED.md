# Vendored: Presentations department (signature-presentation)

`.claude/skills/signature-presentation/` is a copy of the onboarding Presentations
department, made by `scripts/sync_presentations_to_999.py`. Every file is a
byte copy. Do not edit it here: a local edit is drift, and `--check` fails
on it. Refresh by re-running the sync from the source commit below.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source ref: `pd/fl13-999-version`
- Source commit: `b624f61aa0e35af2dd89bc924108322885af5125`
- Source version (S51 `skill-version.txt`): `v2.1.9`
- Sources copied (byte for byte):
  - `51-signature-presentation/` — the whole S51 tree, at this root
  - `23-ai-workforce-blueprint/templates/role-library/presentations/scripts/` (excluding `tests/`)
  - `23-ai-workforce-blueprint/templates/role-library/presentations/intake/` (excluding `interview-app/`)
  - `23-ai-workforce-blueprint/templates/role-library/presentations/sops/`
  - `23-ai-workforce-blueprint/templates/role-library/presentations/` — the 34 roster role files (read from its own
    `00-START-HERE.md` roster table), `BUILDER-PROMPT.md`, `TOOLS.md`,
    `00-START-HERE.md`, `connection-manifest.json`
  - `universal-sops/presentation-design-system/`, `presentation-image-library/`,
    `presentation-slide-craft/` (the master QC ruleset included)
  - `shared-utils/kie_prompt_enforcer.py`, `prompt_policy.py`, `kie_prompt_gates.json`
- Files vendored: 564
- Tree digest: `sha256:d879c7c184a5eeed359d4103d85efbbf33557174fea56d5eb613587736a08d1a`

The digest is the generator's: SHA-256 over the newline-terminated,
path-sorted lines `<file sha256>  <relative path>`, relative to this root.
`VENDORED.md` itself is not part of it. `--check` re-derives the plan from the
onboarding sources and fails on one changed byte, a missing file, or a source
tree that moved after this snapshot.

One source file is superseded, not copied: `23-ai-workforce-blueprint/templates/role-library/presentations/scripts/blend_voice_governance.py`. Its bytes differ from S51's copy of the same
path, which is kept because S51's is the strict superset: the department copy
is a stale fork stopping at 5056350ad that predates the v22.0.68 F01-F27
enforcement sweep and lacks `prove_against_pin()` and `--prove-pin`. The
vendored `verify.sh` invokes `blend_voice_governance.py --prove-pin`, so the
department bytes would make the sacred-structure pin check fail closed (rc=2,
"unrecognized arguments: --prove-pin"). The S51 bytes satisfy both the
department-first resolution in `scripts/presentation_job/persona.py` and
`verify.sh`. Any other path collision refuses the sync instead of picking a
winner.

Not vendored, because the unit text names neither: the department's
`IDENTITY.md`, `SOUL.md`, `how-to-use-this-department.md`,
`DEPARTMENT-COUNTS-CANONICAL.md`, `DECISION-2026-10-14-KIE-COMPLETION-POLLING.md`,
`retired-doctrine-patterns.json`, `test_retired_roles.py` and the rest of its
root, plus `scripts/tests/` and `intake/interview-app/`.
