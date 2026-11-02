#!/usr/bin/env python3
"""Regenerate DIST-02-PACKAGING-MANIFEST.json from the shipped 999 tree.

The manifest is a record of packaged paths, so the path, the file count, the
version and the content digest are measured from disk, never carried forward.
With ``--onboarding DIR`` the source side is measured too: the real onboarding
commit (``git rev-parse HEAD`` of DIR, or ``--source-commit``) and, for every
entry with a ``source_path``, the source tree's version and digest. Without it
the recorded source values are kept as they are. Everything else (checks,
obligations) is preserved from the manifest already in the tree.

Digest definition: ``sha256:<hex>`` where ``<hex>`` is SHA-256 over the
newline-terminated lines ``"<file sha256>  <posix relative path>"``, sorted by
relative path. A directory is measured without ``__pycache__``, ``*.pyc``,
``.DS_Store`` or ``.git``.

Usage:
  python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py [--repo DIR] [--onboarding DIR [--source-commit SHA]]
  python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py --check [--onboarding DIR]
  python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py --self-test

``--check`` re-measures and compares without writing; exit 1 on any difference.
It also exits 1 when a ``vendored`` entry's 999_version differs from its
source_version, or carries no real 40-hex source_commit and source_sha256:
that record would claim a match with onboarding that does not exist. With
``--onboarding`` the source side is re-measured against that checkout as well.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

MANIFEST = "DIST-02-PACKAGING-MANIFEST.json"
IGNORED_DIRS = {"__pycache__", ".git"}
IGNORED_NAMES = {".DS_Store"}
IGNORED_SUFFIXES = {".pyc"}

# Measured keys, and the order they are written in.
MEASURED = ("999_path", "files", "999_version", "sha256")
SOURCE_MEASURED = ("source_commit", "source_version", "source_sha256")
SHA40 = re.compile(r"^[0-9a-f]{40}$")

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

def source_commit_of(onboarding: Path, given: str | None) -> str:
    """The real onboarding commit: the one named, else HEAD of the checkout."""
    if given is None:
        done = subprocess.run(["git", "-C", str(onboarding), "rev-parse", "HEAD"],
                              capture_output=True, text=True)
        given = done.stdout.strip() if done.returncode == 0 else ""
    if not SHA40.match(given):
        raise SystemExit(f"FAIL no 40-hex source commit for {onboarding}: "
                         "pass --source-commit")
    return given

def apply(manifest: dict, root: Path, onboarding: Path | None = None,
          commit: str | None = None) -> dict:
    for entry in manifest.get("entries", []):
        measurement = measured_entry(entry, root)
        if not measurement:
            continue
        if "999_path" not in entry or entry.get("kind") == "registry_line":
            entry["999_path"] = measurement["999_path"]
        entry["files"] = measurement["files"]
        entry["sha256"] = measurement["sha256"]
        entry["999_version"] = measurement["999_version"]
    if onboarding is not None:
        commit = source_commit_of(onboarding, commit)
        for entry in manifest.get("entries", []):
            source = onboarding / entry["source_path"] if entry.get("source_path") else None
            if source is None or not source.exists():
                continue
            found = measure(source)
            entry["source_commit"] = commit
            entry["source_version"] = found["999_version"]
            entry["source_sha256"] = found["sha256"]
        repo = next((s.get("repo") for s in manifest.get("sources", [])
                     if isinstance(s, dict) and s.get("repo")),
                    "trevorotts1/openclaw-onboarding")
        manifest["sources"] = [{
            "repo": repo, "commit": commit,
            "used_for": sorted({e["source_path"] for e in manifest.get("entries", [])
                                if e.get("source_commit") == commit})}]
        declared = (manifest.get("note_contract_location") or {}).get("declared_path")
        if declared:  # measured at the source commit, never a remembered claim
            manifest["note_contract_location"] = {
                "declared_path": declared, "source_commit": commit,
                "present_at_source_commit": (onboarding / declared).is_file()}
    return manifest

def dump(manifest: dict) -> str:
    return json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"

def provenance_failures(manifest: dict) -> list[str]:
    """Self-consistency of the recorded source side; needs no onboarding checkout."""
    found = []
    for entry in manifest.get("entries", []):
        if entry.get("status") != "vendored" or not entry.get("source_path"):
            continue
        name = entry.get("id")
        if not SHA40.match(str(entry.get("source_commit"))) or not entry.get("source_sha256"):
            found.append(f"PROVENANCE {name}: vendored but no real 40-hex source_commit "
                         f"and source_sha256 (commit={entry.get('source_commit')!r})")
        mine, theirs = entry.get("999_version"), entry.get("source_version")
        if (mine or theirs) and str(mine).lstrip("vV") != str(theirs).lstrip("vV"):
            found.append(f"VERSION {name}: 999_version={mine!r} != "
                         f"source_version={theirs!r}; resync from onboarding")
    return found

def check(path: Path, manifest: dict, root: Path, onboarding: Path | None = None,
          commit: str | None = None) -> int:
    fresh = json.loads(dump(apply(json.loads(json.dumps(manifest)), root,
                                  onboarding, commit)))
    failures = 0
    keys = MEASURED + (SOURCE_MEASURED if onboarding is not None else ())
    for on_disk, remeasured in zip(manifest.get("entries", []),
                                   fresh.get("entries", [])):
        for key in keys:
            if on_disk.get(key) != remeasured.get(key):
                failures += 1
                print(f"MISMATCH {on_disk.get('id')}.{key}: "
                      f"manifest={on_disk.get(key)!r} tree={remeasured.get(key)!r}")
    if onboarding is not None:
        for key in ("sources", "note_contract_location"):
            if manifest.get(key) != fresh.get(key):
                failures += 1
                print(f"MISMATCH {key}: manifest={manifest.get(key)!r} "
                      f"source={fresh.get(key)!r}")
    for line in provenance_failures(manifest):
        failures += 1
        print(line)
    if failures:
        print(f"FAIL {failures} field(s) do not match the tree or the source")
        return 1
    print(f"OK {len(fresh.get('entries', []))} entries match the tree "
          f"({path.name})")
    return 0

def self_test() -> int:
    """Fails if --check stops catching false provenance. Offline, temp dirs only."""
    commit = "a" * 40
    with tempfile.TemporaryDirectory() as tmp:
        repo, onb = Path(tmp, "999"), Path(tmp, "onb")
        for base, version in ((repo / "s", "1.0"), (onb / "n", "1.1")):
            base.mkdir(parents=True)
            (base / "skill-version.txt").write_text(version + "\n")
        entry = {"id": "t", "status": "vendored", "999_path": "s", "source_path": "n"}
        path = repo / MANIFEST
        path.write_text(dump({"entries": [entry]}))
        def run(*a):
            with contextlib.redirect_stdout(io.StringIO()):
                return main(["--repo", str(repo), *a])
        assert run("--onboarding", str(onb), "--source-commit", commit) == 0
        recorded = json.loads(path.read_text())["entries"][0]
        assert recorded["source_commit"] == commit and recorded["source_version"] == "1.1"
        # fresh measurements, but 999 is 1.0 and the source 1.1: false provenance, red
        assert run("--check") == 1
        assert run("--check", "--onboarding", str(onb), "--source-commit", commit) == 1
        # resync (999 now carries the source version): green, with and without the checkout
        (repo / "s" / "skill-version.txt").write_text("1.1\n")
        assert run("--onboarding", str(onb), "--source-commit", commit) == 0
        assert run("--check") == 0
        assert run("--check", "--onboarding", str(onb), "--source-commit", commit) == 0
        # a source that moved on is caught when the checkout is named
        (onb / "n" / "skill-version.txt").write_text("1.2\n")
        assert run("--check", "--onboarding", str(onb), "--source-commit", commit) == 1
        # a recorded commit that is not a real sha is refused
        doc = json.loads(path.read_text())
        doc["entries"][0]["source_commit"] = "origin/main"
        path.write_text(dump(doc))
        assert run("--check") == 1
        # drift on an entry that is not vendored is history, not a version claim
        doc["entries"][0].update(status="already_present", source_commit=commit)
        doc["entries"][0]["999_version"] = "9.9"
        path.write_text(dump(doc))
        assert run("--check") == 1  # the tree measurement still catches the stale 999_version
        run()
        assert run("--check") == 0
    print("SELF-TEST PASS")
    return 0

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", default=None,
                        help="repository root (default: discovered from this file)")
    parser.add_argument("--check", action="store_true",
                        help="compare the manifest to the tree; write nothing")
    parser.add_argument("--onboarding", default=None,
                        help="onboarding checkout: measure the source commit, version and digest")
    parser.add_argument("--source-commit", default=None,
                        help="40-hex onboarding commit (default: git HEAD of --onboarding)")
    parser.add_argument("--self-test", action="store_true",
                        help="prove --check catches false provenance, then exit")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()

    root = Path(args.repo).resolve() if args.repo else \
        Path(__file__).resolve().parents[4]
    onboarding = Path(args.onboarding).resolve() if args.onboarding else None
    if onboarding is not None and not onboarding.is_dir():
        print(f"FAIL onboarding checkout not found: {onboarding}", file=sys.stderr)
        return 2
    path = root / MANIFEST
    if not path.is_file():
        print(f"FAIL manifest not found: {path}", file=sys.stderr)
        return 2
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if args.check:
        return check(path, manifest, root, onboarding, args.source_commit)
    path.write_text(dump(apply(manifest, root, onboarding, args.source_commit)),
                    encoding="utf-8")
    print(f"WROTE {path}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
