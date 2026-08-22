# Tauri Windows signing fragment — PROPOSAL (WS-29 → integration owner)

**Status: PROPOSAL ONLY — never applied by this lane.** `tauri.conf.json`
version/manifest fields are 9.4 class 2 (integration/release owner applies at
fan-in). This fragment is the exact JSON this lane proposes; the integration
owner merges it into `apps/candice-companion/tauri.conf.json` only when an
Authenticode identity exists (see `SIGNING-STATUS.md`).

## Fragment (add under `bundle`)

```json
"windows": {
  "certificateThumbprint": "<SHA1-40-hex of BlackCEO code-signing cert>",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.digicert.com",
  "nsis": {
    "installerHooks": "../scripts/package-windows/installerHooks.nsh"
  },
  "webviewInstallMode": {
    "type": "downloadBootstrapper"
  }
}
```

Notes:

- `certificateThumbprint` — SHA-1 thumbprint, exactly 40 hex chars; validated
  by `nsis-policy-audit.mjs`.
- `digestAlgorithm: "sha256"` — recommended (SHA-1 digest is deprecated for
  code signing).
- `timestampUrl` — timestamp server so the signature survives certificate
  expiry. Operator may substitute their vendor's timestamp URL.
- `nsis.installerHooks` — points at this lane's `scripts/package-windows/installerHooks.nsh`
  (path relative to `src-tauri/`, per Tauri 2 docs — the lane moved from
  `src-tauri/windows/` into the manifest-pinned `scripts/package-windows/**`
  glob 2026-08-21, so the fragment path now steps up one level). Tauri INCLUDEs the hooks file
  into its own generated installer script at the `{{installer_hooks}}` line.
  A custom `nsis.template` is deliberately NOT used: it replaces the entire
  Tauri-generated script, including payload-copy, WebView2, shortcut, and
  uninstall logic.
- `webviewInstallMode` — default `downloadBootstrapper`; matches the existing
  app's no-WebView2-installed posture. `embedBootstrapper` is the offline
  alternative (larger installer).
- While `certificateThumbprint` is ABSENT (current state), Tauri produces an
  unsigned installer; the gate stays closed per `SIGNING-STATUS.md`.
- Posture is NEVER a build flag. tauri-bundler calls makensis with no `/D`
  defines and `NsisConfig` has no defines field, so no `CANDICE_*` flag can
  reach the hooks file. The hooks file's `NSIS_HOOK_POSTINSTALL` instead
  probes the produced artifact with WinVerifyTrust at install time and stamps
  `release-posture.txt` with the probed state (SIGNED only on a validated
  signature; every other outcome NOT-SIGNED). No CI step is needed to "set
  the posture" — signing the artifact IS the posture.

## Proposed CI fragment (`.github/workflows/**` is 9.4 class 4 — proposal to the CI owner)

Windows release job steps beyond the standard `tauri build`:

1. Inject `CANDICE_WIN_CERT_THUMBPRINT` as a CI secret; the job templates
   `tauri.conf.json` with it (or uses `TAURI_SIGNING_*` env if the pipeline
   prefers). Never print the thumbprint beyond the 3+3 masking rule.
2. `tauri build --bundles nsis` — Tauri runs signtool automatically on
   Windows when `certificateThumbprint` is set (default path
   `C:\Program Files (x86)\Windows Kits\10\bin\<ver>\x64\signtool.exe`);
   `signCommand` (e.g. osslsigncode) is required for cross-compiled signing
   from macOS/Linux runners.
3. Verify: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File
   .\apps\candice-companion\scripts\package-windows\verify-signature.ps1 -Path
   <built exe>` AND the NSIS setup exe; both must report `Valid` (exit 0).
4. Fail the job on `SIGNED_INVALID`; fail on unsigned-without-marker.
5. No posture define step exists or is needed: the install-time hook probes
   the signed app exe and stamps `release-posture.txt` from the probed
   state. Any CI step that claims to "define CANDICE_SIGNED_RELEASE" targets
   a mechanism Tauri does not provide (makensis gets no /D flags) — reject
   such steps in review.

## What must NOT be applied without credentials

- A thumbprint placeholder (e.g. `"0000...")` — `nsis-policy-audit.mjs`
  rejects non-40-hex values, and a fake thumbprint would sign nothing while
  silently claiming posture. The signed posture requires a real identity.
