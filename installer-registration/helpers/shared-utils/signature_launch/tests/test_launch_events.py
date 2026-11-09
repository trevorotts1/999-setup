#!/usr/bin/env python3
"""CON-21: the launch event emitter posts to a (fake) CC and never fails a launch.

Free: stdlib only, local loopback fake CC, synthetic values, no real token.
Run: python3 -m pytest shared-utils/signature_launch/tests/test_launch_events.py -q
"""
import importlib.util
import json
import socket
import sys
import tempfile
import threading
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PKG = Path(__file__).resolve().parents[1]
ROOT = PKG.parents[1]


def _skill(name):  # onboarding: 49-signature-funnel; 999: .claude/skills/signature-funnel
    p = ROOT / name
    return p if p.is_dir() else ROOT / ".claude/skills" / name.split("-", 1)[1]


_spec = importlib.util.spec_from_file_location("launch_events", PKG / "launch_events.py")
le = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(le)

TOKEN = "synthetic-tenant-token"
LAUNCH = "bf-2026-11"


class _FakeCC:
    """Records every ingest POST; answers with a scripted status."""

    def __init__(self, status=200):
        self.requests = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                outer.requests.append({
                    "path": self.path,
                    "auth": self.headers.get("Authorization"),
                    "body": json.loads(self.rfile.read(n)),
                })
                self.send_response(outer.status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *a):
                pass

        self.status = status
        self.server = HTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def events(self):
        return [e for r in self.requests for e in r["body"]["events"]]


def _dead_url():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()  # nothing listens here: connection refused
    return "http://127.0.0.1:%d" % port


class LaunchEventsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        tok = Path(self.tmp.name, "token")
        tok.write_text(TOKEN + "\n", encoding="utf-8")
        self.spool = Path(self.tmp.name, "spool")
        self.env = {"LAUNCH_EVENTS_SPOOL": str(self.spool), "LAUNCH_EVENTS_TOKEN_FILE": str(tok),
                    "LAUNCH_EVENTS_TIMEOUT": "2"}

    def _spooled(self):
        p = self.spool / le.SPOOL_FILE
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def test_posts_contract_shaped_event_with_token(self):
        cc = _FakeCC()
        self.addCleanup(cc.close)
        env = dict(self.env, COMMAND_CENTER_URL=cc.url)
        out = le.emit(83, LAUNCH, "dispatch", env=env)
        self.assertTrue(out["sent"] and not out["spooled"])
        req = cc.requests[0]
        self.assertEqual(req["path"], "/api/launch-runs/ingest")
        self.assertEqual(req["auth"], "Bearer " + TOKEN)
        ev = req["body"]["events"][0]
        self.assertEqual((ev["skill"], ev["launch_id"]), (83, LAUNCH))
        self.assertEqual((ev["event_type"], ev["stage"], ev["receipt_status"]),
                         ("stage_closed", "dispatch", "pass"))
        self.assertIn("closed_at", ev)
        self.assertEqual(ev["schema_version"], "1.0")
        self.assertEqual(len(ev["event_id"]), 36)
        self.assertEqual(self._spooled(), [])

    def test_one_run_per_launch_one_event_per_step(self):
        cc = _FakeCC()
        self.addCleanup(cc.close)
        env = dict(self.env, COMMAND_CENTER_URL=cc.url)
        for step in ("dispatch", "assemble", "checks"):
            le.emit(83, LAUNCH, step, env=env)
        le.emit(49, LAUNCH, {"event_type": "stage_blocked", "stage": "page_dispatch",
                             "failures": ["boom"]}, env=env)
        evs = cc.events()
        self.assertEqual([e["stage"] for e in evs], ["dispatch", "assemble", "checks", "page_dispatch"])
        self.assertEqual(len({e["event_id"] for e in evs}), 4)
        self.assertEqual(len({e["run_id"] for e in evs[:3]}), 1)
        self.assertNotEqual(evs[0]["run_id"], evs[3]["run_id"])  # skill 49 is its own run
        self.assertEqual(evs[3]["event_type"], "stage_blocked")
        self.assertIn("blocked_at", evs[3])

    def test_run_initialized_carries_host_shape(self):
        ev = le.build_event(83, LAUNCH, {"event_type": "run_initialized"}, env={})
        self.assertEqual(ev["host_shape"], "fleet-mac")

    def test_network_error_spools_and_never_raises(self):
        env = dict(self.env, COMMAND_CENTER_URL=_dead_url())
        out = le.emit(83, LAUNCH, "dispatch", env=env)
        self.assertEqual((out["sent"], out["spooled"]), (False, True))
        self.assertEqual([e["stage"] for e in self._spooled()], ["dispatch"])

    def test_raising_transport_spools(self):
        def boom(*a):
            raise OSError("down")
        out = le.emit(83, LAUNCH, "assemble", env=dict(self.env, COMMAND_CENTER_URL="http://x"), post=boom)
        self.assertTrue(out["spooled"])

    def test_http_500_spools(self):
        cc = _FakeCC(status=500)
        self.addCleanup(cc.close)
        out = le.emit(83, LAUNCH, "dispatch", env=dict(self.env, COMMAND_CENTER_URL=cc.url))
        self.assertTrue(out["spooled"] and not out["sent"])

    def test_unconfigured_cc_spools(self):
        out = le.emit(83, LAUNCH, "dispatch", env=self.env)
        self.assertTrue(out["spooled"])

    def test_bad_input_never_raises(self):
        for bad in (None, 7, {"stage": object()}):
            le.emit("not-a-skill", LAUNCH, bad, env=self.env)
        le.emit(83, LAUNCH, "dispatch", env={"LAUNCH_EVENTS_SPOOL": "/dev/null/x"})  # unwritable spool

    def test_backlog_replays_in_order_when_cc_returns(self):
        le.emit(83, LAUNCH, "dispatch", env=dict(self.env, COMMAND_CENTER_URL=_dead_url()))
        le.emit(83, LAUNCH, "pieces", env=dict(self.env, COMMAND_CENTER_URL=_dead_url()))
        self.assertEqual(len(self._spooled()), 2)
        cc = _FakeCC()
        self.addCleanup(cc.close)
        le.emit(83, LAUNCH, "assemble", env=dict(self.env, COMMAND_CENTER_URL=cc.url))
        self.assertEqual([e["stage"] for e in cc.events()], ["dispatch", "pieces", "assemble"])
        self.assertEqual(self._spooled(), [])

    def test_backlog_is_sent_before_a_new_event(self):
        env = dict(self.env, COMMAND_CENTER_URL="http://cc.test")

        def down(*a):
            raise OSError("down")
        le.emit(83, LAUNCH, {"event_type": "run_initialized"}, env=env, post=down)
        out = le.emit(83, LAUNCH, "dispatch", env=env, post=down)  # still down
        self.assertEqual((out["sent"], out["spooled"]), (False, True))
        self.assertEqual([e["event_type"] for e in self._spooled()], ["run_initialized", "stage_closed"])
        seen = []

        def up(url, token, events, timeout):
            seen.extend(e["event_type"] for e in events)
            return 200
        out = le.emit(83, LAUNCH, "assemble", env=env, post=up)
        self.assertEqual(seen, ["run_initialized", "stage_closed", "stage_closed"])
        self.assertTrue(out["sent"] and not out["spooled"])
        self.assertEqual(self._spooled(), [])
        self.assertFalse((self.spool / le.SPOOL_FILE).exists())

    def test_422_is_not_retried_forever(self):
        cc = _FakeCC(status=422)
        self.addCleanup(cc.close)
        out = le.emit(83, LAUNCH, "dispatch", env=dict(self.env, COMMAND_CENTER_URL=cc.url))
        self.assertFalse(out["sent"] or out["spooled"])
        self.assertEqual(self._spooled(), [])
        self.assertTrue((self.spool / le.REJECTED_FILE).exists())

    def test_token_never_written_to_spool(self):
        le.emit(83, LAUNCH, "dispatch", env=dict(self.env, COMMAND_CENTER_URL=_dead_url()))
        self.assertNotIn(TOKEN, (self.spool / le.SPOOL_FILE).read_text())


class LaunchEventsF23Test(unittest.TestCase):
    """F23: the shape the Command Center's governed launch domain consumes.

    Run identity binds installation + approved plan; a delivery failure is never
    reported as sent; the spool survives concurrent producers. Free: stdlib only,
    synthetic values, no real token.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        tok = Path(self.tmp.name, "token")
        tok.write_text(TOKEN + "\n", encoding="utf-8")
        self.spool = Path(self.tmp.name, "spool")
        self.env = {"LAUNCH_EVENTS_SPOOL": str(self.spool), "LAUNCH_EVENTS_TOKEN_FILE": str(tok),
                    "LAUNCH_EVENTS_TIMEOUT": "2"}

    def _spooled(self, name=None):
        p = self.spool / (name or le.SPOOL_FILE)
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def test_legacy_run_id_is_unchanged_without_identity(self):
        legacy = str(uuid.uuid5(le._RUN_NS, "83:%s" % LAUNCH))
        self.assertEqual(le.run_id_for(83, LAUNCH), legacy)
        self.assertEqual(le.build_event(83, LAUNCH, "dispatch", env={})["run_id"], legacy)

    def test_run_id_binds_installation_and_approved_plan(self):
        plain = le.run_id_for(83, LAUNCH)
        installed = le.run_id_for(83, LAUNCH, installation_id="install-a")
        planned = le.run_id_for(83, LAUNCH, plan_revision=1, plan_hash="sha256:" + "a" * 64)
        self.assertEqual(len({plain, installed, planned}), 3)
        # stable for the same tuple
        self.assertEqual(planned, le.run_id_for(83, LAUNCH, plan_revision=1,
                                                plan_hash="sha256:" + "a" * 64))

    def test_two_installations_on_one_launch_slug_are_two_runs(self):
        a = le.build_event(83, LAUNCH, "dispatch", env={}, installation_id="install-a")
        b = le.build_event(83, LAUNCH, "dispatch", env={}, installation_id="install-b")
        self.assertNotEqual(a["run_id"], b["run_id"])
        self.assertEqual((a["installation_id"], b["installation_id"]),
                         ("install-a", "install-b"))

    def test_a_replanned_launch_is_a_new_run(self):
        first = le.build_event(83, LAUNCH, "dispatch", env={},
                               plan_revision=1, plan_hash="sha256:" + "1" * 64)
        second = le.build_event(83, LAUNCH, "dispatch", env={},
                                plan_revision=2, plan_hash="sha256:" + "2" * 64)
        self.assertNotEqual(first["run_id"], second["run_id"])

    def test_identity_defaults_come_from_the_environment(self):
        env = dict(self.env, LAUNCH_EVENTS_INSTALLATION_ID=" install-env ",
                   LAUNCH_EVENTS_PLAN_REVISION="3",
                   LAUNCH_EVENTS_PLAN_HASH="sha256:" + "b" * 64)
        ev = le.build_event(83, LAUNCH, "dispatch", env=env)
        self.assertEqual(ev["installation_id"], "install-env")
        self.assertEqual(ev["run_id"], le.run_id_for(83, LAUNCH, "install-env", 3,
                                                     "sha256:" + "b" * 64))
        # a stray value is ignored, never raised, and never guessed at
        stray = le.build_event(83, LAUNCH, "dispatch",
                               env={"LAUNCH_EVENTS_PLAN_REVISION": "not-a-number"})
        self.assertEqual(stray["run_id"], le.run_id_for(83, LAUNCH, "", None, ""))

    def test_producer_spellings_are_emitted_as_the_registered_stage(self):
        # F23.12: the CC registers `checks` for 83 and `page_dispatch` for 49.
        self.assertEqual(le.build_event(83, LAUNCH, "check", env={})["stage"], "checks")
        self.assertEqual(le.build_event(49, LAUNCH, "dispatch", env={})["stage"], "page_dispatch")
        self.assertEqual(le.build_event(49, LAUNCH, {"event_type": "item_closed",
                                                     "stage": "dispatch",
                                                     "item": "landing"}, env={})["stage"],
                         "page_dispatch")
        # Already-canonical spellings are untouched.
        self.assertEqual(le.build_event(83, LAUNCH, "checks", env={})["stage"], "checks")

    def test_a_producer_field_spelling_is_emitted_as_the_contract_name(self):
        # Skill 49 writes `item`; the run-events contract names `item_id`.
        ev = le.build_event(49, LAUNCH, {"event_type": "item_closed", "stage": "dispatch",
                                         "item": "landing"}, env={})
        self.assertEqual(ev.get("item_id"), "landing")
        self.assertNotIn("item", ev)
        # An explicit contract-name field wins and the stray field is dropped.
        both = le.build_event(49, LAUNCH, {"event_type": "item_closed", "stage": "dispatch",
                                           "item": "landing", "item_id": "upsell_1"}, env={})
        self.assertEqual(both["item_id"], "upsell_1")
        self.assertNotIn("item", both)

    def test_an_unregistered_stage_is_never_renamed(self):
        ev = le.build_event(83, LAUNCH, "not_a_stage", env={})
        self.assertEqual(ev["stage"], "not_a_stage")

    def test_an_unknown_stage_stays_a_delivery_failure_at_the_cc(self):
        out = le.emit(83, LAUNCH, "not_a_stage",
                      env=dict(self.env, COMMAND_CENTER_URL="http://cc.test"),
                      post=lambda *a: (422, {"accepted": 0, "rejected": 1,
                                             "delivery_failures": [{"codes": ["unknown_stage"]}]}))
        self.assertEqual(out["codes"], ["unknown_stage"])
        self.assertFalse(out["sent"])
        self.assertEqual(len(self._spooled(le.REJECTED_FILE)), 1)

    def test_a_200_that_rejected_the_item_is_a_delivery_failure(self):
        rejected = {"accepted": 0, "duplicates": 0, "rejected": 1,
                    "results": [{"kind": "event", "status": "rejected",
                                 "codes": ["unknown_stage"]}],
                    "delivery_failures": [{"kind": "event", "id": "x",
                                           "codes": ["unknown_stage"], "errors": []}]}
        out = le.emit(83, LAUNCH, "check", env=dict(self.env, COMMAND_CENTER_URL="http://cc.test"),
                      post=lambda *a: (200, rejected))
        self.assertFalse(out["sent"])
        self.assertEqual(out["codes"], ["unknown_stage"])
        self.assertEqual(len(self._spooled(le.REJECTED_FILE)), 1)
        self.assertEqual(self._spooled(), [])

    def test_a_200_that_accepted_the_item_is_sent(self):
        accepted = {"accepted": 1, "duplicates": 0, "rejected": 0,
                    "results": [{"kind": "event", "status": "inserted"}],
                    "delivery_failures": []}
        out = le.emit(83, LAUNCH, "dispatch", env=dict(self.env, COMMAND_CENTER_URL="http://cc.test"),
                      post=lambda *a: (200, accepted))
        self.assertTrue(out["sent"])
        self.assertEqual(out["codes"], [])
        self.assertEqual(self._spooled(), [])

    def test_drain_counts_item_rejections_separately(self):
        le.emit(83, LAUNCH, "dispatch", env=dict(self.env, COMMAND_CENTER_URL=_dead_url()))
        le.emit(83, LAUNCH, "assemble", env=dict(self.env, COMMAND_CENTER_URL=_dead_url()))
        self.assertEqual(len(self._spooled()), 2)

        def mixed(url, token, events, timeout):
            stage = events[0].get("stage")
            if stage == "dispatch":
                return 200, {"accepted": 0, "rejected": 1,
                             "results": [{"status": "rejected", "codes": ["unknown_stage"]}]}
            return 200, {"accepted": 1, "rejected": 0,
                         "results": [{"status": "inserted"}]}

        out = le.drain(env=dict(self.env, COMMAND_CENTER_URL="http://cc.test"), post=mixed)
        self.assertEqual(out, {"sent": 1, "left": 0, "rejected": 1})
        self.assertEqual(len(self._spooled(le.REJECTED_FILE)), 1)
        self.assertEqual(self._spooled(), [])

    def test_concurrent_producers_do_not_lose_spooled_events(self):
        env = dict(self.env, COMMAND_CENTER_URL=_dead_url())
        errors = []

        def produce(n):
            try:
                le.emit(83, LAUNCH, "stage-%d" % n, env=env)
            except Exception as exc:  # noqa: BLE001 - a leaked exception fails the test
                errors.append(exc)

        threads = [threading.Thread(target=produce, args=(n,)) for n in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        spooled = self._spooled()
        self.assertEqual(len(spooled), 12)
        self.assertEqual(len({e["event_id"] for e in spooled}), 12)


class LaunchCardTest(unittest.TestCase):
    """Skill 49 launch mode lands one board card per launch, fail-soft."""

    def _mc_board(self):
        spec = importlib.util.spec_from_file_location(
            "mc_board_under_test", _skill("49-signature-funnel") / "scripts/mc_board.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod  # dataclasses resolve their module by name
        spec.loader.exec_module(mod)
        return mod

    def test_card_opened_in_progress_and_idempotent(self):
        mb = self._mc_board()
        calls = []

        def fake(method, url, payload, cfg):
            calls.append((method, url, payload))
            if url.endswith("/api/tasks/ingest"):
                return 201, {"task_id": "T1"}
            return 200, {"status": "backlog"}

        mb._request = fake
        env = {"COMMAND_CENTER_URL": "https://cc.example.test"}
        with tempfile.TemporaryDirectory() as run:
            self.assertEqual(mb.launch_card(run, LAUNCH, offer_name="Elevation", env=env), "T1")
            ingest = [c for c in calls if c[1].endswith("/api/tasks/ingest")]
            self.assertEqual(len(ingest), 1)
            self.assertIn("Elevation", ingest[0][2]["title"])
            self.assertIn("in_progress", [c[2].get("status") for c in calls if c[2]])
            self.assertEqual(mb.launch_card(run, LAUNCH, env=env), "T1")  # reuse, no 2nd card
            self.assertEqual(len([c for c in calls if c[1].endswith("/api/tasks/ingest")]), 1)

    def test_card_never_raises_when_disabled_or_down(self):
        mb = self._mc_board()
        with tempfile.TemporaryDirectory() as run:
            self.assertIsNone(mb.launch_card(run, LAUNCH, env={}))
            self.assertIsNone(mb.launch_card(run, "", env={"COMMAND_CENTER_URL": "http://x"}))
            self.assertIsNone(mb.launch_card(run, LAUNCH, env={"COMMAND_CENTER_URL": _dead_url()}))


if __name__ == "__main__":
    unittest.main()
