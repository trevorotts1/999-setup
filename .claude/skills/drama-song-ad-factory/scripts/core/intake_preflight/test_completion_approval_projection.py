"""Read-only closure from actual decisions; a cache never creates an approval.

Uses the real intake, artifact handlers and Store writers. No
provider, actual media, client transport or source-run cache is produced.
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest

CORE = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(CORE), str(CORE / "intake_preflight")]
from intake_preflight import factory
import production_process as process
from test_factory_method_agnes import make_run
from test_production_process import write_json


def stamps(run):
    return {str(path.relative_to(run)): (path.stat().st_mtime_ns, path.read_bytes())
            for path in Path(run).rglob("*") if path.is_file()}


class CompletionApprovalProjection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="completion-approval-projection-")
        self.addCleanup(self.tmp.cleanup)
        self.run = make_run(Path(self.tmp.name), None, agnes="no")
        # An empty typed array is explicit non-delivery, never an approval.
        write_json(self.run / "delivery" / "receipts.json", [])

    def inspect(self):
        before = stamps(self.run)
        result = process.inspect_completion_approvals(self.run)
        self.assertEqual(stamps(self.run), before)
        return result

    def test_current_modern_and_verifiable_legacy_decisions_need_no_aggregate_cache(self):
        cache = self.run / "control" / "approvals.json"
        self.assertFalse(cache.exists())
        modern = self.inspect()
        self.assertTrue(modern["ok"], modern)
        self.assertEqual(modern["authority"], "intake-session")
        self.assertNotIn("production-go", modern["checks"])
        self.assertEqual(modern["checks"]["creative-strategy"]["proof_kind"],
                         "internal-stage-and-current-script-package")
        ledger = self.run / "control" / "intake-session.json"
        ledger.rename(ledger.with_name("retained-client-ledger.json"))
        legacy = self.inspect()
        self.assertTrue(legacy["ok"], legacy)
        self.assertEqual(legacy["authority"], "legacy-artifact-decisions")
        self.assertFalse(cache.exists())

    def test_approved_cache_cannot_replace_missing_actual_script_decisions_or_history(self):
        cache = {s: {"state": "approved"} for s in factory.CANONICAL_STAGES}
        write_json(self.run / "control" / "approvals.json", cache)
        approval = self.run / "creative" / "script-approval.json"
        approval.rename(approval.with_name("retained-script-approval.json"))
        result = self.inspect()
        self.assertFalse(result["ok"], result)
        self.assertEqual(result["reason_code"], "PRODUCTION_SCRIPT_APPROVAL_MISSING")
        bare = Path(self.tmp.name) / "bare-cache"
        write_json(bare / "control" / "approvals.json", cache)
        self.assertFalse(process.inspect_completion_approvals(bare)["ok"])

    def test_changed_artifacts_context_and_foreign_decisions_stay_refused(self):
        script = self.run / "creative" / "script.json"
        still = next((self.run / "storyboard").glob("s*.png"))
        record = self.run / "creative" / "script-approval.json"
        cases = ((script, "script"), (still, "still"),
                 (record, "context"), (record, "foreign"))
        for path, kind in cases:
            with self.subTest(kind=kind):
                original = path.read_bytes()
                try:
                    if kind == "still":
                        path.write_bytes(original + b" changed")
                    else:
                        doc = json.loads(original)
                        if kind == "script":
                            doc["story"][0][1].append("A changed ending")
                        else:
                            for event in doc["approvals"]:
                                if kind == "context":
                                    event.pop("source_ref", None)
                                else:
                                    event["run_id"] = "another-run"
                        write_json(path, doc)
                    refused = self.inspect()
                    self.assertFalse(refused["ok"], refused)
                finally:
                    path.write_bytes(original)

    def test_elected_song_choice_needs_its_actual_pick(self):
        from test_production_process import confirmed_run, approve_script
        from test_factory_method_agnes import complete_fixture_stage, storyboard_fixture
        run = Path(self.tmp.name) / "elected-song"
        confirmed_run(run, song=True)
        for stage in factory.CANONICAL_STAGES:
            if stage == "video-generation":
                storyboard_fixture(run, count=6, duration=120, approve=True)
            complete_fixture_stage(run, stage)
            if stage == "script-lyrics":
                approve_script(run)
        self.assertFalse((run / "song-choices" / "pick.json").exists())
        before = stamps(run)
        refused = process.inspect_completion_approvals(run)
        self.assertFalse(refused["ok"], refused)
        self.assertEqual(refused["reason_code"], "SONG_PICK_MISSING")
        self.assertEqual(stamps(run), before)

    def test_operator_risk_closure_is_read_only_and_normal_gate_keeps_cache_writer(self):
        from song_dispatch import song_dispatch as songs
        master = self.run / "music" / "picked-song.mp3"
        master.write_bytes(b"synthetic local risk-acceptance fixture")
        take = self.run / "music" / "takes" / "v1" / "take-1.mp3"
        take.parent.mkdir(parents=True)
        take.write_bytes(master.read_bytes())
        revision = process._script_proof(self.run, self.run.name)["approved_script"]["script_sha256"]
        binding = songs.take_binding(str(master), revision)
        results = {gate: {"verdict": "PASS", "binding": dict(binding)}
                   for gate in ("D1", "D2", "D3", "D4", "D5")}
        results["D5"]["verdict"] = "UNMEASURED"
        songs.record_acceptance(str(self.run), "v1", binding, results)
        digest = songs.sha256_evidence_records(
            {"v1": songs.measure_evidence_digest(str(self.run), "v1")})
        songs.record_operator_decision(str(self.run), {
            "decision": "ACCEPTED_RISK", "operator": "fixture-owner",
            "at_utc": "2026-10-24T12:00:00Z", "gates_not_proven": ["D5"],
            "measured_evidence_digest": digest,
            "reason": "D5 remains unmeasured; the fixture owner explicitly accepts that risk."})
        evidence = self.run / "music" / "acceptance" / "v1.json"
        original = evidence.read_bytes()
        cache = evidence.with_name("ww21-risk-acceptance.json")
        self.assertFalse(cache.exists())
        for cached in (False, True):
            with self.subTest(cache_present=cached):
                if cached:
                    before = stamps(self.run)
                    self.assertIsNone(factory._song_hold(self.run))
                    after = stamps(self.run)
                    self.assertEqual(set(after) - set(before), {str(cache.relative_to(self.run))})
                    self.assertTrue(all(after[name] == stamp for name, stamp in before.items()))
                    self.assertEqual(json.loads(cache.read_bytes())["schema_version"],
                                     "blackceo.ww21-risk-acceptance/v1")
                self.assertTrue(self.inspect()["ok"])
                self.assertEqual(cache.exists(), cached)
                for changed in ("stale", "missing"):
                    with self.subTest(evidence=changed):
                        try:
                            if changed == "stale":
                                record = json.loads(original)
                                record["results"]["D5"]["binding"]["creative_revision"] = "changed"
                                write_json(evidence, record)
                            else:
                                evidence.unlink()
                            refused = self.inspect()
                            self.assertFalse(refused["ok"], refused)
                            self.assertEqual(refused["reason_code"], "ACCEPTANCE_NOT_PROVEN")
                            self.assertEqual(cache.exists(), cached)
                        finally:
                            evidence.write_bytes(original)
        self.assertEqual(json.loads(evidence.read_bytes())["results"]["D5"]["verdict"],
                         "UNMEASURED")

    def test_existing_cache_can_only_veto_verified_proofs(self):
        self.assertTrue(self.inspect()["ok"])
        cache_path = self.run / "control" / "approvals.json"
        for cache in ({"script-lyrics": {"state": "pending"}},
                      {"storyboard": {"state": "revoked"}}, [],
                      {"creative-strategy": {"state": "approved", "plan_revision": 1}}):
            with self.subTest(cache=cache):
                write_json(self.run / "control" / "plan-revision.json", {"revision": 2})
                write_json(cache_path, cache)
                self.assertFalse(self.inspect()["ok"])

    def test_legal_completion_history_is_required(self):
        import state_store
        with state_store.Store(self.run / "control" / "state.sqlite3") as store:
            changed = store.con.execute("DELETE FROM events WHERE run_id=? AND stage=?",
                                        (self.run.name, "creative-strategy"))
            self.assertGreater(changed.rowcount, 0)
            store.con.commit()
        refused = self.inspect()
        self.assertFalse(refused["ok"])
        self.assertEqual(refused["reason_code"], "PRODUCTION_COMPLETION_HISTORY_UNVERIFIED")

    def test_final_qc_artifact_and_delivery_checks_remain_independent(self):
        import qc_gate
        record = {"schema_version": "1.0.0", "check_id": "completion-continuity-1",
                  "run_id": self.run.name, "stage": "final-qc", "check": "continuity",
                  "verdict": "PASS", "evidence": {"summary": "Current fixture continuity agrees."},
                  "checker_version": "1.0.0", "reviewer": {"identity": "qc-reviewer-1",
                  "session": "s1", "authority": "qc"}}
        verdict = qc_gate.evaluate(self.run.name, "final-qc", [record],
                                   {record["check_id"]: "different-build-worker"}, ["continuity"])
        self.assertEqual(verdict["gate"], "PASS", verdict)
        write_json(self.run / "final-qc" / "record.json",
                   {"gate": verdict["gate"], "producer": factory.STAGE_REGISTRY["final-qc"]["qc_producer"],
                    "evaluation": verdict})
        states = {s: "COMPLETE" for s in factory.CANONICAL_STAGES}
        before = stamps(self.run)
        evidence = factory._collect_completion_evidence(self.run, states)
        self.assertTrue(evidence["approvals_current"], evidence["approval_projection"])
        self.assertTrue(evidence["final_qc_independent_pass"])
        self.assertFalse(evidence["delivery_receipts_ok"])
        self.assertEqual(stamps(self.run), before)
        for receipts in ([{"destination": "origin", "status": "failed"}],
                         [{"destination": "origin", "status": "delivered"},
                          {"destination": "other", "status": "failed"}]):
            write_json(self.run / "delivery" / "receipts.json", receipts)
            evidence = factory._collect_completion_evidence(self.run, states)
            self.assertTrue(evidence["approvals_current"])
            self.assertFalse(evidence["delivery_receipts_ok"])
            self.assertFalse(factory._decide_completion(evidence)[0])
        write_json(self.run / "final-qc" / "record.json", {"gate": "FAIL", "producer": "same-build-worker"})
        evidence = factory._collect_completion_evidence(self.run, states)
        self.assertFalse(evidence["final_qc_independent_pass"])
        artifact = self.run / "assembly" / "timeline.json"
        artifact.rename(artifact.with_name("retained-timeline.json"))
        evidence = factory._collect_completion_evidence(self.run, states)
        self.assertFalse(evidence["artifacts_present"])
        self.assertIn("assembly/timeline.json", evidence["missing_artifacts"])
        self.assertFalse(factory._decide_completion(evidence)[0])


if __name__ == "__main__":
    unittest.main()
