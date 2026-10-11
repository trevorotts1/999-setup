#!/usr/bin/env python3
# option3_runner.py — the Option-3 background run (U16), SHIPPED OFF.
#
# Usage:
#   option3_runner.py status   [--state D] [--root R]
#   option3_runner.py plan     [--state D] [--root R] [--launcher L] [--order-id ID]
#   option3_runner.py check    [--state D] [--root R] [--launcher L]   # the scheduled entry
#   option3_runner.py print-job[--state D] [--root R] [--launcher L] [--every N]
#
# THE RULE THIS FILE OWNS (JOINT PLAN section 3.10 "Option 3", row U16):
#   Option 3 starts a run with nobody present, so it is the highest-risk mode and it
#   ships OFF. It does NOTHING until Trevor has approved that one client BY NAME and
#   that approval is recorded in this computer's protected state. Until then `check`
#   exits 0 silently: no order lookup, no lock, no child process, no spend.
#
# THE FIVE PIECES (plan row 1083: scoped command / lock / cap / log receipt /
# selected-root child environment):
#   1  SCOPED COMMAND — one fixed argv. Exactly two script allow-rules plus Read.
#      Permission mode dontAsk with prompts off (an unanswered question is refused,
#      Claude is told not to retry). The bare flag and the bypass permission mode are
#      structurally impossible: FORBIDDEN_FLAGS is checked on every build.
#   2  LOCK — one run at a time. `check` takes the lock before it starts anything; a
#      second `check` while the lock is fresh does nothing. A lock older than
#      LOCK_STALE_S is reclaimed so a killed run cannot wedge the job forever.
#   3  CAP — --max-budget-usd <cap> per run, taken from the approval record. A record
#      without a positive cap is refused (AF-DS-OPT3-CAP); there is no default cap.
#   4  LOG RECEIPT — every run writes its raw log and one JSON receipt under
#      <state>/option3-runs/. The receipt carries counts and paths, never the machine
#      key and never the child environment.
#   5  SELECTED-ROOT CHILD ENVIRONMENT — the child runs with its working directory set
#      to the approval's selected root and with DRAMA_STUDIO_SELECTED_ROOT exported,
#      so the run lands in the root that was chosen for this client and not wherever
#      the scheduler happened to start. CLAUDE_CONFIG_DIR is dropped: claude-nine
#      reuses the same Claude config root as plain claude (999-setup rule 10).
#
# NO ACTIVATION. This file installs nothing, loads nothing, and writes no approval:
# the approval record is written by the studio admin page when Trevor approves that
# client by name. `print-job` prints the launchd plist as text; it never writes it.
# Nothing in this repo runs `check`: installing the job is the separately-approved,
# separately-owned step (plan U19 is the canary).
#
# EXIT CODES
#   0  nothing to do (off, no order, or a run that exited 0)
#   2  a named refusal: AF-DS-OPT3-OFF, AF-DS-OPT3-APPROVAL, AF-DS-OPT3-CAP,
#      AF-DS-OPT3-ROOT, AF-DS-OPT3-ARGS
#   3  the runner could not run (no python3 when the job is previewed)
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import time

STATE_DIR_NAME = ".drama-studio"
APPROVAL_FILE = "option3-approval.json"
LOCK_FILE = "option3.lock.json"
RUNS_DIR = "option3-runs"
LOCK_STALE_S = 6 * 3600          # a lock older than six hours is reclaimed
DEFAULT_EVERY_S = 120            # the plan's two-minute check
PERMISSION_MODE = "dontAsk"
PERMISSION_PROMPTS = "none"
OUTPUT_FORMAT = "json"
JOB_LABEL = "com.blackceo.drama-studio.option3"
PROMPT = "Use the drama-studio skill. Pick up studio order %s and run it to the next approval stop."
FORBIDDEN_FLAGS = ("--bare", "--dangerously-skip-permissions", "bypassPermissions")
AF_OFF = "AF-DS-OPT3-OFF"
AF_APPROVAL = "AF-DS-OPT3-APPROVAL"
AF_CAP = "AF-DS-OPT3-CAP"
AF_ROOT = "AF-DS-OPT3-ROOT"
AF_ARGS = "AF-DS-OPT3-ARGS"
CLIENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .'_-]{0,63}$")


# ---------------------------------------------------------------- state
def state_dir(explicit=None):
    d = explicit or os.environ.get("DRAMA_STUDIO_STATE")
    if not d:
        d = os.path.join(os.path.expanduser("~"), STATE_DIR_NAME)
    return os.path.abspath(os.path.expanduser(d))


def skill_root(explicit=None):
    r = explicit or os.environ.get("CLAUDE_PLUGIN_ROOT") or os.environ.get("DRAMA_STUDIO_SKILL_ROOT")
    if not r:
        r = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.expanduser(r))


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            v = json.load(fh)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


# ---------------------------------------------------------------- named approval
def read_approval(sd):
    """('off', None) | ('named', record) | ('invalid', reason). Never writes."""
    path = os.path.join(sd, APPROVAL_FILE)
    if not os.path.isfile(path):
        return "off", None
    rec = read_json(path)
    if rec is None:
        return "invalid", "approval record is not a JSON object"
    if rec.get("background") is not True:
        return "invalid", "the studio record does not say background: true"
    client = rec.get("client")
    if not isinstance(client, str) or not CLIENT_RE.match(client.strip()):
        return "invalid", "the approval does not name a client"
    if not str(rec.get("approved_by") or "").strip():
        return "invalid", "the approval does not name who approved it"
    if not str(rec.get("approved_at") or "").strip():
        return "invalid", "the approval carries no date"
    cap = rec.get("cap_usd")
    if not isinstance(cap, (int, float)) or isinstance(cap, bool) or cap <= 0:
        return "invalid", "the approval carries no positive per-run cap"
    root = rec.get("run_root")
    if not isinstance(root, str) or not root.startswith("/"):
        return "invalid", "the approval carries no absolute selected root"
    return "named", rec


# ---------------------------------------------------------------- 1  scoped command
def factory_path(root):
    """The factory's front door, a sibling of this skill folder."""
    return os.path.join(os.path.dirname(root), "drama-song-ad-factory", "scripts",
                        "core", "intake_preflight", "factory.py")


def bridge_path(root):
    return os.path.join(root, "studio_bridge.py")


def allowed_tools(root):
    """Exactly two script rules plus Read. Nothing else is ever allowed."""
    return ["Bash(python3 %s *)" % factory_path(root),
            "Bash(python3 %s *)" % bridge_path(root),
            "Read"]


def cap_text(cap):
    return "%g" % float(cap)


def plan_command(rec, root, order_id, launcher=None):
    """The one argv Option 3 is allowed to run (plan 3.10, 'The exact command')."""
    launcher = launcher or os.environ.get("DRAMA_STUDIO_LAUNCHER") or "claude-nine"
    argv = [launcher,
            "-p", PROMPT % order_id,
            "--permission-mode", PERMISSION_MODE,
            "--permission-prompts", PERMISSION_PROMPTS,
            "--allowedTools"]
    argv += allowed_tools(root)
    argv += ["--max-budget-usd", cap_text(rec.get("cap_usd")),
             "--output-format", OUTPUT_FORMAT,
             "--name", "drama-studio-%s" % order_id]
    assert_scoped(argv)
    return argv


def assert_scoped(argv):
    for a in argv:
        if a in FORBIDDEN_FLAGS:
            raise ValueError("refused: %s may never appear in the Option-3 command" % a)
    return True


def argv_sha(argv):
    return hashlib.sha256("\0".join(argv).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- 5  child environment
def child_env(rec, sd, root):
    """The selected-root child environment. No config-root override, ever."""
    env = dict(os.environ)
    env.pop("CLAUDE_CONFIG_DIR", None)
    env["DRAMA_STUDIO_SELECTED_ROOT"] = rec["run_root"]
    env["DRAMA_STUDIO_STATE"] = sd
    env["DRAMA_STUDIO_SKILL_ROOT"] = root
    env["CLAUDE_PLUGIN_ROOT"] = root
    return env


# ---------------------------------------------------------------- 2  lock
def lock_path(sd):
    return os.path.join(sd, LOCK_FILE)


def lock_status(sd, now=None):
    now = time.time() if now is None else now
    rec = read_json(lock_path(sd))
    if rec is None:
        return "free"
    try:
        started = float(rec.get("started_epoch"))
    except Exception:
        return "stale"
    return "held" if (now - started) < LOCK_STALE_S else "stale"


def acquire_lock(sd, who, now=None):
    """(True, 'acquired') or (False, 'held'). A stale lock is reclaimed."""
    now = time.time() if now is None else now
    if lock_status(sd, now) == "held":
        return False, "held"
    os.makedirs(sd, mode=0o700, exist_ok=True)
    tmp = lock_path(sd) + ".tmp.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"pid": os.getpid(), "client": who, "started_epoch": now,
                   "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))},
                  fh, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, lock_path(sd))
    return True, "acquired"


def release_lock(sd):
    try:
        os.remove(lock_path(sd))
    except OSError:
        pass


# ---------------------------------------------------------------- 4  log receipt
def runs_dir(sd):
    return os.path.join(sd, RUNS_DIR)


def receipt_name(now=None):
    now = time.time() if now is None else now
    return "run-%s" % time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now))


def write_receipt(sd, receipt, log_text):
    """Returns (receipt_path, log_path). Never carries the key or the environment."""
    d = runs_dir(sd)
    os.makedirs(d, mode=0o700, exist_ok=True)
    log_path = os.path.join(d, receipt["name"] + ".log")
    with open(log_path, "w", encoding="utf-8") as fh:
        fh.write(log_text or "")
    os.chmod(log_path, 0o600)
    rp = os.path.join(d, receipt["name"] + ".json")
    tmp = rp + ".tmp.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(receipt, fh, sort_keys=True)
        fh.write("\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, rp)
    return rp, log_path


def read_receipt(path):
    return read_json(path)


# ---------------------------------------------------------------- the order
def load_check_module(root):
    path = os.path.join(root, "studio_check.py")
    spec = importlib.util.spec_from_file_location("drama_studio_check_opt3", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def find_order(root, fetch_line=None, parse_order=None):
    """One waiting order as (id, title), or None. An unreachable studio is None."""
    if fetch_line is None or parse_order is None:
        mod = load_check_module(root)
        fetch_line = fetch_line or mod.fetch_line
        parse_order = parse_order or mod.parse_order
    try:
        line = fetch_line()
    except BaseException:
        return None
    return parse_order(line)


# ---------------------------------------------------------------- the run
def do_run(sd, root, rec, order, launcher=None, runner=None, now=None):
    """Take the lock, build the command, run it selected-root, write the receipt."""
    now = time.time() if now is None else now
    oid, title = order
    root_dir = rec["run_root"]
    if not os.path.isdir(root_dir):
        return {"refused": AF_ROOT, "path": root_dir}
    ok, why = acquire_lock(sd, rec["client"], now=now)
    if not ok:
        return {"locked": why}
    name = receipt_name(now)
    argv = plan_command(rec, root, oid, launcher=launcher)
    env = child_env(rec, sd, root)
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    rc, text = 0, ""
    try:
        if runner is not None:
            rc, text = runner(argv, root_dir, env)
    finally:
        release_lock(sd)
    receipt = {"name": name, "client": rec["client"], "order_id": oid, "order_title": title,
               "started_at": started,
               "ended_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time())),
               "exit_code": int(rc), "cap_usd": rec.get("cap_usd"), "launcher": argv[0],
               "selected_root": root_dir, "allowed_tools": allowed_tools(root),
               "argv_sha256": argv_sha(argv)}
    rp, lp = write_receipt(sd, receipt, text)
    return {"exit_code": int(rc), "receipt": rp, "log": lp}


def real_runner(argv, cwd, env):
    import subprocess
    p = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


# ---------------------------------------------------------------- preview only
def xml_escape(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def job_plist(sd, root, launcher=None, every=DEFAULT_EVERY_S):
    """The launchd job as TEXT. Printing it writes nothing and installs nothing."""
    launcher = launcher or "claude-nine"
    args = [sys.executable, os.path.join(root, "option3_runner.py"), "check",
            "--state", sd, "--root", root, "--launcher", launcher]
    body = "".join("<string>%s</string>" % xml_escape(a) for a in args)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n<dict>\n'
        "  <key>Label</key><string>%s</string>\n"
        "  <key>ProgramArguments</key><array>%s</array>\n"
        "  <key>StartInterval</key><integer>%d</integer>\n"
        "  <key>RunAtLoad</key><false/>\n"
        "  <key>StandardOutPath</key><string>%s</string>\n"
        "  <key>StandardErrorPath</key><string>%s</string>\n"
        "</dict>\n</plist>\n"
        % (xml_escape(JOB_LABEL), body, int(every),
           xml_escape(os.path.join(runs_dir(sd), "job.out.log")),
           xml_escape(os.path.join(runs_dir(sd), "job.err.log")))
    )


# ---------------------------------------------------------------- CLI
def cmd_status(a, root, sd):
    state, rec = read_approval(sd)
    if state == "off":
        sys.stdout.write("option3: off\n")
    elif state == "invalid":
        sys.stdout.write("option3: invalid (%s)\n" % rec)
    else:
        sys.stdout.write("option3: named %s cap %s root %s\n"
                         % (rec["client"], cap_text(rec["cap_usd"]), rec["run_root"]))
    return 0


def cmd_plan(a, root, sd):
    state, rec = read_approval(sd)
    if state == "off":
        sys.stderr.write("%s refused: no named approval on this computer\n" % AF_OFF)
        return 2
    if state == "invalid":
        sys.stderr.write("%s refused: %s\n" % (AF_APPROVAL, rec))
        return 2
    oid = a.order_id or "r_000"
    sys.stdout.write(json.dumps(plan_command(rec, root, oid, launcher=a.launcher),
                                indent=2) + "\n")
    return 0


def cmd_check(a, root, sd, runner=None, fetch_line=None, parse_order=None):
    state, rec = read_approval(sd)
    if state == "off":
        return 0                                   # shipped off: silent, zero tokens
    if state == "invalid":
        sys.stderr.write("%s refused: %s\n" % (AF_APPROVAL, rec))
        return 2
    order = find_order(root, fetch_line=fetch_line, parse_order=parse_order)
    if not order:
        return 0
    if not os.path.isdir(rec["run_root"]):
        sys.stderr.write("%s refused: selected root is not a folder: %s\n"
                         % (AF_ROOT, rec["run_root"]))
        return 2
    out = do_run(sd, root, rec, order, launcher=a.launcher, runner=runner)
    if "locked" in out:
        sys.stdout.write("option3: skipped (%s) - a run is already in progress\n" % out["locked"])
        return 0
    if "refused" in out:
        sys.stderr.write("%s refused: %s\n" % (out["refused"], out["path"]))
        return 2
    sys.stdout.write("option3: order %s exit %d receipt %s\n"
                     % (order[0], out["exit_code"], out["receipt"]))
    return 0 if out["exit_code"] == 0 else out["exit_code"]


def cmd_print_job(a, root, sd):
    sys.stdout.write(job_plist(sd, root, launcher=a.launcher, every=a.every))
    return 0


def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    sub = ap.add_subparsers(dest="cmd")
    for name in ("status", "plan", "check", "print-job"):
        p = sub.add_parser(name)
        p.add_argument("--state")
        p.add_argument("--root")
        p.add_argument("--launcher")
        p.add_argument("--order-id")
        p.add_argument("--order-title")
        if name == "print-job":
            p.add_argument("--every", type=int, default=DEFAULT_EVERY_S)
    try:
        a = ap.parse_args(argv)
    except SystemExit:
        return 2
    root = skill_root(getattr(a, "root", None))
    sd = state_dir(getattr(a, "state", None))
    if a.cmd == "status":
        return cmd_status(a, root, sd)
    if a.cmd == "plan":
        return cmd_plan(a, root, sd)
    if a.cmd == "check":
        return cmd_check(a, root, sd)
    if a.cmd == "print-job":
        return cmd_print_job(a, root, sd)
    sys.stderr.write("%s need one of: status, plan, check, print-job\n" % AF_ARGS)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
