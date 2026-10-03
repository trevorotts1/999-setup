#!/usr/bin/env python3
"""Disk auto-cleanup sweep (Hook Skill). Frees space from caches only; never touches your files.

  disk_cleanup.py [--dry-run] [--top N]

Steps (each can be turned off in ~/.claude/hooks/hook-skill.json under "disk_cleanup"):
  1. macOS only: thin Time Machine local snapshots (tmutil thinlocalsnapshots, no sudo).
  2. npm cache (_cacache), pip cache, Homebrew cleanup (only when present).
  3. REPORT (never delete) the N largest folders directly under your home directory.
Every run appends to ~/.claude/hooks/disk-cleanup/disk-cleanup.log. --dry-run changes nothing.
"""
import json, os, shutil, subprocess, sys, time

HOME = os.path.expanduser("~")
HERE = os.path.join(HOME, ".claude", "hooks", "disk-cleanup")
LOG = os.environ.get("HOOK_SKILL_DISK_LOG") or os.path.join(HERE, "disk-cleanup.log")
CONFIG = os.environ.get("HOOK_SKILL_CONFIG") or os.path.join(HOME, ".claude", "hooks", "hook-skill.json")
DEFAULTS = {"thin_snapshots": True, "clear_npm_cache": True, "clear_pip_cache": True,
            "homebrew_cleanup": True, "report_top_folders": 10}


def settings():
    out = dict(DEFAULTS)
    try:
        with open(CONFIG) as f:
            doc = json.load(f).get("disk_cleanup", {})
        for k, v in DEFAULTS.items():
            if type(doc.get(k)) is type(v):
                out[k] = doc[k]
    except (OSError, ValueError, AttributeError):
        pass
    return out


def log(msg, dry=False):
    line = "%s %s%s" % (time.strftime("%Y-%m-%d %H:%M:%S"), "[dry-run] " if dry else "", msg)
    print(line)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def run(cmd, timeout=600):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return 99, type(e).__name__


def dir_size(path):
    total = 0
    for d, dirs, files in os.walk(path):
        dirs[:] = [x for x in dirs if not os.path.islink(os.path.join(d, x))]
        for f in files:
            try:
                total += os.lstat(os.path.join(d, f)).st_size
            except OSError:
                pass
    return total


def mb(n):
    return "%.0fMB" % (n / 1048576)


def free_bytes():
    return shutil.disk_usage(HOME).free


def thin_snapshots(dry):
    if sys.platform != "darwin" or not shutil.which("tmutil"):
        log("snapshots: skipped (macOS Time Machine only)")
        return
    rc, out = run(["tmutil", "listlocalsnapshots", "/"], 60)
    snaps = [l for l in out.splitlines() if l.startswith("com.apple.TimeMachine")]
    if not snaps:
        log("snapshots: none present")
        return
    if dry:
        log("snapshots: would thin %d local snapshots: tmutil thinlocalsnapshots / 999999999999 4" % len(snaps), True)
        return
    before = free_bytes()
    rc, out = run(["tmutil", "thinlocalsnapshots", "/", "999999999999", "4"], 900)
    log("snapshots: thinned (rc=%d) freed~%s" % (rc, mb(max(0, free_bytes() - before))))


def npm_cache_dir():
    if shutil.which("npm"):
        rc, out = run(["npm", "config", "get", "cache"], 60)
        if rc == 0 and out:
            return os.path.join(out.splitlines()[-1].strip(), "_cacache")
    base = os.environ.get("LOCALAPPDATA") if os.name == "nt" else HOME
    return os.path.join(base or HOME, "npm-cache" if os.name == "nt" else ".npm", "_cacache")


def clear_npm(dry):
    p = npm_cache_dir()
    if os.path.islink(p) or not os.path.isdir(p) or os.path.basename(p) != "_cacache":
        log("npm cache: none at %s" % p)
        return
    size = dir_size(p)
    if dry:
        log("npm cache: would delete %s (%s)" % (p, mb(size)), True)
        return
    shutil.rmtree(p, ignore_errors=True)
    log("npm cache: deleted %s freed~%s" % (p, mb(size)))


def clear_pip(dry):
    py = sys.executable or "python3"
    rc, out = run([py, "-m", "pip", "cache", "dir"], 60)
    d = out.splitlines()[-1].strip() if rc == 0 and out else ""
    if not d or not os.path.isdir(d):
        log("pip cache: none")
        return
    size = dir_size(d)
    if dry:
        log("pip cache: would purge %s (%s)" % (d, mb(size)), True)
        return
    rc, out = run([py, "-m", "pip", "cache", "purge"], 300)
    log("pip cache: purged (rc=%d) freed~%s" % (rc, mb(size)))


def brew_cleanup(dry):
    brew = shutil.which("brew")
    if not brew:
        log("homebrew: not installed, skipped")
        return
    if dry:
        rc, out = run([brew, "cleanup", "-n", "--prune=all"], 300)
        log("homebrew: would run `brew cleanup --prune=all` (%d lines of candidates)" % len(out.splitlines()), True)
        return
    before = free_bytes()
    rc, out = run([brew, "cleanup", "--prune=all"], 900)
    log("homebrew: cleanup rc=%d freed~%s" % (rc, mb(max(0, free_bytes() - before))))


def report_top(n):
    sizes = []
    try:
        entries = [e for e in os.scandir(HOME) if e.is_dir(follow_symlinks=False)]
    except OSError:
        entries = []
    for e in entries:
        if shutil.which("du") and os.name != "nt":
            rc, out = run(["du", "-sk", e.path], 300)
            kb = int(out.split()[0]) if rc in (0, 1) and out.split()[:1] and out.split()[0].isdigit() else 0
            sizes.append((kb * 1024, e.path))
        else:
            sizes.append((dir_size(e.path), e.path))
    sizes.sort(reverse=True)
    log("largest folders in home (REPORT ONLY, nothing is deleted):")
    for size, path in sizes[:n]:
        log("  %8s  %s" % (mb(size), path))


def main(argv):
    dry = "--dry-run" in argv
    s = settings()
    n = int(argv[argv.index("--top") + 1]) if "--top" in argv else s["report_top_folders"]
    start = free_bytes()
    log("disk cleanup start, free=%s" % mb(start), dry)
    for key, fn in (("thin_snapshots", thin_snapshots), ("clear_npm_cache", clear_npm),
                    ("clear_pip_cache", clear_pip), ("homebrew_cleanup", brew_cleanup)):
        if not s[key]:
            log("%s: disabled in config" % key)
            continue
        try:
            fn(dry)
        except Exception as e:  # one failing step never stops the rest
            log("%s: error %s" % (key, type(e).__name__))
    report_top(n)
    log("disk cleanup done, free=%s (gained %s)" % (mb(free_bytes()), mb(max(0, free_bytes() - start))), dry)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
