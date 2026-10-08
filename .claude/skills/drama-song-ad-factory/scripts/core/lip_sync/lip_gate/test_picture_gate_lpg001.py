#!/usr/bin/env python3
"""LPG001/LPG002: measured close-up gate, auto-fix, face-model install, paid
regeneration through kie_dispatch, bound upload, dispatcher hard block.
$0: the measurer, the transport and the network are all injected.
Run: python3 test_picture_gate_lpg001.py   (passes with an empty HOME)"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, CORE)
import picture_gate as G                               # noqa: E402
import picture_measure as PM                           # noqa: E402
import install_face_model as IM                        # noqa: E402
import kie_dispatch.kie_dispatch as D                  # noqa: E402
import spend_ledger as L                               # noqa: E402

# the real numbers measured on 2026-10-08
GOOD = {"face_count": 1, "face_h_pct": 37.8, "roll_deg": -4.3, "yaw_proxy": -0.045,
        "smile": 0.36, "jaw_open": 0.0, "inner_gap_pct": 0.03, "sharp_face_256": 375.1}
RESET_28 = dict(GOOD, face_h_pct=28.1, roll_deg=2.3, smile=0.62, inner_gap_pct=0.33)
RESET_CROP = dict(GOOD, face_h_pct=36.8, roll_deg=2.3, smile=0.59, inner_gap_pct=0.33)
DAUGHTER = dict(GOOD, face_h_pct=34.4, roll_deg=-7.8, smile=0.83, inner_gap_pct=1.65)
CARD = {"answers": {"video_style": "Lifelike 3D", "audio_style": "Soul Ballad",
                    "length": 60, "video_model": "MiniMax H3 768P"},
        "who": "test", "at": "2026-10-08T09:00:00Z"}


def codes(n):
    return {c for c, _ in G.check_numbers(n)}


def pic(d, name="a.png", data=b"x"):
    p = os.path.join(d, name)
    open(p, "wb").write(data)
    return p


def refused(fn, *a, **k):
    try:
        fn(*a, **k)
    except G.LipsyncPictureNotGated as e:
        return str(e)
    raise AssertionError("expected LipsyncPictureNotGated")


def test_one_rule_set():
    assert (G.REQUIRED_FACE_COUNT, G.MIN_FACE_HEIGHT_PCT, G.MAX_FACE_HEIGHT_PCT,
            G.MAX_ABS_ROLL_DEG, G.MAX_ABS_YAW, G.MAX_SMILE, G.MAX_JAW_OPEN,
            G.MAX_LIP_GAP_PCT, G.MIN_SHARPNESS, G.MAX_FREE_CROPS, G.MAX_PAID_REGENS) == \
        (1, 35.0, None, 5.0, 0.12, 0.60, 0.15, 1.0, 100.0, 1, 2)
    assert G.REGEN_PROMPT == "neutral expression, lips closed, facing camera, head level"
    assert G.REGEN_MODEL == "gpt-image-2-image-to-image"


def test_numbers_on_the_real_pictures():
    assert codes(GOOD) == set() and codes(RESET_CROP) == set()
    assert {"FACE_SIZE", "SMILE"} <= codes(RESET_28)
    assert {"FACE_SIZE", "HEAD_ROLL", "SMILE", "TEETH"} <= codes(DAUGHTER)
    assert codes(dict(GOOD, face_h_pct=70.0)) == set()            # no upper limit
    assert codes(dict(GOOD, face_h_pct=35.0)) == set()
    assert "FACE_SIZE" in codes(dict(GOOD, face_h_pct=34.9))
    assert codes(dict(GOOD, smile=0.60)) == set() and "SMILE" in codes(dict(GOOD, smile=0.61))
    assert codes(dict(GOOD, yaw_proxy=0.12)) == set() and "HEAD_YAW" in codes(dict(GOOD, yaw_proxy=0.13))
    assert codes(dict(GOOD, roll_deg=-5.0)) == set() and "HEAD_ROLL" in codes(dict(GOOD, roll_deg=-5.1))
    assert codes(dict(GOOD, jaw_open=0.15)) == set() and "MOUTH_OPEN" in codes(dict(GOOD, jaw_open=0.16))
    assert codes(dict(GOOD, inner_gap_pct=1.0)) == set() and "TEETH" in codes(dict(GOOD, inner_gap_pct=1.01))
    assert codes(dict(GOOD, sharp_face_256=100)) == set() and "SOFT" in codes(dict(GOOD, sharp_face_256=99))
    assert codes(dict(GOOD, face_count=2)) == {"FACE_COUNT"}
    assert codes(dict(GOOD, face_count=0)) == {"FACE_COUNT"}
    assert "UNMEASURED" in codes({k: v for k, v in GOOD.items() if k != "smile"})


def test_small_face_one_free_crop_then_passes():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d, "a.png", b"small")
        meas = lambda p: RESET_CROP if p.endswith("-crop.png") else RESET_28 if p == a else None
        # 28.1% + smile .62 -> crop makes 36.8% / smile .59 -> PASS, no paid call
        res = G.gate_picture(a, measure=meas, crop=lambda p, o: pic(d, os.path.basename(o), b"crop"),
                             regenerate=lambda p, q: (_ for _ in ()).throw(AssertionError("paid")))
        assert res["verdict"] == "PASS" and res["image"].endswith("-crop.png"), res
        assert [x["verdict"] for x in res["attempts"]] == ["FAIL", "PASS"]
        G.require_receipt(res["image"])


def test_only_one_free_crop():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d, "a.png", b"small")
        n = []
        def crop(p, o):
            n.append(1)
            return pic(d, os.path.basename(o), b"crop")
        res = G.gate_picture(a, measure=lambda p: RESET_28, crop=crop)
        assert res["verdict"] == "FAIL" and len(n) == 1


def test_smile_teeth_tilt_get_two_paid_regens_then_refuse():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d, "a.png", b"smile")
        res = G.gate_picture(a, measure=lambda p: DAUGHTER)       # no paid fix: FAIL
        assert res["verdict"] == "FAIL"
        refused(G.require_receipt, a)
        calls = []
        def regen(p, prompt):
            calls.append(prompt)
            return pic(d, "r%d.png" % len(calls), b"r%d" % len(calls))
        meas = lambda p: GOOD if p.endswith("r2.png") else DAUGHTER
        res = G.gate_picture(a, measure=meas, crop=lambda p, o: None, regenerate=regen)
        assert res["verdict"] == "PASS" and calls == [G.REGEN_PROMPT] * 2, calls
        calls.clear()                                             # never passes: capped at 2
        res = G.gate_picture(a, measure=lambda p: DAUGHTER, crop=lambda p, o: None, regenerate=regen)
        assert res["verdict"] == "FAIL" and len(calls) == 2, calls
        # a size-only failure is never worth a paid regen
        calls.clear()
        G.gate_picture(a, measure=lambda p: dict(GOOD, face_h_pct=30.0),
                       crop=lambda p, o: None, regenerate=regen)
        assert calls == []


def test_missing_mediapipe_or_model_refuses_and_names_install():
    real = PM._deps
    def gone():
        raise PM.PictureGateUnavailable("mediapipe not importable")
    PM._deps = gone
    try:
        with tempfile.TemporaryDirectory() as d:
            a = pic(d)
            res = G.gate_picture(a)
            assert res["verdict"] == "FAIL" and res["reasons"][0][0] == "GATE_UNAVAILABLE"
            refused(G.require_receipt, a)
    finally:
        PM._deps = real
    old = os.environ.get(PM.MODEL_ENV)
    os.environ[PM.MODEL_ENV] = os.path.join(tempfile.gettempdir(), "no-such-model.task")
    try:
        try:
            PM.model_path()
            raise AssertionError("must refuse")
        except PM.PictureGateUnavailable as e:
            assert "install_face_model.py" in str(e), e
    finally:
        os.environ.pop(PM.MODEL_ENV, None)
        if old is not None:
            os.environ[PM.MODEL_ENV] = old


def test_face_model_install_pins_sha256():
    prereqs = json.load(open(os.path.join(HERE, "..", "..", "..", "..", "PREREQS.json")))
    ids = {e["id"]: e for e in prereqs["prerequisites"]}
    assert ids["face-landmarker-model"]["check"]["sha256"] == IM.MODEL_SHA256
    assert "install_face_model.py" in ids["face-landmarker-model"]["satisfy"]
    assert "mediapipe" in ids["python-mediapipe"]["satisfy"]
    assert IM.MODEL_URL.startswith("https://storage.googleapis.com/mediapipe-models/"
                                   "face_landmarker/face_landmarker/float16/latest/")
    data = b"pretend model"
    import hashlib, io
    sha = hashlib.sha256(data).hexdigest()
    opener = lambda url, timeout=0: io.BytesIO(data)
    with tempfile.TemporaryDirectory() as d:
        dest = os.path.join(d, "assets", "face_landmarker.task")
        try:
            IM.install(dest, sha256="0" * 64, opener=opener)         # wrong pin
            raise AssertionError("must refuse a hash mismatch")
        except RuntimeError:
            pass
        assert not os.path.exists(dest) and not os.path.exists(dest + ".part")
        assert IM.install(dest, sha256=sha, opener=opener) == dest   # right pin: placed
        assert open(dest, "rb").read() == data
        assert not IM.is_good(dest)                                  # not the real pinned model


def _fake74(script, calls):
    def run(argv):
        calls.append(list(argv))
        return script[argv[1]]
    return run


def test_default_regenerate_goes_through_dispatch_ledger_and_cap():
    with tempfile.TemporaryDirectory() as d:
        db = os.path.join(d, "spend.db")
        L.init_run(db, "run1", 10000)
        char = pic(d, "char3d.png", b"3d character")
        out = pic(d, "regen.png", b"neutral")
        calls = []
        run = _fake74({
            "health": (0, {"adapter_mode": "active", "state": "success"}),
            "preflight": (0, {"state": "validated", "data": {"ok": True}}),
            "prompt-budget": (0, {"state": "success", "data": {"status": "OK", "exit_code": 0}}),
            "upload": (0, {"state": "success", "data": {"download_url": "https://k/char.png"}}),
            "submit": (0, {"state": "queued", "task_id": "t1", "raw_family": "market"}),
            "wait": (0, {"state": "success", "task_id": "t1", "raw_family": "market",
                         "credits_consumed": 9}),
            "save": (0, {"state": "success", "task_id": "t1", "saved_paths": [out],
                         "credits_consumed": 9})}, calls)
        regen = G.make_regenerate(char, save_dir=os.path.join(d, "o"), ledger_db=db,
                                  run_id="run1", logical_key="regen", estimated_cost=10,
                                  card_receipt=CARD, adapter_path=os.path.abspath(__file__),
                                  runner=run)
        assert regen("ignored", G.REGEN_PROMPT) == out
        assert [c[1] for c in calls] == ["upload", "health", "preflight", "prompt-budget",
                                         "submit", "wait", "save"], calls
        pre = [c for c in calls if c[1] == "preflight"][0]
        assert G.REGEN_MODEL in pre
        import sqlite3
        row = sqlite3.connect(db).execute(
            "SELECT state, final_outcome, actual_cost FROM jobs WHERE logical_key='regen'").fetchone()
        assert row == ("reconciled", "succeeded", 9), row          # reserved + settled on the ledger
        # the author's cap is enforced: a cap of 5 refuses a 10-credit regeneration
        db2 = os.path.join(d, "cap.db")
        L.init_run(db2, "run2", 5)
        calls.clear()
        regen2 = G.make_regenerate(char, save_dir=d, ledger_db=db2, run_id="run2",
                                   logical_key="regen", estimated_cost=10, card_receipt=CARD,
                                   adapter_path=os.path.abspath(__file__), runner=run)
        try:
            regen2("x", G.REGEN_PROMPT)
            raise AssertionError("over-cap regeneration must fail")
        except G.RegenerationFailed:
            pass
        assert "submit" not in [c[1] for c in calls]
        # and gate_picture turns that failure into a refusal, not a pass
        a = pic(d, "a.png", b"smile")
        res = G.gate_picture(a, measure=lambda p: DAUGHTER, regenerate=regen2)
        assert res["verdict"] == "FAIL" and res["reasons"][-1][0] == "REGEN_FAILED"


def test_real_transport_rides_load_governor_kie_request():
    seen = []
    real_kr, real_run = D._LG.kie_request, D.subprocess.run
    def spy(fn, label="kie", **kw):
        seen.append((label, kw.get("generation")))
        return real_kr(fn, label, **dict(kw, acquire=lambda: None))
    class R:
        returncode, stdout = 0, json.dumps({"state": "success",
                                            "data": {"download_url": "https://k/x.png"}})
    D._LG.kie_request, D.subprocess.run = spy, lambda *a, **k: R()
    try:
        url = G.adapter_uploader(adapter_path=os.path.abspath(__file__))("/tmp/x.png")
    finally:
        D._LG.kie_request, D.subprocess.run = real_kr, real_run
    assert url == "https://k/x.png" and len(seen) == 1 and seen[0][1] is False, seen


def test_upload_is_bound_to_the_measured_bytes():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d, data=b"v1")
        refused(G.upload_measured, a, lambda f: "https://k/a.png")      # no receipt: no upload
        G.gate_picture(a, measure=lambda p: GOOD)
        sent = []
        def up(f):
            sent.append(open(f, "rb").read())
            return "https://k/a.png"
        url = G.upload_measured(a, up)
        assert url == "https://k/a.png" and sent == [b"v1"]
        G.require_upload_bound(a, url)
        refused(G.require_upload_bound, a, "https://k/other.png")        # some other URL
        refused(G.require_upload_bound, a, None)
        # bytes that differ at upload time from the measured ones are refused
        import shutil
        real = shutil.copyfile
        def swap(src, dst):
            real(src, dst)
            open(dst, "wb").write(b"swapped")
        shutil.copyfile = swap
        try:
            msg = refused(G.upload_measured, a, lambda f: "https://k/b.png")
        finally:
            shutil.copyfile = real
        assert "changed between measuring and upload" in msg
        open(a, "wb").write(b"v2")                                       # edited after the receipt
        refused(G.require_receipt, a)


def _req(a=None, url=None, **kw):
    r = {"input": {"prompt": "p"}}
    if a:
        r["lipsync_image_path"] = a
    if url:
        r["input"]["image_url"] = url
    return dict(r, **kw)


def test_dispatcher_hard_block():
    with tempfile.TemporaryDirectory() as d:
        a = pic(d)
        for model in ("kling/ai-avatar-standard", "kling/ai-avatar-pro", "infinitalk/from-audio"):
            env = D.dispatch(model=model, request=_req(a, "https://k/a.png"), save_dir=d,
                             ledger_db=os.path.join(d, "l.db"), run_id="r", logical_key="k",
                             attempt_id="a", estimated_cost=1)
            assert env["reason_code"] == "LIPSYNC_PICTURE_NOT_GATED", env
            assert env["outcome"] == "rejected" and env["evidence"]["generated"] is False
        m = "kling/ai-avatar-pro"
        assert D.lipsync_picture_refusal(m, _req())                       # no path at all
        G.gate_picture(a, measure=lambda p: RESET_28)                     # FAIL receipt
        assert D.lipsync_picture_refusal(m, _req(a, "https://k/a.png"))
        G.gate_picture(a, measure=lambda p: GOOD)                         # PASS receipt
        assert D.lipsync_picture_refusal(m, _req(a, "https://k/a.png"))   # but not uploaded/bound
        url = G.upload_measured(a, lambda f: "https://k/a.png")
        assert D.lipsync_picture_refusal(m, _req(a, url)) is None         # measured + bound: go
        assert D.lipsync_picture_refusal(m, _req(a, "https://k/evil.png"))  # some other image
        assert D.lipsync_picture_refusal(m, _req(a))                      # no image_url
        assert D.lipsync_picture_refusal("kling-3.0/video", _req()) is None   # not lip-sync


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
    print("ALL CHECKS PASS")
