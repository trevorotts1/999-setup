# Candice TTS — Kokoro Runtime + Canonical Candice Voice (WS-19)

Owned path: `apps/candice-companion/src-tauri/tts/**` (WR-014 slice, WS-19).

Implements the Master Spec section 7 (TTS) contract:

- Kokoro 82M-compatible local ONNX runtime, no cloud TTS service;
- one canonical Candice voice across all supported computers;
- same voice identity on macOS and Windows;
- pinned model/runtime/voicepack;
- voicepack/version replaceable without changing the bridge or UI contract;
- system speech synthesis is only a fallback, never the canonical Candice voice.

## Pinned runtime (verified 2026-08-21)

| Component | Pin | License |
|---|---|---|
| Model | `kokoro-v1.0.fp16.onnx` (82M, fp16) | Apache-2.0 (Kokoro weights, hexgrad) |
| Voicepack | `voices-v1.0.bin` (54 voices, npz) | Apache-2.0 |
| Runtime | `kokoro-onnx` 0.6.1 (thewh1teagle) | MIT |
| ONNX Runtime | `onnxruntime` 1.29.0 | MIT |
| Phonemizer | `phonemizer-fork` (bundled via `kokoro-onnx[gpu]`-independent deps) | GPL-3.0 (see NOTICE) |
| espeak-ng data | bundled by `espeakng-loader` 0.2.4 (libespeak-ng 1.52.0 + espeak-ng-data) | GPL-3.0+ (see NOTICE) |
| Python | 3.12 (cp312 wheel matrix exists for macOS arm64 + Windows amd64 for every component) | — |

Sources:

- Model + voicepack release: `https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1`
- Runtime source: `https://github.com/thewh1teagle/kokoro-onnx` (tag v0.6.1)
- Upstream model: `https://huggingface.co/hexgrad/Kokoro-82M`
- espeak-ng data: bundled by `espeakng-loader` (libespeak-ng 1.52.0)

### Checksums (SHA-256, verified by direct download 2026-08-21)

```
kokoro-v1.0.fp16.onnx  f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96
kokoro-v1.0.int8.onnx   ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c
voices-v1.0.bin        bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
```

The fp16 model is the canonical pin for both macOS and Windows. The int8 model is
the verified fallback for very low-end CPUs (Windows x64 non-AVX2 boxes) and is
kept version-locked to the same release.

### Runtime notes (measured on Apple Silicon, Python 3.12, CPU provider)

- fp16: ~0.17 RTF (4.65 s audio in 0.80 s), ~787 MB RSS peak (includes model load)
- int8: ~0.48 RTF — use fp16 unless the CPU cannot run it
- `create_timed()` returns phoneme-level `Timing(phoneme, start, end)` — the
  input for WS-12 viseme synchronization (mouth sync to TTS).
- Fully offline: phonemization uses the espeak-ng data bundled in the wheel;
  no system espeak-ng install required, no network at synthesis time.
- Determinism note: two identical `create()` calls in the same session differ by
  ~0.06 max amplitude (float noise in the graph). Timings stay stable enough for
  viseme sync; do not depend on bit-exact repeat synthesis.

### Windows note

`onnxruntime` 1.29.0 publishes `win_amd64` wheels for cp311-cp314; `espeakng-loader`
0.2.4 publishes `win_amd64` and `win_arm64` wheels; the model and voicepack are
pure binary assets and are byte-identical on both OSes — the canonical Candice
voice is the same voice on macOS and Windows by construction.

## Voice identity contract

The voice ID is a configuration value, never a code constant that the UI or the
bridge depends on:

```text
voice id  ->  kokoro-onnx voicepack key  ->  same 54-voice npz on both OSes
```

Swapping the canonical voice (operator approval, section 7 late-bound gate) is a
one-line config change plus checksum bump; the bridge and UI contracts do not
change.

## Canonical voice selection — late-bound operator gate

Per Master Spec section 7, the final canonical voice is operator-approved before
production release. This lane renders a comparison set from the same short
Candice sample so the operator can pick one voice; the pinned default is
`af_heart` (warm, professional, American English) and is replaceable without any
code change.

Candidate set (all female American English voices in voices-v1.0.bin), rendered
to `samples/` by `scripts/render_candidates.py`:

| Voice | File |
|---|---|
| af_heart (default) | `samples/candice-af_heart.wav` |
| af_alloy | `samples/candice-af_alloy.wav` |
| af_aoede | `samples/candice-af_aoede.wav` |
| af_bella | `samples/candice-af_bella.wav` |
| af_jessica | `samples/candice-af_jessica.wav` |
| af_kore | `samples/candice-af_kore.wav` |
| af_nicole | `samples/candice-af_nicole.wav` |
| af_nova | `samples/candice-af_nova.wav` |
| af_river | `samples/candice-af_river.wav` |
| af_sarah | `samples/candice-af_sarah.wav` |
| af_sky | `samples/candice-af_sky.wav` |

All candidates render the same text, same speed (1.0), same runtime pin. No
voice race is inferred from timbre (spec section 7); the product requirement is
one consistent signature Candice voice approved by the operator.

## QC status

Blind QC (Q-WR-009-WS-19, sonnet/max, 2026-08-21): FAIL (ownership — built at
superseded `src/speech/tts/**`) -> relocated to `src-tauri/tts/**`, engine
factory + tests added, fallback honesty fix, full live verification. See
`CHECKPOINT-WS19.md`. **FRESH RECHECK REQUIRED** by a different independent QC
before the E.1 WS-19 box flips.

## Files

| Path | Purpose |
|---|---|
| `src-tauri/tts/index.ts` | Runtime handle contract (lazy; spawns the Python worker) |
| `src-tauri/tts/engine.ts` | Real engine factory — worker spawn, lifecycle, PCM decode |
| `src-tauri/tts/voices.ts` | Voice catalog + canonical voice config (versioned) |
| `src-tauri/tts/assets.ts` | Asset pins + SHA-256 verification (deterministic download) |
| `src-tauri/tts/render.ts` | Text -> audio at 24 kHz; `create_timed` bridge for visemes |
| `src-tauri/tts/fallback.ts` | System TTS fallback (never the canonical voice) |
| `src-tauri/tts/types.ts` | TTS event/result types shared with the bridge/UI contract |
| `scripts/fetch_assets.py` | Deterministic asset download with checksum verify |
| `scripts/render_candidates.py` | Renders the operator voice-comparison set |
| `scripts/smoke_test.py` | Checksum + runtime + 24 kHz synth + timings proof |
| `scripts/runtime.py` | Long-lived Python worker (JSON lines on stdin/stdout) |
| `__tests__/` | 17 node:test cases (fallback, voices, render) |
| `samples/` | Rendered comparison samples (generated; not committed at build time) |
| `README.md` | This file — pin, checksums, licensing gate |
