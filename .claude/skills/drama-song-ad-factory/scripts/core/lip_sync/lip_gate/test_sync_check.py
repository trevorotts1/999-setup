#!/usr/bin/env python3
"""LSL001 tests: looser sync check, held notes, verdict paths. Stdlib only, no client
video, no mediapipe. Run: python3 test_sync_check.py (or pytest)."""
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import sync_check as S  # noqa: E402

FPS = 30


def syllables(seed, n=240):
    r, out = random.Random(seed), []
    while len(out) < n:
        out += [r.uniform(.3, 1.0)] * r.randint(3, 6) + [.05] * r.randint(2, 4)
    return out[:n]


def held_note(seed):
    """Sung line: syllables, then a 2 s held note (steady voice), then syllables."""
    v = syllables(seed, 240)
    v[80:140] = [0.9] * 60
    return v


def judged(mouth, voice, others, **kw):
    return S.judge_sync(S.measure_sync(mouth, voice, others, FPS, **kw))


OTHERS = [syllables(21), syllables(22), syllables(23)]


def test_pass_spoken():
    v = syllables(1)
    j = judged(v, v, OTHERS)
    assert j["verdict"] == S.PASS and j["flags"] == [], j


def test_held_note_still_passes():
    # mouth follows every syllable change, then stays OPEN and steady through the held note
    v = held_note(2)
    mouth = list(v)
    j = judged(mouth, v, OTHERS)
    assert j["verdict"] == S.PASS, j
    assert j["changing_frames"] < j["frames"] - 40, "held frames must be skipped"


def test_flag_for_borderline():
    m = {"corr": .30, "offset_frames": 2, "margin": .05, "face_found": 1.0, "mouth_range": .1}
    j = S.judge_sync(m)
    assert j["verdict"] == S.FLAG and j["flags"], j
    m2 = dict(m, corr=.7, offset_frames=7)                  # late/early but not clearly wrong
    assert S.judge_sync(m2)["verdict"] == S.FLAG


def test_fail_timing_far_off():
    v = syllables(3)
    mouth = v[11:] + [.05] * 11                              # mouth 11 frames early
    j = judged(mouth, v, OTHERS)
    assert j["verdict"] == S.FAIL and S.REASON_LAG in j["reasons"], j


def test_fail_wrong_audio_matches_better():
    j = judged(OTHERS[0], syllables(1), OTHERS)
    assert j["verdict"] == S.FAIL and S.REASON_WRONG_AUDIO in j["reasons"], j


def test_fail_still_and_no_face():
    v = syllables(1)
    assert S.REASON_STILL in judged([0.02] * len(v), v, OTHERS)["reasons"]
    assert S.REASON_NO_FACE in judged(v, v, OTHERS, face_found=0.4)["reasons"]


def test_missing_mediapipe_or_model_is_unmeasured_not_pass():
    os.environ["LIPSYNC_FACE_MODEL"] = "/nonexistent/face_landmarker.task"
    try:
        j = S.measure_clip_landmarks("no-such-clip.mp4", "a.wav", ["b.wav", "c.wav"])
    finally:
        del os.environ["LIPSYNC_FACE_MODEL"]
    assert j["verdict"] == S.UNMEASURED and j["reasons"], j


def test_too_few_changing_frames_is_unmeasured():
    try:
        S.measure_sync([.1] * 5, [.5] * 5, OTHERS, FPS)
    except ValueError:
        return
    raise AssertionError("expected ValueError (unmeasured)")


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
