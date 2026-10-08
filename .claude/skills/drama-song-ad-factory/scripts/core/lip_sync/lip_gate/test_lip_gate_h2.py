#!/usr/bin/env python3
"""H2 tests: lip-sync gate, two-try keep-best rule. Stdlib only, $0, mocked providers.

DONE-WHEN: a hard defect gets exactly one changed-input retry; WEAK and
UNMEASURABLE never retry; a 3rd paid job per segment is refused in code (every
name variant counted); after 2 tries the best-measured take is kept and the
receipt says KEPT_BEST_OF_2; no InfiniTalk; every paid call goes through
load_governor.kie_request(generation=True), landmarks through heavy_slot.

Run: python3 core/lip_sync/lip_gate/test_lip_gate_h2.py
"""
import contextlib
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIP = os.path.dirname(HERE)
if LIP not in sys.path:
    sys.path.insert(0, LIP)

os.environ.setdefault("DSAF_GOVERNOR_DIR", tempfile.mkdtemp(prefix="dsaf-gov-"))
import lip_gate.lip_gate as L                        # noqa: E402  (the module, not the package)

PIC = {"source_image": "closeup.png",
       "image_check": lambda img: {"pass": True}}   # picture gate has its own test


def j(verdict, hit=None, margin=None, lag=0.0, **kw):
    return dict({"verdict": verdict, "hit": hit, "margin": margin, "lag_s": lag,
                 "n_events": 10, "face_share": 1.0, "control_hit": 0.3,
                 "hard_defects": [], "mouth_strip": "strip.png"}, **kw)


SYNCED = j(L.SYNCED, 0.9, 0.5)
WEAK = j(L.WEAK, 0.6, 0.1)
BADJ = j(L.NOT_SYNCED, 0.2, -0.1, hard_defects=["HIT_LOW"])
BAD2 = j(L.NOT_SYNCED, 0.35, 0.0, hard_defects=["HIT_LOW"])


def mock(table):
    calls = []

    def gen(provider, spec):
        calls.append((provider, spec))
        return "clip%d" % len(calls)
    return calls, gen, lambda clip: table[clip]


def run(line, table, **kw):
    calls, gen, meas = mock(table)
    row = L.run_gate(line, gen, meas, **dict(PIC, **kw))
    return calls, row


NEXT = {"window": "next-best", "lead_in_s": 0.30}


def test_synced_first_try_one_job_pass():
    calls, row = run("ch1_ls1", {"clip1": SYNCED}, next_input=NEXT)
    assert len(calls) == 1 and row["verdict"] == "PASS" and row["jobs_used"] == 1
    assert calls[0][0] == "kling" and calls[0][1]["lead_in_s"] == 0.30
    assert calls[0][1]["tail_s"] == 0.20, "padding is the default for try 1"


def test_weak_and_unmeasurable_never_retry_and_are_kept_flagged():
    for v in (WEAK, j(L.UNMEASURABLE, reason="few events")):
        calls, row = run("ch1_ls2", {"clip1": v}, next_input=NEXT)
        assert len(calls) == 1, "no redo on %s" % v["verdict"]
        assert row["verdict"] == L.KEPT and row["flag"] and row["mouth_strip"]
        assert L.qc_check([row])["pass"]


def test_hard_defect_retries_once_with_changed_input_keeps_better():
    calls, row = run("ch1_ls3", {"clip1": BADJ, "clip2": SYNCED}, next_input=NEXT)
    assert len(calls) == 2 and calls[1][1] != calls[0][1]
    assert calls[1][1]["window"] == "next-best"
    assert row["verdict"] == "PASS" and row["kept_try"] == 2 and row["jobs_used"] == 2


def test_two_tries_then_best_of_two_kept_never_a_third():
    calls, row = run("ch1_ls4", {"clip1": BADJ, "clip2": BAD2}, next_input=NEXT)
    assert len(calls) == 2
    assert row["verdict"] == L.KEPT and row["kept_try"] == 2   # hit .35 > .20
    assert row["receipt"].startswith("KEPT_BEST_OF_2 (t2), NOT_SYNCED")
    assert "HIT_LOW" in row["flag"] and L.qc_check([row])["pass"]
    # best take wins even when it is try 1
    _, row = run("ch1_ls5", {"clip1": WEAK, "clip2": BADJ},
                 next_input=NEXT, defect_check=lambda c: ["HAND_OVER_MOUTH"]
                 if c == "clip1" else [])
    assert row["jobs_used"] == 2 and row["kept_try"] == 1   # WEAK tier beats NOT_SYNCED


def test_no_changed_input_means_no_second_job():
    calls, row = run("ch1_ls6", {"clip1": BADJ})
    assert len(calls) == 1 and "NO_CHANGED_INPUT" in row["flag"]
    assert row["verdict"] == L.KEPT


def test_identical_resubmit_refused():
    same = dict(L.IMPROVED_INPUT, source_image=PIC["source_image"],
                prompt=L.kling_prompt("sung"))
    calls, _ = run("ch1_ls7", {"clip1": BADJ, "clip2": SYNCED}, next_input={})
    assert len(calls) == 1, "an empty next_input is no changed input"
    # next_input that does not change anything is refused with LIP_SAME_INPUT
    calls, gen, meas = mock({"clip1": BADJ, "clip2": SYNCED})
    try:
        L.run_gate("ch1_ls7", gen, meas, next_input={"line": same["line"]}, **PIC)
    except L.LipsyncTryLimit as e:
        assert e.code == L.LIP_SAME_INPUT
    else:
        raise AssertionError("identical resubmit was not refused")
    assert len(calls) == 1


def test_third_paid_job_refused_counting_every_name_variant():
    tries = {}
    run("ch3_ls1", {"clip1": BADJ, "clip2": BAD2}, next_input=NEXT, tries=tries)
    assert tries == {"ch3ls1": 2}
    for variant in ("ch3_ls1", "CH3-LS1-v2", "ch3 ls1 redo3", "ch3_ls1_take2.mp4"):
        calls, gen, meas = mock({"clip1": SYNCED})
        try:
            L.run_gate(variant, gen, meas, tries=tries, **PIC)
        except L.LipsyncTryLimit as e:
            assert e.code == L.LIP_TRY_LIMIT, e
        else:
            raise AssertionError("3rd job allowed for " + variant)
        assert calls == [], "no spend after the limit"
    assert L.segment_key("ch3_ls2") != L.segment_key("ch3_ls1")
    assert L.jobs_for_segment(["ch3_ls1", "ch3-ls1-v2", "ch3_ls2"], "CH3 LS1") == 2


def test_no_infinitalk_anywhere():
    src = open(os.path.join(HERE, "lip_gate.py")).read().lower()
    assert "ab_state" not in src and "infinitalk_ab" not in src
    calls, _ = run("ch4_ls1", {"clip1": BADJ, "clip2": BADJ}, next_input=NEXT)
    assert {c[0] for c in calls} == {"kling"} and len(calls) == 2


def test_every_paid_call_goes_through_kie_request_generation():
    seen = []
    real = L._LG.kie_request

    def spy(fn, label="kie", **kw):
        seen.append((label, kw.get("generation")))
        return real(fn, label, **kw)
    L._LG.kie_request = spy
    try:
        run("ch5_ls1", {"clip1": BADJ, "clip2": BADJ}, next_input=NEXT)
    finally:
        L._LG.kie_request = real
    assert len(seen) == 2 and all(g is True for _, g in seen), seen


def test_landmarks_run_inside_heavy_slot():
    events_ = []

    @contextlib.contextmanager
    def slot(job, **kw):
        events_.append(("enter", job))
        yield
        events_.append(("exit", job))
    real = L._LG.heavy_slot
    L._LG.heavy_slot = slot
    try:
        out = L.mouth_series("c.mp4", extract=lambda c: events_.append(("run", c)) or [0.1, None])
    finally:
        L._LG.heavy_slot = real
    assert out == [0.1, None]
    assert [e[0] for e in events_] == ["enter", "run", "exit"]


def test_score_ranking_order():
    hard = j(L.SYNCED, 0.99, 0.9, visual_defects=["TEXT_ON_CHEST"])
    ranks = [SYNCED, WEAK, j(L.UNMEASURABLE), BADJ]
    order = sorted(ranks + [hard], key=L.score, reverse=True)
    assert [x["verdict"] for x in order[:3]] == [L.SYNCED, L.WEAK, L.UNMEASURABLE]
    assert order[-1] is hard or order[-2] is hard    # a defect never beats a clean take
    assert L.score(j(L.WEAK, 0.7, 0.1, lag=0.0)) > L.score(j(L.WEAK, 0.7, 0.1, lag=0.1))
    assert L.score(j(L.WEAK, 0.7, 0.2)) > L.score(j(L.WEAK, 0.7, 0.1))


def test_qc_check_accepts_pass_and_flagged_kept_rejects_rest():
    ok = {"line_id": "a", "verdict": "PASS", "numbers": {}}
    kept = {"line_id": "b", "verdict": L.KEPT, "numbers": {}, "flag": "WEAK",
            "mouth_strip": "s.png"}
    assert L.qc_check([ok, kept])["pass"]
    for bad in (dict(kept, flag=""), dict(kept, mouth_strip=None),
                {"line_id": "c", "verdict": "FAIL_REPLACE", "numbers": {}},
                {"line_id": "d", "verdict": "PASS"}):
        assert not L.qc_check([ok, bad])["pass"], bad


def test_kling_prompt_sings_or_says_one_emotion():
    s = L.kling_prompt("sung", "woman", "earnest")
    assert "sings this line" in s and "Minimal head movement" in s and "steady locked camera" in s
    assert "speak" not in s.lower() and "open and close" not in s.lower()
    sp = L.kling_prompt("spoken", "man", "calm", "His")
    assert "says this line" in sp and "His whole face" in sp
    for bad in ("calm and earnest", "calm, earnest", "happy or sad"):
        try:
            L.kling_prompt("sung", emotion=bad)
        except ValueError:
            continue
        raise AssertionError(bad)
    try:
        L.kling_prompt("shouted")
    except ValueError:
        pass
    else:
        raise AssertionError


def test_selftest_passes_and_fails_if_a_negative_is_synced():
    assert L.main() == 0
    real = L.event_sync
    L.event_sync = lambda *a, **k: dict(real(*a, **k), verdict=L.SYNCED)
    try:
        assert not L.selftest()["ok"], "selftest must fail when a negative is SYNCED"
    finally:
        L.event_sync = real


def test_envelope_ffmpeg():
    ff = shutil.which("ffmpeg")
    if not ff:
        print("skip envelope (no ffmpeg)")
        return
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "t.wav")
        subprocess.run([ff, "-v", "error", "-f", "lavfi", "-i",
                        "sine=f=300:d=1,apad=pad_dur=1", "-t", "2", wav,
                        "-y"], check=True)
        env = L.envelope(wav, fps=30, ffmpeg=ff)
        short = L.envelope(wav, fps=30, ffmpeg=ff, start=0.5, dur=1.0)
    assert abs(len(env) - 60) <= 2 and abs(len(short) - 30) <= 2
    assert sum(env[:25]) / 25 > 20 * (sum(env[40:]) / 20 + 1e-9)
    runs = L.voiced_runs(env, 30)
    assert len(runs) == 1 and abs(runs[0][1] - 1.0) < 0.15


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
