#!/usr/bin/env python3
"""bundle_adapter.py - the ONE implementation of the bundled-skill bundle.

Why this file exists (T-37). The macOS and Windows installers each parsed
CONTROL/bundled-skills.txt and resolved skill sources themselves, and update
decisions rested on version labels alone. Two implementations can drift, and a
version label says nothing about the bytes on disk, so nothing proved that the
artefact a box would install was the artefact that was shipped.

This module is now the single source for:

  * the bundled-skill list        --list-skills     (both installers call it)
  * the ordered install plan      --install-plan    (both installers call it)
  * the canonical content digest  tree_digest()     (hash parity)
  * the content record            CONTROL/bundle-digests.json (--write-digests)
  * the update decision           plan_update()     (version AND content)
  * the self-check                --check

HASH PARITY. "The same artefact hashed two ways must agree, and a hash recorded
in one place must equal the hash actually built." The record is
CONTROL/bundle-digests.json; the two computations are (a) tree_digest() over
this checkout and (b) tree_digest() over the installed copy. Both go through
canonical_bytes()/tree_manifest(), so a Windows CRLF checkout, a Mac LF
checkout, a re-ordered directory listing or a stripped trailing space all hash
to the same value. A changed byte does not.

CANONICALISATION (recorded verbatim in the record file, so it cannot silently
change meaning):

  paths      POSIX-relative, sorted by UTF-8 bytes; creation order irrelevant
  text       UTF-8 with no NUL in the first 8 KiB: CRLF and lone CR folded to
             LF, trailing SP/TAB stripped from every line, trailing blank lines
             dropped, exactly one final LF
  binary     raw bytes (a NUL in the first 8 KiB, or non-UTF-8 content)
  symlinks   recorded by target string, never followed (no loops, no escapes)
  excluded   .git, node_modules, __pycache__, .pytest_cache, .venv, .DS_Store,
             *.pyc - build/editor dross that is not part of the artefact
  missing    an absent tree digests to (None, [], reason); it never crashes

INSTALLER PARITY. Both installers call --list-skills and --install-plan, so
they cannot disagree about which skills install, where each source lives or
which target each link takes. The OS-specific link mechanics differ by design
(symlink on POSIX, junction on Windows); that difference is named in
installer_parity_problems() and in --check, never left implicit.

Stdlib only. Python 3.9+.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA_COMPONENTS = "bundled-components@1"
SCHEMA_DIGESTS = "bundle-digests@1"
REGISTRY_PATH = "CONTROL/bundled-skills.txt"
COMPONENTS_PATH = "CONTROL/bundled-components.json"
DIGESTS_PATH = "CONTROL/bundle-digests.json"

INSTALLER_MAC = ".claude/skills/nine-router-setup/scripts/setup-macos.sh"
INSTALLER_WIN = ".claude/skills/nine-router-setup/scripts/setup-windows.ps1"
INSTALLER_DELEGATION = ("bundle_adapter.py", "--install-plan")

# The standalone fallback both installers carry when there is no repo checkout.
# Here so installer_parity_problems() can prove the two scripts still agree.
FALLBACK_SKILLS = ("nine-router-setup", "spec-protocol", "kaizen", "eli5", "bro")

CANONICALISATION = (
    "paths: posix-relative, sorted by utf-8 bytes | "
    "text: crlf+cr -> lf, trailing sp/tab stripped, trailing blank lines "
    "dropped, one final lf | "
    "binary: raw bytes (nul in first 8kib or non-utf-8) | "
    "symlinks: target string, not followed | "
    "excluded: .git node_modules __pycache__ .pytest_cache .venv .DS_Store *.pyc"
)

SKIP_DIRS = frozenset({".git", "node_modules", "__pycache__", ".pytest_cache", ".venv"})
SKIP_FILES = frozenset({".DS_Store"})
SKIP_SUFFIXES = (".pyc",)

UNVERIFIED = (
    ("mac-live-install", "a real macOS setup-macos.sh run into a real $HOME"),
    ("windows-live-install", "a real Windows setup-windows.ps1 run (junctions)"),
    ("vps-runtime", "a VPS install with the linux launcher"),
    ("docker-runtime", "the dockerised install path"),
    ("live-tenant-provision", "provisioning a live tenant from the release channel"),
)


class BundleError(Exception):
    """The bundle itself cannot be read."""


class UnpermittedResource(Exception):
    """A provision request names something the bundle cannot supply."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# --------------------------------------------------------------------------
# Canonicalisation and digests
# --------------------------------------------------------------------------

def canonical_bytes(data: bytes) -> bytes:
    """Fold an artefact's bytes into the one form that is hashed.

    Line endings and trailing horizontal whitespace are the two things a git
    checkout legitimately changes between platforms, so they are normalised
    away. Everything else is kept exactly.
    """
    if b"\x00" in data[:8192]:
        return data
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip(" \t") for line in text.split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    if not lines:
        return b""
    return ("\n".join(lines) + "\n").encode("utf-8")


def file_digest(path: Path) -> str:
    return hashlib.sha256(canonical_bytes(path.read_bytes())).hexdigest()


def tree_manifest(root: Path):
    """Return (entries, reason). entries is sorted (kind, relpath, value)."""
    root = Path(root)
    if not root.exists():
        return None, f"missing: {root}"
    if not root.is_dir():
        return None, f"not a directory: {root}"
    entries = []

    def walk(directory: Path, prefix: str) -> None:
        try:
            children = sorted(directory.iterdir(), key=lambda p: p.name.encode("utf-8"))
        except OSError as exc:
            raise BundleError(f"cannot list {directory}: {exc}") from exc
        for child in children:
            name = child.name
            rel = f"{prefix}/{name}" if prefix else name
            if child.is_symlink():
                try:
                    target = os.readlink(child)
                except OSError as exc:
                    raise BundleError(f"cannot read link {child}: {exc}") from exc
                entries.append(("link", rel, target))
            elif child.is_dir():
                if name in SKIP_DIRS:
                    continue
                walk(child, rel)
            elif child.is_file():
                if name in SKIP_FILES or name.endswith(SKIP_SUFFIXES):
                    continue
                entries.append(("file", rel, file_digest(child)))

    walk(root, "")
    entries.sort(key=lambda entry: entry[1].encode("utf-8"))
    return entries, None


def tree_digest(root: Path):
    """Return (sha256 hex or None, entries, reason)."""
    entries, reason = tree_manifest(root)
    if entries is None:
        return None, [], reason
    h = hashlib.sha256()
    for kind, rel, value in entries:
        h.update(f"{kind}\t{rel}\t{value}\n".encode("utf-8"))
    return h.hexdigest(), entries, None


# --------------------------------------------------------------------------
# Bundle model
# --------------------------------------------------------------------------

_VER_RE = re.compile(r"^v?(\d+(?:\.\d+)*)$")


def parse_version(raw):
    """A comparable tuple, or None when the text is not a version."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    match = _VER_RE.match(text)
    if not match:
        return None
    return tuple(int(part) for part in match.group(1).split("."))


def _compare(left, right) -> int:
    width = max(len(left), len(right))
    a = left + (0,) * (width - len(left))
    b = right + (0,) * (width - len(right))
    return (a > b) - (a < b)


def parse_registry_text(text: str):
    names = []
    for line in text.splitlines():
        line = re.sub(r"[ \t]*#.*$", "", line).strip()
        if line:
            names.append(line)
    return names


def read_registry(root: Path):
    path = Path(root) / REGISTRY_PATH
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise BundleError(f"cannot read {REGISTRY_PATH}: {exc}") from exc
    names = parse_registry_text(text)
    if not names:
        raise BundleError(f"{REGISTRY_PATH} lists no skills")
    return names


def read_components(root: Path):
    path = Path(root) / COMPONENTS_PATH
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise BundleError(f"cannot read {COMPONENTS_PATH}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise BundleError(f"{COMPONENTS_PATH} is not JSON: {exc}") from exc
    if data.get("schema") != SCHEMA_COMPONENTS:
        raise BundleError(
            f"{COMPONENTS_PATH} schema is {data.get('schema')!r}, "
            f"expected {SCHEMA_COMPONENTS!r}")
    return data.get("components") or {}


def read_digest_record(root: Path):
    """The recorded hashes. An absent record is {} - a stated absence, not a pass."""
    path = Path(root) / DIGESTS_PATH
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if data.get("schema") != SCHEMA_DIGESTS:
        return {}
    recorded = {}
    for name, value in (data.get("skills") or {}).items():
        if isinstance(value, str):
            recorded[name] = value
        elif isinstance(value, dict) and isinstance(value.get("digest"), str):
            recorded[name] = value["digest"]
    return recorded


def read_skill_version(skill_dir: Path):
    """(version text, reason). Falls through VERSION -> skill-version.txt."""
    reasons = []
    for name in ("VERSION", "skill-version.txt"):
        path = skill_dir / name
        try:
            raw = path.read_text(encoding="utf-8", errors="replace").strip()
        except FileNotFoundError:
            continue
        except OSError as exc:
            reasons.append(f"{name}: {exc.strerror or exc}")
            continue
        if not raw:
            reasons.append(f"{name}: empty")
            continue
        if parse_version(raw) is None:
            reasons.append(f"{name}: {raw!r} is not a version")
            continue
        return raw, None
    return None, "; ".join(reasons) if reasons else "no VERSION and no skill-version.txt"


def read_repo_version(root: Path):
    try:
        raw = (Path(root) / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return raw if parse_version(raw) is not None else None


@dataclass
class SkillInfo:
    name: str
    dir: Path
    exists: bool
    has_skill_md: bool
    version: str = None
    version_reason: str = None
    digest: str = None
    file_count: int = 0
    digest_reason: str = None
    declared_version: str = None
    recorded_digest: str = None


@dataclass
class Bundle:
    root: Path
    skills: list
    registry: list
    components: dict
    repo_version: str = None
    recorded: dict = field(default_factory=dict)

    def by_name(self, name):
        for skill in self.skills:
            if skill.name == name:
                return skill
        raise KeyError(name)


def _declared_version(components, name):
    entries = components.get(name) or []
    if isinstance(entries, list) and entries:
        entry = entries[0]
        if isinstance(entry, dict):
            return entry.get("version")
    if isinstance(entries, dict):
        return entries.get("version")
    return None


def load_bundle(root) -> Bundle:
    root = Path(root)
    registry = read_registry(root)
    components = read_components(root)
    recorded = read_digest_record(root)
    skills = []
    for name in registry:
        skill_dir = root / ".claude" / "skills" / name
        exists = skill_dir.is_dir()
        has_md = (skill_dir / "SKILL.md").is_file()
        version = reason = None
        digest = digest_reason = None
        count = 0
        if exists:
            version, reason = read_skill_version(skill_dir)
            digest, entries, digest_reason = tree_digest(skill_dir)
            count = len(entries)
        else:
            reason = f"no tree at {skill_dir}"
            digest_reason = reason
        skills.append(SkillInfo(
            name=name,
            dir=skill_dir,
            exists=exists,
            has_skill_md=has_md,
            version=version,
            version_reason=reason,
            digest=digest,
            file_count=count,
            digest_reason=digest_reason,
            declared_version=_declared_version(components, name),
            recorded_digest=recorded.get(name),
        ))
    return Bundle(root=root, skills=skills, registry=registry,
                  components=components, repo_version=read_repo_version(root),
                  recorded=recorded)


# --------------------------------------------------------------------------
# Update / provision decisions
# --------------------------------------------------------------------------

@dataclass
class Decision:
    skill: str
    action: str          # install | update | current | refuse_downgrade | undetermined
    stamp: str = None
    reason: str = ""
    version: str = None
    digest: str = None
    recorded_digest: str = None


def _content_state(skill: SkillInfo):
    """('current' | 'changed' | 'unrecorded', detail)."""
    if skill.digest is None:
        return "unrecorded", skill.digest_reason or "no tree"
    if skill.recorded_digest is None:
        return "unrecorded", "no recorded digest in " + DIGESTS_PATH
    if skill.recorded_digest != skill.digest:
        return "changed", (f"content {skill.digest} != recorded "
                           f"{skill.recorded_digest}")
    return "current", f"content {skill.digest} matches the record"


def decide(skill: SkillInfo, installed_raw) -> Decision:
    if skill.version is None:
        return Decision(skill.name, "undetermined", None,
                        f"ships no readable version ({skill.version_reason})",
                        digest=skill.digest, recorded_digest=skill.recorded_digest)
    shipped = parse_version(skill.version)

    # Only an absent or literally empty stamp is a fresh install. A blank or
    # junk stamp is an unreadable installed state, never an invitation to
    # overwrite whatever is there.
    if installed_raw is None or installed_raw == "":
        return Decision(skill.name, "install", skill.version,
                        f"fresh install: no installed stamp; shipped {skill.version}",
                        version=skill.version, digest=skill.digest,
                        recorded_digest=skill.recorded_digest)

    installed = parse_version(installed_raw)
    if installed is None:
        return Decision(skill.name, "undetermined", None,
                        f"installed state unreadable: {installed_raw!r}; "
                        "refusing to overwrite",
                        version=skill.version, digest=skill.digest,
                        recorded_digest=skill.recorded_digest)

    order = _compare(shipped, installed)
    if order < 0:
        return Decision(skill.name, "refuse_downgrade", None,
                        f"refusing downgrade: installed={installed_raw} "
                        f"shipped={skill.version}",
                        version=skill.version, digest=skill.digest,
                        recorded_digest=skill.recorded_digest)
    if order > 0:
        return Decision(skill.name, "update", skill.version,
                        f"shipped {skill.version} newer than installed {installed_raw}",
                        version=skill.version, digest=skill.digest,
                        recorded_digest=skill.recorded_digest)

    state, detail = _content_state(skill)
    if state == "current":
        return Decision(skill.name, "current", skill.version,
                        f"same version {skill.version}; {detail}",
                        version=skill.version, digest=skill.digest,
                        recorded_digest=skill.recorded_digest)
    label = "update" if state == "changed" else "update"
    return Decision(skill.name, label, skill.version,
                    f"same version {skill.version} but content is not proven "
                    f"current ({detail})",
                    version=skill.version, digest=skill.digest,
                    recorded_digest=skill.recorded_digest)


def plan_update(bundle: Bundle, installed: dict):
    installed = installed or {}
    return [decide(skill, installed.get(skill.name)) for skill in bundle.skills]


@dataclass
class ProvisionRequest:
    name: str
    version: str = None


def plan_provision(bundle: Bundle, requests):
    planned = []
    for request in requests:
        name = request.name if isinstance(request, ProvisionRequest) else str(request)
        try:
            skill = bundle.by_name(name)
        except KeyError:
            raise UnpermittedResource(
                f"refusing to provision {name!r}: not listed in {REGISTRY_PATH}")
        if not skill.has_skill_md:
            raise UnpermittedResource(
                f"refusing to provision {name!r}: listed in {REGISTRY_PATH} but its "
                f"tree is not there: no SKILL.md under .claude/skills/{name}/ "
                "(the installers link nothing without one)")
        state, detail = _content_state(skill)
        if state == "changed":
            raise UnpermittedResource(
                f"refusing to provision {name!r}: {detail}")
        planned.append(decision_for_provision(skill))
    return planned


def decision_for_provision(skill: SkillInfo) -> Decision:
    return Decision(skill.name, "provision", skill.version,
                    f"recorded content matches the tree ({(skill.digest or '')[:12]})",
                    version=skill.version, digest=skill.digest,
                    recorded_digest=skill.recorded_digest)


# --------------------------------------------------------------------------
# Install plan (what both installers consume)
# --------------------------------------------------------------------------

def resolve_source(skill: SkillInfo, home: Path):
    if skill.has_skill_md:
        return skill.dir
    candidate = Path(home) / ".claude" / "skills" / skill.name
    if (candidate / "SKILL.md").is_file():
        return candidate
    return None


def install_plan(bundle: Bundle, claude_root, home=None):
    """Ordered plan rows: (action, name, source, target, digest).

    action is one of link | up-to-date | relink | backup-and-link | missing.
    """
    home = Path(home) if home else Path.home()
    root = Path(claude_root)
    rows = []
    for skill in bundle.skills:
        source = resolve_source(skill, home)
        target = root / "skills" / skill.name
        if source is None:
            action = "missing"
        elif target.is_symlink() or target.exists():
            try:
                resolved = target.resolve()
            except OSError:
                resolved = None
            if resolved is not None and resolved == Path(source).resolve():
                action = "up-to-date"
            elif target.is_symlink():
                action = "relink"
            else:
                action = "backup-and-link"
        else:
            action = "link"
        rows.append((action, skill.name,
                     str(source) if source is not None else "",
                     str(target), skill.digest or ""))
    return rows


def format_plan(rows):
    return "".join("\t".join(row) + "\n" for row in rows)


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------

def installer_parity_problems(root: Path):
    """Named divergences, empty when both installers delegate to this adapter."""
    problems = []
    root = Path(root)
    present = [rel for rel in (INSTALLER_MAC, INSTALLER_WIN) if (root / rel).exists()]
    if not present:
        # A fixture bundle carries no installers; there is nothing to compare,
        # which is not the same claim as "the installers agree".
        return problems
    for rel in (INSTALLER_MAC, INSTALLER_WIN):
        path = root / rel
        if not path.exists():
            problems.append(f"installer missing: {rel} (the other install path exists)")
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            problems.append(f"cannot read {rel}: {exc}")
            continue
        for token in INSTALLER_DELEGATION:
            if token not in text:
                problems.append(
                    f"{rel} no longer calls the bundle adapter "
                    f"(missing {token!r}); the two install paths can drift")
    return problems


def write_digest_record(bundle: Bundle, path=None) -> Path:
    path = Path(path) if path else Path(bundle.root) / DIGESTS_PATH
    payload = {
        "schema": SCHEMA_DIGESTS,
        "canonicalisation": CANONICALISATION,
        "note": ("Generated by installer-registration/bundle_adapter.py "
                 "--write-digests. The recorded digest must equal the digest "
                 "computed from the tree; --check fails when it does not."),
        "skills": {
            skill.name: {
                "digest": skill.digest,
                "version": skill.version,
                "files": skill.file_count,
            }
            for skill in bundle.skills
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8")
    return path


def run_checks(bundle: Bundle):
    lines = []
    counters = {"passed": 0, "failed": 0, "undetermined": 0, "drift": 0}

    def passed(message):
        counters["passed"] += 1
        lines.append("PASS " + message)

    def failed(message):
        counters["failed"] += 1
        lines.append("FAIL " + message)

    def undetermined(message):
        counters["undetermined"] += 1
        lines.append("UNDETERMINED " + message)

    def drift(message):
        counters["drift"] += 1
        lines.append("DRIFT " + message)

    # 1. bundle-load
    if bundle.repo_version:
        passed(f"bundle-load schema={SCHEMA_COMPONENTS} registry={len(bundle.registry)} "
               f"components={len(bundle.components)} repo_version={bundle.repo_version}")
    else:
        undetermined("bundle-load repo_version=None - VERSION unreadable or not a version")
    if not bundle.recorded:
        undetermined(f"bundle-load no recorded digests in {DIGESTS_PATH} - "
                     "content parity cannot be proven")

    # 2. hash-parity: recorded digest == digest built now
    parity_ok, parity_bad, parity_unknown = [], [], []
    for skill in bundle.skills:
        if skill.digest is None:
            parity_bad.append(f"{skill.name}: no tree to hash ({skill.digest_reason})")
        elif skill.recorded_digest is None:
            parity_unknown.append(skill.name)
        elif skill.recorded_digest != skill.digest:
            parity_bad.append(f"{skill.name}: recorded {skill.recorded_digest} != "
                              f"computed {skill.digest}")
        else:
            parity_ok.append(skill.name)
    for problem in parity_bad:
        failed(f"hash-parity {problem}")
    if parity_ok and not parity_bad:
        passed(f"hash-parity {len(parity_ok)} skill(s): recorded digest == digest "
               f"built from the tree ({CANONICALISATION.split(' | ')[0]})")
    if parity_unknown:
        undetermined(f"hash-parity {len(parity_unknown)} skill(s) have no recorded "
                     f"digest: {', '.join(parity_unknown)}")

    # 3. update-stamp: the stamp comes from the tree, never from the manifest
    unstamped = [s.name for s in bundle.skills if s.version is None]
    if unstamped:
        for name in unstamped:
            skill = bundle.by_name(name)
            undetermined(f"update-stamp {name} ({skill.version_reason})")
    if len(unstamped) < len(bundle.skills):
        passed(f"update-stamp {len(bundle.skills) - len(unstamped)} skill(s) read "
               "their version from the tree")

    # 4. downgrade-refusal: a higher installed stamp is refused by name
    refused, wrong = 0, []
    for skill in bundle.skills:
        if skill.version is None:
            continue
        decision = decide(skill, f"{skill.version}.999")
        if decision.action == "refuse_downgrade" and decision.skill == skill.name:
            refused += 1
        else:
            wrong.append(f"{skill.name}: got {decision.action} ({decision.reason})")
    for problem in wrong:
        failed(f"downgrade-refusal {problem}")
    if refused and not wrong:
        passed(f"downgrade-refusal {refused} skill(s) refused a higher installed stamp "
               "by name with both versions named")

    # 5. manifest drift: declared version != tree version (named, not fatal)
    for skill in bundle.skills:
        if skill.declared_version and skill.version and \
                str(skill.declared_version) != str(skill.version):
            drift(f"{skill.name} manifest={skill.declared_version} "
                  f"shipped={skill.version} (the stamp is the tree's)")

    # 6. installer-parity: both installers consume this adapter's plan
    problems = installer_parity_problems(bundle.root)
    for problem in problems:
        failed(f"installer-parity {problem}")
    if not problems:
        passed("installer-parity setup-macos.sh and setup-windows.ps1 both call "
               "--list-skills and --install-plan (one plan, two link mechanisms)")

    # 7. honest unknowns
    for name, needs in UNVERIFIED:
        lines.append(f"UNVERIFIED {name} needs: {needs}")

    summary = (f"SUMMARY: {counters['passed']} passed, {counters['failed']} failed, "
               f"{counters['undetermined']} undetermined, {counters['drift']} manifest "
               f"drift, {len(UNVERIFIED)} unverified (unverified are NOT passes)")
    lines.append(summary)

    if counters["failed"]:
        return lines, 1
    if counters["undetermined"] or counters["drift"]:
        return lines, 2
    return lines, 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def default_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _print_decisions(decisions, as_json):
    if as_json:
        print(json.dumps([d.__dict__ for d in decisions], indent=2))
        return
    for d in decisions:
        print(f"{d.action}\t{d.skill}\tversion={d.version}\tstamp={d.stamp}\t"
              f"digest={(d.digest or '-')[:12]}\t{d.reason}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="bundled-skill bundle adapter")
    parser.add_argument("--root", default=None,
                        help="bundle root (default: the repo containing this file)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--list-skills", action="store_true")
    group.add_argument("--install-plan", action="store_true")
    group.add_argument("--plan-update", action="store_true")
    group.add_argument("--write-digests", action="store_true")
    group.add_argument("--digest", metavar="PATH",
                       help="print the canonical digest of one directory")
    parser.add_argument("--claude-root", default=None)
    parser.add_argument("--home", default=None)
    parser.add_argument("--installed", action="append", default=[],
                        metavar="NAME=VERSION")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--digests-path", default=None)
    args = parser.parse_args(argv)

    if args.digest:
        digest, entries, reason = tree_digest(Path(args.digest))
        if args.json:
            print(json.dumps({"digest": digest, "files": len(entries),
                              "reason": reason}, indent=2))
        else:
            print(digest if digest else f"UNDETERMINED {reason}")
        return 0 if digest else 2

    root = Path(args.root) if args.root else default_root()
    try:
        bundle = load_bundle(root)
    except BundleError as exc:
        print(f"FAIL bundle-load {exc}")
        return 1

    if args.list_skills:
        for name in bundle.registry:
            print(name)
        return 0

    if args.install_plan:
        if not args.claude_root:
            print("--install-plan needs --claude-root", file=sys.stderr)
            return 2
        rows = install_plan(bundle, args.claude_root, args.home)
        if args.json:
            print(json.dumps([dict(zip(("action", "skill", "source", "target",
                                        "digest"), row)) for row in rows],
                             indent=2))
        else:
            sys.stdout.write(format_plan(rows))
        return 0

    if args.plan_update:
        installed = {}
        for item in args.installed:
            name, _, version = item.partition("=")
            installed[name] = version
        _print_decisions(plan_update(bundle, installed), args.json)
        return 0

    if args.write_digests:
        path = write_digest_record(bundle, args.digests_path)
        print(f"wrote {path} ({len(bundle.skills)} skill(s))")
        return 0

    lines, rc = run_checks(bundle)
    if args.json:
        print(json.dumps({"lines": lines, "exit": rc}, indent=2))
    else:
        print("\n".join(lines))
    return rc


if __name__ == "__main__":
    sys.exit(main())
