#!/usr/bin/env python3
# studio_check.py — the Drama Studio check-in, the SessionStart hook and the watcher (U13).
#
# Usage:
#   studio_check.py --hook                 # the SessionStart hook (reads the hook JSON on stdin)
#   studio_check.py --desktop              # the heartbeat job's desktop notice (opt-in only)
#   studio_check.py --watch [--every N] [--once]   # Option 2 watcher; U14 owns its dedup
#   studio_check.py --print-root           # the skill root, refused when it is not this plugin
#   studio_check.py --print-state          # the protected state folder
#
# THE RULES THIS FILE OWNS (JOINT PLAN section 3.10, row U13):
#   1  the terminal notice prints once per order per session, and only on a real start
#      (the hook matches source=startup; a resume or a clear prints nothing)
#   2  a desktop notice happens ONLY when the client opted in — off otherwise
#   4  the hook is SILENT on any error, exit 0
#   4a the hook skips the network check when the last check was less than 60 seconds ago
#
# BUDGETS. HOOK_BUDGET_S is the whole hook; NETWORK_BUDGET_S is the network call.
# A copy that overruns either is rejected: nothing is printed and the run still exits 0.
#
# EXIT CODES
#   0  fine (the hook also exits 0 on every error — silence is the contract)
#   2  a named refusal: AF-DS-ROOT (wrong skill root), AF-DS-ARGS
#   3  the hook could not run at all (no python3, unreadable state) — only outside --hook
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request

HOOK_BUDGET_S = 10.0        # the whole hook stays inside ten seconds
NETWORK_BUDGET_S = 3.0      # the network call stays inside three seconds
CACHE_SECONDS = 60.0        # rule 4a: a check younger than this skips the network
NOTICE_PREFIX = "Drama Studio: "
LINK_HINT = "Type /drama-studio to start it."
DESKTOP_BODY = "Open Claude Code to start your video"
STATE_DIR_NAME = ".drama-studio"
MARKERS = ("SKILL.md", os.path.join("hooks", "hooks.json"))
AF_ROOT = "AF-DS-ROOT"
AF_ARGS = "AF-DS-ARGS"
ORDER_RE = re.compile(r'^DRAMA_ORDER\s+(\S+)\s+"([^"]*)"\s*$')


# ---------------------------------------------------------------- root and state
def skill_root(explicit=None):
    """The skill/plugin root. It is separate from the state folder and never assumed."""
    r = explicit or os.environ.get("CLAUDE_PLUGIN_ROOT") or os.environ.get("DRAMA_STUDIO_SKILL_ROOT")
    if not r:
        r = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.expanduser(r))


def root_missing(root):
    return [m for m in MARKERS if not os.path.isfile(os.path.join(root, m))]


def state_dir(explicit=None):
    d = explicit or os.environ.get("DRAMA_STUDIO_STATE")
    if not d:
        d = os.path.join(os.path.expanduser("~"), STATE_DIR_NAME)
    return os.path.abspath(os.path.expanduser(d))


def state_path(d):
    return os.path.join(d, "state.json")


def load_state(d):
    try:
        with open(state_path(d), encoding="utf-8") as fh:
            s = json.load(fh)
        if isinstance(s, dict):
            return s
    except Exception:
        pass
    return {}


def save_state(d, s):
    os.makedirs(d, mode=0o700, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    tmp = state_path(d) + ".tmp.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(s, fh, sort_keys=True)
        fh.write("\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, state_path(d))


# ---------------------------------------------------------------- budgets
def run_budget(fn, budget):
    """Run fn under a hard wall-clock budget. A run past it raises; the caller silences."""
    box = {}

    def work():
        try:
            box["v"] = fn()
        except BaseException as exc:  # a timeout, an OSError, anything
            box["e"] = exc

    t = threading.Thread(target=work, daemon=True)
    t.start()
    t.join(budget)
    if t.is_alive():
        raise TimeoutError("budget of %.1fs exceeded" % budget)
    if "e" in box:
        raise box["e"]
    return box.get("v")


# ---------------------------------------------------------------- the studio
def fake_mode():
    return os.environ.get("DRAMA_STUDIO_FAKE") == "1"


def _fake_calls():
    p = os.environ.get("DRAMA_STUDIO_FAKE_CALLS")
    if p:
        with open(p, "a", encoding="utf-8") as fh:
            fh.write("call\n")


def studio_url():
    env = os.environ.get("DRAMA_STUDIO_URL")
    if env:
        return env.rstrip("/")
    try:
        with open(os.path.join(state_dir(), "studio.url"), encoding="utf-8") as fh:
            return fh.read().strip().rstrip("/")
    except Exception:
        return ""


def machine_key():
    try:
        with open(os.path.join(state_dir(), "machine.key"), encoding="utf-8") as fh:
            return fh.read().strip()
    except Exception:
        return ""


def fetch_line():
    """Ask the studio for the one waiting order. Returns the line or None. Never prints a key."""
    if fake_mode():
        _fake_calls()
        delay = float(os.environ.get("DRAMA_STUDIO_FAKE_DELAY") or 0)
        if delay:
            time.sleep(delay)
        if os.environ.get("DRAMA_STUDIO_FAKE_ERROR") == "1":
            raise RuntimeError("studio unreachable")
        return os.environ.get("DRAMA_STUDIO_FAKE_LINE") or None
    url = studio_url()
    if not url:
        return None
    req = urllib.request.Request(
        url + "/api/studio/checkin",
        data=b'{"orders": true}',
        method="POST",
        headers={"x-ds-key": machine_key(), "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=NETWORK_BUDGET_S) as resp:
        body = json.loads(resp.read().decode("utf-8") or "{}")
    return body.get("line")


def check_network():
    """The network call, inside its own 3-second budget."""
    return run_budget(fetch_line, NETWORK_BUDGET_S)


def parse_order(line):
    if not line:
        return None
    m = ORDER_RE.match(str(line).strip())
    return (m.group(1), m.group(2)) if m else None


# ---------------------------------------------------------------- the hook
def hook_work(session_id, sd):
    st = load_state(sd)
    now = time.time()
    last = st.get("last_check_at")
    fresh = isinstance(last, (int, float)) and (now - last) < CACHE_SECONDS
    if fresh:
        line = st.get("cached_line")
    else:
        line = check_network()          # may raise -> the caller silences
        st["cached_line"] = line
        st["last_check_at"] = now
        save_state(sd, st)
    order = parse_order(line)
    if not order:
        save_state(sd, st)
        return None
    oid, title = order
    key = "%s|%s" % (oid, session_id or "-")
    if (st.get("announced") or {}).get(key):
        return None
    st.setdefault("announced", {})[key] = True
    save_state(sd, st)
    return "%s1 order waiting (%s). %s" % (NOTICE_PREFIX, title, LINK_HINT)


def run_hook(sd, stdin_text, root=None):
    """Returns the one notice line, or None. None means silence (rule 4)."""
    if root is not None and root_missing(root):
        return None
    try:
        data = json.loads(stdin_text or "{}") or {}
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    if str(data.get("source") or "") != "startup":
        return None
    sid = str(data.get("session_id") or data.get("sessionId") or "-")
    try:
        return run_budget(lambda: hook_work(sid, sd), HOOK_BUDGET_S)
    except BaseException:
        return None


# ---------------------------------------------------------------- the desktop notice
def _default_sink(body):
    if sys.platform == "darwin":
        subprocess.run(
            ["osascript", "-e", 'display notification "%s" with title "Drama Studio"' % body],
            check=False, timeout=NETWORK_BUDGET_S,
        )
    # Linux/Windows: no default sink. Set DRAMA_STUDIO_DESKTOP_CMD to name one.


def desktop_notify(sd, sink_cmd=None):
    """Rule 2: nothing happens unless the client opted in. Returns the body or None."""
    st = load_state(sd)
    if not st.get("desktop_opt_in"):
        return None
    order = parse_order(st.get("cached_line"))
    if not order:
        try:
            line = check_network()
        except BaseException:
            return None
        st["cached_line"] = line
        st["last_check_at"] = time.time()
        save_state(sd, st)
        order = parse_order(line)
    if not order:
        return None
    oid, _title = order
    if (st.get("desktop_fired") or {}).get(oid):
        return None
    body = DESKTOP_BODY
    cmd = sink_cmd if sink_cmd is not None else os.environ.get("DRAMA_STUDIO_DESKTOP_CMD")
    try:
        if cmd:
            subprocess.run(["sh", "-c", cmd, "--", body], check=False, timeout=NETWORK_BUDGET_S)
        else:
            _default_sink(body)
    except Exception:
        pass
    st.setdefault("desktop_fired", {})[oid] = True
    save_state(sd, st)
    return body


# ---------------------------------------------------------------- CLI
def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--hook", action="store_true")
    ap.add_argument("--desktop", action="store_true")
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--every", type=float, default=120.0)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--print-root", action="store_true")
    ap.add_argument("--print-state", action="store_true")
    ap.add_argument("--root")
    ap.add_argument("--state")
    try:
        a = ap.parse_args(argv)
    except SystemExit:
        return 2
    root = skill_root(a.root)
    sd = state_dir(a.state)

    if a.print_root:
        miss = root_missing(root)
        if miss:
            sys.stderr.write(
                "%s refused: %s is not the drama-studio root (missing %s)\n"
                % (AF_ROOT, root, ", ".join(miss))
            )
            return 2
        print(root)
        return 0

    if a.print_state:
        print(sd)
        return 0

    if a.hook:
        text = ""
        if not sys.stdin.isatty():
            try:
                text = sys.stdin.read()
            except Exception:
                text = ""
        out = run_hook(sd, text, root=root)
        if out:
            sys.stdout.write(out + "\n")
        return 0

    if a.desktop:
        out = desktop_notify(sd)
        if out:
            sys.stdout.write(out + "\n")
        return 0

    if a.watch:
        while True:
            try:
                line = check_network()
            except BaseException:
                line = None
            if line:
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
            if a.once:
                return 0
            time.sleep(max(1.0, a.every))

    sys.stderr.write("%s need one of --hook, --desktop, --watch, --print-root, --print-state\n" % AF_ARGS)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
