# Crate tree ownership and supply-chain audit record (FIX-023)

Date: 2026-08-22. Lane: FIX-023 implementation (dependency files). Source of
ownership: `spec/PROJECT-MANIFEST.md` section 9.2 rows (authoritative owned-glob
map). Tool: cargo-deny 0.20.2 (`cargo install cargo-deny --locked`), config
`deny.toml` at repository root, advisory DB `rustsec/advisory-db`.

## The seven Rust crate trees

| # | Manifest (`apps/candice-companion/`) | Crate | Owning lane (manifest 9.2) | Packages in lock |
|---|---|---|---|---|
| 1 | `src-tauri/Cargo.toml` | `candice-companion` | WR-012 candice-app-shell (`src-tauri/Cargo.toml`, root-level Tauri files only) | 451 |
| 2 | `src-tauri/audio/capture/Cargo.toml` | `candice-capture` | WR-014 candice-speech (WS-17, `audio/capture/**`) | 90 |
| 3 | `src-tauri/audio/capture-windows/Cargo.toml` | `candice-capture-windows` | WR-016 candice-windows (WS-28, `audio/capture-windows/**`) | 91 |
| 4 | `src-tauri/permissions/Cargo.toml` | `candice-macos-permissions` | WR-015 candice-macos (WS-22, `permissions/**`) | 31 |
| 5 | `src-tauri/binding/macos/Cargo.toml` | `candice-macos-binding` | WR-015 candice-macos (WS-21, `binding/macos/**`) | 21 |
| 6 | `src-tauri/binding/windows/Cargo.toml` | `candice-win32-bind` | WR-016 candice-windows (WS-26, `binding/windows/**`) | 16 |
| 7 | `scripts/package-macos/signature-helper/Cargo.toml` | `candice-macos-signature` | WR-015 candice-macos (WS-23, `package-macos/**`) | 8 |

`capture-windows` depends on `candice-capture` via `path = "../capture"`; its
lock pins that path dependency locally (see its CHECKPOINT note). No virtual
workspace exists; each tree resolves independently and each owns its lockfile.
`scripts/package-windows/` contains no Cargo crate (no Cargo.toml, no
Cargo.lock) — the audit-scan claim of a lockfile there is false.

## Lockfile reconciliation (2026-08-22)

`cargo update --dry-run` per manifest, then real `cargo update` where stale:

| Tree | Before | After | Action |
|---|---|---|---|
| `src-tauri` | log 0.4.33, uuid 1.24.1 | log 0.4.34, uuid 1.25.0 | updated |
| `audio/capture` | log 0.4.33 | log 0.4.34 | updated |
| `audio/capture-windows` | log 0.4.33 | log 0.4.34 | updated |
| `permissions` | — | — | already current |
| `binding/macos` | — | — | already current |
| `binding/windows` | — | — | already current |
| `signature-helper` | — | — | already current |

Verification: `cargo check --locked --manifest-path <tree>/Cargo.toml` passes
on all three updated trees (fresh target dirs). Updated lockfiles committed.

## cargo-deny gate (deny.toml)

`cargo deny check` (binary: `cargo-deny check --manifest-path <tree>/Cargo.toml`)
runs `advisories + bans + licenses + sources` per tree. Result 2026-08-22 —
all seven trees exit 0:

```text
src-tauri                          rc=0  advisories ok, bans ok, licenses ok, sources ok
src-tauri/audio/capture            rc=0  advisories ok, bans ok, licenses ok, sources ok
src-tauri/audio/capture-windows    rc=0  advisories ok, bans ok, licenses ok, sources ok
src-tauri/permissions              rc=0  advisories ok, bans ok, licenses ok, sources ok
src-tauri/binding/macos            rc=0  advisories ok, bans ok, licenses ok, sources ok
src-tauri/binding/windows          rc=0  advisories ok, bans ok, licenses ok, sources ok
scripts/package-macos/signature-helper rc=0  advisories ok, bans ok, licenses ok, sources ok
```

Zero RustSec advisories, zero denied licenses. Non-zero exit fails the job —
no `continue-on-error` on this step, no silent suppression. Any future finding
is governed by `CONTROL/dependency-exceptions.md` (time-bounded exceptions
only; the release authority fails closed on expired or unapproved entries).

## License inventory (app tree, cargo-deny `list`)

App tree (`src-tauri/Cargo.lock`, 451 packages) license expressions:

- MIT or MIT-OR-Apache duals: dominant set (~601 entries including duals)
- Apache-2.0: 279 entries
- `Apache-2.0 WITH LLVM-exception`: 4 (target-lexicon, wasi, wasip2,
  wit-bindgen) — allowed in `deny.toml` after judgment: permissive exception
  variant, redistribution-compatible
- BSD-3-Clause: 7 (brotli family, encoding_rs, num_enum, alloc-stdlib)
- MPL-2.0: 5 (cssparser, selectors, option-ext, dtoa-short)
- Unicode-3.0 / Unicode-DFS-2016: 19 (icu_* family)
- Zlib, ISC, CC0-1.0, 0BSD, Unlicense: small sets
- LGPL-2.1-or-later: r-efi 5.3.0 / 6.0.0, expression
  `MIT OR Apache-2.0 OR LGPL-2.1-or-later` — permissive option selected,
  check passes without exception

Sibling trees are subsets of the app tree's registry entries (capture trees
carry cpal; binding/windows carries the `windows` 0.62 family). All first-party
workspace members are MIT by root `LICENSE` (clarified in `deny.toml`;
`publish = false` members skipped via `[licenses.private] ignore`).

## Repro command

```sh
cargo install cargo-deny --locked   # pins via cargo-deny's own lockfile
cd <repo root>
for m in src-tauri src-tauri/audio/capture src-tauri/audio/capture-windows \
         src-tauri/permissions src-tauri/binding/macos src-tauri/binding/windows \
         scripts/package-macos/signature-helper; do
  cargo deny --manifest-path "apps/candice-companion/$m/Cargo.toml" check || exit 1
done
```
