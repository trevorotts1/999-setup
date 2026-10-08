#!/usr/bin/env python3
"""H2 tests: measured lip-sync gate. Stdlib only, $0, mocked providers.

DONE-WHEN: a deliberately shifted clip FAILS and a good clip PASSES; the
receipt row carries the numbers; InfiniTalk runs only as a one-time A/B and
the better-measuring clip is kept.

Run: python3 core/lip_sync/lip_gate/test_lip_gate_h2.py
"""
import os
import random
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIP = os.path.dirname(HERE)
if LIP not in sys.path:
    sys.path.insert(0, LIP)

import lip_gate as L                                   # noqa: E402

FPS = 30


def speech(seed, n=150, gap=None):
    """Bursty speech-like envelope; optional (start, end) silent gap."""
    r, out = random.Random(seed), []
    while len(out) < n:
        out += [r.uniform(.6, 1.0)] * r.randint(3, 6) + [.05] * r.randint(2, 4)
    out = out[:n]
    if gap:
        out[gap[0]:gap[1]] = [.05] * (gap[1] - gap[0])
    return out


VOICE, CONTROL = speech(1), speech(2)


def lead(x, frames):          # mouth moves `frames` BEFORE the sound
    return x[frames:] + [.05] * frames


def judged(mouth, voice=VOICE):
    return L.judge(L.measure(mouth, voice, CONTROL, FPS))


def test_good_passes():
    j = judged(VOICE)
    assert j["verdict"] == "PASS" and j["offset_s"] == 0 and j["corr"] > .9, j


def test_shifted_far_fails_and_shift_fixes():
    j = judged(lead(VOICE, 12))                # 0.4 s early: clearly wrong timing
    assert j["verdict"] == "FAIL" and L.sync_check.REASON_LAG in j["reasons"], j
    assert abs(j["offset_s"] + 0.4) < 1e-6 and abs(j["shift_s"] - 0.4) < 1e-6
    fixed = ([.05] * 12) + lead(VOICE, 12)[:-12]       # delay clip by shift_s
    assert judged(fixed)["verdict"] == "PASS"


def test_wrong_audio_fails():
    # mouth follows the CONTROL audio: the wrong audio matches better than its own.
    j = L.judge(L.measure(CONTROL, VOICE, CONTROL, FPS))
    assert j["verdict"] == "FAIL" and L.sync_check.REASON_WRONG_AUDIO in j["reasons"], j


def test_still_face_fails():
    j = L.judge(L.measure([0.01] * len(VOICE), VOICE, CONTROL, FPS))
    assert j["verdict"] == "FAIL" and L.sync_check.REASON_STILL in j["reasons"], j


def _mock(table):
    """generate() returns a name; measure_clip() returns canned series."""
    calls = []

    def gen(provider, spec):
        calls.append((provider, "improved" if "lead_in_s" in spec else "base"))
        return "%s-%s" % calls[-1]
    return calls, gen, lambda clip: L.measure(table[clip], VOICE, CONTROL, FPS)


PIC = {"source_image": "closeup.png",
       "image_check": lambda img: {"pass": True}}   # picture gate has its own test
GOOD, BAD, BAD2 = VOICE, lead(VOICE, 12), lead(VOICE, 11)


def test_pass_on_first_try_stops():
    calls, gen, meas = _mock({"kling-base": GOOD})
    row = L.run_gate("L1", gen, meas, {}, **PIC)
    assert row["verdict"] == "PASS" and calls == [("kling", "base")]


def test_retry_once_then_pass():
    calls, gen, meas = _mock({"kling-base": BAD, "kling-improved": GOOD})
    row = L.run_gate("L1", gen, meas, {}, **PIC)
    assert row["verdict"] == "PASS" and row["paid_attempts"] == 2
    assert calls == [("kling", "base"), ("kling", "improved")]
    assert set(row["numbers"]) == {"offset_s", "corr", "control_corr",
                                   "margin", "frozen_s"}


def test_two_try_cap_keeps_best_measured():
    calls, gen, meas = _mock({"kling-base": BAD, "kling-improved": BAD2})
    row = L.run_gate("L1", gen, meas, {}, **PIC)
    assert len(calls) == L.MAX_PAID_ATTEMPTS == 2          # never a third paid job
    assert row["paid_attempts"] == 2 and not row["infinitalk_ab"]
    assert row["verdict"] == "FAIL_REPLACE" and row["reasons"]
    assert abs(row["numbers"]["offset_s"] + 11 / FPS) < 1e-3            # kept the better-measured take (11 frames)


def test_flag_is_accepted_and_stops():
    flagged = {"verdict": "ACCEPT_WITH_FLAG", "offset_s": 0, "corr": .3,
               "control_corr": .2, "margin": .1, "frozen_s": 0, "flags": ["corr 0.30 < 0.33"],
               "reasons": []}
    row = L.lip_gate._row("L1", [{"provider": "kling", "input": "base", "clip": "c", "judge": flagged}], False)
    assert row["verdict"] == "ACCEPT_WITH_FLAG" and row["flags"]
    assert L.qc_check([row])["pass"]
    assert not L.qc_check([dict(row, flags=[])])["pass"]   # a flag must be written down


def test_unmeasured_is_reported_not_passed_and_no_retry():
    calls = []

    def gen(provider, spec):
        calls.append(provider)
        return "c"

    def boom(clip):
        raise RuntimeError("SYNC_UNMEASURED: mediapipe/opencv unavailable")
    row = L.run_gate("L1", gen, boom, {}, **PIC)
    assert row["verdict"] == "UNMEASURED" and len(calls) == 1
    assert not L.qc_check([row])["pass"]


def test_qc_check_fails_replaced_or_unnumbered():
    ok = {"line_id": "a", "verdict": "PASS", "numbers": {}}
    assert L.qc_check([ok])["pass"]
    assert not L.qc_check([ok, {"line_id": "b", "verdict": "FAIL_REPLACE",
                               "numbers": {}}])["pass"]
    assert not L.qc_check([{"line_id": "u", "verdict": "UNMEASURED"}])["pass"]
    assert not L.qc_check([{"line_id": "c", "verdict": "PASS"}])["pass"]


def test_envelope_ffmpeg():
    ff = shutil.which("ffmpeg")
    if not ff:
        print("skip envelope (no ffmpeg)")
        return
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "t.wav")
        subprocess.run([ff, "-v", "error", "-f", "lavfi", "-i",
                        "sine=f=300:d=1,apad=pad_dur=1", "-t", "2", wav,
                        "-y"], check=True)
        env = L.envelope(wav, fps=FPS, ffmpeg=ff)
    assert abs(len(env) - 60) <= 2
    assert sum(env[:25]) / 25 > 20 * (sum(env[40:]) / 20 + 1e-9)


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
