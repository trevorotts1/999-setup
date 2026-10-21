"""L14/UL-020: release manifests generated from a pinned release set.

Synthetic-local only. The live test runs against this repository (measured,
never written outside a temp dir); the failure tests build tiny temp trees so
they prove the checker discriminates instead of trusting the real tree.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL_ROOT = HERE.parent
REPO_ROOT = SKILL_ROOT.parents[2]
SCRIPT = SKILL_ROOT / "scripts" / "release_manifests.py"
RELEASE_SET = SKILL_ROOT / "release" / "release-set.json"

spec = importlib.util.spec_from_file_location("release_manifests", SCRIPT)
release_manifests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_manifests)


def _tiny_tree(root: Path) -> None:
    """A synthetic installed root: two components, three interfaces, a contract."""
    for rel, text in {
        ".claude/skills/signature-funnel/SKILL.md": "---\nname: signature-funnel\nversion: v9.9.9\n---\n",
        ".claude/skills/signature-funnel/skill-version.txt": "v9.9.9\n",
        ".claude/skills/black-friday-launcher/SKILL.md": "---\nname: black-friday-launcher\nversion: 9.9.9\n---\n",
        ".claude/skills/black-friday-launcher/skill-version.txt": "9.9.9\n",
        ".claude/skills/signature-funnel/notes.txt": "neutral\n",
        ".claude/skills/black-friday-launcher/requirements.txt": "jsonschema>=4.0\n",
        ".claude/skills/conversational-ai-system/SKILL.md": "---\nname: conversational-ai-system\n---\n",
        ".claude/skills/convert-and-flow-operator/SKILL.md": "---\nname: convert-and-flow-operator\n---\n",
        ".claude/skills/email-engine/SKILL.md": "---\nname: email-engine\n---\n",
        "shared-utils/signature_launch/README.md": "contract\n",
        "CONTROL/bundled-skills.txt": "signature-funnel\nblack-friday-launcher\n"
                                      "conversational-ai-system\n"
                                      "convert-and-flow-operator\nemail-engine\n",
    }.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def _tiny_release() -> dict:
    return {
        "schema": "blackceo.release-set/1",
        "release_id": "test-release",
        "pins": {"openclaw-onboarding": {"commit": "0" * 40},
                 "999-setup": {"commit": "1" * 40}},
        "enablement": {"enabled_in_999": True},
        "registry": {"path": "CONTROL/bundled-skills.txt",
                     "lines": ["signature-funnel", "black-friday-launcher",
                               "conversational-ai-system",
                               "convert-and-flow-operator", "email-engine"]},
        "components": [
            {"id": "signature-funnel", "source_path": ".claude/skills/signature-funnel",
             "install_paths": [".claude/skills/signature-funnel"],
             "requires": [], "parity": True},
            {"id": "black-friday-launcher",
             "source_path": ".claude/skills/black-friday-launcher",
             "install_paths": [".claude/skills/black-friday-launcher"],
             "requires": ["signature-funnel"], "parity": True},
        ],
        "capability_interfaces": [
            {"id": "38", "skill_dir": ".claude/skills/conversational-ai-system"},
            {"id": "44", "skill_dir": ".claude/skills/convert-and-flow-operator"},
            {"id": "50", "skill_dir": ".claude/skills/email-engine"},
        ],
        "shared_contracts": ["shared-utils/signature_launch"],
        "intentional_variants": [
            {"component": "black-friday-launcher",
             "globs": ["requirements.txt"], "reason": "999 installer note"},
        ],
    }


class ReleaseManifestTests(unittest.TestCase):
    def test_the_release_set_is_readable_and_pins_both_repositories(self):
        release = json.loads(RELEASE_SET.read_text(encoding="utf-8"))
        self.assertEqual(release["schema"], "blackceo.release-set/1")
        self.assertEqual(len(release["pins"]["openclaw-onboarding"]["commit"]), 40)
        self.assertEqual(len(release["pins"]["999-setup"]["commit"]), 40)

    def test_generate_and_check_agree_on_the_installed_tree(self):
        release = json.loads(RELEASE_SET.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            written = release_manifests.generate(release, REPO_ROOT, out)
            self.assertEqual(sorted(written), sorted(release_manifests.MANIFESTS))
            self.assertEqual(release_manifests.check(release, REPO_ROOT, out), 0)
            installer = json.loads(written["installer-manifest.json"].read_text())
            self.assertTrue(all(link["linked_from_registry"]
                                for line in installer["expected_registry_lines"]
                                for link in installer["links"]
                                if link["registry_name"] == line))

    def test_registry_covers_the_launchers_dependencies(self):
        release = json.loads(RELEASE_SET.read_text(encoding="utf-8"))
        lines = set(release["registry"]["lines"])
        for required in ("signature-funnel", "signature-product-selection",
                         "signature-order-form", "signature-upsell",
                         "signature-downsell", "signature-thank-you",
                         "blackceo-signature-page", "council-of-wise-elders",
                         "black-friday-launcher",
                         "conversational-ai-system", "convert-and-flow-operator",
                         "email-engine"):
            self.assertIn(required, lines)
        live = (REPO_ROOT / "CONTROL" / "bundled-skills.txt").read_text(encoding="utf-8")
        for required in lines:
            self.assertIn(required, live.split())

    def test_capability_interfaces_38_44_50_exist(self):
        release = json.loads(RELEASE_SET.read_text(encoding="utf-8"))
        ids = {interface["id"] for interface in release["capability_interfaces"]}
        self.assertTrue({"38-conversational-ai-system",
                         "44-convert-and-flow-operator",
                         "50-email-engine"} <= ids)
        self.assertEqual(release_manifests.closure(release, REPO_ROOT), [])

    def test_synchronized_components_agree_on_their_version(self):
        release = json.loads(RELEASE_SET.read_text(encoding="utf-8"))
        components = release_manifests.build_components(release, REPO_ROOT)["components"]
        for component in components:
            if component["id"] != "83-black-friday-launcher":
                continue
            self.assertEqual(component["version"], "0.2.6")
        for component in components:
            if component["id"] != "49-signature-funnel":
                continue
            self.assertEqual(component["version"], "v2.1.20")

    def test_closure_blocks_a_missing_registry_line(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _tiny_tree(root)
            release = _tiny_release()
            self.assertEqual(release_manifests.closure(release, root), [])
            registry = root / "CONTROL" / "bundled-skills.txt"
            registry.write_text("signature-funnel\nblack-friday-launcher\n",
                                encoding="utf-8")
            fails = release_manifests.closure(release, root)
            self.assertTrue(any("email-engine" in f for f in fails), fails)

    def test_closure_blocks_a_missing_capability_interface(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _tiny_tree(root)
            release = _tiny_release()
            shutil.rmtree(root / ".claude/skills/email-engine")
            fails = release_manifests.closure(release, root)
            self.assertTrue(any("50" in f for f in fails), fails)

    def test_check_fails_when_a_manifest_is_stale(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _tiny_tree(root)
            out = root / "release"
            release = _tiny_release()
            release_manifests.generate(release, root, out)
            self.assertEqual(release_manifests.check(release, root, out), 0)
            target = root / ".claude/skills/signature-funnel/notes.txt"
            target.write_text("drifted\n", encoding="utf-8")
            self.assertEqual(release_manifests.check(release, root, out), 1)

    def test_parity_detects_drift_and_honours_an_intentional_variant(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            onb, nine = base / "onb", base / "nine"
            _tiny_tree(onb)
            _tiny_tree(nine)
            release = _tiny_release()
            self.assertEqual(release_manifests.parity(release, onb, nine), 0)
            variant = nine / ".claude/skills/black-friday-launcher/requirements.txt"
            variant.write_text("jsonschema>=4.0  # 999 note\n", encoding="utf-8")
            self.assertEqual(release_manifests.parity(release, onb, nine), 0)
            neutral = onb / ".claude/skills/signature-funnel/notes.txt"
            neutral.write_text("changed at the source\n", encoding="utf-8")
            self.assertEqual(release_manifests.parity(release, onb, nine), 1)


if __name__ == "__main__":
    unittest.main()
