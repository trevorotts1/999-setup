# Claude Code adapter (plain, non-routed)

Plain `claude` must remain non-routed. Only `claude-nine` activates router
routing, and only in its own child-process environment — never globally.
This adapter verifies that law and this skill's discovery in plain Claude
Code. It does not redesign the drama-song-ad-factory methodology.

1. Verify the current Claude Code skill-discovery mechanism in the local
   install.
2. If the normal local skills root is `~/.claude/skills`, install the skill
   there (one install; `claude-nine` shares this root, so it is visible to
   both). Never set a separate `CLAUDE_CONFIG_DIR` and never create a
   second skills root for this skill — plain `claude` and `claude-nine`
   read the one shared root.
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

Run from any directory after install (shared skills root shown; substitute
your skills root if it is elsewhere — it must still be the one root shared
with `claude-nine`):

```bash
# 1. the runtime can discover the skill in the shared skills root
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
skills root, and core-path identity with the `claude-nine` launcher — is
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
