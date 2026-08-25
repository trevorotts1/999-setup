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
import shutil
import sys

import espeakng_loader
from kokoro_onnx import Kokoro
from kokoro_onnx.config import EspeakConfig
import numpy as np

MAX_TEXT_CHARS = 8192

# espeak-ng stores its data directory in a fixed-size internal buffer. When the
# path is too long it is discarded WITHOUT an error return and espeak silently
# falls back to the path compiled into the wheel on its build machine —
# producing "Error processing file '/Users/runner/.../phontab'" and no audio.
#
# Measured on the shipped espeakng-loader 0.2.4 dylib, isolating each variable:
#   real dir,  26 chars, no spaces  -> works
#   real dir,  33 chars, WITH spaces-> works   (spaces are NOT a factor)
#   real dir, 150 chars             -> works
#   real dir, 160 chars             -> FAILS   (limit is between 150 and 160)
#   real dir, 193 chars             -> FAILS
#   SYMLINK,   28 chars             -> FAILS   (resolved back to its target)
#
# Two separate constraints follow, and both are load-bearing:
#   1. the path must be <= 150 characters;
#   2. it must be a REAL directory. A short symlink to a long path does not
#      work — espeak resolves it and lands back on the long path. That is why
#      this copies the data instead of linking it.
ESPEAK_PATH_BUDGET = 150

APP_ID = "com.blackceo.candice"


def _per_user_dir() -> str:
    """Per-user, stable, OUTSIDE the .app bundle.

    Never write inside Contents/Resources: the bundle is code-signed and any
    file added there invalidates the signature (the same defect stray .pyc
    files cause).
    """
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~/Library/Application Support"), APP_ID)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, APP_ID)
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(base, APP_ID)


def _validate_espeak_data(path: str) -> str:
    """A data path is only acceptable if espeak can actually use it."""
    if len(path) > ESPEAK_PATH_BUDGET:
        raise RuntimeError(
            f"espeak data path is {len(path)} chars, over the {ESPEAK_PATH_BUDGET} "
            f"budget espeak-ng can hold: {path}"
        )
    if not os.path.isfile(os.path.join(path, "phontab")):
        raise RuntimeError(f"espeak data path has no readable phontab: {path}")
    return path


def resolve_espeak_data_path() -> str:
    """Return a data path espeak-ng can actually load.

    Order: CANDICE_ESPEAK_DATA override, the bundled path when it is already
    short enough, otherwise a real copy of the bundled data at a short
    per-user path.

    The copy lives OUTSIDE the .app bundle on purpose: the bundle is
    code-signed and anything written inside Contents/Resources invalidates
    the signature.

    Never returns a path that failed validation and never silently falls back
    to an over-long path — a silent fallback would reproduce exactly the bug
    this function exists to prevent, on any deep install.
    """
    override = os.environ.get("CANDICE_ESPEAK_DATA")
    if override:
        return _validate_espeak_data(override)

    real = espeakng_loader.get_data_path()
    if len(real) <= ESPEAK_PATH_BUDGET:
        return _validate_espeak_data(real)

    dest = os.path.join(_per_user_dir(), "espeak-ng-data")
    if len(dest) > ESPEAK_PATH_BUDGET:
        raise RuntimeError(
            f"cannot place espeak data within the {ESPEAK_PATH_BUDGET}-char budget: "
            f"the per-user path is already {len(dest)} chars ({dest}). "
            f"Set CANDICE_ESPEAK_DATA to a shorter directory."
        )

    # A stale copy from a previous install is worse than none: the voicepack
    # and phoneme tables must match the bundle actually running. The marker
    # records which source produced this copy.
    marker = dest + ".source"
    stamp = f"{real}\n{os.path.getsize(os.path.join(real, 'phontab'))}\n"
    current = None
    if os.path.isfile(marker):
        try:
            with open(marker, "r", encoding="utf-8") as fh:
                current = fh.read()
        except OSError:
            current = None

    if os.path.islink(dest):
        # Earlier builds linked instead of copying; espeak cannot use a link.
        os.unlink(dest)
        current = None

    if current != stamp or not os.path.isfile(os.path.join(dest, "phontab")):
        try:
            if os.path.isdir(dest):
                shutil.rmtree(dest)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copytree(real, dest)
            with open(marker, "w", encoding="utf-8") as fh:
                fh.write(stamp)
        except OSError as exc:
            raise RuntimeError(
                f"could not copy espeak data from {real} to {dest}: {exc}"
            ) from exc

    return _validate_espeak_data(dest)

def main() -> int:
    model = os.environ.get("CANDICE_KOKORO_MODEL")
    voices = os.environ.get("CANDICE_KOKORO_VOICES")
    if not model or not voices:
        print(
            json.dumps({"ok": False, "error": "CANDICE_KOKORO_MODEL/CANDICE_KOKORO_VOICES unset"}),
            flush=True,
        )
        return 2

    # Hand espeak a path it can hold (see resolve_espeak_data_path). Passing an
    # explicit EspeakConfig stops kokoro_onnx calling espeakng_loader itself and
    # re-introducing the over-long path.
    try:
        espeak_config = EspeakConfig(
            data_path=resolve_espeak_data_path(),
            lib_path=espeakng_loader.get_library_path(),
        )
    except (RuntimeError, OSError) as exc:
        print(json.dumps({"ok": False, "error": f"espeak-data-unavailable: {exc}"}), flush=True)
        return 3

    kokoro = Kokoro(model_path=model, voices_path=voices, espeak_config=espeak_config)

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

