# Core Updates — drama-song-ad-factory (Claude-Nine / Claude Code)

What may change in this skill, and what must never change with it.

## The one core that matters: `scripts/core/`

`scripts/core/` is a **packaged copy** of the canonical control layer. The
canonical source path and release mechanism are recorded in
`references/parity-contract.md` and in `ARCHITECTURE-DECISIONS.md` (directive
2.4). Rules:

1. Never hand-edit files under `scripts/core/`.
2. To update: regenerate the copy from the canonical source, then run
   `python3 tests/test_cli_smoke.py` and `python3 tests/test_parity_layout.py`.
3. `test_parity_layout.py` compares bytes with the canonical tree when it is
   present and reports `PARITY UNDETERMINED` when it is not. Undetermined is
   not a pass — run the check where the canonical tree exists before claiming
   parity.
4. Bump `VERSION`, add a `CHANGELOG.md` entry naming exactly what changed, and
   keep the `SKILL.md` frontmatter `version:` equal to `VERSION`.

## When a contract version changes

If the update changes `scripts/core/contracts/campaign-schema.json`,
`artifact-schema.json`, `qc-schema.json`, or
`scripts/core/acceptance-profile.json`:

- record the old/new contract versions and the migration path;
- record rollback notes in the release manifest;
- re-qualify consumers — a contract change is not a cosmetic bump;
- carry the same change into the OpenClaw distribution in the same release
  window. A one-sided core change is a lockstep defect (directive 2.3), not a
  style difference.

## What does NOT change when the core changes

- `adapters/claude-nine/README.md` and `adapters/claude-code/README.md` —
  runtime guidance changes only when runtime wiring itself changes. Both
  adapters keep invoking the same entrypoint; no adapter gains its own copy of
  the control logic, its own provider path or its own model table.
- Creative doctrine in `SKILL.md` (twelve-stage arc, lyrics-as-copy, product
  reveal timing, no lip-sync default) is shared methodology, not an adapter
  concern; a doctrine change is a core-methodology change and belongs in the
  canonical source first.
- Nothing here may write a config-directory override, a router/model base URL,
  or global routing settings (repository rules 9 and 10).

## Registry and docs

- Adding/removing this skill from the install path means editing
  `CONTROL/bundled-skills.txt` only, preserving every pre-existing entry.
  Registry mechanics are owned by the installer-registration lane
  (`installer-registration/`), not by this skill folder.
- `INSTRUCTIONS.md`, `INSTALL.md`, `EXAMPLES.md`, `QC.md`, `PREREQS.json`
  describe the shipped behavior: when behavior changes, update the doc that
  states it in the same commit — a doc that contradicts the CLI is a defect.
- This distribution has no workspace core files (no AGENTS.md/TOOLS.md/MEMORY.md
  wiring) to update; the OpenClaw distribution's core-file updates are a
  separate, onboarding-owned flow.

## Never in a core update

- No secrets, key values or provider tokens in any file of this skill.
- No new third-party dependency: the control layer is standard library only;
  a core update that needs an outside package must fail preflight with an
  actionable `module-unavailable` error instead of silently adding one.
- No weakening of a guard to make a test green: fix the check's subject, not
  the check. A failed guard must never invoke a static-provider fallback to
  evade itself (directive 24.1).
- No self-approval: the author of a change does not write its QC verdict.
