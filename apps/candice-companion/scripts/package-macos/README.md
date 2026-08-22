# WS-23 — macOS packaging/signing/notarization path

Owned lane: `apps/candice-companion/scripts/package-macos/**`
(scripts + `signature-helper/` crate) (PROJECT-MANIFEST 9.2, WR-015
row, WS-23 glob). Apple Silicon reference platform (Master Spec 0.3: macOS
is the reference/default customer path; spec 23).

## What is proven (CHECKLIST E.1 WS-23)

> WS-23 PASS: macOS artifact signed with Developer ID + notarized +
> Gatekeeper-accepted, **or the missing-credentials limitation is recorded
> as an external release blocker (Gatekeeper never disabled).**

This lane delivers the complete production path AND the truthful
no-credential branch. Credentials are late-bound release inputs (Master
Spec status: "production signing credentials" are a remaining late-bound
input); the machine under build has **zero** Developer ID identities in its
login keychain, so the acceptance criterion's alternative branch is the one
that applies on this box — and it is enforced, not assumed:

1. **Signing** — `scripts/package-macos/build-macos-bundle.sh` in three modes:
   - `prod`: Developer ID Application identity (auto-probed from the
     keychain or `APPLE_DEVELOPER_IDENTITY`), hardened runtime on,
     `--timestamp`, entitlements applied, deep verify, then the
     **spctl Gatekeeper assessment** — the same mechanism Gatekeeper uses
     at launch. spctl failure = exit 1 = build failure, never a silent
     pass.
   - `adhoc` / `unsigned`: local smoke only; the script refuses to present
     them as distribution artifacts and never copies them out of `dist/`.
   - A tauri.conf.json macOS fragment (`tauri.macos.fragment.json`) carries
     the CI-time `bundle.macOS` shape: minimumSystemVersion 12.0,
     hardenedRuntime true, entitlements path, DMG layout. It is a proposal
     fragment for the integration owner (9.4) — the live
     `tauri.conf.json` is in the within-run shared set (9.3) and is never
     edited by this lane.
2. **Notarization** — `scripts/package-macos/notarize.sh` via `notarytool`, with
   three accepted credential forms (keychain profile / App Store Connect
   API key files / Apple ID + app-specific password + team), bounded
   `--wait --timeout 20m` poll, staple on acceptance, full rejection log.
   **No credential configured -> exit 2 with the literal
   `EXTERNAL-RELEASE-BLOCKER` line** and the Gatekeeper-never-disabled
   doctrine (Master Spec 23).
3. **Gatekeeper verification** — `scripts/package-macos/verify-gatekeeper.sh`
   (`spctl --assess --type execute`), used by `build-macos-bundle.sh prod`
   and by release validation. Gatekeeper is never disabled, and no
   script instructs weakening security (Master Spec 23).
4. **Runtime truthfulness** — `scripts/package-macos/signature-helper` helper crate reports the
   running artifact's real signature state (Developer ID vs ad-hoc vs
   unsigned, TeamIdentifier, CDHash) so the app never misrepresents an
   unsigned artifact as trusted (spec 23 symmetric clause).
5. **Identity probe** — `scripts/package-macos/signing-identity.sh` reads
   `security find-identity -v -p codesigning` and prints
   `FOUND <sha256> <CN>` on success, or exits 1 with the truthful
   zero-identities diagnostic. Never prints credentials.

## Credential contract (this box, 2026-08-21)

- `security find-identity -v -p codesigning` -> `0 valid identities found`
  (verified live on the build machine).
- Apple toolchain present: codesign, spctl, notarytool, stapler,
  hdiutil, plutil all resolve (Xcode CLT at
  `/Library/Developer/CommandLineTools`).
- Therefore: **external release blocker** for Developer ID signing +
  notarization until an operator supplies credentials; Gatekeeper remains
  enforced. The acceptance criterion's alternative branch is satisfied by
  the recorded blocker and the enforced never-disable doctrine.

## Run

```bash
cd apps/candice-companion

# Offline self-tests (no credentials, no bundle required)
bash scripts/package-macos/self-test.sh

# Full build machine path (CI, or operator with credentials):
npm run tauri build
bash scripts/package-macos/build-macos-bundle.sh prod dmg
bash scripts/package-macos/notarize.sh          # exits 2 + blocker without creds
bash scripts/package-macos/verify-gatekeeper.sh "dist/Candice Companion.app"

# Rust helper tests
cargo test --manifest-path scripts/package-macos/signature-helper/Cargo.toml

# Ad-hoc local smoke (NOT distribution — Gatekeeper will reject)
bash scripts/package-macos/build-macos-bundle.sh adhoc
```

## Cross-lane surface

- `tauri.macos.fragment.json` -> proposal to integration owner (9.4).
- No edits to the live `tauri.conf.json` / `Cargo.toml` / lockfiles (9.3
  shared set) — the shell crate consumes this lane's helper via a path
  dependency applied at fan-in.
- CI wiring (`.github/workflows/**`) is 9.4 shared — the release-matrix
  job that calls these scripts is proposed, not applied, by this lane.
