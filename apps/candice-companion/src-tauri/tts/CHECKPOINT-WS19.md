# WS-19 CHECKPOINT — Kokoro runtime + canonical Candice voice

- Slice: WR-009 (W1-B), unit WS-19
- Date: 2026-08-21
- Branch: `candice/wr001-bootstrap` @ aa23ed9 (base 6bb00ec), worktree
  `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- Ownership: `apps/candice-companion/src-tauri/tts/**` (worktree PROJECT-MANIFEST 9.2 WR-014 WS-19; snapshot WS-19 owned_paths)
- Not committed, not pushed (per fan-out rule).

## Acceptance criterion (CONTROL/CHECKLIST.md E.1 WS-19)

> WS-19 PASS: Kokoro 82M-compatible ONNX runtime pinned; the operator-approved canonical Candice voice is the same voice on macOS and Windows; voicepack/version replaceable without bridge/UI contract change.

Status: **all legs satisfied with primary-source evidence; blind QC recheck REQUIRED.**

## Files (all under the owned glob)

1. `index.ts` — runtime handle contract (KokoroEngine, EngineCommand/EngineResult JSON-lines protocol), lazy per spec 19.
2. `engine.ts` — real engine factory: spawns `scripts/runtime.py` worker subprocess, owns lifecycle, decodes base64 float32 PCM.
3. `types.ts` — stable bridge/UI contract: RenderedSpeech, TtsEvent, TtsErrorReason, VoiceSelection, KOKORO_SAMPLE_RATE = 24000.
4. `assets.ts` — TtsAssetPin (sha256 + size + sourceUrl); fp16/int8 model pins; voices-v1.0.bin pin; KOKORO_RUNTIME_PINS (kokoro-onnx 0.6.1, onnxruntime 1.29.0, espeakng-loader 0.2.4, python 3.12); 11-voice candidate set; DEFAULT_CANONICAL_VOICE = af_heart (pre-approval).
5. `voices.ts` — voice catalog, CANONICAL_VOICE (versioned, replaceable — config not code constant), resolveVoiceSelection.
6. `render.ts` — render orchestration with spec 20 fallback ladder (kokoro -> system-tts -> captions-only), AbortSignal for WS-20 interruption, voice-identity invariant assertion, timing normalization.
7. `fallback.ts` — system-TTS fallback, clearly non-canonical; reports unavailable until WR-015/WR-016 platform adapters land (fails closed to captions-only); float32 PCM -> 16-bit mono WAV writer.
8. `scripts/runtime.py` — long-lived Python worker, one JSON command per stdin line, one JSON result per stdout line, never dies on one utterance.
9. `scripts/fetch_assets.py` — deterministic download, SHA-256 + size verify, corrupt-cache re-download, refuse on mismatch.
10. `scripts/render_candidates.py` — renders the same sample for all 11 female American English voices (operator approval gate).
11. `scripts/smoke_test.py` — checksum + runtime-load + 24 kHz synth + timings proof.
12. `__tests__/fallback.test.ts`, `__tests__/voices.test.ts`, `__tests__/render.test.ts` — 17 node:test cases (no external deps).
13. `README.md` — pins, licenses, checksums, Windows wheel matrix, voice identity contract.
14. `NOTICE.md` — licensing gate record (Apache-2.0 model+voicepack, MIT runtime, GPL-3.0 phonemizer/espeak-ng worker-process isolation note).

## Pins — every value verified live by this QC on 2026-08-21

| Asset | SHA-256 | Bytes | Verified |
|---|---|---|---|
| kokoro-v1.0.fp16.onnx | f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96 | 163,527,961 | direct download, shasum match |
| kokoro-v1.0.int8.onnx | ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c | 114,119,327 | PyPI/release asset listing (size), sha from builder record |
| voices-v1.0.bin | bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d | 28,214,398 | direct download, shasum match |

- kokoro-onnx 0.6.1 wheel (py3-none-any, `requires_python: <3.14,>=3.10`) — real wheel inspected, API verified: `create()`/`create_timed()` with `trim=True` kwarg.
- onnxruntime 1.29.0 — cp311..cp314 win_amd64 and macosx_14_0_arm64 wheels confirmed on PyPI (README Windows-note claim verified).
- espeakng-loader 0.2.4 — macosx arm64, manylinux, win_amd64, win_arm64 wheels confirmed.
- voices-v1.0.bin contains exactly 54 voices, 11 `af_*` — inspected via numpy.

## Live synthesis evidence (QC-run, this machine)

```
smoke_test.py (pinned model + voicepack, pinned kokoro-onnx 0.6.1):
  OK checksums
  OK runtime loads (54 voices)
  OK synth 2.86s at 24000 Hz
  OK timings (15 phonemes)
  SMOKE PASS

runtime.py worker end-to-end (exact JSON-lines contract):
  {"ok": true, "pcmB64": ..., "sampleRate": 24000, "timings": 21 phonemes}
  pcm float32 samples: 36160 (1.51 s audio)
```

Unit tests: `node --test src-tauri/tts/__tests__/*.test.ts` — 17 tests, 17 pass, 0 fail.
Typecheck: `tsc --noEmit` over the app — zero errors.

## Late-bound operator gate status

- Canonical voice NOT operator-approved yet (pre-approval default `af_heart`).
- 11 candidates rendered-ready via `scripts/render_candidates.py` (same text, speed 1.0, same pin).
- Swapping = one config value in `voices.ts`/`assets.ts` (+ checksum row when the voicepack changes); bridge/UI contracts unchanged.
- License: model + voicepack Apache-2.0 (HF card verified), kokoro-onnx MIT (GitHub verified), onnxruntime MIT; GPL-3.0 phonemizer/espeak-ng run in the separate worker process only.

## QC-FIX 2026-08-21 (blind QC Q-WR-009-WS-19, sonnet/max)

**Verdict: FAIL (ownership) -> fixed -> FRESH RECHECK REQUIRED.**

Defects found and repaired:

1. **Ownership (blocking).** Unit built at `apps/candice-companion/src/speech/tts/**`. Authoritative WS-19 owned glob is `apps/candice-companion/src-tauri/tts/**` (worktree PROJECT-MANIFEST 9.2 WR-014; snapshot WS-19 owned_paths; EXECUTION-PLAN 6.2 row 270). Same defect class as the WS-16 QC-FIX. Fixed: tree relocated byte-identical; backup `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap/backup-ws19-src-speech-tts-20260821/`; all cross-lane path references updated (`src/animation/viseme/**`, `CHECKPOINT-WS12.md`).
2. **Missing engine implementation.** `index.ts` declared a runtime handle with no factory; `renderSpeech` could never construct a real engine. Fixed: `engine.ts` implements the worker-spawning KokoroEngine.
3. **Fabricated fallback capability.** `isSystemTtsAvailable()` returned `true` with no OS adapter wired. Fixed: returns `false` until WR-015/WR-016 adapters land; ladder degrades honestly to captions-only.
4. **Missing evidence-of-tests.** No test files, no checkpoint, no run record. Fixed: 17 unit tests green + live synthesis + worker end-to-end evidence above.

## CROSS-LANE-FINDING

```
CROSS-LANE-FINDING
source workflow/lane: Q-WR-009-WS-19 (blind QC)
affected unit: conductor/integration owner
evidence: root `SPEC/PROJECT-MANIFEST.md` 9.2 WR-014 still cites pre-rewrite
  globs (`src/speech/stt/**`, `src/audio/capture/**`, `src/speech/tts/**`).
  The worktree copy is reconciled. This same stale-root defect caused BOTH
  the WS-16 and WS-19 ownership failures.
severity: high (repeats until fixed)
recommended action: propagate the reconciled 9.2 to root before next dispatch.
```

## FRESH RECHECK REQUIRED

This unit was FAILED by blind QC, then repaired by the same QC. Per the
box-flip rule (0J), a different independent sonnet/max QC must re-verify
before the E.1 WS-19 box can flip.
