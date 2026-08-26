# Candice updater — checksum + version gate (WS-33)

Owned glob: `scripts/candice-updater/checksums/**` (PROJECT-MANIFEST 9.2 WR-017;
task-graph snapshot WS-33 owned_paths).

Implements the E.1 WS-33 acceptance criteria legs that live in this glob:

- versions + SHA-256 checksums for every downloadable bundled component,
- downloads only from operator-controlled release locations,
- downgrade rejection (unless explicitly supported).

## Files

| File | Purpose |
|---|---|
| `components.mjs` | The registry. `PUBLISHED_PAYLOADS` (verified download hashes) + `REPO_TREE_COMPONENTS` (repo-checkout installs with version pins) + `RUNTIME_PINS` + version-comparison primitives (`compareVersions`, `isNewer`, `isDowngrade`). |
| `verify.mjs` | Payload verifier. SHA-256 + size check against the registry; refuses any payload with no record (fail closed). Exit 0/1/2. |
| `gate.mjs` | Downgrade gate. Rejects `candidate < installed` unless `--allow-downgrade`. Exit 0/1/2. |
| `build-manifest.mjs` | Emits the `CONTROL/bundled-components.json` fragment (PROPOSAL — 9.4 manifest owner applies; this lane never writes CONTROL/**). |
| `__tests__/` | `node --test` suite — 25 tests green (registry integrity, verifier fail-closed paths, version math, download-gate refusals, atomic install + rollback). |

## Verification basis (2026-08-21, all primary-source)

Every `PUBLISHED_PAYLOADS` sha256 was verified live:

| Payload | sha256 | Verified how |
|---|---|---|
| `ggml-tiny.en-q5_1.bin` (32,166,155 B) | `c77c5766…66c7c2b` | WS-16 record; re-downloaded + `shasum -a 256` match |
| `whisper-bin-x64.zip` (8,194,445 B) | `49dcc16d…4d674a` | WS-16 record; re-downloaded + shasum match |
| `whisper-bin-Win32.zip` (5,189,502 B) | `de170719…a7cf8f22` | WS-16 record; re-downloaded + shasum match |
| `Candice Companion_0.2.0_aarch64.dmg` (2,686,932 B) | `f24f4bcb…b0dbaf` | integrated 0.2.0 build 2026-08-22: `npx tauri build` exit 0 in `worktrees/wr001-bootstrap`, `shasum -a 256` on the produced DMG (app CFBundleShortVersionString 0.2.0, Mach-O arm64; unsigned/adhoc — WS-23 zero Developer ID identities) |
| `Candice Companion_0.2.0_x64-setup.exe` | placeholder (64 zeros) | NSIS hash owed from Windows build — cannot be built on this macOS host (recorded limitation); fail-closed until the 9.4 release owner computes it from the Windows CI build |
| `kokoro-v1.0.fp16.onnx` (163,527,961 B) | `f3a290d3…77ac96` | WS-19 record; re-downloaded + shasum match |
| `kokoro-v1.0.int8.onnx` (114,119,327 B) | `ae315a79…70ee9c` | WS-19 record (same upstream release) |
| `voices-v1.0.bin` (28,214,398 B) | `bca610b8…f1fbf7d` | WS-19 record; re-downloaded + shasum match |

`verify.mjs` was run against the four live-downloaded payloads (tiny.en, x64
zip, kokoro fp16, dmg) — all four `OK`, exit 0. On 2026-08-22 the 0.2.0 DMG
hash was replaced with the real integrated-build hash (see table); the
win32 NSIS entry stays a fail-closed placeholder until a Windows build
produces the installer.

## Scope discipline / non-fabrication note

- The 5 skills + `candice-integration` plugin are installed **from the repo
  checkout** (spec 21 first hop: version check → self-update → installer
  links them). They carry version pins, not download hashes — the release
  tarball records are the 9.4 release owner's write at publish time.
- Verified 2026-08-21: `trevorotts1/999-setup` has **zero releases** today
  (GitHub API). No release-download URL for skills/plugin is invented here.
- GitHub Release asset limit: 2 GiB (docs verified 2026-08-21). All listed
  payloads fit far under it; speech assets stay on their pinned upstream
  release tags until the operator publishes them as 999-setup assets
  (recorded in the manifest `channel.note`).
- WS-16 cross-lane finding respected: the bundled STT model is
  `ggml-tiny.en-q5_1` — never the Homebrew `for-tests-ggml-tiny.bin` (zero
  segments on the canonical JFK fixture, verified by WS-16).
