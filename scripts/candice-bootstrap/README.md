# Candice fresh-install bootstrap (WS-31)

Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017;
task-graph snapshot WS-31 owned_paths).

Implements the **fresh-install** leg of the Candice release (Master Spec
section 22, E.1 WS-31): a fresh 999 setup installs, without any source
compile on the customer machine:

1. current bundled skills,
2. the Candice integration plugin,
3. a Candice Companion desktop app only after a release-authorized candidate exists,
4. pinned local STT/TTS assets,
5. the launch/bridge command,
6. version/checksum metadata.

The existing-user leg (upgrade/repair) is WS-32; checksums/rollback are
WS-33. This lane composes the WS-33 engine through its CLI contracts — it
never re-implements checksumming, atomicity, or the payload registry.

## Files

| File | Purpose |
|---|---|
| `bootstrap.mjs` | CLI entry: `install` (full bootstrap) and `--health` (fast health/version check, spec 21 step 7). |
| `install.mjs` | Install engine. It refuses the entire bootstrap before writing state until an app candidate has passed immutable-manifest, hash/signature, and release-authority checks; it never accepts a caller-supplied app path. |
| `state.mjs` | Persistent `bootstrap-state.json` (schema `candice.bootstrap.state/v1`) — the installed-tree state: component versions, asset checksums, launch record. |
| `paths.mjs` | Platform install paths, all derived from `HOME`/`LOCALAPPDATA` (spec 24: no operator-specific absolute path). |
| `health.mjs` | Fast health/version check: present / stale / missing per component; never downloads, never writes. |
| `__tests__/` | 23 tests green: state round-trip, path resolution, skill/plugin/app install, WS-33 subprocess integration (real `atomic-install.mjs`, real `download.mjs` fail-closed), registry record resolution, CLI health. |

## Layout installed by the bootstrap

```
<root>/                                      macOS ~/Library/Application Support/BlackCEO/999
│                                            Windows %LOCALAPPDATA%\BlackCEO\999
├── skills/<skill>                           bundled skills (whole tree, SKILL.md + VERSION)
├── plugin/candice-integration/              candice-integration plugin (manifest + hooks + bin)
├── app/Candice Companion.app/               unavailable until a release-authorized candidate exists
├── assets/stt/                              ggml-tiny.en-q5_1.bin, whisper-cli(.exe)
├── assets/tts/                              kokoro-v1.0.fp16.onnx, voices-v1.0.bin
└── state/bootstrap-state.json               version + sha256 + launch metadata (E.1 leg 6)
```

`CANDICE_BOOTSTRAP_ROOT` overrides the root (used by the test suite; a
production run without it derives the standard path at runtime).

## The WS-33 seam

- `installAssets` mode **download**: each payload goes through
  `scripts/candice-updater/rollback/download.mjs` — sha256 + size verified
  against the registry before the file lands (fail closed).
- `installAssets` mode **record**: writes the registry's verified sha256 as
  a record marker (offline/CI mode; registry hashes were live-verified by
  the WS-33 lane 2026-08-21).
- Skills/plugin placement uses the WS-33 atomic-install engine
  (`atomic-install.mjs`): stage -> backup old -> atomic rename -> marker
  verify -> journal.
- A missing app candidate is a **hard bootstrap failure**, not a skipped
  leg. This prevents a partial install or caller-supplied bundle from being
  represented as a completed Candice release.

## No-compile invariant

- Skills/plugin install as whole-tree copies from the checkout.
- The app install path is deliberately disabled until a prebuilt macOS/Windows
  candidate has passed the release-authority gate.
- No `cargo`/`npm` build step exists anywhere in this lane.

## Plain `claude` untouched

This lane writes nothing under `~/.claude` or `$CLAUDE_CONFIG_DIR`, no
`settings.json`, no `.claude.json`. Skills land under the bootstrap root;
linking them into the shared config root is the 9.4 integration owner's
`AGENT_INSTALL.md` / orchestrator write. WS-31's proposal against
`AGENT_INSTALL.md` is filed in `CHECKPOINT-WS31.md` (root-level file, 9.4
item 1 class — this lane proposes, the integration owner applies).

## Run

```bash
# full fresh-install bootstrap (default root)
node scripts/candice-bootstrap/bootstrap.mjs install

# offline/CI: record asset metadata without downloading payloads
node scripts/candice-bootstrap/bootstrap.mjs install --offline

# fast health/version check (spec 21 step 7)
node scripts/candice-bootstrap/bootstrap.mjs --health

# tests
node --test "scripts/candice-bootstrap/__tests__/*.test.mjs"
```

Exit codes: `0` OK; `1` install/health failure; `2` usage.
