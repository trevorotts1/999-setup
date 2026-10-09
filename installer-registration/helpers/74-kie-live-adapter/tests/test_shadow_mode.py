import os
import tempfile
import unittest
from unittest import mock

from fakes import K, MODEL, make, std_routes

REQ = {"model": MODEL, "input": {"prompt": "a leaf", "resolution": "1K"}}


class Modes(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = self._t.name
        self.addCleanup(self._t.cleanup)

    def test_shadow_never_submits(self):
        a, tr, c = make(self.tmp, std_routes(), mode="shadow")
        for fn in (lambda: a.cmd_submit(REQ), lambda: a.cmd_run(REQ, self.tmp)):
            r = fn()
            self.assertEqual(r["state"], "skipped")
            self.assertTrue(r["fallback_used"])
            self.assertIn("shadow: dispatch via existing static path", r["warnings"])
        self.assertEqual(tr.n("POST", "createTask"), 0)
        self.assertEqual(tr.n("GET", "recordInfo"), 0)

    def test_shadow_diagnostics_still_run(self):
        a, tr, c = make(self.tmp, std_routes(), mode="shadow")
        self.assertEqual(a.cmd_validate(MODEL, REQ["input"])["state"], "validated")
        self.assertEqual(a.cmd_discover("image")["state"], "success")
        self.assertEqual(a.cmd_schema(MODEL)["state"], "success")
        self.assertTrue(os.listdir(os.path.join(self.tmp, "cache", "receipts")))

    def test_off_never_submits_and_makes_no_calls(self):
        a, tr, c = make(self.tmp, std_routes(), mode="off")
        r = a.cmd_submit(REQ)
        self.assertEqual((r["state"], r["fallback_used"]), ("skipped", False))
        self.assertIn("adapter off: use static path", r["warnings"])
        self.assertEqual(a.cmd_run(REQ, self.tmp)["state"], "skipped")
        self.assertEqual(tr.calls, [])
        self.assertEqual(a.cmd_validate(MODEL, REQ["input"])["state"], "validated")  # diagnostics allowed

    def test_active_submits(self):
        a, tr, c = make(self.tmp, std_routes(), mode="active")
        r = a.cmd_submit(REQ)
        self.assertEqual((r["state"], r["task_id"]), ("queued", "T1"))
        self.assertEqual(tr.n("POST", "createTask"), 1)

    def test_dry_run_never_submits_even_active(self):
        a, tr, c = make(self.tmp, std_routes(), mode="active")
        r = a.cmd_submit(REQ, dry_run=True)
        self.assertEqual(r["state"], "validated")
        self.assertEqual(tr.n("POST", "createTask"), 0)

    def test_default_is_shadow_and_bad_value_falls_back(self):
        a = K.Adapter(env={"HOME": self.tmp})
        self.assertEqual(a.mode, "shadow")
        b = K.Adapter(env={"HOME": self.tmp, "KIE_LIVE_ADAPTER_MODE": "turbo"})
        self.assertEqual(b.mode, "shadow")
        self.assertTrue(b.warnings)

    def test_mode_file_precedence(self):
        oc = os.path.join(self.tmp, "oc")
        os.makedirs(oc)
        with open(os.path.join(oc, "kie-live-adapter-mode.conf"), "w") as f:
            f.write("active\n")
        self.assertEqual(K.Adapter(env={"HOME": self.tmp, "OC_CONFIG": oc}).mode, "active")
        self.assertEqual(K.Adapter(env={"HOME": self.tmp, "OC_CONFIG": oc, "KIE_LIVE_ADAPTER_MODE": "off"}).mode, "off")
        self.assertEqual(K.Adapter(env={"HOME": self.tmp, "OC_CONFIG": os.path.join(oc, "openclaw.json")}).mode, "active")

    def test_mode_lookup_reads_data_openclaw_home(self):
        """M8/H7 done-when: HOME=/tmp/h, no OC_CONFIG, injected /data/.openclaw mode file = active."""
        h = os.path.join(self.tmp, "h")
        os.makedirs(h)
        fake = os.path.join(self.tmp, "data", ".openclaw")
        os.makedirs(fake)
        with open(os.path.join(fake, "kie-live-adapter-mode.conf"), "w") as f:
            f.write("active\n")
        claude = os.path.join(self.tmp, "claude")
        os.makedirs(claude)
        with open(os.path.join(claude, "kie-live-adapter-mode.conf"), "w") as f:
            f.write("off\n")
        with mock.patch.object(K, "DATA_OC_ROOT", fake):
            env = {"HOME": h, "CLAUDE_CONFIG_DIR": claude}
            self.assertNotIn("OC_CONFIG", env)
            self.assertEqual(K.Adapter(env=env).mode, "active")
            # OC_CONFIG still wins over the injected /data path.
            env["OC_CONFIG"] = h
            with open(os.path.join(h, "kie-live-adapter-mode.conf"), "w") as f:
                f.write("off\n")
            self.assertEqual(K.Adapter(env=env).mode, "off")

    def test_mode_lookup_falls_through_to_claude_config_dir(self):
        """H7: a Claude Code machine with no OpenClaw folder switches on via ~/.claude."""
        h = os.path.join(self.tmp, "h")
        os.makedirs(os.path.join(h, ".claude"))
        with open(os.path.join(h, ".claude", "kie-live-adapter-mode.conf"), "w") as f:
            f.write("active\n")
        claude = os.path.join(self.tmp, "claude")
        os.makedirs(claude)
        with open(os.path.join(claude, "kie-live-adapter-mode.conf"), "w") as f:
            f.write("off\n")
        real_isdir = os.path.isdir
        with mock.patch("os.path.isdir", side_effect=lambda p: False if p == K.DATA_OC_ROOT else real_isdir(p)):
            self.assertEqual(K.Adapter(env={"HOME": h}).mode, "active")
            # explicit CLAUDE_CONFIG_DIR wins over ~/.claude
            self.assertEqual(K.Adapter(env={"HOME": h, "CLAUDE_CONFIG_DIR": claude}).mode, "off")
            # no mode file anywhere -> shadow
            self.assertEqual(K.Adapter(env={"HOME": os.path.join(self.tmp, "empty")}).mode, "shadow")

    def test_mode_lookup_four_candidates_in_order_with_openclaw_only_control(self):
        """Walk all four candidates in order, plus the control: a box with ONLY ~/.openclaw.

        Control is load-bearing: pre-port the lookup was `$OC_CONFIG or ~/.openclaw`; with
        no OC_CONFIG and no /data it must find the same file and return the same mode.
        """
        h = os.path.join(self.tmp, "h")
        oc = os.path.join(h, ".openclaw")                    # candidate 4
        claude = os.path.join(h, ".claude")                  # candidate 3 (default)
        data = os.path.join(self.tmp, "data", ".openclaw")   # candidate 2 (M8)
        cfg = os.path.join(self.tmp, "cfg")                  # candidate 1 (OC_CONFIG)
        other = os.path.join(self.tmp, "other-claude")       # explicit CLAUDE_CONFIG_DIR
        absent = os.path.join(self.tmp, "no-such-data")
        for d in (oc, claude, data, cfg, other):
            os.makedirs(d)

        def write(d, word):
            with open(os.path.join(d, "kie-live-adapter-mode.conf"), "w") as f:
                f.write(word + "\n")

        # 4. control: only ~/.openclaw has a mode file -> same file, same result as before the port.
        #    Word is "active" (not the "shadow" default) so the assert proves the file was read.
        write(oc, "active")
        with mock.patch.object(K, "DATA_OC_ROOT", absent):
            a = K.Adapter(env={"HOME": h})
            self.assertEqual(a._mode_conf_dirs(h), [claude, oc])
            self.assertEqual(a.mode, "active")
        # 3. ${CLAUDE_CONFIG_DIR:-~/.claude} beats ~/.openclaw; explicit env beats ~/.claude.
        write(claude, "off")
        write(other, "active")
        with mock.patch.object(K, "DATA_OC_ROOT", absent):
            self.assertEqual(K.Adapter(env={"HOME": h}).mode, "off")
            self.assertEqual(K.Adapter(env={"HOME": h, "CLAUDE_CONFIG_DIR": other}).mode, "active")
        # 2. /data/.openclaw when it exists beats candidates 3 and 4 (M8).
        write(data, "off")
        with mock.patch.object(K, "DATA_OC_ROOT", data):
            a = K.Adapter(env={"HOME": h, "CLAUDE_CONFIG_DIR": other})
            self.assertEqual(a._mode_conf_dirs(h), [data, other, oc])
            self.assertEqual(a.mode, "off")
        # 1. $OC_CONFIG wins over every other candidate, and its parent is used when it names a json.
        write(cfg, "active")
        with mock.patch.object(K, "DATA_OC_ROOT", data):
            a = K.Adapter(env={"HOME": h, "CLAUDE_CONFIG_DIR": other, "OC_CONFIG": cfg})
            self.assertEqual(a._mode_conf_dirs(h), [cfg, data, other, oc])
            self.assertEqual(a.mode, "active")
            self.assertEqual(K.Adapter(env={"HOME": h, "OC_CONFIG": os.path.join(cfg, "openclaw.json")}).mode, "active")
        # De-duplication: OC_CONFIG = ~/.openclaw with /data absent -> listed once, order preserved.
        with mock.patch.object(K, "DATA_OC_ROOT", absent):
            self.assertEqual(K.Adapter(env={"HOME": h, "OC_CONFIG": oc})._mode_conf_dirs(h), [oc, claude])
            self.assertEqual(K.Adapter(env={"HOME": h, "OC_CONFIG": oc}).mode, "active")

    def test_validation_failure_in_active_blocks(self):
        a, tr, c = make(self.tmp, std_routes(), mode="active")
        self.assertEqual(a.cmd_submit({"model": MODEL, "input": {"resolution": "1K"}})["state"], "fail")
        self.assertEqual(tr.n("POST", "createTask"), 0)


if __name__ == "__main__":
    unittest.main()
