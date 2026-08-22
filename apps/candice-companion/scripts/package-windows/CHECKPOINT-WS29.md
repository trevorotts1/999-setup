# WS-29 Checkpoint — Windows packaging/signing/SmartScreen path

**Builder:** B-WR-024-WS-29 (opus/max)
**Run:** first Candice production fan-out, slice WR-024, workstream WS-29
**Branch/worktree:** `candice/wr001-bootstrap` @ `aa23ed9` (base `6bb00ec`)
**Date:** 2026-08-21
**Status:** BUILT — awaiting independent QC verdict (no commit made, per dispatch instruction)

## Owned globs (PROJECT-MANIFEST 9.2, WR-016 row)

- `apps/candice-companion/scripts/package-windows/**`

The pinned glob did not exist at dispatch; all files below are new.
See RELOCATION-FIX 2026-08-21 at the end of this checkpoint: the lane was
originally built at `packaging/windows/**` + `src-tauri/windows/**` and was
moved into the pinned glob by the ownership fixer.

## Files created

| File | Purpose |
|---|---|
| `scripts/package-windows/installerHooks.nsh` | NSIS installer-hooks file (Tauri 2 `bundle.windows.nsis.installerHooks` contract — Tauri INCLUDEs it into its own generated installer script; a custom template is deliberately NOT used). Posture = install-time RUNTIME probe: `NSIS_HOOK_POSTINSTALL` calls WinVerifyTrust (System plugin, bundled with makensis) against `$INSTDIR\${MAINBINARYNAME}.exe` — the app exe Tauri's signing pass signs after makensis runs — and stamps `release-posture.txt` with the PROBED state: SIGNED only on a validated signature, NOT-SIGNED on every other outcome (fail closed). No build-time posture flag exists (makensis gets no `/D` defines; `NsisConfig` has no defines field — verified against tauri-bundler 2.11.5). `SIGNING-PENDING` placeholder kept so the release gate fails closed until credentials exist |
| `scripts/package-windows/verify-signature.mjs` | Cross-platform Authenticode policy engine (deterministic Node; exit 0 = signed+valid OR unsigned-with-recorded-limitation; 1 = unsigned-no-record or invalid signature; 2 = usage error; never reports unsigned as trusted; `self-test` fixture command) |
| `scripts/package-windows/verify-signature.ps1` | Native PS 5.1 probe: `Get-AuthenticodeSignature` → JSON report → pipes to the policy engine; honest no-Node fallback; CMD-invocable per the 0.3 matrix |
| `scripts/package-windows/nsis-policy-audit.mjs` | Release-posture audit of the NSIS hooks-file markers + `bundle.windows.certificateThumbprint` fragment shape (40-hex SHA-1); fails closed on ambiguous/absent posture |
| `scripts/package-windows/SIGNING-STATUS.md` | **The operator-recorded limitation file** (E.1 WS-29 pass path B). Records: no Authenticode credentials → unsigned posture; SmartScreen expectation; interim user guidance (never "disable SmartScreen" as the normal path); what unblocks signing; external-blocker classification |
| `scripts/package-windows/TAURI-SIGNING-FRAGMENT.md` | `bundle.windows` signing fragment PROPOSAL (tauri.conf.json is 9.4 class 2 — integration owner applies at fan-in) |
| `scripts/package-windows/README.md` | Lane doc: pipeline diagram, commands, gate matrix, who runs what on which OS |

## Verification evidence (run locally on macOS Apple Silicon, Node v26.7.0)

```
$ node scripts/package-windows/verify-signature.mjs self-test
verify-signature.mjs self-test: all fixtures pass

$ node scripts/package-windows/verify-signature.mjs check --input-json '{"file":"x.exe","status":"Valid"}'
# exit 0  -> SIGNED_VALID

$ node scripts/package-windows/verify-signature.mjs check --input-json '{"file":"x.exe","status":"NotSigned"}'
# exit 1  -> UNSIGNED_NO_LIMITATION_RECORD (correct: no marker passed)

$ node scripts/package-windows/verify-signature.mjs check --input-json '{"file":"x.exe","status":"NotSigned"}' --limitation-marker scripts/package-windows/SIGNING-STATUS.md
# exit 0  -> UNSIGNED_WITH_RECORDED_LIMITATION (correct: this file exists)

$ node scripts/package-windows/verify-signature.mjs check --input-json '{"file":"x.exe","status":"HashMismatch"}' --limitation-marker scripts/package-windows/SIGNING-STATUS.md
# exit 1  -> SIGNED_INVALID (limitation never excuses a broken signature)

$ node scripts/package-windows/nsis-policy-audit.mjs scripts/package-windows/installerHooks.nsh
# markers: NOT-SIGNED present, SIGNED absent, SIGNING-PENDING notice emitted; exit 0
```

Exit codes checked with `echo $?` after each run; `verify-signature.ps1`
cannot execute on this macOS host (no pwsh; PS 5.1 target). The .ps1 is
syntax-reviewed by inspection and flagged for the interactive Windows
validation lane (CROSS-LANE-FINDING below).

## Cross-lane findings

- **CROSS-LANE-FINDING (WS-29 → integration owner):** WS-29 acceptance at the
  product level requires the actual installer artifact to be Authenticode-
  signed OR carry the recorded limitation. This lane ships the signing
  fragment PROPOSAL (`TAURI-SIGNING-FRAGMENT.md`) for
  `tauri.conf.json` `bundle.windows` (9.4 class 2 — version fields/manifests
  are integration-owned). Without signing credentials the E.1 pass depends on
  the fragment being applied AND `SIGNING-STATUS.md` surviving into the
  release tree. Handoff is mandatory, not optional.
- **CROSS-LANE-FINDING (WS-29 → WR-046/CI owner):** `.github/workflows/**` is
  9.4 class 4. The Windows release job needs, at fan-in: Windows runner,
  `certificateThumbprint` injected via CI secret, signtool path (Windows SDK)
  or `signCommand`, and a verify step calling
  `verify-signature.ps1` on the produced exe + installer. This lane does not
  write CI; the CI fragment is proposed in `TAURI-SIGNING-FRAGMENT.md`.
- **CROSS-LANE-FINDING (WS-29 → interactive Windows validation / WS-46):**
  no pwsh on this builder host; `verify-signature.ps1` is untested at
  runtime. The interactive Windows 10/11 desktop lane (spec 18/27) must run
  `verify-signature.ps1` against a real unsigned setup exe and confirm:
  exit 1 without marker, exit 0 with `SIGNING-STATUS.md`, `NotSigned`
  status string, SmartScreen "Unknown publisher" behavior observed on an
  unsigned install. Until then the .ps1 carries inspection-only evidence.
- **CROSS-LANE-FINDING (WS-29 → WS-33 updater):** `release-posture.txt`
  written into the install dir (per-user install to
  `%LOCALAPPDATA%\BlackCEO\999\Candice\`) is a contract for the WS-33
  updater: the updater should read it before self-updating so it never
  silently replaces a signed release with an unsigned one (downgrade posture
  protection). WS-33 owns the update code; this lane owns the file's
  existence and format.

## Handoff note

No commit made (per dispatch instruction). Files sit in the worktree at
`apps/candice-companion/scripts/package-windows/**` on branch
`candice/wr001-bootstrap` (RELOCATION-FIX 2026-08-21: moved here from the
pre-pin `packaging/windows/**` + `src-tauri/windows/**`). Marker strings are
a stable contract across
`installerHooks.nsh`, `verify-signature.mjs`, `verify-signature.ps1`,
`nsis-policy-audit.mjs`, and `SIGNING-STATUS.md`; any drift must flow through
CROSS-LANE-FINDING, never silent rewording.

---

## QC blind verdict 2026-08-21 (QC-Q-WS-29, independent sonnet/max): FAIL — fixed, FRESH RECHECK REQUIRED

Pre-fix backup: `.qc-backup-ws29-20260821/` (structure preserved).

QC findings (all fixed in this worktree; no commit made):

1. **`nsis-policy-audit.mjs` macro regexes were dead code — exit 0 in the
   checkpoint was not reproducible.** The `!macro <NAME>` open regexes used
   `(?:[ \t]|$)` without the `m` flag, so `$` never matched end-of-line and
   every `!macro NSIS_HOOK_*` line (which ends with `\n`) failed to match;
   a real hooks file audited as exit 1 "macro not defined". Fixed: `m` flag
   on the open regexes; per-macro close check now scans open-index to
   next-open-index for `!macroend`. Re-verified: audit of
   `installerHooks.nsh` exits 0 (UNSIGNED posture + SIGNING-PENDING notice);
   negative control (hooks file with no macros) exits 1.
2. **Docs/fragment pointed at `installer.nsi` which does not exist.** Prior
   QC fix converted the empty-shell template to `installerHooks.nsh`, but
   README.md, SIGNING-STATUS.md, TAURI-SIGNING-FRAGMENT.md, and this
   checkpoint still referenced `installer.nsi` and `nsis.template` (those
   references are now fixed; the only surviving occurrences are the
   forbidden-core-token patterns in `nsis-policy-audit.mjs`, which is
   intentional — that audit rejects hooks files that re-declare core-script
   responsibilities).
   Fixed: fragment now proposes `bundle.windows.nsis.installerHooks:
   "../scripts/package-windows/installerHooks.nsh"` (post-relocation path —
   the hooks file moved out of `src-tauri/windows/` 2026-08-21); all docs
   updated to the hooks mechanism.
3. **Evidence-of-tests incomplete for the policy engine.** Only `self-test`
   and one check-path were evidenced. Re-run and re-verified the full gate
   matrix: SIGNED_VALID exit 0; UNSIGNED_NO_LIMITATION_RECORD exit 1;
   UNSIGNED_WITH_RECORDED_LIMITATION exit 0; SIGNED_INVALID exit 1.
4. **Interactive Windows validation still pending (pre-existing, not
   fixed).** `verify-signature.ps1` cannot run on macOS (no pwsh). This
   remains the WS-46 / interactive Windows lane item; documented above.

FRESH RECHECK REQUIRED by an independent sonnet/max QC agent per QC lifecycle.

---

## QC fresh-recheck verdict 2026-08-21 (QC-Q-WS-29, independent sonnet/max): FAIL — fixed, FRESH RECHECK REQUIRED

Pre-fix backup: `.qc-backup-ws29-20260821-fresh/` (worktree root; the 4 edited files).

Prior QC items 1-3 re-verified against live disk state: the `m`-flag regex
fix is present (`nsis-policy-audit.mjs` lines 154/158), the
`installer.nsi`/`nsis.template` references are reduced to intentional
commentary only, and the full gate matrix reproduces with correct exit
codes. Those three items are CONFIRMED FIXED.

One new release-gate defect found and fixed by this unit:

1. **`verify-signature.mjs` failed open on unrecognized probe statuses.**
   `classify()` returned label `UNKNOWN` for any status string outside the
   known sets, and `verdict()` treated UNKNOWN as unsigned — so with
   `SIGNING-STATUS.md` present, the gate exited 0 for unverifiable
   artifacts. Two real PowerShell 5.1 `SignatureStatus` enum values were
   not in the INVALID set (`NotSupportedFileFormat`, `Incompatible`), and
   arbitrary garbage statuses passed too. Reproduced before fix:
   `NotSupportedFileFormat`, `Incompatible`, and `BogusStatus` each exited
   0 with the marker present. Fixed: `NotSupportedFileFormat` and
   `Incompatible` added to `INVALID_STATUSES`; `verdict()` now returns
   `UNVERIFIABLE` exit 1 for any `UNKNOWN` label regardless of the marker
   (the recorded-limitation path applies only to a known-unsigned
   `NotSigned` probe); self-test extended with
   `NotSupportedFileFormat`/`Incompatible`/`BogusStatus`-with-record/
   empty-status cases. Re-verified after fix: self-test exit 0; full
   matrix — Valid 0, NotSigned-no-marker 1, NotSigned+marker 0,
   HashMismatch+marker 1, NotSupportedFileFormat+marker 1,
   Incompatible+marker 1, BogusStatus+marker 1, BogusStatus-no-marker 1.

2. **Docs updated to the fail-closed contract:** `README.md` gate matrix
   gains the `UNVERIFIABLE` row (exit 1 even with a marker).

Not touched by this fix (recorded, unchanged): the interactive Windows
validation lane item (`verify-signature.ps1` runtime testing on a real
Windows 10/11 desktop remains WS-46 / interactive-lane work), and the
cross-lane handoffs (tauri.conf.json fragment application, CI fragment,
WS-33 updater contract).

FRESH RECHECK REQUIRED by an independent sonnet/max QC agent per QC lifecycle.

---

## QC blind verdict 2026-08-21 (QC-Q-WS-29 round 3, independent sonnet/max): FAIL — fixed, FRESH RECHECK REQUIRED

Pre-fix backup: `.qc-backup-ws29-qc3-20260821/` (worktree root; 6 edited files).

Prior rounds 1-2 items re-verified against live disk state: CONFIRMED FIXED —
`verify-signature.mjs` fail-open UNKNOWN defect closed (UNVERIFIABLE exit 1
regardless of marker; full matrix reproduces: Valid 0, NotSigned 1,
NotSigned+marker 0, HashMismatch+marker 1, Bogus+marker 1), `m`-flag regex
fix live, stale installer.nsi/nsis.template references reduced to
intentional commentary.

New release-gate defect found and fixed by this unit:

1. **The claimed SIGNED posture mechanism does not exist in Tauri.**
   `installerHooks.nsh` branched on `!ifdef CANDICE_SIGNED_RELEASE` and docs
   claimed "the release pipeline defines CANDICE_SIGNED_RELEASE". Verified
   against live tauri-bundler 2.11.5 sources (crates/tauri-bundler/src/
   bundle/windows/nsis/mod.rs + installer.nsi, and tauri-utils config.rs):
   makensis is invoked with NO `/D` flags, `NsisConfig` has no defines
   field, and the hooks file is `!include`d verbatim — so NO pipeline can
   ever define that flag and the SIGNED branch was unreachable dead code.
   Fixed: hooks file rewritten to a RUNTIME posture probe —
   `NSIS_HOOK_POSTINSTALL` calls `WinVerifyTrust` (WINTRUST_ACTION_GENERIC_
   VERIFY_V2) via the System plugin (bundled with every makensis) against
   `$INSTDIR\${MAINBINARYNAME}.exe` (the app exe Tauri's signing pass signs
   after makensis runs), and stamps `release-posture.txt` with the PROBED
   state: SIGNED literal written ONLY on a validated signature
   (StrCmp-$0-0 branch); every other outcome — unsigned, untrusted,
   unverifiable, file missing — writes NOT-SIGNED. A broken probe fails
   closed, never to SIGNED.
2. **`nsis-policy-audit.mjs` enforced the dead branch structure.** Rewritten
   to enforce the runtime-probe contract: both posture literals required;
   exactly one real `System::Call 'wintrust::WinVerifyTrust` probe call
   (comments don't count); SIGNED literal reachable ONLY via the
   StrCmp-$0-0 validated branch; NOT-SIGNED written on the non-validated
   path; probe result consumed. Negative fixtures verified: unconditional
   SIGNED write exit 1, no-probe-with-SIGNED exit 1, no-macros exit 1,
   fake-thumbprint exit 1. Positive: live hooks file exit 0 (with
   SIGNING-PENDING notice), + tauri.conf.json (fragment absent, unsigned
   posture) exit 0.
3. **Docs corrected** (SIGNING-STATUS.md, TAURI-SIGNING-FRAGMENT.md,
   README.md, this checkpoint): all `CANDICE_SIGNED_RELEASE` / "pipeline
   defines" claims replaced with the runtime-probe mechanism; CI fragment
   now instructs CI reviewers to REJECT any step claiming to define a
   posture flag.

Recorded, not fixed by this unit (pre-existing / cross-lane):
- **Ownership drift (RESOLVED by RELOCATION-FIX 2026-08-21):** root +
  worktree manifests 9.2 WR-016 claim
  `apps/candice-companion/scripts/package-windows/**`; at the time of this QC
  round the live deliverable still sat at the pre-pin globs
  `packaging/windows/**` + `src-tauri/windows/**`, claimed by no manifest row.
  The ownership fixer has since relocated the full lane into the pinned glob
  (pre-move copies in `CONTROL/backup-ws29-windows-relocation-20260821/`,
  byte-identical verified).
- `verify-signature.ps1` runtime test on real Windows (WS-46 / interactive
  lane) — unchanged.
- tauri.conf.json fragment application — 9.4 class 2, integration owner.
- install-time probe runtime validation (makensis build + real install on
  Windows) belongs to the WS-46 interactive lane.

Post-fix evidence (run 2026-08-21, macOS Apple Silicon, Node v26.7.0):
self-test exit 0; audit exit 0 (hooks only and hooks+conf); full
verify-signature matrix above; 4/4 negative audit fixtures exit 1.

FRESH RECHECK REQUIRED by an independent sonnet/max QC agent per QC lifecycle
(0J box-flip rule — this QC fixed the unit it failed).

---

## RELOCATION-FIX 2026-08-21 (ownership repair, sonnet/max fixer, authority ruling applied)

Authority ruling: `apps/candice-companion/scripts/package-windows/**` is the
WS-29 owned path (PROJECT-MANIFEST 9.2 WR-016 row; CONTROL/task-graph-snapshot.json
WS-29 owned_paths pin `apps/candice-companion/scripts/package-windows/`).
The lane had been built at the pre-pin globs `packaging/windows/**` +
`src-tauri/windows/**`, which no manifest row granted. WS-23 sibling precedent:
same defect class, same repair (full relocation into `scripts/package-macos/**`,
headers re-cited, old dirs deleted).

Fix applied (backup `CONTROL/backup-ws29-windows-relocation-20260821/` at
worktree root, pre-move copies verified byte-identical via `diff -r` before
any move):

1. **Relocation.** All 8 lane files moved into the pinned glob
   `apps/candice-companion/scripts/package-windows/**` — the 7 files from
   `packaging/windows/**` plus `installerHooks.nsh` from `src-tauri/windows/`.
   Both pre-pin directories deleted; `apps/candice-companion/packaging/`
   removed entirely (its only content was the WS-29 lane). Nothing remains
   in the WR-012 exclusion list's `windows/**` slot under `src-tauri/`, so
   no manifest row amendment is needed (resolution branch: relocate fully).
2. **Provenance citations.** All 8 lane file headers now cite
   `apps/candice-companion/scripts/package-windows/**` (PROJECT-MANIFEST 9.2,
   WR-016 row, WS-29 glob; snapshot owned_paths pin); internal invocations
   and paths inside the scripts/README/fragment/checkpoint rewritten from
   the pre-pin paths to `scripts/package-windows/`.
3. **Fragment path re-derived.** `TAURI-SIGNING-FRAGMENT.md` now proposes
   `bundle.windows.nsis.installerHooks: "../scripts/package-windows/installerHooks.nsh"`
   (Tauri resolves installerHooks relative to `src-tauri/`, so the path
   steps up one level now that the hooks file lives outside `src-tauri/`).
   The fragment remains PROPOSAL ONLY — tauri.conf.json stays 9.4 class 2,
   never edited by this lane.
4. **Post-relocation verification (run at the new path 2026-08-21, macOS
   Apple Silicon, Node v26.7.0):**
   - `node scripts/package-windows/verify-signature.mjs self-test` — exit 0,
     all fixtures pass.
   - `node scripts/package-windows/verify-signature.mjs check --input-json
     '{"file":"x.exe","status":"NotSigned"}' --limitation-marker
     scripts/package-windows/SIGNING-STATUS.md` — exit 0,
     UNSIGNED_WITH_RECORDED_LIMITATION.
   - `node scripts/package-windows/nsis-policy-audit.mjs
     scripts/package-windows/installerHooks.nsh` — exit 0 (SIGNING-PENDING
     notice emitted, expected interim state).

FRESH RECHECK REQUIRED by an independent sonnet/max QC agent per QC lifecycle.
