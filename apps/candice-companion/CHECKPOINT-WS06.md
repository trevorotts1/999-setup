# CHECKPOINT-WS06.md — Tauri application shell (WR-008 / WS-06)

**Builder:** B-WR-008-WS-06 (opus/max). **Worktree:** `worktrees/wr001-bootstrap`
(branch `candice/wr001-bootstrap` @ `aa23ed9`). **Base:** `6bb00ec`. **Not committed, not pushed.**

## Acceptance (CHECKLIST E.1 WS-06)

> Tauri 2 shell launches from a prebuilt artifact on macOS Apple Silicon and
> Windows x64 with no build toolchain on the customer machine.

Status: **macOS Apple Silicon path proven end-to-end on this builder.**
Windows x64 path: shared shell is platform-neutral; `windows/**`, `macos/**`,
`binding/**` are WS-26/WS-21 lane-owned. Cross-platform bundle CI is 9.4-class
(WS-46 proposal), not this lane's write.

## Evidence (all on this machine, 2026-08-21)

| Check | Result |
|---|---|
| `npm run tauri:build` (canonical one-command build) | exit 0, "Finished 2 bundles" |
| `src-tauri/target/release/bundle/macos/Candice Companion.app` | Mach-O 64-bit arm64, 5.4 MB, CFBundleIdentifier `com.blackceo.candice`, version 0.1.0 |
| `src-tauri/target/release/bundle/dmg/Candice Companion_0.1.0_aarch64.dmg` | 2.6 MB |
| Release binary launch (headless) | process alive at 8–10 s, clean termination |
| `cargo test` (shell unit tests) | 3 passed, 0 failed |
| `tsc --noEmit` on WS-06 graph (`src/main.ts`, `src/shell/`, `src/state/` contract) | clean |
| `vite build` | 16 modules, payload at `src-tauri/dist/` (embedded into binary via `frontendDist`) |

No Rust/Node toolchain is required on the customer machine: the webview
payload is embedded at compile time (`frontendDist`), icons bundled, and only
the signed `.app`/`.dmg` (later `.exe`) are distributed (spec 12, 18).

## Files created (WS-06 owned globs only: `src-tauri/*` root Tauri files, `src-tauri/src/**`, `src/*` root entries)

```
apps/candice-companion/README.md
apps/candice-companion/package.json
apps/candice-companion/package-lock.json
apps/candice-companion/tauri.conf.json
apps/candice-companion/index.html
apps/candice-companion/tsconfig.json
apps/candice-companion/vite.config.ts
apps/candice-companion/vite.config.build.ts
apps/candice-companion/src/main.ts
apps/candice-companion/src/vite-env.d.ts
apps/candice-companion/src/styles.css
apps/candice-companion/src/shell/shell-commands.ts
apps/candice-companion/src/shell/text-fallback.ts
apps/candice-companion/src/shell/visual-stage.ts
apps/candice-companion/src-tauri/Cargo.toml
apps/candice-companion/src-tauri/Cargo.lock
apps/candice-companion/src-tauri/build.rs
apps/candice-companion/src-tauri/capabilities/main.json
apps/candice-companion/src-tauri/icons/{32x32,128x128,128x128@2x}.png
apps/candice-companion/src-tauri/icons/icon.icns
apps/candice-companion/src-tauri/icons/icon.ico
apps/candice-companion/src-tauri/src/{main,lib,shell}.rs
apps/candice-companion/CHECKPOINT-WS06.md
```

Shared config edits (9.3 within-run set, app-level): `package.json`,
`tauri.conf.json`, `Cargo.toml` are co-owned with WR-012 siblings; this lane
created them with release-owner-reminder comments (version fields stay
`0.1.0` until the 0G stamp; release owner's file). Root `.gitignore` gained
Candice build-output entries (comment-blocked, additive).

## Config layout decision (recorded for the integration owner)

Spec 12 puts `tauri.conf.json` at the app root; Tauri's toolchain resolves
config-relative paths against `src-tauri/`. Resolution: `build.rs` mirrors
the app-root config to `src-tauri/tauri.conf.json` (generated, gitignored)
and `npm run tauri:build` refreshes the mirror before `tauri build`; both
the CLI and `generate_context!("tauri.conf.json")` then read the same file
with the same base (`src-tauri/`). `frontendDist` is `dist` (src-tauri-relative),
vite emits to `src-tauri/dist`. No `TAURI_CONFIG` env trick, no symlinks,
Windows-safe.

## Cross-lane findings

```text
CROSS-LANE-FINDING
source workflow/lane: B-WR-008-WS-06 (Tauri shell)
affected unit: WR-018 (WS-40) — apps/candice-companion/src/prefs/profile.ts
evidence: line 128 stray "}" — hard syntax error (TS1128) breaks `tsc --noEmit`
          for the whole app tree; observed while running the WS-06 front-end
          build gate. Also blocks any CI build that typechecks the repo.
severity: medium
recommended action: WR-018 lane removes the stray closing brace; the file
          ends at the `defaultProfile()` export.
```

```text
CROSS-LANE-FINDING
source workflow/lane: B-WR-008-WS-06 (Tauri shell)
affected unit: WR-016 (WS-28) — apps/candice-companion/src/platform/windows/audio/recorder.ts
evidence: `startWindowsRecording` mutates a `readonly` field via
          `(handle as { recording: boolean }).recording = false` (line 147) —
          TS2540 under strict; also engine/stdin type mismatch (TS2322) and
          unused destructured params (TS6133). Blocks whole-tree tsc.
severity: medium
recommended action: WR-016 lane: declare `recording` mutable on the internal
          handle type (or use a `mutableRecording` field) and drop the cast;
          fix the `ChildProcessWithoutNullStreams` type; the sampler `.at()`
          needs TS lib es2022 (WS-06 already raised the app tsconfig to
          ES2022 for this).
```

```text
CROSS-LANE-FINDING
source workflow/lane: B-WR-008-WS-06 (Tauri shell)
affected unit: WR-016 (WS-30) — apps/candice-companion/src/platform/windows/instrumentation/sampler.ts
evidence: `Array.prototype.at` requires TS lib es2022; WS-06 app tsconfig now
          targets ES2022 so this is resolved as of this checkpoint.
severity: low
recommended action: none — resolved by WS-06 tsconfig bump.
```

## Notes for integration

- `src-tauri/.cargo/config.toml` and the `TAURI_CONFIG` env approach were
  tried and removed (env is applied to build-script processes but the config
  read happens before the merge; the mirror is the working mechanism).
- Placeholder icons are branded violet discs, RGBA-transparent — valid
  Tauri icons, clearly dev-only; final art binds via WR-013's asset contract.
- `apps/candice-companion/src-tauri/{macos,windows,stt,audio/path...}` and
  `packaging/` belong to WR-013/014/015/016/023/029 lanes — untouched.
- Version pins: tauri 2.11.5, tauri-build 2.6.3, tauri-plugin-shell 2.3.5,
  @tauri-apps/cli 2.11.4, @tauri-apps/api 2.11.1, vite 5.4.21, typescript
  5.9.3, @types/node 26.2.0 — all exact, CI-reproducible.
