#!/usr/bin/env python3
"""helper-deps.py — pin, install and preflight the KIE helper skills (W3-03-U5).

A clean 999 install must RECEIVE the provider helpers the factory invokes;
a reference to an onboarding skill does not install it (directive 2.4).
Pinned versions and sha256 hashes live in helper-dependencies.json.

  install    verify the vendored helpers against the pins, copy each one into
             <config root>/skills/<name> (an existing different copy is backed
             up externally first, never deleted), then run preflight. One run
             covers EVERY config root the machine has: with no --root and no
             CLAUDE_CONFIG_DIR that is both ~/.claude and ~/.claude-nine when
             both exist, so plain claude and claude-nine receive the same set.
  preflight  exit 0 only when every required helper is present at its pinned
             tree hash in every root; otherwise exit 1 naming each failing
             helper, the root and the exact repair command (actionable; stdlib
             only; never prints secret values — none are read)
  repin      recompute the pins from installer-registration/helpers/ —
             operator action when a helper is upgraded; review the diff

Exit codes: 0 ok, 1 a check failed, 2 usage/internal error.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_MANIFEST = HERE / "helper-dependencies.json"
HELPERS_DIR = HERE / "helpers"
SCHEMA = "blackceo.helper-dependencies/v1"

# What ships, and where each helper comes from: the onboarding-owned canonical
# repository named in directive section 5.1. name = directory installed under
# <config root>/skills/. kind "skill" is a folder with SKILL.md; kind "files"
# is a pinned set of shared files that is not a skill of its own (KIE-U1).
HELPER_SPECS = [
    ("66", "66-kie-image", "kie-image",
     "KIE image model selection, prompt constraints, domain QC",
     "openclaw-onboarding/66-kie-image", "skill"),
    ("67", "67-kie-video", "kie-video",
     "KIE video routing (no hardcoded model registry)",
     "openclaw-onboarding/67-kie-video", "skill"),
    ("68", "68-kie-audio", "kie-audio",
     "KIE/Suno audio request contract, model selection, domain QC",
     "openclaw-onboarding/68-kie-audio", "skill"),
    ("74", "74-kie-live-adapter", "kie-live-adapter",
     "KIE paid transport: discovery, schemas, upload, submit, poll, credits",
     "openclaw-onboarding/74-kie-live-adapter", "skill"),
    ("46", "46-kie-callback-relay", "kie-callback-relay",
     "Callback relay (webhook-primary result path for paid generations)",
     "openclaw-onboarding/46-kie-callback-relay", "skill"),
    ("07", "07-kie-setup", "kie-setup",
     "KIE setup: credentials, router and the common rules 1 through 13 "
     "(references/kie-common-rules.md)",
     "openclaw-onboarding/07-kie-setup", "skill"),
    ("shared-utils", "shared-utils", "shared-utils",
     "KIE key resolver, prompt rule 12 enforcer, declared gate list and its "
     "test",
     "openclaw-onboarding/shared-utils", "files"),
]

# For a "files" helper: (path inside helpers/<name>/, path inside the
# openclaw-onboarding repository). The pin guard checks each of these against
# the onboarding ref, so a newer onboarding copy fails CI.
FILE_SOURCES = {
    "shared-utils": [
        ("key_resolver.py", "shared-utils/key_resolver.py"),
        ("kie_prompt_enforcer.py", "shared-utils/kie_prompt_enforcer.py"),
        ("kie_prompt_gates.json", "shared-utils/kie_prompt_gates.json"),
        ("kie-prompt-enforcer-and-gates.test.py",
         "tests/unit/kie-prompt-enforcer-and-gates.test.py"),
    ],
}

# Same exclusions the repository .gitignore enforces, so a clean clone hashes
# identical to the tree this machine pinned.
def _skip(rel):
    parts = rel.split("/")
    return ("__pycache__" in parts
            or rel.endswith(".pyc")
            or ".bak-" in rel
            or rel.endswith(".log")
            or parts[-1] == ".DS_Store")

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def _tree_from_lines(lines):
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()

def tree_hash(root):
    """sha256 over sorted '<file_sha256>  <relpath>' lines (posix paths)."""
    root = Path(root)
    lines = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if _skip(rel):
            continue
        lines.append(f"{sha256_file(p)}  {rel}")
    return _tree_from_lines(lines)

def tree_stats(root):
    root = Path(root)
    count = 0
    size = 0
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if _skip(rel):
            continue
        count += 1
        size += p.stat().st_size
    return count, size

def helper_kind(h):
    return h.get("kind", "skill")

def has_skill_md(h, src):
    """A "files" helper is not a skill folder; only "skill" needs SKILL.md."""
    if helper_kind(h) != "skill":
        return True
    return (Path(src) / "SKILL.md").is_file()

def config_roots(root_args):
    """Config roots one install/preflight run must cover.

    --root (repeatable) wins; then CLAUDE_CONFIG_DIR, which is the single root
    of a single-root machine; otherwise every config root this machine already
    has (~/.claude and ~/.claude-nine), falling back to ~/.claude when neither
    exists yet. CLAUDE_CONFIG_DIR is only ever read, never assigned.
    """
    if root_args:
        return [Path(r).expanduser() for r in root_args]
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    if env:
        return [Path(env).expanduser()]
    home = Path.home()
    have = [p for p in (home / ".claude", home / ".claude-nine") if p.exists()]
    return have or [home / ".claude"]

def script_ref():
    return str(Path(__file__).resolve())

def load_manifest(path):
    path = Path(path)
    if not path.is_file():
        raise SystemExit(
            f"helper deps FATAL: manifest missing: {path}\n"
            f"  Repair: restore installer-registration/helper-dependencies.json "
            f"from the repository.")
    try:
        m = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise SystemExit(f"helper deps FATAL: manifest unreadable: {path} ({e})")
    if not isinstance(m.get("helpers"), list) or not m["helpers"]:
        raise SystemExit(f"helper deps FATAL: manifest has no helpers: {path}")
    return m

def required_helpers(manifest):
    return [h for h in manifest["helpers"] if h.get("required", True)]

def target_of(root, name):
    return Path(root) / "skills" / name

def repair_cmd(root, roots):
    if len(roots) > 1:  # several roots on this machine: cover them all
        return f"{script_ref()} install"
    return f"{script_ref()} install --root {root}"

# ---------------------------------------------------------------- preflight --
def _preflight_root(root, roots, helpers):
    failures = []
    suffix = f" @ {root}" if len(roots) > 1 else ""
    repair = repair_cmd(root, roots)
    for h in helpers:
        name, sid, ver = h.get("name"), h.get("id"), h.get("version")
        dst = target_of(root, name)
        pin = h.get("treeSha256")
        if not pin:
            failures.append(
                f"MISSING PIN helper '{name}' (Skill {sid}): manifest entry has "
                f"no treeSha256. Repair: rerun `{script_ref()} repin` from a "
                f"repository checkout and commit the manifest.{suffix}")
            continue
        if not dst.is_dir() or not has_skill_md(h, dst):
            failures.append(
                f"MISSING helper '{name}' (Skill {sid}, {ver}): expected "
                f"{dst} with SKILL.md. Repair: run `{repair}` "
                f"(AGENT_INSTALL.md section 5), then rerun this preflight."
                f"{suffix}")
            continue
        got = tree_hash(dst)
        if got != pin:
            failures.append(
                f"HASH MISMATCH helper '{name}' (Skill {sid}, {ver}): expected "
                f"{pin}, found {got} at {dst}. Repair: run "
                f"`{repair}` to restore the pinned copy.{suffix}")
    return failures

def cmd_preflight(a):
    roots = config_roots(a.root)
    manifest = load_manifest(a.manifest)
    helpers = required_helpers(manifest)
    multi = len(roots) > 1
    failures = []
    for root in roots:
        failures += _preflight_root(root, roots, helpers)
    checked = len(roots) * len(helpers)
    ok = checked - len(failures)
    for f in failures:
        print(f"helper preflight: FAIL {f}")
    if failures:
        print(f"helper preflight: {ok}/{checked} helper/root pairs OK; "
              f"{len(failures)} failed.")
        return 1
    where = (", ".join(str(r) for r in roots)) if multi else str(roots[0])
    print(f"helper preflight: ok — {ok}/{checked} helpers present at "
          f"pinned hashes under {where}/skills")
    return 0

# ------------------------------------------------------------------ install --
def _backup(dst, backup_dir):
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S")
    backup = backup_dir / f"{dst.name}.{ts}"
    n = 1
    while backup.exists():  # two roots can converge in the same second
        n += 1
        backup = backup_dir / f"{dst.name}.{ts}-{n}"
    shutil.move(str(dst), str(backup))
    if not backup.is_dir():
        raise RuntimeError(f"backup verification failed: {backup}")
    return backup

def _install_root(root, helpers, backup_dir, multi):
    errors = []
    suffix = f" @ {root}" if multi else ""
    for h in helpers:
        name, sid, ver = h.get("name"), h.get("id"), h.get("version")
        pin = h.get("treeSha256")
        src = HELPERS_DIR / name
        dst = target_of(root, name)
        # 1. repository integrity: vendored copy must match its pin
        if not src.is_dir() or not has_skill_md(h, src):
            errors.append(
                f"VENDORED SOURCE MISSING helper '{name}': expected {src}. "
                f"Repair: restore installer-registration/helpers/{name} from "
                f"the repository.{suffix}")
            continue
        src_hash = tree_hash(src)
        if pin and src_hash != pin:
            errors.append(
                f"VENDORED HASH MISMATCH helper '{name}' (Skill {sid}): manifest "
                f"pin {pin}, vendored {src_hash}. Repair: inspect the change; if "
                f"intended, rerun `{script_ref()} repin` and commit the "
                f"manifest.{suffix}")
            continue
        # 2. converge the install target
        try:
            if dst.is_dir() and not dst.is_symlink():
                if pin and tree_hash(dst) == pin:
                    print(f"helper install: {name} {ver} -> {dst} (up to date)")
                    continue
                backup = _backup(dst, backup_dir)
                print(f"helper install: {name} {ver} backed up {dst} -> {backup}")
            elif dst.is_symlink() or dst.exists():
                # link or stray file: compare through it, otherwise drop the
                # LINK only (never a link target) and replace with the copy
                try:
                    if dst.is_dir() and pin and tree_hash(dst) == pin:
                        print(f"helper install: {name} {ver} -> {dst} "
                              f"(up to date)")
                        continue
                except OSError:
                    pass
                if dst.is_dir() and not dst.is_symlink():
                    backup = _backup(dst, backup_dir)
                    print(f"helper install: {name} {ver} backed up {dst} "
                          f"-> {backup}")
                else:
                    dst.unlink()  # removes the link/stray, not its target
                    print(f"helper install: {name} {ver} removed stale link "
                          f"{dst}")
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, dst)
            print(f"helper install: {name} {ver} -> {dst} (installed)")
        except Exception as e:
            errors.append(f"INSTALL FAILED helper '{name}': {e}{suffix}")
    return errors

def cmd_install(a):
    roots = config_roots(a.root)
    backup_dir = (Path(a.backup_dir).expanduser() if a.backup_dir
                  else Path.home() / ".claude-skill-backups")
    manifest = load_manifest(a.manifest)
    helpers = required_helpers(manifest)
    errors = []
    for root in roots:
        errors += _install_root(root, helpers, backup_dir, len(roots) > 1)
    if errors:
        for e in errors:
            print(f"helper install: FAIL {e}")
        print(f"helper install: {len(errors)} helper(s) failed; not running "
              f"preflight.")
        return 1
    # 3. always finish with the preflight — install is only done on exit 0
    return cmd_preflight(a)

# -------------------------------------------------------------------- repin --
def cmd_repin(a):
    manifest_path = Path(a.manifest)
    old = {}
    if manifest_path.is_file():
        try:
            old = {h.get("name"): h for h in
                   json.loads(manifest_path.read_text(encoding="utf-8"))
                   .get("helpers", [])}
        except Exception:
            old = {}
    helpers = []
    missing = []
    for sid, name, skill_name, role, source, kind in HELPER_SPECS:
        src = HELPERS_DIR / name
        if not src.is_dir() or not has_skill_md({"kind": kind}, src):
            missing.append(name)
            continue
        count, size = tree_stats(src)
        prev = old.get(name, {})
        version = prev.get("version")
        vf = src / "skill-version.txt"
        if vf.is_file():
            version = vf.read_text(encoding="utf-8").strip() or version
        entry = {
            "id": sid,
            "name": name,
            "skillName": skill_name,
            "role": role,
            "kind": kind,
            "required": True,
            "version": version,
            "sourceRepo": "https://github.com/trevorotts1/openclaw-onboarding",
            "sourcePath": source,
            "installPath": f"skills/{name}",
            "fileCount": count,
            "sizeBytes": size,
            "treeSha256": tree_hash(src),
            "skillMdSha256": (sha256_file(src / "SKILL.md")
                              if (src / "SKILL.md").is_file() else None),
        }
        # A "files" helper has no skill-version.txt: its version IS its content
        # hash, so "stale" is decided file by file by the pin guard.
        if kind == "files":
            if not entry["version"]:
                entry["version"] = "sha256:" + entry["treeSha256"][:12]
            entry["files"] = [
                {"path": rel, "sourcePath": onb, "sha256": sha256_file(src / rel)}
                for rel, onb in FILE_SOURCES.get(name, [])
            ]
            entry["skillMdSha256"] = None
        helpers.append(entry)
    if missing:
        print("helper deps repin: FAIL vendored helper(s) missing: "
              + ", ".join(missing))
        return 1
    manifest = {
        "schema": SCHEMA,
        "unit": "W3-03-U5",
        "source": "directive section 2.4 and section 5.3; helper identities "
                  "directive section 5.1",
        "generatedBy": "installer-registration/helper-deps.py repin",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hash": {
            "algorithm": "sha256",
            "tree": "sha256 over the sorted lines '<file_sha256>  "
                    "<relative/path>' for every regular file under the helper "
                    "root (posix relative paths), skipping __pycache__/, "
                    "*.pyc, *.bak-*, *.log, .DS_Store — the same exclusions "
                    "the repository .gitignore enforces",
            "file": "sha256 of the raw file bytes",
        },
        "install": {
            "command": "python3 installer-registration/helper-deps.py install",
            "windowsCommand":
                "py installer-registration\\helper-deps.py install",
            "target": "<config root>/skills/<name>",
            "roots": "every config root the machine has: ~/.claude and "
                     "~/.claude-nine when both exist; CLAUDE_CONFIG_DIR when "
                     "set (single root); ~/.claude otherwise",
            "configRoot": "CLAUDE_CONFIG_DIR when set, otherwise ~/.claude "
                          "(read only; never assigned by this tool)",
            "backupDir": "~/.claude-skill-backups/<name>.<timestamp> "
                         "(existing differing copies are moved there, never "
                         "deleted)",
            "wiredInto": "AGENT_INSTALL.md section 5",
        },
        "preflight": {
            "command": "python3 installer-registration/helper-deps.py preflight",
            "exitOk": 0,
            "exitFail": 1,
            "rule": "a required helper that is absent, lacks SKILL.md (skill "
                    "kind), or does not match its pinned treeSha256 fails the "
                    "preflight with the helper name, the root and the repair "
                    "command",
        },
        "pinGuard": {
            "command": "python3 installer-registration/check-helper-pins.py "
                       "--onboarding <openclaw-onboarding checkout>",
            "exitOk": 0,
            "exitFail": 1,
            "rule": "every pin must equal trevorotts1/openclaw-onboarding at "
                    "the checked ref: skill helpers by version and tree hash, "
                    "files helpers file by file; a stale pin or a vendored "
                    "folder that drifted from its pin fails",
            "ci": ".github/workflows/helper-pin-guard.yml",
        },
        "helpers": helpers,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=False)
                             + "\n", encoding="utf-8")
    print(f"helper deps repin: wrote {manifest_path} "
          f"({len(helpers)} helpers pinned)")
    return 0

# --------------------------------------------------------------------- main --
def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="helper-deps.py",
        description="Pin, install and preflight the KIE helper skills.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
        p.add_argument("--root", action="append", default=None,
                       help="Claude config root (repeatable). Default: "
                            "CLAUDE_CONFIG_DIR if set, else every config root "
                            "the machine has, else ~/.claude")

    p = sub.add_parser("install", help="Install pinned helpers, then preflight.")
    common(p)
    p.add_argument("--backup-dir", default=None)

    p = sub.add_parser("preflight",
                       help="Exit 1 unless every required helper is present "
                            "at its pinned hash.")
    common(p)

    p = sub.add_parser("repin", help="Recompute pins from vendored helpers.")
    common(p)

    a = ap.parse_args(argv)
    if a.cmd == "install":
        return cmd_install(a)
    if a.cmd == "preflight":
        return cmd_preflight(a)
    return cmd_repin(a)

if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # internal error: nonzero, never a silent pass
        print(f"helper deps: internal error: {e}", file=sys.stderr)
        sys.exit(2)
