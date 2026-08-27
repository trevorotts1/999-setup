# Candice Companion 0.2.0 — withdrawn historical draft

> **QUARANTINED — NOT A RELEASE.** No `candice-v0.2.0` application payload is
> authorized for download, installation, or update. The previous release
> claim and its app checksum references were withdrawn during the release
> authority repair. Nothing below is evidence that an app shipped; it is an
> unverified implementation-history draft retained only for audit context.

## Historical implementation claims (not release evidence)

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

## Historical proposed version mapping (not install authority)

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
5. **Withdrawn artifact checksum statement**: any former 0.2.0 DMG/NSIS
   checksum mentioned here is quarantined and must not be copied into a
   manifest, trusted as a release artifact, or used by an installer. A future
   release requires a newly generated immutable manifest and independent
   release-authority approval.
