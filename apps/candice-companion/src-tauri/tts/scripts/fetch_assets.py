#!/usr/bin/env python3
"""
Deterministic download of the pinned Kokoro assets (WS-19).

Verifies SHA-256 and size against the pins in src-tauri/tts/assets.ts.
On corrupt/mismatched download: exit non-zero, delete the file, refuse to
continue (the app treats a corrupt asset as "Kokoro unavailable" and falls
back per spec section 20 — never auto-ignores a checksum failure).

Usage:
    python3 scripts/fetch_assets.py [--dest DIR] [--variant fp16|int8]

Default dest: ./assets/tts  (relative to the app root)
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import urllib.request

PINS = {
    "kokoro-v1.0.fp16.onnx": {
        "sha256": "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96",
        "size": 163527961,
        "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.fp16.onnx",
    },
    "kokoro-v1.0.int8.onnx": {
        "sha256": "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c",
        "size": 114119327,
        "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx",
    },
    "voices-v1.0.bin": {
        "sha256": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
        "size": 28214398,
        "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin",
    },
}


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(name: str, pin: dict, dest_dir: str) -> bool:
    target = os.path.join(dest_dir, name)
    if os.path.exists(target):
        if os.path.getsize(target) == pin["size"] and sha256_of(target) == pin["sha256"]:
            print(f"OK (cached) {name}")
            return True
        print(f"corrupt cache, re-downloading {name}")
        os.remove(target)

    tmp = target + ".part"
    print(f"downloading {name} ({pin['size']} bytes) ...")
    req = urllib.request.Request(pin["url"], headers={"User-Agent": "candice-ws19"})
    with urllib.request.urlopen(req) as resp:
        with open(tmp, "wb") as fh:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)

    if os.path.getsize(tmp) != pin["size"]:
        os.remove(tmp)
        print(f"FAIL size mismatch for {name}", file=sys.stderr)
        return False
    if sha256_of(tmp) != pin["sha256"]:
        os.remove(tmp)
        print(f"FAIL sha256 mismatch for {name}", file=sys.stderr)
        return False
    os.replace(tmp, target)
    print(f"OK {name}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dest", default=os.path.join("assets", "tts"))
    ap.add_argument("--variant", choices=("fp16", "int8"), default="fp16")
    args = ap.parse_args()

    os.makedirs(args.dest, exist_ok=True)
    wanted = ["voices-v1.0.bin"]
    wanted.append("kokoro-v1.0.fp16.onnx" if args.variant == "fp16" else "kokoro-v1.0.int8.onnx")
    ok = all(fetch(n, PINS[n], args.dest) for n in wanted)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
