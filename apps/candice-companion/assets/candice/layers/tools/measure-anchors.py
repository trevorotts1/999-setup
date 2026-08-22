#!/usr/bin/env python3
"""FIX-005 — regenerate layer-anchor-registry.json from canonical sources.

Measurement method (metadata only, NEVER prints pixels):
  - alpha channel threshold >= 128 -> opaque-subject mask
  - bbox = mask extents; anchor = (x0/frameW, y0/frameH)
  - required scale = reference (03) subject extents / state subject extents
  - max drift = residual |centroid - reference centroid| after anchor + scale
    alignment, normalized to the reference subject extents

Reference geometry: state mouth-neutral-closed (03).

Command:
  python3 tools/measure-anchors.py <assetDir> <outJson>
where <assetDir> is the assets/candice root (contains source/operator-approved).
"""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
import numpy as np

CANONICAL_SOURCES = [
    "03-mouth-neutral-closed.png",
    "04-mouth-slight-open.png",
    "05-mouth-medium-open.png",
    "06-mouth-wide-open.png",
    "07-mouth-smile-closed.png",
    "08-mouth-smile-open.png",
    "09-eye-open.png",
    "11-eye-half-blink.png",
]

# State table: identity, family, phoneme coverage. The 7 canonical sources are
# the only authority; these roles mirror the manifest stateMap face group.
STATES = [
    ("mouth-neutral-closed", "mouth", "03-mouth-neutral-closed.png", ["rest", "idle"]),
    ("mouth-slight-open", "mouth", "04-mouth-slight-open.png", ["ai"]),
    ("mouth-medium-open", "mouth", "05-mouth-medium-open.png", ["oh"]),
    ("mouth-wide-open", "mouth", "06-mouth-wide-open.png", ["wide"]),
    ("mouth-smile-closed", "mouth", "07-mouth-smile-closed.png", ["success"]),
    ("mouth-smile-open", "mouth", "08-mouth-smile-open.png", ["success-open"]),
    ("eye-open", "eye", "09-eye-open.png", ["open"]),
    ("eye-half-blink", "eye", "11-eye-half-blink.png", ["half-blink"]),
]

ALPHA_THRESHOLD = 128


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def measure(path: Path):
    """Return frame size, opaque-subject bbox, and centroid. Numbers only."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im.getchannel("A"), dtype=np.uint8)
    ys, xs = np.nonzero(a >= ALPHA_THRESHOLD)
    if len(ys) == 0:
        raise SystemExit(f"no opaque pixels in {path}")
    return im.size[0], im.size[1], int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), float(xs.mean()), float(ys.mean())


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: measure-anchors.py <assetDir> <outJson>")
    asset_dir = Path(sys.argv[1]).resolve()
    out_json = Path(sys.argv[2]).resolve()
    src = asset_dir / "source" / "operator-approved"

    for name in CANONICAL_SOURCES:
        if not (src / name).is_file():
            raise SystemExit(f"missing canonical source: {src / name}")

    # Reference geometry: mouth-neutral-closed (03).
    rf = measure(src / "03-mouth-neutral-closed.png")
    ref_w, ref_h = rf[4] - rf[2] + 1, rf[5] - rf[3] + 1
    ref_cx, ref_cy = rf[6], rf[7]

    states = []
    for state_id, group, filename, phonemes in STATES:
        w, h, x0, y0, x1, y1, cx, cy = measure(src / filename)
        sw, sh = x1 - x0 + 1, y1 - y0 + 1
        anchor_x, anchor_y = x0 / w, y0 / h
        scale_x, scale_y = ref_w / sw, ref_h / sh
        # Post-alignment centroid drift, normalized to reference subject extents.
        drift_x = abs((anchor_x * w + (cx - x0) * scale_x) - ref_cx) / ref_w
        drift_y = abs((anchor_y * h + (cy - y0) * scale_y) - ref_cy) / ref_h
        states.append({
            "stateId": state_id,
            "group": group,
            "phonemes": phonemes,
            "sourceFile": filename,
            "sha256": sha256(src / filename),
            "frameWidth": w,
            "frameHeight": h,
            "anchorX": round(anchor_x, 5),
            "anchorY": round(anchor_y, 5),
            "requiredScaleX": round(scale_x, 5),
            "requiredScaleY": round(scale_y, 5),
            "maxDriftX": round(drift_x, 5),
            "maxDriftY": round(drift_y, 5),
        })

    ref_state = next(s for s in states if s["stateId"] == "mouth-neutral-closed")
    out = {
        "schemaVersion": 1,
        "authority": "operator-originals",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "measuredWith": {"tool": "measure-anchors.py", "library": f"Pillow {Image.__version__}"},
        "alphaThreshold": ALPHA_THRESHOLD,
        "reference": {
            "stateId": "mouth-neutral-closed",
            "sourceFile": "03-mouth-neutral-closed.png",
            "sha256": ref_state["sha256"],
            "frameWidth": 1254,
            "frameHeight": 1254,
        },
        "driftPolicy": {
            "maxDriftX": round(max(s["maxDriftX"] for s in states), 5),
            "maxDriftY": round(max(s["maxDriftY"] for s in states), 5),
        },
        "states": states,
    }
    with open(out_json, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(json.dumps({"written": str(out_json), "states": len(states),
                      "driftPolicy": out["driftPolicy"]}))


if __name__ == "__main__":
    main()
