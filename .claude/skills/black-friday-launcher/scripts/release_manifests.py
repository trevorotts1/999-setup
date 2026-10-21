#!/usr/bin/env python3
"""Generate and verify the client release manifests from a pinned release set.

The release set (``release/release-set.json``) is the one authority for WHAT a
client install receives: the source revision pins, each component's source and
installed paths, the registry lines the installers link, the capability
interfaces (Skills 38, 44, 50) and the shared contracts the Launcher reads. The
manifests are MEASURED from disk — path, file count, version, digest — never
carried forward by hand.

Three manifests are generated:

  installer-manifest.json    what an installer links (registry order + digests)
  updater-manifest.json      what an updater replaces, and what it must preserve
                             (the intentional harness variants, with their reason)
  components-manifest.json   component identity, dependency closure and
                             capability/shared-contract coverage

``parity`` compares the onboarding source tree with the installed 999 tree file
by file under the release set's intentional-variant globs, and records the two
revisions it actually tested. The check is never disabled and an older pass is
never substituted: the report names the exact commits.

Usage:
  python3 release_manifests.py generate [--repo DIR] [--release-set FILE] [--out DIR]
  python3 release_manifests.py check    [--repo DIR] [--release-set FILE]
  python3 release_manifests.py parity   --onb-root DIR --nine-root DIR [--record FILE]

Exit: 0 pass, 1 drift/failure, 2 usage or unreadable input. Stdlib only; no
network; never prints a credential (it reads no credential at all).
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
SKILL_ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from generate_dist02_manifest import file_sha256, measure, tree_files  # noqa: E402

MANIFESTS = {
    "installer-manifest.json": "blackceo.release.installer-manifest/1",
    "updater-manifest.json": "blackceo.release.updater-manifest/1",
    "components-manifest.json": "blackceo.release.components-manifest/1",
}
PARITY_SCHEMA = "blackceo.release.parity-report/1"


class ReleaseError(Exception):
    """A release set or a tree that cannot be measured."""


def _json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ReleaseError(f"cannot read {path}: {exc}") from exc


def git_sha(root: Path) -> Optional[str]:
    try:
        proc = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                              capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    value = proc.stdout.strip()
    return value if proc.returncode == 0 and len(value) == 40 else None


def _glob_match(rel: str, globs: Iterable[str]) -> bool:
    return any(fnmatch.fnmatch(rel, pattern) for pattern in globs)


def _component(release: Dict[str, Any], component_id: str) -> Dict[str, Any]:
    for component in release.get("components", []):
        if component.get("id") == component_id:
            return component
    raise ReleaseError(f"release set names no component {component_id!r}")


def _variants(release: Dict[str, Any], component_id: str) -> List[Dict[str, Any]]:
    return [v for v in release.get("intentional_variants", [])
            if v.get("component") == component_id]


def measure_path(root: Path, rel: str) -> Dict[str, Any]:
    path = root / rel
    if not path.exists():
        raise ReleaseError(f"{rel} does not exist under {root}")
    result = {"path": rel}
    result.update(measure(path))
    return result


def build_components(release: Dict[str, Any], root: Path) -> Dict[str, Any]:
    components: List[Dict[str, Any]] = []
    for spec in release.get("components", []):
        entry: Dict[str, Any] = {
            "id": spec["id"],
            "number": spec.get("number"),
            "source_path": spec.get("source_path"),
            "install_paths": list(spec.get("install_paths") or []),
            "requires": list(spec.get("requires") or []),
            "capabilities": list(spec.get("capabilities") or []),
            "measured": [],
        }
        for rel in entry["install_paths"]:
            measurement = measure_path(root, rel)
            entry["measured"].append(measurement)
        if entry["measured"]:
            entry["version"] = entry["measured"][0].get("999_version")
            entry["files"] = sum(m["files"] for m in entry["measured"])
            entry["sha256"] = entry["measured"][0]["sha256"]
        components.append(entry)
    return {"schema": MANIFESTS["components-manifest.json"],
            "release_id": release["release_id"],
            "pins": release.get("pins"),
            "measured_at": git_sha(root),
            "components": components}


def build_installer(release: Dict[str, Any], root: Path) -> Dict[str, Any]:
    registry = release.get("registry") or {}
    registry_path = registry.get("path", "CONTROL/bundled-skills.txt")
    lines: List[str] = []
    target = root / registry_path
    if target.is_file():
        lines = [line.strip() for line in target.read_text(encoding="utf-8").splitlines()
                 if line.strip() and not line.strip().startswith("#")]
    links: List[Dict[str, Any]] = []
    for spec in release.get("components", []):
        for rel in spec.get("install_paths") or []:
            name = Path(rel).name
            slug = name.split("-", 1)[1] if name.split("-", 1)[0].isdigit() else name
            measurement = measure_path(root, rel)
            links.append({
                "component": spec["id"],
                "registry_name": slug if slug in lines else None,
                "linked_from_registry": slug in lines,
                "install_path": rel,
                "version": measurement.get("999_version"),
                "files": measurement["files"],
                "sha256": measurement["sha256"],
            })
    interfaces = []
    for interface in release.get("capability_interfaces") or []:
        rel = interface["skill_dir"]
        entry = root / rel / interface.get("entry", "SKILL.md")
        interfaces.append({
            "id": interface["id"],
            "skill_dir": rel,
            "entry": interface.get("entry", "SKILL.md"),
            "present": entry.is_file(),
            "purpose": interface.get("purpose"),
        })
    contracts = []
    for rel in release.get("shared_contracts") or []:
        measurement = measure_path(root, rel)
        contracts.append({"path": rel, "files": measurement["files"],
                          "sha256": measurement["sha256"]})
    return {"schema": MANIFESTS["installer-manifest.json"],
            "release_id": release["release_id"],
            "enabled_in_999": bool((release.get("enablement") or {}).get("enabled_in_999")),
            "registry_path": registry_path,
            "expected_registry_lines": registry.get("lines") or [],
            "links": links,
            "capability_interfaces": interfaces,
            "shared_contracts": contracts,
            "measured_at": git_sha(root)}


def build_updater(release: Dict[str, Any], root: Path) -> Dict[str, Any]:
    components: List[Dict[str, Any]] = []
    preserve: List[Dict[str, Any]] = []
    for spec in release.get("components", []):
        variants = _variants(release, spec["id"])
        measurement = measure_path(root, spec["install_paths"][0])
        components.append({
            "id": spec["id"],
            "install_path": spec["install_paths"][0],
            "source_path": spec.get("source_path"),
            "update": "replace_except_variants" if variants else "replace",
            "version": measurement.get("999_version"),
            "files": measurement["files"],
            "sha256": measurement["sha256"],
            "preserve_globs": [g for variant in variants
                               for g in variant.get("globs", [])],
        })
        for variant in variants:
            preserve.append({"component": spec["id"],
                             "globs": list(variant.get("globs") or []),
                             "reason": variant.get("reason")})
    return {"schema": MANIFESTS["updater-manifest.json"],
            "release_id": release["release_id"],
            "pins": release.get("pins"),
            "components": components,
            "preserve_intentional_variants": preserve,
            "rollback": {"rule": ("an update replaces a measured component only after the "
                                  "installer manifest and this manifest agree on its digest; "
                                  "the previous committed digests are the rollback set")},
            "measured_at": git_sha(root)}


def closure(release: Dict[str, Any], root: Path) -> List[str]:
    """Every declared requirement and capability resolves on the installed root."""
    fails: List[str] = []
    known = {c["id"] for c in release.get("components", [])}
    for spec in release.get("components", []):
        for requirement in spec.get("requires") or []:
            if requirement not in known:
                fails.append(f"{spec['id']}: requires {requirement!r}, which the "
                             "release set does not package")
        for rel in spec.get("install_paths") or []:
            if not (root / rel).exists():
                fails.append(f"{spec['id']}: install path {rel!r} is absent")
    for interface in release.get("capability_interfaces") or []:
        entry = root / interface["skill_dir"] / interface.get("entry", "SKILL.md")
        if not entry.is_file():
            fails.append(f"capability interface {interface['id']}: {entry} is absent")
    for rel in release.get("shared_contracts") or []:
        if not (root / rel).exists():
            fails.append(f"shared contract {rel!r} is absent")
    registry = release.get("registry") or {}
    registry_path = root / registry.get("path", "CONTROL/bundled-skills.txt")
    lines = set()
    if registry_path.is_file():
        lines = {line.strip() for line in registry_path.read_text(encoding="utf-8").splitlines()}
    for name in registry.get("lines") or []:
        if name not in lines:
            fails.append(f"registry line {name!r} is absent from {registry['path']}")
    return fails


def generate(release: Dict[str, Any], root: Path, out_dir: Path) -> Dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: Dict[str, Path] = {}
    docs = {
        "installer-manifest.json": build_installer(release, root),
        "updater-manifest.json": build_updater(release, root),
        "components-manifest.json": build_components(release, root),
    }
    for name, doc in docs.items():
        path = out_dir / name
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        written[name] = path
    return written


def check(release: Dict[str, Any], root: Path, out_dir: Path) -> int:
    fails = closure(release, root)
    expected = {
        "installer-manifest.json": build_installer(release, root),
        "updater-manifest.json": build_updater(release, root),
        "components-manifest.json": build_components(release, root),
    }
    for name, fresh in expected.items():
        path = out_dir / name
        if not path.is_file():
            fails.append(f"{name} is absent; run generate")
            continue
        on_disk = _json(path)
        for key, value in fresh.items():
            if key == "measured_at":
                continue
            if on_disk.get(key) != value:
                fails.append(f"{name}.{key} does not match the tree/registry")
    if fails:
        for failure in fails:
            print(f"FAIL {failure}")
        print(f"RELEASE CHECK FAIL: {len(fails)} failure(s)")
        return 1
    print(f"RELEASE CHECK PASS: {len(expected)} manifests match the tree; "
          f"closure and capability interfaces resolve")
    return 0


def _files(root: Path, rel: str) -> Dict[str, Path]:
    tree = root / rel
    if not tree.exists():
        raise ReleaseError(f"{rel} does not exist under {root}")
    if tree.is_file():
        return {rel: tree}
    return {p.relative_to(tree).as_posix(): p for p in tree_files(tree)}


def parity(release: Dict[str, Any], onb_root: Path, nine_root: Path,
           record: Optional[Path] = None) -> int:
    tested = {"openclaw-onboarding": git_sha(onb_root), "999-setup": git_sha(nine_root)}
    results: List[Dict[str, Any]] = []
    failures = 0
    for spec in release.get("components", []):
        source_rel = spec.get("source_path")
        if not source_rel:
            continue
        install_rel = spec["install_paths"][0]
        if spec.get("parity") is False:
            # Measured and named, never claimed as parity: the release set says
            # this component is vendored at another revision. The check is not
            # disabled for it — it is out of this release's parity claim, and
            # the reason is recorded in the report.
            try:
                source_files = len(_files(onb_root, source_rel))
                installed_files = len(_files(nine_root, install_rel))
            except ReleaseError as exc:
                source_files = installed_files = None
                reason = f"{spec.get('parity_note')}; measurement failed: {exc}"
            else:
                reason = spec.get("parity_note") or \
                    "not declared synchronized by the release set"
            results.append({"id": spec["id"], "result": "EXCLUDED",
                            "parity": False,
                            "source_files": source_files,
                            "installed_files": installed_files,
                            "reason": reason})
            continue
        variants = [g for variant in _variants(release, spec["id"])
                    for g in variant.get("globs", [])]
        try:
            source = _files(onb_root, source_rel)
            installed = _files(nine_root, install_rel)
        except ReleaseError as exc:
            results.append({"id": spec["id"], "result": "FAIL", "error": str(exc)})
            failures += 1
            continue
        diffs: List[Dict[str, Any]] = []
        for rel, path in sorted(source.items()):
            target = installed.get(rel)
            allowed = _glob_match(rel, variants)
            if target is None:
                diffs.append({"file": rel, "kind": "missing_in_999",
                              "allowed_variant": allowed})
            elif source[rel].read_bytes() != target.read_bytes():
                diffs.append({"file": rel, "kind": "byte_drift",
                              "allowed_variant": allowed})
        for rel in sorted(set(installed) - set(source)):
            allowed = _glob_match(rel, variants)
            diffs.append({"file": rel, "kind": "999_only",
                          "allowed_variant": allowed})
        unexpected = [d for d in diffs if not d["allowed_variant"]]
        results.append({
            "id": spec["id"],
            "source_path": source_rel,
            "install_path": install_rel,
            "source_files": len(source),
            "installed_files": len(installed),
            "intentional_variants": variants,
            "differences": diffs,
            "unexpected": len(unexpected),
            "result": "FAIL" if unexpected else "PASS",
        })
        if unexpected:
            failures += 1
    report = {"schema": PARITY_SCHEMA,
              "release_id": release["release_id"],
              "tested": tested,
              "result": "FAIL" if failures else "PASS",
              "failures": failures,
              "components": results}
    if record is not None:
        record.parent.mkdir(parents=True, exist_ok=True)
        record.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for result in results:
        print(f"PARITY {result['result']} {result['id']}: "
              f"{result.get('source_files', '?')} source / "
              f"{result.get('installed_files', '?')} installed, "
              f"{result.get('unexpected', 0)} unexpected difference(s)")
        for diff in result.get("differences", []):
            if not diff["allowed_variant"]:
                print(f"  - {diff['kind']}: {diff['file']}")
    print(f"TESTED openclaw-onboarding@{tested['openclaw-onboarding']} "
          f"vs 999-setup@{tested['999-setup']}")
    print(f"PARITY {report['result']}")
    return 1 if failures else 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("generate", "check", "parity"))
    parser.add_argument("--repo", default=None,
                        help="installed repository root (default: discovered)")
    parser.add_argument("--release-set", default=None)
    parser.add_argument("--out", default=None,
                        help="manifest output directory (default: <repo>/release)")
    parser.add_argument("--onb-root", default=None)
    parser.add_argument("--nine-root", default=None)
    parser.add_argument("--record", default=None,
                        help="write the parity report JSON here")
    args = parser.parse_args(argv)
    root = Path(args.repo).resolve() if args.repo else \
        next((c for c in (SKILL_ROOT, *SKILL_ROOT.parents)
              if (c / "shared-utils").is_dir()
              and ((c / ".claude").is_dir() or (c / "CONTROL").is_dir())),
             SKILL_ROOT.parent.parent)
    release_set = Path(args.release_set) if args.release_set else \
        SKILL_ROOT / "release" / "release-set.json"
    # The manifests live OUTSIDE every measured component: a manifest stored
    # inside a component would change that component's digest when written,
    # so `check` could never agree with `generate`.
    out_dir = Path(args.out) if args.out else root / "release"
    try:
        release = _json(release_set)
        if release.get("schema") != "blackceo.release-set/1":
            raise ReleaseError(f"{release_set} is not a release set")
        if args.command == "generate":
            for name, path in generate(release, root, out_dir).items():
                print(f"WROTE {path}")
            return 0
        if args.command == "check":
            return check(release, root, out_dir)
        if not (args.onb_root and args.nine_root):
            print("USAGE: parity needs --onb-root and --nine-root", file=sys.stderr)
            return 2
        return parity(release, Path(args.onb_root), Path(args.nine_root),
                      Path(args.record) if args.record else None)
    except ReleaseError as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
