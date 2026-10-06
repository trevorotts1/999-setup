#!/usr/bin/env python3
"""apply_capacity: the measured cap lands in limits.json and in env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS of
every settings file, merged (never clobbering other keys), idempotent, and uninstall restores what was there before."""
import json, os, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(SKILL, "scripts", "common"))
import apply_capacity as ac

PROBE = os.path.join(SKILL, "hooks", "workflow-guard", "capacity_probe.py")
ENV = "CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS"
MEASURED = {"per_workflow_cap": 6, "max_working_agents": 300, "ram_gb": 9, "cores": 6, "source": "fixture"}


class Apply(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="cap-")
        self.limits = os.path.join(self.d, "state", "limits.json")
        self.s1 = os.path.join(self.d, "claude", "settings.json")
        self.s2 = os.path.join(self.d, "nine", "settings.json")
        self.man = os.path.join(self.d, "manifest.json")
        for p in (self.s1, self.s2):
            os.makedirs(os.path.dirname(p))
        with open(self.s1, "w") as f:
            json.dump({"model": "keep", "env": {"OTHER": "1", ENV: "10"}}, f)
        with open(self.s2, "w") as f:
            json.dump({"hooks": {}}, f)
        with open(self.man, "w") as f:
            json.dump({"version": "x", "files": []}, f)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def read(self, p):
        with open(p) as f:
            return json.load(f)

    def test_writes_merges_and_is_idempotent(self):
        ac.apply(MEASURED, self.limits, [self.s1, self.s2], manifest=self.man)
        self.assertEqual(self.read(self.s1), {"model": "keep", "env": {"OTHER": "1", ENV: "6"}})
        self.assertEqual(self.read(self.s2), {"hooks": {}, "env": {ENV: "6"}})
        self.assertEqual(self.read(self.limits), {"concurrent_agents_per_workflow": 6, "concurrent_agents_total": 300})
        first = [self.read(p) for p in (self.s1, self.s2, self.limits)]
        ac.apply(MEASURED, self.limits, [self.s1, self.s2], manifest=self.man)
        self.assertEqual([self.read(p) for p in (self.s1, self.s2, self.limits)], first)

    def test_limits_keep_operator_keys(self):
        os.makedirs(os.path.dirname(self.limits))
        with open(self.limits, "w") as f:
            json.dump({"concurrent_workflows_per_program": 7, "concurrent_agents_per_workflow": 10}, f)
        ac.apply(MEASURED, self.limits, [self.s1])
        self.assertEqual(self.read(self.limits)["concurrent_workflows_per_program"], 7)
        self.assertEqual(self.read(self.limits)["concurrent_agents_per_workflow"], 6)

    def test_restore_puts_back_the_prior_value_and_removes_what_it_added(self):
        ac.apply(MEASURED, self.limits, [self.s1, self.s2], manifest=self.man)
        ac.apply(MEASURED, self.limits, [self.s1, self.s2], manifest=self.man)  # a re-run must not record its own value as "prior"
        ac.restore(self.man)
        self.assertEqual(self.read(self.s1), {"model": "keep", "env": {"OTHER": "1", ENV: "10"}})
        self.assertEqual(self.read(self.s2), {"hooks": {}})

    def test_invalid_settings_json_is_never_touched(self):
        with open(self.s2, "w") as f:
            f.write("{not json")
        with self.assertRaises(ValueError):
            ac.apply(MEASURED, self.limits, [self.s2])
        with open(self.s2) as f:
            self.assertEqual(f.read(), "{not json")

    def test_cli_runs_the_real_probe_and_writes_a_cap_in_range(self):
        r = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "common", "apply_capacity.py"), "--probe", PROBE,
                            "--limits", self.limits, "--settings", self.s1], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        cap = int(self.read(self.s1)["env"][ENV])
        self.assertTrue(1 <= cap <= 10)
        self.assertEqual(self.read(self.limits)["concurrent_agents_per_workflow"], cap)
        self.assertEqual(self.read(self.limits)["concurrent_agents_total"], min(500, cap * 50))

    def test_probe_selftest(self):
        r = subprocess.run([sys.executable, PROBE, "--selftest"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_claude_nine_gets_the_same_120s_guard_timeouts_as_claude(self):
        import settings_merge as sm
        for name in ("claude", "nine"):
            f = os.path.join(self.d, name, "register.json")
            sm.register(f, sys.executable, os.path.join(self.d, "hooks"), ["workflow-guard"])
            with open(f) as fh:
                doc = json.load(fh)
            self.assertEqual({h["timeout"] for g in sum(doc["hooks"].values(), []) for h in g["hooks"]}, {120})

    def test_registrations_match_the_live_guard(self):
        import settings_merge as sm
        _, entries = sm.COMPONENTS["workflow-guard"]
        got = {(e, m) for e, m, _t, _a in entries}
        self.assertEqual(got, {("SessionStart", None), ("Stop", None), ("UserPromptSubmit", None), ("PostToolUseFailure", ".*"),
                               ("PreToolUse", "Workflow|Agent|Task|TaskOutput|Edit|Write|MultiEdit|NotebookEdit|Bash"),
                               ("PostToolUse", "Workflow|TaskStop|Agent|Task|TaskOutput")})


if __name__ == "__main__":
    unittest.main(verbosity=2)
