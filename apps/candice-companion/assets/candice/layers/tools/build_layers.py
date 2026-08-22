#!/usr/bin/env python3
"""FIX-005 — build registered mouth/eye layers from canonical operator art.

Inputs:  assets/candice/source/operator-approved/{03..09}.png (read-only).
Outputs (under assets/candice/layers/):
  assets/base-neutral.png            (base 03, full-frame, baked identity)
  assets/mouth-<state>.png           (minimal mouth-region layers)
  assets/eye-open.png                (minimal eye-band layer from 09)
  assets/eye-half.png                (derived lid wipe, approval-required)
  assets/eye-closed.png              (derived lid wipe, approval-required)
  build/manifest.json  build/registration.json  build/build.log

Registration model (runtime contract):
  canvas 1254x1254 base space == canonical frame 03.
  Z-order: base layer at BASE_ORIGIN, then mouth layer at MOUTH_RECT origin,
  then eye layer at EYE_RECT origin. State change swaps the image inside a
  fixed rect; the rect never moves. Eye rect derives from the base-03
  registered eye boxes + margin. Mouth rect derives from MEASURED
  mouth-interior dark blobs in every canonical frame (axis-constrained
  below the eye pair), transformed to base space through each frame's
  eye-pair affine and unioned + margin. Placement is deterministic — fixed
  at build time, never measured per render.

Bake method: per source, affine (translate+scale+rotate) mapping source
space -> base space, from the source eye pair vs the base-03 eye pair,
warped with INTER_NEAREST (no new colors), cropped to the fixed region
rect. mouth-open-small/medium/wide/smile states come from 04/05/06/07/08.

eye-half/eye-closed derive from 09 by lid wipe inside EYE_RECT (spec
FIX-005 step 5: synthesized states flagged approvalRequired). Frame 11 is
excluded from pixel authority: different batch/lighting/framing; it stays
manifest metadata only.

Idempotent; stdout = one JSON line.

Command: /usr/bin/python3 build_layers.py <assetDir>
"""
import json
import os
import sys

import cv2
import numpy as np

BASE = "03"
NAMES = {
    "03": "mouth-neutral-closed",
    "04": "mouth-slight-open",
    "05": "mouth-medium-open",
    "06": "mouth-wide-open",
    "07": "mouth-smile-closed",
    "08": "mouth-smile-open",
    "09": "eye-open",
}

# viseme -> canonical source
STATE_SOURCE = {
    "closed": "03",
    "open-small": "04",
    "open-medium": "05",
    "open-wide": "06",
    "smile-closed": "07",
    "smile-open": "08",
}

OUT = {
    "base": "base-neutral.png",
    "03": "mouth-neutral-closed.png",
    "04": "mouth-open-small.png",
    "05": "mouth-open-medium.png",
    "06": "mouth-open-wide.png",
    "07": "mouth-smile-closed.png",
    "08": "mouth-smile-open.png",
    "09": "eye-open.png",
    "eye-half": "eye-half.png",
    "eye-closed": "eye-closed.png",
}

ROLES = {
    "base": "face/base-neutral",
    "03": "mouth/closed",
    "04": "mouth/open-small",
    "05": "mouth/open-medium",
    "06": "mouth/open-wide",
    "07": "mouth/smile-closed",
    "08": "mouth/smile-open",
    "09": "eye/open",
    "eye-half": "eye/half-blink",
    "eye-closed": "eye/closed",
}

# Facial geometry constants (fractions of inter-eye distance, base space).
# Mouth rect is NOT derived from these: it is measured from mouth-interior
# dark blobs per frame (see mouth_interior_blob) and unioned in base space.
# These constants survive only as the blob-search envelope:
MOUTH_SEARCH_DY_MIN = 0.45   # mouth interior starts this far below eye mid
MOUTH_SEARCH_DY_MAX = 1.35   # mouth interior ends this far below eye mid
MOUTH_SEARCH_AXIS_TOL = 0.35  # |blob center x - eye mid x| must stay inside this * ied
MOUTH_MARGIN = 0.10          # margin around the unioned mouth region, * ied
EYE_MARGIN = 0.35

LID_RATIO_HALF = 0.5
LID_RATIO_CLOSED = 0.85

PAD = 4


def sha256_file(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rgba(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"cannot decode {path}")
    return im


def detect_faces(bgr):
    face_c = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    for scale in (1.0, 0.75, 0.5):
        h, w = bgr.shape[:2]
        small = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        found = face_c.detectMultiScale(small, 1.1, 5, minSize=(int(w * scale * 0.2), int(w * scale * 0.2)))
        if len(found):
            return [(int(x / scale), int(y / scale), int(ww / scale), int(hh / scale)) for (x, y, ww, hh) in found]
    return []


def _near(a, b, tol=0.3):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    iw = min(ax + aw, bx + bw) - max(ax, bx)
    ih = min(ay + ah, by + bh) - max(ay, by)
    if iw <= 0 or ih <= 0:
        return False
    return iw * ih >= tol * min(aw * ah, bw * bh)


def detect_eyes_in_face(bgr, face):
    eye_c = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
    fx, fy, fw, fh = face
    roi = bgr[max(0, fy):fy + fh, max(0, fx):fx + fw]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    found = []
    for sf, mn in ((1.05, 4), (1.03, 3), (1.03, 2)):
        boxes = eye_c.detectMultiScale(gray, sf, mn, minSize=(int(fw * 0.07), int(fw * 0.07)))
        for b in boxes:
            if not any(_near(b, ex) for ex in found):
                found.append(b)
    cands = []
    for (x, y, w, h) in found:
        cx = fx + x + w / 2.0
        cy = fy + y + h / 2.0
        if cy < fy + fh * 0.62:
            cands.append({"area": w * h, "cx": cx, "cy": cy, "w": w, "h": h, "box": (fx + x, fy + y, w, h)})
    return cands


def pick_eye_pair(cands, base_dist=None):
    if base_dist is None:
        # base frame: two largest, ordered by x
        cands = sorted(cands, key=lambda c: -c["area"])[:2]
        if len(cands) != 2:
            return None
        return tuple(sorted(cands, key=lambda c: c["cx"]))
    best = None
    for l in cands:
        for r in cands:
            if r is l or r["cx"] <= l["cx"]:
                continue
            dist = r["cx"] - l["cx"]
            if abs(dist - base_dist) > 0.35 * base_dist:
                continue
            dy = abs(l["cy"] - r["cy"])
            if dy > 0.20 * base_dist:
                continue
            score = l["area"] + r["area"]
            if best is None or score > best[0]:
                best = (score, (l, r))
    if best is None:
        cands = sorted(cands, key=lambda c: -c["area"])[:2]
        if len(cands) != 2:
            return None
        return tuple(sorted(cands, key=lambda c: c["cx"]))
    return best[1]


def dark_mask(im):
    """Dark interior pixels (mouth, lashes): gray<70 or low-sat dark value, opaque."""
    g = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2GRAY).astype(np.float32)
    hsv = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2].astype(np.float32)
    s = hsv[:, :, 1].astype(np.float32) / 255.0
    return ((g < 70) | ((v < 120) & (s < 0.7))) & (im[:, :, 3] > 128)


def mouth_interior_blob(im, eye_mid, ied, min_area=20):
    """Largest connected dark blob in the mouth search envelope.

    Envelope: x within +-1.0*ied of eye mid, y between eye_mid+0.45*ied and
    eye_mid+1.35*ied. Candidate blobs must also sit within
    MOUTH_SEARCH_AXIS_TOL*ied of the eye-mid x-axis (kills cheek/hair noise
    in smile frames 07/08). Returns (rect(x,y,w,h), area, center(x,y)) in
    source-frame pixels, or None.

    Measured: clean interior blobs on all 7 canonical frames, dy/ied
    0.94-1.00 (mouth sits ~1 inter-eye below the eye mid — not 0.55).
    """
    h, w = im.shape[:2]
    cx0 = max(0, int(eye_mid[0] - 1.0 * ied))
    cx1 = min(w, int(eye_mid[0] + 1.0 * ied))
    cy0 = max(0, int(eye_mid[1] + MOUTH_SEARCH_DY_MIN * ied))
    cy1 = min(h, int(eye_mid[1] + MOUTH_SEARCH_DY_MAX * ied))
    if cx1 <= cx0 or cy1 <= cy0:
        return None
    win = dark_mask(im)[cy0:cy1, cx0:cx1].astype(np.uint8)
    n, _, stats, cents = cv2.connectedComponentsWithStats(win, 8)
    best = None
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area < min_area:
            continue
        cxa = cx0 + cents[i][0]
        cya = cy0 + cents[i][1]
        if abs(cxa - eye_mid[0]) > MOUTH_SEARCH_AXIS_TOL * ied:
            continue
        if best is None or area > best[0]:
            best = (area, (int(cx0 + x), int(cy0 + y), int(ww), int(hh)),
                    (float(cxa), float(cya)))
    if best is None:
        return None
    return best[1], best[0], best[2]


def affine_from_pair(pair, base_pair):
    lc = np.array([pair[0]["cx"], pair[0]["cy"]], dtype=np.float64)
    rc = np.array([pair[1]["cx"], pair[1]["cy"]], dtype=np.float64)
    bl = np.array([base_pair[0]["cx"], base_pair[0]["cy"]], dtype=np.float64)
    br = np.array([base_pair[1]["cx"], base_pair[1]["cy"]], dtype=np.float64)
    v = rc - lc
    bv = br - bl
    scale = float(np.linalg.norm(bv) / np.linalg.norm(v))
    ang = float(np.arctan2(bv[1], bv[0]) - np.arctan2(v[1], v[0]))
    c, s = np.cos(ang), np.sin(ang)
    A = np.array([[c, -s], [s, c]], dtype=np.float64) * scale
    mid = (lc + rc) / 2.0
    bmid = (bl + br) / 2.0
    t = bmid - A @ mid
    return np.array([[A[0, 0], A[0, 1], t[0]], [A[1, 0], A[1, 1], t[1]]], dtype=np.float64), ang, scale


def warp_nearest(im, M, out_w, out_h):
    bgr = cv2.warpAffine(im[:, :, :3], M, (out_w, out_h), flags=cv2.INTER_NEAREST,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    a = cv2.warpAffine(im[:, :, 3], M, (out_w, out_h), flags=cv2.INTER_NEAREST,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return cv2.merge([bgr, a])


def rect_round(x0, y0, x1, y1, w, h):
    rx0 = max(0, int(round(x0)))
    ry0 = max(0, int(round(y0)))
    rx1 = min(w, int(round(x1)))
    ry1 = min(h, int(round(y1)))
    return rx0, ry0, rx1, ry1


def derive_eyelid(im, lid_ratio, rect, eye_boxes):
    """Lid wipe inside each eye column band (nearest-neighbor pushes)."""
    out = im.copy()
    x0, y0, x1, y1 = rect
    for (ex, ey, ew, eh) in eye_boxes:
        cx = ex + ew / 2.0
        half_w = int(ew * 1.1)
        bx0 = max(x0, int(cx - half_w))
        bx1 = min(x1, int(cx + half_w))
        top = max(y0, int(ey - 0.15 * eh))
        bottom = min(y1, int(ey + eh * 1.05))
        if bx1 <= bx0 or bottom <= top:
            continue
        band = out[top:bottom, bx0:bx1].copy()
        wipe = int((bottom - top) * lid_ratio)
        if wipe <= 0:
            continue
        band = np.roll(band, wipe, axis=0)
        band[:wipe, :] = band[wipe:wipe + 1, :]
        out[top:bottom, bx0:bx1] = band
    return out


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: build_layers.py <assetDir>")
    asset_dir = os.path.abspath(sys.argv[1])
    src = os.path.join(asset_dir, "source", "operator-approved")
    layers_dir = os.path.join(asset_dir, "layers")
    assets_dir = os.path.join(layers_dir, "assets")
    build_dir = os.path.join(layers_dir, "build")
    os.makedirs(assets_dir, exist_ok=True)
    os.makedirs(build_dir, exist_ok=True)

    log = []
    def say(msg):
        log.append(msg)

    # ---- 1. faces + eye pairs (try every face box, global pair score) ----
    info = {}
    base_dist = None
    for code in NAMES:
        path = os.path.join(src, f"{code}-{NAMES[code]}.png")
        im = load_rgba(path)
        faces = detect_faces(im[:, :, :3])
        if not faces:
            raise SystemExit(f"no face detected in {code}")
        best = None
        for face in faces:
            cands = detect_eyes_in_face(im[:, :, :3], face)
            pair = pick_eye_pair(cands, base_dist)
            if pair is None:
                continue
            dist = pair[1]["cx"] - pair[0]["cx"]
            score = pair[0]["area"] + pair[1]["area"]
            if base_dist is not None:
                score -= abs(dist - base_dist) * 20
            if best is None or score > best[0]:
                best = (score, face, pair)
        if best is None:
            raise SystemExit(f"no eye pair in {code}")
        _, face, pair = best
        if code == BASE:
            base_dist = pair[1]["cx"] - pair[0]["cx"]
        info[code] = {"im": im, "face": face, "pair": pair}
        say(f"{code}: face {face}, eyes L({pair[0]['cx']:.1f},{pair[0]['cy']:.1f}) R({pair[1]['cx']:.1f},{pair[1]['cy']:.1f})")

    base = info[BASE]
    bw, bh = base["im"].shape[1], base["im"].shape[0]

    # ---- 2. affines source -> base space ----
    # Round to 6 decimals IMMEDIATELY: the rounded values are what the
    # registration record ships, so the bake must use exactly those.
    transforms = {}
    for code in NAMES:
        M, ang, scale = affine_from_pair(info[code]["pair"], base["pair"])
        M = np.round(M, 6)
        transforms[code] = M
        say(f"{code}: affine angle {ang:.6f} rad, scale {scale:.6f}")

    # ---- 3. fixed region rects in base space ----
    bp = base["pair"]
    eye_mid = np.array([(bp[0]["cx"] + bp[1]["cx"]) / 2.0, (bp[0]["cy"] + bp[1]["cy"]) / 2.0])
    ied = base_dist

    # eye rect: cover both eye boxes with margin
    ex0 = min(bp[0]["box"][0], bp[1]["box"][0]) - EYE_MARGIN * ied
    ey0 = min(bp[0]["box"][1], bp[1]["box"][1]) - EYE_MARGIN * ied
    ex1 = max(bp[0]["box"][0] + bp[0]["box"][2], bp[1]["box"][0] + bp[1]["box"][2]) + EYE_MARGIN * ied
    ey1 = max(bp[0]["box"][1] + bp[0]["box"][3], bp[1]["box"][1] + bp[1]["box"][3]) + EYE_MARGIN * ied
    EYE_RECT = rect_round(ex0, ey0, ex1, ey1, bw, bh)

    # mouth rect: measured mouth-interior blobs per frame -> base space ->
    # union + margin. Never a fixed fraction of inter-eye distance.
    mouth_landmarks = []
    ux0 = uy0 = ux1 = uy1 = None
    for code in NAMES:
        fr = info[code]
        im = fr["im"]
        em = np.array([(fr["pair"][0]["cx"] + fr["pair"][1]["cx"]) / 2.0,
                       (fr["pair"][0]["cy"] + fr["pair"][1]["cy"]) / 2.0])
        fr_ied = fr["pair"][1]["cx"] - fr["pair"][0]["cx"]
        got = mouth_interior_blob(im, em, fr_ied)
        if got is None:
            say(f"{code}: NO mouth interior blob (axis-constrained search)")
            continue
        (bx, by, bwid, bht), area, (bcx, bcy) = got
        M = transforms[code]
        corners = np.array([[bx, by], [bx + bwid, by + bht]], dtype=np.float64)
        base_corners = (M[:, :2] @ corners.T).T + M[:, 2]
        (c0x, c0y), (c1x, c1y) = base_corners
        bbx0, bby0 = min(c0x, c1x), min(c0y, c1y)
        bbx1, bby1 = max(c0x, c1x), max(c0y, c1y)
        bc_base = M[:, :2] @ np.array([bcx, bcy]) + M[:, 2]
        mouth_landmarks.append({
            "code": code,
            "sourceRect": [int(bx), int(by), int(bwid), int(bht)],
            "sourceArea": int(area),
            "sourceCenter": [round(bcx, 2), round(bcy, 2)],
            "baseRect": [round(float(bbx0), 2), round(float(bby0), 2),
                         round(float(bbx1), 2), round(float(bby1), 2)],
            "baseCenter": [round(float(bc_base[0]), 2), round(float(bc_base[1]), 2)],
        })
        ux0 = bbx0 if ux0 is None else min(ux0, bbx0)
        uy0 = bby0 if uy0 is None else min(uy0, bby0)
        ux1 = bbx1 if ux1 is None else max(ux1, bbx1)
        uy1 = bby1 if uy1 is None else max(uy1, bby1)
        say(f"{code}: mouth blob src {got[0]} area {area} -> base "
            f"[{bbx0:.1f},{bby0:.1f},{bbx1:.1f},{bby1:.1f}]")
    if ux0 is None:
        raise SystemExit("no mouth interior blobs measured — cannot register mouth rect")
    m = MOUTH_MARGIN * ied
    MOUTH_RECT = rect_round(ux0 - m, uy0 - m, ux1 + m, uy1 + m, bw, bh)
    say(f"EYE_RECT {EYE_RECT} MOUTH_RECT {MOUTH_RECT} interEye {ied:.2f} "
        f"mouthLandmarks {len(mouth_landmarks)}")

    # eye boxes (base space) for lid wipe
    eye_boxes_base = [
        (int(bp[0]["box"][0]), int(bp[0]["box"][1]), int(bp[0]["box"][2]), int(bp[0]["box"][3])),
        (int(bp[1]["box"][0]), int(bp[1]["box"][1]), int(bp[1]["box"][2]), int(bp[1]["box"][3])),
    ]

    # ---- 4. bake layers ----
    warped = {}
    for code in NAMES:
        warped[code] = warp_nearest(info[code]["im"], transforms[code], bw, bh)

    files = {}
    # base: full-frame 03
    base_path = os.path.join(assets_dir, OUT["base"])
    cv2.imwrite(base_path, warped[BASE])
    files["base"] = base_path

    # mouth layers: warp + crop MOUTH_RECT
    for code in STATE_SOURCE.values():
        crop = warped[code][MOUTH_RECT[1]:MOUTH_RECT[3], MOUTH_RECT[0]:MOUTH_RECT[2]].copy()
        path = os.path.join(assets_dir, OUT[code])
        cv2.imwrite(path, crop)
        files[code] = path

    # eye layers: crop EYE_RECT
    eye_crop = warped["09"][EYE_RECT[1]:EYE_RECT[3], EYE_RECT[0]:EYE_RECT[2]].copy()
    eye_open_path = os.path.join(assets_dir, OUT["09"])
    cv2.imwrite(eye_open_path, eye_crop)
    files["09"] = eye_open_path

    half_im = derive_eyelid(warped["09"], LID_RATIO_HALF, EYE_RECT, eye_boxes_base)
    half_path = os.path.join(assets_dir, OUT["eye-half"])
    cv2.imwrite(half_path, half_im[EYE_RECT[1]:EYE_RECT[3], EYE_RECT[0]:EYE_RECT[2]].copy())
    files["eye-half"] = half_path

    closed_im = derive_eyelid(warped["09"], LID_RATIO_CLOSED, EYE_RECT, eye_boxes_base)
    closed_path = os.path.join(assets_dir, OUT["eye-closed"])
    cv2.imwrite(closed_path, closed_im[EYE_RECT[1]:EYE_RECT[3], EYE_RECT[0]:EYE_RECT[2]].copy())
    files["eye-closed"] = closed_path
    say("eye-half/eye-closed derived from 09 lid wipe; approvalRequired=true")

    # ---- 5. manifest + registration ----
    manifest = {"generatedBy": "FIX-005 build_layers.py", "layers": []}
    src_hashes = {code: sha256_file(os.path.join(src, f"{code}-{NAMES[code]}.png")) for code in NAMES}
    for key, path in files.items():
        cropped = load_rgba(path)
        h, w = cropped.shape[:2]
        src_ref = f"source/operator-approved/{key}-{NAMES[key]}.png" if key in NAMES else "source/operator-approved/09-eye-open.png (derived, lid wipe)"
        manifest["layers"].append({
            "id": key,
            "file": f"assets/{OUT[key]}",
            "role": ROLES[key],
            "source": src_ref,
            "sourceSha256": src_hashes.get(key, src_hashes["09"]),
            "outputSha256": sha256_file(path),
            "width": w,
            "height": h,
            "synthesized": key in ("eye-half", "eye-closed"),
            "approval": "pending-operator" if key in ("eye-half", "eye-closed") else "operator-approved",
        })

    registration = {
        "baseFrame": "03-mouth-neutral-closed",
        "baseCanvas": [bw, bh],
        "zOrder": ["base", "mouth", "eye"],
        "mouthRect": list(MOUTH_RECT),
        "eyeRect": list(EYE_RECT),
        "transforms": {code: [[round(float(v), 6) for v in row] for row in transforms[code]] for code in NAMES},
        "eyeBoxesBase": eye_boxes_base,
        "mouthLandmarks": mouth_landmarks,
        "mouthStates": {vis: {"source": src_code, "file": f"assets/{OUT[src_code]}"} for vis, src_code in STATE_SOURCE.items()},
        "eyeStates": {"open": "assets/eye-open.png", "half": "assets/eye-half.png", "closed": "assets/eye-closed.png"},
        "notes": [
            "Placement tolerance zero: fixed rects, images swapped in place.",
            "Mouth rect measured from mouth-interior dark blobs per canonical frame, transformed via eye-pair affines to base space, unioned with 0.10*ied margin.",
            "eye-half/eye-closed synthesized from 09; operator approval required.",
            "Frame 11 excluded from pixel authority (different batch/lighting).",
        ],
    }

    manifest_path = os.path.join(build_dir, "manifest.json")
    reg_path = os.path.join(build_dir, "registration.json")
    log_path = os.path.join(build_dir, "build.log")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    with open(reg_path, "w") as f:
        json.dump(registration, f, indent=2)
    with open(log_path, "w") as f:
        f.write("\n".join(log) + "\n")

    print(json.dumps({"ok": True, "layers": len(manifest["layers"]), "manifest": manifest_path,
                      "registration": reg_path, "log": log_path}))


if __name__ == "__main__":
    main()
