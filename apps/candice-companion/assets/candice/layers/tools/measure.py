#!/usr/bin/env python3
"""FIX-005 phase 1 — measure canonical mouth/eye sources (metadata only).

NEVER prints pixels. Output is JSON: per-source dimensions, alpha bbox,
alpha extrema/mean, and per-file correlation to the registration base
so cross-frame drift is a number, not an opinion.

Command:
  python3 measure.py <assetDir> <outJson>
"""
import json
import sys

import cv2
import numpy as np

CANON = {
    "base": ["03-mouth-neutral-closed.png"],
    "mouth": [
        "03-mouth-neutral-closed.png",
        "04-mouth-slight-open.png",
        "05-mouth-medium-open.png",
        "06-mouth-wide-open.png",
        "07-mouth-smile-closed.png",
        "08-mouth-smile-open.png",
    ],
    "eye": [
        "09-eye-open.png",
        "11-eye-half-blink.png",
    ],
}


def load(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"cannot decode {path}")
    return im


def stats(im, name, path):
    h, w = im.shape[:2]
    if im.shape[2] == 4:
        b, g, r, a = cv2.split(im)
        alpha = a.astype(np.float64) / 255.0
        opaque = alpha > 0.5
        ys, xs = np.nonzero(opaque)
        if len(ys) == 0:
            bbox = None
        else:
            bbox = [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]
        return {
            "name": name,
            "file": path,
            "width": w,
            "height": h,
            "channels": 4,
            "alphaMean": round(float(alpha.mean()), 4),
            "alphaMin": round(float(alpha.min()), 4),
            "alphaMax": round(float(alpha.max()), 4),
            "opaqueBBox": bbox,
            "rgbMean": [round(float(v), 2) for v in (b.mean(), g.mean(), r.mean())],
        }
    return {
        "name": name,
        "file": path,
        "width": w,
        "height": h,
        "channels": im.shape[2],
        "alphaMean": None,
        "alphaMin": None,
        "alphaMax": None,
        "opaqueBBox": None,
        "rgbMean": None,
    }


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: measure.py <assetDir> <outJson>")
    asset_dir, out_json = sys.argv[1], sys.argv[2]
    src = f"{asset_dir}/source/operator-approved"

    out = {"sources": [], "correlations": []}
    base = None
    for key, names in CANON.items():
        for name in names:
            path = f"{src}/{name}"
            im = load(path)
            st = stats(im, name, path)
            out["sources"].append(st)
            if key == "base":
                base = (name, im)
            elif key == "mouth" or key == "eye":
                out["correlations"].append(corr_entry(name, base, im))

    with open(out_json, "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({"written": out_json, "sources": len(out["sources"]), "correlations": len(out["correlations"])}))


def corr_entry(name, base, im):
    """Downscale both to 125x125 gray and record 2D phase correlation peak."""
    def prep(x):
        if x.shape[2] == 4:
            a = x[:, :, 3].astype(np.float32) / 255.0
            gray = cv2.cvtColor(x[:, :, :3], cv2.COLOR_BGR2GRAY).astype(np.float32)
            return gray * a
        return cv2.cvtColor(x, cv2.COLOR_BGR2GRAY).astype(np.float32)

    gb = cv2.resize(prep(base[1]), (125, 125))
    gi = cv2.resize(prep(im), (125, 125))
    cc = cv2.phaseCorrelate(gb, gi, np.hanning(125).astype(np.float32) if False else None)
    shift, response = cc
    return {
        "name": name,
        "vsBase": base[0],
        "shiftXY": [round(float(shift[0]), 4), round(float(shift[1]), 4)],
        "response": round(float(response), 4),
    }


if __name__ == "__main__":
    main()
