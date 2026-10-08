#!/usr/bin/env python3
"""calibrate_sync.py: re-run the control calibration for the sync check (read-only on the client files).

Needs the client controls and a python with mediapipe + opencv (the fixer tool venv). The unit tests do NOT.

  LIPSYNC_FACE_MODEL=.../face_landmarker.task \\
  ~/drama-song-factory-build/run/lipsync-check/venv/bin/python calibrate_sync.py

Controls (exit 1 if any fails):
  approved SPOKEN Kiesett HO1, HO2, HO3 and LeAnne CUb, CUc with their own audio -> PASS
  approved SUNG LeAnne CUa with its own audio                                     -> ACCEPT_WITH_FLAG or UNDETERMINED (never FAIL)
  wrong audio (every other line, both sets)                                       -> never PASS
  still face (first frame held, real audio)                                       -> not PASS
Prints the control table that goes in the PR. Other lines for a clip = the other lines of its own set.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sync_check as SC        # noqa: E402

BUILD = os.path.expanduser("~/drama-song-factory-build")
os.environ.setdefault("LIPSYNC_FACE_MODEL", BUILD + "/run/lipsync-check/face_landmarker.task")
KIE = BUILD + "/qualification/stopstale-kiesett-ep01/redo-v4-20261008/lip"
DOL = BUILD + "/qualification/wuhs-leanne-soft-life/redo-v4-20261008/lip"
man = json.load(open(KIE + "/LIP-MANIFEST.json"))
# set -> {id: audio}; clips -> {id: (set, clip, kind)}. ST1/ST2 are cartoon clips: audio only.
AUDIO = {"KIE": {i: "%s/%s.mp3" % (KIE, i) for i in man}, "DOL": {i: "%s/%s.wav" % (DOL, i) for i in ("CUa", "CUb", "CUc")}}
CLIPS = {"KIE-" + i: ("KIE", i, KIE + "/" + man[i]["clip"], "spoken") for i in ("HO1", "HO2", "HO3")}
CLIPS.update({"DOL-" + i: ("DOL", i, "%s/FINAL-%s.mp4" % (DOL, i), "sung" if i == "CUa" else "spoken") for i in ("CUa", "CUb", "CUc")})


def main():
    rows, samples = {}, {}
    aud = lambda p: samples.setdefault(p, SC.read_audio(p))      # noqa: E731
    mouth = {k: SC.read_mouth(v[2]) for k, v in CLIPS.items()}
    out, bad = [], 0

    def run(case, clip_id, audio_path, others, want):
        nonlocal bad
        fps, rws = mouth[clip_id]
        kind = CLIPS[clip_id][3]
        m = SC.measure_features(fps, rws, aud(audio_path), [aud(o) for o in others])
        j = SC.judge_sync(m, kind == "sung")
        ok = want(j["verdict"])
        bad += not ok
        out.append((ok, case, kind, j))
    for cid, (st, i, clip, kind) in CLIPS.items():
        own = AUDIO[st][i]
        want = (lambda v: v == SC.PASS) if kind == "spoken" else (lambda v: v in (SC.FLAG, SC.UNDETERMINED))
        run("%s own audio (approved %s)" % (cid, kind), cid, own, [p for p in AUDIO[st].values() if p != own], want)
        for st2, d in AUDIO.items():
            for j2, p in d.items():
                if p != own:
                    run("%s + audio %s-%s" % (cid, st2, j2), cid, p, [q for q in AUDIO[st].values() if q != p], lambda v: v != SC.PASS)
    for cid in ("KIE-HO1", "DOL-CUc"):                              # still face, real audio
        st, i, clip, kind = CLIPS[cid]
        d = tempfile.mkdtemp()
        png, still = d + "/f.png", d + "/still.mp4"
        own = AUDIO[st][i]
        SC._LG.run_ffmpeg(["ffmpeg", "-v", "error", "-y", "-i", clip, "-frames:v", "1", png], "calib-still")
        SC._LG.run_ffmpeg(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", png, "-t", "3.5",
                           "-c:v", "libx264", "-pix_fmt", "yuv420p", still], "calib-still")
        mouth[cid + "-still"] = SC.read_mouth(still)
        CLIPS[cid + "-still"] = (st, i, still, kind)
        run("%s STILL face + real audio" % cid, cid + "-still", own, [p for p in AUDIO[st].values() if p != own], lambda v: v != SC.PASS)
    print("%-4s %-40s %-6s %-11s %-17s %5s %4s %5s %6s %6s" % ("", "case", "kind", "grade", "verdict", "corr", "lag", "pct", "margin", "range"))
    for ok, case, kind, j in out:
        f = lambda k, fmt: (fmt % j[k]) if j.get(k) is not None else "-"    # noqa: E731
        print("%-4s %-40s %-6s %-11s %-17s %5s %4s %5s %6s %6s" % ("OK" if ok else "BAD", case, kind, j["grade"], j["verdict"],
              f("corr", "%.2f"), f("offset_frames", "%d"), f("pct", "%.2f"), f("margin", "%.3f"), f("mouth_range", "%.3f")))
    print("CALIBRATION", "PASS" if not bad else "FAIL (%d wrong)" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
