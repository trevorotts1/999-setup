#!/usr/bin/env python3
"""Lip-sync close-up rule (owner order 2026-10-08): planned per character,
default source image for lip-sync jobs, QC fails a set without a clear mouth.
Mocked, $0. Run: python3 scripts/core/lip_sync/lip_gate/test_lipsync_closeup.py"""
import os
import sys
import tempfile

os.environ.setdefault("DSAF_GOVERNOR_DIR", tempfile.mkdtemp(prefix="dsaf-gov-"))

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(CORE, "catalog_calculator"))
sys.path.insert(0, os.path.dirname(HERE))
import lip_gate.lip_gate as L                         # noqa: E402
import catalog_calculator as C                        # noqa: E402

# 1. the plan carries one lip-sync close-up per character
plan = C.image_plan(4, ("9:16",), ["Ana", "Ben"], "m")
refs = plan["reference_set"]
assert [r["character"] for r in refs if r["view"] == "lipsync-closeup"] == ["Ana", "Ben"]
assert plan["reference_images"] == 14

# 2. every lip-sync attempt uses it as the source image (kling try 1, try 2; no InfiniTalk)
pic = L.lipsync_closeup(refs, "Ana")
seen = []
def gen(provider, spec):
    seen.append((provider, spec["source_image"]))
    return provider
bad = {"verdict": L.NOT_SYNCED, "hit": 0.1, "margin": -0.1, "lag_s": 0.0,
       "hard_defects": ["HIT_LOW"]}
L.run_gate("l1", gen, lambda clip: bad, source_image=pic,
           image_check=lambda img: {"pass": True}, next_input={"window": "next"})
assert seen == [("kling", pic), ("kling", pic)], seen

# 3. QC: missing close-up fails; unclear mouth fails; clear passes
assert L.check_reference_set(refs, ["Ana", "Ben"], lambda e: True)["pass"]
no_pic = [r for r in refs if r["view"] != "lipsync-closeup"]
r = L.check_reference_set(no_pic, ["Ana"], lambda e: True)
assert not r["pass"] and r["failed"][0]["reason_code"] == L.LIPSYNC_REF_MISSING
r = L.check_reference_set(refs, ["Ana"], lambda e: False)
assert not r["pass"] and r["failed"][0]["reason_code"] == L.LIPSYNC_MOUTH_BAD
print("ALL CHECKS PASS")
