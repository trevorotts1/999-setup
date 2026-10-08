#!/usr/bin/env python3
"""LPG001: measured close-up gate + dispatcher hard block. $0, no mediapipe
needed (the measurer is injected). Run: python3 test_picture_gate_lpg001.py"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, CORE)
import picture_gate as G                               # noqa: E402
import picture_measure as PM                           # noqa: E402
import kie_dispatch.kie_dispatch as D                  # noqa: E402

# the real numbers measured on 2026-10-08
GOOD = {"face_count": 1, "face_h_pct": 37.8, "roll_deg": -4.3, "yaw_proxy": -0.045,
        "smile": 0.36, "jaw_open": 0.0, "inner_gap_pct": 0.03, "sharp_face_256": 375.1}
RESET_28 = dict(GOOD, face_h_pct=28.1, roll_deg=2.3, smile=0.62, inner_gap_pct=0.33)
DAUGHTER = dict(GOOD, face_h_pct=34.4, roll_deg=-7.8, smile=0.83, inner_gap_pct=1.65)


def codes(n):
    return {c for c, _ in G.check_numbers(n)}


def pic(d, name="a.png", data=b"x"):
    p = os.path.join(d, name)
    open(p, "wb").write(data)
    return p


def test_numbers():
    assert codes(GOOD) == set()
    assert "FACE_SIZE" in codes(RESET_28) and "SMILE" in codes(RESET_28)
    assert {"FACE_SIZE", "HEAD_ROLL", "SMILE", "TEETH"} <= codes(DAUGHTER)
    assert codes(dict(GOOD, face_count=2)) == {"FACE_COUNT"}
    assert codes(dict(GOOD, face_count=0)) == {"FACE_COUNT"}
    assert "SOFT" in codes(dict(GOOD, sharp_face_256=20))
    assert "HEAD_YAW" in codes(dict(GOOD, yaw_proxy=0.3))
    assert "MOUTH_OPEN" in codes(dict(GOOD, jaw_open=0.4))
    assert "SMILE" in codes({k: v for k, v in GOOD.items() if k != "smile"})  # unmeasured


def test_small_face_cropped_free_then_passes():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d, "a.png", b"small")
        meas = lambda p: dict(GOOD, face_h_pct=36.8) if p.endswith("-crop.png") \
            else dict(GOOD, face_h_pct=28.1)
        res = G.gate_picture(a, measure=meas, crop=lambda p, o: pic(d, os.path.basename(o), b"crop"))
        assert res["verdict"] == "PASS" and res["image"].endswith("-crop.png"), res
        assert [x["verdict"] for x in res["attempts"]] == ["FAIL", "PASS"]
        G.require_receipt(res["image"])


def test_smile_teeth_fails_without_paid_fix_and_regenerates_with_one():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d, "a.png", b"smile")
        res = G.gate_picture(a, measure=lambda p: DAUGHTER)
        assert res["verdict"] == "FAIL"
        try:
            G.require_receipt(a)
            raise SystemExit("FAIL receipt must refuse")
        except G.LipsyncPictureNotGated:
            pass
        calls = []
        def regen(p, prompt):
            calls.append(prompt)
            return pic(d, "b.png", b"neutral")
        res = G.gate_picture(a, measure=lambda p: GOOD if p.endswith("b.png") else DAUGHTER,
                             regenerate=regen)
        assert res["verdict"] == "PASS" and calls == [G.REGEN_PROMPT]
        # regeneration is capped
        n = []
        G.gate_picture(a, measure=lambda p: DAUGHTER,
                       regenerate=lambda p, q: (n.append(1), pic(d, "c%d.png" % len(n), b"c%d" % len(n)))[1])
        assert len(n) == G.MAX_REGEN


def test_mediapipe_missing_is_refused():
    real = PM._deps
    def gone():
        raise PM.PictureGateUnavailable("mediapipe not importable")
    PM._deps = gone
    try:
        with tempfile.TemporaryDirectory() as d:
            a = pic(d)
            res = G.gate_picture(a)
            assert res["verdict"] == "FAIL" and res["reasons"][0][0] == "GATE_UNAVAILABLE"
            try:
                G.require_receipt(a)
                raise SystemExit("must refuse")
            except G.LipsyncPictureNotGated:
                pass
    finally:
        PM._deps = real


def test_receipt_is_per_exact_bytes():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d, data=b"v1")
        G.gate_picture(a, measure=lambda p: GOOD)
        assert G.require_receipt(a)["numbers"]["face_h_pct"] == 37.8
        open(a, "wb").write(b"v2")                    # same name, new bytes
        try:
            G.require_receipt(a)
            raise SystemExit("changed bytes must refuse")
        except G.LipsyncPictureNotGated:
            pass


def _req(**kw):
    return dict({"model": "kling/ai-avatar-standard", "input": {"prompt": "p"}}, **kw)


def test_dispatcher_refuses_without_receipt():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d)
        for req in (_req(), _req(lipsync_image_path=a)):          # no path / no receipt
            env = D.dispatch(model="kling/ai-avatar-standard", request=req, save_dir=d,
                             ledger_db=os.path.join(d, "l.db"), run_id="r", logical_key="k",
                             attempt_id="a", estimated_cost=1)
            assert env["reason_code"] == "LIPSYNC_PICTURE_NOT_GATED", env
            assert env["outcome"] == "rejected" and env["evidence"]["generated"] is False
        G.gate_picture(a, measure=lambda p: RESET_28)             # FAIL receipt
        assert D.lipsync_picture_refusal("kling/ai-avatar-pro", _req(lipsync_image_path=a))
        G.gate_picture(a, measure=lambda p: GOOD)                 # PASS receipt
        assert D.lipsync_picture_refusal("kling/ai-avatar-pro", _req(lipsync_image_path=a)) is None
        assert D.lipsync_picture_refusal("kling-3.0/video", _req()) is None   # not lip-sync


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
    print("ALL CHECKS PASS")
