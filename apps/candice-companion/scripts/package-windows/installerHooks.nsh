; ---------------------------------------------------------------------------
; Candice Companion — NSIS installer hooks (WS-29)
; Owned glob (PROJECT-MANIFEST 9.2, WR-016 row; snapshot owned_paths pin):
;   apps/candice-companion/scripts/package-windows/** — relocated here
;   2026-08-21 from src-tauri/windows/ (pre-move copy in
;   CONTROL/backup-ws29-windows-relocation-20260821/).
; Contract: tauri.conf.json -> bundle.windows.nsis.installerHooks ->
;   ../scripts/package-windows/installerHooks.nsh
;   (Tauri 2 INCLUDEs this file into its own generated installer script at
;   the "{{installer_hooks}}" line, ahead of all default sections. A custom
;   nsis.template is deliberately NOT used: it would REPLACE the entire
;   Tauri-generated script and with it the payload-copy, WebView2, shortcut,
;   and uninstall logic.)
;
; Posture mechanism — RUNTIME PROBE, NOT build-time define (QC round 3 fix):
;   tauri-bundler invokes makensis with NO /D flags and NsisConfig carries no
;   defines field, so no build pipeline can define a flag that this hooks
;   file could branch on. Any !ifdef-based "signed posture" branch here is
;   unreachable code. The only honest, buildable posture source is the
;   produced artifact itself:
;     - Tauri signs the app exe (${MAINBINARYNAME}.exe) and the setup exe
;       AFTER makensis runs, when an Authenticode identity is configured
;       (certificateThumbprint + signtool / signCommand).
;     - NSIS_HOOK_POSTINSTALL runs AFTER the default script has copied the
;       main binary into $INSTDIR, so $INSTDIR\${MAINBINARYNAME}.exe is the
;       real produced artifact at probe time.
;     - The hook probes that exe with WinVerifyTrust
;       (WINTRUST_ACTION_GENERIC_VERIFY_V2) via the System plugin (bundled
;       with every makensis distribution). Result 0 = signature validated;
;       any other HRESULT (0x800B0100 untrusted, 0x800B010E no signature,
;       missing file, ...) = NOT validated.
;     - release-posture.txt in $INSTDIR is stamped with the PROBED state:
;       the AUTHENTICODE-SIGNED literal is written ONLY when the probe
;       validated the signature. Every other outcome — unsigned, untrusted,
;       unverifiable, file missing — writes NOT-SIGNED. A broken probe can
;       never produce a trusted stamp; it fails closed.
;
; Signing posture (Master Spec 23, E.1 WS-29):
;   - An unsigned Candice installer is NEVER presented as trusted; SmartScreen
;     "Windows protected your PC" (Unknown publisher) is expected for
;     unsigned builds. Do not instruct customers to bypass that warning as
;     the normal install path.
;   - The interim release is unsigned-by-recorded-limitation
;     (scripts/package-windows/SIGNING-STATUS.md must exist for the release gate to
;     pass: scripts/package-windows/verify-signature.mjs). The produced artifact is
;     validated after build by scripts/package-windows/verify-signature.ps1 ->
;     verify-signature.mjs; signing itself is a late-bound external input
;     (production Authenticode credentials).
;   - Enforced by scripts/package-windows/nsis-policy-audit.mjs and
;     scripts/package-windows/verify-signature.mjs.
; ---------------------------------------------------------------------------

; ---------------------------------------------------------------------------
; Posture literals and stamp path — single definitions, exact strings. The
; policy engines and the WS-33 updater contract match these EXACT strings.
; Do not reword without updating
;   scripts/package-windows/nsis-policy-audit.mjs
;   scripts/package-windows/verify-signature.mjs
; and re-running their self-tests.
; ---------------------------------------------------------------------------
!define CANDICE_POSTURE_INSTALL_PATH     "$INSTDIR\release-posture.txt"

; ---------------------------------------------------------------------------
; Placeholder marker for the pre-credential interim state. The SIGNED
; posture exists as an honest runtime probe (never a build-time claim) while
; no credentials exist. nsis-policy-audit.mjs emits a NOTICE while this
; marker remains.
; ---------------------------------------------------------------------------
!define CANDICE_INSTALLER_SIGNING_PENDING

; ---------------------------------------------------------------------------
; PreInstall hook — runs at the TOP of the Tauri default "Section Install",
; BEFORE the default script copies the main binary and resources. Nothing
; posture-relevant happens before the binary copy; the probe runs in
; POSTINSTALL where $INSTDIR holds the final user-chosen install dir and the
; main binary is already copied.
; ---------------------------------------------------------------------------
!macro NSIS_HOOK_PREINSTALL
!macroend

; ---------------------------------------------------------------------------
; PostInstall hook — runs inside the default "Section Install" AFTER the
; default script copies the main binary and resources and creates shortcuts.
;
; Runtime posture probe:
;   $INSTDIR\${MAINBINARYNAME}.exe is the app exe Tauri's signing pass signs
;   (when an Authenticode identity exists). WinVerifyTrust checks its
;   signature state: $0 = 0 means validated, nonzero means unsigned or
;   untrusted or unreadable. The stamp below is therefore the PROBED state,
;   never a claim from a build step.
;
;   NOTE: this file must remain UTF-8; the \w specifier passes a UTF-16LE
;   path to the W API. Re-run scripts/package-windows/nsis-policy-audit.mjs after
;   any encoding change (a re-encoded file breaks the probe, which then
;   fails closed to NOT-SIGNED, never to SIGNED).
; ---------------------------------------------------------------------------
!macro NSIS_HOOK_POSTINSTALL
  ; Clear any prior stamp so an earlier unsigned install cannot leave a
  ; stale posture record behind.
  Delete "${CANDICE_POSTURE_INSTALL_PATH}"

  ; Probe the installed app exe's Authenticode signature.
  ;   i -1                  hwnd = INVALID_HANDLE_VALUE
  ;   *g {GUID}             WINTRUST_ACTION_GENERIC_VERIFY_V2
  ;   *w <path>             WINTRUST_DATA with the file path (dwUIChoice etc
  ;                         defaulted; NULL is the documented minimal form)
  ;   i .r0                 HRESULT into $0 (0 = trust validated)
  !define /ifndef _CANDICE_ACTION_GUID_V2 {00AAC56B-CD44-11D0-8CC2-00C04FC295EE}
  System::Call 'wintrust::WinVerifyTrust(i -1, *g _CANDICE_ACTION_GUID_V2, *w "$INSTDIR\${MAINBINARYNAME}.exe")i .r0'
  !undef _CANDICE_ACTION_GUID_V2

  ; Stamp the PROBED posture. The SIGNED literal is written ONLY on a
  ; validated signature; every other outcome writes NOT-SIGNED (unsigned or
  ; unverifiable — never trusted).
  StrCmp $0 0 0 candice_ws29_not_validated
    FileOpen $0 "${CANDICE_POSTURE_INSTALL_PATH}" w
    FileWrite $0 "CANDICE-INSTALLER-AUTHENTICODE-SIGNED"
    FileClose $0
    Goto candice_ws29_posture_done
candice_ws29_not_validated:
    ; Unsigned or unverifiable — honest NOT-SIGNED record (expected interim
    ; posture; SmartScreen "Unknown publisher" applies).
    FileOpen $0 "${CANDICE_POSTURE_INSTALL_PATH}" w
    FileWrite $0 "CANDICE-INSTALLER-NOT-SIGNED"
    FileClose $0
candice_ws29_posture_done:
!macroend

; ---------------------------------------------------------------------------
; PreUninstall hook — runs at the TOP of the default "Section Uninstall",
; BEFORE the default script deletes the main binary and resources.
; ---------------------------------------------------------------------------
!macro NSIS_HOOK_PREUNINSTALL
  ; The default script's own RmDir /r "$LOCALAPPDATA\${BUNDLEID}" already
  ; removes the install dir content (including release-posture.txt) on full
  ; uninstall; no extra pre-uninstall cleanup required at V1.
!macroend

; ---------------------------------------------------------------------------
; PostUninstall hook — runs at the END of the default "Section Uninstall".
; ---------------------------------------------------------------------------
!macro NSIS_HOOK_POSTUNINSTALL
  ; No post-uninstall cleanup required at V1.
!macroend
