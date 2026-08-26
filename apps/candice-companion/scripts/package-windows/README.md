# WS-29 — Windows packaging/signing/SmartScreen path

Lane doc for the Windows release-posture pipeline (owned glob:
`apps/candice-companion/scripts/package-windows/**` — PROJECT-MANIFEST 9.2
WR-016 row, WS-29 glob; CONTROL/task-graph-snapshot.json owned_paths pin;
relocated here 2026-08-21 from the pre-pin `packaging/windows/**` +
`src-tauri/windows/**`).

## Pipeline

```
tauri build (Windows runner)
   │  bundle.windows.certificateThumbprint set?   (fragment applied at fan-in)
   ├─ yes → signtool signs exe + NSIS setup exe (Tauri default on Windows)
   │         └─ verify-signature.ps1 → report.json → verify-signature.mjs → exit 0 (Valid)
   └─ no  → installer stays unsigned
             └─ SIGNING-STATUS.md (recorded limitation) → verify-signature.mjs → exit 0
   At install time (either case): NSIS_HOOK_POSTINSTALL probes the installed
   app exe with WinVerifyTrust (System plugin, bundled with makensis) and
   stamps release-posture.txt with the PROBED state — SIGNED only on a
   validated signature, NOT-SIGNED on every other outcome (fail closed).
   No build-time posture flag exists: makensis receives no /D defines and
   NsisConfig has no defines field, so the probe reads the artifact itself.
   Release gate: nsis-policy-audit.mjs validates the hooks-file runtime-probe
   contract before build; verify-signature.mjs validates the produced
   artifact after build.
```

## Files

| File | Runs on | Role |
|---|---|---|
| `scripts/package-windows/installerHooks.nsh` | NSIS (bundler) | Installer-hooks file (Tauri INCLUDEs it into its generated installer script via `bundle.windows.nsis.installerHooks`); install-time WinVerifyTrust posture probe; `release-posture.txt` stamp |
| `scripts/package-windows/verify-signature.mjs` | any Node (macOS/Windows CI) | Deterministic policy engine; exit-code contract; `self-test` |
| `scripts/package-windows/verify-signature.ps1` | Windows PowerShell 5.1+ | Native probe (`Get-AuthenticodeSignature`) → JSON → engine |
| `scripts/package-windows/nsis-policy-audit.mjs` | any Node | Hooks-file runtime-probe posture audit + signing-fragment shape audit |
| `scripts/package-windows/SIGNING-STATUS.md` | — | Operator-recorded limitation (E.1 WS-29 pass path B) |
| `scripts/package-windows/TAURI-SIGNING-FRAGMENT.md` | — | `bundle.windows` + CI fragment PROPOSALS (9.4 owners apply) |
| `scripts/package-windows/CHECKPOINT-WS29.md` | — | Builder checkpoint + cross-lane findings |
| `scripts/package-windows/README.md` | — | this file |

## Gate matrix (verify-signature.mjs)

| Artifact state | Marker | Exit | Verdict |
|---|---|---|---|
| Signed, signature valid | `CANDICE-INSTALLER-AUTHENTICODE-SIGNED` (stamped by install-time probe from a validated signature) | 0 | `SIGNED_VALID` |
| Unsigned, limitation recorded | `SIGNING-STATUS.md` exists | 0 | `UNSIGNED_WITH_RECORDED_LIMITATION` |
| Unsigned, no record | — | 1 | `UNSIGNED_NO_LIMITATION_RECORD` (refuse) |
| Signature present but invalid | — | 1 | `SIGNED_INVALID` (refuse, never excused) |
| Probe status unrecognized (unverifiable) | any | 1 | `UNVERIFIABLE` (refuse — fail closed even with a marker; a broken probe never passes the gate) |
| Node unavailable (PS fallback) | — | 1 | honest unverified report, never trusted |

## Commands

```sh
# self-test (no I/O)
node scripts/package-windows/verify-signature.mjs self-test

# verify an artifact report
node scripts/package-windows/verify-signature.mjs check --input-json '{"file":"x.exe","status":"NotSigned"}' \
  --limitation-marker scripts/package-windows/SIGNING-STATUS.md

# hooks-file runtime-probe posture audit
node scripts/package-windows/nsis-policy-audit.mjs scripts/package-windows/installerHooks.nsh

# native Windows probe (Windows only; PS 5.1 compatible, CMD-invocable)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File \
  apps\candice-companion\scripts\package-windows\verify-signature.ps1 -Path <setup.exe>
```

## Honesty contract (Master Spec 23, E.1 WS-29)

- An unsigned installer is never reported as trusted by any tool in this
  lane. SmartScreen "Windows protected your PC — Unknown publisher" is
  expected for unsigned builds; bypassing it is never documented as the
  normal install path.
- The current release is **unsigned by recorded limitation** until an
  Authenticode identity exists (external release-distribution blocker).
- The install-time posture stamp comes from a WinVerifyTrust probe of the
  produced artifact — the SIGNED literal is written only on a validated
  signature; every other outcome writes NOT-SIGNED (fail closed). There is
  no build-time posture flag: makensis receives no /D defines and
  NsisConfig has no defines field (verified against tauri-bundler 2.11.5).
- Marker strings are a cross-file contract; reword only via
  CROSS-LANE-FINDING.
