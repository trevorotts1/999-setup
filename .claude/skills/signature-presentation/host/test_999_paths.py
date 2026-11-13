"""Self-check for the 999 host profile (PD-036). Stdlib only, no live action.

Run: python3 -I .claude/skills/signature-presentation/host/test_999_paths.py
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HOST_DIR = Path(__file__).resolve().parent
if str(HOST_DIR) not in sys.path:
    sys.path.insert(0, str(HOST_DIR))
host = importlib.import_module("999_paths")

class HostProfileTests(unittest.TestCase):
    def test_plan_contract_and_run_dir_under_project(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {"COMMAND_CENTER_URL": "",
                                            "MISSION_CONTROL_URL": ""}):
            project = Path(tmp)
            run = host.default_run_dir(project)
            doc = host.plan(project, run)
            self.assertEqual(doc["profile"], "999")
            self.assertTrue(host.under(Path(doc["run_dir"]), project))
            self.assertEqual(doc["notify"]["transport"], "file-queue")
            self.assertTrue(doc["notify"]["outbox"].endswith("working/outbox.jsonl"))
            self.assertEqual(doc["command_center"]["board_mirror"], "off")
            self.assertTrue(doc["vendored"]["present"])
            self.assertGreater(doc["vendored"]["files"], 0)

    def test_image_key_read_by_name_never_in_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            secret = "999-test-secret-value"
            (project / "API docs.md").write_text(
                "# API docs\n\nKIE_API_KEY=" + secret + "\n", encoding="utf-8")
            name, value = host.read_key(project / "API docs.md")
            self.assertEqual(name, "KIE_API_KEY")
            self.assertEqual(value, secret)
            doc = host.plan(project, host.default_run_dir(project))
            self.assertTrue(doc["image_key"]["present"])
            self.assertEqual(doc["image_key"]["length"], len(secret))
            self.assertNotIn(secret, json.dumps(doc))
            self.assertNotIn("value", doc["image_key"])

    def test_dependency_gate_names_missing_tool(self):
        with mock.patch.dict(os.environ, {"PATH": ""}):
            report = host.dependency_report()
        self.assertTrue(report["manifest_found"])
        self.assertIn("soffice", report["missing"])
        self.assertTrue(set(report["missing"]).isdisjoint(report["present"]))
        self.assertTrue(set(report["required_missing"]).issubset(report["missing"]))

    def test_workspace_link_satisfies_exit_61_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = host.ensure_workspace(Path(tmp))
            scripts = ws / "departments" / "Presentations" / "scripts"
            self.assertTrue((scripts / "build_deck.py").is_file())
            self.assertTrue((scripts / "run_signature_deck.py").is_file())
            self.assertTrue((scripts / "presentation-canonical-entry.sh").is_file())

    def test_env_sets_file_queue_and_owner_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            run = host.ensure_run_dir(host.default_run_dir(project))
            child = host.env(project, run, owner_msg_id="msg-123",
                             base={"PATH": os.environ.get("PATH", "")})
            self.assertEqual(child["PRESENTATION_NOTIFY_CMD"],
                             str(host.OUTBOX_QUEUE))
            self.assertEqual(child["PRESENTATION_RUN_DIR"], str(run))
            self.assertEqual(child["PRESENTATION_REQUESTER_CHAT_ID"], "msg-123")
            self.assertEqual(child["OPENCLAW_WORKSPACE"],
                             str(host.workspace_dir(project)))
            self.assertTrue(host.under(Path(child["OPENCLAW_ROOT"]), project))
            self.assertNotIn("KIE_API_KEY", child)
            self.assertNotIn("COMMAND_CENTER_URL", child)

    def test_owner_persists_across_turns(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            run = host.ensure_run_dir(host.default_run_dir(project))
            self.assertEqual(host.load_owner(run), "")
            host.save_owner(run, "msg-456")
            self.assertEqual(host.load_owner(run), "msg-456")

    def test_env_uses_api_docs_key_without_printing(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            (project / "API docs.md").write_text(
                "KIE_AI_API_KEY: abc123\n", encoding="utf-8")
            run = host.ensure_run_dir(host.default_run_dir(project))
            child = host.env(project, run, base={"PATH": ""})
            self.assertEqual(child["KIE_API_KEY"], "abc123")

if __name__ == "__main__":
    unittest.main(verbosity=2)
