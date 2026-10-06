#!/usr/bin/env python3
"""Copy / remove the Hook Skill files under ~/.claude/hooks and keep an install manifest. Stdlib only.

  hookskill_files.py install   --src DIR --dest DIR --components a,b [--version V] [--dry-run]
  hookskill_files.py uninstall --dest DIR [--purge] [--dry-run]

The manifest (<dest>/hook-skill-install.json) lists every file this installer wrote, so uninstall removes
only those. Runtime data (logs, databases, limits.json) and the user's hook-skill.json are kept unless --purge.
"""
import argparse, json, os, shutil, sys

SKIP_NAMES = {"__pycache__", "node_modules", "state", "TEST-CLEANUP-DONE"}
CONFIG_DEFAULT = {
    "_about": "Hook Skill per-user settings. Edit freely; the installer never overwrites this file.",
    "hygiene": {"protected_paths": [], "tracked_repos": [], "scan_roots": [], "extra_test_roots": []},
    "disk_cleanup": {"thin_snapshots": True, "clear_npm_cache": True, "clear_pip_cache": True,
                     "homebrew_cleanup": True, "report_top_folders": 10},
}
MANIFEST = "hook-skill-install.json"


def skip(name):
    return name in SKIP_NAMES or name.startswith("test_") or name.startswith("test-") or name.endswith(".pyc")


def files_of(src_comp):
    out = []
    for d, dirs, files in os.walk(src_comp):
        dirs[:] = [x for x in dirs if not skip(x)]
        out += [os.path.relpath(os.path.join(d, f), src_comp) for f in files if not skip(f)]
    return sorted(out)


def install(a):
    comps = [c for c in a.components.split(",") if c]
    manifest = {"version": a.version, "components": comps, "files": []}
    try:  # a re-install keeps what apply_capacity recorded about the settings it first touched
        with open(os.path.join(a.dest, MANIFEST), encoding="utf-8") as f:
            old = json.load(f)
        if isinstance(old, dict) and old.get("env_prior"):
            manifest["env_prior"] = old["env_prior"]
    except (OSError, ValueError):
        pass
    for c in comps:
        src = os.path.join(a.src, c)
        if not os.path.isdir(src):
            print("missing component folder: %s" % src, file=sys.stderr)
            return 2
        for rel in files_of(src):
            dst = os.path.join(a.dest, c, rel)
            manifest["files"].append(os.path.join(c, rel))
            print("%s %s" % ("would copy" if a.dry_run else "copy", dst))
            if not a.dry_run:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(os.path.join(src, rel), dst)
    cfg = os.path.join(a.dest, "hook-skill.json")
    if not os.path.exists(cfg):
        print("%s %s" % ("would create" if a.dry_run else "create", cfg))
        if not a.dry_run:
            with open(cfg, "w") as f:
                json.dump(CONFIG_DEFAULT, f, indent=2)
                f.write("\n")
        manifest["created_config"] = True
    if not a.dry_run:
        with open(os.path.join(a.dest, MANIFEST), "w") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")
    return 0


def uninstall(a):
    mpath = os.path.join(a.dest, MANIFEST)
    try:
        with open(mpath) as f:
            m = json.load(f)
    except (OSError, ValueError):
        print("no install manifest at %s: nothing to remove" % mpath)
        return 0
    dirs = set()
    for rel in m.get("files", []):
        p = os.path.join(a.dest, rel)
        dirs.add(os.path.join(a.dest, rel.split(os.sep)[0]))
        if os.path.isfile(p):
            print("%s %s" % ("would remove" if a.dry_run else "remove", p))
            if not a.dry_run:
                os.unlink(p)
    for c in m.get("components", []):
        dirs.add(os.path.join(a.dest, c))
    for d in sorted(dirs, key=len, reverse=True):
        if not os.path.isdir(d) or a.dry_run:
            continue
        if a.purge:
            shutil.rmtree(d, ignore_errors=True)
            continue
        for root, subdirs, _ in os.walk(d, topdown=False):  # drop empty folders only
            try:
                os.rmdir(root)
            except OSError:
                pass
    if a.purge and m.get("created_config") and not a.dry_run:
        for f in ("hook-skill.json",):
            if os.path.exists(os.path.join(a.dest, f)):
                os.unlink(os.path.join(a.dest, f))
    if not a.dry_run:
        os.unlink(mpath)
    return 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["install", "uninstall"])
    p.add_argument("--src")
    p.add_argument("--dest", required=True)
    p.add_argument("--components", default="")
    p.add_argument("--version", default="")
    p.add_argument("--purge", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    return install(a) if a.action == "install" else uninstall(a)


if __name__ == "__main__":
    sys.exit(main())
