#!/usr/bin/env python3
"""lip_gate.py: lip-sync gate, event-based (Opus fix 2026-10-08, review 13).

The old gate correlated mouth movement with LOUDNESS (offset <= 0.05 s, corr >=
0.55). Loudness is not phonetic content: on sung lines, held vowels move the
envelope and not the mouth, so the test read NOT_SYNCED on approved clips and
drove paid re-rolls that no new take could change. It is replaced by
`event_sync`, which checks the mouth at the moments the LEAD-VOCAL STEM and the
Suno word timestamps say something must happen:

  * onset  after a rest of >= 0.12 s: the mouth opens (rises >= 30% of its range)
  * offset before a rest of >= 0.12 s: the mouth closes (below its 35th pct)
  * every word with p, b or m: the lips close (below the 35th pct) in that word

Tolerance +/-0.2 s. hit = share of events matched; the same mouth is scored
against the events shifted +/-0.5 s and +/-1.0 s and against the other lines'
events; margin = hit - best control. Verdicts:

  SYNCED        hit >= 0.70 and margin >= 0.20
  NOT_SYNCED    hard defects only (still mouth while voiced, mouth shut through
                > 0.5 s of voice, mouth moving through a > 0.5 s rest, or
                hit <= 0.40 with >= 6 events). The only measured redo trigger.
  UNMEASURABLE  < 4 events, or a face in < 90% of frames: goes to the human
                mouth strip, never a redo trigger
  WEAK          everything else: keep, flag, no redo

TWO-TRY RULE (Trevor 2026-10-08, enforced here in code): at most MAX_TRIES (2)
paid Kling standard jobs per segment, every name variant of the segment counted
(`segment_key`). Try 2 runs only on a hard defect and only with a CHANGED
input. After that the best-measured take is kept and the receipt says
KEPT_BEST_OF_2. No third job, no other model (the InfiniTalk A/B is gone).

Every paid call goes through load_governor.kie_request(generation=True); the
landmark extraction goes through load_governor.heavy_slot. Pure stdlib for the
rules; mediapipe/cv2 are imported only inside mouth_series. Providers are
injected so tests run at $0. Run `python3 lip_gate.py` for the selftest, which
exits non-zero if ANY negative control reads SYNCED.
"""
from __future__ import annotations

import array
import os
import random
import re
import subprocess
import sys

# Skill 75 load governor: every heavy local job goes through it (see load_governor/).
import os as _gos, sys as _gsys
_gcore = _gos.path.abspath(_gos.path.join(_gos.path.dirname(__file__), '..', '..'))
if _gcore not in _gsys.path:
    _gsys.path.insert(0, _gcore)
import load_governor as _LG  # noqa: E402

try:                                   # package import
    from . import image_gate
except ImportError:                    # script import (tests run from here)
    import image_gate

TOOL_NAME = "lip_gate"
SCHEMA_VERSION = "2.0.0"

# --- thresholds: every one a named knob. UNCALIBRATED on real sung clips until
# the 10-take human-scored set exists (review 13, 2e); a sung WEAK or
# UNMEASURABLE therefore means UNDETERMINED, never bad.
TOL_S = 0.2                    # +/- tolerance for every event
REST_S = 0.12                  # minimum rest that makes an onset / offset event
MIN_EVENTS = 4
MIN_FACE_SHARE = 0.90          # share of frames with a face
HIT_SYNCED, MARGIN_SYNCED = 0.70, 0.20
HIT_HARD, HARD_MIN_EVENTS = 0.40, 6
RISE_FRAC = 0.30               # onset: mouth rises this share of its range
CLOSE_PCT, CLOSED_PCT = 35, 20
STILL_RANGE = 0.015            # mouth range (gap / face height) below = still
CLOSED_VOICED_S = 0.5
MOVING_REST_S = 0.5
CONTROL_SHIFTS_S = (-1.0, -0.5, 0.5, 1.0)
VOICED_FRAC = 0.15             # voiced = envelope above this share of its max
MAX_TRIES = 2                  # paid Kling jobs per segment, hard cap

SYNCED, WEAK, UNMEASURABLE, NOT_SYNCED = ("SYNCED", "WEAK", "UNMEASURABLE",
                                          "NOT_SYNCED")
TIER = {SYNCED: 3, WEAK: 2, UNMEASURABLE: 1, NOT_SYNCED: 0}
KEPT = "KEPT_BEST_OF_2"

LIP_UNMEASURED = "LIP_UNMEASURED"
LIP_TRY_LIMIT = "LIP_TRY_LIMIT"
LIP_SAME_INPUT = "LIP_SAME_INPUT"

# Default input for try 1 (was the redo-only input): lead-in 0.30 s, tail 0.20 s.
IMPROVED_INPUT = {
    "line": "single clean line, lead-vocal stem only (never the mix)",
    "crop": "front-facing close-up",
    "image": "still image, lips relaxed and very slightly parted",
    "lead_in_s": 0.30,
    "tail_s": 0.20,
}


class LipsyncTryLimit(Exception):
    """A 3rd paid lip-sync job for one segment, or an identical resubmit."""

    def __init__(self, code, message):
        super().__init__("%s: %s" % (code, message))
        self.code = code


# ------------------------------------------------------------- prompts -------

def kling_prompt(kind, who="woman", emotion=None, pronoun="Her"):
    """Kling prompt: SINGS on sung lines, SAYS on spoken ones, ONE emotion,
    minimal head movement, steady camera. Mouth timing comes from the audio, so
    no instruction about lips opening and closing."""
    if kind not in ("sung", "spoken"):
        raise ValueError("kind must be 'sung' or 'spoken'")
    emotion = (emotion or ("earnest" if kind == "sung" else "sincere")).strip()
    if not emotion or re.search(r"[,;/]|\band\b|\bor\b", emotion):
        raise ValueError("one emotion only, got %r" % emotion)
    if kind == "sung":
        return ("A 3D animated %s sings this line to the camera with a %s "
                "expression. Minimal head movement, steady locked camera, "
                "natural blinks, relaxed shoulders. %s whole face and mouth "
                "stay fully visible. No text, captions or watermark."
                % (who, emotion, pronoun))
    return ("A 3D animated %s says this line to the camera, %s. Minimal head "
            "movement, steady locked camera, natural blinks. %s whole face and "
            "mouth stay fully visible. No text, captions or watermark."
            % (who, emotion, pronoun))


# ------------------------------------------------------------- try limit -----

_SUFFIX = re.compile(r"(?:[-_ ]+(?:v|t|try|take|redo|retry|attempt)[-_ ]*\d*"
                     r"|[-_ ]*(?:take|try|redo|retry|attempt)[-_ ]*\d*)$")


def segment_key(name):
    """Normalise a job / file name to its segment: lower case, extension and
    take/version/retry suffixes stripped, punctuation removed. ch2_ls1,
    CH2-LS1-v2 and ch2 ls1 redo3 are ONE segment."""
    s = os.path.splitext(str(name).strip().lower())[0]
    while True:
        t = _SUFFIX.sub("", s)
        if t == s or not t:
            break
        s = t
    return re.sub(r"[^a-z0-9]", "", s)


def jobs_for_segment(job_names, segment):
    """How many paid jobs a segment already has, counting every name variant."""
    key = segment_key(segment)
    return sum(1 for n in job_names if segment_key(n) == key)


# ------------------------------------------------------------- the measure ---

def _pct(xs, p):
    s = sorted(xs)
    if not s:
        return 0.0
    k = (len(s) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _evlist(x):
    return x.get("events", []) if isinstance(x, dict) else list(x or [])


def scale_events(evs, from_len, to_len):
    """Another line's events, scaled to this clip's length (a control set)."""
    f = to_len / float(from_len)
    out = []
    for e in _evlist(evs):
        d = dict(e, t=e["t"] * f)
        if "t1" in e:
            d["t1"] = e["t1"] * f
        out.append(d)
    return out


def _shift(evs, d, dur):
    out = []
    for e in evs:
        t = e["t"] + d
        t1 = e.get("t1", e["t"]) + d
        if t < 0 or t1 > dur:
            continue
        out.append(dict(e, t=t, **({"t1": t1} if "t1" in e else {})))
    return out


def _hit(ev, m, fps, rng, lo, p_close):
    n = len(m)
    if ev["kind"] == "bilabial":
        # the closure must fall inside the word itself (+/- one frame)
        a, b = ev["t"] - 1.0 / fps, ev.get("t1", ev["t"]) + 1.0 / fps
    else:
        a, b = ev["t"] - TOL_S, ev["t"] + TOL_S
    i0, i1 = max(0, int(a * fps)), min(n - 1, int(b * fps + 0.999))
    if i0 > i1:
        return False
    seg = m[i0:i1 + 1]
    if ev["kind"] == "onset":
        low = seg[0]
        for v in seg:
            low = min(low, v)
            if v - low >= RISE_FRAC * rng:
                return True
        return False
    return min(seg) <= p_close


def _rate(evs, m, fps, rng, lo, p_close):
    if not evs:
        return None
    return sum(_hit(e, m, fps, rng, lo, p_close) for e in evs) / float(len(evs))


def _longest(flags):
    run = best = 0
    for f in flags:
        run = run + 1 if f else 0
        best = max(best, run)
    return best


def event_sync(mouth, events, control_event_sets, fps):
    """Score one clip. mouth: per-frame inner-lip gap / face height (None = no
    face). events: events() result for the lead-vocal span (dict with events,
    voiced, rests, duration). control_event_sets: other lines' event lists
    already scaled to this length (scale_events). -> dict with verdict."""
    evs = _evlist(events)
    voiced = events.get("voiced", []) if isinstance(events, dict) else []
    rests = events.get("rests", []) if isinstance(events, dict) else []
    if not mouth or fps <= 0:
        raise ValueError(LIP_UNMEASURED)
    n = len(mouth)
    dur = (events.get("duration") if isinstance(events, dict) and
           events.get("duration") else n / float(fps))
    face = sum(1 for v in mouth if v is not None) / float(n)
    base = {"n_events": len(evs), "face_share": round(face, 4), "fps": fps,
            "hit": None, "control_hit": None, "margin": None, "lag_s": None,
            "hard_defects": []}
    if len(evs) < MIN_EVENTS or face < MIN_FACE_SHARE:
        why = ("fewer than %d events" % MIN_EVENTS if len(evs) < MIN_EVENTS
               else "face found in %.0f%% of frames" % (face * 100))
        return dict(base, verdict=UNMEASURABLE, reason=why)
    m, last = [], 0.0
    for v in mouth:                      # fill short face gaps with the last value
        last = last if v is None else v
        m.append(last)
    lo, hi = _pct(m, 5), _pct(m, 95)
    rng = hi - lo
    p_close, p_shut = _pct(m, CLOSE_PCT), _pct(m, CLOSED_PCT)
    hit = _rate(evs, m, fps, rng, lo, p_close)
    ctrl = []
    for d in CONTROL_SHIFTS_S:
        r = _rate(_shift(evs, d, dur), m, fps, rng, lo, p_close) \
            if len(_shift(evs, d, dur)) >= 2 else None
        if r is not None:
            ctrl.append(r)
    for other in control_event_sets or []:
        r = _rate(_evlist(other), m, fps, rng, lo, p_close)
        if r is not None:
            ctrl.append(r)
    cbest = max(ctrl) if ctrl else 0.0
    # lag: mean of the shifts (within +/-TOL_S) that score the best hit rate,
    # so a mouth that runs a little late reads a small positive lag. Coarse.
    ks = list(range(-int(TOL_S * fps), int(TOL_S * fps) + 1))
    rates = [_rate(_shift(evs, k / float(fps), dur), m, fps, rng, lo, p_close)
             or 0.0 for k in ks]
    top = max(rates)
    plateau = [k for k, h in zip(ks, rates) if h >= top - 1e-9]
    best_lag = sum(plateau) / float(len(plateau)) / fps
    defects = []
    if voiced and rng < STILL_RANGE:
        defects.append("MOUTH_STILL")
    else:
        for a, b in voiced:
            i0, i1 = int(a * fps), min(n, int(b * fps) + 1)
            if (b - a) > CLOSED_VOICED_S and \
                    _longest(v <= p_shut for v in m[i0:i1]) / float(fps) > CLOSED_VOICED_S:
                defects.append("MOUTH_CLOSED_THROUGH_VOICE")
                break
        for a, b in rests:
            if b - a > MOVING_REST_S:
                # trim the edges: the mouth may lead or lag by up to TOL_S
                seg = m[int((a + TOL_S) * fps):min(n, int((b - TOL_S) * fps) + 1)]
                if seg and max(seg) - min(seg) >= 0.5 * rng:
                    defects.append("MOUTH_MOVING_THROUGH_REST")
                    break
    if hit <= HIT_HARD and len(evs) >= HARD_MIN_EVENTS:
        defects.append("HIT_LOW")
    margin = hit - cbest
    verdict = (NOT_SYNCED if defects else
               SYNCED if hit >= HIT_SYNCED and margin >= MARGIN_SYNCED else WEAK)
    return dict(base, verdict=verdict, hit=round(hit, 4),
                control_hit=round(cbest, 4), margin=round(margin, 4),
                lag_s=round(best_lag, 4), hard_defects=defects)


def hard_defect(j):
    """A hard defect is the ONLY measured reason for try 2."""
    return j["verdict"] == NOT_SYNCED or bool(j.get("hard_defects")) \
        or bool(j.get("visual_defects"))


def score(j):
    """Keep-best ranking (review 13, 2f): no hard defect, then verdict tier,
    then hit and margin, then the smaller |lag|. Tuples compare left to right."""
    return (0 if hard_defect(j) else 1, TIER.get(j["verdict"], 0),
            j.get("hit") or 0.0, j.get("margin") or 0.0,
            -abs(j.get("lag_s") or 0.0))


# ------------------------------------------------------------- the gate ------

def run_gate(line_id, generate, measure_clip, source_image=None,
             image_check=None, kind="sung", who="woman", emotion=None,
             next_input=None, defect_check=None, tries=None, pronoun="Her"):
    """Orchestrate at most MAX_TRIES paid Kling standard jobs for ONE segment.

    generate("kling", input_spec) -> clip      (every call goes through
        load_governor.kie_request(generation=True))
    measure_clip(clip) -> event_sync() dict (may carry "mouth_strip": path)
    defect_check(clip) -> list of visual hard defects (garbled text across the
        chest, hand over the mouth, frozen or wrong face); optional.
    next_input: dict that CHANGES the input for try 2 (next-best
        choose_window, or the padded cut); with none, try 2 is not run.
    tries: shared {segment_key: jobs used}; a 3rd job raises LipsyncTryLimit.
    The picture gate runs BEFORE the first paid job, as before."""
    if not source_image:
        raise image_gate.LipsyncImageRefused(
            [(image_gate.IMAGE_MISSING, "no lip-sync source picture")], line_id)
    if image_check is None:
        raise image_gate.LipsyncImageRefused(
            [(image_gate.IMAGE_UNCHECKED, "no image check supplied")], line_id)
    res = image_check(source_image)
    if not isinstance(res, dict) or res.get("pass") is not True:
        raise image_gate.LipsyncImageRefused(
            (res or {}).get("reasons") or [(image_gate.UNMEASURED,
                                            "image check gave no verdict")],
            line_id)
    tries = tries if tries is not None else {}
    key = segment_key(line_id)
    spec1 = dict(IMPROVED_INPUT, source_image=source_image,
                 prompt=kling_prompt(kind, who, emotion, pronoun))
    attempts, note = [], None
    plan = [spec1]
    while plan:
        spec = plan.pop(0)
        if tries.get(key, 0) >= MAX_TRIES:
            raise LipsyncTryLimit(LIP_TRY_LIMIT, "segment %s already has %d paid "
                                  "lip-sync jobs; keep the best take" % (line_id, MAX_TRIES))
        if attempts and spec == attempts[-1]["input"]:
            raise LipsyncTryLimit(LIP_SAME_INPUT, "try 2 for %s must change the "
                                  "input" % line_id)
        tries[key] = tries.get(key, 0) + 1          # count BEFORE the spend
        attempts.append(_attempt(spec, generate, measure_clip, defect_check,
                                 "%s-t%d" % (line_id, tries[key])))
        if not hard_defect(attempts[-1]["judge"]):
            break
        if len(attempts) < MAX_TRIES:
            if next_input:
                plan.append(dict(spec1, **next_input))
            else:
                note = "NO_CHANGED_INPUT"
    return _row(line_id, attempts, note)


def _attempt(spec, generate, measure_clip, defect_check, label):
    clip = _LG.kie_request(lambda: generate("kling", spec), label,
                           generation=True)
    j = dict(measure_clip(clip))
    if defect_check:
        j["visual_defects"] = list(defect_check(clip) or [])
    return {"provider": "kling", "input": spec, "clip": clip, "judge": j}


NUMBER_KEYS = ("hit", "control_hit", "margin", "lag_s", "n_events", "face_share")


def _row(line_id, attempts, note=None):
    best = max(range(len(attempts)), key=lambda i: score(attempts[i]["judge"]))
    kept, j = attempts[best], attempts[best]["judge"]
    clean = j["verdict"] == SYNCED and not hard_defect(j)
    flags = list(j.get("hard_defects", [])) + list(j.get("visual_defects", []))
    if note:
        flags.append(note)
    if not clean:
        flags.append("%s%s" % (j["verdict"], " (sung: UNDETERMINED, check the "
                               "mouth strip)" if j["verdict"] != NOT_SYNCED else ""))
    nums = {k: j.get(k) for k in NUMBER_KEYS}
    row = {"tool": TOOL_NAME, "line_id": line_id, "attempts": attempts,
           "jobs_used": len(attempts), "kept": kept["provider"],
           "kept_try": best + 1, "kept_clip": kept["clip"],
           "verdict": "PASS" if clean else KEPT,
           "lip_verdict": j["verdict"], "numbers": nums,
           "flag": "; ".join(flags), "mouth_strip": j.get("mouth_strip")}
    row["receipt"] = "%s (t%d), %s, hit %s margin %s, %s" % (
        row["verdict"] if not clean else "PASS", best + 1, j["verdict"],
        nums["hit"], nums["margin"], row["flag"] or "no flag")
    return row


LIPSYNC_VIEW = "lipsync-closeup"
LIPSYNC_REF_MISSING = "LIPSYNC_CLOSEUP_MISSING"
LIPSYNC_MOUTH_BAD = "LIPSYNC_CLOSEUP_MOUTH_NOT_CLEAR"


def lipsync_closeup(reference_set, character):
    """The character's lip-sync close-up entry (the default source image), or None."""
    for r in reference_set:
        if r.get("character") == character and r.get("view") == LIPSYNC_VIEW:
            return r
    return None


def check_reference_set(reference_set, characters, mouth_clear):
    """Owner order 2026-10-08: every speaking/singing character needs a lip-sync
    close-up whose mouth is sharp and unobstructed. mouth_clear(entry) -> bool is
    the injected face/mouth detection or vision check. A set without it FAILS."""
    bad = []
    for c in characters:
        e = lipsync_closeup(reference_set, c)
        if e is None:
            bad.append({"character": c, "reason_code": LIPSYNC_REF_MISSING})
        elif not mouth_clear(e):
            bad.append({"character": c, "reason_code": LIPSYNC_MOUTH_BAD})
    return {"pass": not bad, "failed": bad}


def qc_check(rows):
    """Receipt-level check: every lip clip has a PASS row with numbers, or a
    flagged KEPT_BEST_OF_2 row (Trevor's 2-try keep-best rule, 2026-10-08) that
    carries numbers, a non-empty flag and a mouth-strip path."""
    def ok(r):
        if "numbers" not in r:
            return False
        if r.get("verdict") == "PASS":
            return True
        return (r.get("verdict") == KEPT and bool(r.get("flag"))
                and bool(r.get("mouth_strip")))
    bad = [r.get("line_id") for r in rows if not ok(r)]
    return {"pass": not bad, "failed_lines": bad,
            "reason_code": None if not bad else "LIP_SYNC_GATE_FAILED"}


# ------------------------------------------------ audio, events, landmarks ----

def _run_raw(argv):
    p = _LG.run_ffmpeg(argv, "lip-gate-measure", stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError("%s: %s" % (LIP_UNMEASURED, p.stderr[-300:]))
    return p.stdout


def _smooth(x, w=3):
    h = w // 2
    return [sum(x[max(0, i - h):i + h + 1]) / len(x[max(0, i - h):i + h + 1])
            for i in range(len(x))]


def envelope(audio, fps=30, ffmpeg="ffmpeg", start=0.0, dur=None):
    """RMS loudness per 1/fps window of the LEAD-VOCAL STEM span (never the
    final mix), smoothed 3 frames. Used only to find voiced runs and rests."""
    sr = 16000
    argv = [ffmpeg, "-v", "error", "-threads", "4", "-ss", str(start)]
    if dur:
        argv += ["-t", str(dur)]
    raw = _run_raw(argv + ["-i", audio, "-ac", "1", "-ar", str(sr),
                           "-f", "s16le", "-"])
    s = array.array("h")
    s.frombytes(raw[:len(raw) // 2 * 2])
    win = sr // fps
    out = [(sum(v * v for v in s[i:i + win]) / win) ** 0.5
           for i in range(0, len(s) - win + 1, win)]
    return _smooth(out)


def voiced_runs(env, fps):
    """[(start_s, end_s)] where the stem is voiced; gaps < REST_S are bridged."""
    if not env:
        return []
    thr = VOICED_FRAC * max(env)
    runs, a = [], None
    for i, v in enumerate(env + [0.0]):
        if v > thr and a is None:
            a = i
        elif v <= thr and a is not None:
            runs.append([a / float(fps), i / float(fps)])
            a = None
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < REST_S:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [tuple(r) for r in merged]


def _w(word, *names):
    for n in names:
        if n in word:
            return word[n]
    raise KeyError(names[0])


def rebase_words(word_stamps, start, end):
    """Suno word stamps ({word, start_s|startS, end_s|endS}) inside
    [start, end], rebased to the span start."""
    out = []
    for w in word_stamps:
        a, b = _w(w, "start_s", "startS"), _w(w, "end_s", "endS")
        if a >= start - 1e-9 and b <= end + 1e-9:
            out.append({"word": _w(w, "word"), "start_s": a - start,
                        "end_s": b - start})
    return out


def events(env, words, fps):
    """Build the sync events for one lead-vocal span: onset after a rest >=
    REST_S, offset before a rest >= REST_S, and every word with p, b or m
    (words: rebased word stamps). Also returns voiced runs, rests, duration."""
    dur = len(env) / float(fps)
    runs = voiced_runs(env, fps)
    evs, rests, prev = [], [], 0.0
    for a, b in runs:
        if a - prev >= REST_S:
            rests.append((prev, a))
            evs.append({"kind": "onset", "t": a})
        prev = b
    if dur - prev >= REST_S:
        rests.append((prev, dur))
    for i, (a, b) in enumerate(runs):
        nxt = runs[i + 1][0] if i + 1 < len(runs) else dur
        if nxt - b >= REST_S:
            evs.append({"kind": "offset", "t": b})
    for w in words or []:
        if re.search(r"[pbm]", str(w["word"]).lower()):
            evs.append({"kind": "bilabial", "t": w["start_s"],
                        "t1": w["end_s"]})
    evs.sort(key=lambda e: e["t"])
    return {"events": evs, "voiced": runs, "rests": rests, "duration": dur}


def mouth_series(clip, extract=None, model=None):
    """Per frame inner-lip gap (mediapipe landmarks 13 to 14) divided by face
    height (landmark 10 to 152); None where no face is found. Runs inside
    load_governor.heavy_slot. extract(clip) -> list is the injectable detector
    (tests); the default needs mediapipe + opencv and a face_landmarker.task
    (model= or $DSAF_FACE_LANDMARKER)."""
    with _LG.heavy_slot("lip-gate-landmarks"):
        return (extract or (lambda c: _mediapipe_gap(c, model)))(clip)


def _mediapipe_gap(clip, model=None):
    import cv2                                           # noqa: PLC0415
    import mediapipe as mp                               # noqa: PLC0415
    from mediapipe.tasks.python import vision, BaseOptions  # noqa: PLC0415
    model = model or os.environ.get("DSAF_FACE_LANDMARKER")
    if not model or not os.path.exists(model):
        raise RuntimeError("%s: no face_landmarker.task (set "
                           "DSAF_FACE_LANDMARKER)" % LIP_UNMEASURED)
    lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.IMAGE, num_faces=1))
    cap, out = cv2.VideoCapture(clip), []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        r = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                               data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB)))
        if not r.face_landmarks:
            out.append(None)
            continue
        p = r.face_landmarks[0]
        fh = max(abs(p[152].y - p[10].y), 1e-6)
        out.append(abs(p[14].y - p[13].y) / fh)
    cap.release()
    return out


# ------------------------------------------------------------- selftest ------

def _synth_line(seed, fps=30, dur=6.0, sparse=False):
    """Synthetic line: voiced runs with rests, words with some p/b/m. sparse =
    speech-like phrasing (long rests); default = dense legato singing."""
    r = random.Random(seed)
    run_s, gap_s = ((0.5, 0.9), (0.7, 1.3)) if sparse else ((0.5, 1.1), (0.15, 0.55))
    t, runs, words = r.uniform(0.3, 0.5), [], []
    while t < dur - 0.9:
        a, b = t, t + r.uniform(*run_s)
        runs.append((a, b))
        w = a
        while w < b - 0.15:
            e = min(b, w + r.uniform(0.15, 0.35))
            words.append({"word": r.choice(["pray", "light", "mine", "be",
                                            "hold", "on", "bring", "you"]),
                          "start_s": w, "end_s": e})
            w = e
        t = b + r.uniform(*gap_s)
    n = int(dur * fps)
    env = [0.9 if any(a <= i / fps < b for a, b in runs) else 0.02
           for i in range(n)]
    return env, words


def _synth_mouth(env, words, fps=30):
    """What a synced mouth does: open in voiced runs, shut on rests and on
    p/b/m words."""
    r = random.Random(len(words) * 7 + 1)
    m = [0.02 + r.uniform(0, 0.012) for _ in env]       # rests: nearly shut
    for w in words:                                      # each word its own opening
        amp, i0 = r.uniform(0.05, 0.12), int(w["start_s"] * fps)
        for i in range(i0, min(len(m), int(w["end_s"] * fps))):
            m[i] = amp * (0.92 + 0.08 * r.random())
        if re.search(r"[pbm]", w["word"]):               # lips meet on p, b, m
            for i in range(i0, min(len(m), i0 + 4)):
                m[i] = 0.01
    return _smooth(m)


def selftest(lines=12, fps=30, sparse=False):
    """Known-good controls on synthetic lines. FAILS (returns ok=False) if ANY
    negative control reads SYNCED, or any positive reads NOT_SYNCED."""
    data = [_synth_line(s, sparse=sparse) for s in range(lines)]
    evs = [events(e, w, fps) for e, w in data]
    mouths = [_synth_mouth(e, w, fps) for e, w in data]
    n = len(mouths[0])

    def others(i):
        return [_evlist(evs[j]) for j in range(lines) if j != i]

    def run(i, mouth):
        return event_sync(mouth, evs[i], others(i), fps)["verdict"]

    out = {"positives": {}, "negatives": {}, "ok": True}

    def tally(group, verdict, bad):
        d = out[group.split(":")[0]]
        d.setdefault(group, {})
        d[group][verdict] = d[group].get(verdict, 0) + 1
        if verdict in bad:
            out["ok"] = False
    for i in range(lines):
        tally("positives:own audio", run(i, mouths[i]), (NOT_SYNCED,))
        sh = [mouths[i][0]] * int(0.5 * fps) + mouths[i][:n - int(0.5 * fps)]
        tally("negatives:own audio shifted 0.5 s", run(i, sh), (SYNCED,))
        tally("negatives:still face", run(i, [0.05] * n), (SYNCED, WEAK))
        tally("negatives:no face (cartoon)", run(i, [None] * n),
              (SYNCED, WEAK, NOT_SYNCED))
        for j in range(lines):
            if j != i:
                tally("negatives:wrong audio", run(i, mouths[j]), (SYNCED,))
    return out


def main(argv=None):
    ok = True
    for sparse in (False, True):          # dense legato singing, speech-like
        res = selftest(sparse=sparse)
        print("-- %s lines" % ("sparse" if sparse else "dense"))
        for grp in ("positives", "negatives"):
            for k, v in sorted(res[grp].items()):
                print(k, v)
        ok = ok and res["ok"]
    print("SELFTEST", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
