#!/usr/bin/env python3
import argparse
import shutil
import sys
from pathlib import Path

SKILL_NAME = "blackceo-signature-page"
DEFAULT_ROOTS = {
    "claude-code": [Path.home() / ".claude" / "skills"],
    "codex": [Path.home() / ".agents" / "skills", Path.home() / ".codex" / "skills"],
}


def install_one(root, source, mode, dry_run):
    target = root / SKILL_NAME
    print(f"Target: {target}")
    if target.exists() or target.is_symlink():
        if target.is_symlink():
            try:
                existing = target.resolve()
            except Exception:
                existing = None
            if existing == source:
                print("PASS: target already links to the canonical skill folder.")
                return 0
        print("FAIL: target already exists and will not be overwritten.")
        return 1

    if dry_run:
        print("PASS: dry run only; target is free and no filesystem change was made.")
        return 0

    root.mkdir(parents=True, exist_ok=True)
    if mode == "symlink":
        target.symlink_to(source, target_is_directory=True)
        print("PASS: symlink created.")
    else:
        shutil.copytree(source, target)
        print("PASS: copy created. This copy must be updated intentionally when the canonical skill changes.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Safely install/link the BlackCEO skill into local agent skills roots.")
    parser.add_argument("--runtime", required=True, choices=["claude-code", "codex", "claude-nine", "custom"])
    parser.add_argument("--target-root", type=Path, help="Verified runtime skills root. Required for claude-nine/custom.")
    parser.add_argument("--source", type=Path, help="Canonical skill folder. Defaults to the folder containing this script's parent.")
    parser.add_argument("--mode", choices=["symlink", "copy"], default="symlink")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    source = (args.source or Path(__file__).resolve().parents[1]).expanduser().resolve()
    if not (source / "SKILL.md").exists():
        print(f"FAIL: source is not a skill folder: {source}")
        return 1

    if args.target_root:
        roots = [args.target_root.expanduser().resolve()]
    else:
        roots = DEFAULT_ROOTS.get(args.runtime)
        if roots is None:
            print(f"FAIL: --target-root is required for runtime {args.runtime!r}.")
            return 1

    print(f"Source: {source}")
    print(f"Mode: {args.mode}")
    for root in roots:
        rc = install_one(root, source, args.mode, args.dry_run)
        if rc != 0:
            return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())
