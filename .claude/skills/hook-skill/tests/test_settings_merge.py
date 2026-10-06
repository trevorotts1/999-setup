#!/usr/bin/env python3
"""settings_merge: append-only registration, idempotent, exact removal, invalid JSON never touched."""
import json, os, shutil, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts", "common"))
import settings_merge as sm

FOREIGN = {"matcher": "Bash", "hooks": [{"type": "command", "command": "other-tool --check", "timeout": 5}]}


class Merge(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="sm-")
        self.f = os.path.join(self.d, "settings.json")
        self.hd = os.path.join(self.d, "hooks")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def write(self, doc):
        with open(self.f, "w") as fh:
            json.dump(doc, fh)

    def read(self):
        with open(self.f) as fh:
            return json.load(fh)

    def test_register_appends_and_keeps_existing(self):
        self.write({"model": "x", "hooks": {"PreToolUse": [FOREIGN]}})
        n = sm.register(self.f, sys.executable, self.hd, ["workflow-guard", "hygiene"])
        doc = self.read()
        self.assertEqual(doc["model"], "x")
        self.assertEqual(doc["hooks"]["PreToolUse"][0], FOREIGN)
        self.assertEqual(len(doc["hooks"]["PreToolUse"]), 2)
        self.assertEqual(n, 7)  # 6 workflow-guard events + 1 hygiene

    def test_register_is_idempotent(self):
        sm.register(self.f, sys.executable, self.hd, ["workflow-guard"])
        first = self.read()
        self.assertEqual(sm.register(self.f, sys.executable, self.hd, ["workflow-guard"]), 0)
        self.assertEqual(self.read(), first)

    def test_workflow_guard_matchers_and_timeouts_match_the_live_registrations(self):
        sm.register(self.f, sys.executable, self.hd, ["workflow-guard"])
        h = self.read()["hooks"]
        by = {e: [(g.get("matcher"), x["timeout"]) for g in gs for x in g["hooks"]] for e, gs in h.items()}
        self.assertEqual(by["PreToolUse"], [("Workflow|Agent|Task|SendMessage|TaskOutput|Edit|Write|MultiEdit|NotebookEdit|Bash", 120)])
        self.assertEqual(by["PostToolUse"], [("Workflow|TaskStop|Agent|Task|TaskOutput|Write", 120)])
        self.assertEqual(by["PostToolUseFailure"], [(".*", 120)])
        for e in ("SessionStart", "Stop", "UserPromptSubmit"):
            self.assertEqual(by[e], [(None, 120)])

    def test_question_gate_registers_both_events(self):
        sm.register(self.f, sys.executable, self.hd, ["question-gate"])
        h = self.read()["hooks"]
        self.assertIn("gate_actions.py", h["PreToolUse"][0]["hooks"][0]["command"])
        self.assertIn("classify_prompt.py", h["UserPromptSubmit"][0]["hooks"][0]["command"])

    def test_unregister_removes_only_ours(self):
        self.write({"hooks": {"PreToolUse": [FOREIGN], "Stop": [{"hooks": [{"type": "command", "command": "mine"}]}]}})
        sm.register(self.f, sys.executable, self.hd, ["workflow-guard", "hygiene", "ask-before-backup", "question-gate"])
        # a foreign hook sharing one of our groups must survive
        doc = self.read()
        doc["hooks"]["PostToolUse"][0]["hooks"].append({"type": "command", "command": "foreign-in-our-group"})
        self.write(doc)
        self.assertGreater(sm.unregister(self.f, self.hd), 0)
        after = self.read()
        self.assertEqual(after["hooks"]["PreToolUse"], [FOREIGN])
        self.assertEqual(after["hooks"]["Stop"], [{"hooks": [{"type": "command", "command": "mine"}]}])
        self.assertEqual(after["hooks"]["PostToolUse"][0]["hooks"], [{"type": "command", "command": "foreign-in-our-group"}])
        self.assertEqual(sorted(after["hooks"]), ["PostToolUse", "PreToolUse", "Stop"])
        self.assertEqual(sm.unregister(self.f, self.hd), 0)

    def test_unregister_after_register_on_empty_file_leaves_no_hooks_key(self):
        sm.register(self.f, sys.executable, self.hd, ["hygiene"])
        sm.unregister(self.f, self.hd)
        self.assertEqual(self.read(), {})

    def test_invalid_json_is_never_modified(self):
        with open(self.f, "w") as fh:
            fh.write("{ not json")
        with self.assertRaises(ValueError):
            sm.register(self.f, sys.executable, self.hd, ["hygiene"])
        with open(self.f) as fh:
            self.assertEqual(fh.read(), "{ not json")

    def test_dry_run_writes_nothing(self):
        sm.DRY = True
        try:
            sm.register(self.f, sys.executable, self.hd, ["hygiene"])
        finally:
            sm.DRY = False
        self.assertFalse(os.path.exists(self.f))

    def test_path_with_spaces_roundtrips(self):
        hd = os.path.join(self.d, "dir with space", "hooks")
        sm.register(self.f, sys.executable, hd, ["hygiene"])
        self.assertEqual(sm.unregister(self.f, hd), 1)


if __name__ == "__main__":
    unittest.main()
