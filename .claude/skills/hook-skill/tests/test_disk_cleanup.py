#!/usr/bin/env python3
"""disk_cleanup.py in a throwaway HOME with a PATH that has no brew: dry-run deletes nothing, real run only clears the npm cache."""
import os, shutil, subprocess, sys, tempfile, unittest
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks", "disk-cleanup", "disk_cleanup.py")


class Disk(unittest.TestCase):
    def setUp(self):
        self.h = tempfile.mkdtemp(prefix="dc-")
        os.makedirs(os.path.join(self.h, ".npm", "_cacache"))
        with open(os.path.join(self.h, ".npm", "_cacache", "blob"), "wb") as f:
            f.write(b"x" * 2_000_000)
        os.makedirs(os.path.join(self.h, "projects"))
        with open(os.path.join(self.h, "projects", "keep.txt"), "wb") as f:
            f.write(b"y" * 4_000_000)
        # PATH has python's folder only: no brew, no npm, no tmutil, so the test never touches the real machine
        self.env = {"HOME": self.h, "USERPROFILE": self.h, "PATH": os.path.dirname(sys.executable), "npm_config_cache": os.path.join(self.h, ".npm")}
        self.log = os.path.join(self.h, ".claude", "hooks", "disk-cleanup", "disk-cleanup.log")

    def tearDown(self):
        shutil.rmtree(self.h, ignore_errors=True)

    def run_it(self, *a):
        return subprocess.run([sys.executable, SCRIPT, *a], env=self.env, capture_output=True, text=True)

    def test_dry_run_deletes_nothing_and_logs(self):
        p = self.run_it("--dry-run")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(os.path.join(self.h, ".npm", "_cacache", "blob")))
        self.assertIn("would delete", p.stdout)
        with open(self.log) as f:
            self.assertIn("[dry-run]", f.read())

    def test_real_run_clears_cache_only_and_reports_top_folders(self):
        p = self.run_it("--top", "2")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.h, ".npm", "_cacache")))
        self.assertTrue(os.path.exists(os.path.join(self.h, "projects", "keep.txt")))
        self.assertIn("REPORT ONLY", p.stdout)
        self.assertIn("projects", p.stdout)
        self.assertTrue(os.path.getsize(self.log) > 0)

    def test_config_can_disable_a_step(self):
        os.makedirs(os.path.join(self.h, ".claude", "hooks"), exist_ok=True)
        with open(os.path.join(self.h, ".claude", "hooks", "hook-skill.json"), "w") as f:
            f.write('{"disk_cleanup": {"clear_npm_cache": false}}')
        self.run_it()
        self.assertTrue(os.path.exists(os.path.join(self.h, ".npm", "_cacache", "blob")))


if __name__ == "__main__":
    unittest.main()
