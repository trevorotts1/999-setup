#!/usr/bin/env python3
"""
WS-19 smoke test — proves the pinned runtime + assets actually synthesize.

Checks, in order:
1. model and voicepack files exist,
2. SHA-256 matches the pins in src-tauri/tts/assets.ts,
3. kokoro-onnx 0.6.1 loads the model and voicepack,
4. one utterance synthesizes to 24 kHz mono PCM with expected duration,
5. create_timed() returns phoneme timings (viseme sync input).

Usage:
    python3 scripts/smoke_test.py --model PATH --voices PATH
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys

MODEL_SHA256 = "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96"
VOICES_SHA256 = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    args = ap.parse_args()

    for path in (args.model, args.voices):
        if not os.path.isfile(path):
            print(f"FAIL missing {path}", file=sys.stderr)
            return 1

    got_model = sha256_of(args.model)
    got_voices = sha256_of(args.voices)
    if got_model != MODEL_SHA256:
        print(f"FAIL model sha256 {got_model}", file=sys.stderr)
        return 1
    if got_voices != VOICES_SHA256:
        print(f"FAIL voices sha256 {got_voices}", file=sys.stderr)
        return 1
    print("OK checksums")

    from kokoro_onnx import Kokoro  # noqa: PLC0415

    kokoro = Kokoro(model_path=args.model, voices_path=args.voices)
    if "af_heart" not in kokoro.voices:
        print("FAIL af_heart missing from voicepack", file=sys.stderr)
        return 1
    print(f"OK runtime loads ({len(kokoro.voices)} voices)")

    audio, rate = kokoro.create(
        "Hello, I am Candice, your local companion.", voice="af_heart", speed=1.0
    )
    if rate != 24000:
        print(f"FAIL sample rate {rate}", file=sys.stderr)
        return 1
    if not (0.5 < len(audio) / rate < 30.0):
        print(f"FAIL implausible duration {len(audio) / rate}", file=sys.stderr)
        return 1
    print(f"OK synth {len(audio) / rate:.2f}s at {rate} Hz")

    _, _, timings = kokoro.create_timed("Hello Candice.", voice="af_heart", speed=1.0)
    if not timings:
        print("FAIL no phoneme timings", file=sys.stderr)
        return 1
    print(f"OK timings ({len(timings)} phonemes)")

    print("SMOKE PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
