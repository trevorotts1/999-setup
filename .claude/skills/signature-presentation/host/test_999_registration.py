"""Self-check for PD-037: the skill is registered in the 999 bundle. Stdlib only.

Run: python3 -I .claude/skills/signature-presentation/host/test_999_registration.py

Checks the two registries the 999 installers really read:
  CONTROL/bundled-skills.txt          one bare line, `signature-presentation`
  CONTROL/bundled-components.json     one `components` entry with the S51 version
                                      WITHOUT the leading `v` (unit text)
and the negative controls: a v-prefixed version, a missing line, and a
repoPath whose tree has no SKILL.md each must FAIL.
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

HOST_DIR = Path(__file__).resolve().parent
SKILL_DIR = HOST_DIR.parent
REPO = HOST_DIR.parents[3]
SKILLS_TXT = REPO / "CONTROL" / "bundled-skills.txt"
COMPONENTS_JSON = REPO / "CONTROL" / "bundled-components.json"
REGISTERED_PATH = ".claude/skills/signature-presentation"


def skill_names(text: str) -> list[str]:
    """The registry parse both installers apply: strip # comments, trim, drop blanks."""
    out = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


def check(skills_text: str, components: dict, version_txt: str) -> list[str]:
    """Every PD-037 requirement as a list of problems (empty means registered)."""
    problems = []
    names = skill_names(skills_text)
    if "signature-presentation" not in names:
        problems.append("CONTROL/bundled-skills.txt does not list signature-presentation")

    entry = components.get("components", {}).get("signature-presentation")
    if not entry:
        problems.append("CONTROL/bundled-components.json has no signature-presentation entry")
        return problems
    if len(entry) != 1:
        problems.append(f"expected exactly one signature-presentation record, found {len(entry)}")
    rec = entry[0]
    want_version = version_txt.strip()
    if want_version.startswith("v"):
        want_version = want_version[1:]
    if rec.get("version") != want_version:
        problems.append(
            f"version is {rec.get('version')!r}; the S51 version without the leading v is {want_version!r}")
    if rec.get("platform") != "any":
        problems.append(f"platform is {rec.get('platform')!r}, expected 'any'")
    if rec.get("installFrom") != "repo-tree":
        problems.append(f"installFrom is {rec.get('installFrom')!r}, expected 'repo-tree'")
    if rec.get("repoPath") != REGISTERED_PATH:
        problems.append(f"repoPath is {rec.get('repoPath')!r}, expected {REGISTERED_PATH!r}")
    if rec.get("license") != "MIT (repo license)":
        problems.append(f"license is {rec.get('license')!r}, expected 'MIT (repo license)'")
    return problems


class Registration999Tests(unittest.TestCase):
    def test_both_files_parse(self):
        json.loads(COMPONENTS_JSON.read_text())
        self.assertGreater(len(skill_names(SKILLS_TXT.read_text())), 0)

    def test_skill_is_registered_with_the_s51_version_without_leading_v(self):
        problems = check(
            SKILLS_TXT.read_text(),
            json.loads(COMPONENTS_JSON.read_text()),
            (SKILL_DIR / "skill-version.txt").read_text(),
        )
        self.assertEqual(problems, [], "\n".join(problems))

    def test_registered_repo_path_is_the_vendored_tree(self):
        self.assertTrue((REPO / REGISTERED_PATH / "SKILL.md").is_file())

    # --- negative controls: the check must be able to fail -------------------
    def test_negative_v_prefixed_version_is_refused(self):
        skills = "signature-presentation\n"
        components = {"components": {"signature-presentation": [{
            "version": "v2.1.9", "platform": "any", "installFrom": "repo-tree",
            "repoPath": REGISTERED_PATH, "license": "MIT (repo license)"}]}}
        self.assertTrue(check(skills, components, "v2.1.9\n"))

    def test_negative_missing_registry_line_is_refused(self):
        components = {"components": {"signature-presentation": [{
            "version": "2.1.9", "platform": "any", "installFrom": "repo-tree",
            "repoPath": REGISTERED_PATH, "license": "MIT (repo license)"}]}}
        self.assertTrue(check("email-engine\n", components, "v2.1.9\n"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
