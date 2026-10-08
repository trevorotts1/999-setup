#!/usr/bin/env python3
"""lip_gate.py: measured lip-sync gate (Part H H2; LSL002 verdicts).

Every lip-sync clip is measured against the FINAL MIX by sync_check.py (the validated fixer algorithm:
lag +-10 frames, clip cut to the audio length, chance test by rolled audio, repeated-hook lines dropped
from the wrong-audio control). Verdicts (Trevor: "loosen the checks so it's not as strict"):

  PASS              SYNCED
  ACCEPT_WITH_FLAG  WEAK on a spoken line: accepted and used, flags written in the receipt
  FAIL              NOT_SYNCED on a SPOKEN line
  UNDETERMINED      WEAK or NOT_SYNCED on a SUNG line: held for a person to look at a mouth strip,
                    NO automatic paid redo (diagnosis: 1 of 99 redos ever passed)
  UNMEASURABLE      cannot be measured (no mediapipe, still face, ...): reported, never a pass

Trevor's 2-try rule: at most 2 paid lip-sync jobs per segment, then keep the best-measured take. Only a
spoken FAIL earns the second try. Pure stdlib; providers are injected so tests run at $0.
"""
from __future__ import annotations

import array
import subprocess

# Skill 75 load governor: every heavy local job goes through it (see load_governor/).
import os as _gos, sys as _gsys
_gcore = _gos.path.abspath(_gos.path.join(_gos.path.dirname(__file__), '..', '..'))
if _gcore not in _gsys.path:
    _gsys.path.insert(0, _gcore)
import load_governor as _LG  # noqa: E402

try:                                   # package import
    from . import image_gate, sync_check
except ImportError:                    # script import (tests run from here)
    import image_gate
    import sync_check

TOOL_NAME = "lip_gate"
SCHEMA_VERSION = "1.0.0"

MAX_PAID_ATTEMPTS = sync_check.MAX_PAID_ATTEMPTS   # Trevor's 2-try rule: paid lip-sync jobs per segment
PASS, FLAG, FAIL, UNDETERMINED, UNMEASURABLE = (
    sync_check.PASS, sync_check.FLAG, sync_check.FAIL, sync_check.UNDETERMINED, sync_check.UNMEASURABLE)
UNMEASURED = UNMEASURABLE
LIP_UNMEASURED = "LIP_UNMEASURED"

# What "better input" means on the regenerate attempt.
IMPROVED_INPUT = {
    "line": "single clean line (no internal pause > 0.5 s)",
    "crop": "front-facing tight face crop",
    "image": "still image, relaxed slightly open mouth",
    "lead_in_s": 0.35,
    "tail_s": 0.2,
}


def measure(mouth, voice, control_voice, fps, geo=0.7):
    """Measure one clip. mouth/voice: per-frame series at fps (mouth None = no face); control_voice:
    one other line's envelope or a list of them (the wrong-audio control)."""
    if not mouth or not voice or not control_voice or fps <= 0:
        raise ValueError(LIP_UNMEASURED)
    return sync_check.measure_sync(mouth, voice, control_voice, fps, geo)


def judge(m, sung=False):
    """Verdict for one measurement; adds reasons (FAIL), flags (receipt note), hold_for_review
    and shift_s (delay the clip by this to zero the offset)."""
    j = sync_check.judge_sync(m, sung)
    return dict(j, shift_s=round(-j["offset_s"], 4)) if "offset_s" in j else j


def score(j):
    """Higher is better: PASS > ACCEPT_WITH_FLAG > UNDETERMINED > FAIL > UNMEASURABLE."""
    if j["verdict"] == UNMEASURABLE:
        return -100
    rank = {PASS: 20, FLAG: 10, UNDETERMINED: 5, FAIL: 0}[j["verdict"]]
    return rank + (j.get("margin") or 0.0) - abs(j["offset_s"])


def run_gate(line_id, generate, measure_clip, ab_state, source_image=None,
             image_check=None, sung=False):
    """Orchestrate attempts. Injected, so mocked providers work at $0.

    generate(provider, input_spec) -> clip ; provider in {"kling","infinitalk"}
    measure_clip(clip) -> measurement dict from measure()
    ab_state: kept for callers; unused (the automatic InfiniTalk try is gone).
    sung: the line is SUNG, so WEAK / NOT_SYNCED = UNDETERMINED (held for a person, no redo).
    source_image: the speaker's lip-sync close-up (lipsync_closeup()); every
    attempt, InfiniTalk included, takes it as its source image by default.
    image_check: the injected picture check, image_gate.check_source_image
    bound to a detector (`lambda img: check_source_image(img, analyze)`). It
    runs BEFORE any generate() call (the first paid job). No picture, no
    checker, or a failing picture raises image_gate.LipsyncImageRefused with
    every reason; nothing is spent and nothing passes silently.
    Returns the receipt row (all attempts' numbers + kept attempt).
    """
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
    src = {"source_image": source_image}
    improved = dict(IMPROVED_INPUT, **src)
    plan = [("kling", src), ("kling", improved)][:MAX_PAID_ATTEMPTS]
    attempts = []
    for provider, spec in plan:
        attempts.append(_attempt(provider, spec, generate, measure_clip, sung))
        if attempts[-1]["judge"]["verdict"] != FAIL:
            break    # accepted, held for a person (UNDETERMINED) or unmeasurable: no more paid retries
    return _row(line_id, attempts, False)


def _attempt(provider, spec, generate, measure_clip, sung=False):
    clip = generate(provider, spec)
    try:
        j = judge(measure_clip(clip), sung)
    except (ValueError, RuntimeError) as e:     # missing mediapipe etc.: report, never pass
        j = sync_check.unmeasured(e)
    return {"provider": provider, "input": spec or "base", "clip": clip, "judge": j}


def _row(line_id, attempts, ab):
    kept = max(attempts, key=lambda a: score(a["judge"]))
    j = kept["judge"]
    v = j["verdict"]
    row = {"tool": TOOL_NAME, "line_id": line_id, "attempts": attempts,
           "paid_attempts": len(attempts), "infinitalk_ab": ab,
           "kept": kept["provider"], "kept_clip": kept["clip"],
           "verdict": "FAIL_REPLACE" if v == FAIL else v,
           "flags": j.get("flags", []), "reasons": j.get("reasons", [])}
    if "corr" in j:
        row["numbers"] = {k: j[k] for k in (
            "offset_s", "corr", "control_corr", "margin", "pct")}
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
    """Receipt-level check: every lip clip has a PASS or ACCEPT_WITH_FLAG row with numbers (a flagged row
    must carry its flags). An UNDETERMINED row passes only once a person looked (row["reviewed"]).
    UNMEASURABLE and FAIL_REPLACE fail."""
    bad = [r.get("line_id") for r in rows
           if not (r.get("verdict") in (PASS, FLAG) or (r.get("verdict") == UNDETERMINED and r.get("reviewed")))
           or "numbers" not in r or (r.get("verdict") in (FLAG, UNDETERMINED) and not r.get("flags"))]
    return {"pass": not bad, "failed_lines": bad,
            "reason_code": None if not bad else "LIP_SYNC_GATE_FAILED"}


# ------------------------------------------------ optional ffmpeg helpers ----

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


def mouth_series(clip, box, fps=30, ffmpeg="ffmpeg"):
    """Mean abs frame difference inside box=(x, y, w, h), smoothed 3 frames."""
    x, y, w, h = box
    raw = _run_raw([ffmpeg, "-v", "error", "-threads", "4", "-i", clip,
                    "-vf", "fps=%d,crop=%d:%d:%d:%d,format=gray" % (
                        fps, w, h, x, y), "-f", "rawvideo", "-"])
    n, size = len(raw) // (w * h), w * h
    out, prev = [0.0], None
    for i in range(n):
        f = raw[i * size:(i + 1) * size]
        if prev is not None:
            out.append(sum(abs(a - b) for a, b in zip(f, prev)) / size)
        prev = f
    return _smooth(out[:n])


def envelope(audio, fps=30, ffmpeg="ffmpeg", start=0.0):
    """RMS loudness per 1/fps window of the FINAL MIX, smoothed 3 frames."""
    sr = 16000
    raw = _run_raw([ffmpeg, "-v", "error", "-threads", "4", "-ss",
                    str(start), "-i", audio, "-ac", "1", "-ar", str(sr),
                    "-f", "s16le", "-"])
    s = array.array("h")
    s.frombytes(raw[:len(raw) // 2 * 2])
    win = sr // fps
    out = [(sum(v * v for v in s[i:i + win]) / win) ** 0.5
           for i in range(0, len(s) - win + 1, win)]
    return _smooth(out)
