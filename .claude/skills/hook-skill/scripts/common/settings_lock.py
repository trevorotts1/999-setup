#!/usr/bin/env python3
"""Optional hard lock for a Claude Code settings.json, and the lock-aware write every installer uses. Stdlib only.

  settings_lock.py lock   FILE [FILE ...]     make the file(s) unwritable (opt-in: install.sh --lock-settings)
  settings_lock.py unlock FILE [FILE ...]     undo it (install.sh --unlock-settings)
  settings_lock.py status FILE [FILE ...]     print locked (kind) / unlocked

Lock kinds
  macOS    user-immutable flag (chflags uchg): stops every writer, including the file's owner, until unlocked.
  Linux    chattr +i when running as root (strong). Otherwise chmod a-w, which is WEAKER: the owner (or any program
           running as the owner) can chmod it back or replace the file, because replacing needs only the folder.
  Windows  read-only attribute (attrib +R). WEAKER: it stops normal saves, but the owner (or any program running as
           the owner) can clear it, and some editors clear it themselves.
Default is NO lock: the box owner keeps /model and /config. Nothing here is ever applied without the flag.

unlocked(path) is the lock-aware write: if the file is locked it unlocks, runs the write, validates the JSON, and ALWAYS
re-locks (even when the write fails), printing one line saying so. A file that was not locked is never locked.
"""
import contextlib, json, os, stat, subprocess, sys

WIN = os.name == "nt"
MAC = sys.platform == "darwin"


def kind(path):
    """Return how `path` is locked ('uchg', 'immutable', 'readonly') or None."""
    if not os.path.exists(path):
        return None
    st = os.stat(path)
    if MAC:
        if getattr(st, "st_flags", 0) & (stat.UF_IMMUTABLE | stat.SF_IMMUTABLE):
            return "uchg"
    elif not WIN:
        try:
            out = subprocess.run(["lsattr", "-d", path], capture_output=True, text=True, timeout=10).stdout
            if out and "i" in out.split()[0]:
                return "immutable"
        except (OSError, subprocess.SubprocessError, IndexError):
            pass
    if not st.st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH):
        return "readonly"
    return None


def lock(path):
    """Lock `path`. Returns the kind applied; raises OSError/RuntimeError when it cannot."""
    if MAC:
        os.chflags(path, os.stat(path).st_flags | stat.UF_IMMUTABLE)
        return "uchg"
    if not WIN and hasattr(os, "geteuid") and os.geteuid() == 0:
        subprocess.run(["chattr", "+i", path], check=True, capture_output=True)
        return "immutable"
    os.chmod(path, os.stat(path).st_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
    return "readonly"


def relock(path, k):
    """Put back the SAME kind of lock the file had."""
    if k == "readonly":
        os.chmod(path, os.stat(path).st_mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))
    else:
        lock(path)


def unlock(path):
    k = kind(path)
    if k == "uchg":
        os.chflags(path, os.stat(path).st_flags & ~(stat.UF_IMMUTABLE))
        if kind(path) == "uchg":
            raise RuntimeError("%s has a system immutable flag; clear it with sudo chflags noschg" % path)
    elif k == "immutable":
        subprocess.run(["chattr", "-i", path], check=True, capture_output=True)
    elif k == "readonly":
        os.chmod(path, os.stat(path).st_mode | stat.S_IWUSR)
    return k


@contextlib.contextmanager
def unlocked(path, say=print):
    """Unlock `path` if locked, let the caller write it, validate the JSON, always re-lock. Yields the prior kind."""
    k = kind(path)
    if k is None:
        yield None
        return
    unlock(path)
    say("settings-lock: %s was locked (%s); unlocked for this write and re-locked after" % (path, k))
    try:
        yield k
        with open(path, encoding="utf-8") as f:
            json.load(f)  # a broken write is reported, and the file is still re-locked below
    finally:
        try:
            relock(path, k)
        except (OSError, RuntimeError, subprocess.SubprocessError) as e:
            print("settings-lock: WARNING could not re-lock %s: %s. Re-lock it yourself." % (path, e), file=sys.stderr)


def main(argv):
    if len(argv) < 3 or argv[1] not in ("lock", "unlock", "status"):
        print(__doc__.split("\n\n")[0], file=sys.stderr)
        return 64
    rc = 0
    for p in argv[2:]:
        if not os.path.exists(p):
            print("settings-lock: %s does not exist, skipped" % p)
            continue
        try:
            if argv[1] == "lock":
                k = lock(p)
                note = "" if k in ("uchg", "immutable") else " (weaker lock: the box owner can clear it; see the Hook Skill README)"
                print("settings-lock: locked %s (%s)%s" % (p, k, note))
            elif argv[1] == "unlock":
                print("settings-lock: unlocked %s (was %s)" % (p, unlock(p) or "not locked"))
            else:
                print("%s: %s" % (p, kind(p) and "locked (%s)" % kind(p) or "unlocked"))
        except (OSError, RuntimeError, subprocess.SubprocessError) as e:
            print("settings-lock: %s %s failed: %s" % (argv[1], p, e), file=sys.stderr)
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
