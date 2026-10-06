# Claude Code adapter (plain, non-routed)

Plain `claude` must remain non-routed. Only `claude-nine` activates router
routing, and only in its own child-process environment — never globally.
This adapter verifies that law and this skill's discovery in plain Claude
Code. It does not redesign the drama-song-ad-factory methodology.

1. Verify the current Claude Code skill-discovery mechanism in the local
   install.
2. If the normal local skills root is `~/.claude/skills`, install the skill
   there (one install; Claude-Nine shares this root, so it is visible to
   both). Never set a separate `CLAUDE_CONFIG_DIR` and never create a second
   skills root.
3. Confirm plain `claude` is not routed:
   - no router base URL persisted into global Claude settings,
   - no router base URL exported from shell startup files by any step of
     this install,
   - plain `claude` still talks to its ordinary upstream endpoint.
4. Confirm the runtime discovers the skill and can load `references/`,
   `scripts/`, `assets/` and `tests/`.
5. Confirm the shared control entrypoint runs in this environment:

   ```bash
   python3 scripts/core/intake_preflight/factory.py preflight --root <approved-storage-root>
   python3 tests/test_cli_smoke.py
   python3 tests/test_parity_layout.py
   ```

   A missing helper must surface as `tool-unavailable` /
   `module-unavailable` with the exact missing name — install the helper
   rather than bypassing the check.
6. Run one intake -> preflight pass end to end to confirm the envelope,
   exit codes and approved-storage checks behave the same as under
   Claude-Nine. If behavior differs between modes, that is a defect: both
   adapters invoke the same Python control entrypoint.
7. Record compatibility-only changes in the evaluation report. Do not
   overwrite an existing target. Do not add credentials to this skill
   folder. Do not force router activation to "match" the other mode.
