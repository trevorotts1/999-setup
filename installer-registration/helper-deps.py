#!/usr/bin/env python3
"""helper-deps.py — pin, install and preflight the KIE helper skills (W3-03-U5).

A clean 999 install must RECEIVE the provider helpers the factory invokes;
a reference to an onboarding skill does not install it (directive 2.4).
Pinned versions and sha256 hashes live in helper-dependencies.json.

  install    verify the vendored helpers against the pins, copy each one into
             <config root>/skills/<name> (an existing different copy is backed
             up externally first, never deleted), then run preflight
  preflight  exit 0 only when every required helper is present at its pinned
             tree hash; otherwise exit 1 naming each failing helper and the
             exact repair command (actionable; stdlib only; never prints
             secret values — none are read)
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
# <config root>/skills/.
HELPER_SPECS = [
    ("66", "66-kie-image", "kie-image",
     "KIE image model selection, prompt constraints, domain QC",
     "openclaw-onboarding/66-kie-image"),
    ("67", "67-kie-video", "kie-video",
     "KIE video routing (no hardcoded model registry)",
     "openclaw-onboarding/67-kie-video"),
    ("68", "68-kie-audio", "kie-audio",
     "KIE/Suno audio request contract, model selection, domain QC",
     "openclaw-onboarding/68-kie-audio"),
    ("74", "74-kie-live-adapter", "kie-live-adapter",
     "KIE paid transport: discovery, schemas, upload, submit, poll, credits",
     "openclaw-onboarding/74-kie-live-adapter"),
    ("46", "46-kie-callback-relay", "kie-callback-relay",
     "Callback relay (webhook-primary result path for paid generations)",
     "openclaw-onboarding/46-kie-callback-relay"),
]

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
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


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


def config_root():
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(env).expanduser() if env else Path.home() / ".claude"


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


def repair_cmd(root):
    return f"{script_ref()} install --root {root}"


# ---------------------------------------------------------------- preflight --
def cmd_preflight(a):
    root = Path(a.root).expanduser() if a.root else config_root()
    manifest = load_manifest(a.manifest)
    helpers = required_helpers(manifest)
    failures = []
    for h in helpers:
        name, sid, ver = h.get("name"), h.get("id"), h.get("version")
        dst = target_of(root, name)
        pin = h.get("treeSha256")
        if not pin:
            failures.append(
                f"MISSING PIN helper '{name}' (Skill {sid}): manifest entry has "
                f"no treeSha256. Repair: rerun `{script_ref()} repin` from a "
                f"repository checkout and commit the manifest.")
            continue
        if not dst.is_dir() or not (dst / "SKILL.md").is_file():
            failures.append(
                f"MISSING helper '{name}' (Skill {sid}, {ver}): expected "
                f"{dst} with SKILL.md. Repair: run `{repair_cmd(root)}` "
                f"(AGENT_INSTALL.md section 5), then rerun this preflight.")
            continue
        got = tree_hash(dst)
        if got != pin:
            failures.append(
                f"HASH MISMATCH helper '{name}' (Skill {sid}, {ver}): expected "
                f"{pin}, found {got} at {dst}. Repair: run "
                f"`{repair_cmd(root)}` to restore the pinned copy.")
    ok = len(helpers) - len(failures)
    for f in failures:
        print(f"helper preflight: FAIL {f}")
    if failures:
        print(f"helper preflight: {ok}/{len(helpers)} helpers OK; "
              f"{len(failures)} failed.")
        return 1
    print(f"helper preflight: ok — {ok}/{len(helpers)} helpers present at "
          f"pinned hashes under {root}/skills")
    return 0


# ------------------------------------------------------------------ install --
def _backup(dst, backup_dir):
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S")
    backup = backup_dir / f"{dst.name}.{ts}"
    shutil.move(str(dst), str(backup))
    if not backup.is_dir():
        raise RuntimeError(f"backup verification failed: {backup}")
    return backup


def cmd_install(a):
    root = Path(a.root).expanduser() if a.root else config_root()
    backup_dir = (Path(a.backup_dir).expanduser() if a.backup_dir
                  else Path.home() / ".claude-skill-backups")
    manifest = load_manifest(a.manifest)
    helpers = required_helpers(manifest)
    errors = []
    for h in helpers:
        name, sid, ver = h.get("name"), h.get("id"), h.get("version")
        pin = h.get("treeSha256")
        src = HELPERS_DIR / name
        dst = target_of(root, name)
        # 1. repository integrity: vendored copy must match its pin
        if not src.is_dir() or not (src / "SKILL.md").is_file():
            errors.append(
                f"VENDORED SOURCE MISSING helper '{name}': expected {src}. "
                f"Repair: restore installer-registration/helpers/{name} from "
                f"the repository.")
            continue
        src_hash = tree_hash(src)
        if pin and src_hash != pin:
            errors.append(
                f"VENDORED HASH MISMATCH helper '{name}' (Skill {sid}): manifest "
                f"pin {pin}, vendored {src_hash}. Repair: inspect the change; if "
                f"intended, rerun `{script_ref()} repin` and commit the manifest.")
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
            errors.append(f"INSTALL FAILED helper '{name}': {e}")
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
    for sid, name, skill_name, role, source in HELPER_SPECS:
        src = HELPERS_DIR / name
        if not src.is_dir() or not (src / "SKILL.md").is_file():
            missing.append(name)
            continue
        count, size = tree_stats(src)
        prev = old.get(name, {})
        version = prev.get("version")
        vf = src / "skill-version.txt"
        if vf.is_file():
            version = vf.read_text(encoding="utf-8").strip() or version
        helpers.append({
            "id": sid,
            "name": name,
            "skillName": skill_name,
            "role": role,
            "required": True,
            "version": version,
            "sourceRepo": "https://github.com/trevorotts1/openclaw-onboarding",
            "sourcePath": source,
            "installPath": f"skills/{name}",
            "fileCount": count,
            "sizeBytes": size,
            "treeSha256": tree_hash(src),
            "skillMdSha256": sha256_file(src / "SKILL.md"),
        })
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
            "rule": "a required helper that is absent, lacks SKILL.md, or "
                    "does not match its pinned treeSha256 fails the preflight "
                    "with the helper name and the repair command",
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
        p.add_argument("--root", default=None,
                       help="Claude config root (default: CLAUDE_CONFIG_DIR "
                            "if set, else ~/.claude)")

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
