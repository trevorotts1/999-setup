#!/usr/bin/env python3
"""
Render the operator voice-comparison set (WS-19, Master Spec section 7 gate).

Renders the SAME short Candice sample for every candidate female American
English voice in the pinned voicepack, at the same speed, on the same pinned
runtime. Outputs WAV files into samples/ for operator listening comparison.

Usage:
    python3 scripts/render_candidates.py \
        --model assets/tts/kokoro-v1.0.fp16.onnx \
        --voices assets/tts/voices-v1.0.bin \
        [--out samples] [--text "..."]
"""
from __future__ import annotations

import argparse
import os
import sys

from kokoro_onnx import Kokoro
import soundfile as sf

DEFAULT_TEXT = (
    "Hi, I am Candice, your local companion. Welcome. "
    "Give me just a moment while I make sure everything is set up "
    "properly for us to work together."
)

# Female American English voices in voices-v1.0.bin (af_ prefix).
CANDIDATES = [
    "af_alloy",
    "af_aoede",
    "af_bella",
    "af_heart",
    "af_jessica",
    "af_kore",
    "af_nicole",
    "af_nova",
    "af_river",
    "af_sarah",
    "af_sky",
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--out", default="samples")
    ap.add_argument("--text", default=DEFAULT_TEXT)
    ap.add_argument("--speed", type=float, default=1.0)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    kokoro = Kokoro(model_path=args.model, voices_path=args.voices)

    missing = [v for v in CANDIDATES if v not in kokoro.voices]
    if missing:
        print(f"voices missing from voicepack: {missing}", file=sys.stderr)
        return 1

    for voice in CANDIDATES:
        audio, rate = kokoro.create(args.text, voice=voice, speed=args.speed)
        path = os.path.join(args.out, f"candice-{voice}.wav")
        sf.write(path, audio, rate)
        print(f"{voice:12s} {len(audio) / rate:6.2f}s -> {path}")

    print("Rendered. Listen and choose ONE canonical Candice voice.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
