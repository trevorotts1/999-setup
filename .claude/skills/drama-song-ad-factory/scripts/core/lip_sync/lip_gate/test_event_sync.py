#!/usr/bin/env python3
"""event_sync verdicts, events() construction and the negative-control rule. $0.
Run: python3 scripts/core/lip_sync/lip_gate/test_event_sync.py"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIP = os.path.dirname(HERE)
if LIP not in sys.path:
    sys.path.insert(0, LIP)
os.environ.setdefault("DSAF_GOVERNOR_DIR", tempfile.mkdtemp(prefix="dsaf-gov-"))
import lip_gate.lip_gate as L                          # noqa: E402

FPS = 30
RUNS = [(1.0, 2.0), (3.0, 4.0), (5.0, 6.0), (7.0, 8.0)]     # 1 s voiced, 1 s rests
DUR = 9.0


def env_of(runs, dur=DUR):
    return [0.9 if any(a <= i / FPS < b for a, b in runs) else 0.01
            for i in range(int(dur * FPS))]


def mouth_of(runs, dur=DUR, shut=0.02, open_=0.10):
    return L._smooth([open_ if any(a <= i / FPS < b for a, b in runs) else shut
                      for i in range(int(dur * FPS))])


EV = L.events(env_of(RUNS), [], FPS)


def test_events_onsets_offsets_and_bilabials():
    assert [(e["kind"], round(e["t"], 1)) for e in EV["events"]] == [
        ("onset", 1.0), ("offset", 2.0), ("onset", 3.0), ("offset", 4.0),
        ("onset", 5.0), ("offset", 6.0), ("onset", 7.0), ("offset", 8.0)]
    ws = [{"word": "Pray", "start_s": 1.0, "end_s": 1.4},
          {"word": "light", "start_s": 1.4, "end_s": 1.9},
          {"word": "home", "start_s": 3.0, "end_s": 3.5}]
    kinds = [e["kind"] for e in L.events(env_of(RUNS), ws, FPS)["events"]]
    assert kinds.count("bilabial") == 2          # Pray (p), home (m); light has none
    # a gap shorter than REST_S is not a rest: one run, one onset
    short = L.events(env_of([(1.0, 2.0), (2.08, 3.0)]), [], FPS)
    assert [e["kind"] for e in short["events"]] == ["onset", "offset"]
    # Suno stamps: either key spelling, rebased to the span start
    out = L.rebase_words([{"word": "a", "startS": 10.5, "endS": 11.0},
                          {"word": "b", "start_s": 30.0, "end_s": 31.0}], 10.0, 12.0)
    assert out == [{"word": "a", "start_s": 0.5, "end_s": 1.0}]


def test_synced_needs_hit_and_margin():
    r = L.event_sync(mouth_of(RUNS), EV, [], FPS)
    assert r["verdict"] == L.SYNCED and r["hit"] == 1.0 and r["margin"] >= 0.2, r
    assert r["n_events"] == 8 and r["hard_defects"] == []


def test_tolerance_is_plus_minus_point_two_seconds():
    def at(shift):
        m = mouth_of([(a + shift, b + shift) for a, b in RUNS])
        return L.event_sync(m, EV, [], FPS)["hit"]
    assert at(0.15) >= 0.9 and at(-0.15) >= 0.9          # inside
    assert at(0.45) < 0.7 and at(-0.45) < 0.7            # outside
    lag = L.event_sync(mouth_of([(a + 0.1, b + 0.1) for a, b in RUNS]), EV, [], FPS)["lag_s"]
    assert 0.02 <= lag <= 0.15, lag                      # mouth late = positive


def test_unmeasurable_few_events_or_no_face():
    few = L.events(env_of([(1.0, 2.0), (3.0, 4.0)]), [], FPS)
    assert len(few["events"]) == 4                        # exactly the floor: measurable
    one = L.events(env_of([(1.0, 2.0)]), [], FPS)
    assert L.event_sync(mouth_of([(1.0, 2.0)]), one, [], FPS)["verdict"] == L.UNMEASURABLE
    m = mouth_of(RUNS)
    m = [None if i % 5 < 2 else v for i, v in enumerate(m)]   # face in 60% of frames
    assert L.event_sync(m, EV, [], FPS)["verdict"] == L.UNMEASURABLE
    assert L.event_sync([None] * 270, EV, [], FPS)["verdict"] == L.UNMEASURABLE


def test_hard_defects_are_not_synced_each_with_its_name():
    still = L.event_sync([0.05] * 270, EV, [], FPS)
    assert still["verdict"] == L.NOT_SYNCED and "MOUTH_STILL" in still["hard_defects"]
    shut = mouth_of(RUNS)
    for i in range(int(1.0 * FPS), int(2.0 * FPS)):            # shut through a 1 s voiced run
        shut[i] = 0.02
    r = L.event_sync(shut, EV, [], FPS)
    assert r["verdict"] == L.NOT_SYNCED and "MOUTH_CLOSED_THROUGH_VOICE" in r["hard_defects"], r
    flap = mouth_of(RUNS)
    for i in range(int(4.3 * FPS), int(4.8 * FPS)):            # opens wide inside a 1 s rest
        flap[i] = 0.10
    r = L.event_sync(flap, EV, [], FPS)
    assert "MOUTH_MOVING_THROUGH_REST" in r["hard_defects"] and r["verdict"] == L.NOT_SYNCED
    # hit <= 0.40 with >= 6 events
    off = L.event_sync(mouth_of([(a + 0.5, b + 0.5) for a, b in RUNS]), EV, [], FPS)
    assert off["verdict"] == L.NOT_SYNCED and "HIT_LOW" in off["hard_defects"]


def test_weak_is_everything_else_and_never_a_redo_trigger():
    # one closure missed out of 8 events is not a defect, and the margin is poor
    other = [dict(e, t=e["t"] + 0.0) for e in EV["events"]]
    r = L.event_sync(mouth_of(RUNS), EV, [other], FPS)          # control == own events
    assert r["verdict"] == L.WEAK and r["margin"] < 0.2 and r["hard_defects"] == []
    assert not L.hard_defect(r)


def test_other_line_controls_beat_a_repeated_hook():
    # a repeated hook: another line has the same events, so the margin is nil
    r = L.event_sync(mouth_of(RUNS), EV, [L.scale_events(EV, DUR, DUR)], FPS)
    assert r["margin"] <= 0.0 and r["verdict"] != L.SYNCED


def test_wrong_audio_and_still_are_never_synced_cartoon_unmeasurable():
    wrong = [(0.4, 1.3), (2.2, 3.4), (4.6, 5.2), (6.1, 7.4)]
    assert L.event_sync(mouth_of(wrong), EV, [], FPS)["verdict"] != L.SYNCED
    assert L.event_sync([0.05] * 270, EV, [], FPS)["verdict"] == L.NOT_SYNCED
    assert L.event_sync([None] * 270, EV, [], FPS)["verdict"] == L.UNMEASURABLE


def test_selftest_runs_the_negative_controls():
    res = L.selftest()
    assert res["ok"]
    for k in ("negatives:own audio shifted 0.5 s", "negatives:still face",
              "negatives:no face (cartoon)", "negatives:wrong audio"):
        assert k in res["negatives"] and L.SYNCED not in res["negatives"][k], k
    assert sum(res["negatives"]["negatives:wrong audio"].values()) == 12 * 11
    assert L.NOT_SYNCED not in res["positives"]["positives:own audio"]


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
    print("ALL CHECKS PASS")
