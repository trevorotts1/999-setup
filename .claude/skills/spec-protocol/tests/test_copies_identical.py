#!/usr/bin/env python3
"""The one-implementation files ship in more than one skill. They must stay byte-identical:
  staffing.py        hook-skill/hooks/workflow-guard  ==  spec-protocol/tools/hooks
  capacity_probe.py  hook-skill/hooks/workflow-guard  ==  spec-protocol/tools/hooks  ==  nine-router-setup/scripts/common"""
import hashlib, os, unittest

SK = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
GROUPS = {
    "staffing.py": ["hook-skill/hooks/workflow-guard/staffing.py", "spec-protocol/tools/hooks/staffing.py"],
    "capacity_probe.py": ["hook-skill/hooks/workflow-guard/capacity_probe.py", "spec-protocol/tools/hooks/capacity_probe.py",
                          "nine-router-setup/scripts/common/capacity_probe.py"],
}


def sha(p):
    with open(os.path.join(SK, p), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class Copies(unittest.TestCase):
    def test_identical(self):
        for name, paths in GROUPS.items():
            self.assertEqual(len({sha(p) for p in paths}), 1, "%s differs between %s" % (name, paths))

    def test_gb_per_agent_is_written_once(self):
        # the constant lives in capacity_probe.py; no other tool file may carry its own copy of the number
        import re
        for p in ("spec-protocol/tools/width.sh", "spec-protocol/scripts/common/width.mjs", "spec-protocol/tools/swarm-plan.mjs",
                  "spec-protocol/tools/capacity-resolver.sh", "tools/windows-parity/src/engine.mjs"):
            full = os.path.join(SK, "..", "..", p) if p.startswith("tools/") else os.path.join(SK, p)
            with open(full, encoding="utf-8") as f:
                text = f.read()
            self.assertIsNone(re.search(r"GB_PER_AGENT\s*=\s*[0-9]", text), p + " carries its own GB_PER_AGENT")


if __name__ == "__main__":
    unittest.main(verbosity=2)
