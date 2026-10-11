#!/usr/bin/env python3
# heartbeat.py — the Drama Studio heartbeat job (U15).
#
# NATIVE TIMER ONLY. The job runs exactly one program on a timer:
#
#     <absolute interpreter>  <absolute .../studio_check.py>  --desktop
#
# studio_check.py (U13) stays silent unless the client opted in, so the desktop
# notice is REQUESTED only, never unsolicited. The heartbeat itself notifies
# nobody, and it runs NO Claude process: no code path here launches, execs or
# spawns Claude, in any form. Every path it writes into the timer is absolute —
# a launchd job and a Task Scheduler task both run with no PATH and no working
# directory, so a relative path or a bare program name would simply fail.
#
# Usage:
#   heartbeat.py print-plist [--interval N]        # the macOS LaunchAgent plist
#   heartbeat.py print-task-xml [--interval N]     # the Windows Task Scheduler XML
#   heartbeat.py install [--interval N] [--dir D] [--dry-run]
#   heartbeat.py uninstall [--dir D] [--dry-run]
#   heartbeat.py status [--dir D]
#   heartbeat.py beat                              # run one beat now
#
# EXIT CODES
#   0  fine
#   2  a named refusal: AF-DS-HEARTBEAT (bad interval, non-absolute path, unsupported OS)
#   3  could not run
import argparse
import os
import plistlib
import subprocess
import sys
from xml.sax.saxutils import escape as xml_escape

LABEL = "com.blackceo.drama-studio.heartbeat"
TASK_NAME = "DramaStudioHeartbeat"
DEFAULT_INTERVAL = 900          # seconds; 15 minutes
MIN_INTERVAL = 60
CHECK_NAME = "studio_check.py"
REFUSE = "AF-DS-HEARTBEAT"

# The heartbeat is allowed to run the interpreter and this ONE script, nothing else.
ALLOWED_SCRIPT = CHECK_NAME


# ---------------------------------------------------------------- paths (all absolute)
def this_dir():
    return os.path.dirname(os.path.realpath(os.path.abspath(__file__)))


def check_script():
    return os.path.join(this_dir(), CHECK_NAME)


def interpreter():
    """The absolute interpreter for the timer. Never a bare name: the timer has no PATH."""
    exe = sys.executable or ""
    if exe and os.path.isabs(exe):
        return os.path.realpath(exe)
    for cand in ("/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"):
        if os.path.isfile(cand):
            return cand
    return ""


def home_dir():
    return os.path.realpath(os.path.expanduser("~"))


def default_plist_dir():
    return os.path.join(home_dir(), "Library", "LaunchAgents")


def plist_path(d=None):
    return os.path.join(d or default_plist_dir(), LABEL + ".plist")


def program_arguments():
    """The one argv the timer runs: absolute interpreter, absolute check, --desktop."""
    return [interpreter(), check_script(), "--desktop"]


def _non_absolute(paths):
    return [p for p in paths if not os.path.isabs(p)]


def is_claude(path):
    """A program that would start Claude. The heartbeat refuses to run one, ever."""
    return os.path.basename(path or "").lower().startswith("claude")


def refuse(msg):
    sys.stderr.write("%s refused: %s\n" % (REFUSE, msg))
    return 2


def valid_interval(raw):
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if n >= MIN_INTERVAL else None


# ---------------------------------------------------------------- native timer artifacts
def render_plist(interval):
    """The macOS LaunchAgent: a real plist with StartInterval and absolute arguments."""
    body = {
        "Label": LABEL,
        "ProgramArguments": program_arguments(),
        "StartInterval": int(interval),
        "RunAtLoad": False,
    }
    return plistlib.dumps(body)


def render_task_xml(interval):
    """The Windows Task Scheduler definition: a repeating TimeTrigger, absolute paths."""
    minutes = max(1, int(interval) // 60)
    command = xml_escape(interpreter())
    arguments = xml_escape('"%s" --desktop' % check_script())
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n'
        '  <Triggers>\n'
        '    <TimeTrigger>\n'
        '      <Repetition>\n'
        '        <Interval>PT%dM</Interval>\n' % minutes +
        '        <StopAtDurationEnd>false</StopAtDurationEnd>\n'
        '      </Repetition>\n'
        '      <StartBoundary>2026-01-01T00:00:00</StartBoundary>\n'
        '      <Enabled>true</Enabled>\n'
        '    </TimeTrigger>\n'
        '  </Triggers>\n'
        '  <Actions Context="Author">\n'
        '    <Exec>\n'
        '      <Command>%s</Command>\n' % command +
        '      <Arguments>%s</Arguments>\n' % arguments +
        '    </Exec>\n'
        '  </Actions>\n'
        '</Task>\n'
    )


def _guard():
    """The two program paths must be absolute, and no program may be Claude."""
    argv = program_arguments()
    bad = _non_absolute(argv[:2])          # interpreter and script; the rest are flags
    if bad:
        return refuse("non-absolute path(s): %s" % ", ".join(bad))
    if is_claude(argv[0]) or is_claude(argv[1]):
        return refuse("refusing to run a Claude process; the heartbeat never starts Claude")
    if os.path.basename(argv[1]) != ALLOWED_SCRIPT:
        return refuse("the heartbeat runs only %s" % ALLOWED_SCRIPT)
    return 0


# ---------------------------------------------------------------- commands
def cmd_print_plist(a):
    interval = valid_interval(a.interval)
    if interval is None:
        return refuse("interval must be an integer >= %d" % MIN_INTERVAL)
    sys.stdout.buffer.write(render_plist(interval))
    return 0


def cmd_print_task_xml(a):
    interval = valid_interval(a.interval)
    if interval is None:
        return refuse("interval must be an integer >= %d" % MIN_INTERVAL)
    sys.stdout.write(render_task_xml(interval))
    return 0


def cmd_install(a):
    rc = _guard()
    if rc:
        return rc
    interval = valid_interval(a.interval)
    if interval is None:
        return refuse("interval must be an integer >= %d" % MIN_INTERVAL)
    if not os.path.isfile(check_script()):
        return refuse("check script missing: %s" % check_script())
    target = plist_path(a.dir)
    if not os.path.isabs(target):
        return refuse("timer path is not absolute: %s" % target)
    if sys.platform not in ("darwin", "win32"):
        return refuse("unsupported OS for a native timer: %s" % sys.platform)

    if sys.platform == "win32":
        xml = render_task_xml(interval)
        xml_file = os.path.join(home_dir(), ".drama-studio", "heartbeat-task.xml")
        if not os.path.isabs(xml_file):
            return refuse("task definition path is not absolute: %s" % xml_file)
        if a.dry_run:
            sys.stdout.write("dry-run: would write %s and register task %s\n" % (xml_file, TASK_NAME))
            sys.stdout.write(xml)
            return 0
        os.makedirs(os.path.dirname(xml_file), mode=0o700, exist_ok=True)
        with open(xml_file, "w", encoding="utf-8") as fh:
            fh.write(xml)
        if not a.no_load:
            subprocess.run(["schtasks", "/create", "/tn", TASK_NAME, "/xml", xml_file, "/f"], check=False)
        sys.stdout.write("installed task: %s\n" % TASK_NAME)
        return 0

    data = render_plist(interval)
    if a.dry_run:
        sys.stdout.write("dry-run: would write %s\n" % target)
        sys.stdout.buffer.write(data)
        return 0
    os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
    with open(target, "wb") as fh:
        fh.write(data)
    if not a.no_load:
        subprocess.run(["launchctl", "unload", target], check=False)
        subprocess.run(["launchctl", "load", target], check=False)
    sys.stdout.write("installed: %s\n" % target)
    return 0


def cmd_uninstall(a):
    if sys.platform == "win32":
        if a.dry_run:
            sys.stdout.write("dry-run: would remove task %s\n" % TASK_NAME)
            return 0
        subprocess.run(["schtasks", "/delete", "/tn", TASK_NAME, "/f"], check=False)
        sys.stdout.write("removed task: %s\n" % TASK_NAME)
        return 0
    target = plist_path(a.dir)
    if not os.path.isabs(target):
        return refuse("timer path is not absolute: %s" % target)
    if a.dry_run:
        sys.stdout.write("dry-run: would remove %s\n" % target)
        return 0
    subprocess.run(["launchctl", "unload", target], check=False)
    try:
        os.remove(target)
    except FileNotFoundError:
        pass
    sys.stdout.write("removed: %s\n" % target)
    return 0


def cmd_status(a):
    target = plist_path(a.dir)
    installed = os.path.isfile(target)
    loaded = False
    if sys.platform == "darwin" and installed:
        p = subprocess.run(["launchctl", "list"], capture_output=True, text=True, check=False)
        loaded = LABEL in (p.stdout or "")
    sys.stdout.write("installed: %s\n" % installed)
    sys.stdout.write("loaded: %s\n" % loaded)
    sys.stdout.write("plist: %s\n" % target)
    sys.stdout.write("label: %s\n" % LABEL)
    return 0


def cmd_beat(a):
    """Run one beat now: the absolute interpreter with studio_check.py --desktop, nothing else."""
    rc = _guard()
    if rc:
        return rc
    argv = program_arguments()
    try:
        subprocess.run(argv, check=False, timeout=30)
    except Exception as exc:
        sys.stderr.write("%s beat failed: %s\n" % (REFUSE, exc))
    return 0


def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    sub = ap.add_subparsers(dest="cmd")
    for name in ("print-plist", "print-task-xml", "install", "uninstall", "status", "beat"):
        p = sub.add_parser(name)
        if name in ("print-plist", "print-task-xml", "install"):
            p.add_argument("--interval", default=str(DEFAULT_INTERVAL))
        if name in ("install", "uninstall", "status"):
            p.add_argument("--dir", default=None)
        if name in ("install",):
            p.add_argument("--no-load", action="store_true")
        if name in ("install", "uninstall"):
            p.add_argument("--dry-run", action="store_true")
    try:
        a = ap.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2
    if not a.cmd:
        sys.stderr.write("%s need one of print-plist, print-task-xml, install, uninstall, status, beat\n" % REFUSE)
        return 2
    return {
        "print-plist": cmd_print_plist,
        "print-task-xml": cmd_print_task_xml,
        "install": cmd_install,
        "uninstall": cmd_uninstall,
        "status": cmd_status,
        "beat": cmd_beat,
    }[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
