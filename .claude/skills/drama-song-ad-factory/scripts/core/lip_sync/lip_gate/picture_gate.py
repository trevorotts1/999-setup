#!/usr/bin/env python3
"""picture_gate.py: measured close-up gate + sha256 receipt (LPG001).

Why: the 30-Day Reset close-up (face 28% of frame, smile 0.62) and the Perfect
Daughter close-up (face 34%, teeth, roll -7.8 deg) went to paid Kling lip-sync
unmeasured. The check existed on paper only. Now:

  gate_picture(path)  measure -> free local crop if the face is small ->
                      (paid, capped) regenerate if smile/teeth/tilt -> receipt
  require_receipt()   the kie_dispatch hard block: no PASS receipt for the
                      exact bytes (sha256) of the image = no paid lip-sync job.

Fail closed everywhere: mediapipe missing, face model missing, unreadable image,
0 or 2+ faces, any number over its limit -> verdict FAIL / refusal.
Limits are calibrated on the real pictures: 28.1% and 34.4% fail, the fixed
37.8% crop passes (smile .36, roll -4.3, gap .03).
"""
from __future__ import annotations

import hashlib
import json
import os
import time

try:
    from . import picture_measure as PM
except ImportError:                    # script import (tests run from here)
    import picture_measure as PM

TOOL_NAME = "lipsync_picture_gate"
SCHEMA = "blackceo.lipsync-picture-receipt/v1"

# --- thresholds (named knobs) ------------------------------------------------
MIN_FACE_H_PCT = 35.0          # 28.1 and 34.4 fail; 36.8 / 37.8 pass
MAX_FACE_H_PCT = 45.0
MAX_ROLL_DEG = 5.0             # -7.8 fails
MAX_YAW_PROXY = 0.12
MAX_SMILE = 0.50               # .62 / .83 fail; .36 passes
MAX_JAW_OPEN = 0.15
MAX_INNER_GAP_PCT = 1.0        # lip gap / face height; teeth showing = 1.65+
MIN_SHARP_FACE_256 = 100.0
CROP_TARGET_PCT = 38.0         # free crop aims inside the 35-45 band
MAX_REGEN = 2

REGEN_PROMPT = ("neutral expression, lips closed, facing camera, head level")

REFUSED = "LIPSYNC_PICTURE_NOT_GATED"


class LipsyncPictureNotGated(Exception):
    """kie_dispatch refuses the paid lip-sync job. .reason is the full text."""

    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def check_numbers(n):
    """Pure rules. n = picture_measure.measure() dict -> list of (code, text)."""
    r = []
    c = n.get("face_count")
    if c != 1:
        return [("FACE_COUNT", "%s faces found; exactly one is required" % c)]

    def over(code, key, lim, label, lo=False):
        v = n.get(key)
        if not isinstance(v, (int, float)) or v != v:
            r.append((code, "%s not measured" % key))
        elif (v < lim) if lo else (abs(v) > lim):
            r.append((code, "%s %s %s the limit %s" % (
                label, v, "below" if lo else "over", lim)))
    v = n.get("face_h_pct")
    if not isinstance(v, (int, float)) or not MIN_FACE_H_PCT <= v <= MAX_FACE_H_PCT:
        r.append(("FACE_SIZE", "face is %s%% of frame height; need %g-%g%%"
                  % (v, MIN_FACE_H_PCT, MAX_FACE_H_PCT)))
    over("HEAD_ROLL", "roll_deg", MAX_ROLL_DEG, "head roll deg")
    over("HEAD_YAW", "yaw_proxy", MAX_YAW_PROXY, "yaw proxy")
    over("SMILE", "smile", MAX_SMILE, "smile blendshape")
    over("MOUTH_OPEN", "jaw_open", MAX_JAW_OPEN, "jawOpen blendshape")
    over("TEETH", "inner_gap_pct", MAX_INNER_GAP_PCT, "lip gap %% of face")
    over("SOFT", "sharp_face_256", MIN_SHARP_FACE_256, "sharpness", lo=True)
    return r


def write_receipt(path, sha, verdict, numbers, reasons, attempts, receipt_dir):
    os.makedirs(receipt_dir, exist_ok=True)
    rec = {"schema": SCHEMA, "tool": TOOL_NAME, "image": os.path.abspath(path),
           "sha256": sha, "verdict": verdict, "numbers": numbers,
           "reasons": [list(x) for x in reasons], "attempts": attempts,
           "limits": {"face_h_pct": [MIN_FACE_H_PCT, MAX_FACE_H_PCT],
                      "roll_deg": MAX_ROLL_DEG, "yaw_proxy": MAX_YAW_PROXY,
                      "smile": MAX_SMILE, "jaw_open": MAX_JAW_OPEN,
                      "inner_gap_pct": MAX_INNER_GAP_PCT,
                      "sharp_face_256": MIN_SHARP_FACE_256},
           "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    p = os.path.join(receipt_dir, sha + ".json")
    with open(p, "w") as f:
        json.dump(rec, f, indent=1, sort_keys=True)
    return rec


def default_receipt_dir(path):
    return os.path.join(os.path.dirname(os.path.abspath(path)), ".lipgate")


def gate_picture(path, receipt_dir=None, measure=None, crop=None,
                 regenerate=None, max_regen=MAX_REGEN):
    """Measure one close-up; fix it for free first; write a receipt per picture
    tried. Returns {"verdict", "image", "sha256", "numbers", "reasons",
    "attempts"} for the FINAL picture (its path is "image").

    measure(path) -> numbers      default picture_measure.measure
    crop(path, out) -> out|None   default picture_measure.crop_to_face (free)
    regenerate(path, prompt) -> new_path   the PAID gpt-image-2 image-to-image
        from the 3D character with REGEN_PROMPT. It MUST go through
        kie_dispatch so it reserves against the author's cap; None = no paid
        fix (the picture stays FAIL).
    """
    measure = measure or PM.measure
    crop = crop or PM.crop_to_face
    rdir = receipt_dir or default_receipt_dir(path)
    attempts, cur, regens = [], path, 0
    cropped = False
    while True:
        sha = sha256_file(cur)
        try:
            nums = measure(cur)
            reasons = check_numbers(nums)
        except PM.PictureGateUnavailable as exc:
            nums, reasons = {}, [("GATE_UNAVAILABLE", str(exc))]
        except Exception as exc:                       # fail closed
            nums, reasons = {}, [("MEASURE_ERROR", "%s: %s" % (type(exc).__name__, exc))]
        codes = {c for c, _ in reasons}
        verdict = "FAIL" if reasons else "PASS"
        attempts.append({"image": cur, "sha256": sha, "numbers": nums,
                         "verdict": verdict, "reasons": [list(x) for x in reasons]})
        rec = write_receipt(cur, sha, verdict, nums, reasons, attempts, rdir)
        if verdict == "PASS" or codes & {"GATE_UNAVAILABLE", "MEASURE_ERROR", "FACE_COUNT"}:
            return dict(rec, image=cur)
        if not cropped and codes == {"FACE_SIZE"} and nums.get("face_h_pct", 100) < MIN_FACE_H_PCT:
            cropped = True                                  # free, local, once
            out = os.path.splitext(cur)[0] + "-crop.png"
            if crop(cur, out):
                cur = out
                continue
        if regenerate is None or regens >= max_regen:
            return dict(rec, image=cur)
        regens += 1                                          # paid, capped
        cur = regenerate(cur, REGEN_PROMPT)
        cropped = False


def require_receipt(path, receipt_dir=None):
    """The dispatcher block. Returns the receipt, or raises
    LipsyncPictureNotGated naming exactly what is wrong."""
    if not isinstance(path, str) or not path or not os.path.isfile(path):
        raise LipsyncPictureNotGated(
            "%s: lip-sync source picture is not a readable local file (%r); "
            "run gate_picture() on it first" % (REFUSED, path))
    sha = sha256_file(path)
    rp = os.path.join(receipt_dir or default_receipt_dir(path), sha + ".json")
    try:
        with open(rp) as f:
            rec = json.load(f)
    except (OSError, ValueError):
        raise LipsyncPictureNotGated(
            "%s: no gate receipt for %s (sha256 %s); measure it with "
            "gate_picture() before any paid lip-sync job" % (REFUSED, path, sha[:12]))
    if rec.get("sha256") != sha or rec.get("verdict") != "PASS":
        raise LipsyncPictureNotGated(
            "%s: receipt for %s is %s, not PASS (%s)" % (
                REFUSED, path, rec.get("verdict"),
                "; ".join("%s: %s" % tuple(x) for x in rec.get("reasons", []))))
    return rec
