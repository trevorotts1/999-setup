# WS-49 — installer/updater regression suite

Owned glob: `tests/installer-regression/**` (PROJECT-MANIFEST 9.2 WR-021;
task-graph snapshot WS-49 owned_paths). Builder: WS-WS-49 (opus/max), W3
build, worktree lane WR-021.

Regression view over the shipped install/update stack (spec 21/22). Drives
the REAL engines — never re-implements checksumming, atomicity, or payload
records:

| Leg (E.1 WS-49) | Suite | Engines under regression (owner) |
|---|---|---|
| update detection | `update-detection.test.mjs` | `gate.mjs` + `components.mjs` version math (WS-33), `health.mjs` (WS-31) |
| checksum verification | `checksum-verify.test.mjs` | `verify.mjs`, `download.mjs` (WS-33) |
| atomic install | `atomic-install.test.mjs` | `atomic-install.mjs` (WS-33) |
| backup | `atomic-install.test.mjs`, `full-journey.test.mjs` | `atomic-install.mjs` (WS-33) |
| rollback | `atomic-install.test.mjs`, `full-journey.test.mjs` | `atomic-install.mjs` (WS-33) |
| uninstall cleanup | `uninstall-cleanup.test.mjs` | full-root removal contract + WS-29 NSIS hooks (static) |
| end-to-end journey | `full-journey.test.mjs` | `install.mjs`/`health.mjs` (WS-31) + `atomic-install.mjs` (WS-33) |

## Run

```bash
node --test "tests/installer-regression/*.test.mjs"
```

Hermetic: every test runs in `mkdtemp` under the OS temp dir. Nothing touches
the live home directory, `~/.claude`, or any real config root. No network.

## Scope notes (recorded in CHECKPOINT-WS49.md)

- WS-32 (`scripts/candice-upgrade/**`) not built at WS-49 build time — this
  lane regresses the detection + mechanics its orchestration calls, not the
  orchestrator itself.
- A shared cross-platform uninstall ENGINE does not exist in the updater
  scripts yet; the harness implements the documented contract (spec 21/22:
  full install-root removal; Windows default NSIS uninstall section) and
  asserts the shipped surfaces.
- No source compile, no commits, no pushes (builder contract).
