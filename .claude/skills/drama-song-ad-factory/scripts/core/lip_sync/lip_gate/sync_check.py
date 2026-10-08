#!/usr/bin/env python3
"""sync_check.py: the LOOSER lip-sync sync measurement (LSL001, Trevor 2026-10-08).

The old rule (all four of corr >= .50, |lag| <= 4 frames, margin >= .08, z >= 1.5)
was tuned on spoken lines only and failed most SUNG clips: on a held note the
mouth stays open while the voice holds steady, so plain correlation drops
although a person sees good sync. Now:

  * correlation is measured ONLY on frames where the voice is changing
    (onsets and syllable changes); held-note frames are skipped;
  * three verdicts, the same shape as Trevor's 5/10 band:
      PASS              clearly matches
      ACCEPT_WITH_FLAG  borderline: accepted and used, flag written in the receipt
      FAIL              clearly wrong: |lag| > FAIL_LAG_FRAMES, the WRONG audio
                        matches better than its own, or the face is still / not found
      UNMEASURED        cannot be measured (no mediapipe, no model, too few
                        changing frames). Reported, never a silent pass.

Cut-offs are calibrated on known-good controls by calibrate_sync.py (output in the PR).
Pure stdlib except the optional mediapipe landmark reader (heavy_slot governed).
"""
from __future__ import annotations

import math
import os
import sys

_core = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _core not in sys.path:
    sys.path.insert(0, _core)
import load_governor as _LG  # noqa: E402

PASS, FLAG, FAIL, UNMEASURED = "PASS", "ACCEPT_WITH_FLAG", "FAIL", "UNMEASURED"

# Calibrated by calibrate_sync.py (see PR control table).
CHANGE_FRAC = 0.25          # a frame "changes" when |d voice| >= this x the 90th-percentile |d voice|
MIN_CHANGING_FRAMES = 8
SEARCH_LAG_FRAMES = 6       # normal lag search window
WIDE_LAG_FRAMES = 12        # second look for 'timing is far off'
WIDE_GAIN = 0.10
PASS_CORR = 0.33            # changing-frame correlation for PASS
FLAG_CORR = 0.20            # below this the clip is FAIL-leaning but only FLAG unless a hard FAIL rule fires
PASS_LAG_FRAMES = 6
FAIL_LAG_FRAMES = 8         # "off by more than about 8 frames"
PASS_MARGIN = 0.005         # lead over the best OTHER line's audio for PASS
FAIL_MARGIN = -0.005        # wrong audio matches better than its own by more than this = FAIL
MIN_MOUTH_RANGE = 0.015     # p95-p5 of outer-lip height / face height; below = still face
MIN_FACE_FOUND = 0.80       # fraction of frames with a face; below = face not found

REASON_LAG = "SYNC_LAG_OVER_8_FRAMES"
REASON_WRONG_AUDIO = "SYNC_WRONG_AUDIO_MATCHES_BETTER"
REASON_STILL = "SYNC_FACE_STILL"
REASON_NO_FACE = "SYNC_FACE_NOT_FOUND"
REASON_UNMEASURED = "SYNC_UNMEASURED"


def _pearson(a, b):
    n = len(a)
    if n < 3 or n != len(b):
        return 0.0
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va <= 1e-12 or vb <= 1e-12:
        return 0.0
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (va * vb) ** 0.5


def changing_mask(x):
    """True where the series is changing (onset / syllable change), dilated 1
    frame each side. Held notes (steady energy) are False."""
    n = len(x)
    d = [0.0] + [abs(x[i] - x[i - 1]) for i in range(1, n)]
    ref = sorted(d)[int(0.9 * (n - 1))] if n else 0.0
    hit = [v >= CHANGE_FRAC * ref and v > 1e-9 for v in d]
    return [any(hit[max(0, i - 1):i + 2]) for i in range(n)]


def smooth(x, w=3):
    h = w // 2
    return [sum(x[max(0, i - h):i + h + 1]) / len(x[max(0, i - h):i + h + 1]) for i in range(len(x))]


def prep_voice(env):
    """Log-compress (so quiet syllables count) and smooth 3 frames."""
    m = max(env) if env else 0.0
    return smooth([math.log(v + 0.02 * m + 1e-9) for v in env])


def best_corr(mouth, voice, max_lag):
    """(corr, k, n_used). Pairs mouth[i] with voice[i+k]; k>0 = mouth EARLY.
    A pair counts unless BOTH are steady (held note, mouth held open): only
    frames where the voice or the mouth is changing are measured."""
    mm, vm = changing_mask(mouth), changing_mask(voice)
    best = (-2.0, 0, 0)
    for k in range(-max_lag, max_lag + 1):
        ms, vs = [], []
        for i in range(len(mouth)):
            j = i + k
            if 0 <= j < len(voice) and (mm[i] or vm[j]):
                ms.append(mouth[i])
                vs.append(voice[j])
        if len(ms) >= MIN_CHANGING_FRAMES:
            c = _pearson(ms, vs)
            if c > best[0]:
                best = (c, k, len(ms))
    return best if best[2] else (0.0, 0, 0)


def measure_sync(mouth, voice, others, fps, face_found=1.0):
    """mouth: per-frame mouth opening (outer-lip / face height); voice: its audio
    envelope at the same rate; others: envelopes of OTHER lines (wrong-audio
    control, one series or a list). Returns the measurement dict."""
    if others and not isinstance(others[0], (list, tuple)):
        others = [others]
    if not mouth or not voice or fps <= 0 or not others:
        raise ValueError(REASON_UNMEASURED)
    mouth, voice = smooth(list(mouth)), prep_voice(list(voice))
    corr, k, used = best_corr(mouth, voice, SEARCH_LAG_FRAMES)
    if used < MIN_CHANGING_FRAMES:
        raise ValueError(REASON_UNMEASURED)
    wide, kw, _ = best_corr(mouth, voice, WIDE_LAG_FRAMES)
    if abs(kw) > FAIL_LAG_FRAMES and wide >= corr + WIDE_GAIN:
        corr, k = wide, kw          # a clearly better alignment far away: timing is off
    ctrl = max(best_corr(mouth, prep_voice(list(o)), SEARCH_LAG_FRAMES)[0] for o in others)
    n = len(mouth)
    s = sorted(mouth)
    rng = s[int(0.95 * (n - 1))] - s[int(0.05 * (n - 1))]
    return {"corr": round(corr, 4), "offset_frames": -k, "offset_s": round(-k / fps, 4),
            "control_corr": round(ctrl, 4), "margin": round(corr - ctrl, 4),
            "changing_frames": used, "frames": n, "mouth_range": round(rng, 4),
            "face_found": round(face_found, 3), "fps": fps}


def judge_sync(m):
    """PASS / ACCEPT_WITH_FLAG / FAIL for one measurement. Adds verdict,
    reasons (FAIL) and flags (ACCEPT_WITH_FLAG, to be written in the receipt)."""
    fails = []
    if m.get("face_found", 1.0) < MIN_FACE_FOUND:
        fails.append(REASON_NO_FACE)
    if m.get("mouth_range", 1.0) < MIN_MOUTH_RANGE:
        fails.append(REASON_STILL)
    if abs(m["offset_frames"]) > FAIL_LAG_FRAMES:
        fails.append(REASON_LAG)
    if m["margin"] < FAIL_MARGIN:
        fails.append(REASON_WRONG_AUDIO)
    if fails:
        return dict(m, verdict=FAIL, reasons=fails, flags=[])
    flags = []
    if m["corr"] < PASS_CORR:
        flags.append("corr %.2f < %.2f" % (m["corr"], PASS_CORR))
    if abs(m["offset_frames"]) > PASS_LAG_FRAMES:
        flags.append("offset %d frames > %d" % (abs(m["offset_frames"]), PASS_LAG_FRAMES))
    if m["margin"] < PASS_MARGIN:
        flags.append("margin %.2f < %.2f" % (m["margin"], PASS_MARGIN))
    return dict(m, verdict=FLAG if flags else PASS, reasons=[], flags=flags)


def unmeasured(why):
    return {"verdict": UNMEASURED, "reasons": [REASON_UNMEASURED], "flags": [], "why": str(why)}


# ---------------------------------------------- optional mediapipe reader ----

def face_model_path():
    """face_landmarker.task: $LIPSYNC_FACE_MODEL, else beside this file."""
    return os.environ.get("LIPSYNC_FACE_MODEL") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "face_landmarker.task")


def mouth_series_landmarks(clip):
    """-> (fps, mouth_series, face_found). Ported from the fixer tool
    (drama-song-factory-build/run/lipsync-check): outer-lip height / face
    height, face re-detected on a 3x crop. Runs in a heavy_slot. Raises
    RuntimeError(SYNC_UNMEASURED ...) when mediapipe / opencv / the model is
    missing: the caller reports UNMEASURED, never a pass."""
    try:
        import cv2
        import numpy as np
        import mediapipe as mp
        from mediapipe.tasks.python import vision, BaseOptions
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("%s: mediapipe/opencv unavailable (%s)" % (REASON_UNMEASURED, e))
    model = face_model_path()
    if not os.path.exists(model):
        raise RuntimeError("%s: face model not found at %s" % (REASON_UNMEASURED, model))
    with _LG.heavy_slot("lip-sync-landmarks"):
        cap = cv2.VideoCapture(clip)
        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model),
            running_mode=vision.RunningMode.IMAGE, num_faces=1))

        def det(bgr):
            return lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                                      data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))

        def ratio(p):
            return abs(p[17].y - p[0].y) / max(abs(p[152].y - p[10].y), 1e-6)
        out = []
        while True:
            ok, f = cap.read()
            if not ok:
                break
            r = det(f)
            H, W = f.shape[:2]
            if not r.face_landmarks:
                out.append(None)
                continue
            p = r.face_landmarks[0]
            v = ratio(p)
            xs = np.array([q.x * W for q in p])
            ys = np.array([q.y * H for q in p])
            s = max(np.ptp(xs), np.ptp(ys)) * 0.8
            x0, y0 = int(max(xs.mean() - s, 0)), int(max(ys.mean() - s, 0))
            x1, y1 = int(min(xs.mean() + s, W)), int(min(ys.mean() + s, H))
            if x1 - x0 > 20 and y1 - y0 > 20:
                r2 = det(cv2.resize(f[y0:y1, x0:x1], None, fx=3, fy=3,
                                    interpolation=cv2.INTER_CUBIC))
                if r2.face_landmarks:
                    v = ratio(r2.face_landmarks[0])
            out.append(v)
    seen = [v for v in out if v is not None]
    if not seen:
        return fps, [0.0] * len(out), 0.0
    last, filled = seen[0], []
    for v in out:                      # hold the last value across dropouts
        last = v if v is not None else last
        filled.append(last)
    return fps, filled, len(seen) / len(out)


def measure_clip_landmarks(clip, audio, others, ffmpeg="ffmpeg"):
    """Whole-clip measurement + verdict from files. Heavy work is governed.
    A missing mediapipe returns the UNMEASURED verdict, never a pass."""
    import lip_gate as LG  # envelope() runs ffmpeg through the load governor
    try:
        fps, mouth, found = mouth_series_landmarks(clip)
        env = LG.envelope(audio, fps=int(round(fps)), ffmpeg=ffmpeg)
        oth = [LG.envelope(o, fps=int(round(fps)), ffmpeg=ffmpeg) for o in others]
        return judge_sync(measure_sync(mouth, env, oth, fps, found))
    except (RuntimeError, ValueError) as e:
        return unmeasured(e)
