# WS-25 — macOS Terminal/iTerm compatibility — tests

Owned lane: `apps/candice-companion/tests/terminal-compat/**` (PROJECT-MANIFEST
9.2, WS-25; WR-015 candice-macos run).

## What is proven

Binary acceptance criteria (CHECKLIST E.1 WS-25 + Master Spec 17/27/28):

1. Terminal.app is the mandatory primary target; iTerm2 is supported where
   installed; other hosts are never bound as supported (fixture + WS-21
   classify + live presence check).
2. Session identity is the routing authority — a window anchor is visual
   metadata only. The WS-03 binding bridge refuses window-only routing
   proof, refuses ambiguous windows (Terminal.app tabs, iTerm2
   tabs/panes), and never cross-routes an answer between sessions
   (spec 17: "switching tabs/panes must never send a Candice answer to
   another Claude session").
3. The `claude-nine` launcher resolves through a login shell and is a
   distinct Bash script with a private config dir; plain `claude` resolves
   to a different file and carries no `CLAUDE_CONFIG_DIR` override — plain
   Claude routing untouched (spec 0.3 override 8).
4. The WS-21 discovery/binding probe runs and degrades cleanly without
   Screen Recording consent (spec 20 — failure never stops Claude).
5. Every routing refusal is `{ok:false, code}` with a stable code — never
   a throw (spec 20).

## Layout

| File | Purpose |
|---|---|
| `integration.test.ts` | WS-03 bridge integration (fixture level): session-vs-window identity, tabs/panes ambiguity, rebind, endSession anchor release, failure codes |
| `launcher-analysis.test.ts` | launcher contract on fixture text: private config dir, plain-claude untouched, symlink resolution, exec semantics |
| `e2e-live.mjs` | live Mac harness (SKIP on non-macOS): Terminal.app presence, login-shell resolution of `claude`/`claude-nine`, plain-env no-routing probe, WS-21 probe run, iTerm2 presence |
| `CONTRACT.md` | binding rules + evidence-grader checklist |
| `CHECKPOINT-WS25.md` | build provenance + verdict evidence |
| `README.md` | this file |

## Run

```sh
cd apps/candice-companion

# CI-green fixture suites (any host):
node --test tests/terminal-compat/integration.test.ts
node --test tests/terminal-compat/launcher-analysis.test.ts

# Live Mac evidence (SKIP on non-macOS):
node tests/terminal-compat/e2e-live.mjs
```

The suites are dependency-light by design (Node built-ins only) so they run
in any CI container without the app toolchain (same doctrine as
`tests/prefs/**` and `tests/visual/**`).

## Ownership boundaries

- WS-21 crate (`src-tauri/binding/macos/**`) — read-only dependency,
  exercised live via its probe binary; its own 35-test cargo suite is the
  unit-level proof.
- WS-03 session modules (`plugins/candice-integration/session/**`) —
  read-only integration seam under test.
- Interactive session smoke (real `/spec-protocol` run) is the release
  smoke's job (WS-46); this lane proves the launcher/host/identity
  contract underneath it.
