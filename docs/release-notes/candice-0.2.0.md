# Candice Companion 0.2.0 — first integrated release

Release date: 2026-08-21. Tag: `candice-v0.2.0` (namespaced; a bare `v0.2.0`
would collide with the repo-wide `v1.x` tag series).

## What shipped

- **App shell (WS-06/WS-07)**: Tauri 2 shell launches from prebuilt artifacts on macOS Apple Silicon and Windows x64 with no build toolchain on the customer machine; transparent, frameless, always-on-top window, no baked terminal/UI background.
- **Session bridge (WS-02/WS-03)**: plugin manifest + wake-up hooks for /spec-protocol, /kaizen, /eli5, /bro; begin_session/end_session lifecycle binds the app to the Claude session ID — session identity is the routing authority, never the window.
- **Question contract (WS-01/WS-04/WS-05)**: question/answer/status/preferences JSON schemas; candice.ask_user MCP path; same-session terminal fallback without double-counting.
- **Speech stack (WS-16/WS-17/WS-19/WS-20/WS-28)**: local/offline whisper.cpp STT with pinned checksum-verified model; mic live only while HOLD TO TALK is pressed; Kokoro 82M-compatible ONNX TTS with canonical voice; Windows WASAPI capture with no-device/permission-denied fallback to typing.
- **State machine (WS-08)**: idle/listening/transcribing/confirming/thinking/speaking/compact/recovering/text-fallback, driven by real status events.
- **Preferences (WS-40)**: versioned local profile; preferred name asked at most once per local user, never inferred from the OS username; future-version documents preserved untouched (mergeProfile guard).
- **Assets (WS-11/WS-12/WS-13)**: 16-asset manifest with stable production filenames and checksums; viseme sync to TTS timing; lightweight transform-based idle animation.
- **Packaging (WS-23/WS-29)**: macOS Developer ID + notarization path with Gatekeeper-never-disabled doctrine (production credentials late-bound; missing-credential limitation recorded as external release blocker); Windows NSIS installer-hooks with runtime Authenticode posture probe — unsigned builds carry a recorded limitation and are never misrepresented as trusted.
- **Instrumentation (WS-24/WS-30)**: macOS and Windows native CPU/RSS phase measurement; provisional baselines declared (real Windows x64 capture owed at WS-46 interactive smoke).
- **Updater (WS-33)**: bundled-component registry with SHA-256 checksums, operator-controlled download sources only, atomic install, rollback, downgrade rejection.
- **Boss tools (WS-48)**: portable paths, no developer-specific absolute home paths, config-driven campaign data.

## Skill versions

- spec-protocol 1.16.3 -> 1.17.0
- nine-router-setup 1.16.3 -> 1.17.0
- kaizen 1.0.1 -> 1.1.0
- eli5 1.0.0 -> 1.1.0
- bro 1.0.0 -> 1.1.0
- candice-integration plugin 1.0.0 (initial)
- candice-companion app 0.1.0 -> 0.2.0

## Known limitations

1. **Windows installer unsigned (WS-29)**: unsigned builds trigger SmartScreen
   ("Windows protected your PC") — expected and truthful. The limitation is
   recorded and the installer is never misrepresented as trusted. See
   `apps/candice-companion/scripts/package-windows/SIGNING-STATUS.md`.
2. **macOS production signing credentials late-bound (WS-23)**: the
   missing-credential path records `EXTERNAL-RELEASE-BLOCKER`; Gatekeeper is
   never disabled.
3. **Performance baselines provisional (WS-24/WS-30)**: macOS baselines were
   captured under emulation; Windows baselines are declared provisional. Real
   Windows x64 capture is owed at WS-46 interactive smoke.
4. **Interactive Windows 10/11 desktop smoke owed (WS-46)**: Windows is not
   labeled production-ready until the interactive smoke completes (spec 18).
5. **Release-artifact checksums**: the 0.2.0 DMG SHA-256 in
   `CONTROL/bundled-components.json` is now the real integrated-build hash
   (`f24f4bcb…b0dbaf`, 2,686,932 B — computed 2026-08-22 from the 0.2.0
   `npx tauri build` artifact; unsigned/adhoc, signing remains late-bound).
   The NSIS installer hash is still a fail-closed placeholder: **NSIS hash
   owed from Windows build** — the installer cannot be built on this macOS
   host. The updater refuses the placeholder until the 9.4 release owner
   computes the real hash from the Windows CI build.
