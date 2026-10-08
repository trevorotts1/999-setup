#!/usr/bin/env python3
"""D15 spoken-share retarget: one band, every length, every style.

Source: Decision log 37 (D15 retarget) 2026-10-07; plan 6.7.

Owner order, verbatim: "It should be 45% and never more than 55%." The 40%
floor stays. Same for every length and every music style -- rap counts as
spoken-style delivery, so a rap-heavy cut cannot measure under the band by
accident. The earlier per-length targets and the earlier wider ceiling are
retired: this module holds ONE band and nothing keyed by length.

The spoken opener (D12) stays short. H6 (owner, 2026-10-08): the first REAL
singing -- measured on the vocal stem, never read off section labels -- is a
TARGET of 15% of runtime (about 9 s in a 60 s ad), judged with the owner's
5/10 band. ``check_first_sung`` is the planner/QC rule; the old fixed
10-second label check is retired.

This package is the single source of truth for the three numbers. The length
engine, the lyric planner and the QC all read them from here instead of
keeping their own copy.

stdlib only: no network, no provider, no spend, no media file, no absolute
operator path (nothing in this package opens a file at all).

Run: python3 core/spoken_share/test_spoken_share.py
"""
from __future__ import annotations

from math import isfinite

TOOL_NAME = "spoken_share"
TOOL_VERSION = "1.0.0"
SCHEMA_VERSION = "blackceo.spoken-share/v1"
SOURCE = "Decision log 37 (D15 retarget) 2026-10-07; plan 6.7"

# ---- the three numbers (owner D15 retarget) -------------------------------
SPOKEN_TARGET_PCT = 45   # the target: spoken share of runtime, as a percent
SPOKEN_MIN_PCT = 40      # hard floor: never less than this
SPOKEN_MAX_PCT = 55      # hard ceiling: never more than this

TARGET = SPOKEN_TARGET_PCT / 100.0
FLOOR = SPOKEN_MIN_PCT / 100.0
CAP = SPOKEN_MAX_PCT / 100.0

#: H6 (owner, 2026-10-08): first REAL singing, measured on the vocal stem,
#: lands at this share of runtime. Replaces the retired fixed-seconds
#: FIRST_SUNG_WITHIN_SECONDS = 10, a label check nothing called.
FIRST_SUNG_TARGET_PCT = 15

#: Owner's target rule (2026-10-08 12:30), for every numeric goal: within
#: ACCEPT points = accept; over that up to FLAG points = accept WITH A FLAG
#: in the receipt; over FLAG points = REDO (never keep the closest).
# ponytail: Part G's G10 constants module owns these two when it lands; this
# is the single definition until then, so there is nothing to duplicate.
TARGET_ACCEPT_PCT = 5
TARGET_FLAG_PCT = 10

#: A take has real singing only with a sung stretch this long (Part G
#: detector rule); a shorter sung blip is not "first real singing".
REAL_SINGING_STRETCH_S = 6.0
#: Sung segments closer than this are one stretch.
_STRETCH_GAP_S = 1.0

BAND_ACCEPT, BAND_FLAG, BAND_REDO = "ACCEPT", "FLAG", "REDO"

#: Delivery labels a timing segment may carry.
DELIVERIES = ("spoken", "rap", "sung")

#: Rap is talking over a beat, so it is spoken-style delivery. Counting it is
#: what stops a rap-heavy cut from measuring under the floor by accident.
SPOKEN_STYLE_DELIVERIES = frozenset({"spoken", "rap"})


class SpokenShareError(ValueError):
    """Malformed input -- a caller bug, never a domain verdict."""

    def __init__(self, code, message):
        super().__init__("%s: %s" % (code, message))
        self.code = code


def band():
    """The one band, in fractions and in percent. Identical for every
    length and every style -- that is the whole point of the retarget."""
    return {
        "target": TARGET,
        "floor": FLOOR,
        "cap": CAP,
        "target_pct": SPOKEN_TARGET_PCT,
        "floor_pct": SPOKEN_MIN_PCT,
        "cap_pct": SPOKEN_MAX_PCT,
        "applies_to": "every length and every music style",
        "rap_counts_as_spoken": True,
        "source": SOURCE,
    }


def is_spoken_style(delivery):
    """True when a delivery label counts toward the spoken share."""
    if not isinstance(delivery, str):
        return False
    return delivery.strip().lower() in SPOKEN_STYLE_DELIVERIES


def share_pct(share):
    """Human percent for a share fraction, rounded to one decimal."""
    return round(float(share) * 100.0, 1)


def _number(value, what, code="BAD_SEGMENT"):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SpokenShareError(code, "%s must be a number, got %r"
                               % (what, value))
    value = float(value)
    if not isfinite(value):
        raise SpokenShareError(code, "%s must be finite, got %r" % (what, value))
    return value


def _segments(segments):
    """Normalize timing segments to [(delivery, start, end, seconds), ...].

    Accepts {"delivery": d, "seconds": n} or {"delivery": d, "start": a,
    "end": b}. Order in the list is the order in the song; a segment without
    an explicit start continues from the running cursor.
    """
    if not isinstance(segments, list) or not segments:
        raise SpokenShareError("BAD_SEGMENTS",
                               "segments must be a non-empty list")
    out = []
    cursor = 0.0
    for seg in segments:
        if not isinstance(seg, dict):
            raise SpokenShareError("BAD_SEGMENT",
                                   "segment must be a record, got %r"
                                   % (type(seg).__name__,))
        delivery = seg.get("delivery")
        if (not isinstance(delivery, str)
                or delivery.strip().lower() not in DELIVERIES):
            raise SpokenShareError("BAD_DELIVERY",
                                   "delivery must be one of %s, got %r"
                                   % (list(DELIVERIES), delivery))
        delivery = delivery.strip().lower()
        if "seconds" in seg:
            secs = _number(seg["seconds"], "seconds")
            if secs < 0:
                raise SpokenShareError("BAD_SEGMENT",
                                       "segment seconds must be >= 0")
            start = _number(seg["start"], "start") if "start" in seg else cursor
            if start < 0:
                raise SpokenShareError("BAD_SEGMENT",
                                       "segment start must be >= 0")
            end = start + secs
        elif "start" in seg and "end" in seg:
            start = _number(seg["start"], "start")
            end = _number(seg["end"], "end")
            if end < start:
                raise SpokenShareError("BAD_SEGMENT",
                                       "segment end must be >= start")
            secs = end - start
        else:
            raise SpokenShareError("BAD_SEGMENT",
                                   "segment needs seconds, or start and end")
        out.append((delivery, start, end, secs))
        cursor = max(cursor, end)
    return out


def measure_share(segments):
    """Spoken-style share of runtime from timing segments.

    Rap is spoken-style, so it is counted -- that is the rule that catches a
    rap-heavy R&B cut. Returns spoken/rap/sung/total seconds, the
    spoken-style share as a fraction of total, and ``first_sung_start_s``
    (None when the cut carries no sung line). Total 0 is refused rather than
    reported as 0%.
    """
    parsed = _segments(segments)
    seconds = dict.fromkeys(DELIVERIES, 0.0)
    for delivery, _start, _end, secs in parsed:
        seconds[delivery] += secs
    spoken, rap, sung = (seconds[d] for d in ("spoken", "rap", "sung"))
    total = spoken + rap + sung
    if total <= 0:
        raise SpokenShareError("ZERO_RUNTIME",
                               "segments total 0 seconds; share undefined")
    spoken_style = sum(v for d, v in seconds.items()
                       if d in SPOKEN_STYLE_DELIVERIES)
    sung_starts = [start for delivery, start, _e, _s in parsed
                   if delivery == "sung"]
    return {
        "spoken_seconds": round(spoken, 6),
        "rap_seconds": round(rap, 6),
        "sung_seconds": round(sung, 6),
        "total_seconds": round(total, 6),
        "spoken_style_seconds": round(spoken_style, 6),
        "share": round(spoken_style / total, 6),
        "share_pct": share_pct(spoken_style / total),
        "sung_share": round(sung / total, 6),
        "first_sung_start_s": min(sung_starts) if sung_starts else None,
        "opener_seconds": (round(min(sung_starts), 6)
                           if sung_starts else None),
        "rap_counts_as_spoken": True,
    }


def check_share(share, segments=None):
    """Enforce the band on one measured share. Never raises on a share that
    is merely out of band -- that is a FAIL verdict, not an error.

    Returns {"verdict": PASS|FAIL, "share", "floor", "cap", "target",
             "reasons": [...]}. Raises SpokenShareError only for a malformed
    share, which is a caller bug.

    segments, when given, is measured first and its share is the one judged
    (rap included); share then must agree with it or the check fails closed.
    """
    if isinstance(share, bool) or not isinstance(share, (int, float)):
        raise SpokenShareError("BAD_SHARE",
                               "share must be a fraction 0..1, got %r"
                               % (type(share).__name__,))
    share = float(share)
    if not isfinite(share):
        raise SpokenShareError("BAD_SHARE",
                               "share must be finite, got %r" % (share,))
    measured = None
    result = {
        "share": share,
        "share_pct": share_pct(share),
        "floor": FLOOR,
        "cap": CAP,
        "target": TARGET,
        "floor_pct": SPOKEN_MIN_PCT,
        "cap_pct": SPOKEN_MAX_PCT,
        "target_pct": SPOKEN_TARGET_PCT,
        "rap_counts_as_spoken": True,
        "measurement": None,
        "checker_version": TOOL_VERSION,
        "source": SOURCE,
    }
    if segments is not None:
        measured = measure_share(segments)
        result["measurement"] = measured
        if abs(measured["share"] - share) > 1e-6:
            result.update({
                "verdict": "FAIL",
                "measured_share": measured["share"],
                "reasons": ["share %s disagrees with the timing measurement "
                            "%s (rap included)" % (share, measured["share"])],
            })
            return result
    reasons = []
    if share < 0.0 or share > 1.0:
        reasons.append("share %r is not a fraction in 0..1" % share)
    if share < FLOOR:
        reasons.append("spoken share %.1f%% below the floor %.0f%%"
                       % (share_pct(share), SPOKEN_MIN_PCT))
    if share > CAP:
        reasons.append("spoken share %.1f%% above the ceiling %.0f%% "
                       "(target %.0f%%, rap counts as spoken-style delivery)"
                       % (share_pct(share), SPOKEN_MAX_PCT,
                          SPOKEN_TARGET_PCT))
    result.update({
        "verdict": "FAIL" if reasons else "PASS",
        "in_band": FLOOR <= share <= CAP,
        "delta_from_target": round(share - TARGET, 6),
        "reasons": reasons,
    })
    return result


def refusal(share, segments=None):
    """Compact refusal text for a FAILED share; empty string when it passes."""
    result = check_share(share, segments)
    if result["verdict"] == "PASS":
        return ""
    return "REFUSED spoken share %.1f%%: %s" % (
        result["share_pct"], "; ".join(result["reasons"]))


def judge_gap(measured_pct, target_pct):
    """The owner's 5/10 band for ONE measured goal, in percentage points:
    ACCEPT within 5, FLAG over 5 up to 10, REDO over 10. Reusable by the
    target engine for every numeric goal."""
    gap = round(abs(float(measured_pct) - float(target_pct)), 6)
    if gap <= TARGET_ACCEPT_PCT:
        band_ = BAND_ACCEPT
    elif gap <= TARGET_FLAG_PCT:
        band_ = BAND_FLAG
    else:
        band_ = BAND_REDO
    return {"gap_pts": gap, "band": band_}


def segments_from_sung_stretches(stretches, total_s):
    """Turn the vocal-stem detector's sung stretches [(start, end), ...]
    into spoken/sung segments covering ``total_s``, so the measured stem
    feeds check_first_sung. Everything the detector did not call sung is
    spoken-style here (only the sung start matters for first-sung)."""
    out, cursor = [], 0.0
    for start, end in sorted((float(a), float(b)) for a, b in stretches):
        if start > cursor:
            out.append({"delivery": "spoken", "start": cursor, "end": start})
        out.append({"delivery": "sung", "start": start, "end": end})
        cursor = max(cursor, end)
    if total_s > cursor:
        out.append({"delivery": "spoken", "start": cursor, "end": float(total_s)})
    return out


def _first_real_singing(parsed):
    """Start of the first sung stretch >= REAL_SINGING_STRETCH_S, or None."""
    stretches = []
    for delivery, start, end, _s in sorted(parsed, key=lambda t: t[1]):
        if delivery != "sung":
            continue
        if stretches and start - stretches[-1][1] <= _STRETCH_GAP_S:
            stretches[-1][1] = max(stretches[-1][1], end)
        else:
            stretches.append([start, end])
    for start, end in stretches:
        if end - start >= REAL_SINGING_STRETCH_S:
            return start
    return None


def check_first_sung(segments, basis="planned"):
    """H6 rule: first REAL singing is a TARGET of FIRST_SUNG_TARGET_PCT of
    runtime, judged with the owner's 5/10 band (judge_gap).

    ``segments`` should come from the vocal-stem detector (see
    segments_from_sung_stretches) and ``basis`` must then be "measured";
    label-derived segments stay "planned" and the receipt says so.

    Returns {"verdict": PASS|FAIL, "band": ACCEPT|FLAG|REDO, "flag": bool,
             "first_sung_start_s", "first_sung_pct", "target_pct",
             "gap_pts", "accept_pct", "basis", "opener_seconds",
             "flags": [...], "reasons": [...]}. FLAG is a PASS carrying a
    flag line for the receipt; REDO is a FAIL (regenerate, never keep the
    closest). A cut with no real singing at all is REDO.
    """
    parsed = _segments(segments)
    total = sum(p[3] for p in parsed)
    if total <= 0:
        raise SpokenShareError("ZERO_RUNTIME",
                               "segments total 0 seconds; share undefined")
    lo = FIRST_SUNG_TARGET_PCT - TARGET_ACCEPT_PCT
    hi = FIRST_SUNG_TARGET_PCT + TARGET_ACCEPT_PCT
    out = {
        "verdict": "FAIL", "band": BAND_REDO, "flag": False,
        "first_sung_start_s": None, "first_sung_pct": None,
        "target_pct": FIRST_SUNG_TARGET_PCT, "gap_pts": None,
        "accept_pct": [lo, hi], "basis": basis, "opener_seconds": None,
        "flags": [], "reasons": [],
    }
    first = _first_real_singing(parsed)
    if first is None:
        out["reasons"].append(
            "no real singing (no sung stretch of %.0f s) anywhere in the %s; "
            "an ad with no singing is redone" % (REAL_SINGING_STRETCH_S, basis))
        return out
    pct = round(first / total * 100.0, 3)
    j = judge_gap(pct, FIRST_SUNG_TARGET_PCT)
    text = ("first real singing at %.1f s = %.1f%% of runtime (%s), target "
            "%d%%, %.1f points off" % (first, pct, basis,
                                       FIRST_SUNG_TARGET_PCT, j["gap_pts"]))
    out.update({
        "band": j["band"], "gap_pts": j["gap_pts"],
        "first_sung_start_s": round(first, 6), "first_sung_pct": pct,
        "opener_seconds": round(first, 6),
        "flag": j["band"] == BAND_FLAG,
        "verdict": "FAIL" if j["band"] == BAND_REDO else "PASS",
    })
    if j["band"] == BAND_FLAG:
        out["flags"].append("FLAG: " + text)
    elif j["band"] == BAND_REDO:
        out["reasons"].append(text + "; over %d points, redo"
                              % TARGET_FLAG_PCT)
    return out


def steer_first_sung(segments, basis="planned"):
    """What the lyric-sheet builder does with a first-sung result: the
    check plus which way to move the sung hook and by how many seconds to
    land on the 15% target. action: keep | shorten_opener | lengthen_opener
    | add_sung_hook (no real singing at all)."""
    res = check_first_sung(segments, basis)
    total = sum(p[3] for p in _segments(segments))
    target_s = round(total * FIRST_SUNG_TARGET_PCT / 100.0, 3)
    first = res["first_sung_start_s"]
    if first is None:
        action, move = "add_sung_hook", None
    elif res["band"] == BAND_ACCEPT:
        action, move = "keep", 0.0
    else:
        move = round(target_s - first, 3)
        action = "lengthen_opener" if move > 0 else "shorten_opener"
    return {"check": res, "target_s": target_s, "action": action,
            "move_by_s": move}


def seconds_for(length_s):
    """The band expressed in seconds for one runtime -- the length engine's
    read of D15. No per-length table: the same fractions for 60 s and 600 s.
    """
    if isinstance(length_s, bool) or not isinstance(length_s, (int, float)):
        raise SpokenShareError("BAD_LENGTH",
                               "length_s must be a number of seconds, got %r"
                               % (length_s,))
    length_s = float(length_s)
    if not isfinite(length_s) or length_s <= 0:
        raise SpokenShareError("BAD_LENGTH",
                               "length_s must be a positive finite number, "
                               "got %r" % (length_s,))
    return {
        "length_s": length_s,
        "target_s": round(length_s * TARGET, 3),
        "floor_s": round(length_s * FLOOR, 3),
        "cap_s": round(length_s * CAP, 3),
        "first_sung_target_s": round(length_s * FIRST_SUNG_TARGET_PCT / 100.0, 3),
        "first_sung_accept_s": [
            round(length_s * (FIRST_SUNG_TARGET_PCT - TARGET_ACCEPT_PCT) / 100.0, 3),
            round(length_s * (FIRST_SUNG_TARGET_PCT + TARGET_ACCEPT_PCT) / 100.0, 3)],
        "band": band(),
    }


def check_plan(length_s, segments, basis="planned"):
    """QC verdict for one cut: the band AND the first-sung-line rule.

    Both halves must pass. Returns their verdicts plus the measurement, so a
    caller can refuse early with one readable sentence.
    """
    measured = measure_share(segments)
    share_check = check_share(measured["share"], segments)
    first_sung = check_first_sung(segments, basis)
    reasons = list(share_check["reasons"]) + list(first_sung["reasons"])
    return {
        "verdict": "FAIL" if reasons else "PASS",
        "share": measured["share"],
        "share_pct": measured["share_pct"],
        "floor": FLOOR,
        "cap": CAP,
        "target": TARGET,
        "length_s": length_s,
        "measurement": measured,
        "share_check": share_check,
        "first_sung": first_sung,
        "flags": list(first_sung["flags"]),
        "rap_counts_as_spoken": True,
        "reasons": reasons,
        "checker_version": TOOL_VERSION,
        "source": SOURCE,
    }


def plan_refusal(length_s, segments, basis="planned"):
    """Compact refusal text for a FAILED plan; empty string when it passes."""
    result = check_plan(length_s, segments, basis)
    if result["verdict"] == "PASS":
        return ""
    return "REFUSED %ss plan: %s" % (length_s, "; ".join(result["reasons"]))


__all__ = [
    "CAP",
    "DELIVERIES",
    "BAND_ACCEPT",
    "BAND_FLAG",
    "BAND_REDO",
    "FIRST_SUNG_TARGET_PCT",
    "REAL_SINGING_STRETCH_S",
    "TARGET_ACCEPT_PCT",
    "TARGET_FLAG_PCT",
    "FLOOR",
    "SCHEMA_VERSION",
    "SOURCE",
    "SPOKEN_MAX_PCT",
    "SPOKEN_MIN_PCT",
    "SPOKEN_STYLE_DELIVERIES",
    "SPOKEN_TARGET_PCT",
    "TARGET",
    "TOOL_NAME",
    "TOOL_VERSION",
    "SpokenShareError",
    "band",
    "check_first_sung",
    "check_plan",
    "check_share",
    "is_spoken_style",
    "judge_gap",
    "measure_share",
    "plan_refusal",
    "refusal",
    "seconds_for",
    "segments_from_sung_stretches",
    "share_pct",
    "steer_first_sung",
]
