"""Tests for installer-registration/bundle_adapter.py (T-37).

Run: python3 -I -B installer-registration/test_bundle_adapter.py

Every test builds its own fixture under a caller-chosen temp dir; the real
repo is only read (for the installer-parity tests). The negative controls are
deliberate: a mutated artefact MUST break the parity check, a record that
disagrees with the tree MUST fail, and an installer that stops delegating MUST
be named. A check that cannot fail proves nothing.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bundle_adapter as ba  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
SKILL = ".claude/skills/spec-protocol"


def _components(version="1.5.0"):
    return {
        "schema": ba.SCHEMA_COMPONENTS,
        "components": {"spec-protocol": [{"version": version,
                                          "repoPath": SKILL}]},
    }


def make_bundle(base, *, newline="\n", skill_text="# spec-protocol",
                with_record=True):
    """A minimal bundle: one registered skill, one VERSION, one SKILL.md."""
    root = Path(base) / "bundle"
    (root / "CONTROL").mkdir(parents=True)
    (root / "VERSION").write_text("1.38.1\n", encoding="utf-8")
    (root / "CONTROL/bundled-skills.txt").write_text(
        "# comment\nspec-protocol\n\n", encoding="utf-8")
    (root / "CONTROL/bundled-components.json").write_text(
        json.dumps(_components()), encoding="utf-8")
    skill = root / SKILL
    skill.mkdir(parents=True)
    body = "\n".join(skill_text.split("\n")) + "\n"
    (skill / "SKILL.md").write_bytes(body.replace("\n", newline).encode("utf-8"))
    (skill / "VERSION").write_text("1.5.0\n", encoding="utf-8")
    (skill / "skill-version.txt").write_text("1.5.0\n", encoding="utf-8")
    if with_record:
        ba.write_digest_record(ba.load_bundle(root))
    return root


class FixtureCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="t37-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)


class CanonicalisationTests(FixtureCase):
    def digest_of(self, **kwargs):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)), **kwargs)
        return ba.tree_digest(root / SKILL)[0]

    def test_stable_across_line_endings(self):
        lf = self.digest_of(newline="\n")
        crlf = self.digest_of(newline="\r\n")
        cr = self.digest_of(newline="\r")
        self.assertEqual(lf, crlf, "CRLF checkout must hash like the LF artefact")
        self.assertEqual(lf, cr, "lone-CR checkout must hash like the LF artefact")

    def test_stable_across_trailing_whitespace(self):
        plain = self.digest_of(skill_text="# spec-protocol\nbody line")
        spaced = self.digest_of(skill_text="# spec-protocol   \nbody line\t\t")
        self.assertEqual(plain, spaced,
                         "trailing SP/TAB must canonicalise away")

    def test_stable_across_file_creation_order(self):
        root_a = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        first = ba.tree_digest(root_a / SKILL)[0]
        # Delete and recreate the skill tree in the opposite order.
        shutil.rmtree(root_a / SKILL)
        skill = root_a / SKILL
        skill.mkdir(parents=True)
        (skill / "skill-version.txt").write_text("1.5.0\n", encoding="utf-8")
        (skill / "VERSION").write_text("1.5.0\n", encoding="utf-8")
        (skill / "SKILL.md").write_text("# spec-protocol\n", encoding="utf-8")
        self.assertEqual(first, ba.tree_digest(skill)[0],
                         "file creation order must not change the digest")

    def test_changed_content_changes_the_digest(self):
        one = self.digest_of(skill_text="# spec-protocol")
        two = self.digest_of(skill_text="# spec-protocol tampered")
        self.assertNotEqual(one, two)

    def test_missing_tree_is_stated_not_crashed(self):
        digest, entries, reason = ba.tree_digest(self.tmp / "nope")
        self.assertIsNone(digest)
        self.assertEqual(entries, [])
        self.assertIn("missing", reason)

    def test_binary_files_hash_raw(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        (root / SKILL / "icon.bin").write_bytes(b"\x00\x01\r\n\x02")
        first = ba.tree_digest(root / SKILL)[0]
        (root / SKILL / "icon.bin").write_bytes(b"\x00\x01\r\x02")
        self.assertNotEqual(first, ba.tree_digest(root / SKILL)[0],
                            "binary bytes must not be CRLF-folded")


class HashParityTests(FixtureCase):
    def test_recorded_digest_equals_built_digest(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        bundle = ba.load_bundle(root)
        skill = bundle.by_name("spec-protocol")
        self.assertEqual(skill.recorded_digest, skill.digest,
                         "recorded hash must equal the hash built from the tree")
        lines, rc = ba.run_checks(bundle)
        self.assertEqual(rc, 0, "\n".join(lines))

    def test_negative_control_mutated_artefact_breaks_parity(self):
        """A deliberately mutated artefact MUST break the parity check."""
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        (root / SKILL / "SKILL.md").write_text("# tampered payload\n",
                                               encoding="utf-8")
        (root / SKILL / "notes.md").write_text("planted\n", encoding="utf-8")
        lines, rc = ba.run_checks(ba.load_bundle(root))
        self.assertEqual(rc, 1, "mutated artefact must fail the check")
        self.assertTrue(any("FAIL hash-parity spec-protocol" in l for l in lines),
                        "the failure must name the skill:\n" + "\n".join(lines))

    def test_negative_control_mutated_record_breaks_parity(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        record = root / ba.DIGESTS_PATH
        data = json.loads(record.read_text(encoding="utf-8"))
        data["skills"]["spec-protocol"]["digest"] = "0" * 64
        record.write_text(json.dumps(data), encoding="utf-8")
        lines, rc = ba.run_checks(ba.load_bundle(root))
        self.assertEqual(rc, 1)
        self.assertTrue(any("recorded 0000" in l for l in lines))

    def test_missing_record_is_undetermined_never_a_pass(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)),
                           with_record=False)
        lines, rc = ba.run_checks(ba.load_bundle(root))
        self.assertEqual(rc, 2, "\n".join(lines))
        self.assertTrue(any("UNDETERMINED hash-parity" in l for l in lines))
        self.assertFalse(any("PASS hash-parity" in l for l in lines))

    def test_manifest_never_stamps_the_tree(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        (root / "CONTROL/bundled-components.json").write_text(
            json.dumps(_components(version="9.9.9")), encoding="utf-8")
        bundle = ba.load_bundle(root)
        decision = ba.plan_update(bundle, {})[0]
        self.assertEqual(decision.stamp, "1.5.0",
                         "the stamp is the tree's, never the manifest's")
        lines, rc = ba.run_checks(bundle)
        # Drift is its own, fatal exit code (RC_DRIFT), never the undetermined
        # code - a gate can then fail on drift while a genuinely-undetermined
        # case stays distinguishable from a pass.
        self.assertEqual(rc, ba.RC_DRIFT)
        self.assertNotEqual(rc, ba.RC_UNDETERMINED)
        self.assertTrue(any("DRIFT spec-protocol manifest=9.9.9" in l
                            for l in lines))


class UpdateDecisionTests(FixtureCase):
    def decision(self, root, installed):
        return next(d for d in
                    ba.plan_update(ba.load_bundle(root),
                                   {"spec-protocol": installed})
                    if d.skill == "spec-protocol")

    def test_content_change_with_same_version_is_not_current(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        self.assertEqual(self.decision(root, "1.5.0").action, "current")
        (root / SKILL / "SKILL.md").write_text("# tampered payload\n",
                                               encoding="utf-8")
        after = self.decision(root, "1.5.0")
        self.assertNotEqual(after.action, "current",
                            "tampering must not read as 'current'")
        self.assertEqual(after.action, "update")
        self.assertIn("content", after.reason)
        self.assertTrue(after.digest and after.digest != after.recorded_digest)

    def test_missing_record_is_never_current(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)),
                           with_record=False)
        self.assertNotEqual(self.decision(root, "1.5.0").action, "current")

    def test_corrupt_installed_stamp_is_refused(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        for bad in ("not-a-version", "   ", "v", "1.5.0-rc1"):
            decision = self.decision(root, bad)
            self.assertEqual(decision.action, "undetermined", bad)
            self.assertIsNone(decision.stamp, bad)

    def test_downgrade_is_refused_by_name(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        decision = self.decision(root, "9.9.9")
        self.assertEqual(decision.action, "refuse_downgrade")
        self.assertIn("installed=9.9.9", decision.reason)
        self.assertIn("shipped=1.5.0", decision.reason)

    def test_unreadable_version_is_undetermined_not_a_traceback(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        (root / SKILL / "VERSION").unlink()
        (root / SKILL / "skill-version.txt").unlink()
        decision = self.decision(root, "1.5.0")
        self.assertEqual(decision.action, "undetermined")
        self.assertIn("no VERSION", decision.reason)

    def test_provision_refuses_registered_name_without_tree(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        shutil.rmtree(root / SKILL)
        with self.assertRaises(ba.UnpermittedResource) as caught:
            ba.plan_provision(ba.load_bundle(root),
                              [ba.ProvisionRequest("spec-protocol")])
        self.assertIn("no SKILL.md", caught.exception.reason)

    def test_provision_refuses_changed_content(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        (root / SKILL / "SKILL.md").write_text("# tampered\n", encoding="utf-8")
        with self.assertRaises(ba.UnpermittedResource):
            ba.plan_provision(ba.load_bundle(root),
                              [ba.ProvisionRequest("spec-protocol")])


class InstallPlanTests(FixtureCase):
    def test_plan_is_deterministic_and_ordered(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        bundle = ba.load_bundle(root)
        home = self.tmp / "home"
        first = ba.format_plan(ba.install_plan(bundle, self.tmp / "root-a", home))
        second = ba.format_plan(ba.install_plan(bundle, self.tmp / "root-a", home))
        self.assertEqual(first, second, "the plan must be byte-identical twice")

    def test_plan_actions(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        claude_root = self.tmp / "claude"
        home = self.tmp / "home"
        bundle = ba.load_bundle(root)
        self.assertEqual(
            ba.install_plan(bundle, claude_root, home)[0][0], "link")
        target = claude_root / "skills" / "spec-protocol"
        target.parent.mkdir(parents=True)
        os.symlink(str(root / SKILL), str(target))
        self.assertEqual(
            ba.install_plan(bundle, claude_root, home)[0][0], "up-to-date")
        target.unlink()
        target.mkdir()
        self.assertEqual(
            ba.install_plan(bundle, claude_root, home)[0][0], "backup-and-link")
        shutil.rmtree(root / SKILL)
        self.assertEqual(
            ba.install_plan(ba.load_bundle(root), claude_root, home)[0][0],
            "missing")


class InstallerParityTests(FixtureCase):
    def test_both_installers_delegate_to_the_adapter(self):
        problems = ba.installer_parity_problems(REPO)
        self.assertEqual(problems, [], "\n".join(problems))

    def test_negative_control_installer_that_stops_delegating_is_named(self):
        """Strip the delegation from a copy of one installer: MUST be named."""
        root = self.tmp / "repo"
        for rel in (ba.INSTALLER_MAC, ba.INSTALLER_WIN):
            source = REPO / rel
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source.read_text(encoding="utf-8"),
                              encoding="utf-8")
        win = root / ba.INSTALLER_WIN
        win.write_text(win.read_text(encoding="utf-8").replace(
            "--install-plan", "--something-else"), encoding="utf-8")
        problems = ba.installer_parity_problems(root)
        self.assertTrue(any(ba.INSTALLER_WIN in p and "--install-plan" in p
                            for p in problems),
                        "the stripped installer must be named: %r" % (problems,))

    def test_negative_control_missing_installer_is_named(self):
        root = self.tmp / "repo"
        target = root / ba.INSTALLER_MAC
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text((REPO / ba.INSTALLER_MAC).read_text(encoding="utf-8"),
                          encoding="utf-8")
        problems = ba.installer_parity_problems(root)
        self.assertTrue(any("installer missing" in p for p in problems))


class ExitCodeTests(FixtureCase):
    """D3: a gate must be able to fail on drift, and tell unknown from pass."""

    def test_clean_tree_is_a_pass(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        lines, rc = ba.run_checks(ba.load_bundle(root))
        self.assertEqual(rc, ba.RC_PASS, "\n".join(lines))

    def test_undetermined_is_distinct_from_pass_and_from_drift(self):
        no_record = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)),
                                with_record=False)
        _, rc_undet = ba.run_checks(ba.load_bundle(no_record))
        self.assertEqual(rc_undet, ba.RC_UNDETERMINED)
        self.assertNotEqual(rc_undet, ba.RC_PASS)

        drift = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        (drift / "CONTROL/bundled-components.json").write_text(
            json.dumps(_components(version="9.9.9")), encoding="utf-8")
        _, rc_drift = ba.run_checks(ba.load_bundle(drift))
        self.assertEqual(rc_drift, ba.RC_DRIFT)
        self.assertNotEqual(rc_drift, rc_undet,
                            "drift and undetermined must not share a code")

    def test_drift_is_never_masked_by_an_unrelated_undetermined(self):
        # A missing record (undetermined) AND manifest drift together must still
        # surface as drift, so a real drift can never be hidden by an unknown.
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        (root / "CONTROL/bundled-components.json").write_text(
            json.dumps(_components(version="9.9.9")), encoding="utf-8")
        (root / ba.DIGESTS_PATH).unlink()
        lines, rc = ba.run_checks(ba.load_bundle(root))
        self.assertEqual(rc, ba.RC_DRIFT, "\n".join(lines))


class InstallerParityReportingTests(FixtureCase):
    """D4: the no-installers case must not claim the installers agree."""

    def test_no_installers_is_never_reported_as_agreement(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        lines, rc = ba.run_checks(ba.load_bundle(root))
        self.assertFalse(any("PASS installer-parity" in l for l in lines),
                         "no installers must not report agreement:\n"
                         + "\n".join(lines))
        self.assertTrue(any("SKIP installer-parity" in l and
                            "NOT the claim" in l for l in lines),
                        "the no-installers case must say what it is:\n"
                        + "\n".join(lines))

    def test_present_and_delegating_installers_do_agree(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        for rel in (ba.INSTALLER_MAC, ba.INSTALLER_WIN):
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text((REPO / rel).read_text(encoding="utf-8"),
                              encoding="utf-8")
        (root / "installer-registration").mkdir()
        (root / "installer-registration/bundle_adapter.py").write_text(
            (REPO / "installer-registration/bundle_adapter.py").read_text(
                encoding="utf-8"), encoding="utf-8")
        lines, rc = ba.run_checks(ba.load_bundle(root))
        self.assertTrue(any("PASS installer-parity" in l for l in lines),
                        "\n".join(lines))


class HostInvocationTests(FixtureCase):
    """D1: per-host claims that evidence can move, not a blanket constant."""

    def _copied_root(self):
        root = make_bundle(Path(tempfile.mkdtemp(dir=self.tmp)))
        for rel in (ba.INSTALLER_MAC, ba.INSTALLER_WIN):
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text((REPO / rel).read_text(encoding="utf-8"),
                              encoding="utf-8")
        (root / "installer-registration").mkdir()
        (root / "installer-registration/bundle_adapter.py").write_text(
            (REPO / "installer-registration/bundle_adapter.py").read_text(
                encoding="utf-8"), encoding="utf-8")
        return root

    def test_macos_claim_is_computed_not_a_blanket_unverified(self):
        results = ba.verify_host_invocation(self._copied_root())
        by_name = {name: (status, detail) for status, name, detail in results}
        self.assertEqual(len(results), 5, "one claim per supported host")
        self.assertEqual(by_name["mac-live-install"][0], "VERIFIED",
                         "the real adapter invocation must clear the claim:\n"
                         + repr(by_name["mac-live-install"]))
        # The remaining hosts are per-host and name the probe that clears them.
        for name in ("windows-live-install", "vps-runtime", "docker-runtime",
                     "live-tenant-provision"):
            self.assertEqual(by_name[name][0], "UNVERIFIED", name)
            self.assertIn("probe:", by_name[name][1])

    def test_macos_probe_moves_when_the_installer_stops_delegating(self):
        root = self._copied_root()
        mac = root / ba.INSTALLER_MAC
        good = ba.verify_host_invocation(root)
        self.assertEqual({n: s for s, n, _ in good}["mac-live-install"],
                         "VERIFIED")
        # Break the delegation: the claim MUST flip to a named failure.
        mac.write_text(mac.read_text(encoding="utf-8").replace(
            "--install-plan", "--something-else"), encoding="utf-8")
        broken = {n: (s, d) for s, n, d in ba.verify_host_invocation(root)}
        self.assertEqual(broken["mac-live-install"][0], "FAIL",
                         "a broken installer must clear VERIFIED:\n"
                         + repr(broken["mac-live-install"]))


class WorkflowTriggerTests(FixtureCase):
    """D2: CI must trigger on the inputs the digest check reads."""

    def test_ci_triggers_on_control_and_skills(self):
        wf = (REPO / ".github/workflows/helper-pin-guard.yml").read_text(
            encoding="utf-8")
        self.assertGreaterEqual(wf.count("- 'CONTROL/**'"), 2,
                                "CONTROL/** must be in push.paths and "
                                "pull_request.paths")
        self.assertGreaterEqual(wf.count("- '.claude/skills/**'"), 2,
                                ".claude/skills/** must be in push.paths and "
                                "pull_request.paths")


if __name__ == "__main__":
    unittest.main(verbosity=2)
