#!/usr/bin/env python3
"""Studio-bridge twin parity: the 999 Drama Studio bridge copy must equal onboarding's.

`option3_runner.py` puts `<skill root>/studio_bridge.py` in the Option-3 scoped
command, and with `CLAUDE_PLUGIN_ROOT` / `DRAMA_STUDIO_SKILL_ROOT` unset the skill
root is the `drama-studio` folder itself. The bridge is the U5 shared studio bridge
whose canonical home is onboarding skill 75's `shared-bridge/`, and `studio_bridge.py`
imports its sibling `studio_claim.py`. Both are recorded in
`references/twin-sync-fingerprints.json` under `studio_bridge_twin`.

This test enforces that record:

- ALWAYS: each packaged file under `.claude/skills/drama-studio/` must hash to the
  canonical sha256 recorded in the twin fingerprints. This runs in CI with no
  network, so a drifted packaged copy is a red build.
- LIVE, when the canonical shared-bridge tree is present: the packaged bytes must
  also be byte-identical to the canonical file, AND the recorded canonical sha256
  must match that live file (so a stale pin is caught too).

Canonical resolution (same shape as `tests/test_parity_layout.py`):
  `DSAF_CANONICAL_SHARED_BRIDGE` env -> else `<build>/onboarding/75-drama-song-ad-factory/shared-bridge`
When the env var is set but the directory is missing, that is a resolve failure and
this test FAILS (never a silent pass). When it is unset and the build-tree default is
missing (a clean install), the live compare is recorded UNDETERMINED and only the
recorded twin fingerprint is enforced - undetermined is not a pass.

Run: python3 tests/test_studio_bridge_twin.py   (stdlib only, no framework, no network)
"""
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
SKILL = HERE.parents[1]                       # .../.claude/skills/drama-song-ad-factory
SKILLS = SKILL.parent                         # .../.claude/skills
REPO = SKILL.parents[2]                       # .../999-setup
BUILD = SKILL.parents[3]                      # <build> (unrelated dir on a clean install)
FINGERPRINTS = SKILL / "references" / "twin-sync-fingerprints.json"
DEFAULT_CANONICAL = BUILD / "onboarding" / "75-drama-song-ad-factory" / "shared-bridge"
ENV = "DSAF_CANONICAL_SHARED_BRIDGE"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def evaluate():
    """Return (rc, lines). rc 0 = pass (live compare may be UNDETERMINED)."""
    lines = []
    if not FINGERPRINTS.is_file():
        return 1, [f"FAIL: twin fingerprints missing: {FINGERPRINTS}"]
    data = json.loads(FINGERPRINTS.read_text(encoding="utf-8"))
    twin = data.get("studio_bridge_twin")
    if not isinstance(twin, dict) or not twin.get("files"):
        return 1, ["FAIL: references/twin-sync-fingerprints.json has no studio_bridge_twin.files block"]

    env_set = ENV in os.environ
    canonical = Path(os.environ[ENV]) if env_set else DEFAULT_CANONICAL
    live = canonical.is_dir()
    if env_set and not live:
        return 1, [f"FAIL: ${ENV} is set but the canonical shared-bridge tree is missing: {canonical}"]

    fails = []
    for name, rec in sorted(twin["files"].items()):
        packed = REPO / rec["packaged"]
        if not packed.is_file():
            fails.append(f"{name}: packaged file missing: {rec['packaged']}")
            lines.append(f"FAIL: {name} packaged file missing: {packed}")
            continue
        got = sha256(packed)
        want = rec["canonical_sha256"]
        if got != want:
            fails.append(f"{name}: packaged sha256 {got} != recorded canonical {want}")
            lines.append(f"FAIL: {name} packaged sha256 {got} != recorded canonical {want}")
        else:
            lines.append(f"ok: {name} packaged sha256 {got} == recorded canonical")
        if live:
            canonical_file = canonical / Path(rec["canonical"]).name
            if not canonical_file.is_file():
                fails.append(f"{name}: canonical file missing: {canonical_file}")
                lines.append(f"FAIL: {name} canonical file missing: {canonical_file}")
                continue
            live_sha = sha256(canonical_file)
            if live_sha != want:
                fails.append(f"{name}: recorded canonical {want} != live canonical {live_sha}")
                lines.append(f"FAIL: {name} recorded canonical {want} != live {live_sha} ({canonical_file})")
            elif live_sha != got:
                fails.append(f"{name}: packaged {got} != live canonical {live_sha}")
                lines.append(f"FAIL: {name} packaged sha256 {got} != live canonical {live_sha} ({canonical_file})")
            else:
                lines.append(f"ok: {name} bytes == live canonical {live_sha}")
        else:
            lines.append(f"UNDETERMINED: {name} live byte compare skipped, canonical shared-bridge absent: {canonical}")

    if not live:
        lines.append("SUMMARY: 0 live compares (canonical absent) - recorded twin fingerprints enforced, live byte compare UNDETERMINED")
    if fails:
        lines.append(f"{len(fails)} FAILED: " + "; ".join(fails))
        return 1, lines
    return 0, lines


def test_studio_bridge_twin():
    rc, lines = evaluate()
    assert rc == 0, "\n".join(lines)


def main():
    rc, lines = evaluate()
    for ln in lines:
        print(ln)
    return rc


if __name__ == "__main__":
    sys.exit(main())
