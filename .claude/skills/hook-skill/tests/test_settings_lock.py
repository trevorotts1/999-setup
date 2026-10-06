#!/usr/bin/env python3
"""settings_lock: opt-in hard lock, lock-aware write that always re-locks. Temp files only (macOS uses the real chflags flag)."""
import json, os, shutil, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts", "common"))
import settings_lock as sl
import settings_merge as sm


class Lock(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="sl-")
        self.f = os.path.join(self.d, "settings.json")
        with open(self.f, "w") as fh:
            json.dump({"model": "keep"}, fh)

    def tearDown(self):
        sl.unlock(self.f) if os.path.exists(self.f) else None
        shutil.rmtree(self.d, ignore_errors=True)

    def doc(self):
        with open(self.f) as fh:
            return json.load(fh)

    def test_default_is_unlocked_and_lock_unlock_roundtrip(self):
        self.assertIsNone(sl.kind(self.f))
        k = sl.lock(self.f)
        self.assertIn(k, ("uchg", "immutable", "readonly"))
        self.assertEqual(sl.kind(self.f), k)
        if k == "uchg" or (k == "readonly" and (os.name == "nt" or os.geteuid() != 0)):
            with self.assertRaises(OSError):  # the lock really stops a write
                open(self.f, "w").close()
        self.assertEqual(sl.unlock(self.f), k)
        self.assertIsNone(sl.kind(self.f))

    def test_unlocked_file_is_never_locked_by_a_write(self):
        sm.register(self.f, sys.executable, os.path.join(self.d, "hooks"), ["workflow-guard"])
        self.assertIsNone(sl.kind(self.f))
        self.assertIn("hooks", self.doc())

    def test_register_through_a_lock_relocks(self):
        k = sl.lock(self.f)
        sm.register(self.f, sys.executable, os.path.join(self.d, "hooks"), ["workflow-guard"])
        self.assertEqual(sl.kind(self.f), k)
        self.assertEqual(self.doc()["model"], "keep")
        self.assertIn("SessionStart", self.doc()["hooks"])
        self.assertEqual(sm.unregister(self.f, os.path.join(self.d, "hooks")), 6)
        self.assertEqual(sl.kind(self.f), k)
        self.assertEqual(self.doc(), {"model": "keep"})

    def test_failed_write_still_relocks(self):
        k = sl.lock(self.f)
        with self.assertRaises(RuntimeError):
            with sl.unlocked(self.f, say=lambda *_: None):
                raise RuntimeError("boom")
        self.assertEqual(sl.kind(self.f), k)

    def test_invalid_json_after_write_is_reported_and_relocked(self):
        k = sl.lock(self.f)
        with self.assertRaises(ValueError):
            with sl.unlocked(self.f, say=lambda *_: None):
                with open(self.f, "w") as fh:
                    fh.write("{broken")
        self.assertEqual(sl.kind(self.f), k)

    def test_one_line_is_printed_only_when_locked(self):
        lines = []
        with sl.unlocked(self.f, say=lines.append):
            pass
        self.assertEqual(lines, [])
        sl.lock(self.f)
        with sl.unlocked(self.f, say=lines.append):
            pass
        self.assertEqual(len(lines), 1)
        self.assertIn("was locked", lines[0])

    def test_cli(self):
        self.assertEqual(sl.main(["x", "lock", self.f]), 0)
        self.assertIsNotNone(sl.kind(self.f))
        self.assertEqual(sl.main(["x", "unlock", self.f]), 0)
        self.assertIsNone(sl.kind(self.f))
        self.assertEqual(sl.main(["x", "unlock", self.f + ".missing"]), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
