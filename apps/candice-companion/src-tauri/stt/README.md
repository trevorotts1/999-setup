# Candice STT — whisper.cpp runtime integration (WS-16)

Local/offline speech-to-text for Candice, per Master Spec section 7 (STT).

## Scope

Owned by workstream WS-16 (`apps/candice-companion/src-tauri/stt/**` — worktree manifest 9.2 WR-014, snapshot owned_paths). This lane:

- pins the whisper.cpp runtime version (macOS Apple Silicon via Homebrew bottle; Windows x64 via the canonical v1.9.2 release archive),
- pins the bundled model (ggml-tiny.en-q5_1) and records candidate benchmarks for the operator size/quality decision,
- verifies every downloaded/bundled artifact by SHA-256 before use (deterministic download, never a blind fetch),
- provides the runtime contract (`WhisperRuntime`) consumed by WS-17 capture and WS-18 transcript confirmation,
- proves local transcription with a green test on the canonical JFK fixture,
- documents the failure contract: when whisper.cpp fails, typing remains available (Master Spec section 20).

## Pin record (2026-08-21, verified on operator Mac Mini, Apple M4 Pro, macOS 25.3)

| Component | Pin | SHA-256 | Source |
|---|---|---|---|
| whisper.cpp (macOS Apple Silicon bottle) | 1.9.2 (revision 0) | `c96d59cc9322a25f3b488b5f01d2a91aa6e2298ba2f39239108e1c85cb549460` | Homebrew, `ghcr.io/v2/homebrew/core/whisper-cpp` (bottle URL contains the digest) |
| whisper.cpp (Windows x64 release archive) | v1.9.2 `whisper-bin-x64.zip` | `49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a` | `https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip` |
| whisper.cpp (Windows Win32 release archive) | v1.9.2 `whisper-bin-Win32.zip` | `de170719aebcb4794d695d449e179002db1fe03b862f21f5c34b2909a7cf8f22` | `https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-Win32.zip` |
| Model (PRODUCTION PIN) | ggml-tiny.en-q5_1 | `c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin` |
| Test fixture | jfk.wav (canonical) | `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e` | `https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav` (byte-identical to the Homebrew `for-tests` copy) |

Model license: MIT (whisper.cpp model files are MIT-licensed, same as the repo). Runtime license: MIT.
Windows release archives carry the same MIT license; per-file checksums in `runtime/manifests/`.

## Bundled vs downloaded — the v1 rule

V1 ships the model **bundled** with the app (Master Spec 31: fresh install works with no source compile and no model download). `bundled-model.json` records the exact artifact expected in the app resources; the updater/installer verifies its SHA-256 before the runtime will load it (spec 33 class). If bundling is later replaced by a deterministic download, the download URL must be operator-controlled and checksum-verified the same way.

## Runtime contract (consumed by WS-17 capture, WS-18 confirmation)

`WhisperRuntime.transcribe(wavPath, options)` returns `{ text, segments, language }`.
Callers must treat `text` as **unconfirmed** — WS-18 owns the confirm-before-submit gate.
The runtime never writes project memory and never touches a network speech endpoint.

## Failure contract (spec 20)

- whisper.cpp fails (missing binary, checksum mismatch, empty transcript, exit != 0): the runtime returns a typed failure `{ ok: false, reason }`; the UI keeps **typing** and HOLD TO TALK remains available for retry. No Candice error blocks the Claude session.
- Empty transcript is a failure (do not submit blank text as an answer).

## Benchmark record (2026-08-21, operator Mac Mini, Apple M4 Pro, 11 s JFK fixture)

| Model | Size (bytes) | Wall time | Transcript fidelity |
|---|---|---|---|
| ggml-tiny.en-q5_1 (PINNED) | 32,166,155 | 0.65 s | verbatim JFK |
| ggml-base.en-q5_1 | 59,721,011 | 0.36 s | verbatim JFK (comma dropped) |
| ggml-small.en-q5_1 | 190,098,681 | 0.52 s | verbatim JFK |
| ggml-medium.en-q5_0 | 539,225,533 | 1.62 s | verbatim JFK (timing variant) |

All four are within the quality bar on the reference fixture. Per spec 7 ("smallest model that meets the transcript quality bar; do not choose a larger model simply because it exists"), the **smallest** candidate — tiny.en-q5_1, 32 MB — is the production pin. The operator may move the pin to base.en-q5_1 for the comma-level difference; the pin table and `bundled-model.json` are the single place that decision lands (proposal to WR-017 updater lane / 9.4 owner for the final bundled-components record).

Fixture note: the Homebrew `for-tests-ggml-tiny.bin` model (575,451 bytes, random-weights test model) produces **zero segments** on the JFK fixture — it is a loader test, not a transcription model. The pinned production model is the real ggml-tiny.en-q5_1 from the canonical repo. This finding is filed CROSS-LANE-FINDING WS-16-01 for the WS-33 bundled-components lane.
