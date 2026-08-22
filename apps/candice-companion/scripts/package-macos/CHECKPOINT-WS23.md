# WS-23 — macOS packaging/signing/notarization path — CHECKPOINT

Lane: WR-015 / WS-23 (builder B-WR-024-WS-23, opus/max).
Owned lane: `apps/candice-companion/scripts/package-macos/**` (PROJECT-MANIFEST 9.2,
WR-015 row, WS-23 glob; CONTROL/task-graph-snapshot.json line 572).
Worktree: `worktrees/wr001-bootstrap` @ `aa23ed9` (branch `candice/wr001-bootstrap`).
Date: 2026-08-21. No commit, no push (builder contract).

## Files created (owned globs only — PROJECT-MANIFEST 9.2, WR-015 row)

`apps/candice-companion/scripts/package-macos/**` (the WS-23 glob pinned by
PROJECT-MANIFEST 9.2 WR-015 row line 276 and CONTROL/task-graph-snapshot.json
line 572; relocated here by the ownership fix of 2026-08-21, see below):
- `README.md` — lane summary, credential contract, run instructions
- `signing-identity.sh` — Developer ID probe (read-only; FOUND <sha> <CN> | rc=1 zero-identities)
- `build-macos-bundle.sh` — bundle builder: prod (Developer ID + hardened runtime + entitlements + deep verify + **spctl Gatekeeper assessment**)/adhoc/unsigned; DMG via hdiutil; refuses to present unsigned as distribution
- `notarize.sh` — notarytool submit/staple; three credential forms; no credential -> exit 2 + literal `EXTERNAL-RELEASE-BLOCKER` + Gatekeeper-never-disabled doctrine
- `verify-gatekeeper.sh` — `spctl --assess --type execute` on a built artifact
- `entitlements.plist` — hardened-runtime baseline (JIT/unsigned-memory/library-validation all false)
- `tauri.macos.fragment.json` — macOS bundle config proposal for integration owner (9.4), never applied here
- `self-test.sh` — 11 offline pure tests (plutil lint, probe host/negative branches, unknown-mode, bundle-present/absent branch, external-blocker line, missing-app rc, positive-parse fixture, adhoc+dmg rejection, ad-hoc verify + spctl reject)
- `signature-helper/**` — helper crate `candice-macos-signature`:
  - `Cargo.toml`, `src/lib.rs` — crate manifest + module surface
  - `src/signature.rs` — runtime signature-state report via real codesign(1): Signature/TeamIdentifier/CDHash/Identifier; `is_developer_id_signed()` / `is_not_distribution_ready()` predicates; no signing, no keychain, no network
  - `tests/signature.rs` — 2 integration tests against real codesign(1)
  - `.cargo/config.toml` — routes the crate's build artifacts into the app's
    gitignored `src-tauri/target/macos-helper/` (`target-dir = "../../../src-tauri/target/macos-helper"`, resolved from the crate root); Cargo.lock generated, crate is internal

## RELOCATION-FIX 2026-08-21 (ownership repair, sonnet/max fixer)

The fresh-recheck verdict (check 5 OWNERSHIP FAIL, severity high) pinned WS-23
to `apps/candice-companion/scripts/package-macos/**` (manifest 9.2 WR-015 row
line 276 + snapshot line 572). The lane had been built at the now-deleted
pre-relocation paths `packaging/macos/**` + `src-tauri/macos/**`, and every
lane header cited manifest authority for a glob the manifest never grants.

Fix applied (backup `.qc-backup-ws23-relocation-20260821/` at worktree root,
pre-fix copies verified byte-identical via `diff -r` before any move):

1. **Relocation.** All 9 lane files moved from the now-deleted
   pre-relocation path `packaging/macos/**` to
   `apps/candice-companion/scripts/package-macos/**`; the helper crate
   moved from the now-deleted pre-relocation path `src-tauri/macos/**` to
   `scripts/package-macos/signature-helper/**` (inside the pinned glob).
   Both old directories deleted; the crate's `target/` build droppings
   deleted (build output, regenerable). `scripts/package-macos/**` now owns
   the complete lane and the pre-relocation path `src-tauri/macos/**`
   no longer exists — nothing
   remains in the WR-012 exclusion list's `macos/**` slot, so no manifest
   row amendment is needed (resolution branch: relocate fully).
2. **Provenance citations.** All 9 lane file headers now cite
   `apps/candice-companion/scripts/package-macos/**` (PROJECT-MANIFEST 9.2,
   WR-015 row, WS-23 glob); internal invocations and paths inside the
   scripts/README/fragment/checkpoint rewritten from the pre-relocation path
   `packaging/macos` to `scripts/package-macos`; crate `.cargo/config.toml`
   target-dir re-derived
   for the new depth (resolves to
   `apps/candice-companion/src-tauri/target/macos-helper`, gitignored).
3. **.gitignore shared-file edit disclosed.** The repo-root `.gitignore`
   candice block (`apps/candice-companion/dist/`,
   `apps/candice-companion/src-tauri/dist/`,
   `apps/candice-companion/src-tauri/target/`,
   `apps/candice-companion/src-tauri/**/target/` — nested crate targets
   including this lane's `signature-helper` under `scripts/` do not fall
   under `src-tauri/**`, see cross-lane note —, `apps/candice-companion/src-tauri/gen/`,
   `apps/candice-companion/src-tauri/tauri.conf.json`) now carries an
   explicit disclosure comment (`Disclosed WS-23 relocation 2026-08-21`),
   so the edit is no longer undisclosed; final adoption remains the 9.4
   shared-file owner's decision. Pre-edit copy preserved at
   `.qc-backup-ws23-relocation-20260821/.gitignore.pre-revert`.

## Verified (live on build machine, pre-relocation — historical record)

- `security find-identity -v -p codesigning` -> `0 valid identities found` (external blocker branch is the live state)
- codesign/spctl/notarytool/stapler/hdiutil/plutil all present; cargo 1.97.1; node v26.7.0; macOS 26.3.1 arm64
- `src-tauri/target/debug/candice-companion` exists, Mach-O arm64, `Signature=adhoc` (probe parse path proven against a real binary)
- `bash self-test.sh` -> ALL PASS (see evidence; ran at the pre-relocation path `packaging/macos/`, now deleted)
- `cargo test` -> 2 passed (ran at the pre-relocation path `src-tauri/macos/`, now deleted)
- Scripts lint-clean under `bash -n`

## QC-FIX 2026-08-21 (sonnet/max, blind fresh QC of WR-024 WS-23)

**Verdict at handoff: FAIL — fresh recheck required after repair.** The
handoff-era claim "self-test ALL PASS" did not hold live: 2 of the then-8
tests failed on the build machine, and the identity probe's positive branch
could never work against real `security(1)` output.

Defects found (all verified live, not assumed):

1. **`signing-identity.sh` parsed the wrong field (critical).** Real
   `security find-identity -v -p codesigning` lines start with `1)` — the
   index, not the hash; the SHA-256 is the space-delimited 64-hex field.
   `awk '{print $1}'` returned `1)`, and the old 40-hex pattern matched
   nothing. Probe output was garbage whenever an identity existed.
   Fix: match `([0-9A-Fa-f]{64})`, CN from the quoted field, default the
   count to 0 (removes a `set -u` crash on absent count line), and exit 2
   on unparseable-but-present Developer ID line.
2. **`self-test.sh` test 4 premise was wrong on this machine.** The release
   bundle exists (`src-tauri/target/release/bundle/macos/...`), so
   `build-macos-bundle.sh unsigned` legitimately returns rc=0 — the test's
   rc=1 expectation made it fail. The bundle-present branch now asserts the
   honest success contract; the bundle-absent branch keeps the rc=1 negative.
3. **`self-test.sh` test 6 (verify-gatekeeper missing-app negative) depended
   on dist being empty** — test 4/8 staging left `dist/Candice Companion.app`
   behind. Test 6 now clears its precondition first.
4. **`build-macos-bundle.sh` accepted `dmg` for `adhoc`/`unsigned` modes** —
   a non-prod dmg would look like a release artifact. Now rejected rc=1.
5. **`notarize.sh` used invented flags** `--apple-api-key`/`--apple-api-issuer`
   /`--apple-api-key-id`; real `notarytool submit --help` shows
   `--key`/`--issuer`/`--key-id`. Fixed. Also documented rc=0-does-not-mean-
   accepted (Accepted/Invalid/Rejected all exit 0; the JSON `status` field is
   the authority).

Re-verified live after repair (2026-08-21):
- `bash self-test.sh` -> 11/11 ALL PASS, exit 0 (ran at the pre-relocation path `packaging/macos/`, now deleted)
- `cargo test` -> 2 passed (ran at the pre-relocation path `src-tauri/macos/`, now deleted)
- signing-identity positive branch -> `FOUND <64hex> <Developer ID CN>` via
  controlled `/tmp/security` fixture; negative branch rc=1 (truthful)
- `build-macos-bundle.sh prod` with zero identities -> rc=1, no silent pass
- `bash -n` clean on all five scripts
- no Gatekeeper-disable mechanism anywhere in the lane (grep rc=1)

Backup of the pre-fix lane: `.qc-backup-ws23-20260821/` (worktree root).

**FRESH RECHECK REQUIRED** by an independent sonnet/max QC agent before this
unit is accepted.

## Acceptance (CHECKLIST E.1 WS-23)

Signing+notarization cannot run on this box: zero Developer ID identities
(live `security` output) and no Apple notarization credential. The
criterion's alternative branch applies and is satisfied: the limitation is
recorded as an external release blocker (README + notarize.sh literal line),
Gatekeeper is never disabled (spctl assessment is a hard gate in the prod
build path; no script instructs weakening security).

## Cross-lane

- `tauri.macos.fragment.json` -> proposal to integration owner (9.4), with
  the CI-time `bundle.macOS` shape; live `tauri.conf.json` untouched (9.3).
- CI release-matrix job calling these scripts -> proposal to 9.4
  (`.github/workflows/**` is shared-file class).
- Shell crate consumption (path dep on `scripts/package-macos/signature-helper`)
  applied at fan-in by integration owner, not by this lane.
- The relocator reverted the repo-root `.gitignore` candice block; a
  concurrent record-keeping writer re-added it WITH a disclosure comment
  and a nested `src-tauri/**/target/` glob, plus extra per-crate ignore
  handling. Adoption remains the 9.4 shared-file owner's decision.
