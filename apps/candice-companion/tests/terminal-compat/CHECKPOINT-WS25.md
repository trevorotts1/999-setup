# CHECKPOINT — WS-25 macOS Terminal/iTerm compatibility

Builder: WS-WS-25 (opus/max, W2 build). Worktree: `wr001-bootstrap`.
Date: 2026-08-21. Deps: WS-21 (verified green on this worktree before
build), WS-03 (integration seam, read-only input).

## Scope

Owned glob (manifest 9.2): `apps/candice-companion/tests/terminal-compat/**`
— created new (was absent). Nothing outside the glob was touched.

## Deliverable

| File | Purpose |
|---|---|
| `integration.test.ts` | WS-03 binding-bridge integration, fixture level — session-vs-window identity, Terminal.app/iTerm2 tabs ambiguity, rebind identity stability, endSession anchor release, stable failure codes (spec 20) |
| `launcher-analysis.test.ts` | launcher contract on fixture text — nine launcher owns `~/.claude-nine` config dir, plain `claude` has no config override, distinct files, exec semantics, no mutation of plain claude |
| `e2e-live.mjs` | live Mac harness — Terminal.app presence, `zsh -lc` login-shell resolution of `claude`/`claude-nine`, plain-env no-`CLAUDE_CONFIG_DIR` probe, WS-21 probe run (exit 0, window-count line), iTerm2 presence report (SKIP on non-macOS) |
| `CONTRACT.md` | binding rules + evidence-grader checklist (E.1 WS-25 mapping) |
| `README.md` | suite docs + run commands |
| `CHECKPOINT-WS25.md` | this file |

## Verification (primary-source, re-run at QC time)

### Dependency re-check (WS-21)

```sh
cd apps/candice-companion/src-tauri/binding/macos
cargo test --offline            # 35 passed / 0 failed
cargo test --features live-probe --offline   # 35 passed / 0 failed
cargo run --features live-probe --offline --example probe
# -> window-count=0, confidence=None, anchor=none, exit 0
# (no Screen Recording consent for the probe binary; documented clean
# degrade, spec 20; full live-match evidence is the WS-25 end-to-end job)
```

### Fixture suites

```sh
cd apps/candice-companion
node --test tests/terminal-compat/integration.test.ts      # 12 passed / 0 failed
node --test tests/terminal-compat/launcher-analysis.test.ts # 5 passed / 0 failed
```

### Live harness (this Mac, primary reference path)

```sh
node tests/terminal-compat/e2e-live.mjs
```

Evidence captured at build time:

- host: arm64 macOS; `uname -m` -> arm64 (Apple Silicon reference path).
- Terminal.app present at `/System/Applications/Utilities/Terminal.app`.
- `claude`  -> `/Users/blackceomacmini/bin/claude` (plain, non-routed).
- `claude-nine` -> `/Users/blackceomacmini/.local/bin/claude-nine`
  (bash script, symlink-resolving, own `~/.claude-nine` config dir).
- Plain launch env: no `CLAUDE_CONFIG_DIR` line (config root untouched).
- WS-21 probe: exit 0, `window-count=0` (no Screen Recording consent;
  clean degrade, spec 20).
- iTerm2: not installed on this host -> recorded SKIP-ENV
  (supported-where-installed; iTerm owner-name classification proven by
  WS-21 cargo suite).

## Ownership boundary notes

- WS-21 crate (`src-tauri/binding/macos/**`): read-only dependency;
  its probe binary is invoked, never modified.
- WS-03 session modules (`plugins/candice-integration/session/**`):
  read-only integration seam under test.
- No other lane's glob was written; no CONTROL/** or SPEC/** changes.
- Interactive `/spec-protocol` + Candice end-to-end session smoke is the
  WS-46 release smoke's obligation (this lane proves the underlying
  launcher/host/identity contract).

## Handoff

Working tree only — no commit, no merge (builder discipline). QC may
re-run everything with the commands in README.md / CONTRACT.md.
