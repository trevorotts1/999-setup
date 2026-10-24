"""Whole-package storyboard presentation binding for the Claude-Nine runner.

Synthetic local stills and a recording sender only; no provider or transport.
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest

CORE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CORE))
from storyboard_director import approval_runner as runner
from batch_mode.batch import STAGES
from state_store import Store


class TwinPresentationBinding(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="s75-twin-board-")
        self.addCleanup(self.temp.cleanup)
        self.run = Path(self.temp.name) / "run"
        self.board = self.run / "storyboard"
        self.board.mkdir(parents=True)
        self.sent = []
        self.send = lambda message, images: self.sent.append((message, images))
        shots, contracts, stills = [], {}, {}
        for n in (1, 2):
            sid = "s%d" % n
            shots.append({"shot_id": sid, "song_start": (n - 1) * 8, "song_end": n * 8,
                          "story_stage": "new-chapter", "location_id": "office"})
            contracts[sid] = {"lyric_text": "line%d" % n, "viewer_understanding": "new step",
                              "character_action": "takes a step", "visible_emotion": "hope"}
            path = self.board / (sid + ".png")
            path.write_bytes(b"synthetic still" + bytes([n]))
            stills[sid] = str(path)
        for name, value in (("shot-list.json", {"shots": shots}), ("contracts.json", contracts),
                            ("stills.json", stills)):
            (self.board / name).write_text(json.dumps(value))
        (self.run / "control").mkdir()
        self.receipt = self.run / "control" / "card-receipt.json"
        self.receipt.write_text(json.dumps({"storyboard_approval": True}))
        with Store(self.run / "control" / "state.sqlite3") as store:
            store.init_run("run", [name for name, _ in STAGES])

    def test_whole_package_go_records_revision_bound_decision_and_resume_sends_nothing(self):
        self.assertEqual(runner.run(str(self.run), self.send)["action"], "waiting")
        state = json.loads((self.board / "approval.json").read_text())
        self.assertEqual(set(state["shots"]), {"s1", "s2"})
        self.assertEqual(len(self.sent[0][1]), 2)
        self.assertEqual(runner.run(str(self.run), self.send, reply="GO")["action"], "approved")
        self.assertTrue(runner.gate_open(str(self.run)))
        approved = json.loads((self.board / "approval.json").read_text())
        self.assertEqual(approved["decision"]["scope"], "whole-package")
        self.assertEqual(approved["decision"]["reply_text"], "GO")
        runner.run(str(self.run), self.send, reply="GO")
        self.assertEqual(len(self.sent), 1)
        (self.board / "s1.png").write_bytes(b"changed current still")
        self.assertFalse(runner.gate_open(str(self.run)))

    def test_changed_pending_asset_or_sender_time_change_never_becomes_approved(self):
        def changing_sender(message, images):
            self.send(message, images)
            (self.board / "s1.png").write_bytes(b"changed during send")
        runner.run(str(self.run), changing_sender)
        before = (self.board / "approval.json").read_bytes()
        result = runner.run(str(self.run), self.send, reply="GO")
        self.assertEqual(result["reason_code"], "STORYBOARD_PRESENTATION_CHANGED")
        self.assertEqual((self.board / "approval.json").read_bytes(), before)
        self.assertFalse((self.board / "gate.json").exists())

    def test_unbound_legacy_approved_flag_is_preserved_behind_specific_hold(self):
        path = self.board / "approval.json"
        path.write_text(json.dumps({"state": "approved", "choice": "yes", "at": 1}))
        before = path.read_bytes()
        self.assertFalse(runner.gate_open(str(self.run)))
        result = runner.run(str(self.run), self.send, reply="GO")
        self.assertEqual(result["reason_code"], "STORYBOARD_APPROVAL_UNVERIFIED")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.sent, [])

    def test_declined_approval_still_binds_current_assets_without_sending(self):
        self.receipt.write_text(json.dumps({"storyboard_approval": False}))
        self.assertEqual(runner.run(str(self.run), self.send)["action"], "approved")
        self.assertTrue(runner.gate_open(str(self.run)))
        self.assertEqual(self.sent, [])
        (self.board / "s2.png").write_bytes(b"changed after explicit No")
        self.assertFalse(runner.gate_open(str(self.run)))

    def test_named_revision_resends_only_that_shot_then_whole_package_go(self):
        runner.run(str(self.run), self.send)
        def remake(sid, card):
            path = self.board / (sid + "-revised.png")
            path.write_bytes(b"synthetic revised still")
            return str(path)
        result = runner.run(str(self.run), self.send, reply="shot 2: change stand up", make_still=remake)
        self.assertEqual(result["action"], "revised")
        self.assertEqual([n for n, path in self.sent[-1][1]], [2])
        self.assertFalse(runner.gate_open(str(self.run)))
        self.assertEqual(runner.run(str(self.run), self.send, reply="GO")["action"], "approved")
        self.assertTrue(runner.gate_open(str(self.run)))


if __name__ == "__main__":
    unittest.main()
