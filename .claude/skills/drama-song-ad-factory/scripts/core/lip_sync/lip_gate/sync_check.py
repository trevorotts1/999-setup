#!/usr/bin/env python3
"""sync_check.py: lip-sync sync measurement (LSL002), a faithful port of the fixer window's
VALIDATED checker (run/lipsync-check/lipsync_check_v2.py, SELFTEST PASS) plus Trevor's looser verdicts.

Measurement (stdlib only; the same numbers as the fixer tool):
  * mouth opening per frame (outer-lip height / face height) against the log, 3-frame smoothed
    voice-energy envelope; best Pearson over lags -MAX_LAG..+MAX_LAG frames (+ = mouth LATE);
  * the clip is CUT to the audio length (Kling pads the video tail);
  * chance test: the same audio ROLLED by 15+ frames (step 3); `pct` = share of rolls that score
    as high as the real audio. Chance level needs pct <= CHANCE_PCT;
  * margin = corr minus the best score of the OTHER lines' audio, after dropping "other lines"
    whose envelope matches this audio (a repeated hook, envelope corr >= LOOKALIKE);
  * grade: NOT_SYNCED when corr < CORR_FLOOR, or pct > CHANCE_PCT, or margin < MARGIN_FLOOR;
    else SYNCED at margin >= SYNCED_MARGIN, WEAK from MARGIN_FLOOR to SYNCED_MARGIN
    (WEAK also when no distinct other line is left to compare against);
  * UNMEASURABLE (never a pass): under MIN_FRAMES, face found in < MIN_FACE_FOUND of frames,
    mouth not at human proportions, silent audio, mouth range < MIN_MOUTH_RANGE (still face),
    fewer than MIN_OTHERS other lines, or no mediapipe / face model.

Verdicts in the skill (Trevor: "loosen the checks so it's not as strict"):
  SYNCED -> PASS                      WEAK -> ACCEPT_WITH_FLAG (used, flag in the receipt)
  NOT_SYNCED -> FAIL on a SPOKEN line
  On a SUNG line WEAK or NOT_SYNCED -> UNDETERMINED: held for a person to look at a mouth strip,
  NO automatic paid redo (diagnosis: 1 of 99 redos ever passed). UNMEASURABLE is reported, never a pass.
Pure stdlib except the optional mediapipe landmark reader (load_governor.heavy_slot governed).
"""
from __future__ import annotations

import array
import math
import os
import statistics
import subprocess
import sys

_core = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _core not in sys.path:
    sys.path.insert(0, _core)
import load_governor as _LG  # noqa: E402

PASS, FLAG, FAIL = "PASS", "ACCEPT_WITH_FLAG", "FAIL"
UNDETERMINED, UNMEASURABLE = "UNDETERMINED", "UNMEASURABLE"
UNMEASURED = UNMEASURABLE                      # old name, same value
SYNCED, WEAK, NOT_SYNCED = "SYNCED", "WEAK", "NOT_SYNCED"

# ---- constants block: identical in 999-setup and openclaw-onboarding -------------------------
MAX_LAG = 10                # lag search +-10 frames
CORR_FLOOR = 0.40           # best correlation floor
MARGIN_FLOOR = 0.0          # lead over the best distinct other line: below = NOT_SYNCED
SYNCED_MARGIN = 0.05        # margin >= this = SYNCED; MARGIN_FLOOR..this = WEAK
CHANCE_PCT = 0.20           # share of rolled-audio scores >= the real one; above = NOT_SYNCED
ROLL_MIN, ROLL_STEP = 15, 3
LOOKALIKE = 0.85            # other line whose envelope corr with this audio >= this is a repeated hook: dropped
MIN_FRAMES = 45
MIN_FACE_FOUND = 0.95
MOUTH_GEO = (0.55, 0.85)    # mouth position inside the face box (human proportions)
MIN_MOUTH_RANGE = 0.015     # p95-p5 of mouth opening / face height; below = still face
MIN_OTHERS = 2
SILENT = 1e-4
SR = 16000
MAX_PAID_ATTEMPTS = 2       # Trevor's 2-try rule
# -----------------------------------------------------------------------------------------------

REASON_CORR = "SYNC_CORR_BELOW_FLOOR"
REASON_CHANCE = "SYNC_NOT_ABOVE_CHANCE"
REASON_WRONG_AUDIO = "SYNC_WRONG_AUDIO_MATCHES_BETTER"
REASON_UNMEASURED = "SYNC_UNMEASURABLE"
_FAIL_CODES = {"corr": REASON_CORR, "pct": REASON_CHANCE, "margin": REASON_WRONG_AUDIO}


def _smooth(x):
    n = len(x)
    return [0.25 * x[max(i - 1, 0)] + 0.5 * x[i] + 0.25 * x[min(i + 1, n - 1)] for i in range(n)]


def _prep(env):
    m = max(env)
    return _smooth([math.log(v + 0.02 * m + 1e-12) for v in env])


def _pearson(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va / n <= 1e-18 or vb / n <= 1e-18:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def _best(m, e):
    """(lag, corr): best Pearson of m[t] against e[t-lag]; lag > 0 = mouth LATE."""
    best = None
    for lag in range(-MAX_LAG, MAX_LAG + 1):
        a, b = (m[lag:], e[:len(e) - lag]) if lag >= 0 else (m[:lag], e[-lag:])
        k = min(len(a), len(b))
        if k < 8:
            continue
        c = _pearson(a[:k], b[:k])
        if c is not None and (best is None or c > best[1]):
            best = (lag, c)
    return best or (0, 0.0)


def _percentile(x, q):
    s = sorted(x)
    pos = (len(s) - 1) * q / 100.0
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def _fill(x):
    """Linear fill of None gaps; ends hold the nearest value."""
    idx = [i for i, v in enumerate(x) if v is not None]
    out = list(x)
    for i, v in enumerate(x):
        if v is not None:
            continue
        lo = max((j for j in idx if j < i), default=None)
        hi = min((j for j in idx if j > i), default=None)
        if lo is None:
            out[i] = x[hi]
        elif hi is None:
            out[i] = x[lo]
        else:
            out[i] = x[lo] + (x[hi] - x[lo]) * (i - lo) / (hi - lo)
    return out


def _fit(env, n):
    return list(env[:n]) + [0.0] * max(0, n - len(env))


def unmeasurable(why, **extra):
    return dict(extra, grade=UNMEASURABLE, why=str(why))


def measure_sync(mouth, voice, others, fps, geo=0.7):
    """mouth: per-frame mouth opening (None = no face); voice: its audio envelope (raw RMS per frame);
    others: envelopes of the OTHER lines (list of series). Both are cut to the shorter of the two
    (the audio length), others are zero-padded to it. Returns the measurement dict; grade is
    SYNCED / WEAK / NOT_SYNCED / UNMEASURABLE. Never raises on bad footage."""
    if others and not isinstance(others[0], (list, tuple)):
        others = [others]
    n = min(len(mouth), len(voice))
    mouth, voice = list(mouth[:n]), list(voice[:n])
    found = (sum(v is not None for v in mouth) / n) if n else 0.0
    base = {"frames": n, "face_found": round(found, 3), "fps": fps}
    if n < MIN_FRAMES:
        return unmeasurable("clip too short: %d frames < %d" % (n, MIN_FRAMES), **base)
    if found < MIN_FACE_FOUND:
        return unmeasurable("face found in %.0f%% of frames (< %.0f%%)" % (100 * found, 100 * MIN_FACE_FOUND), **base)
    if not (MOUTH_GEO[0] <= geo <= MOUTH_GEO[1]):
        return unmeasurable("landmarks implausible (mouth at %.2f of face height, want %s): not a human-proportioned face" % (geo, MOUTH_GEO), **base)
    m = _fill(mouth)
    rng = _percentile(m, 95) - _percentile(m, 5)
    base["mouth_range"] = round(rng, 4)
    if max(voice) < SILENT:
        return unmeasurable("audio silent", **base)
    if rng < MIN_MOUTH_RANGE:
        return unmeasurable("mouth barely moves (range %.4f < %s): still face" % (rng, MIN_MOUTH_RANGE), **base)
    if len(others) < MIN_OTHERS:
        return unmeasurable("need >= %d other lines for the control test" % MIN_OTHERS, **base)
    ms, ev = _smooth(m), _prep(voice)
    lag, corr = _best(ms, ev)
    rolls = [_best(ms, _prep(voice[-k:] + voice[:-k]))[1] for k in range(ROLL_MIN, n - ROLL_MIN, ROLL_STEP)]
    pct = sum(r >= corr for r in rolls) / len(rolls)
    oc, dropped = [], 0
    for o in others:
        eo = _prep(_fit(o, n)) if max(_fit(o, n)) > 0 else None
        if eo is not None and (_pearson(ev, eo) or 0.0) >= LOOKALIKE:
            dropped += 1                  # a repeated hook is not "wrong audio"
            continue
        oc.append(_best(ms, eo)[1] if eo is not None else -1.0)
    margin = corr - max(oc) if oc else None
    fails = []
    if corr < CORR_FLOOR:
        fails.append("corr")
    if pct > CHANCE_PCT:
        fails.append("pct")
    if margin is not None and margin < MARGIN_FLOOR:
        fails.append("margin")
    grade = NOT_SYNCED if fails else (SYNCED if margin is not None and margin >= SYNCED_MARGIN else WEAK)
    return dict(base, grade=grade, corr=round(corr, 4), offset_frames=lag, offset_s=round(lag / fps, 4),
                pct=round(pct, 3), control_corr=round(max(oc), 4) if oc else None,
                margin=None if margin is None else round(margin, 4), others_dropped_lookalike=dropped,
                failed=fails)


def judge_sync(m, sung=False):
    """Grade -> skill verdict. PASS / ACCEPT_WITH_FLAG / FAIL / UNDETERMINED / UNMEASURABLE; adds
    reasons (FAIL), flags (receipt note) and hold_for_review (UNDETERMINED: a person looks, no paid redo)."""
    g = m["grade"]
    if g == UNMEASURABLE:
        return dict(m, verdict=UNMEASURABLE, reasons=[REASON_UNMEASURED], flags=[], hold_for_review=False)
    if g == SYNCED:
        return dict(m, verdict=PASS, reasons=[], flags=[], hold_for_review=False)
    why = ["margin %s over the best distinct other line (< %.2f): cannot be told from other audio, look by eye"
           % (m["margin"], SYNCED_MARGIN)] if g == WEAK else [
        "%s (corr %.2f, chance share %.2f, margin %s)" % (",".join(m["failed"]), m["corr"], m["pct"], m["margin"])]
    if sung:
        return dict(m, verdict=UNDETERMINED, reasons=[], flags=["SUNG line, %s: held for a mouth-strip look, no paid redo" % g] + why,
                    hold_for_review=True)
    if g == WEAK:
        return dict(m, verdict=FLAG, reasons=[], flags=why, hold_for_review=False)
    return dict(m, verdict=FAIL, reasons=[_FAIL_CODES[f] for f in m["failed"]], flags=[], hold_for_review=False)


def unmeasured(why):
    return {"grade": UNMEASURABLE, "verdict": UNMEASURABLE, "reasons": [REASON_UNMEASURED], "flags": [],
            "hold_for_review": False, "why": str(why)}


# ---------------------------------------------- optional mediapipe reader ----

def face_model_path():
    """Same path / env var as the picture gate (picture_measure.py, PR #72 / 999 #72), so the two
    lip-sync checks share ONE installed model: $LIPSYNC_FACE_MODEL, else <skill>/assets/face_landmarker.task."""
    p = os.environ.get("LIPSYNC_FACE_MODEL")
    if not p:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "assets", "face_landmarker.task")
    return os.path.abspath(p)


def read_mouth(clip):
    """-> (fps, rows); row = None (no face) or (mouth opening, mouth position in face). Ported from the
    fixer tool (outer-lip height / face height, face re-detected on a 3x crop). Runs in a heavy_slot.
    RuntimeError(SYNC_UNMEASURABLE ...) when mediapipe / opencv / the model is missing."""
    try:
        import cv2
        import numpy as np
        import mediapipe as mp
        from mediapipe.tasks.python import vision, BaseOptions
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("%s: mediapipe/opencv unavailable (%s)" % (REASON_UNMEASURED, e))
    model = face_model_path()
    if not os.path.isfile(model):
        raise RuntimeError("%s: face model not found at %s (set LIPSYNC_FACE_MODEL)" % (REASON_UNMEASURED, model))
    with _LG.heavy_slot("lip-sync-landmarks"):
        cap = cv2.VideoCapture(clip)
        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model),
            running_mode=vision.RunningMode.IMAGE, num_faces=1))

        def det(bgr):
            return lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))

        def row(p):
            fh = max(abs(p[152].y - p[10].y), 1e-6)
            return abs(p[17].y - p[0].y) / fh, (p[13].y - p[10].y) / fh
        rows = []
        while True:
            ok, f = cap.read()
            if not ok:
                break
            r = det(f)
            H, W = f.shape[:2]
            if not r.face_landmarks:
                rows.append(None)
                continue
            p = r.face_landmarks[0]
            xs = np.array([q.x * W for q in p])
            ys = np.array([q.y * H for q in p])
            s = max(np.ptp(xs), np.ptp(ys)) * 0.8
            x0, y0 = int(max(xs.mean() - s, 0)), int(max(ys.mean() - s, 0))
            x1, y1 = int(min(xs.mean() + s, W)), int(min(ys.mean() + s, H))
            if x1 - x0 > 20 and y1 - y0 > 20:
                r2 = det(cv2.resize(f[y0:y1, x0:x1], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC))
                if r2.face_landmarks:
                    p = r2.face_landmarks[0]
            rows.append(row(p))
    return fps, rows


def read_audio(path, ffmpeg="ffmpeg"):
    """Mono 16 kHz samples (floats, -1..1) of the audio. ffmpeg runs through the load governor."""
    p = _LG.run_ffmpeg([ffmpeg, "-v", "error", "-threads", "4", "-i", path, "-vn", "-ac", "1",
                        "-ar", str(SR), "-f", "s16le", "-"], "lip-sync-audio",
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError("%s: ffmpeg failed on %s: %s" % (REASON_UNMEASURED, path, p.stderr[-200:]))
    s = array.array("h")
    s.frombytes(p.stdout[:len(p.stdout) // 2 * 2])
    return [v / 32768.0 for v in s]


def frame_env(samples, fps, n):
    """RMS energy per clip frame (n frames; zeros past the end of the audio)."""
    h, out = SR / fps, []
    for i in range(n):
        s, t = int(i * h), int((i + 1) * h)
        seg = samples[s:t] if s < len(samples) and t > s else []
        out.append(math.sqrt(sum(v * v for v in seg) / len(seg)) if seg else 0.0)
    return out


def measure_features(fps, rows, audio, others):
    """Measurement from read_mouth() rows and audio samples (read_audio()): cuts the video to the
    audio length, builds the envelopes, runs measure_sync. Shared by the clip reader and calibrate_sync.py."""
    n = min(len(rows), int(round(len(audio) / SR * fps)) + 1)     # Kling pads the video: cut to the audio
    used = rows[:n]
    geos = [r[1] for r in used if r]
    return measure_sync([r[0] if r else None for r in used], frame_env(audio, fps, n),
                        [frame_env(o, fps, n) for o in others], fps, statistics.median(geos) if geos else 0.0)


def measure_clip_landmarks(clip, audio, others, sung=False, ffmpeg="ffmpeg"):
    """Whole-clip measurement + verdict from files. A missing mediapipe or model returns UNMEASURABLE, never a pass."""
    try:
        fps, rows = read_mouth(clip)
        m = measure_features(fps, rows, read_audio(audio, ffmpeg), [read_audio(o, ffmpeg) for o in others])
        return judge_sync(m, sung)
    except (RuntimeError, ValueError) as e:
        return unmeasured(e)
