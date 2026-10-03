#!/usr/bin/env python3
"""ask-before-backup and question-gate: ask on backups/actions-after-a-question, skip in bypass mode, reads pass."""
import json, os, subprocess, sys, tempfile, unittest
HOOKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks")


def run(script, payload):
    p = subprocess.run([sys.executable, os.path.join(HOOKS, script)], input=json.dumps(payload), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)["hookSpecificOutput"] if p.stdout.strip() else None


class Backup(unittest.TestCase):
    S = "ask-before-backup/ask_before_backup.py"

    def test_asks_for_backup_copy(self):
        self.assertEqual(run(self.S, {"tool_name": "Bash", "tool_input": {"command": "cp config config.bak"}})["permissionDecision"], "ask")

    def test_asks_for_backup_path_write(self):
        self.assertEqual(run(self.S, {"tool_name": "Write", "tool_input": {"file_path": "/x/backup/a.txt"}})["permissionDecision"], "ask")

    def test_plain_command_passes(self):
        self.assertIsNone(run(self.S, {"tool_name": "Bash", "tool_input": {"command": "ls -la"}}))

    def test_bypass_mode_skips(self):
        self.assertIsNone(run(self.S, {"tool_name": "Bash", "tool_input": {"command": "cp a a.bak"}, "permission_mode": "bypassPermissions"}))

    def test_quoted_word_is_not_an_action(self):
        self.assertIsNone(run(self.S, {"tool_name": "Bash", "tool_input": {"command": "git commit -m \"no backup needed\""}}))


class QuestionGate(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="qg-")
        # copy so the state folder lands in a temp dir, not the repo
        import shutil
        shutil.copytree(os.path.join(HOOKS, "question-gate"), os.path.join(self.d, "question-gate"))
        self.dir = os.path.join(self.d, "question-gate")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.d, ignore_errors=True)

    def classify(self, prompt, sid="s1"):
        return subprocess.run([sys.executable, os.path.join(self.dir, "classify_prompt.py")],
                              input=json.dumps({"session_id": sid, "prompt": prompt}), capture_output=True, text=True)

    def gate(self, tool, ti, sid="s1", **kw):
        p = subprocess.run([sys.executable, os.path.join(self.dir, "gate_actions.py")],
                           input=json.dumps({"session_id": sid, "tool_name": tool, "tool_input": ti, **kw}), capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout)["hookSpecificOutput"] if p.stdout.strip() else None

    def test_question_then_action_asks(self):
        self.assertIn("QUESTION ONLY", self.classify("should we rename this file?").stdout)
        self.assertEqual(self.gate("Bash", {"command": "rm notes.txt"})["permissionDecision"], "ask")
        self.assertEqual(self.gate("Write", {"file_path": "/x/a"})["permissionDecision"], "ask")

    def test_reads_pass_after_question(self):
        self.classify("what is in this folder?")
        self.assertIsNone(self.gate("Bash", {"command": "ls -la && git status"}))
        self.assertIsNone(self.gate("mcp__github__list_issues", {}))

    def test_order_clears_the_gate(self):
        self.classify("what is in this folder?")
        self.classify("fix it now")
        self.assertIsNone(self.gate("Bash", {"command": "rm notes.txt"}))

    def test_bypass_mode_skips(self):
        self.classify("what is in this folder?")
        self.assertIsNone(self.gate("Bash", {"command": "rm notes.txt"}, permission_mode="bypassPermissions"))

    def test_redirect_to_file_is_not_read_only(self):
        self.classify("why is this slow?")
        self.assertEqual(self.gate("Bash", {"command": "echo hi > out.txt"})["permissionDecision"], "ask")

    def test_no_state_means_pass(self):
        self.assertIsNone(self.gate("Bash", {"command": "rm notes.txt"}, sid="never-seen"))


if __name__ == "__main__":
    unittest.main()
