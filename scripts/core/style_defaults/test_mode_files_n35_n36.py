#!/usr/bin/env python3
"""Runnable check for the mode-file loader and the guide-drift guard.

Rows N-35 (banned words per look, every block required at load) and N-36
(guide line equals the mode file's client_wording). Stdlib only.

Run: python3 scripts/core/style_defaults/test_mode_files_n35_n36.py
$0 spend, no network.
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.dirname(HERE)
sys.path.insert(0, CORE)

from style_defaults import client_wording as CW              # noqa: E402
from style_defaults import mode_files as MF                  # noqa: E402
from style_defaults.defaults import StyleDefaultsError        # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print("%s: %s%s" % ("ok" if cond else "FAIL", name,
                        (" (%s)" % (detail,)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)


def main():
    modes = MF.load_all_modes()
    check("all six mode files load", len(modes) == 6, sorted(modes))
    check("stylized-3d is one of them", "stylized-3d" in modes)
    for mid, mode in sorted(modes.items()):
        check("%s carries banned_words" % mid,
              isinstance(mode.get("banned_words"), list) and mode["banned_words"])
        check("%s carries client_wording" % mid, bool(mode.get("client_wording")))

    # N-35: the banned-word refusal fires outside the locked block only.
    l3d = modes["lifelike-3d"]
    h3 = l3d["h3_block"].replace("{palette}", l3d.get("palette_default", ""))
    try:
        MF.check_banned_words("a soft frame, photoreal skin", l3d["banned_words"], h3)
        check("banned word outside the block refuses", False, "no error")
    except StyleDefaultsError as exc:
        check("banned word outside the block refuses",
              exc.code == "STYLE_WORD_BANNED", exc.code)
    check("the locked block itself is exempt",
          MF.check_banned_words(h3, l3d["banned_words"], h3) == h3)

    # N-35: a mode file missing a block fails at load.
    with tempfile.TemporaryDirectory() as tmp:
        src = MF.modes_dir()
        shutil.copytree(src, tmp, dirs_exist_ok=True)
        broken = json.loads((src / "realism.json").read_text(encoding="utf-8"))
        broken.pop("keyframe_clause")
        (open(os.path.join(tmp, "realism.json"), "w", encoding="utf-8")
         .write(json.dumps(broken)))
        try:
            MF.load_mode("realism", root=tmp)
            check("mode missing a block fails at load", False, "no error")
        except StyleDefaultsError as exc:
            check("mode missing a block fails at load",
                  exc.code == "MODE_BLOCK_MISSING", exc.code)

    # N-36: the what-clients-say mapping and the drift guard.
    check("pixar maps to stylized-3d",
          CW.map_client_wording("something Pixar-like") == "stylized-3d")
    check("real people maps to realism",
          CW.map_client_wording("I want real people") == "realism")
    check("lifelike 3d stays lifelike-3d",
          CW.map_client_wording("Lifelike 3D") == "lifelike-3d")
    check("an unclear request gets no guess",
          CW.map_client_wording("something warm and happy") is None)
    line = CW.client_wording_for("lifelike-3d")
    check("a matching guide line passes",
          CW.check_guide_wording("lifelike-3d", line) == line)
    try:
        CW.check_guide_wording("lifelike-3d", "realistic and cinematic")
        check("a drifted guide line refuses", False, "no error")
    except StyleDefaultsError as exc:
        check("a drifted guide line refuses",
              exc.code == "CLIENT_WORDING_DRIFT", exc.code)

    print("\n%s" % ("PASS" if not FAILS else "FAIL: %s" % ", ".join(FAILS)))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
