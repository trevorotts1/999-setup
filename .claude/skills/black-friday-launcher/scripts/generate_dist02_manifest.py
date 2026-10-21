#!/usr/bin/env python3
"""Regenerate DIST-02-PACKAGING-MANIFEST.json from the shipped 999 tree.

The manifest is a record of packaged paths, so the path, the file count, the
version and the content digest are measured from disk, never carried forward.
Everything else (provenance, checks, obligations) is preserved from the
manifest already in the tree: this tool never invents history.

Digest definition: ``sha256:<hex>`` where ``<hex>`` is SHA-256 over the
newline-terminated lines ``"<file sha256>  <posix relative path>"``, sorted by
relative path. A directory is measured without ``__pycache__``, ``.pytest_cache``,
``*.pyc``, ``.DS_Store`` or ``.git``.

Usage:
  python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py [--repo DIR]
  python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py --check

``--check`` re-measures and compares without writing; exit 1 on any difference.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

MANIFEST = "DIST-02-PACKAGING-MANIFEST.json"
IGNORED_DIRS = {"__pycache__", ".git", ".pytest_cache"}
IGNORED_NAMES = {".DS_Store"}
IGNORED_SUFFIXES = {".pyc"}

# Measured keys, and the order they are written in.
MEASURED = ("999_path", "files", "999_version", "sha256")

def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def tree_files(directory: Path) -> list[Path]:
    found = []
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        if any(part in IGNORED_DIRS for part in path.parts):
            continue
        if path.name in IGNORED_NAMES or path.suffix in IGNORED_SUFFIXES:
            continue
        found.append(path)
    return sorted(found, key=lambda p: p.relative_to(directory).as_posix())

def measure(path: Path) -> dict:
    """files, tree digest and declared version for one path (file or dir)."""
    if path.is_dir():
        files = tree_files(path)
        lines = "".join(
            f"{file_sha256(p)}  {p.relative_to(path).as_posix()}\n" for p in files)
        digest = hashlib.sha256(lines.encode("utf-8")).hexdigest()
        return {"files": len(files), "sha256": f"sha256:{digest}",
                "999_version": tree_version(path)}
    return {"files": 1, "sha256": f"sha256:{file_sha256(path)}",
            "999_version": None}

def tree_version(directory: Path) -> str | None:
    """The version the tree itself declares, first source that exists."""
    for name in ("VERSION", "skill-version.txt"):
        candidate = directory / name
        if candidate.is_file():
            value = candidate.read_text(encoding="utf-8").strip()
            if value:
                return value
    skill_json = directory / "skill.json"
    if skill_json.is_file():
        try:
            value = json.loads(skill_json.read_text(encoding="utf-8")).get("version")
        except (OSError, ValueError):
            value = None
        if isinstance(value, str) and value.strip():
            return value.strip()
    skill_md = directory / "SKILL.md"
    if skill_md.is_file():
        lines = skill_md.read_text(encoding="utf-8").splitlines()
        if lines and lines[0].strip() == "---":
            for line in lines[1:]:
                if line.strip() == "---":
                    break
                key, sep, value = line.partition(":")
                if sep and key.strip() == "version" and value.strip():
                    return value.strip()
    return None

def registry_measurement(entry: dict, root: Path) -> dict:
    """A registry_line entry is measured against the registry it names."""
    registry = entry.get("999_registry")
    if not registry:
        return {}
    path = root / registry
    if not path.is_file():
        return {"999_path": registry, "files": 0, "sha256": "absent",
                "999_version": None}
    result = {"999_path": registry}
    result.update(measure(path))
    result["999_version"] = None
    name = entry.get("registry_name")
    if name:
        lines = path.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines, start=1):
            if line.strip() == name:
                entry["registry_line"] = number
                break
    return result

def measured_entry(entry: dict, root: Path) -> dict:
    if entry.get("kind") == "registry_line":
        return registry_measurement(entry, root)
    rel = entry.get("999_path")
    if not rel:
        return {}
    path = root / rel
    if not path.exists():
        raise SystemExit(f"FAIL {entry['id']}: 999_path does not exist: {rel}")
    result = {"999_path": rel}
    result.update(measure(path))
    return result

def apply(manifest: dict, root: Path) -> dict:
    for entry in manifest.get("entries", []):
        measurement = measured_entry(entry, root)
        if not measurement:
            continue
        if "999_path" not in entry or entry.get("kind") == "registry_line":
            entry["999_path"] = measurement["999_path"]
        entry["files"] = measurement["files"]
        entry["sha256"] = measurement["sha256"]
        entry["999_version"] = measurement["999_version"]
    return manifest

def dump(manifest: dict) -> str:
    return json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"

def check(path: Path, manifest: dict, root: Path) -> int:
    fresh = json.loads(dump(apply(json.loads(json.dumps(manifest)), root)))
    failures = 0
    for on_disk, remeasured in zip(manifest.get("entries", []),
                                   fresh.get("entries", [])):
        for key in MEASURED:
            if on_disk.get(key) != remeasured.get(key):
                failures += 1
                print(f"MISMATCH {on_disk.get('id')}.{key}: "
                      f"manifest={on_disk.get(key)!r} tree={remeasured.get(key)!r}")
    if failures:
        print(f"FAIL {failures} measured field(s) do not match the tree")
        return 1
    print(f"OK {len(fresh.get('entries', []))} entries match the tree "
          f"({path.name})")
    return 0

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=None,
                        help="repository root (default: discovered from this file)")
    parser.add_argument("--check", action="store_true",
                        help="compare the manifest to the tree; write nothing")
    args = parser.parse_args(argv)

    root = Path(args.repo).resolve() if args.repo else \
        Path(__file__).resolve().parents[4]
    path = root / MANIFEST
    if not path.is_file():
        print(f"FAIL manifest not found: {path}", file=sys.stderr)
        return 2
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if args.check:
        return check(path, manifest, root)
    path.write_text(dump(apply(manifest, root)), encoding="utf-8")
    print(f"WROTE {path}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
