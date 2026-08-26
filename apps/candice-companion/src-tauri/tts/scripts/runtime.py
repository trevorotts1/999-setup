#!/usr/bin/env python3
"""
Kokoro runtime worker (WS-19).

Long-lived subprocess owned by the app engine handle (src-tauri/tts/index.ts).
Reads one JSON command per line on stdin, writes one JSON result per line on
stdout. Exits cleanly on EOF.

Command:
    {"kind": "synthesize", "text": "...", "voiceId": "af_heart",
     "speed": 1.0, "withTimings": true}

Result:
    {"ok": true, "pcmB64": "...", "sampleRate": 24000,
     "timings": [{"phoneme": "h", "startSec": 0.11, "endSec": 0.16}, ...]}
    {"ok": false, "error": "..."}

The worker is platform-neutral: same script, same model, same voicepack on
macOS and Windows — the canonical Candice voice is identical by construction.

Runtime pin: kokoro-onnx 0.6.1, onnxruntime 1.29.0, Python 3.12.
"""
from __future__ import annotations

import base64
import json
import os
import sys

from kokoro_onnx import Kokoro
import numpy as np

MAX_TEXT_CHARS = 8192


def main() -> int:
    model = os.environ.get("CANDICE_KOKORO_MODEL")
    voices = os.environ.get("CANDICE_KOKORO_VOICES")
    if not model or not voices:
        print(
            json.dumps({"ok": False, "error": "CANDICE_KOKORO_MODEL/CANDICE_KOKORO_VOICES unset"}),
            flush=True,
        )
        return 2

    kokoro = Kokoro(model_path=model, voices_path=voices)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as exc:
            print(json.dumps({"ok": False, "error": f"bad-json: {exc}"}), flush=True)
            continue

        if cmd.get("kind") != "synthesize":
            print(json.dumps({"ok": False, "error": "unknown-kind"}), flush=True)
            continue

        text = str(cmd.get("text", ""))[:MAX_TEXT_CHARS]
        voice = str(cmd.get("voiceId", "af_heart"))
        speed = float(cmd.get("speed", 1.0))
        with_timings = bool(cmd.get("withTimings", False))

        try:
            if with_timings:
                audio, rate, timings = kokoro.create_timed(
                    text, voice=voice, speed=speed, trim=True
                )
                payload = {
                    "ok": True,
                    "pcmB64": base64.b64encode(np.asarray(audio, dtype=np.float32).tobytes()).decode(),
                    "sampleRate": int(rate),
                    "timings": [
                        {"phoneme": t.phoneme, "startSec": float(t.start), "endSec": float(t.end)}
                        for t in timings
                    ],
                }
            else:
                audio, rate = kokoro.create(text, voice=voice, speed=speed, trim=True)
                payload = {
                    "ok": True,
                    "pcmB64": base64.b64encode(np.asarray(audio, dtype=np.float32).tobytes()).decode(),
                    "sampleRate": int(rate),
                }
            print(json.dumps(payload), flush=True)
        except Exception as exc:  # noqa: BLE001 - worker must never die on one utterance
            print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())

