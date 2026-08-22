# Candice Windows Installer — Signing Status and SmartScreen Limitation (WS-29)

**Status: NOT SIGNED — recorded production limitation.** This document is the
operator-recorded limitation file required by acceptance criterion E.1 WS-29
("Windows installer/executable is Authenticode-signed, **or the limitation is
recorded and the installer is not misrepresented as trusted**").

## Why this file exists

Production Windows distribution of an unsigned installer triggers SmartScreen:

> **Windows protected your PC** — "Microsoft Defender SmartScreen prevented an
> unrecognized app from starting. Running this app might put your PC at risk."

That warning is **expected and truthful** for an unsigned Candice release. The
Candice release contract (Master Spec 23) prohibits:

- presenting an unsigned installer as trusted/signed;
- instructing customers to bypass SmartScreen as the normal install path.

This file makes the limitation explicit and machine-checkable. The release
gate `scripts/package-windows/verify-signature.mjs` treats its presence as the
recorded-limitation marker for unsigned builds; without it, an unsigned
release fails verification (exit 1).

## The two release postures

| Posture | Marker in installer | Gate behavior |
|---|---|---|
| Signed (credentials available) | `CANDICE-INSTALLER-AUTHENTICODE-SIGNED` stamped into `release-posture.txt` by the runtime probe ONLY when WinVerifyTrust validated the installed app exe | `verify-signature.ps1` reports `Valid`; gate exit 0 |
| Unsigned (current state) | `CANDICE-INSTALLER-NOT-SIGNED` stamped by the runtime probe on every non-validated outcome (unsigned, untrusted, unverifiable) | `verify-signature.mjs` reports `UNSIGNED_WITH_RECORDED_LIMITATION`; gate exit 0 **only while this file exists** |

## What ships today (interim, pre-credential)

- `scripts/package-windows/installerHooks.nsh` — NSIS installer-hooks file, wired via
  `bundle.windows.nsis.installerHooks` (Tauri INCLUDEs it into its generated
  installer script; the payload-copy/WebView2/shortcut/uninstall logic stays
  with the Tauri default script). Posture is stamped at install time by a
  RUNTIME probe: `NSIS_HOOK_POSTINSTALL` calls WinVerifyTrust (System plugin,
  bundled with makensis) against `$INSTDIR\${MAINBINARYNAME}.exe` — the app
  exe Tauri's signing pass signs after makensis runs — and writes the PROBED
  state to `release-posture.txt`. The SIGNED literal is written only on a
  validated signature; every other outcome writes NOT-SIGNED (a broken probe
  fails closed, never to SIGNED).
  Note: there is NO build-time posture flag. tauri-bundler invokes makensis
  with no `/D` defines and `NsisConfig` has no defines field, so a
  `!ifdef`-based posture branch would be unreachable code. That is why the
  probe reads the produced artifact itself.
- Installer writes `release-posture.txt` into the install dir naming the
  posture the installed release carried (`NSIS_HOOK_POSTINSTALL`).
- `scripts/package-windows/verify-signature.ps1` + `verify-signature.mjs` — native
  probe (Get-AuthenticodeSignature) + cross-platform policy engine. An
  unsigned/unverifiable artifact is never reported as trusted.
- `scripts/package-windows/nsis-policy-audit.mjs` — release-posture audit of the
  NSIS hooks file (runtime-probe contract) and the `bundle.windows` signing
  fragment.

## SmartScreen guidance for unsigned Candice installs (interim users)

Until an Authenticode identity exists:

1. The installer shows "Unknown publisher" and SmartScreen may block it.
2. Do **not** instruct customers to disable SmartScreen or bypass the warning
   as the normal path.
3. Documented interim path for internal/operator testing only: use
   "More info → Run anyway" on the operator's own machine, or distribute via
   a channel that marks the file (e.g. controlled download with a recorded
   SHA-256 in the component manifest — WS-33 owns that manifest).
4. The moment signing credentials are available, the release pipeline flips
   the posture to SIGNED (certificateThumbprint + signtool/signCommand pass),
   the install-time probe stamps SIGNED from the validated signature, and
   `verify-signature.ps1` re-verifies before any signed artifact is
   distributed. No build flag exists to set the posture — it is always the
   probed state of the produced artifact.

## What unblocks the signed posture

A production Authenticode certificate (code-signing, SHA-256 digest) for
`BlackCEO`:

- `bundle.windows.certificateThumbprint` = SHA-1 thumbprint (40 hex chars),
  plus `digestAlgorithm: "sha256"` and a `timestampUrl` (e.g.
  `http://timestamp.digicert.com`), applied to `tauri.conf.json` by the
  integration owner at fan-in (9.4 class 2 — this lane only ships the
  fragment proposal, see `TAURI-SIGNING-FRAGMENT.md`).
- CI/Windows builder with signtool from the Windows SDK (default Tauri path),
  or `signCommand` for osslsigncode cross-signing on macOS/Linux lanes.

External blocker classification: **missing production signing credentials is
an external release-distribution blocker** (Master Spec 0.3/23). It does not
block implementation, CI builds, or interactive Windows validation of the
unsigned installer; it blocks labeling a Candice Windows release as
"trusted."

## Verification evidence (current tree, run 2026-08-21 on macOS Apple Silicon)

```
$ node scripts/package-windows/verify-signature.mjs self-test
verify-signature.mjs self-test: all fixtures pass

$ node scripts/package-windows/verify-signature.mjs check --input-json '{"file":"x.exe","status":"NotSigned"}'
# exit 1, reason: UNSIGNED_NO_LIMITATION_RECORD   (correct — no marker passed)

$ node scripts/package-windows/verify-signature.mjs check --input-json '{"file":"x.exe","status":"NotSigned"}' --limitation-marker scripts/package-windows/SIGNING-STATUS.md
# exit 0, reason: UNSIGNED_WITH_RECORDED_LIMITATION  (correct — this file exists)

$ node scripts/package-windows/nsis-policy-audit.mjs scripts/package-windows/installerHooks.nsh
# exit 0; markers: NOT-SIGNED present, SIGNED absent, SIGNING-PENDING notice emitted
```

## Handoff note

No commit made (per dispatch instruction). Files sit in the worktree on
branch `candice/wr001-bootstrap` under the owned glob
`apps/candice-companion/scripts/package-windows/**` (relocated here
2026-08-21 from the pre-pin `packaging/windows/**` +
`src-tauri/windows/**`; pre-move copies in
`CONTROL/backup-ws29-windows-relocation-20260821/`). Any change to the marker
strings must be coordinated via CROSS-LANE-FINDING, never silently reworded.
