# CHECKPOINT — WS-31 fresh-install Candice bootstrap

Lane: WR-017 / WS-31 (builder B-WR-017-WS-31, opus/max, W2-chained).
Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017
row line 278; CONTROL/task-graph-snapshot.json WS-31 owned_paths).
Worktree: `worktrees/wr001-bootstrap` @ branch `candice/wr001-bootstrap`.
Date: 2026-08-21. No commit, no push (builder contract).

Dependencies consumed (all present at build time): WS-02 plugin
(`plugins/candice-integration/**`), WS-06 Tauri shell
(`apps/candice-companion/**`), WS-23 macOS packaging
(`apps/candice-companion/scripts/package-macos/**`), WS-29 Windows packaging
(`apps/candice-companion/scripts/package-windows/**`), WS-33 registry+engine
(`scripts/candice-updater/**`). WS-16/WS-19 asset pins read from the WS-33
registry records.

## Files created (owned glob only — `scripts/candice-bootstrap/**`)

- `bootstrap.mjs` — CLI: `install` / `--health` (exit 0/1/2)
- `install.mjs` — install engine (skills, plugin, app, assets, launch, state)
- `state.mjs` — persistent installed-tree state (schema
  `candice.bootstrap.state/v1`)
- `paths.mjs` — platform paths (HOME/LOCALAPPDATA-derived; spec 24)
- `health.mjs` — fast health/version check (spec 21 step 7)
- `README.md` — lane summary, layout, WS-33 seam, run/test commands
- `__tests__/bootstrap.test.mjs` — 19 unit tests
- `__tests__/ws33-integration.test.mjs` — 4 WS-33 cross-lane integration tests

## Acceptance evidence (E.1 WS-31 legs)

1. **Bundled skills** — `installSkills` copies all five whole trees
   (`nine-router-setup`, `spec-protocol`, `kaizen`, `eli5`, `bro`) from the
   checkout into `<root>/skills/`; VERSION pins match the tree
   (`1.16.3/1.16.3/1.0.1/1.0.0/1.0.0`, live-verified 2026-08-21). Test:
   `installSkills stages and installs all five skill trees` PASS.
2. **Candice integration plugin** — `installPlugin` lands the plugin tree
   with `.claude-plugin/plugin.json` + `hooks/hooks.json` +
   `bin/wake-candice.sh`. Test PASS.
3. **Companion app** — `installApp` darwin places the prebuilt `.app`
   bundle at `<root>/app/Candice Companion.app` (no compile). Windows:
   records the NSIS-installer placement (WS-29), never fakes an app tree.
   Tests PASS (fixture bundle; `installApp darwin` + win32 skip paths).
4. **Pinned STT/TTS assets** — `installAssets` resolves the four pinned
   records from the WS-33 registry (stt model `ggml-tiny.en-q5_1.bin`,
   stt runtime win32 `whisper-bin-x64.zip`, tts `kokoro-v1.0.fp16.onnx`,
   `voices-v1.0.bin`). Download mode runs the WS-33 download gate (sha256 +
   size fail-closed); record mode writes the verified hash markers
   (offline/CI). Tests PASS; gate-refusal test proves an unverifiable
   payload never lands on disk.
5. **Launch/bridge command** — `launchCommand` records the macOS executable
   path; state.launch carries `{command, ok}`. Test asserts the path shape.
6. **Version/checksum metadata** — `state/bootstrap-state.json` (schema
   `candice.bootstrap.state/v1`) records every component version + asset
   sha256 + launch record; `stateMatches` gates the fast health check.
   Tests PASS (round-trip, end-to-end state assertions).

## Verified live (this machine)

- `node --test "__tests__/*.test.mjs"` -> **23/23 PASS, 0 fail** (node
  v26.7.0).
- CLI smoke: `bootstrap.mjs install --offline --root <tmp> --app-source
  <fixture.app>` -> `OK bootstrap completed: skills, plugin, app, assets,
  launch metadata`; then `--health` -> all 10 components `OK`, exit 0.
- WS-33 subprocess seam exercised against the real `atomic-install.mjs`
  (stage->install->backup->marker) and the real `download.mjs` (refused
  unverifiable payload, nothing written).
- `node --check` clean on all `.mjs` modules.
- `claude plugin validate` on the installed plugin tree was proven by the
  WS-02 lane; this lane installs that tree byte-for-byte (cp, not a rebuild).

## Cross-lane notes / proposals

- **AGENT_INSTALL.md proposal (9.4 item 1 class — proposal only, applied by
  the integration owner):** the fresh-install orchestrator step should, after
  the existing skill install (section 5), run
  `node scripts/candice-bootstrap/bootstrap.mjs install` and then
  `node scripts/candice-bootstrap/bootstrap.mjs --health`, failing the
  setup if health reports missing. Proposed wording for AGENT_INSTALL
  section 8/11 in the PROPOSAL block below.
- **Plugin visibility proposal (9.4 integration-owner decision):** skills
  installed under `<root>/skills/` need linking into the shared Claude
  config root (both `claude` and `claude-nine` see them). The bootstrap
  deliberately does not write `~/.claude` (plain-claude-untouched rule).
- **bundled-components.json (9.4 owner):** WS-33's `build-manifest.mjs`
  already emits the proposal fragment; this lane adds nothing further.

### PROPOSED AGENT_INSTALL.md addition (draft text — 9.4 owner applies)

```text
## 8b. Install the Candice fresh-install bundle (WS-31)

Run the bundled Candice bootstrap (no source compile on this computer):

    node scripts/candice-bootstrap/bootstrap.mjs install
    node scripts/candice-bootstrap/bootstrap.mjs --health

The bootstrap installs the bundled skills, the candice-integration plugin,
the prebuilt Candice Companion app, the pinned STT/TTS assets, and the
version/checksum metadata. The health check must exit 0. A non-zero health
exit names the missing components; do not claim setup complete until every
component is healthy. Never edit ~/.claude settings; skills stay visible to
both claude and claude-nine through the shared config root.
```

(Concrete orchestrator edits land in `scripts/setup-macos.sh` /
`scripts/setup-windows.ps1` — 9.4 item 4 class, integration owner applies.)

## Non-fabrication notes

- Release payload records (dmg, whisper bins, kokoro/voices) are NOT
  re-verified here: they are read from the WS-33 registry, whose hashes were
  live-download-verified by the WS-33 lane on 2026-08-21 (recorded in
  `scripts/candice-updater/checksums/README.md`). This lane's integration
  test re-asserts those exact record values and the fail-closed behavior.
- No claims of a built dmg in this lane; the app bundle test uses a fixture
  tree. The real macOS payload path (`Candice Companion_0.1.0_aarch64.dmg`,
  sha256 938cb110…) is recorded in the WS-33 registry.
- `trevorotts1/999-setup` has zero GitHub releases today (WS-33 verified);
  download-mode installs of release payloads are therefore SKIPPED-not-faked
  until the operator publishes.
