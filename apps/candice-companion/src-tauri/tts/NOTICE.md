# TTS Licensing Notices (WS-19) — Master Spec section 7 voice licensing gate

Recorded 2026-08-21. Before production release, the release owner folds this
into the root `THIRD_PARTY_NOTICES.md` (shared-file 9.4 class — this lane only
proposes, never applies).

## Kokoro model weights

- Model: Kokoro-82M, version 1.0 (`kokoro-v1.0.fp16.onnx`, `kokoro-v1.0.int8.onnx`)
- Upstream: https://huggingface.co/hexgrad/Kokoro-82M
- License: Apache-2.0 (`license:apache-2.0` on the HF model card)
- Redistribution: permitted under Apache-2.0, including the 54-voice pack
  (`voices-v1.0.bin`). No voice clone is used; no unverified recordings.

## Runtime

- `kokoro-onnx` 0.6.1 (https://github.com/thewh1teagle/kokoro-onnx) — MIT
- `onnxruntime` 1.29.0 (Microsoft) — MIT

## Phonemization

- `phonemizer-fork` (bundled as a `kokoro-onnx` dependency) — GPL-3.0
- `espeakng-loader` 0.2.4 — bundles `libespeak-ng` 1.52.0 + `espeak-ng-data` — GPL-3.0+

GPL-3.0 components run as a separate worker process (scripts/runtime.py)
invoked by the app; they are not linked into the app binary. Verify the
distribution model for these components during the WS-44 privacy/security/
secrets audit before production release.

## Canonical voice gate

No final canonical voice is claimed yet. The default (`af_heart`) and the
comparison set (11 female American English voices) all come from the
Apache-2.0 voices-v1.0.bin pack, so operator approval of any candidate does
not introduce a new license obligation. If a custom voice is ever trained,
rights to every training recording must be confirmed before use.
