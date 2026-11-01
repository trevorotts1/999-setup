"""End-to-end preservation contract for the bundled-skill install path (R3).

Run: python3 -I -B installer-registration/test_install_preservation_contract.py

What this proves, and where the proof stops:

  * The ADAPTER. install_plan() must carry the same preservation decision as
    decide(): a newer, custom, unreadable or merely same-version REAL
    installation is preserved, and so is a LINK to another installation unless
    that installation is proven strictly older. Only an absent destination, a
    dangling link or a proven upgrade may be linked. A lookup that FAILS (for
    example a denied directory) is never treated as absence: it is
    preserve-unreadable. decide() and install_plan() run over the same real
    temporary trees, so the two cannot disagree.
  * The macOS CONSUMER. The real link_skills_into_root AND the real
    link_one_skill are extracted verbatim from setup-macos.sh - the rest of the
    script is never sourced and main() is never reached - and run against a
    real temporary bundle and a real temporary Claude root. No internal helper
    is stubbed: the link that lands on disk is the proof. A preserved
    installation must keep its link target and leave the WHOLE destination tree
    byte-identical, destination-only 999 compatibility files included, and mint
    no backup.
  * The macOS FALLBACK (no adapter). The real bundled_skills,
    resolve_skill_source, link_one_skill and link_skills_into_root are extracted
    and run with NO adapter in a disposable repository. With no adapter decision
    an existing real installation and a link to another installation are
    PRESERVED; only a proven absent destination is linked; a denied lookup
    fails closed. Nothing is ever moved to ~/.claude-skill-backups.
  * The Windows CONSUMER is checked STRUCTURALLY (source shape) only. Native
    PowerShell execution is UNVERIFIED: no Windows host exists in this lane and
    that claim is not made here.

Every fixture is a real temporary tree under TMPDIR. No installer is run, no
real Claude config root is read or written, and no backup is ever minted.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ADAPTER = REPO / "installer-registration" / "bundle_adapter.py"
MAC = REPO / ".claude" / "skills" / "nine-router-setup" / "scripts" / "setup-macos.sh"
WIN = REPO / ".claude" / "skills" / "nine-router-setup" / "scripts" / "setup-windows.ps1"
for _path in (ADAPTER, MAC, WIN):
    if not _path.is_file():
        raise ImportError("required installer file missing: %s" % _path)
sys.path.insert(0, str(ADAPTER.parent))
import bundle_adapter as ba  # noqa: E402

SKILL = "drama-song-ad-factory"
OTHER_SKILL = "spec-protocol"
SHIPPED_VERSION = "1.2.3"
COMPAT_TEXT = '{"flavor": "999"}\n'


def write_record(root):
    """A digest record built without the cohort gate (fixture-local)."""
    bundle = ba.load_bundle(root)
    payload = {
        "schema": ba.SCHEMA_DIGESTS,
        "skills": {skill.name: {"digest": skill.digest,
                                "version": skill.version}
                   for skill in bundle.skills},
    }
    (Path(root) / "CONTROL" / "bundle-digests.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def make_bundle(base, skills=None, version=SHIPPED_VERSION, with_record=True):
    """A minimal real bundle: registered skills, shipped VERSION files, a record."""
    skills = list(skills or [SKILL])
    root = Path(base) / "repo"
    (root / "CONTROL").mkdir(parents=True)
    (root / "VERSION").write_text("2.0.0\n", encoding="utf-8")
    (root / "CONTROL" / "bundled-skills.txt").write_text(
        "# fixture registry\n" + "".join(name + "\n" for name in skills),
        encoding="utf-8")
    (root / "CONTROL" / "bundled-components.json").write_text(
        json.dumps({"schema": ba.SCHEMA_COMPONENTS,
                    "components": {name: [{"version": version}]
                                   for name in skills}}),
        encoding="utf-8")
    for name in skills:
        shipped = root / ".claude" / "skills" / name
        shipped.mkdir(parents=True)
        (shipped / "SKILL.md").write_text("# fixture skill %s\n" % name,
                                          encoding="utf-8")
        (shipped / "VERSION").write_text(version + "\n", encoding="utf-8")
    if with_record:
        write_record(root)
    return root


def with_real_adapter(repo):
    """The consumer calls REPO_ROOT/installer-registration/bundle_adapter.py."""
    reg = repo / "installer-registration"
    reg.mkdir()
    (reg / "bundle_adapter.py").symlink_to(ADAPTER)
    return repo


def make_stub_repo(base, plan_line):
    """A repo whose adapter prints ONE controlled plan row (adapter boundary)."""
    repo = Path(base) / "repo"
    (repo / "CONTROL").mkdir(parents=True)
    (repo / "CONTROL" / "bundled-skills.txt").write_text(
        SKILL + "\n", encoding="utf-8")
    (repo / "installer-registration").mkdir()
    (repo / "installer-registration" / "bundle_adapter.py").write_text(
        "import sys\nprint(" + repr(plan_line) + ")\nsys.exit(0)\n",
        encoding="utf-8")
    return repo


def make_fallback_repo(base, skills=None):
    """A repo with NO adapter: the standalone fallback the installers carry."""
    skills = list(skills or [SKILL])
    repo = Path(base) / "repo"
    (repo / "CONTROL").mkdir(parents=True)
    (repo / "CONTROL" / "bundled-skills.txt").write_text(
        "".join(name + "\n" for name in skills), encoding="utf-8")
    for name in skills:
        shipped = repo / ".claude" / "skills" / name
        shipped.mkdir(parents=True)
        (shipped / "SKILL.md").write_text("# fallback skill %s\n" % name,
                                          encoding="utf-8")
        (shipped / "VERSION").write_text(SHIPPED_VERSION + "\n",
                                         encoding="utf-8")
        compat = shipped / "compat"
        compat.mkdir()
        (compat / "999_only.json").write_text(COMPAT_TEXT, encoding="utf-8")
    repo_skill_dir = repo / ".claude" / "skills" / "nine-router-setup"
    repo_skill_dir.mkdir(parents=True, exist_ok=True)
    (repo_skill_dir / "SKILL.md").write_text("# nine-router-setup\n",
                                             encoding="utf-8")
    return repo, repo_skill_dir


def install_real(claude_root, version, name=SKILL,
                 skill_text="# custom installation\n"):
    """A real (non-link) installation at the destination, with a 999 file."""
    target = Path(claude_root) / "skills" / name
    target.mkdir(parents=True)
    (target / "SKILL.md").write_text(skill_text, encoding="utf-8")
    if version is not None:
        (target / "VERSION").write_text(version + "\n", encoding="utf-8")
    compat = target / "compat"
    compat.mkdir()
    (compat / "999_only.json").write_text(COMPAT_TEXT, encoding="utf-8")
    return target


def install_link(claude_root, target_dir, name=SKILL):
    """A link at the destination pointing at another installation."""
    target = Path(claude_root) / "skills" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    os.symlink(str(target_dir), str(target))
    return target


def other_installation(base, version, skill_text="# other installation\n"):
    """A real installation OUTSIDE the Claude root, reachable through a link."""
    other = Path(base) / "other"
    other.mkdir()
    (other / "SKILL.md").write_text(skill_text, encoding="utf-8")
    if version is not None:
        (other / "VERSION").write_text(version + "\n", encoding="utf-8")
    compat = other / "compat"
    compat.mkdir()
    (compat / "999_only.json").write_text(COMPAT_TEXT, encoding="utf-8")
    return other


def snapshot(root):
    """Every entry under root: kind + digest (files) or target (links)."""
    root = Path(root)
    if not root.exists():
        return None
    out = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            out[rel] = ("link", os.readlink(path))
        elif path.is_dir():
            out[rel] = ("dir",)
        else:
            out[rel] = ("file", hashlib.sha256(path.read_bytes()).hexdigest())
    return out


def extract_bash_function(source, name):
    lines = source.splitlines()
    start = None
    for index, line in enumerate(lines):
        if line == name + "() {":
            start = index
            break
    if start is None:
        raise AssertionError("function %s not found" % name)
    for index in range(start + 1, len(lines)):
        if lines[index] == "}":
            return "\n".join(lines[start:index + 1])
    raise AssertionError("function %s is not closed" % name)


def extract_powershell_function(source, name):
    marker = source.find("function " + name)
    if marker < 0:
        raise AssertionError("function %s not found" % name)
    lines = source[marker:].splitlines()
    depth = 0
    seen = False
    for index, line in enumerate(lines):
        depth += line.count("{") - line.count("}")
        if "{" in line:
            seen = True
        if seen and depth <= 0:
            return "\n".join(lines[:index + 1])
    raise AssertionError("function %s is not closed" % name)


def run_macos_adapter_consumer(repo, claude_root, home, work):
    """Run the REAL extracted consumer and the REAL link helper, nothing stubbed."""
    source = MAC.read_text(encoding="utf-8")
    script = Path(work) / "consumer.sh"
    script.write_text(
        "#!/usr/bin/env bash\n"
        "set -uo pipefail\n"
        + extract_bash_function(source, "link_one_skill") + "\n"
        + extract_bash_function(source, "link_skills_into_root") + "\n"
        'link_skills_into_root "$1"\n',
        encoding="utf-8")
    env = dict(os.environ)
    env.update({"REPO_ROOT": str(repo), "HOME": str(home), "TMPDIR": str(work),
                "PYTHONDONTWRITEBYTECODE": "1"})
    return subprocess.run(["bash", str(script), str(claude_root)],
                          capture_output=True, text=True, env=env, timeout=180)


def run_macos_fallback_consumer(repo, repo_skill_dir, claude_root, home, work):
    """Run the REAL standalone fallback: no adapter exists in the repo."""
    source = MAC.read_text(encoding="utf-8")
    script = Path(work) / "fallback.sh"
    script.write_text(
        "#!/usr/bin/env bash\n"
        "set -uo pipefail\n"
        + extract_bash_function(source, "bundled_skills") + "\n"
        + extract_bash_function(source, "resolve_skill_source") + "\n"
        + extract_bash_function(source, "link_one_skill") + "\n"
        + extract_bash_function(source, "link_skills_into_root") + "\n"
        'link_skills_into_root "$1"\n',
        encoding="utf-8")
    env = dict(os.environ)
    env.update({"REPO_ROOT": str(repo), "REPO_SKILL_DIR": str(repo_skill_dir),
                "HOME": str(home), "TMPDIR": str(work),
                "PYTHONDONTWRITEBYTECODE": "1"})
    return subprocess.run(["bash", str(script), str(claude_root)],
                          capture_output=True, text=True, env=env, timeout=180)


class LaneCase(unittest.TestCase):
    def setUp(self):
        base = os.environ.get("TMPDIR") or tempfile.gettempdir()
        Path(base).mkdir(parents=True, exist_ok=True)
        self.tmp = Path(tempfile.mkdtemp(prefix="s75-r3-", dir=str(base)))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def work(self, name):
        path = self.tmp / name
        path.mkdir()
        return path


class AdapterPlanTests(LaneCase):
    def setUp(self):
        super().setUp()
        self.repo = make_bundle(self.tmp)
        self.bundle = ba.load_bundle(self.repo)
        self.claude_root = self.tmp / "claude"
        self.home = self.tmp / "home"

    def row(self):
        rows = [r for r in ba.install_plan(self.bundle, self.claude_root, self.home)
                if r[1] == SKILL]
        self.assertEqual(len(rows), 1, rows)
        return rows[0]

    def test_fresh_destination_plans_a_link(self):
        self.assertEqual(self.row()[0], "link")

    def test_identical_link_is_up_to_date(self):
        target = install_link(self.claude_root,
                              self.repo / ".claude" / "skills" / SKILL)
        self.assertEqual(self.row()[0], "up-to-date")
        self.assertEqual(os.readlink(target),
                         str(self.repo / ".claude" / "skills" / SKILL))

    def test_link_to_newer_installation_is_preserved(self):
        other = other_installation(self.tmp, "999.0.0")
        target = install_link(self.claude_root, other)
        before = snapshot(other)
        self.assertEqual(ba.decide(self.bundle.by_name(SKILL), "999.0.0").action,
                         "refuse_downgrade", "control: decide must refuse this")
        action = self.row()[0]
        self.assertEqual(action, "preserve-newer")
        self.assertNotIn(action, ba.PLAN_TOUCHING_ACTIONS)
        self.assertEqual(os.readlink(target), str(other),
                         "the active installation's link must not be re-pointed")
        self.assertEqual(snapshot(other), before)

    def test_link_to_same_version_custom_installation_is_preserved(self):
        other = other_installation(self.tmp, SHIPPED_VERSION)
        target = install_link(self.claude_root, other)
        before = snapshot(other)
        self.assertEqual(ba.decide(self.bundle.by_name(SKILL),
                                   SHIPPED_VERSION).action, "current")
        self.assertEqual(self.row()[0], "preserve-custom")
        self.assertEqual(os.readlink(target), str(other))
        self.assertEqual(snapshot(other), before)

    def test_link_to_same_version_installation_without_a_record_is_preserved(self):
        """Equal version + differing content stays preserved even with no record."""
        other = other_installation(self.tmp, SHIPPED_VERSION)
        target = install_link(self.claude_root, other)
        (self.repo / "CONTROL" / "bundle-digests.json").unlink()
        self.bundle = ba.load_bundle(self.repo)
        self.assertEqual(ba.decide(self.bundle.by_name(SKILL),
                                   SHIPPED_VERSION).action, "update",
                         "control: decide calls this an update when unrecorded")
        self.assertEqual(self.row()[0], "preserve-custom")
        self.assertEqual(os.readlink(target), str(other))

    def test_link_to_unreadable_installation_is_preserved(self):
        other = other_installation(self.tmp, "not-a-version")
        target = install_link(self.claude_root, other)
        self.assertEqual(ba.decide(self.bundle.by_name(SKILL),
                                   "not-a-version").action, "undetermined")
        self.assertEqual(self.row()[0], "preserve-unreadable")
        self.assertEqual(os.readlink(target), str(other))

    def test_link_to_older_installation_plans_a_relink(self):
        other = other_installation(self.tmp, "1.0.0")
        target = install_link(self.claude_root, other)
        before = snapshot(other)
        self.assertEqual(ba.decide(self.bundle.by_name(SKILL), "1.0.0").action,
                         "update", "control: the shipped version is newer")
        self.assertEqual(self.row()[0], "relink")
        self.assertEqual(os.readlink(target), str(other),
                         "planning is read-only; only the consumer acts")
        self.assertEqual(snapshot(other), before)

    def test_broken_link_plans_a_relink(self):
        install_link(self.claude_root, self.tmp / "gone")
        self.assertEqual(self.row()[0], "relink")

    def test_newer_real_installation_is_preserved(self):
        target = install_real(self.claude_root, "999.0.0")
        self.assertEqual(ba.decide(self.bundle.by_name(SKILL), "999.0.0").action,
                         "refuse_downgrade", "control: decide must refuse this")
        action = self.row()[0]
        self.assertEqual(action, "preserve-newer")
        self.assertNotIn(action, ba.PLAN_TOUCHING_ACTIONS)
        self.assertEqual((target / "VERSION").read_text().strip(), "999.0.0")
        self.assertEqual((target / "compat" / "999_only.json").read_text(),
                         COMPAT_TEXT)

    def test_same_version_custom_installation_is_preserved(self):
        target = install_real(self.claude_root, SHIPPED_VERSION)
        self.assertEqual(ba.decide(self.bundle.by_name(SKILL),
                                   SHIPPED_VERSION).action, "current",
                         "control: decide must hold this installation")
        before = snapshot(target)
        self.assertEqual(self.row()[0], "preserve-custom")
        self.assertEqual(snapshot(target), before)

    def test_unreadable_installed_version_is_preserved(self):
        target = install_real(self.claude_root, "not-a-version")
        self.assertEqual(ba.decide(self.bundle.by_name(SKILL),
                                   "not-a-version").action, "undetermined",
                         "control: decide must refuse to overwrite")
        self.assertEqual(self.row()[0], "preserve-unreadable")
        self.assertEqual((target / "VERSION").read_text().strip(), "not-a-version")

    def test_real_installation_without_a_stamp_is_preserved(self):
        target = install_real(self.claude_root, None)
        self.assertEqual(self.row()[0], "preserve-custom")
        self.assertTrue((target / "compat" / "999_only.json").is_file())

    def test_empty_real_destination_is_the_only_replaceable_real_destination(self):
        target = self.claude_root / "skills" / SKILL
        target.mkdir(parents=True)
        self.assertEqual(self.row()[0], "backup-and-link")
        self.assertEqual(list(target.iterdir()), [])

    def test_missing_source_still_plans_missing(self):
        shutil.rmtree(self.repo / ".claude" / "skills" / SKILL)
        self.assertEqual(
            ba.install_plan(ba.load_bundle(self.repo), self.claude_root,
                            self.home)[0][0], "missing")

    def test_readable_stamp_control_under_this_interpreter(self):
        """The SAME interpreter reads an ordinary stamp, so the denied case
        below is a real filesystem denial and not a blanket classification."""
        target = install_real(self.claude_root, SHIPPED_VERSION)
        self.assertGreater(os.stat(target / "VERSION").st_size, 0)
        self.assertEqual(ba.installed_stamp_state(target)[0], "present")
        self.assertEqual(self.row()[0], "preserve-custom")


class DeniedFilesystemTests(LaneCase):
    """A DENIED lookup is unreadable, never absent, and the tree is preserved."""

    def setUp(self):
        super().setUp()
        self.repo = with_real_adapter(make_bundle(self.tmp))
        self.claude_root = self.tmp / "claude"
        self.home = self.tmp / "home"
        self.home.mkdir()

    def plan_row(self):
        rows = ba.install_plan(ba.load_bundle(self.repo), self.claude_root,
                               self.home)
        rows = [r for r in rows if r[1] == SKILL]
        self.assertEqual(len(rows), 1, rows)
        return rows[0]

    def run_consumer(self):
        return run_macos_adapter_consumer(self.repo, self.claude_root,
                                          self.home, self.work("work"))

    def test_denied_real_destination_directory_is_preserve_unreadable(self):
        target = install_real(self.claude_root, SHIPPED_VERSION)
        before = snapshot(target)
        mode = os.stat(target).st_mode & 0o7777
        os.chmod(target, 0)
        try:
            with self.assertRaises(PermissionError):
                os.stat(target / "VERSION")
            with self.assertRaises(PermissionError):
                (target / "VERSION").read_text(encoding="utf-8")
            stamp_state, stamp_reason = ba.installed_stamp_state(target)
            self.assertEqual(stamp_state, "unreadable", stamp_reason)
            self.assertIn("Permission denied", stamp_reason, stamp_reason)
            row = self.plan_row()
            self.assertEqual(row[0], "preserve-unreadable", row)
            proc = self.run_consumer()
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertIn("skill preserved (preserve-unreadable)", proc.stdout,
                          proc.stdout + proc.stderr)
            self.assertFalse(target.is_symlink(),
                             "the real installation must stay real")
            self.assertFalse((self.home / ".claude-skill-backups").exists(),
                             "no backup may be minted")
        finally:
            os.chmod(target, mode)
        self.assertEqual(snapshot(target), before,
                         "the whole destination tree must stay byte-identical")
        self.assertEqual((target / "compat" / "999_only.json").read_text(),
                         COMPAT_TEXT, "999 compatibility bytes must be intact")

    def test_denied_linked_target_directory_is_preserve_unreadable(self):
        other = other_installation(self.tmp, SHIPPED_VERSION)
        target = install_link(self.claude_root, other)
        before = snapshot(other)
        link_text = os.readlink(target)
        mode = os.stat(other).st_mode & 0o7777
        os.chmod(other, 0)
        try:
            with self.assertRaises(PermissionError):
                os.stat(other / "VERSION")
            row = self.plan_row()
            self.assertEqual(row[0], "preserve-unreadable", row)
            proc = self.run_consumer()
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertEqual(os.readlink(target), link_text,
                             "the active installation's link must not move")
            self.assertIn("skill preserved (preserve-unreadable)", proc.stdout,
                          proc.stdout + proc.stderr)
            self.assertFalse((self.home / ".claude-skill-backups").exists())
        finally:
            os.chmod(other, mode)
        self.assertEqual(snapshot(other), before,
                         "the linked target's whole tree must stay byte-identical")
        self.assertEqual((target / "compat" / "999_only.json").read_text(),
                         COMPAT_TEXT, "999 compatibility bytes must be reachable")

    def test_denied_stamp_file_is_preserve_unreadable(self):
        target = install_real(self.claude_root, SHIPPED_VERSION)
        stamp = target / "VERSION"
        before = snapshot(target)
        mode = os.stat(stamp).st_mode & 0o7777
        os.chmod(stamp, 0)
        try:
            with self.assertRaises(PermissionError):
                stamp.read_text(encoding="utf-8")
            row = self.plan_row()
            self.assertEqual(row[0], "preserve-unreadable", row)
            proc = self.run_consumer()
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertIn("skill preserved (preserve-unreadable)", proc.stdout)
            self.assertFalse((self.home / ".claude-skill-backups").exists())
        finally:
            os.chmod(stamp, mode)
        self.assertEqual(snapshot(target), before)

    def test_denied_destination_lookup_cannot_authorize_a_link(self):
        skills = self.claude_root / "skills"
        skills.mkdir(parents=True)
        mode = os.stat(skills).st_mode & 0o7777
        os.chmod(skills, 0)
        try:
            with self.assertRaises(PermissionError):
                os.stat(skills / SKILL)
            row = self.plan_row()
            self.assertEqual(row[0], "preserve-unreadable", row)
            self.assertNotEqual(row[0], "link",
                                "a failed lookup must never authorize creation")
        finally:
            os.chmod(skills, mode)

    def test_unreadable_payload_does_not_escape_per_skill_planning(self):
        """One unreadable installation is preserved; another fresh skill still
        receives a valid link row and is installed."""
        shutil.rmtree(self.tmp / "repo")
        repo = with_real_adapter(make_bundle(self.tmp, skills=[SKILL,
                                                               OTHER_SKILL]))
        self.repo = repo
        blocked = install_real(self.claude_root, SHIPPED_VERSION)
        before = snapshot(blocked)
        mode = os.stat(blocked).st_mode & 0o7777
        os.chmod(blocked, 0)
        try:
            rows = ba.install_plan(ba.load_bundle(self.repo), self.claude_root,
                                   self.home)
            by_name = {row[1]: row[0] for row in rows}
            self.assertEqual(by_name[SKILL], "preserve-unreadable", by_name)
            self.assertEqual(by_name[OTHER_SKILL], "link", by_name)
            proc = self.run_consumer()
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            fresh = self.claude_root / "skills" / OTHER_SKILL
            self.assertTrue(fresh.is_symlink(), "the fresh skill must install")
            self.assertEqual(os.path.realpath(fresh),
                             os.path.realpath(self.repo / ".claude" / "skills"
                                              / OTHER_SKILL))
            self.assertIn("skill preserved (preserve-unreadable)", proc.stdout)
            self.assertFalse((self.home / ".claude-skill-backups").exists())
        finally:
            os.chmod(blocked, mode)
        self.assertEqual(snapshot(blocked), before)

    def test_malformed_stamp_remains_a_separate_case(self):
        target = install_real(self.claude_root, "not-a-version")
        self.assertEqual(self.plan_row()[0], "preserve-unreadable")
        self.assertEqual((target / "VERSION").read_text().strip(),
                         "not-a-version",
                         "malformed text is preserved, not rewritten")


class MacosConsumerTests(LaneCase):
    """The REAL consumer and the REAL link helper, run against temp roots."""

    def setUp(self):
        super().setUp()
        self.repo = with_real_adapter(make_bundle(self.tmp))
        self.claude_root = self.tmp / "claude"
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.source = self.repo / ".claude" / "skills" / SKILL

    def run_consumer(self, repo=None, work=None):
        return run_macos_adapter_consumer(repo or self.repo, self.claude_root,
                                          self.home, work or self.work("work"))

    def assert_no_backup(self):
        self.assertFalse((self.home / ".claude-skill-backups").exists(),
                         "a preserved or freshly linked skill must mint no backup")

    def assert_points_at_source(self):
        target = self.claude_root / "skills" / SKILL
        self.assertTrue(target.is_symlink(), "the destination must be a symlink")
        self.assertEqual(os.path.realpath(target),
                         os.path.realpath(self.source))
        self.assertTrue((target / "SKILL.md").is_file())

    def test_fresh_destination_gets_the_correct_symlink(self):
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_points_at_source()
        self.assert_no_backup()

    def test_empty_destination_is_linked_without_a_backup(self):
        (self.claude_root / "skills" / SKILL).mkdir(parents=True)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_points_at_source()
        self.assert_no_backup()

    def test_newer_real_installation_is_untouched(self):
        target = install_real(self.claude_root, "999.0.0")
        before = snapshot(target)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertFalse(target.is_symlink(), "a real installation must stay real")
        self.assertEqual(snapshot(target), before,
                         "the whole destination must stay byte-identical")
        self.assertIn("skill preserved (preserve-newer)", proc.stdout)
        self.assert_no_backup()

    def test_same_version_custom_installation_is_untouched(self):
        target = install_real(self.claude_root, SHIPPED_VERSION)
        before = snapshot(target)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(snapshot(target), before)
        self.assertIn("skill preserved (preserve-custom)", proc.stdout)
        self.assert_no_backup()

    def test_unreadable_real_installation_is_untouched(self):
        target = install_real(self.claude_root, "not-a-version")
        before = snapshot(target)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(snapshot(target), before)
        self.assertIn("skill preserved (preserve-unreadable)", proc.stdout)
        self.assert_no_backup()

    def test_link_to_newer_installation_keeps_pointing_at_it(self):
        other = other_installation(self.tmp, "999.0.0")
        target = install_link(self.claude_root, other)
        before = snapshot(other)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(os.readlink(target), str(other),
                         "the active installation's link must not be re-pointed")
        self.assertEqual(snapshot(other), before,
                         "the linked target's whole tree must stay byte-identical")
        self.assertEqual((target / "compat" / "999_only.json").read_text(),
                         COMPAT_TEXT, "destination-only 999 files stay reachable")
        self.assertIn("skill preserved (preserve-newer)", proc.stdout)
        self.assert_no_backup()

    def test_link_to_same_version_custom_installation_keeps_pointing_at_it(self):
        other = other_installation(self.tmp, SHIPPED_VERSION)
        target = install_link(self.claude_root, other)
        before = snapshot(other)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(os.readlink(target), str(other))
        self.assertEqual(snapshot(other), before)
        self.assertIn("skill preserved (preserve-custom)", proc.stdout)
        self.assert_no_backup()

    def test_identical_link_is_a_no_op(self):
        target = install_link(self.claude_root, self.source)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(os.readlink(target), str(self.source))
        self.assertIn("skill up to date", proc.stdout)
        self.assert_no_backup()

    def test_link_to_older_installation_is_repointed(self):
        other = other_installation(self.tmp, "1.0.0")
        target = install_link(self.claude_root, other)
        before = snapshot(other)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_points_at_source()
        self.assertEqual(snapshot(other), before,
                         "re-pointing a link must never touch its old target")
        self.assertIn("skill linked", proc.stdout)
        self.assert_no_backup()

    def test_broken_link_is_replaced(self):
        target = install_link(self.claude_root, self.tmp / "gone")
        self.assertFalse(os.path.exists(target))
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_points_at_source()
        self.assertIn("skill linked", proc.stdout)
        self.assert_no_backup()

    def test_broken_link_chain_leaves_the_intermediate_link_unchanged(self):
        intermediate = self.tmp / "intermediate"
        os.symlink(str(self.tmp / "gone"), str(intermediate))
        target = install_link(self.claude_root, intermediate)
        intermediate_text = os.readlink(intermediate)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assert_points_at_source()
        self.assertEqual(os.readlink(intermediate), intermediate_text,
                         "only the destination pointer may be removed")
        self.assert_no_backup()

    def test_unknown_plan_action_is_refused_fail_closed(self):
        stub = make_stub_repo(self.tmp / "stub",
                              "not-a-real-action\t" + SKILL +
                              "\t/path/src\t/path/dst\tdeadbeef")
        proc = self.run_consumer(repo=stub, work=self.work("work-stub"))
        self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        target = self.claude_root / "skills" / SKILL
        self.assertFalse(target.exists() or target.is_symlink(),
                         "an unknown action may never link")
        self.assertIn("unknown plan action", proc.stdout + proc.stderr)
        self.assert_no_backup()

    def test_missing_source_is_named_and_links_nothing(self):
        shutil.rmtree(self.source)
        proc = self.run_consumer()
        self.assertNotEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        target = self.claude_root / "skills" / SKILL
        self.assertFalse(target.exists() or target.is_symlink())
        self.assertIn("no source found", proc.stdout + proc.stderr)
        self.assert_no_backup()


class FallbackConsumerTests(LaneCase):
    """The REAL standalone fallback (no adapter): preserve, never back up."""

    def setUp(self):
        super().setUp()
        self.repo, self.repo_skill_dir = make_fallback_repo(self.tmp)
        self.claude_root = self.tmp / "claude"
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.source = self.repo / ".claude" / "skills" / SKILL

    def run_consumer(self):
        return run_macos_fallback_consumer(self.repo, self.repo_skill_dir,
                                           self.claude_root, self.home,
                                           self.work("work"))

    def assert_no_backup(self):
        self.assertFalse((self.home / ".claude-skill-backups").exists(),
                         "the fallback must never mint a backup")

    def test_fresh_absent_destination_is_linked(self):
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        target = self.claude_root / "skills" / SKILL
        self.assertTrue(target.is_symlink())
        self.assertEqual(os.path.realpath(target), os.path.realpath(self.source))
        self.assert_no_backup()

    def test_same_source_destination_is_unchanged(self):
        target = install_link(self.claude_root, self.source)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(os.readlink(target), str(self.source))
        self.assert_no_backup()

    def test_existing_real_installation_is_preserved(self):
        for version in ("999.0.0", SHIPPED_VERSION, "1.0.0", None):
            with self.subTest(version=version):
                shutil.rmtree(self.claude_root, True)
                target = install_real(self.claude_root, version)
                before = snapshot(target)
                proc = self.run_consumer()
                self.assertEqual(proc.returncode, 0,
                                 proc.stdout + proc.stderr)
                self.assertFalse(target.is_symlink(),
                                 "a real installation must stay real")
                self.assertEqual(snapshot(target), before,
                                 "the whole destination must stay byte-identical")
                self.assertIn("skill preserved (no adapter)", proc.stdout)
                self.assert_no_backup()
                shutil.rmtree(self.tmp / "work", True)

    def test_foreign_valid_link_is_preserved(self):
        other = other_installation(self.tmp, "999.0.0")
        target = install_link(self.claude_root, other)
        before = snapshot(other)
        link_text = os.readlink(target)
        proc = self.run_consumer()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(os.readlink(target), link_text,
                         "the fallback must not re-point an existing link")
        self.assertEqual(snapshot(other), before)
        self.assertEqual((target / "compat" / "999_only.json").read_text(),
                         COMPAT_TEXT, "compatibility bytes must stay reachable")
        self.assertIn("skill preserved (no adapter)", proc.stdout)
        self.assert_no_backup()

    def test_denied_destination_lookup_fails_closed(self):
        skills = self.claude_root / "skills"
        skills.mkdir(parents=True)
        before = snapshot(self.claude_root)
        mode = os.stat(skills).st_mode & 0o7777
        os.chmod(skills, 0)
        try:
            with self.assertRaises(PermissionError):
                os.stat(skills / SKILL)
            proc = self.run_consumer()
            self.assertNotEqual(proc.returncode, 0,
                                proc.stdout + proc.stderr)
            self.assertIn("lookup failed", proc.stdout + proc.stderr,
                          proc.stdout + proc.stderr)
            self.assert_no_backup()
        finally:
            os.chmod(skills, mode)
        self.assertEqual(snapshot(self.claude_root), before,
                         "a denied lookup must not create anything")


class WindowsConsumerStaticTests(unittest.TestCase):
    """STRUCTURAL check of the real PowerShell consumer.

    Native Windows execution is UNVERIFIED: no Windows host is available in
    this lane, so only the source shape is asserted here.
    """

    @classmethod
    def setUpClass(cls):
        source = WIN.read_text(encoding="utf-8")
        cls.body = extract_powershell_function(source, "Link-BundledSkills")
        cls.linker = extract_powershell_function(source, "Link-OneBundledSkill")

    def branch(self):
        start = self.body.find("$adapter = Get-BundleAdapter")
        end = self.body.find("# Standalone install")
        self.assertNotEqual(start, -1, "the adapter branch must exist")
        self.assertNotEqual(end, -1, "the standalone branch must exist")
        self.assertGreater(end, start)
        return self.body[start:end]

    def test_linker_never_backs_up_or_moves_a_real_installation(self):
        self.assertNotIn(".claude-skill-backups", self.linker)
        self.assertNotIn("Move-Item", self.linker)
        self.assertNotIn("skill backed up", self.linker)
        self.assertIn("[switch]$Authorized", self.linker)
        self.assertIn("refusing to replace a real installation", self.linker)

    def test_linker_distinguishes_denied_lookup_from_absence(self):
        self.assertIn("cannot inspect", self.linker)
        self.assertIn("refusing to treat it as absent", self.linker)
        self.assertIn("Get-Item -LiteralPath $dst -Force -ErrorAction Stop",
                      self.linker)
        self.assertIn("ItemNotFoundException", self.linker)

    def test_plan_loop_links_only_allowlisted_actions(self):
        self.assertIn("$replaceActions = @('link', 'relink')", self.body)
        self.assertIn("-contains $action", self.body)
        self.assertIn("$action -eq 'up-to-date'", self.body)
        self.assertIn("-like 'preserve-*'", self.body)
        self.assertIn("unknown plan action", self.body)
        self.assertIn("Link-OneBundledSkill $s $src $dst -Authorized", self.body)

    def test_standalone_fallback_does_not_authorize_replacement(self):
        standalone = self.body[self.body.find("# Standalone install"):]
        self.assertNotIn("-Authorized", standalone,
                         "the fallback must never authorize a replacement")
        self.assertIn("Link-OneBundledSkill $s $src $dst", standalone)

    def test_empty_directory_removal_is_nonrecursive_and_fails_closed(self):
        self.assertNotIn("-Recurse", self.body)
        self.assertIn("Get-ChildItem -LiteralPath $dst -Force -ErrorAction Stop",
                      self.body)
        self.assertIn("Remove-Item -LiteralPath $dst -Force -ErrorAction Stop",
                      self.body)
        self.assertIn("cannot inspect", self.body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
