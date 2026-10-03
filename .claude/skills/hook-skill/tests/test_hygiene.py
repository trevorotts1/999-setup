#!/usr/bin/env python3
"""post_merge_hygiene sweep in a throwaway HOME: only clean, merged, idle clones go; unpushed/dirty work never does."""
import os, shutil, subprocess, sys, tempfile, time, unittest
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks", "hygiene", "post_merge_hygiene.py")


def wr(path, text):
    with open(path, "w") as f:
        f.write(text)


def sh(cmd, cwd=None, env=None):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, env=env)


class Hygiene(unittest.TestCase):
    def setUp(self):
        self.h = os.path.realpath(tempfile.mkdtemp(prefix="hy-"))
        self.env = dict(os.environ, HOME=self.h, USERPROFILE=self.h, HOOK_SKILL_TMP_ROOTS=os.path.join(self.h, "no-tmp"), GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        self.origin = os.path.join(self.h, "origin.git")
        seed = os.path.join(self.h, "seed")
        sh(["git", "init", "-q", "-b", "main", seed], env=self.env)
        wr(os.path.join(seed, "a.txt"), "a")
        sh(["git", "add", "."], seed, self.env); sh(["git", "commit", "-q", "-m", "init"], seed, self.env)
        sh(["git", "clone", "-q", "--bare", seed, self.origin], env=self.env)
        self.root = os.path.join(self.h, "lanes")
        os.makedirs(self.root)
        for n in ("merged", "unpushed", "dirty", "branchwork"):
            sh(["git", "clone", "-q", self.origin, os.path.join(self.root, n)], env=self.env)
        c = os.path.join(self.root, "unpushed")
        wr(os.path.join(c, "b.txt"), "b")
        sh(["git", "add", "."], c, self.env); sh(["git", "commit", "-q", "-m", "local only"], c, self.env)
        open(os.path.join(self.root, "dirty", "a.txt"), "w").write("changed")
        w = os.path.join(self.root, "branchwork")
        sh(["git", "checkout", "-q", "-b", "wip"], w, self.env)
        wr(os.path.join(w, "c.txt"), "c")
        sh(["git", "add", "."], w, self.env); sh(["git", "commit", "-q", "-m", "wip only"], w, self.env)
        sh(["git", "checkout", "-q", "main"], w, self.env)
        old = time.time() - 7200
        for d, _, files in os.walk(self.root):
            if os.sep + ".git" in d + os.sep:
                continue
            for f in files:
                os.utime(os.path.join(d, f), (old, old))

    def tearDown(self):
        shutil.rmtree(self.h, ignore_errors=True)

    def sweep(self, *a):
        # --min-age 0: the sweep needs no GitHub because the clone is contained in origin/main
        return subprocess.run([sys.executable, SCRIPT, "sweep", "--root", self.root, "--min-age", "0", *a], env=self.env, capture_output=True, text=True)

    def test_dry_run_deletes_nothing(self):
        p = self.sweep("--dry-run")
        self.assertIn("WOULD-DELETE clone", p.stdout)
        for n in ("merged", "unpushed", "dirty", "branchwork"):
            self.assertTrue(os.path.isdir(os.path.join(self.root, n)), n)

    def test_only_the_clean_merged_clone_is_deleted(self):
        p = self.sweep()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.root, "merged")), p.stdout)
        self.assertTrue(os.path.isdir(os.path.join(self.root, "unpushed")), "unpushed work must survive")
        self.assertTrue(os.path.isdir(os.path.join(self.root, "dirty")), "uncommitted work must survive")
        self.assertTrue(os.path.isdir(os.path.join(self.root, "branchwork")), "unpushed branch must survive")
        self.assertIn("merge unproven", p.stdout)
        self.assertIn("unpushed commits on local branch wip", p.stdout)
        self.assertIn("uncommitted changes", p.stdout)
        with open(os.path.join(self.h, ".claude", "hooks", "hygiene", "hygiene.log")) as f:
            self.assertIn("DELETED clone", f.read())

    def test_test_run_folder_is_swept_after_test_end(self):
        run = subprocess.run([sys.executable, SCRIPT, "test-start", "t1"], env=self.env, capture_output=True, text=True).stdout.strip().splitlines()[-1]
        self.assertTrue(os.path.isdir(run))
        subprocess.run([sys.executable, SCRIPT, "test-end", "t1"], env=self.env, capture_output=True, text=True)
        self.sweep()
        self.assertFalse(os.path.exists(run))

    def test_hook_ignores_garbage_and_exits_zero(self):
        p = subprocess.run([sys.executable, SCRIPT], input="not json", env=self.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0)


if __name__ == "__main__":
    unittest.main()
