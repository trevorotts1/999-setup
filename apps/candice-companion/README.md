# Candice Companion

Candice is the face, voice, ears, and lightweight user interface. The active
Claude Code session and the invoked skill remain the brain, rules, memory, and
source of truth (Master Spec section 2).

This package is the Tauri 2 application shell (Master Spec section 12). It
launches from a prebuilt artifact on macOS Apple Silicon and Windows x64 with
no Rust/Node/build toolchain on the customer machine (Master Spec section 12,
CHECKLIST E.1 WS-06). Prebuilt signed binaries are produced in CI and
distributed through GitHub Releases; nothing compiles on the customer machine.

## Layout

```text
apps/candice-companion/
  src/                     # shared webview front-end (root-level entry files — WS-06)
  src-tauri/               # Rust shell — root-level Tauri files (WS-06)
    src/                   # Rust entry + shared shell modules (WS-06)
      binding/             # platform window binding (WR-015 / WR-016)
      permissions/         # OS permission handling (WR-015)
      stt/ tts/ audio/     # speech stack (WR-014)
      recovery/            # crash recovery (WR-018)
  assets/candice/          # final-art assets, READ-ONLY (WR-013)
  tests/                   # app-level tests
  package.json
  tauri.conf.json
```

Platform-specific modules (window tracking/anchoring, permissions, install
paths, startup process details, signing/package format, platform audio
plumbing) live in their owning lanes under `src-tauri/` and are never part of
this workstream's files (Master Spec section 18 platform boundary).

## Build a prebuilt artifact

Requires the build toolchain on the BUILD machine only (customer machines
never do):

```bash
npm install
npm run tauri:build
```

`tauri:build` runs the typecheck + vite production build (payload emitted to
`src-tauri/dist`), refreshes the build-time config mirror, and produces the
bundles. The compiled webview payload is bundled INTO the native artifact
(`frontendDist: "dist"`, resolved relative to `src-tauri/`); the customer
receives only the signed `.app`/`.exe` bundle.

Layout note: `tauri.conf.json` lives at the app root (spec 12 layout). The
Tauri toolchain resolves config-relative paths against `src-tauri/`, so
`build.rs` mirrors the app-root config to `src-tauri/tauri.conf.json`
(generated, gitignored) and `src-tauri/.cargo/config.toml` is not needed —
the mirror + `npm run tauri:build` keep both the CLI and the codegen macro
reading the same file with the same base. Windows CI uses the same command.

## Run in development

```bash
npm install
npm run tauri dev
```

## Design constraints honored here

- No game engine, no transparent video loop (section 10).
- The shell is presentation infrastructure: a failure must never stop Claude
  (section 20). The Rust entry keeps all subsystem failures local and logs
  them; the front-end boots into a text-mode degraded surface.
- Dev tooling pins are fixed so release CI reproduces the exact same artifact
  (cargo/package.json pins; no floating majors).
- The source-tree version `0.2.0` is an unshipped historical development
  stamp, not a release or install authority. No application artifact is
  currently authorized; a future release workflow assigns the version only
  after the independent release-authority gate passes.

## Smoke test

`src-tauri/src/smoke.rs` (`#[cfg(test)]` module) verifies the shared shell
logic (config parse, placeholder asset sanity, failure isolation) without a
display or a webview; run `cargo test` inside `src-tauri/`.
