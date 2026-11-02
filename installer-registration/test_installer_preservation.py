"""P15/XR-1: the install plan and the REAL installer consumers must preserve an
existing installation that decide() refuses or holds.

Run: python3 -I -B installer-registration/test_installer_preservation.py

Why this file exists. decide() refused a downgrade, but install_plan() was an
independent ladder, and the macOS/Windows consumers linked every action they did
not recognise - so a newer or customised installation could still be replaced.
A blacklist assertion ("the plan action is not one of the replacing actions")
passes while such a consumer is broken, so these tests DRIVE THE REAL CONSUMER
FUNCTIONS, extracted verbatim from setup-macos.sh exactly the way
installer-registration/verify-registration.sh does it, over real temporary
fixtures. Nothing is mocked: the policy under test is real code over real files.

The Windows consumer cannot be executed on this host. Its runtime behaviour is
UNVERIFIED; only the static contract both scripts must carry is asserted, and a
copy that drops that contract must be named by the parity check.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ADAPTER_DIR = REPO / "installer-registration"
sys.path.insert(0, str(ADAPTER_DIR))
import bundle_adapter as ba  # noqa: E402

SETUP_MAC = REPO / ba.INSTALLER_MAC
SKILL = "drama-song-ad-factory"
SHIPPED_VERSION = "1.2.3"
CONSUMER_START = "bundled_skills() {"
CONSUMER_END = "main() {"


def make_bundle(base: Path) -> Path:
    """A minimal bundle whose shipped tree, record and adapter copy are real."""
    root = base / "repo"
    (root / "CONTROL").mkdir(parents=True)
    (root / "VERSION").write_text("2.0.0\n", encoding="utf-8")
    (root / "CONTROL" / "bundled-skills.txt").write_text(
        "# bundled\n%s\n" % SKILL, encoding="utf-8")
    (root / "CONTROL" / "bundled-components.json").write_text(
        json.dumps({"schema": ba.SCHEMA_COMPONENTS,
                    "components": {SKILL: [{"version": SHIPPED_VERSION}]}}),
        encoding="utf-8")
    shipped = root / ".claude" / "skills" / SKILL
    shipped.mkdir(parents=True)
    (shipped / "SKILL.md").write_text("# drama song ad factory\n", encoding="utf-8")
    (shipped / "VERSION").write_text(SHIPPED_VERSION + "\n", encoding="utf-8")
    (root / "installer-registration").mkdir()
    shutil.copyfile(ADAPTER_DIR / "bundle_adapter.py",
                    root / "installer-registration" / "bundle_adapter.py")
    digest, _entries, reason = ba.tree_digest(shipped)
    if digest is None:
        raise AssertionError("fixture shipped tree has no digest: %s" % reason)
    (root / ba.DIGESTS_PATH).write_text(json.dumps({
        "schema": ba.SCHEMA_DIGESTS,
        "skills": {SKILL: {"digest": digest, "version": SHIPPED_VERSION}},
    }), encoding="utf-8")
    return root


def consumer_wrapper(base: Path) -> Path:
    """The real consumer functions, extracted verbatim, with main() removed."""
    text = SETUP_MAC.read_text(encoding="utf-8")
    start = text.index(CONSUMER_START)
    span = text[start:text.index(CONSUMER_END, start)]
    wrapper = base / "consumer.sh"
    wrapper.write_text(
        "#!/usr/bin/env bash\nset -euo pipefail\n" + span +
        '\nrc=0\n[ "${1:-}" = "" ] || "$@" || rc=$?\nexit "$rc"\n',
        encoding="utf-8")
    return wrapper


class FixtureCase(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get("TMPDIR") or tempfile.gettempdir())
        base.mkdir(parents=True, exist_ok=True)
        self.tmp = Path(tempfile.mkdtemp(prefix="p15-preserve-", dir=str(base)))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = make_bundle(self.tmp)
        self.claude_root = self.tmp / "claude"
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.wrapper = consumer_wrapper(self.tmp)

    def plan_row(self):
        rows = [r for r in ba.install_plan(ba.load_bundle(self.repo),
                                           self.claude_root, self.home)
                if r[1] == SKILL]
        self.assertEqual(len(rows), 1, rows)
        return rows[0]

    def install_real(self, version, skill_text="# customised by the operator\n"):
        """A real installed tree carrying a 999-only compatibility file."""
        target = self.claude_root / "skills" / SKILL
        target.mkdir(parents=True)
        (target / "SKILL.md").write_text(skill_text, encoding="utf-8")
        (target / "VERSION").write_text(version + "\n", encoding="utf-8")
        compat = target / "compat" / "999_only.json"
        compat.parent.mkdir()
        compat.write_text('{"flavor": "999"}\n', encoding="utf-8")
        return target

    def consume(self):
        env = dict(os.environ)
        env.update({"HOME": str(self.home), "REPO_ROOT": str(self.repo),
                    "REPO_SKILL_DIR": str(self.repo / ".claude" / "skills"
                                          / "nine-router-setup")})
        return subprocess.run(
            ["bash", str(self.wrapper), "link_skills_into_root",
             str(self.claude_root)],
            capture_output=True, text=True, env=env)


class NewerInstallTests(FixtureCase):
    """decide() refuses the downgrade; the REAL consumer must not replace it."""

    def test_newer_installation_survives_the_macos_consumer(self):
        target = self.install_real("9.9.9")
        shipped = ba.load_bundle(self.repo).by_name(SKILL)
        self.assertEqual(
            ba.decide(shipped, ba.read_skill_version(target)[0]).action,
            "refuse_downgrade", "control: decide must refuse this installation")
        row = self.plan_row()
        self.assertEqual(row[0], "preserve", "the plan must preserve it: %r" % (row,))

        result = self.consume()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("skill preserved: " + SKILL, result.stdout,
                      "the consumer must report the preservation by name")
        self.assertFalse(target.is_symlink(),
                         "a newer installation was REPLACED by a link")
        self.assertEqual(
            (target / "VERSION").read_text(encoding="utf-8").strip(), "9.9.9")
        self.assertEqual((target / "compat" / "999_only.json").read_text(
            encoding="utf-8"), '{"flavor": "999"}\n')
        self.assertFalse((self.home / ".claude-skill-backups").exists(),
                         "a backup was minted without consent")


class CustomSameVersionTests(FixtureCase):
    """A same-version custom install is held, and its destination-only files stay."""

    def test_same_version_custom_installation_survives_with_its_compat_files(self):
        target = self.install_real(SHIPPED_VERSION)
        compat = target / "compat" / "999_only.json"
        before = compat.read_bytes()
        shipped = ba.load_bundle(self.repo).by_name(SKILL)
        self.assertEqual(
            ba.decide(shipped, ba.read_skill_version(target)[0]).action,
            "current", "control: decide must hold this installation")
        row = self.plan_row()
        self.assertEqual(row[0], "preserve", "the plan must preserve it: %r" % (row,))

        result = self.consume()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(target.is_symlink(),
                         "a custom same-version installation was replaced")
        self.assertEqual(compat.read_bytes(), before,
                         "the 999-only compatibility file was not preserved")
        self.assertFalse((self.home / ".claude-skill-backups").exists(),
                         "a backup was minted without consent")


class FreshInstallTests(FixtureCase):
    """Positive control: preservation must not stop an ordinary fresh install."""

    def test_absent_destination_is_linked(self):
        self.assertEqual(self.plan_row()[0], "link", self.plan_row())

        result = self.consume()

        target = self.claude_root / "skills" / SKILL
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(target.is_symlink(), "a fresh install was not linked")
        self.assertEqual(os.path.realpath(target), os.path.realpath(
            self.repo / ".claude" / "skills" / SKILL))
        self.assertIn("skill linked: " + SKILL, result.stdout)


class UnknownActionTests(FixtureCase):
    """The review failure: a plan action the consumer does not know must NEVER
    become a link. A blacklist of replacing actions passes here; this does not."""

    def test_unknown_plan_action_is_refused_and_leaves_the_installation_alone(self):
        target = self.install_real(SHIPPED_VERSION, "# installed by hand\n")
        before = (target / "VERSION").read_bytes()
        (self.repo / "installer-registration" / "bundle_adapter.py").write_text(
            "import sys\n"
            "args = sys.argv[1:]\n"
            "root = args[args.index('--claude-root') + 1]\n"
            "src = args[args.index('--root') + 1] + '/.claude/skills/' + %r\n"
            "print('\\t'.join(['bogus-action', %r, src,\n"
            "                 root + '/skills/' + %r, '0' * 64, 'stub row']))\n"
            % (SKILL, SKILL, SKILL), encoding="utf-8")

        result = self.consume()

        self.assertNotEqual(result.returncode, 0,
                            "an unknown plan action must fail closed:\n"
                            + result.stdout + result.stderr)
        self.assertIn("unknown plan action", result.stdout + result.stderr)
        self.assertFalse(target.is_symlink(),
                         "an unknown plan action was treated as a link")
        self.assertEqual((target / "VERSION").read_bytes(), before)
        self.assertTrue((target / "compat" / "999_only.json").is_file())


class ConsumerContractTests(unittest.TestCase):
    """Windows runtime is UNVERIFIED here (no Windows host). What is asserted is
    the static contract both consumers must carry, plus proof the guard can fail."""

    def test_both_consumers_carry_the_plan_contract(self):
        problems = ba.installer_parity_problems(REPO)
        self.assertEqual(problems, [], "\n".join(problems))

    def test_negative_control_a_consumer_that_drops_preserve_is_named(self):
        base = Path(os.environ.get("TMPDIR") or tempfile.gettempdir())
        tmp = Path(tempfile.mkdtemp(prefix="p15-contract-", dir=str(base)))
        self.addCleanup(shutil.rmtree, tmp, True)
        for rel in (ba.INSTALLER_MAC, ba.INSTALLER_WIN):
            copy = tmp / rel
            copy.parent.mkdir(parents=True, exist_ok=True)
            copy.write_text((REPO / rel).read_text(encoding="utf-8"),
                            encoding="utf-8")
        dropped = tmp / ba.INSTALLER_WIN
        dropped.write_text(dropped.read_text(encoding="utf-8").replace(
            "preserve", "kept"), encoding="utf-8")
        problems = ba.installer_parity_problems(tmp)
        self.assertTrue(
            any(ba.INSTALLER_WIN in p and "'preserve'" in p for p in problems),
            "a consumer that drops the preservation contract must be named: %r"
            % (problems,))


if __name__ == "__main__":
    unittest.main(verbosity=2)
