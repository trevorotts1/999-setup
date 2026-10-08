#!/usr/bin/env python3
"""Lip-sync source-picture gate: refuses loudly before any paid job. $0.
Run: python3 scripts/core/lip_sync/lip_gate/test_image_gate.py"""
import os
import struct
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import lip_gate.image_gate as G                                 # noqa: E402
import lip_gate.lip_gate as L                          # noqa: E402


def png(w, h):
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IEND", b""))


GOOD = {"face_box": [340, 560, 400, 730], "yaw_deg": 2.0, "pitch_deg": -3.0, "roll_deg": 1.0,
        "mouth_open_ratio": 0.05, "smile_score": 0.1, "teeth_visible": False, "mouth_occluded": False,
        "jaw_occluded": False, "light_evenness": 0.9, "mouth_hard_shadow": False,
        "background_separation": 0.4, "reference_similarity": 0.93,
        "sharpness": 220.0, "provenance": "generated"}
SIZE = (1080, 1920)


def codes(size, a):
    return {c for c, _ in G.check_image(size, a)[0]}


def with_(**kw):
    return dict(GOOD, **kw)


def test_good_picture_passes():
    r, nums = G.check_image(SIZE, GOOD)
    assert r == [], r
    assert 0.30 <= nums["face_height_share"] <= 0.40


def test_each_rule_refuses_with_its_own_code():
    cases = [
        ((640, 1138), GOOD, G.RESOLUTION),
        ((1920, 1080), GOOD, G.NOT_PORTRAIT),
        (SIZE, with_(face_box=[200, 300, 700, 1400]), G.FACE_SIZE),   # 73%
        (SIZE, with_(face_box=[400, 700, 150, 200]), G.FACE_SIZE),    # 10%
        (SIZE, with_(face_box=[0, 560, 400, 730]), G.FRAMING),
        (SIZE, with_(yaw_deg=25.0), G.NOT_FRONTAL),
        (SIZE, with_(pitch_deg=-16.0), G.NOT_FRONTAL),
        (SIZE, with_(roll_deg=13.0), G.NOT_FRONTAL),
        (SIZE, with_(roll_deg=-13.0), G.NOT_FRONTAL),
        (SIZE, with_(mouth_open_ratio=0.5), G.MOUTH_OPEN),
        (SIZE, with_(smile_score=0.95, teeth_visible=True), G.TOOTHY_SMILE),
        (SIZE, with_(mouth_occluded=True), G.OCCLUDED),
        (SIZE, with_(jaw_occluded=True), G.OCCLUDED),
        (SIZE, with_(light_evenness=0.3), G.LIGHT),
        (SIZE, with_(mouth_hard_shadow=True), G.MOUTH_SHADOW),
        (SIZE, with_(background_separation=0.02), G.BACKGROUND),
        (SIZE, with_(reference_similarity=0.4), G.WRONG_CHARACTER),
        (SIZE, with_(sharpness=20.0), G.SOFT),
        (SIZE, with_(provenance="upscaled"), G.CROPPED),
    ]
    for size, a, code in cases:
        assert code in codes(size, a), (code, codes(size, a))


def test_accept_band_edges_but_not_beyond():
    for share in (0.25, 0.44):
        h = int(1920 * share)
        assert G.FACE_SIZE not in codes(SIZE, with_(face_box=[340, 500, 400, h]))
    for share in (0.22, 0.47):
        h = int(1920 * share)
        assert G.FACE_SIZE in codes(SIZE, with_(face_box=[340, 500, 400, h]))


def test_leanne_approved_control_numbers_pass():
    # approved LeAnne close-ups: face 26% of frame height, roll 10.5 deg, smile .82
    a = with_(face_box=[340, 700, 400, int(1920 * 0.26)], roll_deg=10.5,
              smile_score=0.82, teeth_visible=True, provenance="cropped_from_wide")
    res = G.check_source_image("x.png", lambda i: a, size=SIZE)
    assert res["pass"], res["reasons"]
    assert any("SMILE_0.82" in f for f in res["flags"]), res["flags"]
    # roll 12 passes, yaw/pitch 15 pass; just past them refuse
    assert not codes(SIZE, with_(roll_deg=12.0, yaw_deg=15.0, pitch_deg=-15.0))
    assert G.NOT_FRONTAL in codes(SIZE, with_(yaw_deg=15.5))


def test_smile_refused_only_at_point_nine_with_teeth_else_flagged():
    flags = lambda **kw: G.check_image(SIZE, with_(**kw))[1].get("flags", [])
    assert G.TOOTHY_SMILE in codes(SIZE, with_(smile_score=0.90, teeth_visible=True))
    assert G.TOOTHY_SMILE not in codes(SIZE, with_(smile_score=0.99, teeth_visible=False))
    assert flags(smile_score=0.99, teeth_visible=False)         # still flagged
    assert flags(smile_score=0.60) and not flags(smile_score=0.59)
    assert G.TOOTHY_SMILE not in codes(SIZE, with_(smile_score=0.89, teeth_visible=True))


def test_unmeasured_is_a_refusal_never_a_pass():
    for k in GOOD:
        a = dict(GOOD)
        del a[k]
        assert G.UNMEASURED in codes(SIZE, a), k
    assert G.UNMEASURED in codes(None, GOOD)


def test_reports_every_reason_at_once():
    c = codes((640, 1138), with_(yaw_deg=40, smile_score=0.95, teeth_visible=True, sharpness=1.0))
    assert {G.RESOLUTION, G.NOT_FRONTAL, G.TOOTHY_SMILE, G.SOFT} <= c


def test_file_header_size_and_detector_failure():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "a.png")
        open(p, "wb").write(png(1080, 1920))
        assert G.image_size(p) == (1080, 1920)
        assert G.check_source_image(p, lambda i: GOOD)["pass"]
        assert G.image_size(os.path.join(d, "none.png")) is None
        bad = G.check_source_image(p, lambda i: 1 / 0)
        assert not bad["pass"] and bad["reasons"][0][0] == G.UNMEASURED
        small = os.path.join(d, "s.png")
        open(small, "wb").write(png(540, 960))
        assert not G.check_source_image(small, lambda i: GOOD)["pass"]
        ok720 = os.path.join(d, "m.png")
        open(ok720, "wb").write(png(720, 1280))
        assert G.check_source_image(ok720, lambda i: with_(face_box=[240, 380, 260, 430]))["pass"]
        assert G.check_source_image({"path": ""}, lambda i: GOOD)["reasons"][0][0] == G.IMAGE_MISSING


def test_run_gate_refuses_before_any_paid_job():
    spent = []
    gen = lambda provider, spec: spent.append(provider) or "clip"
    meas = lambda clip: {}
    for kw, code in (({}, G.IMAGE_MISSING),
                     ({"source_image": "x.png"}, G.IMAGE_UNCHECKED),
                     ({"source_image": "x.png",
                       "image_check": lambda i: {"pass": False, "reasons": [(G.SOFT, "soft")]}},
                      G.SOFT),
                     ({"source_image": "x.png", "image_check": lambda i: None}, G.UNMEASURED)):
        try:
            L.run_gate("l1", gen, meas, **kw)
        except G.LipsyncImageRefused as e:
            assert e.reasons[0][0] == code, e.reasons
        else:
            raise AssertionError("did not refuse: %r" % (kw,))
    assert spent == [], "a paid job ran before the picture passed"


def test_prompt_template_carries_every_requirement():
    p = G.closeup_prompt("A tired mother in her thirties, curly brown hair",
                         "soft 3D render", "ref set image 1")
    for need in ("same 3D character", "9:16", "720x1280", "30-40 percent",
                 "straight into the camera",
                 "lips relaxed and very slightly parted", "no teeth showing",
                 "no big toothy smile", "no hands", "no microphone", "hat brim",
                 "soft even light", "no hard shadow", "separated from the head",
                 "sharp focus", "soft 3D render"):
        assert need in p, need
    try:
        G.closeup_prompt(" ")
    except ValueError:
        pass
    else:
        raise AssertionError


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
    print("ALL CHECKS PASS")
