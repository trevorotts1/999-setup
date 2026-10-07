#!/usr/bin/env python3
"""Generate the 999 drama-song-ad-factory core from the onboarding-owned canonical core.

Directive 2.4 / unit W3-03-U6: the 999 distribution's scripts/core is GENERATED
from one authoritative source — there is no independently maintained copy.
After any canonical change, re-run this script; never hand-edit the packaged tree.

Source resolution (first hit wins):
  1. --source DIR
  2. DSAF_CANONICAL_CORE environment variable (same name test_parity_layout.py
     uses for the canonical core, so both tools agree on one path)
  3. <repo>/../onboarding/75-drama-song-ad-factory/scripts/core
     (build-tree layout: 999-setup checked out beside the build root's
     onboarding staging area)

Destination defaults to <repo>/.claude/skills/drama-song-ad-factory/scripts/core.

Scope: this tool writes only the packaged tree inside the repository. It never
writes into a Claude config root — packaging must not create a second skills
copy under a personal config root (directive 2.2 / 2.4).

Modes:
  (default)  mirror source -> dest: copy every canonical file, drop files the
             source no longer ships (runtime __pycache__/*.pyc exempt)
  --check    compare only; exit 1 on any drift, 0 when dest matches source
             exactly (file set AND per-file sha256)

Exit codes: 0 ok / match, 1 drift under --check, 2 usage or source error.
stdlib only, no network.

Build-time tool: running it end to end needs the canonical core (build-tree
layout or DSAF_CANONICAL_CORE); a bare 999 clone without the canonical source
stops with an actionable error rather than packaging from nothing.
"""
import argparse
import hashlib
import os
import shutil
import sys
from pathlib import Path

SKILL_NAME = "drama-song-ad-factory"
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DEST = REPO_ROOT / ".claude" / "skills" / SKILL_NAME / "scripts" / "core"
CANONICAL_SUBPATH = Path("onboarding") / ("75-" + SKILL_NAME) / "scripts" / "core"


def resolve_source(arg):
    if arg:
        return Path(arg)
    env = os.environ.get("DSAF_CANONICAL_CORE")
    if env:
        return Path(env)
    # Build-tree layout: onboarding/ sits beside 999-setup (or, from a lane
    # worktree, further up the parent chain). First hit wins.
    for base in (REPO_ROOT, *REPO_ROOT.parents):
        cand = base / CANONICAL_SUBPATH
        if cand.is_dir():
            return cand
    return REPO_ROOT.parent / CANONICAL_SUBPATH


def collect(root):
    """rel-path -> sha256 for every real file under root (parity-test rules)."""
    if not root.is_dir():
        print(
            "package_core: canonical source not found: %s\n"
            "  Pass --source DIR or set DSAF_CANONICAL_CORE to the onboarding-owned\n"
            "  canonical core (directive 2.4). Refusing to package from nothing."
            % root,
            file=sys.stderr,
        )
        raise SystemExit(2)
    out = {}
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if "__pycache__" in rel or rel.endswith(".pyc"):
            continue
        out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def digest(files):
    """Same tree digest test_parity_layout.py prints (insertion order = rglob order)."""
    return hashlib.sha256(
        "\n".join("%s  %s" % (h, rel) for rel, h in files.items()).encode()
    ).hexdigest()


def drift(src_files, dst):
    if not dst.is_dir():
        return ["destination missing: %s" % dst]
    dst_files = collect(dst)
    problems = []
    problems += ["missing: %s" % r for r in sorted(set(src_files) - set(dst_files))]
    problems += ["extra: %s" % r for r in sorted(set(dst_files) - set(src_files))]
    problems += [
        "hash differs: %s" % r
        for r in sorted(set(src_files) & set(dst_files))
        if src_files[r] != dst_files[r]
    ]
    return problems


def sync(src, dst, src_files):
    dst.mkdir(parents=True, exist_ok=True)
    written = 0
    for rel, want in src_files.items():
        s, d = src / rel, dst / rel
        if d.is_file() and hashlib.sha256(d.read_bytes()).hexdigest() == want:
            continue
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(s, d)
        written += 1
    removed = 0
    for p in sorted(dst.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(dst).as_posix()
        if "__pycache__" in rel or rel.endswith(".pyc"):
            continue
        if rel not in src_files:
            p.unlink()
            removed += 1
    return written, removed


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", help="canonical core directory (else DSAF_CANONICAL_CORE, else build-tree default)")
    ap.add_argument("--dest", help="packaged core directory (else this repo's skill scripts/core)")
    ap.add_argument("--check", action="store_true", help="verify only; exit 1 on drift")
    a = ap.parse_args(argv)

    src = resolve_source(a.source)
    dst = Path(a.dest) if a.dest else DEFAULT_DEST
    src, dst = src.resolve(), dst.resolve()
    if src == dst:
        raise SystemExit("package_core: source and destination are the same path: %s" % src)
    if src in dst.parents or dst in src.parents:
        raise SystemExit("package_core: source/destination overlap: %s vs %s" % (src, dst))

    src_files = collect(src)

    if a.check:
        problems = drift(src_files, dst)
        if problems:
            print("package_core --check: %d problem(s), dest=%s" % (len(problems), dst))
            for p in problems:
                print("  " + p)
            return 1
        print("package_core --check: OK  %d files match canonical" % len(src_files))
        print("  tree sha256 packaged=%s canonical=%s" % (digest(collect(dst)), digest(src_files)))
        return 0

    written, removed = sync(src, dst, src_files)
    problems = drift(src_files, dst)
    if problems:
        print("package_core: post-write verification FAILED")
        for p in problems:
            print("  " + p)
        return 1
    print(
        "package_core: OK  %d files (%d written, %d stale removed) source=%s dest=%s"
        % (len(src_files), written, removed, src, dst)
    )
    print("  tree sha256 packaged=%s canonical=%s" % (digest(src_files), digest(src_files)))
    print("  packaged tree only — no Claude config root was read or written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
