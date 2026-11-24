#!/usr/bin/env python3
"""Runnable check for the look lock (row N-29, section 3B.2). Stdlib only.

Run: python3 scripts/core/style_defaults/test_look_lock_n29.py
$0 spend, no network. This is the one check left behind for the lock logic;
it is not a test framework and the build does not stage a proof run.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.dirname(HERE)
sys.path.insert(0, CORE)

from style_defaults import look_lock as LL  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print("%s: %s%s" % ("ok" if cond else "FAIL", name,
                        (" (%s)" % (detail,)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)


def main():
    lock = LL.build_lock("lifelike-3d", chosen_by="run owner",
                         chosen_at="2026-11-23T14:00:00-05:00",
                         character_bible_fingerprint="abc123")
    check("lock starts at version 1", lock["version"] == 1, lock["version"])
    check("lock copies every block",
          all(lock["style_blocks"].get(k) for k in LL.COPIED_BLOCKS),
          lock["style_blocks"].keys())
    check("lock carries banned words", bool(lock["banned_words"]))
    check("lock records who and when",
          lock["chosen_by"] == "run owner" and lock["chosen_at"])
    check("fingerprint verifies", LL.verify_fingerprint(lock))
    tampered = dict(lock)
    tampered["banned_words"] = list(lock["banned_words"]) + ["zzz"]
    check("tamper changes fingerprint",
          LL.lock_fingerprint(tampered) != lock["fingerprint"])

    check("a record at version 1 is current", LL.is_current(1, lock))
    check("a record below the lock is stale", LL.is_stale(0, lock))

    with tempfile.TemporaryDirectory() as run:
        path = LL.write_lock(run, lock)
        check("lock written at control/look-lock.json",
              path.endswith(os.path.join("control", "look-lock.json")), path)
        back = LL.read_lock_for_run(run)
        check("written lock reads back equal", back == lock)
        rotated = LL.rotate(lock, chosen_by="run owner",
                            chosen_at="2026-11-23T15:00:00-05:00")
        check("rotate bumps the version", rotated["version"] == 2,
              rotated["version"])
        LL.write_lock(run, rotated)
        try:
            LL.write_lock(run, lock)
            check("older version refuses to overwrite", False, "no error")
        except LL.LookLockError as exc:
            check("older version refuses to overwrite",
                  exc.code == "LOOK_LOCK_VERSION_REGRESS", exc.code)

    with tempfile.TemporaryDirectory() as bare:
        try:
            LL.require_lock(bare)
            check("no lock refuses making", False, "no error")
        except LL.LookLockError as exc:
            check("no lock refuses making",
                  exc.code == "LOOK_LOCK_MISSING", exc.code)

    # banned words are ignored inside the locked block, caught outside it.
    h3 = lock["style_blocks"]["h3_block"]
    check("locked block is exempt from its own banned words",
          LL.banned_word_hits(h3, lock["banned_words"], exempt=h3) == [],
          LL.banned_word_hits(h3, lock["banned_words"], exempt=h3))
    outside = "the same frame, photoreal skin, shot on a DSLR"
    hits = LL.banned_word_hits(outside, lock["banned_words"], exempt=h3)
    check("banned words outside the block are caught",
          "photoreal" in hits and "DSLR" in hits, hits)

    check("lock still matches its mode file", LL.verify_still_matches(lock))

    print("\n%s" % ("PASS - %d checks" % (0 if FAILS else 1) if not FAILS
                    else "FAIL: %s" % ", ".join(FAILS)))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
