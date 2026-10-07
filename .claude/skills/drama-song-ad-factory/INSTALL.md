# Install / Update Contract — drama-song-ad-factory (Claude-Nine / Claude Code distribution)

## Install model

Repository-native skill in `999-setup`:

```text
.claude/skills/drama-song-ad-factory/
```

Installed by the repository's own bundled-skill mechanism. The skill is listed in
`CONTROL/bundled-skills.txt`; installers link every listed skill from the repository
into the Claude config root's `skills/` directory. Do not invent a second installer
for this skill and do not copy the folder by hand into a second location.

- One skill folder, shared by `claude` and `claude-nine` (directive 2.2, 5.3).
- Never create a separately maintained `claude-nine` skills root, and never point
  either runtime at its own config directory — the variable `CLAUDE_CONFIG_DIR`
  stays untouched by this install (repository rule 10).
- The runtime-specific behavior lives only in `adapters/claude-nine/README.md`
  and `adapters/claude-code/README.md`, never in a duplicate skill tree.

## Prerequisites

`PREREQS.json` is the machine-readable prerequisite list (Python 3 standard
library only, shared config root, registry entry, approved storage root,
authorization receipt, presence-only credentials, helper skills for paid media).
Check it before installing; every entry states how to satisfy it.

Helper provider skills (46, 66, 67, 68, 74) are **not** bundled in this folder
(directive 2.4). A clean install receives the control layer itself; if a required
helper is absent, `preflight` fails with `module-unavailable` / `tool-unavailable`
naming the missing helper — install the helper, never bypass the check and never
fall back to a static provider path. Helper installation is registered separately
(`installer-registration/helper-dependencies.json`).

## Install steps

1. Clone or update `999-setup`.
2. Confirm the skill line `drama-song-ad-factory` is present in
   `CONTROL/bundled-skills.txt` (it is committed there; do not delete other
   entries while editing).
3. Run the repository's normal skill link step for bundled skills, or link this
   folder yourself into the shared config-root `skills/` directory if you manage
   links manually. One link serves both runtimes.
4. Run the smoke tests (below). An install is not complete until they pass
   (directive 5.3).

## Verification (required before first paid work)

```bash
cd .claude/skills/drama-song-ad-factory
python3 tests/test_cli_smoke.py        # envelope + exit-code contract
python3 tests/test_parity_layout.py    # layout, registry, adapter hygiene, core parity
python3 scripts/core/intake_preflight/factory.py intake --brief-file assets/example-brief.json
python3 scripts/core/intake_preflight/factory.py preflight --root <approved-storage-root>
```

Expected: both tests `ALL PASS` (or `PARITY UNDETERMINED` when the canonical
OpenClaw core tree is absent — that is an undetermined check, not a pass),
`intake` on the thin example brief exits 2 / `waiting` with at most three
questions, `preflight` without an authorization file exits 4 /
`approval-missing`. Then confirm discovery in both runtimes: the skill appears
under `claude` and under `claude-nine`, and loads its `references/`,
`scripts/`, `assets/` and `tests/`.

## Update flow

1. Core changed upstream: regenerate `scripts/core/` from the canonical source
   named in `references/parity-contract.md`. Never hand-edit the packaged copy.
2. Re-run both tests above.
3. Bump `VERSION`, add a `CHANGELOG.md` entry naming what changed, and keep the
   `SKILL.md` frontmatter `version:` in sync with `VERSION`.
4. Contract-version bumps (campaign / artifact / qc schemas, acceptance profile)
   need migration and rollback notes in the release manifest — a contract change
   re-qualifies consumers.
5. Adapter files change only when runtime wiring itself changes; after any
   adapter edit, re-verify both modes (each adapter README states its own checks).

## Secrets

Credentials live outside the repository (environment / key files of the host).
This skill stores no keys, prints no key values, and preflight checks credential
presence by name only. Never commit a secret, and never commit `API docs.md` or
any `.env` with real values (repository rules 4 and 5).

## Removal

1. Remove the `drama-song-ad-factory` line from `CONTROL/bundled-skills.txt`.
2. Unlink the skill folder from the config-root `skills/` directory.
3. Nothing else to remove: no second copy, no router/global settings and no
   config-directory override were ever created by this install.
