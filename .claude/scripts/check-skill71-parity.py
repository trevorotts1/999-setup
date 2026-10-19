#!/usr/bin/env python3
"""999-side entry for blackceo-signature-page/verify.sh's parity block.

verify.sh resolves its repository as "$ROOT/../..". In this repository the
skill sits at .claude/skills/<skill>, so that is .claude/, not the repository
root, and verify.sh passes .claude/ as --nine-root. The checker needs the
repository root. Re-aim --nine-root there and run the real checker
(scripts/check-skill71-parity.py, a byte copy of the onboarding one).
"""
import runpy
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CHECKER = REPO / "scripts" / "check-skill71-parity.py"

argv = sys.argv[1:]
for i, arg in enumerate(argv[:-1]):
    if arg == "--nine-root" and Path(argv[i + 1]).name == ".claude":
        argv[i + 1] = str(REPO)
sys.argv = [str(CHECKER)] + argv
runpy.run_path(str(CHECKER), run_name="__main__")
