"""`studio.py pair` finds the studio address on its own; the address is never invented.

THE DEFECT THIS PINS. `SKILL.md` documented pairing as one command,
`/drama-studio pair CODE` -> `studio.py pair <CODE>`, with no `--studio` flag. On a
computer that was not paired during install there is no `DRAMA_STUDIO_URL` anywhere in
999 (the variable is only ever read) and no `~/.drama-studio/studio.url` (pairing is
what would have written it), so the command exited 3 with "no studio address; run once
with --studio URL" and the skill told the agent nothing about recovering. This suite
proves the documented command now pairs, that the fallback address is the distribution's
own and not a guess, that every explicit source still wins over it, and that the two
remaining "no address" answers are words an agent can act on rather than a bare status.

EVERYTHING HERE IS LOCAL. The studio is a stdlib `http.server` on 127.0.0.1 in a
throwaway thread; state lives in a temp folder; no key is read, written or printed; no
request leaves the machine. The one seam the happy-path test moves is
`DEFAULT_STUDIO_URL` itself, because that constant is exactly what is under test: the
documented command must travel to whatever the distribution names, with no flag and no
environment variable typed by hand.

Every behavioural check is paired with a control that must behave differently, so a
green run cannot be vacuous.
"""
import http.server
import importlib.util
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest

PY = sys.executable or "python3"
SKILL = pathlib.Path(__file__).resolve().parent.parent
STUDIO = SKILL / "studio.py"
CHECK = SKILL / "studio_check.py"
BRIDGE = SKILL / "studio_bridge.py"
INSTALL_DOC = SKILL.parents[2] / "AGENT_INSTALL.md"
CODE = "ABCD-2345"
KEY = "PAIRED-KEY-NOT-REAL"
LINK1 = "https://studio.example/#k=" + "1" * 32

GUARD = ('    if not fake_mode() and not studio_url():\n'
         '        # Fake mode answers from its knobs and never reads an address, so the guard belongs\n'
         '        # to the real transport alone; run the fake with an empty state folder on purpose.\n'
         '        return NOT_PAIRED\n')


def constant(path, name):
    """The literal value of `NAME = "..."` in a source file, as written."""
    for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
        if line.startswith(name + " "):
            found = re.match(r'%s\s*=\s*"([^"]+)"' % re.escape(name), line)
            if found:
                return found.group(1)
    raise AssertionError("no literal %s in %s" % (name, path))


class FakeHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        size = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(size) or b"{}")
        self.server.hits.append({"path": self.path, "body": body,
                                 "key": self.headers.get("x-ds-key")})
        if self.path == "/api/studio/pair":
            out = {"ok": True, "key": KEY, "client_id": "c_1"}
        elif self.path == "/api/studio/link":
            out = {"ok": True, "link": LINK1}
        else:
            out = {"ok": False, "code": "UNEXPECTED-" + self.path}
        payload = json.dumps(out).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


class FakeStudio(object):
    """A fake studio on 127.0.0.1 with its own empty state folder."""

    def __init__(self, tmp, name):
        self.root = pathlib.Path(tmp) / name
        self.root.mkdir()
        self.state = self.root / "state"
        self.state.mkdir()
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeHandler)
        self.server.hits = []
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]
        self.webstub = self.root / "webstub"
        self.webstub.mkdir()
        (self.webstub / "webbrowser.py").write_text(
            "def open(url, *args, **kwargs):\n    return True\n", encoding="utf-8")

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    def paths(self):
        return [h["path"] for h in self.server.hits]


class PairAddressTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="trevor-macmini-DSR-106-", dir="/tmp")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.studio = FakeStudio(self.tmp, "studio")
        self.addCleanup(self.studio.stop)
        self.second = FakeStudio(self.tmp, "second")
        self.addCleanup(self.second.stop)

    # ------------------------------------------------------------ helpers
    def env(self, state=None, **kw):
        e = {k: v for k, v in os.environ.items() if not k.startswith("DRAMA_STUDIO_")}
        e["DRAMA_STUDIO_STATE"] = str(state or self.studio.state)
        e["PYTHONPATH"] = str(self.studio.webstub)
        for k, v in kw.items():
            if v is None:
                e.pop(k, None)
            else:
                e[k] = str(v)
        return e

    def pair(self, default, *args, **kw):
        """The REAL studio.py, only DEFAULT_STUDIO_URL moved, then the same argv.

        This is the seam the fix opens: a computer that was never paired has no flag and
        no environment variable to give, so the only way to prove the documented command
        reaches the distribution's own address is to stand a fake studio where that
        address points.
        """
        driver = pathlib.Path(self.tmp) / ("driver-%d.py" % len(list(pathlib.Path(self.tmp).glob("driver-*.py"))))
        driver.write_text(
            "import importlib.util, sys\n"
            "spec = importlib.util.spec_from_file_location('ds_studio', sys.argv[1])\n"
            "mod = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(mod)\n"
            "mod.DEFAULT_STUDIO_URL = sys.argv[2]\n"
            "sys.exit(mod.main(sys.argv[3:]))\n", encoding="utf-8")
        return subprocess.run([PY, str(driver), str(STUDIO), default] + list(args),
                              env=self.env(**kw), capture_output=True, text=True, timeout=60)

    def plain(self, *args, **kw):
        return subprocess.run([PY, str(STUDIO)] + list(args), env=self.env(**kw),
                              capture_output=True, text=True, timeout=60)

    def check(self, *args, **kw):
        return subprocess.run([PY, str(CHECK)] + list(args), env=self.env(**kw),
                              capture_output=True, text=True, timeout=60)

    def plant(self, name, old, new, src=STUDIO):
        """A copy with exactly ONE edit. A no-op plant is an error."""
        text = pathlib.Path(src).read_text(encoding="utf-8")
        if old not in text:
            raise AssertionError("plant %s: anchor not found (the plant would be vacuous)" % name)
        dest = pathlib.Path(self.tmp) / (name + ".py")
        dest.write_text(text.replace(old, new, 1), encoding="utf-8")
        return dest

    def key_mode(self):
        p = self.studio.state / "machine.key"
        return oct(stat.S_IMODE(p.stat().st_mode)) if p.is_file() else "missing"

    def stored(self):
        p = self.studio.state / "studio.url"
        return p.read_text(encoding="utf-8").strip() if p.is_file() else ""

    # ------------------------------------------------------------ the address itself
    def test_the_default_is_the_distributions_own_address(self):
        """The fallback is not a guess: it is the constant the bridge already falls back to."""
        shipped = constant(STUDIO, "DEFAULT_STUDIO_URL")
        self.assertEqual(shipped, constant(BRIDGE, "STUDIO_BASE_URL"),
                         "studio.py and studio_bridge.py name different studios")
        self.assertIn(shipped, INSTALL_DOC.read_text(encoding="utf-8"),
                      "the fallback is absent from AGENT_INSTALL.md — it would be a guess")
        self.assertTrue(shipped.startswith("https://") and " " not in shipped, shipped)

    def test_pair_travels_to_whatever_the_constant_names(self):
        """Point the constant at a second fake studio and pairing goes there, not elsewhere."""
        proc = self.pair(self.second.base, "pair", CODE, state=self.second.state)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.second.paths(), ["/api/studio/pair", "/api/studio/link"],
                         "the documented command did not reach the named studio")
        self.assertEqual(self.studio.paths(), [], "something was contacted besides it")
        self.assertEqual((self.second.state / "studio.url").read_text(encoding="utf-8").strip(),
                         self.second.base, "the recorded address is not the named one")
        self.assertFalse((self.studio.state / "machine.key").exists(),
                         "the key landed on a studio that was never asked")

    # ------------------------------------------------------------ the documented command
    def test_documented_command_pairs_with_no_studio_flag(self):
        """/drama-studio pair CODE, exactly as SKILL.md documents it, pairs. No --studio."""
        proc = self.pair(self.studio.base, "pair", CODE)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Drama Studio paired", proc.stdout)
        self.assertNotIn(KEY, proc.stdout + proc.stderr, "the machine key was printed")
        self.assertEqual(self.key_mode(), "0o600")
        self.assertEqual(self.stored(), self.studio.base)
        pair_hits = [h for h in self.studio.server.hits if h["path"] == "/api/studio/pair"]
        self.assertEqual(len(pair_hits), 1, "exactly one pair request, not one per source")
        self.assertEqual(pair_hits[0]["body"]["code"], CODE)
        self.assertIsNone(pair_hits[0]["key"], "pair sent a key it does not have yet")
        # SKILL.md step 2: the pair step then shows the link
        self.assertIn(LINK1, proc.stdout)
        self.assertEqual(self.studio.paths(), ["/api/studio/pair", "/api/studio/link"])

    def test_pair_without_the_fallback_still_refuses(self):
        """The planted-bad control: `pair` reading only the old sources must FAIL here."""
        old = self.plant("pair-without-fallback",
                         "url = studio_url(a.studio) or DEFAULT_STUDIO_URL",
                         "url = studio_url(a.studio)")
        proc = subprocess.run([PY, str(old), "pair", CODE], env=self.env(),
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 3,
                         "a copy without the fallback still paired: this check is vacuous")
        self.assertIn("AF-DS-PAIR-FAILED", proc.stderr)
        self.assertIn("no studio address", proc.stderr)

    def test_every_explicit_source_still_wins_over_the_default(self):
        """--studio, then DRAMA_STUDIO_URL, then the stored studio.url, beat the default."""
        # --studio
        proc = self.pair(self.second.base, "pair", CODE, "--studio", self.studio.base)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.studio.paths(), ["/api/studio/pair", "/api/studio/link"])
        self.assertEqual(self.second.paths(), [])
        self.assertEqual(self.key_mode(), "0o600")
        self.assertEqual(self.stored(), self.studio.base)

        # DRAMA_STUDIO_URL, with no --studio
        shutil.rmtree(self.studio.state, ignore_errors=True)
        proc = self.pair(self.second.base, "pair", CODE, DRAMA_STUDIO_URL=self.studio.base)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.stored(), self.studio.base)

        # the stored studio.url, with neither
        shutil.rmtree(self.studio.state, ignore_errors=True)
        self.studio.state.mkdir()
        (self.studio.state / "studio.url").write_text(self.studio.base + "\n", encoding="utf-8")
        proc = self.pair(self.second.base, "pair", CODE)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.studio.paths()[0], "/api/studio/pair")

    # ------------------------------------------------------------ the answers that are still failures
    def test_a_build_with_no_default_still_refuses_in_words(self):
        """No address anywhere: say what the agent should do, do not hand it an exit code."""
        proc = self.pair("", "pair", CODE)
        self.assertEqual(proc.returncode, 3)
        self.assertIn("AF-DS-PAIR-FAILED", proc.stderr)
        self.assertIn("no studio address", proc.stderr)
        self.assertIn("--studio", proc.stderr)
        self.assertIn("Ask the operator", proc.stderr)
        self.assertEqual(self.key_mode(), "missing")

    def test_a_computer_with_no_address_says_so_instead_of_NO_ORDER(self):
        """`--order` on a never-paired computer: NOT-PAIRED and exit 3, not a false NO-ORDER."""
        proc = self.check("--order")
        self.assertEqual(proc.returncode, 3, proc.stdout + proc.stderr)
        self.assertIn("NOT-PAIRED", proc.stdout)
        self.assertIn("/drama-studio pair", proc.stdout)
        self.assertNotEqual(proc.stdout.strip(), "NO-ORDER")

        # control: the same command on a PAIRED computer still answers NO-ORDER, exit 0
        (self.studio.state / "studio.url").write_text(self.studio.base + "\n", encoding="utf-8")
        (self.studio.state / "machine.key").write_text(KEY + "\n", encoding="utf-8")
        proc = self.check("--order")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(proc.stdout.strip(), "NO-ORDER")
        self.assertEqual(self.studio.paths(), ["/api/studio/checkin"])

    def test_the_not_paired_answer_is_not_vacuous(self):
        """Planted-bad: an `--order` with the guard removed prints NO-ORDER anyway."""
        bad = self.plant("order-without-guard", GUARD, "", src=CHECK)
        proc = subprocess.run([PY, str(bad), "--order"], env=self.env(),
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.stdout.strip(), "NO-ORDER",
                         "the planted copy did not print NO-ORDER: this check is vacuous")
        self.assertEqual(proc.returncode, 0)

    def test_link_on_an_unpaired_computer_points_at_pairing(self):
        """The recovery SKILL.md tells the agent to follow is the message `link` prints."""
        proc = self.plain("link", "--print")
        self.assertEqual(proc.returncode, 3, proc.stdout + proc.stderr)
        self.assertIn("AF-DS-PAIR-FAILED", proc.stderr)
        self.assertIn("pair this computer first", proc.stderr)
        self.assertEqual(self.key_mode(), "missing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
