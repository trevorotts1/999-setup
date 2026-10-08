#!/usr/bin/env python3
"""LSL002 tests: the validated sync algorithm and the verdict mapping. Stdlib only, no client
video, no mediapipe. Run: python3 test_sync_check.py (or pytest)."""
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import sync_check as S  # noqa: E402

FPS = 30


def speech(seed, n=150):
    r, out = random.Random(seed), []
    while len(out) < n:
        out += [r.uniform(.4, 1.0)] * r.randint(3, 6) + [.05] * r.randint(2, 4)
    return out[:n]


V = speech(1)
OTHERS = [speech(21), speech(22), speech(23)]


def meas(mouth, voice=V, others=OTHERS, **kw):
    return S.measure_sync(mouth, voice, others, FPS, **kw)


def test_constants_block():
    assert (S.MAX_LAG, S.CORR_FLOOR, S.MARGIN_FLOOR, S.SYNCED_MARGIN, S.CHANCE_PCT, S.MIN_FRAMES,
            S.MIN_FACE_FOUND, S.MIN_MOUTH_RANGE, S.MIN_OTHERS, S.LOOKALIKE, S.MAX_PAID_ATTEMPTS) == (
        10, 0.40, 0.0, 0.05, 0.20, 45, 0.95, 0.015, 2, 0.85, 2)


def test_synced_is_pass_sung_or_spoken():
    m = meas(V)
    assert m["grade"] == S.SYNCED and m["offset_frames"] == 0 and m["pct"] <= S.CHANCE_PCT, m
    assert S.judge_sync(m)["verdict"] == S.PASS and S.judge_sync(m, sung=True)["verdict"] == S.PASS


def test_lag_sign_mouth_late_is_positive_and_window_is_ten():
    assert meas([.05] * 4 + V[:-4])["offset_frames"] == 4          # mouth LATE
    assert meas(V[7:] + [.05] * 7)["offset_frames"] == -7          # mouth EARLY
    assert meas(V[10:] + [.05] * 10)["offset_frames"] == -10       # edge of the +-10 window


def test_wrong_audio_is_not_synced_fail_on_spoken_undetermined_on_sung():
    m = meas(OTHERS[0])
    assert m["grade"] == S.NOT_SYNCED and "margin" in m["failed"], m
    j = S.judge_sync(m)
    assert j["verdict"] == S.FAIL and S.REASON_WRONG_AUDIO in j["reasons"] and not j["hold_for_review"], j
    u = S.judge_sync(m, sung=True)
    assert u["verdict"] == S.UNDETERMINED and u["hold_for_review"] and u["flags"], u


def test_weak_maps_spoken_flag_sung_undetermined():
    m = dict(meas(V), grade=S.WEAK, margin=0.03, failed=[])
    f = S.judge_sync(m)
    assert f["verdict"] == S.FLAG and f["flags"] and f["reasons"] == [], f
    assert S.judge_sync(m, sung=True)["verdict"] == S.UNDETERMINED


def test_lookalike_repeated_hook_is_dropped_from_the_control():
    hook = [x * 0.5 for x in V]                       # same melody sung again, quieter
    m = meas(V, V, OTHERS + [hook])
    assert m["others_dropped_lookalike"] == 1 and m["grade"] == S.SYNCED, m


def test_clip_is_cut_to_the_audio_length_padding_ignored():
    padded = V + [random.Random(5).random() for _ in range(90)]    # Kling pads the tail
    m = meas(padded)
    assert m["frames"] == len(V) and m["grade"] == S.SYNCED, m


def test_chance_level_noise_is_not_synced():
    r = random.Random(9)
    grades = {meas([r.random() for _ in V])["grade"] for _ in range(6)}
    assert grades == {S.NOT_SYNCED}, grades


def test_unmeasurable_rules_never_pass():
    for kw, m in (("short", meas(V[:40], V[:40])),
                  ("no face", meas([None if i % 5 == 0 else v for i, v in enumerate(V)] )),
                  ("not human", meas(V, geo=0.2)),
                  ("silent", meas(V, [0.0] * len(V))),
                  ("still", meas([0.02] * len(V))),
                  ("one other line", meas(V, others=[OTHERS[0]]))):
        assert m["grade"] == S.UNMEASURABLE, (kw, m)
        for sung in (False, True):
            j = S.judge_sync(m, sung)
            assert j["verdict"] == S.UNMEASURABLE and S.REASON_UNMEASURED in j["reasons"], (kw, j)


def test_missing_mediapipe_or_model_is_unmeasurable_not_pass():
    os.environ["LIPSYNC_FACE_MODEL"] = "/nonexistent/face_landmarker.task"
    try:
        j = S.measure_clip_landmarks("no-such-clip.mp4", "a.wav", ["b.wav", "c.wav"])
    finally:
        del os.environ["LIPSYNC_FACE_MODEL"]
    assert j["verdict"] == S.UNMEASURABLE and j["reasons"], j


def test_face_model_path_is_the_picture_gate_path():
    os.environ.pop("LIPSYNC_FACE_MODEL", None)
    p = S.face_model_path()
    assert p.endswith(os.path.join("drama-song-ad-factory", "assets", "face_landmarker.task")), p
    os.environ["LIPSYNC_FACE_MODEL"] = "/x/y.task"
    try:
        assert S.face_model_path() == "/x/y.task"
    finally:
        del os.environ["LIPSYNC_FACE_MODEL"]


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
