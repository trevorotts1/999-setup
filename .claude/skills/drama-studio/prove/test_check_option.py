"""studio_check.py keeps the studio's option, and --order is a fresh order check.

Everything runs through the FAKE knobs of the real studio_check.py in a throwaway state
folder under /tmp: no network, nothing installed, nothing registered, no settings file.

Every check ALSO runs a planted-bad copy carrying exactly that one defect. A check counts
only when the real run passes AND the planted-bad run is caught, so a green run cannot be
vacuous. Exit 0 = every check passed and every plant was caught; exit 1 = a check failed.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

PY = sys.executable or "python3"
HERE = pathlib.Path(__file__).resolve().parent
SKILL = HERE.parent
CHECK = str(SKILL / "studio_check.py")

BOX = "trevor-macmini"
UNIT = "W1-claude-skill-U3"
ORDER_LINE = 'DRAMA_ORDER r_123 "Spring Sale"'
ORDER_OUT = 'ORDER r_123 "Spring Sale"'
HOOK_IN = '{"source":"startup","session_id":"s1"}'
FAKE_ENV_KEYS = ("CLAUDE_PLUGIN_ROOT", "DRAMA_STUDIO_SKILL_ROOT", "DRAMA_STUDIO_STATE",
                 "DRAMA_STUDIO_FAKE", "DRAMA_STUDIO_FAKE_LINE", "DRAMA_STUDIO_FAKE_OPTION",
                 "DRAMA_STUDIO_FAKE_CALLS", "DRAMA_STUDIO_FAKE_ERROR", "DRAMA_STUDIO_FAKE_DELAY",
                 "DRAMA_STUDIO_URL", "DRAMA_STUDIO_OPTION")


class CheckOptionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="%s-%s-" % (BOX, UNIT), dir="/tmp")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.state = os.path.join(self.tmp, "state")
        os.makedirs(self.state)
        self.calls = os.path.join(self.tmp, "calls.txt")
        self.planted = os.path.join(self.tmp, "planted")
        os.makedirs(self.planted)

    # ------------------------------------------------------------ helpers
    def env(self, **kw):
        e = dict(os.environ)
        for k in FAKE_ENV_KEYS:
            e.pop(k, None)
        e["DRAMA_STUDIO_FAKE"] = "1"
        # a planted copy lives outside the skill folder: point the root at the real one so
        # the root guard can never be what silences a plant.
        e["DRAMA_STUDIO_SKILL_ROOT"] = str(SKILL)
        e["DRAMA_STUDIO_STATE"] = self.state
        e["DRAMA_STUDIO_FAKE_CALLS"] = self.calls
        for k, v in kw.items():
            if v is None:
                e.pop(k, None)
            else:
                e[k] = str(v)
        return e

    def run_script(self, args, env=None, script=CHECK, stdin=""):
        p = subprocess.run([PY, script] + args, input=stdin, env=env or self.env(),
                           capture_output=True, text=True, timeout=60)
        return p.returncode, p.stdout, p.stderr

    def state_json(self):
        path = os.path.join(self.state, "state.json")
        if not os.path.isfile(path):
            return None
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def seed_fresh_cache(self, line):
        """A state whose check is younger than 60 seconds: the hook MUST stay off the network."""
        with open(os.path.join(self.state, "state.json"), "w", encoding="utf-8") as fh:
            json.dump({"last_check_at": time.time(), "cached_line": line}, fh)

    def calls_made(self):
        try:
            with open(self.calls, encoding="utf-8") as fh:
                return len([l for l in fh.read().splitlines() if l.strip()])
        except OSError:
            return 0

    def plant(self, name, old, new):
        """Copy the script under test and make exactly one edit. A no-op plant is an error."""
        with open(CHECK, encoding="utf-8") as fh:
            src = fh.read()
        if old not in src:
            raise AssertionError("plant %s: anchor not found (the plant would be vacuous)" % name)
        dest = os.path.join(self.planted, name + ".py")
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(src.replace(old, new, 1))
        os.chmod(dest, 0o755)
        return dest

    # ------------------------------------------------------------ checks
    def test_hook_saves_the_studio_option(self):
        """The hook keeps the studio's option instead of throwing it away (the broken line)."""
        rc, _out, _err = self.run_script(["--hook"], self.env(DRAMA_STUDIO_FAKE_OPTION="2"), stdin=HOOK_IN)
        st = self.state_json()
        self.assertEqual(rc, 0)
        self.assertEqual((st or {}).get("option"), 2)

        # the studio's record decides: a value that is not an option is never stored
        shutil.rmtree(self.state, ignore_errors=True)
        os.makedirs(self.state)
        rc, _o, _e = self.run_script(["--hook"], self.env(DRAMA_STUDIO_FAKE_OPTION="banana"), stdin=HOOK_IN)
        self.assertEqual(rc, 0)
        self.assertIsNotNone(self.state_json(), "the hook did not persist its check-in")
        self.assertNotIn(self.state_json().get("option"), (1, 2, 3, "banana"))

        # planted-bad: a copy that drops the studio's option must be caught here
        bad = self.plant("drop-option",
                         '    if option is not None:\n        # the studio\'s own record decides',
                         '    if False:\n        # the studio\'s own record decides')
        shutil.rmtree(self.state, ignore_errors=True)
        os.makedirs(self.state)
        rc, _o, _e = self.run_script(["--hook"], self.env(DRAMA_STUDIO_FAKE_OPTION="2"),
                              script=bad, stdin=HOOK_IN)
        self.assertEqual(rc, 0)
        self.assertIsNotNone(self.state_json())
        self.assertNotEqual(self.state_json().get("option"), 2,
                            "planted copy still set the option: this check is vacuous")

    def test_studio_option_switches_on_the_watcher(self):
        """The acceptance line: Option 2 could never switch on from the studio before."""
        self.run_script(["--hook"], self.env(DRAMA_STUDIO_FAKE_OPTION="2", DRAMA_STUDIO_FAKE_LINE=ORDER_LINE),
                 stdin=HOOK_IN)
        self.assertEqual(self.state_json().get("option"), 2)

        # no --option flag, no env option: only the saved studio record can make it announce
        rc, out, _err = self.run_script(["--watch", "--once"],
                                        self.env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE))
        self.assertEqual(rc, 0)
        self.assertIn("Drama Studio", out)
        self.assertIn("Spring Sale", out)

        bad = self.plant("drop-option-watch",
                         '    if option is not None:\n        # the studio\'s own record decides',
                         '    if False:\n        # the studio\'s own record decides')
        shutil.rmtree(self.state, ignore_errors=True)
        os.makedirs(self.state)
        self.run_script(["--hook"], self.env(DRAMA_STUDIO_FAKE_OPTION="2", DRAMA_STUDIO_FAKE_LINE=ORDER_LINE),
                 script=bad, stdin=HOOK_IN)
        rc, out, _err = self.run_script(["--watch", "--once"], script=bad,
                                        env=self.env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE))
        self.assertEqual(rc, 0)
        self.assertNotIn("Spring Sale", out,
                         "planted copy announced anyway: this check is vacuous")

    def test_order_bypasses_the_cache(self):
        """--order spends a network call even when the hook's 60-second cache is still fresh."""
        self.seed_fresh_cache(None)

        # control: the hook inside the cache window spends NOTHING (the cache really is on)
        rc, out, _err = self.run_script(["--hook"], stdin=HOOK_IN)
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")
        self.assertEqual(self.calls_made(), 0)

        rc, out, _err = self.run_script(["--order"], self.env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE))
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), ORDER_OUT)
        self.assertEqual(self.calls_made(), 1, "--order did not spend a fresh check-in")

        # planted-bad 1: an --order that reads the cached line instead of asking the studio
        bad_cache = self.plant("order-from-cache",
                               '    body = check_network_full()\n    order = parse_order(body.get("line"))',
                               '    body = {"line": load_state(os.environ["DRAMA_STUDIO_STATE"]).get("cached_line")}\n'
                               '    order = parse_order(body.get("line"))')
        shutil.rmtree(self.state, ignore_errors=True)
        os.makedirs(self.state)
        self.seed_fresh_cache(None)
        rc, out, _err = self.run_script(["--order"], script=bad_cache,
                                        env=self.env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE))
        self.assertEqual(rc, 0)
        self.assertNotEqual(out.strip(), ORDER_OUT,
                            "planted copy answered from the cache: this check is vacuous")

        # planted-bad 2: a copy where --order is not wired at all
        bad_flag = self.plant("order-unwired", "    if a.order:", "    if False and a.order:")
        rc, out, err = self.run_script(["--order"], script=bad_flag,
                                       env=self.env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE))
        self.assertNotEqual((rc, out.strip()), (0, ORDER_OUT),
                            "planted copy handled --order anyway: this check is vacuous")
        self.assertIn("AF-DS-ARGS", err)

    def test_order_no_order_and_writes_no_state(self):
        """NO-ORDER when nothing waits, and --order never touches the hook's cache or dedup."""
        rc, out, _err = self.run_script(["--order"])
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "NO-ORDER")

        # dedup would have hidden it: the hook already announced this order for this session
        rc, out, _err = self.run_script(["--hook"], self.env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE), stdin=HOOK_IN)
        self.assertEqual(rc, 0)
        self.assertIn("Spring Sale", out)
        before = self.state_json()
        rc, out, _err = self.run_script(["--order"], self.env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE))
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), ORDER_OUT, "--order honoured the hook's dedup")
        self.assertEqual(self.state_json(), before, "--order wrote to the shared state")


if __name__ == "__main__":
    unittest.main(verbosity=2)
