# CHECKPOINT — WS-02 Claude Plugin Manifest + Hook Registration

Run: WR-008 (first Candice production fan-out), workstream WS-02
Builder: B-WR-008-WS-02 (opus/max)
Worktree: `worktrees/wr001-bootstrap` @ branch `candice/wr001-bootstrap`
Date: 2026-08-21
Status: BUILT — awaiting QC (builder does not self-promote; box-flip per Box-flip rule)

## Deliverable — files created (all under `plugins/candice-integration/`)

| File | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest: name `candice-integration`, version 1.0.0, MIT, author Trevor Otts / BlackCEO, repo trevorotts1/999-setup |
| `hooks/hooks.json` | Hook registration: `UserPromptExpansion` matchers `spec-protocol`, `kaizen`, `eli5`, `bro` + `SessionStart`; every handler `async: true`, timeout 30 |
| `bin/wake-candice.sh` | Wake handler: resolves companion launch command (`CANDICE_COMPANION_CMD` env, then `candice-companion` on PATH), drains stdin, launches `--wake <command>` detached, exits 0 always |

Owned glob per PROJECT-MANIFEST 9.2 WR-011: `.claude-plugin/**`. Two additional paths created with cross-lane findings (below): `hooks/hooks.json`, `bin/wake-candice.sh` — required by the E.1 WS-02 acceptance criterion and unclaimed by any other slice row.

## Acceptance evidence (E.1 WS-02)

1. Manifest + hooks registered — `claude plugin validate plugins/candice-integration` PASS, `--strict` PASS (exit 0).
2. Live load — real Claude Code session (`claude --plugin-dir ...`, v2.1.227): init JSON lists plugin `candice-integration` version 1.0.0.
3. Wake hook fires for all four commands — session log: `--wake /spec-protocol`, `--wake /kaizen`, `--wake /eli5`, `--wake /bro` each exactly once per invocation; `SessionStart` fires per session.
4. Fast + before preflight — handler is async, detached, sub-second; skill's own preflight runs normally.
5. Never blocks skill execution — companion mock exit 99: session completed normally (skill output produced, rc 0).
6. Fail-soft when app missing — no companion installed: hook exits 0 silently, no marker, no error.

## Cross-lane findings

- CROSS-LANE-FINDING WS-02 -> conductor (severity: medium, required for E.1 WS-02 PASS): Claude Code plugins do NOT load hooks from `.claude-plugin/hooks/hooks.json`. Only `plugin.json` may live inside `.claude-plugin/`; hook config must be at plugin root `hooks/hooks.json` (official plugins reference, code.claude.com/docs/en/plugins). Ownership map 9.2 WR-011 grants WS-02 only `plugins/candice-integration/.claude-plugin/**`, and 9.3's within-run shared set does not name hooks.json. WS-02 therefore created `plugins/candice-integration/hooks/hooks.json` (no other slice claims it; spec's own suggested layout in MASTER-SPEC section 12 places hooks at plugin root). Recommend: extend the WR-011 row owned glob to `plugins/candice-integration/.claude-plugin/**` + `plugins/candice-integration/hooks/**` before WR-011 dispatch, and note `bin/wake-candice.sh` (hook handler, referenced from hooks.json) alongside the WS-03 `bin/**` session+bridge glob.
- CROSS-LANE-FINDING WS-02 -> WS-03 (severity: low): wake handler resolves the companion launch command by convention (`CANDICE_COMPANION_CMD` env or `candice-companion` on PATH) and passes `--wake <command>`. WS-03's app entry should accept a `--wake` flag; if the flag contract changes, only hooks.json/wake-candice.sh need updating (owned by this lane).
- CROSS-LANE-FINDING WS-02 -> WR-010 (severity: low, informational): schema files absent at build time (WS-01 writes them concurrently); no schema dependency in this lane — hooks pass only the command name string, no schema coupling.

## Verification commands used

```bash
jq empty plugins/candice-integration/.claude-plugin/plugin.json
jq empty plugins/candice-integration/hooks/hooks.json
bash -n plugins/candice-integration/bin/wake-candice.sh
claude plugin validate plugins/candice-integration            # PASS
claude plugin validate --strict plugins/candice-integration   # PASS
# E2E: claude --plugin-dir plugins/candice-integration --model claude-sonnet-4-5
#      with CANDICE_COMPANION_CMD pointing at a recording mock; transcript + calls.log verified
```

No commit made (per slice instructions). Companion binary itself is intentionally NOT this lane's deliverable — WS-03/WS-06 own the app; bootstrap install (WS-31) provisions `CANDICE_COMPANION_CMD`.
