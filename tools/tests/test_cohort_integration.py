#!/usr/bin/env python3
"""Tests for tools/cohort_integration.py (PBB-125 / T-44).

Each acceptance clause gets a positive test AND a refusal test, because a gate
that cannot refuse proves nothing. Anti-vacuity: every refusal test starts from
the same ACCEPTing plan and mutates exactly one clause.

Run: python3 -m unittest discover -s tools/tests -p 'test_cohort_integration.py' -v
"""

import copy
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)

import cohort_integration as ci  # noqa: E402

SHA_A = "a" * 40
SHA_B = "b" * 40
SHA_C = "c" * 40
SHA_D = "d" * 40
SHA_E = "e" * 40
SHA_F = "f" * 40
LEASE_SHA = "7" * 40
TREE_SHA = "8" * 40
D1 = "sha256:" + "1" * 64
D2 = "sha256:" + "2" * 64
OBSERVED = "2026-10-24T07:25:00Z"
REPO = "trevorotts1/999-setup"


def good_plan():
    return {
        "repo": "999",
        "canonical_remote": "trevorotts1/999-setup",
        "target_branch": "main",
        "force_push_or_deletion": False,
        "target_owner": {
            "holder": "deepseek-chain",
            "generation": 4,
            "lease_ref": "refs/heads/lease/999/main",
            "observed_holder": "deepseek-chain",
            "observed_generation": 4,
            "ttl_seconds": 3600,
            "expired": False,
        },
        "base_sha_before": SHA_A,
        "cohort_head_sha": SHA_B,
        "target_sha_after": SHA_C,
        "target_sha_source": "remote",
        "merge_method": "merge",
        "proof_method": "ancestry",
        "publication_order_edges": ["onboarding->999"],
        "candidates": [
            {
                "task_id": "UNIT-A",
                "head_sha": SHA_D,
                "content_digest": D1,
                "distribution_order": 1,
                "files": ["tools/cohort_integration.py"],
                "compatibility_case": "BC-01",
                "depends_on": [],
            },
            {
                "task_id": "UNIT-B",
                "head_sha": SHA_E,
                "content_digest": D2,
                "distribution_order": 2,
                "files": ["tools/tests/test_cohort_integration.py"],
                "compatibility_case": "BC-01",
                "depends_on": ["UNIT-A"],
            },
        ],
        "check_surface": {
            "source": "remote-api-read",
            "observed_at": OBSERVED,
            "protection_observed": False,
            "required_contexts": [],
        },
        "check_receipts": [],
        "repairs": [],
    }


def good_repair():
    return {
        "repair_id": "R-1",
        "commit_sha": "f" * 40,
        "content_digest": D1,
        "remote_read": {
            "source": "remote",
            "observed_at": OBSERVED,
            "sha": "f" * 40,
            "content_digest": D1,
            "contained_in": SHA_C,
        },
    }


def codes(result):
    return {r["code"] for r in result["refusals"]}


class FakeRemote:
    """Test double for the read-only remote. Unknown paths are 404, like GitHub."""

    def __init__(self, responses):
        self.responses = responses

    def get(self, path):
        value = self.responses.get(path)
        if value is None:
            return 404, None
        if isinstance(value, Exception):
            raise value
        return value


def remote_responses():
    return {
        "repos/%s/git/ref/heads/main" % REPO: (200, {"object": {"sha": SHA_C}}),
        "repos/%s/git/heads/lease/999/main" % REPO: (200, {"object": {"sha": LEASE_SHA}}),
        "repos/%s/branches/main/protection" % REPO: (404, None),
        "repos/%s/rulesets" % REPO: (200, []),
        "repos/%s/commits/%s/check-runs?per_page=100" % (REPO, SHA_B):
            (200, {"check_runs": []}),
        "repos/%s/git/commits/%s" % (REPO, SHA_F):
            (200, {"sha": SHA_F, "tree": {"sha": TREE_SHA}}),
        "repos/%s/compare/%s...%s" % (REPO, SHA_F, SHA_C): (200, {"status": "ahead"}),
    }


def remote_plan():
    plan = good_plan()
    plan["target_owner"]["observed_lease_sha"] = LEASE_SHA
    repair = good_repair()
    repair["remote_read"]["tree_sha"] = TREE_SHA
    plan["repairs"] = [repair]
    return plan


def with_required_gate(responses):
    responses["repos/%s/rulesets" % REPO] = (200, [
        {"id": 5, "target": "BRANCH", "enforcement": "ACTIVE"}])
    responses["repos/%s/rulesets/5" % REPO] = (200, {"rules": [
        {"type": "required_status_checks",
         "parameters": {"required_status_checks": [{"context": "999-cohort-gate"}]}},
    ]})
    return responses


class Base(unittest.TestCase):
    def assertRefuses(self, plan, code):
        result = ci.evaluate(plan)
        self.assertEqual(result["verdict"], "REFUSE", result)
        self.assertIn(code, codes(result), result["refusals"])
        return result


class TargetIdentityTests(Base):
    def test_accepts_compatible_cohort(self):
        result = ci.evaluate(good_plan())
        self.assertEqual(result["verdict"], "ACCEPT", result["refusals"])
        self.assertEqual(result["order"], ["UNIT-A", "UNIT-B"])
        self.assertEqual(result["target_owner"], "deepseek-chain@4")

    def test_refuses_wrong_repo_remote_branch(self):
        cases = [
            ("repo", "onboarding", "plan.repo_not_999"),
            ("canonical_remote", "trevorotts1/other", "plan.remote_mismatch"),
            ("target_branch", "develop", "plan.target_not_main"),
            ("force_push_or_deletion", True, "target.force_or_deletion"),
            ("force_push_or_deletion", None, "target.force_or_deletion"),
        ]
        for field, value, code in cases:
            plan = good_plan()
            plan[field] = value
            with self.subTest(field=field, value=value):
                self.assertRefuses(plan, code)


class OwnerTests(Base):
    def test_missing_owner(self):
        plan = good_plan()
        del plan["target_owner"]
        self.assertRefuses(plan, "owner.missing")

    def test_not_holder(self):
        plan = good_plan()
        plan["target_owner"]["observed_holder"] = "opus-chain"
        self.assertRefuses(plan, "owner.not_holder")

    def test_generation_mismatch(self):
        plan = good_plan()
        plan["target_owner"]["observed_generation"] = 3
        self.assertRefuses(plan, "owner.generation_mismatch")

    def test_expired_is_not_takeover_right(self):
        plan = good_plan()
        plan["target_owner"]["expired"] = True
        self.assertRefuses(plan, "owner.expired_requires_fence")

    def test_invalid_ttl(self):
        plan = good_plan()
        plan["target_owner"]["ttl_seconds"] = 0
        self.assertRefuses(plan, "owner.invalid_ttl")

    def test_single_shared_owner(self):
        plan = good_plan()
        plan["additional_owners"] = ["opus-chain"]
        self.assertRefuses(plan, "owner.multiple")

    def test_candidate_must_name_the_holder(self):
        plan = good_plan()
        plan["candidates"][0]["target_owner"] = "opus-chain"
        self.assertRefuses(plan, "owner.candidate_mismatch")


class CohortTests(Base):
    def test_empty_cohort(self):
        plan = good_plan()
        plan["candidates"] = []
        self.assertRefuses(plan, "cohort.empty")

    def test_unknown_compatibility_case(self):
        plan = good_plan()
        plan["candidates"][0]["compatibility_case"] = "BC-09"
        self.assertRefuses(plan, "cohort.unknown_compatibility_case")

    def test_malformed_digest(self):
        plan = good_plan()
        plan["candidates"][0]["content_digest"] = "sha256:short"
        self.assertRefuses(plan, "candidate.digest_malformed")

    def test_duplicate_identity(self):
        plan = good_plan()
        plan["candidates"][1]["head_sha"] = SHA_D
        self.assertRefuses(plan, "cohort.duplicate_identity")

    def test_shared_file_collision_refused(self):
        plan = good_plan()
        plan["candidates"][1]["files"] = ["CHANGELOG.md"]
        plan["candidates"][0]["files"] = ["CHANGELOG.md"]
        self.assertRefuses(plan, "cohort.shared_file_collision")

    def test_shared_file_with_one_combined_candidate_accepted(self):
        plan = good_plan()
        plan["candidates"][0]["files"] = ["CHANGELOG.md"]
        plan["candidates"][0]["combined_members"] = ["UNIT-B"]
        plan["candidates"][1]["files"] = ["CHANGELOG.md"]
        result = ci.evaluate(plan)
        self.assertEqual(result["verdict"], "ACCEPT", result["refusals"])

    def test_two_competing_combined_candidates_refused(self):
        plan = good_plan()
        for cand, other in zip(plan["candidates"], reversed(plan["candidates"])):
            cand["files"] = ["CHANGELOG.md"]
            cand["combined_members"] = [other["task_id"]]
        self.assertRefuses(plan, "cohort.multiple_combined_owners")

    def test_vendored_tree_shared_class_is_s6(self):
        self.assertEqual(
            ci.shared_file_class(".claude/skills/conversational-ai-system/PACK.md"), "S6")
        self.assertEqual(ci.shared_file_class("VERSION"), "S7")
        self.assertIsNone(ci.shared_file_class("tools/cohort_integration.py"))


class OrderAndDependencyTests(Base):
    def test_duplicate_distribution_order(self):
        plan = good_plan()
        plan["candidates"][1]["distribution_order"] = 1
        self.assertRefuses(plan, "order.duplicate")

    def test_dependency_must_be_ordered_first(self):
        plan = good_plan()
        plan["candidates"][0]["depends_on"] = ["UNIT-B"]
        self.assertRefuses(plan, "cohort.dependency_unordered")

    def test_dependency_may_be_already_merged(self):
        plan = good_plan()
        plan["candidates"][0]["depends_on"] = ["T-02"]
        plan["merged_upstream"] = ["T-02"]
        result = ci.evaluate(plan)
        self.assertEqual(result["verdict"], "ACCEPT", result["refusals"])

    def test_dependency_missing(self):
        plan = good_plan()
        plan["candidates"][0]["depends_on"] = ["T-02"]
        self.assertRefuses(plan, "cohort.dependency_missing")

    def test_vendored_tree_requires_publication_edge(self):
        plan = good_plan()
        plan["candidates"][0]["files"] = [
            ".claude/skills/conversational-ai-system/SKILL.md"]
        plan["candidates"][0]["parity_basis"] = "pack-classification"
        plan["publication_order_edges"] = []
        self.assertRefuses(plan, "order.edge_missing")

    def test_vendored_tree_rejects_whole_tree_parity(self):
        plan = good_plan()
        plan["candidates"][0]["files"] = [
            ".claude/skills/conversational-ai-system/SKILL.md"]
        plan["candidates"][0]["parity_basis"] = "whole-tree"
        self.assertRefuses(plan, "hash.parity_whole_tree")

    def test_declared_order_digest_must_match(self):
        plan = good_plan()
        plan["order_digest"] = "sha256:" + "0" * 64
        self.assertRefuses(plan, "order.digest_mismatch")

    def test_declared_hash_order_must_match(self):
        plan = good_plan()
        plan["hash_order"] = [D2, D1]
        self.assertRefuses(plan, "order.hash_order_mismatch")

    def test_order_digest_is_deterministic_and_declarable(self):
        first = ci.evaluate(good_plan())
        second = ci.evaluate(good_plan())
        self.assertEqual(first["order_digest"], second["order_digest"])
        plan = good_plan()
        plan["order_digest"] = first["order_digest"]
        plan["hash_order"] = [D1, D2]
        self.assertEqual(ci.evaluate(plan)["verdict"], "ACCEPT")

    def test_unknown_publication_edge(self):
        plan = good_plan()
        plan["publication_order_edges"] = ["999->onboarding"]
        self.assertRefuses(plan, "order.edge_unknown")


class RequiredCheckTests(Base):
    def test_surface_must_be_a_remote_read(self):
        plan = good_plan()
        plan["check_surface"]["source"] = "recalled"
        self.assertRefuses(plan, "checks.surface_unproven")

    def test_surface_missing(self):
        plan = good_plan()
        del plan["check_surface"]
        self.assertRefuses(plan, "checks.surface_unproven")

    def test_protected_with_zero_contexts_enforces_nothing(self):
        plan = good_plan()
        plan["check_surface"]["protection_observed"] = True
        self.assertRefuses(plan, "checks.empty_with_protection")

    def test_unprotected_zero_contexts_is_a_proven_surface(self):
        result = ci.evaluate(good_plan())
        self.assertEqual(result["verdict"], "ACCEPT")
        self.assertEqual(result["required_contexts"], [])

    def test_required_context_missing(self):
        plan = good_plan()
        plan["check_surface"]["required_contexts"] = ["999-cohort-gate"]
        self.assertRefuses(plan, "checks.missing")

    def test_stale_head_receipt(self):
        plan = good_plan()
        plan["check_surface"]["required_contexts"] = ["999-cohort-gate"]
        plan["check_receipts"] = [{
            "context": "999-cohort-gate", "head_sha": SHA_D,
            "conclusion": "success", "run_id": 7,
        }]
        self.assertRefuses(plan, "checks.head_stale")

    def test_skipped_is_not_success(self):
        plan = good_plan()
        plan["check_surface"]["required_contexts"] = ["999-cohort-gate"]
        plan["check_receipts"] = [{
            "context": "999-cohort-gate", "head_sha": SHA_B,
            "conclusion": "skipped", "run_id": 8,
        }]
        self.assertRefuses(plan, "checks.not_success")

    def test_latest_run_governs_not_any_older_success(self):
        plan = good_plan()
        plan["check_surface"]["required_contexts"] = ["999-cohort-gate"]
        plan["check_receipts"] = [
            {"context": "999-cohort-gate", "head_sha": SHA_B,
             "conclusion": "success", "run_id": 1},
            {"context": "999-cohort-gate", "head_sha": SHA_B,
             "conclusion": "failure", "run_id": 2},
        ]
        self.assertRefuses(plan, "checks.not_success")

    def test_success_on_the_cohort_head(self):
        plan = good_plan()
        plan["check_surface"]["required_contexts"] = ["999-cohort-gate"]
        plan["check_receipts"] = [{
            "context": "999-cohort-gate", "head_sha": SHA_B,
            "conclusion": "success", "run_id": 9,
        }]
        self.assertEqual(ci.evaluate(plan)["verdict"], "ACCEPT")
        plan["cohort_head_sha"] = "9" * 40
        self.assertRefuses(plan, "checks.head_stale")

    def test_missing_cohort_head(self):
        plan = good_plan()
        del plan["cohort_head_sha"]
        self.assertRefuses(plan, "checks.no_head")


class TargetProofTests(Base):
    def test_target_must_be_read_back_from_remote(self):
        plan = good_plan()
        plan["target_sha_source"] = "local-merge"
        self.assertRefuses(plan, "target.remote_proof_missing")

    def test_squash_cannot_claim_ancestry(self):
        plan = good_plan()
        plan["merge_method"] = "squash"
        self.assertRefuses(plan, "proof.method_mismatch")

    def test_merge_must_use_ancestry(self):
        plan = good_plan()
        plan["proof_method"] = "content_equivalence"
        self.assertRefuses(plan, "proof.method_mismatch")

    def test_squash_with_content_equivalence(self):
        plan = good_plan()
        plan["merge_method"] = "squash"
        plan["proof_method"] = "content_equivalence"
        self.assertEqual(ci.evaluate(plan)["verdict"], "ACCEPT")


class NamedRepairTests(Base):
    def test_named_repair_with_remote_content_proof(self):
        plan = good_plan()
        plan["repairs"] = [good_repair()]
        result = ci.evaluate(plan)
        self.assertEqual(result["verdict"], "ACCEPT", result["refusals"])
        self.assertEqual(result["repairs_proven"], ["R-1"])

    def test_baseline_proof_does_not_cover_repair(self):
        plan = good_plan()
        plan["baseline_commit"] = "f" * 40
        plan["repairs"] = [good_repair()]
        self.assertRefuses(plan, "repair.baseline_only")

    def test_repair_needs_its_own_remote_read(self):
        plan = good_plan()
        repair = good_repair()
        del repair["remote_read"]
        plan["repairs"] = [repair]
        self.assertRefuses(plan, "repair.remote_proof_missing")

    def test_local_ancestry_is_not_remote_proof(self):
        plan = good_plan()
        repair = good_repair()
        repair["remote_read"]["source"] = "git-ancestry"
        plan["repairs"] = [repair]
        self.assertRefuses(plan, "repair.remote_proof_not_remote")

    def test_repair_sha_must_match_remote(self):
        plan = good_plan()
        repair = good_repair()
        repair["remote_read"]["sha"] = "e" * 40
        plan["repairs"] = [repair]
        self.assertRefuses(plan, "repair.sha_mismatch")

    def test_repair_content_digest_must_match_remote(self):
        plan = good_plan()
        repair = good_repair()
        repair["remote_read"]["content_digest"] = D2
        plan["repairs"] = [repair]
        self.assertRefuses(plan, "repair.content_mismatch")

    def test_repair_must_be_contained_in_the_read_back_target(self):
        plan = good_plan()
        repair = good_repair()
        repair["remote_read"]["contained_in"] = SHA_D
        plan["repairs"] = [repair]
        self.assertRefuses(plan, "repair.not_contained")

    def test_duplicate_repair(self):
        plan = good_plan()
        plan["repairs"] = [good_repair(), good_repair()]
        self.assertRefuses(plan, "repair.duplicate")


class RemoteVerificationTests(Base):
    def test_remote_accepts_observed_plan(self):
        result = ci.evaluate(remote_plan(), FakeRemote(remote_responses()))
        self.assertEqual(result["verdict"], "ACCEPT", result["refusals"])
        self.assertEqual(result["remote_verification"], "read-only-remote-api")

    def test_plan_only_evaluation_says_remote_not_run(self):
        result = ci.evaluate(remote_plan())
        self.assertEqual(result["verdict"], "ACCEPT", result["refusals"])
        self.assertEqual(result["remote_verification"], "not-run")

    def test_remote_target_sha_mismatch(self):
        plan = remote_plan()
        plan["target_sha_after"] = SHA_D
        result = ci.evaluate(plan, FakeRemote(remote_responses()))
        self.assertIn("remote.target_sha_mismatch", codes(result))

    def test_remote_lease_missing(self):
        responses = remote_responses()
        del responses["repos/%s/git/heads/lease/999/main" % REPO]
        result = ci.evaluate(remote_plan(), FakeRemote(responses))
        self.assertIn("remote.lease_unreadable", codes(result))

    def test_remote_lease_sha_mismatch(self):
        plan = remote_plan()
        plan["target_owner"]["observed_lease_sha"] = "6" * 40
        result = ci.evaluate(plan, FakeRemote(remote_responses()))
        self.assertIn("remote.lease_sha_mismatch", codes(result))

    def test_remote_protection_mismatch(self):
        plan = remote_plan()
        plan["check_surface"]["protection_observed"] = True
        result = ci.evaluate(plan, FakeRemote(remote_responses()))
        self.assertIn("remote.protection_mismatch", codes(result))

    def test_remote_required_context_mismatch(self):
        result = ci.evaluate(remote_plan(), FakeRemote(with_required_gate(remote_responses())))
        self.assertIn("remote.check_surface_mismatch", codes(result))

    def test_remote_check_not_success(self):
        plan = remote_plan()
        plan["check_surface"]["required_contexts"] = ["999-cohort-gate"]
        plan["check_receipts"] = [{
            "context": "999-cohort-gate", "head_sha": SHA_B,
            "conclusion": "success", "run_id": 11,
        }]
        responses = with_required_gate(remote_responses())
        responses["repos/%s/commits/%s/check-runs?per_page=100" % (REPO, SHA_B)] = (
            200, {"check_runs": [{"name": "999-cohort-gate", "conclusion": "skipped", "id": 2}]})
        result = ci.evaluate(plan, FakeRemote(responses))
        self.assertIn("remote.check_not_success", codes(result))

    def test_remote_latest_check_run_governs(self):
        plan = remote_plan()
        plan["check_surface"]["required_contexts"] = ["999-cohort-gate"]
        plan["check_receipts"] = [{
            "context": "999-cohort-gate", "head_sha": SHA_B,
            "conclusion": "success", "run_id": 12,
        }]
        responses = with_required_gate(remote_responses())
        responses["repos/%s/commits/%s/check-runs?per_page=100" % (REPO, SHA_B)] = (
            200, {"check_runs": [
                {"name": "999-cohort-gate", "conclusion": "success", "id": 1},
                {"name": "999-cohort-gate", "conclusion": "failure", "id": 2},
            ]})
        result = ci.evaluate(plan, FakeRemote(responses))
        self.assertIn("remote.check_not_success", codes(result))

    def test_remote_repair_content_mismatch(self):
        plan = remote_plan()
        plan["repairs"][0]["remote_read"]["tree_sha"] = "5" * 40
        result = ci.evaluate(plan, FakeRemote(remote_responses()))
        self.assertIn("remote.repair_content_mismatch", codes(result))

    def test_remote_repair_not_contained(self):
        responses = remote_responses()
        responses["repos/%s/compare/%s...%s" % (REPO, SHA_F, SHA_C)] = (
            200, {"status": "diverged"})
        result = ci.evaluate(remote_plan(), FakeRemote(responses))
        self.assertIn("remote.repair_not_contained", codes(result))

    def test_remote_unreadable_fails_closed(self):
        responses = remote_responses()
        responses["repos/%s/git/ref/heads/main" % REPO] = ci.RemoteError("token rejected")
        result = ci.evaluate(remote_plan(), FakeRemote(responses))
        self.assertIn("remote.target_unreadable", codes(result))


class GhRemoteAdapterTests(Base):
    def _remote(self, returncode, stdout="", stderr=""):
        calls = []

        def run(cmd, **kwargs):
            calls.append((cmd, kwargs))
            return type("Proc", (), {
                "returncode": returncode, "stdout": stdout, "stderr": stderr})()

        return ci.GhRemote(REPO, run=run), calls

    def test_parses_200_json(self):
        remote, calls = self._remote(0, stdout='{"object": {"sha": "%s"}}' % SHA_C)
        self.assertEqual(remote.get("repos/x/git/ref/heads/main"),
                         (200, {"object": {"sha": SHA_C}}))
        self.assertEqual(calls[0][0][:3], ["gh", "api", "repos/x/git/ref/heads/main"])

    def test_404_is_absence(self):
        remote, _ = self._remote(1, stderr="gh: Not Found (HTTP 404)")
        self.assertEqual(remote.get("repos/x/branches/main/protection"), (404, None))

    def test_403_fails_closed(self):
        remote, _ = self._remote(1, stderr="gh: Forbidden (HTTP 403)")
        with self.assertRaises(ci.RemoteError):
            remote.get("repos/x/rulesets")

    def test_missing_gh_fails_closed(self):
        def run(cmd, **kwargs):
            raise FileNotFoundError("gh")
        remote = ci.GhRemote(REPO, run=run)
        with self.assertRaises(ci.RemoteError):
            remote.get("repos/x/rulesets")


class CliTests(Base):
    def _run(self, argv):
        buffer = io.StringIO()
        with redirect_stdout(buffer), redirect_stderr(io.StringIO()):
            code = ci.main(argv)
        return code, buffer.getvalue()

    def test_cli_accept_and_refuse_exit_codes(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(good_plan(), handle)
            code, out = self._run([path])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out)["verdict"], "ACCEPT")

            bad = good_plan()
            bad["repo"] = "onboarding"
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(bad, handle)
            code, out = self._run([path])
            self.assertEqual(code, 1)
            self.assertEqual(json.loads(out)["verdict"], "REFUSE")
        finally:
            os.unlink(path)

    def test_cli_usage_and_bad_json_exit_2(self):
        code, _ = self._run([])
        self.assertEqual(code, 2)
        fd, path = tempfile.mkstemp(suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write("{not json")
            code, out = self._run([path])
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(out)["verdict"], "ERROR")
        finally:
            os.unlink(path)

    def test_evaluator_never_mutates_the_plan(self):
        plan = good_plan()
        plan["repairs"] = [good_repair()]
        snapshot = copy.deepcopy(plan)
        ci.evaluate(plan)
        self.assertEqual(plan, snapshot)


if __name__ == "__main__":
    unittest.main()
