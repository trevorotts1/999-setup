# Third-Party Notices

This repository bundles third-party skills and speech runtime components under
their respective licenses. Each vendored component folder carries a full copy
of its upstream license; this file records the upstream source and the exact
version/commit vendored, so licensing stays traceable. This file is bundled
inside the Candice Companion installers (macOS DMG and Windows NSIS) via
`bundle.resources` in `apps/candice-companion/tauri.conf.json`.

## Vendored skills

The build spec selected these upstreams:

- `eli5` from [nathanksou/eli5](https://github.com/nathanksou/eli5)
- `bro` from [luchasarie/bro-skill](https://github.com/luchasarie/bro-skill)

Both upstreams exist, are Claude Code skills (`SKILL.md` present), and are MIT-licensed.
The vendored files were verified byte-identical (sha256) against the upstream trees at the
pinned commits below. No substitution occurred. An earlier revision of this file
misattributed the vendored content to `K-Paxian/eli5` and `K-Paxian/bro`; those
repositories do not exist on GitHub (checked via API, HTTP 404) and the attribution was
an error, now corrected.

| Skill | Owner-selected upstream | Actual vendored upstream | Vendored commit | License | Status |
|---|---|---|---|---|---|
| `eli5` | [nathanksou/eli5](https://github.com/nathanksou/eli5) | [nathanksou/eli5](https://github.com/nathanksou/eli5) (path `eli5/`) | `549364af799a4a0556c5359a0ac3e36d4da5719d` | MIT | MATCHES SELECTION |
| `bro` | [luchasarie/bro-skill](https://github.com/luchasarie/bro-skill) | [luchasarie/bro-skill](https://github.com/luchasarie/bro-skill) | `01e51f8092973be58eff3b7271282bd8488a02ae` | MIT | MATCHES SELECTION |

Files covered:

- `.claude/skills/eli5/SKILL.md` — MIT, see `.claude/skills/eli5/THIRD_PARTY_LICENSE.md`
- `.claude/skills/bro/SKILL.md` — MIT, see `.claude/skills/bro/THIRD_PARTY_LICENSE.md`
- `.claude/skills/bro/examples/*.md` (consultant-speak.md, git-panic.md, kubernetes.md,
  pt-br.md, software-architecture.md) — MIT, see `.claude/skills/bro/THIRD_PARTY_LICENSE.md`

All other skills in this repository (`nine-router-setup`, `spec-protocol`, `kaizen`) are
original to this repository and covered by the repository `LICENSE` (MIT).

## Candice Companion — speech runtime components

Folded into this root notices file at release stamp (2026-08-22) from
`apps/candice-companion/src-tauri/tts/NOTICE.md` (WS-19) and the license facts in
`apps/candice-companion/src-tauri/stt/README.md` (WS-16). The TTS `NOTICE.md` header
required this fold before production release; it is now applied. The per-directory
files remain in place as the component-level records.

### Text-to-speech (Kokoro)

Model weights:

- Kokoro-82M, version 1.0 (`kokoro-v1.0.fp16.onnx`, `kokoro-v1.0.int8.onnx`)
- Upstream: https://huggingface.co/hexgrad/Kokoro-82M
- License: Apache-2.0 (`license:apache-2.0` on the HF model card)
- Redistribution: permitted under Apache-2.0, including the 54-voice pack
  (`voices-v1.0.bin`). No voice clone is used; no unverified recordings.

Runtime:

- `kokoro-onnx` 0.6.1 (https://github.com/thewh1teagle/kokoro-onnx) — MIT
- `onnxruntime` 1.29.0 (Microsoft) — MIT

Phonemization (GPL components — separate worker process):

- `phonemizer-fork` (bundled as a `kokoro-onnx` dependency) — GPL-3.0
- `espeakng-loader` 0.2.4 — bundles `libespeak-ng` 1.52.0 + `espeak-ng-data` — GPL-3.0+

These GPL-3.0 components run as a separate worker process
(`apps/candice-companion/src-tauri/tts/scripts/runtime.py`) invoked by the app; they
are not linked into the app binary. The distribution model for these components is
recorded here as stated by WS-19; final verification is owed to the WS-44
privacy/security/secrets audit before production release.

Canonical voice gate (status at release stamp):

No final canonical voice is claimed yet. The default (`af_heart`) and the comparison
set (11 female American English voices) all come from the Apache-2.0
`voices-v1.0.bin` pack, so operator approval of any candidate does not introduce a
new license obligation. If a custom voice is ever trained, rights to every training
recording must be confirmed before use.

### Speech-to-text (whisper.cpp)

- Runtime: whisper.cpp 1.9.2 (pinned; macOS Apple Silicon bottle and Windows x64 /
  Win32 release archives) — MIT
- Model: `ggml-tiny.en-q5_1` (production pin) — MIT (whisper.cpp model files are
  MIT-licensed, same as the repo)
- Sources and SHA-256 pins: `apps/candice-companion/src-tauri/stt/README.md` (pin
  record 2026-08-21) and
  `apps/candice-companion/src-tauri/stt/runtime/manifests/`
