# Claude Code adapter (plain, non-routed)

Plain `claude` must remain non-routed. Only `claude-nine` activates router
routing, and only in its own child-process environment — never globally.
This adapter verifies that law and this skill's discovery in plain Claude
Code. It does not redesign the drama-song-ad-factory methodology.

1. Verify the current Claude Code skill-discovery mechanism in the local
   install.
2. Install the skill once into the plain `claude` config root
   `~/.claude/skills`. A box has two config roots, not one: plain `claude`
   reads `~/.claude`, while `claude-nine` runs under the environment
   variable `CLAUDE_CONFIG_DIR`, pointed at `~/.claude-nine`, and reads
   `~/.claude-nine/skills`. Plain `claude` never runs with
   `CLAUDE_CONFIG_DIR` — only the `claude-nine` launcher sets it, in its
   own child process. The sync step is `~/.local/bin/sync-nine-skills.sh`,
   which the `claude-nine` launcher runs at start: it symlinks each skill
   present in `~/.claude/skills` but missing in `~/.claude-nine/skills`,
   never overwrites a real directory there (`claude-nine`'s own tuned
   copies win), and prunes dead links. So: install once under
   `~/.claude/skills`, then run the sync so `claude-nine` sees the same
   files through the symlink. Never create and maintain a second edited
   copy of this skill under `~/.claude-nine/skills`.
3. Confirm plain `claude` is not routed:
   - no router base URL persisted into global Claude settings,
   - no router base URL exported from shell startup files by any step of
     this install,
   - no file in this skill writes router/routing environment variables —
     any router variable present in a shell was put there by the
     `claude-nine` launcher in its own child process, never by this skill,
   - plain `claude` still talks to its ordinary upstream endpoint.
4. Confirm the runtime discovers the skill and can load `references/`,
   `scripts/`, `assets/` and `tests/` using the discovery check commands
   below.
5. Confirm the shared control entrypoint runs in this environment.
6. Run one intake -> preflight pass end to end to confirm the envelope,
   exit codes and approved-storage checks behave the same as under
   `claude-nine`. If behavior differs between modes, that is a defect: both
   adapters invoke the same Python control entrypoint.
7. Record compatibility-only changes in the evaluation report. Do not
   overwrite an existing target. Do not add credentials to this skill
   folder. Do not force router activation to "match" the other mode.

## Discovery check commands

Run from any directory after install (plain `claude` root shown; under
`claude-nine` the same files appear at `~/.claude-nine/skills/...` through
the sync symlink, so substitute that path there):

```bash
# 1. the runtime can discover the skill in this config root's skills dir
test -f ~/.claude/skills/drama-song-ad-factory/SKILL.md && echo discovered

# 2. frontmatter the runtime matches on
grep -m1 '^name: drama-song-ad-factory' ~/.claude/skills/drama-song-ad-factory/SKILL.md

# 3. the subfolders the runtime loads are present
for d in references scripts assets tests adapters; do
  test -d ~/.claude/skills/drama-song-ad-factory/$d || echo "missing $d"
done

# 4. this skill never writes a router base URL or routing env into any file
grep -rE 'ANTHROPIC_BASE_URL[[:space:]]*=' ~/.claude/skills/drama-song-ad-factory \
  && echo "FAIL: skill sets router env" \
  || echo "ok: no router env set by the skill"
```

## Shared core — identical to the `claude-nine` launcher

Both adapters invoke the same control entrypoint, resolved from the one
skill root; neither adapter folder carries a core of its own:

```text
scripts/core/intake_preflight/factory.py
```

`adapters/claude-code/` and `adapters/claude-nine/` hold README guidance
only. The launcher contract for this adapter — non-routed environment, one
install in the plain `claude` root bridged to `claude-nine` by the sync
step, and core-path identity with the `claude-nine` launcher — is
enforced by:

```bash
python3 tests/test_launcher_plain_claude.py
```

## Shared control entrypoint

```bash
python3 scripts/core/intake_preflight/factory.py preflight --root <approved-storage-root>
python3 tests/test_cli_smoke.py
python3 tests/test_parity_layout.py
```

A missing helper must surface as `tool-unavailable` /
`module-unavailable` with the exact missing name — install the helper
rather than bypassing the check.

## Stated prerequisite: Skill 74 (`74-kie-live-adapter`)

`scripts/core/kie_dispatch/kie_dispatch.py` is this skill's only media
dispatcher (plan section 5.4). It carries no KIE client of its own: it
resolves `kie_live_adapter.py` and runs Skill 74 as a single subprocess.
**Skill 74 is a stated prerequisite of this skill and is not installed by
this skill folder**, so install it first — otherwise `kie_dispatch` stops
with `adapter-not-found`, and there is deliberately no private KIE fallback
and no second transport.

Install steps (run from the `999-setup` repository root):

```bash
# 1. check the vendored helper against its pinned tree sha256
python3 installer-registration/helper-deps.py preflight

# 2. install it into the plain claude skills root
#    ~/.claude/skills/74-kie-live-adapter (the sync step then links it
#    for claude-nine)
python3 installer-registration/helper-deps.py install

# 3. inside the installed skill folder: offline QC, then wire
cd <config-root>/skills/74-kie-live-adapter
bash qc-74-kie-live-adapter.sh    # no network, no key; must exit 0
bash wire.sh                      # idempotent; second run changes nothing

# 4. mode stays shadow until an operator activates it on purpose
bash scripts/live_smoke.sh        # free calls only; operator account
```

Also required: `python3` on PATH and `KIE_API_KEY` present by name (its
value is never printed). `kie_dispatch` reads the adapter mode with Skill 74
`health` at preflight; in shadow or off it stops before the approval card
and tells the client generation is not switched on for this box. Set
`KIE_LIVE_ADAPTER_PATH` only when the adapter sits outside every location
the dispatcher searches.

## Main window orchestrates only; nothing fails silently

When this skill runs in Claude Code or claude-nine, the MAIN window only
operates and orchestrates. ALL work is done by VISIBLE workflows and agents.
Things that are wrong, broken or not working are NEVER allowed to fail
silently.

- The main session never does hands-on work: no media generation, no file
  edits, no renders, no hand-run pipeline commands. It launches a visible
  workflow (the Workflow tool) or named agents (shown in /workflows), reads
  their verdicts, and reports them. The user chooses the agents and models;
  the skill never names or forces a model of its own.
- A workflow or agent that is wrong, broken or not working is reported by
  name, with its error, in the same message. Never retry quietly, never skip
  the step, never substitute a result.
- Every failed or skipped gate lands in the final receipt as a named
  `failures` entry (the run becomes `outcome: error`). The only fail-soft
  paths are the documented ones (for example a Command Center board that is
  unreachable); those still print a `WARNING <CODE>: ...` line and sit in the
  receipt's `warnings` list. Code: `scripts/core/loud_failure.py`; proof:
  `tests/test_loud_failure.py`.
