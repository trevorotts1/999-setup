#!/usr/bin/env python3
"""BATCH-5 member A (999 twin): factory reads a WAL store it cannot write.

Both stores are WAL mode. A reader whose directory it cannot write cannot
attach the -wal/-shm sidecars, and `mode=ro` then raises "unable to open
database file" -- `next` reported a healthy run as state-unreadable. The
reader now falls back to a private temp copy; the run's own files are never
written.

The fixture keeps the -wal frames on purpose: a WAL db whose sidecars are
merely deleted opens fine on this SQLite and would prove nothing.

stdlib only, no spend.

Run from the skill root: python3 scripts/core/intake_preflight/test_wal_ro_b5.py
"""
import importlib
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORE = HERE.parent
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

F = importlib.import_module("intake_preflight.factory")
SS = importlib.import_module("state_store")

FAILS = []


def check(name, got, want):
    if got == want:
        print("ok %s" % name)
    else:
        print("FAIL %s: got %r want %r" % (name, got, want))
        FAILS.append(name)


def main():
    tmp = tempfile.mkdtemp(prefix="b5-wal-")
    run = Path(tmp) / "run"
    (run / "control").mkdir(parents=True)
    db = run / "control" / "state.sqlite3"
    with SS.Store(db) as st:
        st.init_run("run-wal", list(F._stages()))
        st.transition("run-wal", "research", "READY", "w1")

    # seal the store: frames in -wal, no -shm, directory not writable
    con = sqlite3.connect(str(db))
    con.execute("PRAGMA wal_autocheckpoint=0")
    con.execute("UPDATE stages SET state='READY' WHERE stage='research'")
    con.commit()
    sealed = Path(tmp) / "sealed"
    (sealed / "control").mkdir(parents=True)
    for suf in ("", "-wal"):
        src = Path(str(db) + suf)
        if src.exists():
            shutil.copy2(str(src), str(sealed / "control" / "state.sqlite3") + suf)
    con.close()
    sdb = sealed / "control" / "state.sqlite3"
    os.chmod(sealed / "control", 0o555)
    try:
        try:
            sqlite3.connect("file:%s?mode=ro" % sdb, uri=True,
                            timeout=5).execute(
                "PRAGMA schema_version").fetchone()
            raise AssertionError("fixture does not reproduce the failure")
        except sqlite3.Error:
            pass                        # control: the raw open really fails

        check("1: the fallback reads the store",
              F._ro_connect(sdb).execute(
                  "SELECT state FROM stages WHERE stage='research'"
              ).fetchone(), ("READY",))

        env = F.cmd_next(type("A", (), {"run_dir": str(sealed),
                                        "method": None, "run_id": "run-wal"})())
        check("2: next is not state-unreadable",
              env["reason_code"] == "state-unreadable", False)
        check("3: next answers the real next stage",
              env.get("data", {}).get("stage") or env.get("stage"), "research")
    finally:
        os.chmod(sealed / "control", 0o755)

    print()
    if FAILS:
        print("%d FAILED: %s" % (len(FAILS), ", ".join(FAILS)))
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
