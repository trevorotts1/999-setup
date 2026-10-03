#!/usr/bin/env python3
"""Post-merge hygiene: delete agent worktrees/clones/scratch folders ONLY when GitHub proves the work is merged.

  post_merge_hygiene.py            PostToolUse(Bash) hook: confirms a merge/mint on GitHub, then spawns a detached sweep
  post_merge_hygiene.py sweep      [--dry-run] [--min-age MIN] [--root DIR ...]   (a scheduled task runs this every 15 min)
Fails open: the hook always exits 0. Nothing is deleted unless every safety condition is proven.
"""
import json, os, re, shlex, shutil, subprocess, sys, time
try:
    import fcntl  # POSIX only; on Windows the lock is skipped
except ImportError:
    fcntl = None

HOME = os.path.expanduser("~")
HERE = os.path.join(HOME, ".claude/hooks/hygiene")
LOG = os.path.join(HERE, "hygiene.log")
LOCK = os.path.join(HERE, ".sweep.lock")
SELF = os.path.abspath(__file__)
CONFIG = os.environ.get("HOOK_SKILL_CONFIG") or os.path.join(HOME, ".claude", "hooks", "hook-skill.json")


def load_config():
    """Per-user settings from ~/.claude/hooks/hook-skill.json, section "hygiene". Missing or bad file = defaults.
    Keys: protected_paths, tracked_repos, scan_roots, extra_test_roots (lists of paths; "~" ok, relative = under home)."""
    try:
        with open(CONFIG) as f:
            doc = json.load(f).get("hygiene", {})
    except (OSError, ValueError, AttributeError):
        doc = {}
    def paths(key):
        v = doc.get(key) if isinstance(doc, dict) else None
        return [os.path.join(HOME, os.path.expanduser(p)) for p in v if isinstance(p, str) and p.strip()] if isinstance(v, list) else []
    return paths


_paths = load_config()
OUR_REPOS = _paths("tracked_repos")  # repos whose linked worktrees are also swept
PROTECTED = [os.path.join(HOME, p) for p in (
    "Downloads", "Documents", "Desktop", ".ssh", ".claude/hooks", ".claude/projects", ".claude-nine/projects")] + _paths("protected_paths") + OUR_REPOS
SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "__pycache__", ".venv", "build"}
BUILD_PARTS = ("node_modules/", ".next/", "dist/")
WORK_EXT = {".md", ".txt", ".json", ".jsonl", ".log", ".csv", ".tsv", ".patch", ".diff", ".out", ".yml", ".yaml", ".html", ".png", ".pid"}
ENV = dict(os.environ, GIT_TERMINAL_PROMPT="0")
if os.name != "nt":
    ENV["PATH"] = os.pathsep.join(["/opt/homebrew/bin", "/usr/local/bin", os.environ.get("PATH", "/usr/bin:/bin")])


def run(cmd, cwd=None, timeout=60):
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=ENV)
        return p.returncode, p.stdout.strip()
    except Exception:
        return 99, ""


def log(msg, dry=False):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    if dry:
        print(line)
        return
    try:
        os.makedirs(HERE, exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line)


# ---------------------------------------------------------------- discovery
def walk_repos(root, depth):
    """Yield dirs holding a .git (file or dir) up to `depth` levels below root. Never follows symlinks."""
    root = os.path.realpath(root)
    if not os.path.isdir(root):
        return
    base = root.count(os.sep)
    for d, dirs, _ in os.walk(root):
        if d != root and os.path.exists(os.path.join(d, ".git")):
            dirs[:] = []
            yield d
            continue
        if d.count(os.sep) - base >= depth:
            dirs[:] = []
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not os.path.islink(os.path.join(d, x))]


def default_roots():
    roots = [(HOME + "/.claude-nine/scratchpad", 5), (HOME + "/.claude/scratchpad", 5), (HOME + "/lanes", 4)]
    roots += [(r, 5) for r in _paths("scan_roots")]
    for base in claude_tmp_dirs():
        depth0 = base.count(os.sep)
        for d, dirs, _ in os.walk(base):
            if d.count(os.sep) - depth0 > 4:
                dirs[:] = []
            if os.path.basename(d) == "scratchpad":
                roots.append((d, 6))
                dirs[:] = []
    return roots


def claude_tmp_dirs():
    """Claude Code's per-user temp folders: <tmp>/claude-<uid> (POSIX). Windows has none."""
    if not hasattr(os, "getuid"):
        return []
    bases = os.environ.get("HOOK_SKILL_TMP_ROOTS", "").split(os.pathsep) if os.environ.get("HOOK_SKILL_TMP_ROOTS") else ("/tmp", "/private/tmp")  # env override is for tests
    return sorted({d for t in bases for d in [os.path.realpath(os.path.join(t, "claude-%d" % os.getuid()))] if os.path.isdir(d)})


def candidates(roots, full):
    found, scan_roots = {}, [r for r, _ in roots]
    for r, depth in roots:
        for p in walk_repos(r, depth):
            found[os.path.realpath(p)] = r
    if full:  # system temp top two levels (the claude-<uid> folder is handled via its scratchpad roots)
        t = os.path.realpath("/tmp") if os.name != "nt" else os.path.realpath(os.environ.get("TEMP", ""))
        for p in walk_repos(t, 2) if t and os.path.isdir(t) else []:
            if not any(p == c or p.startswith(c + os.sep) for c in claude_tmp_dirs()):
                found[os.path.realpath(p)] = t
        scan_roots.append(t)
    for repo in OUR_REPOS if full else []:
        if os.path.isdir(repo):
            _, out = run(["git", "worktree", "list", "--porcelain"], cwd=repo)
            paths = [l[9:] for l in out.splitlines() if l.startswith("worktree ")]
            for p in paths[1:]:
                if os.path.isdir(p):
                    found[os.path.realpath(p)] = None
    return found, scan_roots


# ---------------------------------------------------------------- safety checks
def protected(path):
    p = os.path.realpath(path)
    if "/.next/" in p + "/":
        return True
    return any(p == q or p.startswith(q + "/") for q in map(os.path.realpath, PROTECTED))


_proc_cache = None
def proc_paths():
    global _proc_cache
    if _proc_cache is None:
        rc, a = run(["lsof", "-a", "-d", "cwd", "-Fn"], timeout=30)
        _, b = run(["ps", "-axo", "command"], timeout=30)
        # rc != 0 = lsof missing/failed (e.g. Windows): in-use state is UNKNOWN, so in_use() answers yes and nothing is deleted
        _proc_cache = None if rc != 0 else ([l[1:] for l in a.splitlines() if l.startswith("n")], b)
        if _proc_cache is None:
            _proc_cache = False
    return _proc_cache  # ponytail: cwd + argv only (no lsof +D, too slow); add open-file scan if needed


def in_use(path):
    pp = proc_paths()
    if pp is False:
        return True
    cwds, cmds = pp
    if any(c == path or c.startswith(path + "/") for c in cwds):
        return True
    return path in cmds


def newest_mtime(path):
    try: newest = os.lstat(path).st_mtime
    except OSError: newest = 0
    for g in (".git/index", ".git/HEAD"):
        try: newest = max(newest, os.stat(os.path.join(path, g)).st_mtime)
        except OSError: pass
    stack = [path]
    while stack:
        d = stack.pop()
        try:
            for e in os.scandir(d):
                if e.is_symlink():
                    continue
                if e.is_dir():
                    if e.name not in SKIP_DIRS:
                        stack.append(e.path)
                try: newest = max(newest, e.stat(follow_symlinks=False).st_mtime)
                except OSError: pass
        except OSError:
            pass
    return newest


def git(path, *a, timeout=60):
    return run(["git", "-C", path, *a], timeout=timeout)


_pr_cache = {}
def merged_pr(path, branch, sha):
    """PR number if GitHub says a MERGED PR for `branch` had head == sha."""
    if not branch:
        return None
    key = (git(path, "remote", "get-url", "origin")[1], branch, sha)
    if key not in _pr_cache:
        rc, out = run(["gh", "pr", "list", "--head", branch, "--state", "merged", "--limit", "30",
                       "--json", "number,headRefOid"], cwd=path, timeout=60)
        n = None
        if rc == 0 and out:
            try: n = next((x["number"] for x in json.loads(out) if x["headRefOid"] == sha), None)
            except Exception: pass
        _pr_cache[key] = n
    return _pr_cache[key]


def judge(path, is_wt, min_age):
    """Return (deletable, reason). Every 'no' carries its reason."""
    rc, top = git(path, "rev-parse", "--show-toplevel")
    if rc or os.path.realpath(top) != path:
        return False, "not a repo toplevel"
    if git(path, "remote", "get-url", "origin")[0]:
        return False, "no origin remote, merge unprovable"
    if git(path, "fetch", "origin", "--quiet", timeout=90)[0]:
        return False, "git fetch origin failed, merge unprovable"
    _, head = git(path, "rev-parse", "HEAD")
    _, branch = git(path, "symbolic-ref", "--short", "-q", "HEAD")
    # 1. merge proof
    default = next((r for r in ("origin/main", "origin/master") if not git(path, "rev-parse", "-q", "--verify", r)[0]), None)
    proof = None
    if default and git(path, "merge-base", "--is-ancestor", "HEAD", default)[0] == 0:
        proof = f"HEAD {head[:9]} is contained in {default}"
    else:
        n = merged_pr(path, branch, head)
        if n:
            proof = f"GitHub PR #{n} for branch {branch} is MERGED (head {head[:9]})"
    if not proof:
        return False, f"merge unproven (branch={branch or 'detached'}, HEAD {head[:9]} not in origin/main, no merged PR)"
    # 2. clean tree
    _, st = git(path, "status", "--porcelain", "--untracked-files=all")
    dirty = [l for l in st.splitlines() if not any(b in l[3:] + ("/" if l.endswith("/") else "") for b in BUILD_PARTS)]
    if dirty:
        return False, f"uncommitted changes ({len(dirty)} paths)"
    if git(path, "stash", "list")[1]:
        return False, "has stash entries"
    # 3. no unpushed commits (clones: every local branch; worktrees: own HEAD)
    if is_wt:
        _, un = git(path, "rev-list", "HEAD", "--not", "--remotes")
        if un and not merged_pr(path, branch, head):
            return False, f"{len(un.splitlines())} unpushed commits on HEAD"
    else:
        _, refs = git(path, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads")
        for line in refs.splitlines():
            b, sha = line.split()
            if git(path, "rev-list", sha, "--not", "--remotes")[1] and not merged_pr(path, b, sha):
                return False, f"unpushed commits on local branch {b}"
    # 4. not in use / not recent
    if in_use(path):
        return False, "open by a running process"
    age = (time.time() - newest_mtime(path)) / 60
    if age < min_age:
        return False, f"modified {age:.0f} min ago (< {min_age} min)"
    return True, proof


def du_kb(path):
    if shutil.which("du") and os.name != "nt":
        return int((run(["du", "-sk", path], timeout=300)[1].split() or ["0"])[0])
    total = 0
    for d, dirs, files in os.walk(path):
        for f in files:
            try: total += os.lstat(os.path.join(d, f)).st_size
            except OSError: pass
    return total // 1024


def container_removable(c, roots, min_age):
    """Container folder holds only our working files, none recent, no repo, no live process."""
    if protected(c) or any(os.path.realpath(r) == c for r in roots) or in_use(c):
        return False
    for d, dirs, files in os.walk(c):
        if ".git" in dirs or ".git" in files:
            return False
        for f in files:
            fp = os.path.join(d, f)
            if os.path.splitext(f)[1].lower() not in WORK_EXT or time.time() - os.lstat(fp).st_mtime < min_age * 60:
                return False
    return True


# ---------------------------------------------------------------- test-data cleanup
TEST_ROOT = os.path.join(HOME, ".test-runs")
TEST_STALE_MIN = 60
CATCHALL_AGE_H = 6
MARKERS = ("test", "qc-", "verify", "probe", "fixture", "render", "smoke", "e2e", "-qc", "sandbox")


def safe_id(rid):
    return re.fullmatch(r"[A-Za-z0-9._-]{1,80}", rid or "") and rid not in (".", "..")


def test_start(rid):
    if not safe_id(rid):
        print("bad run-id"); return
    d = os.path.join(TEST_ROOT, rid)
    os.makedirs(d, exist_ok=True)
    json.dump({"id": rid, "started": time.time(), "ended": None}, open(os.path.join(TEST_ROOT, rid + ".json"), "w"))
    log(f"TEST-START {d}")
    print(d)


def test_end(rid):
    meta = os.path.join(TEST_ROOT, f"{rid}.json") if safe_id(rid) else None
    if not meta or not os.path.exists(meta):
        print("unknown run-id"); return
    m = json.load(open(meta)); m["ended"] = time.time()
    json.dump(m, open(meta, "w"))
    log(f"TEST-END {rid}")


def unsafe_repo(path):
    """Reason string if a git repo under path has uncommitted/unpushed work (git errors count as unsafe)."""
    for d, dirs, files in os.walk(path):
        if ".git" in dirs or ".git" in files:
            rc, out = git(d, "status", "--porcelain")
            if rc or out:
                return f"uncommitted changes or git error in {d}"
            rc, n = git(d, "rev-list", "--branches", "--not", "--remotes", "--count")
            if rc or n != "0":
                return f"unpushed commits or git error in {d}"
            dirs[:] = [x for x in dirs if x != ".git"]
    return None


def open_by_process(path):
    if in_use(path):
        return True
    rc, _ = run(["lsof", "-t", "+D", path], timeout=30)
    return rc != 1  # lsof rc1 = nothing open; anything else (open, error, timeout) = keep


def sweep_tests(dry):
    freed = 0
    def kill(path, why):
        nonlocal freed
        size = du_kb(path)
        if dry:
            log(f"WOULD-DELETE test-data {path} {size // 1024}MB :: {why}", True); return
        shutil.rmtree(path, ignore_errors=True)
        freed += size
        log(f"DELETED test-data {path} {size // 1024}MB :: {why}")
    # 2. test homes
    if os.path.isdir(TEST_ROOT):
        for name in sorted(os.listdir(TEST_ROOT)):
            d = os.path.join(TEST_ROOT, name)
            if not os.path.isdir(d) or os.path.islink(d):
                continue
            try: m = json.load(open(d + ".json"))
            except Exception: m = {}
            age = (time.time() - newest_mtime(d)) / 60
            if m.get("ended"): why = "test-end called"
            elif age >= TEST_STALE_MIN: why = f"no file modified for {age:.0f} min"
            else:
                log(f"SKIP test-home {d} running/recent ({age:.0f} min)", dry); continue
            if open_by_process(d):
                log(f"SKIP test-home {d} open by a running process", dry); continue
            kill(d, why)
            if not dry:
                try: os.remove(d + ".json")
                except OSError: pass
    # 3. catch-all
    cands = []
    # Only Claude scratch folders by default; add more places with hygiene.extra_test_roots in the config file.
    for root in claude_tmp_dirs() + [HOME + "/.claude-nine/scratchpad", HOME + "/.claude/scratchpad"] + _paths("extra_test_roots"):
        try: names = os.listdir(root)
        except OSError: continue
        for n in names:
            p = os.path.join(root, n)
            if os.path.islink(p) or not os.path.isdir(p) or n.startswith("-"):
                continue
            if any(k in n.lower() for k in MARKERS):
                cands.append(p)
    for p in sorted(cands):
        rp = os.path.realpath(p)
        if protected(rp):
            log(f"SKIP test-folder {p} protected", dry); continue
        age = (time.time() - newest_mtime(rp)) / 3600
        if age < CATCHALL_AGE_H:
            log(f"SKIP test-folder {p} modified {age:.1f}h ago (< {CATCHALL_AGE_H}h)", dry); continue
        if open_by_process(rp):
            log(f"SKIP test-folder {p} open by a running process", dry); continue
        why = unsafe_repo(rp)
        if why:
            log(f"SKIP test-folder {p} {why}", dry); continue
        kill(rp, f"name matches test marker, untouched {age:.1f}h, not open, no unsaved git work")
    return freed


def sweep(dry, min_age, roots_override):
    os.makedirs(HERE, exist_ok=True)
    lock = open(LOCK, "w")
    if fcntl:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("another sweep running"); return
    roots = [(r, 5) for r in roots_override] if roots_override else default_roots()
    found, scan_roots = candidates(roots, full=not roots_override)
    log(f"SWEEP start dry={dry} candidates={len(found)}", dry)
    freed = 0
    for path in sorted(found):
        if protected(path) or path in map(os.path.realpath, scan_roots):
            log(f"SKIP {path} protected/root", dry); continue
        is_wt = os.path.isfile(os.path.join(path, ".git"))
        ok, why = judge(path, is_wt, min_age)
        if not ok:
            log(f"SKIP {path} {why}", dry); continue
        size = du_kb(path)
        kind = "worktree" if is_wt else "clone"
        if dry:
            log(f"WOULD-DELETE {kind} {path} {size // 1024}MB :: {why}", True); continue
        main = None
        if is_wt:
            rc, cd = git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
            main = os.path.dirname(cd) if not rc else None
            if not main or run(["git", "worktree", "remove", "--force", path], cwd=main)[0]:
                log(f"SKIP {path} git worktree remove failed", dry); continue
            run(["git", "worktree", "prune"], cwd=main)
        else:
            shutil.rmtree(path, ignore_errors=True)
        freed += size
        log(f"DELETED {kind} {path} {size // 1024}MB :: {why}")
        parent = os.path.dirname(path)
        if os.path.isdir(parent) and container_removable(parent, [r for r, _ in roots] + scan_roots, min_age):
            psize = du_kb(parent)
            shutil.rmtree(parent, ignore_errors=True)
            freed += psize
            log(f"DELETED container {parent} {psize // 1024}MB :: only working files remain, none modified in {min_age} min")
    try: freed += sweep_tests(dry)
    except Exception as e: log(f"SKIP sweep_tests error {e}", dry)
    log(f"SWEEP done freed~{freed // 1024}MB dry={dry}", dry)


# ---------------------------------------------------------------- hook
def seg_tokens(cmd):
    for seg in re.split(r"&&|\|\||;|\n|\|", cmd):
        try: yield shlex.split(seg)
        except ValueError: pass


def confirm(cmd, cwd):
    """Return a proof string if the command was a merge/mint that GitHub confirms, else None."""
    for t in seg_tokens(cmd):
        if t[:3] == ["gh", "pr", "merge"]:
            rest = t[3:]
            repo = next((rest[i + 1] for i, x in enumerate(rest[:-1]) if x in ("-R", "--repo")), None)
            num = next((x for x in rest if x.isdigit()), None)
            a = ["gh", "pr", "view"] + ([num] if num else []) + (["-R", repo] if repo else []) + ["--json", "state,mergedAt,number"]
            rc, out = run(a, cwd=cwd, timeout=30)
            if rc == 0 and json.loads(out).get("state") == "MERGED":
                return f"PR #{json.loads(out)['number']} MERGED on GitHub"
        elif t[:3] == ["gh", "release", "create"] and len(t) > 3:
            repo = next((t[i + 1] for i, x in enumerate(t[:-1]) if x in ("-R", "--repo")), None)
            a = ["gh", "release", "view", t[3]] + (["-R", repo] if repo else []) + ["--json", "tagName"]
            if run(a, cwd=cwd, timeout=30)[0] == 0:
                return f"release {t[3]} exists on GitHub"
        elif t[:2] == ["git", "push"] and any(x == "--tags" or x.startswith("refs/tags/") or re.fullmatch(r"v?\d+(\.\d+)+\S*", x) for x in t[2:]):
            tags = [x.split("refs/tags/")[-1] for x in t[2:] if x.startswith("refs/tags/") or re.fullmatch(r"v?\d+(\.\d+)+\S*", x)]
            rc, out = run(["git", "ls-remote", "--tags", "origin"] + tags, cwd=cwd, timeout=30)
            if rc == 0 and out:
                return f"tag on remote origin ({(tags or ['--tags'])[0]})"
    return None


def hook():
    try:
        d = json.load(sys.stdin)
        cmd = (d.get("tool_input") or {}).get("command", "")
        if re.search(r"gh\s+(pr\s+merge|release\s+create)|git\s+push|git\s+tag", cmd):
            proof = confirm(cmd, d.get("cwd") or None)
            if proof:
                log(f"HOOK mint confirmed ({proof}); spawning detached sweep")
                subprocess.Popen([sys.executable, SELF, "sweep"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, env=ENV,
                                 **({"start_new_session": True} if os.name != "nt" else {"creationflags": 0x00000208}))
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "sweep":
        a = sys.argv[2:]
        mins = int(a[a.index("--min-age") + 1]) if "--min-age" in a else 30
        roots = [a[i + 1] for i, x in enumerate(a[:-1]) if x == "--root"]
        sweep("--dry-run" in a, mins, roots)
    elif len(sys.argv) > 2 and sys.argv[1] in ("test-start", "test-end"):
        try: (test_start if sys.argv[1] == "test-start" else test_end)(sys.argv[2])
        except Exception as e: print(f"error: {e}")
        sys.exit(0)
    else:
        hook()
