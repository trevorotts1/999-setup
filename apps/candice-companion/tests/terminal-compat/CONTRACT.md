# WS-25 CONTRACT — macOS Terminal/iTerm compatibility

Owned glob (manifest 9.2): `apps/candice-companion/tests/terminal-compat/**`
Lane: WR-015 / WS-25. Deps: WS-21 (macOS terminal-window discovery/binding,
`apps/candice-companion/src-tauri/binding/macos/**`), WS-03 (session
lifecycle + binding bridge, `plugins/candice-integration/session/**`).

## What this lane is

The compatibility proof for the primary macOS customer paths (Master Spec
0.3, 17, 27, 28):

- **Terminal.app — mandatory primary target**; the reference desktop
  experience is Terminal.app + Apple Silicon.
- **iTerm2 — supported where installed** (owner names `iTerm` / `iTerm2`,
  bundle `com.googlecode.iterm2`).
- Other terminal hosts reported as unknown, never bound as supported.
- Both launchers must work: plain `claude` and `claude-nine` (routed),
  with plain `claude` never mutated into a routed launcher (spec 0.3
  override 8, E.1 WS-25).

## What this lane will NEVER do (binding rules)

1. **Route on a window.** Session identity is the routing authority (spec
   17). The WS-03 bridge's `route`/`resolveRoute` refuses any window-only
   proof and any ambiguous window — this lane's tests PROVE that refusal
   (tab/panes separation is the WS-25 acceptance criterion "tab/session
   identity separation proven").
2. **Start an interactive Claude session.** The live harness measures
   launcher resolution and the WS-21 probe only; it never blocks on an
   interactive prompt, never sends messages, never mutates launchers,
   configs, or the user's Claude install.
3. **Write to any other lane's files.** WS-21 crate and WS-03 session
   modules are READ-ONLY inputs here (integration seam under test).
4. **Fabricate evidence.** Every live claim is primary-source output
   captured in the harness transcript; the fixture suites are honest
   (negative fixtures included).

## Evidence-grader checklist (each item maps to a file + run)

| Requirement (spec 17 / E.1 WS-25) | Where proven | Test |
|---|---|---|
| Terminal.app is the mandatory primary target | `e2e-live.mjs` (system path check) + WS-21 crate | live harness `terminal-app` gate |
| iTerm2 supported where installed | `e2e-live.mjs` (presence report) + WS-21 host classify | `iterm2_*` WS-21 cargo tests |
| Tab/session identity separation (window placement != session identity) | `integration.test.ts` | `two sessions sharing one terminal window (tabs) -> ambiguous, refused` |
| Tab/pane switch never cross-routes an answer | `integration.test.ts` | `window bound to a different active session -> refused` |
| Injection/route disabled when exact session unproven | `integration.test.ts` | `a bare window is never routing evidence` |
| `claude-nine` resolves through login shell and runs | `e2e-live.mjs` | `claude-nine-resolve` gate (zsh -lc `command -v`) |
| Plain `claude` path works with routing untouched | `e2e-live.mjs` (`env` probe) + `launcher-analysis.test.ts` | no `CLAUDE_CONFIG_DIR` in plain env; no override in plain wrapper fixture |
| `claude-nine` owns a private config dir; plain `claude` never set config override | `launcher-analysis.test.ts` | fixture assertions |
| Nine-router launcher never rewrites plain claude | `launcher-analysis.test.ts` | no write/alias/PATH mutation in routed fixture |
| WS-21 binding degrades cleanly without Screen Recording consent | `e2e-live.mjs` (probe exit 0, window-count=0 path) | probe record line |
| Failure never stops Claude (all refusals `{ok:false,code}`) | `integration.test.ts` | `stable failure codes (spec 20)` |

## Run (from `apps/candice-companion`)

```sh
# CI-green fixture suites (any host, any container):
node --test tests/terminal-compat/integration.test.ts
node --test tests/terminal-compat/launcher-analysis.test.ts

# Live Mac evidence (SKIP on non-macOS):
node tests/terminal-compat/e2e-live.mjs

# WS-21 dependency (the crate under integration):
cd src-tauri/binding/macos && cargo test && cargo test --features live-probe
```

## Provenance / evidence (2026-08-21)

- `integration.test.ts`: 12/12 passed (see CHECKPOINT-WS25.md).
- `launcher-analysis.test.ts`: 5/5 passed.
- `e2e-live.mjs`: PASS on this Mac — Terminal.app present; `claude` and
  `claude-nine` resolve via login shell to distinct files; plain env
  carries no `CLAUDE_CONFIG_DIR`; WS-21 probe exit 0 (window-count=0 —
  no Screen Recording consent, documented degrade, spec 20); iTerm2
  absent (SKIP-ENV recorded, supported-where-installed).
- WS-21 dependency re-verified: 35/35 both profiles (see
  CHECKPOINT-WS21.md).
