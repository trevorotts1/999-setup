#!/usr/bin/env python3
"""FIX-005 phase 5 — mouth/eye region extraction with visual crops.

Measure4 proved eye-pair affine normalization works but whole-frame
residuals stay large (compositions differ). So anchors come from
eye-pair geometry; mouth/eye REGIONS come from dark-pixel clusters
inside the face window (mouth interior, lash lines).

Per frame (03-09, 11) + fullbody 01:
  - Haar face box (largest)
  - Haar eye pair (measure4 logic); fallback for 07: two largest
    dark blobs in upper face, symmetric about face center-x
  - dark mask inside face window; row projection bands
  - eye band: first band (top-down) with >= 2 dark column runs
  - mouth band: first band fully below eye band
  - mouth blob: largest dark blob below eye band
  - crops saved to <cropsDir>/<code>-{face,eyes,mouth}.png for
    human visual verification (Read tool)

Outputs JSON. Never prints pixels.

Command: python3 measure5.py <assetDir> <outJson> <cropsDir>
"""
import json
import os
import sys

import cv2
import numpy as np

ALL = ["03", "04", "05", "06", "07", "08", "09", "11"]
FULLBODY = "01"

NAMES = {
    "01": "fullbody-idle",
    "03": "mouth-neutral-closed",
    "04": "mouth-slight-open",
    "05": "mouth-medium-open",
    "06": "mouth-wide-open",
    "07": "mouth-smile-closed",
    "08": "mouth-smile-open",
    "09": "eye-open",
    "11": "eye-half-blink",
}


def load_rgba(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"cannot decode {path}")
    return im


def haar_detect(im, cascade, scales=(1.0, 0.75, 0.5), min_neighbors=5,
                min_size=24):
    h, w = im.shape[:2]
    found = []
    for scale in scales:
        small = cv2.resize(im, (int(w * scale), int(h * scale)),
                           interpolation=cv2.INTER_AREA)
        boxes = cascade.detectMultiScale(
            small, scaleFactor=1.1, minNeighbors=min_neighbors,
            minSize=(min_size, min_size))
        for (x, y, ww, hh) in boxes:
            found.append([int(x / scale), int(y / scale),
                          int(ww / scale), int(hh / scale)])
    return found


def eye_pair(im_bgr, face):
    """Haar eye pair inside face box, split left/right of face center."""
    eye_c = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_eye.xml")
    fx, fy, fw, fh = face
    roi = im_bgr[fy:fy + fh, fx:fx + fw]
    boxes = eye_c.detectMultiScale(
        roi, scaleFactor=1.1, minNeighbors=4,
        minSize=(int(fw * 0.1), int(fw * 0.1)))
    cands = []
    for (x, y, w, h) in boxes:
        cx = fx + x + w / 2.0
        cy = fy + y + h / 2.0
        if cy < fy + fh * 0.62:
            cands.append((w * h, cx, cy, w, h))
    cands.sort(reverse=True)
    left = [c for c in cands if c[1] < fx + fw * 0.5]
    right = [c for c in cands if c[1] >= fx + fw * 0.5]
    if not left or not right:
        return None
    l = max(left, key=lambda c: c[0])
    r = max(right, key=lambda c: c[0])
    return (l, r)


def dark_mask(im):
    gray = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2].astype(np.float32)
    s = hsv[:, :, 1].astype(np.float32) / 255.0
    g = gray.astype(np.float32)
    m = ((g < 70) | ((v < 120) & (s < 0.7))) & (im[:, :, 3] > 128)
    return m.astype(np.uint8) * 255


def components(mask, min_area):
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < min_area:
            continue
        out.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h),
                    "area": int(area), "cx": float(cents[i][0]),
                    "cy": float(cents[i][1])})
    out.sort(key=lambda c: -c["area"])
    return out


def row_bands(dk, x0, x1, frac=0.30):
    sub = dk[:, x0:x1]
    rows = sub.sum(axis=1)
    if rows.max() == 0:
        return []
    thr = rows.max() * frac
    active = rows > thr
    bands = []
    in_run = False
    for i, a in enumerate(active):
        if a and not in_run:
            start = i
            in_run = True
        elif not a and in_run:
            peak = int(rows[start:i].argmax() + start)
            bands.append([int(start), int(i - 1),
                          int(rows[start:i].max()), peak])
            in_run = False
    if in_run:
        peak = int(rows[start:].argmax() + start)
        bands.append([int(start), len(rows) - 1,
                      int(rows[start:].max()), peak])
    return bands


def save_crop(im, rect, path):
    x, y, w, h = rect
    x = max(0, int(x))
    y = max(0, int(y))
    w = min(int(w), im.shape[1] - x)
    h = min(int(h), im.shape[0] - y)
    if w <= 0 or h <= 0:
        return False
    crop = im[y:y + h, x:x + w]
    cv2.imwrite(path, crop)
    return True


def analyze(code, im, crops_dir):
    h, w = im.shape[:2]
    rec = {"code": code, "file": f"{code}-{NAMES[code]}.png",
           "dims": [w, h]}

    face_c = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = haar_detect(im[:, :, :3], face_c)
    if faces:
        faces.sort(key=lambda b: -(b[2] * b[3]))
        fx, fy, fw, fh = faces[0]
        rec["faceBox"] = [fx, fy, fw, fh]
    else:
        rec["faceBox"] = None
        rec["error"] = "no haar face"
        return rec

    dk = dark_mask(im)
    # face window inflated 20%
    ix = max(0, int(fx - 0.20 * fw))
    iy = max(0, int(fy - 0.20 * fh))
    iw = min(int(fw * 1.4), w - ix)
    ih = min(int(fh * 1.4), h - iy)
    rec["window"] = [ix, iy, iw, ih]

    blobs = components(dk[iy:iy + ih, ix:ix + iw], min_area=10)
    for b in blobs:
        b["x"] += ix
        b["y"] += iy
        b["cx"] += ix
        b["cy"] += iy
    rec["darkBlobs"] = blobs[:10]

    bands = row_bands(dk, ix, ix + iw)
    rec["rowBands"] = bands[:8]

    # eye band: first band with >=2 wide dark columns
    eye_band = None
    for (y0, y1, mass, peak) in bands:
        sub = dk[y0:y1 + 1, ix:ix + iw]
        cols = sub.sum(axis=0)
        if cols.max() == 0:
            continue
        m = (cols > cols.max() * 0.15).astype(np.uint8) * 255
        n, cl, cst, cc = cv2.connectedComponentsWithStats(m, 8)
        runs = []
        for i in range(1, n):
            if cst[i][cv2.CC_STAT_WIDTH] >= 4:
                runs.append([int(cst[i][cv2.CC_STAT_LEFT] + ix),
                             int(cst[i][cv2.CC_STAT_LEFT] +
                                 cst[i][cv2.CC_STAT_WIDTH] + ix)])
        if len(runs) >= 2:
            eye_band = {"y0": int(y0), "y1": int(y1), "mass": mass,
                        "peakRow": peak, "colRuns": runs[:6]}
            break
    rec["eyeBand"] = eye_band

    # mouth band: first band fully below eye band
    mouth_band = None
    if eye_band:
        for (y0, y1, mass, peak) in bands:
            if y0 <= eye_band["y0"]:
                continue
            mouth_band = {"y0": int(y0), "y1": int(y1), "mass": mass,
                          "peakRow": peak}
            break
    rec["mouthBand"] = mouth_band

    # mouth blob: largest dark blob below eye band (or window middle)
    floor = (eye_band["y1"] + 1) if eye_band else (iy + int(ih * 0.5))
    mouth_blob = None
    for b in blobs:
        if b["cy"] > floor:
            mouth_blob = b
            break
    rec["mouthBlob"] = mouth_blob

    # Haar eye pair (global coords)
    pair = eye_pair(im[:, :, :3], (fx, fy, fw, fh))
    if pair:
        l, r = pair
        rec["eyePair"] = [[round(l[1], 2), round(l[2], 2)],
                          [round(r[1], 2), round(r[2], 2)]]
    else:
        rec["eyePair"] = None

    # fallback eye estimate for frames without Haar pair: two dark blobs
    # in the eye band, symmetric about face center-x
    if rec["eyePair"] is None and eye_band:
        eblobs = [b for b in blobs if b["cy"] < eye_band["y1"] + 1 and
                  b["y"] <= eye_band["y1"]]
        if len(eblobs) >= 2:
            cxm = fx + fw / 2.0
            lefts = [b for b in eblobs if b["cx"] < cxm]
            rights = [b for b in eblobs if b["cx"] >= cxm]
            if lefts and rights:
                l = max(lefts, key=lambda b: b["area"])
                r = max(rights, key=lambda b: b["area"])
                rec["eyePairFallback"] = [
                    [round(l["cx"], 2), round(l["cy"], 2)],
                    [round(r["cx"], 2), round(r["cy"], 2)]]

    # crops for visual verification
    os.makedirs(crops_dir, exist_ok=True)
    save_crop(im, (ix, iy, iw, ih), f"{crops_dir}/{code}-face.png")
    if eye_band:
        save_crop(im, (ix, eye_band["y0"] - 30, iw,
                       eye_band["y1"] - eye_band["y0"] + 60),
                  f"{crops_dir}/{code}-eyes.png")
    if mouth_band:
        save_crop(im, (ix, mouth_band["y0"] - 40, iw,
                       mouth_band["y1"] - mouth_band["y0"] + 120),
                  f"{crops_dir}/{code}-mouth.png")
    rec["crops"] = [f"{code}-face.png",
                    f"{code}-eyes.png",
                    f"{code}-mouth.png"]
    return rec


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: measure5.py <assetDir> <outJson> <cropsDir>")
    asset_dir, out_json, crops_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    src = f"{asset_dir}/source/operator-approved"
    out = {}
    for code in ALL + [FULLBODY]:
        out[code] = analyze(code, load_rgba(f"{src}/{code}-{NAMES[code]}.png"),
                            crops_dir)
    with open(out_json, "w") as f:
        json.dump(out, f, indent=2)
    summary = {c: {"face": v.get("faceBox"), "eyePair": v.get("eyePair"),
                   "eyePairFallback": v.get("eyePairFallback"),
                   "eyeBand": v.get("eyeBand"),
                   "mouthBand": v.get("mouthBand"),
                   "mouthBlob": v.get("mouthBlob")}
               for c, v in out.items()}
    print(json.dumps({"written": out_json, "cropsDir": crops_dir,
                      "summary": summary}))


if __name__ == "__main__":
    main()
