#!/usr/bin/env python3
# prove_heartbeat.py — the runnable proof for the Drama Studio heartbeat job (U15).
#
# Four binding properties, each proven twice: once on the real heartbeat.py and once on
# a planted-bad copy that carries exactly that one defect. A check counts only when the
# real run passes AND the planted-bad run is CAUGHT. A plant that stays green is vacuous
# and the prover exits 2 (it proves nothing).
#
#   1 native timer   — the macOS plist and the Windows Task Scheduler XML are real timers
#   2 absolute paths — every path written into the timer is absolute
#   3 requested only — no opt-in means NO notice; opt-in fires exactly one
#   4 never Claude   — no code path launches, execs or spawns a Claude process
# Plus: install writes the timer into the named absolute dir; --dry-run writes nothing.
#
# It installs, loads or enables NOTHING live: it never calls launchctl or schtasks, it
# points the timer at a /tmp scratch dir with --no-load / --dry-run, and it points the
# desktop sink at a scratch file. Every planted-bad run ALSO runs with --no-load.
#
# EXIT CODES
#   0  every check passed and every planted-bad control was caught
#   2  a named check failed, a planted-bad control was NOT caught, or a plant was vacuous
#   3  the prover could not run (heartbeat.py or studio_check.py missing)
import ast
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

PY = sys.executable or "python3"
HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
HEARTBEAT = os.path.join(SKILL, "heartbeat.py")
CHECK = os.path.join(SKILL, "studio_check.py")

BOX = "trevor-macmini"
UNIT = "U15-U1"
LABEL = "com.blackceo.drama-studio.heartbeat"
ORDER_LINE = 'DRAMA_ORDER r_123 "Spring Sale"'
DESKTOP_BODY = "Open Claude Code to start your video"
TASK_NS = "{http://schemas.microsoft.com/windows/2004/02/mit/task}"
CLAUDE_NAMES = ("claude", "claude-nine", "claude-code")
ENV_KEYS = ("DRAMA_STUDIO_FAKE", "DRAMA_STUDIO_FAKE_LINE", "DRAMA_STUDIO_FAKE_DELAY",
            "DRAMA_STUDIO_FAKE_ERROR", "DRAMA_STUDIO_FAKE_CALLS", "DRAMA_STUDIO_STATE",
            "DRAMA_STUDIO_URL", "DRAMA_STUDIO_DESKTOP_CMD", "CLAUDE_PLUGIN_ROOT",
            "DRAMA_STUDIO_SKILL_ROOT")

TMP = None
PLANTED = None
FAILED = []
VACUOUS = []


class PlantError(Exception):
    pass


# ---------------------------------------------------------------- helpers
def child_env(**kw):
    e = dict(os.environ)
    for k in ENV_KEYS:
        e.pop(k, None)
    e["DRAMA_STUDIO_FAKE"] = "1"
    for k, v in kw.items():
        e[k] = str(v)
    return e


def run_hb(script, args, env, timeout=90):
    p = subprocess.run([PY, script] + args, env=env, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


def read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except Exception:
        return ""


def plant(name, old, new):
    src = read(HEARTBEAT)
    if old not in src:
        raise PlantError("plant %s: anchor not found (the plant would be vacuous)" % name)
    dest = os.path.join(PLANTED, name + ".py")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(src.replace(old, new, 1))
    return dest


def say(ok, name, why):
    print("%-4s %s%s" % ("PASS" if ok else "FAIL", name, (" — " + why) if why else ""))
    return ok


def scratch(tag):
    d = os.path.join(TMP, tag)
    os.makedirs(d, exist_ok=True)
    return d


def parse_plist(text):
    return plistlib.loads(text.encode("utf-8"))


def parse_task(text):
    root = ET.fromstring(text)
    interval = root.find(".//%sRepetition/%sInterval" % (TASK_NS, TASK_NS))
    command = root.find(".//%sExec/%sCommand" % (TASK_NS, TASK_NS))
    args = root.find(".//%sExec/%sArguments" % (TASK_NS, TASK_NS))
    return (interval.text if interval is not None else None,
            command.text if command is not None else None,
            args.text if args is not None else None)


def make_sink(path):
    py = path + ".sink.py"
    with open(py, "w", encoding="utf-8") as fh:
        fh.write("import sys\nopen(%r, 'a').write(sys.argv[1] + chr(10))\n" % path)
    return '%s %s "$1"' % (PY, py)


def make_trap_dir():
    """Fake claude launchers at the FRONT of PATH. If any code path spawns one, it fires."""
    d = os.path.join(TMP, "trap")
    os.makedirs(d, exist_ok=True)
    sentinel = os.path.join(TMP, "trap-fired.txt")
    for name in CLAUDE_NAMES:
        p = os.path.join(d, name)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("#!/bin/sh\necho \"$0\" >> %s\nexit 0\n" % sentinel)
        os.chmod(p, 0o755)
    return d, sentinel


def planted_claude_targets(source):
    """Basenames of every program a spawn/exec/system call in `source` names as claude*."""
    hits = []
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        name = getattr(f, "attr", None) or (f.id if isinstance(f, ast.Name) else "")
        if name not in ("run", "Popen", "system", "execv", "execvp", "execl", "execve",
                        "spawnv", "spawnvp", "spawnl", "check_output", "call"):
            continue
        if not node.args:
            continue
        first = node.args[0]
        vals = first.elts if isinstance(first, (ast.List, ast.Tuple)) else [first]
        for v in vals:
            if isinstance(v, ast.Constant) and isinstance(v.value, str) \
                    and os.path.basename(v.value).lower().startswith("claude"):
                hits.append(v.value)
    return hits


# ---------------------------------------------------------------- checks
def check_native_timer():
    """(1) the macOS plist and Windows XML are real native timer definitions."""
    env = child_env()
    rc, out, err = run_hb(HEARTBEAT, ["print-plist"], env)
    plist_ok = False
    try:
        d = parse_plist(out)
        pargs = d.get("ProgramArguments") or []
        plist_ok = (rc == 0 and d.get("Label") == LABEL and d.get("RunAtLoad") is False
                    and d.get("StartInterval") == 900 and len(pargs) == 3
                    and pargs[1].endswith("studio_check.py") and pargs[2] == "--desktop")
    except Exception:
        plist_ok = False

    rc2, out2, _ = run_hb(HEARTBEAT, ["print-task-xml"], env)
    interval, command, args = parse_task(out2)
    task_ok = (rc2 == 0 and interval == "PT15M" and command and args
               and "studio_check.py" in args and "--desktop" in args)

    bad = plant("no-trigger",
                '        "StartInterval": int(interval),\n', "")
    rcb, outb, _ = run_hb(bad, ["print-plist"], env)
    try:
        db = parse_plist(outb)
    except Exception:
        db = {}
    caught = not (isinstance(db.get("StartInterval"), int))

    return say(plist_ok and task_ok and caught, "native-timer",
               "plist=%s (StartInterval=%s) task=%s (interval=%s) | planted no-trigger caught=%s"
               % (plist_ok, d.get("StartInterval") if plist_ok else "?", task_ok, interval, caught))


def check_absolute_paths():
    """(2) every path written into the timer is absolute (launchd and Task Scheduler have no PATH)."""
    env = child_env()
    rc, out, _ = run_hb(HEARTBEAT, ["print-plist"], env)
    d = parse_plist(out)
    pargs = (d.get("ProgramArguments") or [])[:2]
    plist_ok = rc == 0 and pargs and all(os.path.isabs(p) for p in pargs)

    rc2, out2, _ = run_hb(HEARTBEAT, ["print-task-xml"], env)
    _i, command, args = parse_task(out2)
    script = (args or "").split('"')[1] if (args and '"' in args) else ""
    task_ok = rc2 == 0 and os.path.isabs(command or "") and os.path.isabs(script)

    rel = plant("relative-path",
                "def check_script():\n    return os.path.join(this_dir(), CHECK_NAME)",
                "def check_script():\n    return CHECK_NAME")
    rc3, out3, _ = run_hb(rel, ["print-plist"], env)
    try:
        d3 = parse_plist(out3)
        p3 = (d3.get("ProgramArguments") or [""])[1]
    except Exception:
        p3 = ""
    caught = not os.path.isabs(p3)

    return say(plist_ok and task_ok and caught, "absolute-paths",
               "plist argv absolute=%s task command+script absolute=%s | planted relative path caught=%s"
               % (plist_ok, task_ok, caught))


def check_requested_only():
    """(3) no opt-in means NO notice; opt-in fires exactly one. The heartbeat emits nothing itself."""
    sd = scratch("state-ro")
    sink = os.path.join(TMP, "ro-sink.txt")
    env = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE,
                    DRAMA_STUDIO_DESKTOP_CMD=make_sink(sink))
    with open(os.path.join(sd, "state.json"), "w", encoding="utf-8") as fh:
        fh.write('{"cached_line": %s}' % json_quote(ORDER_LINE))
    rc, _o, _e = run_hb(HEARTBEAT, ["beat"], env)
    no_optin_ok = rc == 0 and read(sink).strip() == ""

    with open(os.path.join(sd, "state.json"), "w", encoding="utf-8") as fh:
        fh.write('{"cached_line": %s, "desktop_opt_in": true}' % json_quote(ORDER_LINE))
    rc2, _o2, _e2 = run_hb(HEARTBEAT, ["beat"], env)
    fired = read(sink).strip()
    optin_ok = rc2 == 0 and fired == DESKTOP_BODY and len(read(sink).splitlines()) == 1

    sentinel = os.path.join(TMP, "unrequested.txt")
    noisy = plant("unrequested-notify",
                  "    argv = program_arguments()\n    try:\n        subprocess.run(argv, check=False, timeout=30)",
                  '    open(%r, "a").write("UNREQUESTED\\n")\n'
                  "    argv = program_arguments()\n    try:\n        subprocess.run(argv, check=False, timeout=30)"
                  % sentinel)
    sd2 = scratch("state-ro2")
    with open(os.path.join(sd2, "state.json"), "w", encoding="utf-8") as fh:
        fh.write('{"cached_line": %s}' % json_quote(ORDER_LINE))     # still NO opt-in
    env2 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE,
                     DRAMA_STUDIO_DESKTOP_CMD=make_sink(os.path.join(TMP, "ro-sink2.txt")))
    run_hb(noisy, ["beat"], env2)
    caught = read(sentinel).strip() != ""

    return say(no_optin_ok and optin_ok and caught, "requested-only",
               "no-opt-in silent=%s opt-in fired once=%s | planted unrequested notice caught=%s"
               % (no_optin_ok, optin_ok, caught))


def check_never_starts_claude():
    """(4) THE HARD CLAUSE. No code path may launch, exec or spawn a Claude process.

    Leg A — a live trap: fake `claude`/`claude-nine`/`claude-code` launchers sit at the FRONT
    of PATH and record their name if ever run. Every heartbeat subcommand runs with that PATH.
    Leg B — a source scan: no spawn/exec/system call in heartbeat.py names a claude binary.
    Leg C — a planted-bad copy that DOES spawn `claude` must be caught (else the check is vacuous).
    """
    trap, sentinel = make_trap_dir()
    env = child_env(DRAMA_STUDIO_STATE=scratch("state-nc"), DRAMA_STUDIO_FAKE_LINE=ORDER_LINE,
                    DRAMA_STUDIO_DESKTOP_CMD=make_sink(os.path.join(TMP, "nc-sink.txt")))
    env["PATH"] = trap + os.pathsep + os.environ.get("PATH", "")
    tdir = scratch("nc-la")
    subcommands = [["print-plist"], ["print-task-xml"], ["status", "--dir", tdir],
                   ["install", "--dry-run", "--dir", tdir], ["uninstall", "--dry-run", "--dir", tdir],
                   ["beat"]]
    for args in subcommands:
        run_hb(HEARTBEAT, args, env)
    trap_ok = read(sentinel).strip() == ""

    static_hits = planted_claude_targets(read(HEARTBEAT))
    static_ok = static_hits == []

    bad = plant("spawns-claude",
                "    argv = program_arguments()\n    try:\n        subprocess.run(argv, check=False, timeout=30)",
                '    subprocess.run(["claude", "-p", "hello"], check=False)\n'
                "    argv = program_arguments()\n    try:\n        subprocess.run(argv, check=False, timeout=30)")
    bad_hits = planted_claude_targets(read(bad))
    bad_env = child_env(DRAMA_STUDIO_STATE=scratch("state-nc2"), DRAMA_STUDIO_FAKE_LINE=ORDER_LINE,
                        DRAMA_STUDIO_DESKTOP_CMD=make_sink(os.path.join(TMP, "nc-sink2.txt")))
    bad_env["PATH"] = trap + os.pathsep + os.environ.get("PATH", "")
    run_hb(bad, ["beat"], bad_env)
    caught = read(sentinel).strip() != "" and bad_hits != []

    return say(trap_ok and static_ok and caught, "never-starts-claude",
               "trap silent on every subcommand=%s | source spawns no claude=%s | planted spawns-claude"
               " caught=%s (trap=%s static=%s)"
               % (trap_ok, static_ok, caught, read(sentinel).strip().splitlines()[:1], bad_hits))


def check_install_writes():
    """(extra) install writes the native timer into the named absolute dir; --dry-run writes nothing."""
    env = child_env()
    live = scratch("iw-live")
    rc, out, err = run_hb(HEARTBEAT, ["install", "--no-load", "--dir", live], env)
    files = sorted(os.listdir(live))
    target = os.path.join(live, LABEL + ".plist")
    written_ok = rc == 0 and files == [LABEL + ".plist"]
    try:
        d = parse_plist(read(target))
        abs_ok = all(os.path.isabs(p) for p in (d.get("ProgramArguments") or [])[:2])
    except Exception:
        abs_ok = False

    dry = scratch("iw-dry")
    rc2, _o2, _e2 = run_hb(HEARTBEAT, ["install", "--dry-run", "--dir", dry], env)
    dry_ok = rc2 == 0 and os.listdir(dry) == []

    bad = plant("dryrun-writes",
                "    data = render_plist(interval)\n    if a.dry_run:",
                "    data = render_plist(interval)\n    if False:")
    dry2 = scratch("iw-dry2")
    run_hb(bad, ["install", "--dry-run", "--no-load", "--dir", dry2], env)
    caught = os.listdir(dry2) != []

    return say(written_ok and abs_ok and dry_ok and caught, "install-writes",
               "installed=%s abs=%s | dry-run wrote nothing=%s | planted dry-run-writes caught=%s"
               % (written_ok, abs_ok, dry_ok, caught))


def json_quote(s):
    import json
    return json.dumps(s)


CHECKS = [check_native_timer, check_absolute_paths, check_requested_only,
          check_never_starts_claude, check_install_writes]


def main():
    global TMP, PLANTED
    for p in (HEARTBEAT, CHECK):
        if not os.path.isfile(p):
            print("prover cannot run: missing %s" % p, file=sys.stderr)
            return 3
    TMP = tempfile.mkdtemp(prefix="%s-%s-" % (BOX, UNIT))
    PLANTED = os.path.join(TMP, "planted")
    os.makedirs(PLANTED, exist_ok=True)
    # a planted copy lives outside the skill folder; give it a real sibling script so its own
    # "check script missing" gate is not what silences it (that would make a plant vacuous).
    shutil.copyfile(CHECK, os.path.join(PLANTED, "studio_check.py"))
    print("prover scratch: %s" % TMP)
    try:
        for fn in CHECKS:
            try:
                if not fn():
                    FAILED.append(fn.__name__)
            except PlantError as exc:
                VACUOUS.append("%s: %s" % (fn.__name__, exc))
                print("FAIL %s — %s" % (fn.__name__, exc))
            except subprocess.TimeoutExpired:
                FAILED.append(fn.__name__)
                print("FAIL %s — a run exceeded the timeout" % fn.__name__)
        print("-" * 72)
        if VACUOUS:
            for v in VACUOUS:
                print("VACUOUS PLANT: %s" % v)
            return 2
        if FAILED:
            print("prover: %d/%d checks failed: %s" % (len(FAILED), len(CHECKS), ", ".join(FAILED)))
            return 2
        print("prover: %d/%d checks passed, every planted-bad control was caught"
              % (len(CHECKS), len(CHECKS)))
        return 0
    finally:
        shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
