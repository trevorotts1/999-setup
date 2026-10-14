#!/usr/bin/env python3
"""Layout, registry, adapter-hygiene and cross-distribution parity checks.

- required directive-2.2 shape exists
- SKILL.md frontmatter is discoverable (name + description in the header)
- CONTROL/bundled-skills.txt registers this skill and motion-video-plus, and
  still contains every entry that was there before this unit
- packaged scripts/core/ is byte-identical to the canonical OpenClaw core
  (PARITY UNDETERMINED, not a pass, when the canonical tree is absent)
- nothing in this skill writes config-root or router settings (plain claude
  stays non-routed)

Run: python3 tests/test_parity_layout.py
Override canonical path: DSAF_CANONICAL_CORE=/path/to/scripts/core
Override repo root: DSAF_REPO_ROOT=/path/to/999-setup (only needed when this
  copy runs from a config root that holds no checkout above it)
stdlib only, no framework, no network.
"""
import hashlib
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent      # .../<skill>/tests
SKILL = HERE.parent
REGISTRY = Path("CONTROL") / "bundled-skills.txt"
CANONICAL_SUBPATH = Path("onboarding") / ("75-" + SKILL.name) / "scripts" / "core"


def repo_root(start: Path):
    """The real repo root: the nearest ancestor of this file that carries the
    installer registry, else DSAF_REPO_ROOT, else None.

    A fixed depth (`SKILL.parents[2]`) only holds inside a checkout. On a
    packaged install under a config root that same depth lands on the user's
    home, and every registry check then reports a path failure that says
    nothing about parity. Resolve upward from this file instead, so a clone, a
    worktree, a packaged install and a throwaway copy all land on the same root.
    """
    env = os.environ.get("DSAF_REPO_ROOT")
    if env and (Path(env) / REGISTRY).is_file():
        return Path(env)
    for d in (start, *start.parents):
        if (d / REGISTRY).is_file():
            return d
    return None


def resolve_canonical():
    """Same source rule package_core.py documents: the env override, then the
    onboarding staging area up the parent chain of the repo root."""
    env = os.environ.get("DSAF_CANONICAL_CORE")
    if env:
        return Path(env)
    if REPO is None:
        return None
    for base in (REPO, *REPO.parents):
        cand = base / CANONICAL_SUBPATH
        if cand.is_dir():
            return cand
    return REPO.parent / CANONICAL_SUBPATH   # the build-tree guess, for the message


REPO = repo_root(HERE)
CANONICAL = resolve_canonical()

REQUIRED = [
    "SKILL.md", "INSTRUCTIONS.md", "CHANGELOG.md", "VERSION",
    "references/cli-contract.md", "references/parity-contract.md",
    "scripts/core/intake_preflight/factory.py",
    "tests/test_cli_smoke.py", "tests/test_parity_layout.py",
    "assets/example-brief.json",
    "adapters/claude-nine/README.md", "adapters/claude-code/README.md",
]
PRIOR_MANIFEST_ENTRIES = [
    "nine-router-setup", "spec-protocol", "kaizen", "eli5", "bro",
    "blackceo-signature-page", "hook-skill", "kiss",
]
NEW_MANIFEST_ENTRIES = ["motion-video-plus", "drama-song-ad-factory"]

# Assignments that would route plain claude or fork the config root.
FORBIDDEN = [
    (re.compile(r"\bCLAUDE_CONFIG_DIR\s*="), "writes a separate config root"),
    (re.compile(r"\bANTHROPIC_BASE_URL\s*="), "writes a router/model base URL"),
    (re.compile("localhost:" + "20128"), "hardcodes the local router port"),
]
SCAN_SUFFIXES = {".md", ".py", ".sh", ".js", ".mjs", ".ps1", ".json", ".txt"}

FAILS = []
SKIPPED = []


def check(name, ok, detail=""):
    print(f"{'ok' if ok else 'FAIL'}: {name}" + (f" ({detail})" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


def tree_hash(root: Path):
    """sha256 over sorted per-file sha256 lines; skip caches."""
    lines = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if "__pycache__" in rel or rel.endswith(".pyc"):
            continue
        lines.append(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {rel}")
    return hashlib.sha256("\n".join(lines).encode()).hexdigest(), lines


def main():
    # --- shape -----------------------------------------------------------
    for rel in REQUIRED:
        check(f"exists {rel}", (SKILL / rel).exists(), str(SKILL / rel))
    check("references/ non-empty", any((SKILL / "references").glob("*.md")))
    check("scripts/core/ non-empty", any((SKILL / "scripts" / "core").rglob("*.py")))

    # --- frontmatter (same rule the repo's static suite applies) ---------
    skill_md = (SKILL / "SKILL.md").read_text(encoding="utf-8")
    header = "\n".join(skill_md.splitlines()[:30])
    check("SKILL.md name field", "name: drama-song-ad-factory" in header)
    check("SKILL.md description field", "description:" in header)
    version = (SKILL / "VERSION").read_text(encoding="utf-8").strip()
    check("frontmatter matches VERSION", f"version: {version}" in header, version)

    # --- registry --------------------------------------------------------
    if REPO is None:
        # No checkout above this file: a packaged install under a config root
        # carries no registry. Asserting against a fabricated root (the old
        # fixed depth) reported 11 path failures that said nothing about
        # parity; absence of the fixture is undetermined, not a pass and
        # not a fail.
        SKIPPED.append(f"registry (no {REGISTRY} above {HERE})")
        print(f"REGISTRY UNDETERMINED: no {REGISTRY} above this test file "
              f"(looked up from {HERE}) and DSAF_REPO_ROOT is unset")
        print("  (packaged install with no checkout above it; not a pass and not a fail)")
    else:
        manifest = REPO / REGISTRY
        check("bundled-skills.txt present", manifest.is_file())
        names = set()
        if manifest.is_file():
            for raw in manifest.read_text(encoding="utf-8").splitlines():
                line = raw.split("#", 1)[0].strip()
                if line:
                    names.add(line)
        for name in NEW_MANIFEST_ENTRIES:
            check(f"manifest lists {name}", name in names)
        for name in PRIOR_MANIFEST_ENTRIES:
            check(f"manifest still lists prior entry {name}", name in names)

    # --- parity ----------------------------------------------------------
    parity_proven = False
    if CANONICAL is None or not CANONICAL.is_dir():
        where = CANONICAL if CANONICAL is not None else "no repo root to search from"
        SKIPPED.append(str(where))
        print(f"PARITY UNDETERMINED: canonical core not on this machine: {where}")
        print("  (clean install; this is not a parity pass)")
    else:
        parity_proven = True
        ours_hash, ours_lines = tree_hash(SKILL / "scripts" / "core")
        canon_hash, canon_lines = tree_hash(CANONICAL)
        ours = {ln.split("  ", 1)[1] for ln in ours_lines}
        canon = {ln.split("  ", 1)[1] for ln in canon_lines}
        check("packaged core file set matches canonical",
              ours == canon,
              f"only-packaged={sorted(ours - canon)} missing={sorted(canon - ours)}")
        check("packaged core bytes match canonical", ours_hash == canon_hash,
              f"packaged={ours_hash} canonical={canon_hash}")
        print(f"  tree sha256 packaged={ours_hash} canonical={canon_hash}")

    # --- adapter / routing hygiene --------------------------------------
    scanned = 0
    for p in sorted(SKILL.rglob("*")):
        if not p.is_file() or p.suffix not in SCAN_SUFFIXES:
            continue
        scanned += 1
        text = p.read_text(encoding="utf-8", errors="replace")
        for rx, why in FORBIDDEN:
            if rx.search(text):
                check(f"no forbidden write in {p.relative_to(SKILL)}: {why}", False)
    check(f"hygiene scan covered skill text files ({scanned})", scanned > 0)

    if SKIPPED:
        print(f"SKIPPED: {len(SKIPPED)} check (fixture absent) — record as undetermined")
    if FAILS:
        print(f"\n{len(FAILS)} FAILED: " + ", ".join(FAILS))
        return 1
    print("\nALL PASS" + (" (parity proven)" if parity_proven else " (parity undetermined)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
