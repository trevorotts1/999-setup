#!/usr/bin/env python3
"""FIX-005 phase 2 — landmark + anchor measurement (metadata only).

Locates, per canonical source:
  - full-frame best translation (and scale for non-1254 frames) vs base 03
  - mouth center + mouth bbox (via alpha-weighted frame diff vs base)
  - eye centers + eye bbox (via diff between eye frames and base, split
    by vertical position: eyes above mouth)
  - skin mask bbox (face region)

Outputs JSON. Never prints pixels.

Command: python3 measure2.py <assetDir> <outJson>
"""
import json
import sys

import cv2
import numpy as np

MOUTH = ["03", "04", "05", "06", "07", "08"]
EYE_FRAMES = ["09", "11"]
BASE = "03"


def load_rgba(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"cannot decode {path}")
    return im


def prep(im, size):
    """Alpha-weighted gray, resized; returns also scale factors."""
    h, w = im.shape[:2]
    a = im[:, :, 3].astype(np.float32) / 255.0
    gray = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2GRAY).astype(np.float32)
    masked = gray * a
    resized = cv2.resize(masked, (size, size), interpolation=cv2.INTER_AREA)
    return resized, (size / w, size / h)


def best_shift(ref, tgt, search=12):
    """Full-frame NCC translation search on same-size images."""
    r = cv2.normalize(ref, None, 0, 1, cv2.NORM_MINMAX)
    t = cv2.normalize(tgt, None, 0, 1, cv2.NORM_MINMAX)
    best = (-1.0, 0.0, 0.0)
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            m = np.roll(t, (dy, dx), axis=(0, 1))
            ncc = float(np.mean(r * m))
            if ncc > best[0]:
                best = (ncc, dx, dy)
    return best


def diff_regions(base_masked, other_masked, thresh=18.0, min_area=40):
    """Largest above-threshold diff blobs, split into top (eyes) / bottom (mouth)."""
    d = cv2.absdiff(base_masked, other_masked)
    _, mask = cv2.threshold(d, thresh, 255, cv2.THRESH_BINARY)
    mask = mask.astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    blobs = []
    h = mask.shape[0]
    for i in range(1, n):
        x, y, w, hh, area = stats[i]
        if area < min_area:
            continue
        blobs.append({"x": int(x), "y": int(y), "w": int(w), "h": int(hh),
                      "area": int(area), "cx": float(cents[i][0]), "cy": float(cents[i][1])})
    blobs.sort(key=lambda b: -b["area"])
    return blobs


def skin_bbox(im_rgb, alpha):
    """Simple skin-tone mask bbox (RGB space, character art)."""
    a = alpha.astype(np.float32) / 255.0
    r = im_rgb[:, :, 2].astype(np.float32)
    g = im_rgb[:, :, 1].astype(np.float32)
    b = im_rgb[:, :, 0].astype(np.float32)
    # warm skin: r > g > b, r > 90, saturation moderate
    sat = (r - b) / np.maximum(r, 1.0)
    mask = (r > 95) & (g > 40) & (r > g) & (g > b) & (sat < 0.55) & (a > 0.5)
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return None, 0.0
    return [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)], float(mask.mean())


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: measure2.py <assetDir> <outJson>")
    asset_dir, out_json = sys.argv[1], sys.argv[2]
    src = f"{asset_dir}/source/operator-approved"

    out = {"frames": {}, "mouthAnchorBase": None, "eyeAnchors": {}}

    # Load everything at full res.
    full = {}
    for name in MOUTH + EYE_FRAMES:
        full[name] = load_rgba(f"{src}/{name}-{label(name)}.png")

    base = full[BASE]
    # Base masked gray at full res + coarse (256).
    base_masked_full, _ = prep(base, 1254)
    base_masked, _ = prep(base, 256)

    for name in MOUTH + EYE_FRAMES:
        im = full[name]
        im_masked, _ = prep(im, 256)
        im_masked_full, _ = prep(im, 1254)
        # Scale to base resolution if dims differ (frame 11).
        h, w = im.shape[:2]
        if (h, w) != (1254, 1254):
            im_masked_full = cv2.resize(im_masked_full, (1254, 1254), interpolation=cv2.INTER_AREA)
        ncc, dx, dy = best_shift(base_masked, im_masked, search=14)
        aligned = np.roll(im_masked_full, (int(round(dy * 1254 / 256)), int(round(dx * 1254 / 256))), axis=(0, 1))
        blobs = diff_regions(base_masked_full, aligned)
        rec = {
            "ncc256": round(ncc, 4),
            "shift256": [dx, dy],
            "dims": [w, h],
            "diffBlobs": blobs[:6],
        }
        # Skin bbox on the aligned-to-base frame.
        if (h, w) != (1254, 1254):
            rgb_aligned = np.roll(cv2.resize(im[:, :, :3], (1254, 1254), interpolation=cv2.INTER_AREA),
                                  (int(round(dy * 1254 / 256)), int(round(dx * 1254 / 256))), axis=(0, 1))
            alpha_aligned = np.roll(cv2.resize(im[:, :, 3], (1254, 1254), interpolation=cv2.INTER_AREA),
                                    (int(round(dy * 1254 / 256)), int(round(dx * 1254 / 256))), axis=(0, 1))
        else:
            rgb_aligned = np.roll(im[:, :, :3], (int(round(dy * 1254 / 256)), int(round(dx * 1254 / 256))), axis=(0, 1))
            alpha_aligned = np.roll(im[:, :, 3], (int(round(dy * 1254 / 256)), int(round(dx * 1254 / 256))), axis=(0, 1))
        sb, smean = skin_bbox(rgb_aligned, alpha_aligned)
        rec["skinBBoxAligned"] = sb
        rec["skinMeanAligned"] = round(smean, 4)
        out["frames"][name] = rec

    # Mouth anchor: largest diff blob in 05 (medium open) below vertical center.
    blobs = [b for b in out["frames"]["05"]["diffBlobs"]]
    blobs.sort(key=lambda b: -b["area"])
    mouth = blobs[0] if blobs else None
    out["mouthAnchorBase"] = mouth

    # Eye anchors: for 09 and 11, top blob above the mouth anchor.
    for name in EYE_FRAMES:
        rec = out["frames"][name]
        cands = [b for b in rec["diffBlobs"] if mouth and b["cy"] < mouth["y"]]
        out["eyeAnchors"][name] = cands[0] if cands else None

    with open(out_json, "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({"written": out_json, "frames": len(out["frames"]),
                      "mouthAnchorBase": out["mouthAnchorBase"]}))


def label(n):
    return {
        "03": "mouth-neutral-closed",
        "04": "mouth-slight-open",
        "05": "mouth-medium-open",
        "06": "mouth-wide-open",
        "07": "mouth-smile-closed",
        "08": "mouth-smile-open",
        "09": "eye-open",
        "11": "eye-half-blink",
    }[n]


if __name__ == "__main__":
    main()
