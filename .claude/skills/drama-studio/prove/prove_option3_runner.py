#!/usr/bin/env python3
# prove_option3_runner.py — the runnable proof for the Option-3 runner (U16).
#
# For every rule the runner owns it runs the REAL module, then runs a copy of the
# module carrying exactly ONE planted defect and requires that defect to be caught.
# A check counts as proof only when the real run passes AND the planted-bad copy
# fails. A planted-bad copy that stays green makes the check vacuous and the prover
# exits 2. That is what makes each check a real flip and not a wording test.
#
# IT ACTIVATES NOTHING. It never starts Claude, never runs the real child, never
# loads a launchd job and never writes an approval. Every run goes through a spy
# runner that records the argv, the cwd and the environment and returns at once.
# The scratch root is /tmp/operator-U16-U1-* (this box, this unit) and is removed
# at the end.
#
# EXIT CODES
#   0  every check passed and every planted-bad control was caught
#   2  a named check failed, or a planted-bad control stayed green (vacuous)
#   3  the prover could not run (the runner under test is missing)
import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
RUNNER = os.path.join(SKILL, "option3_runner.py")
TMP_PREFIX = "operator-U16-U1-"
ORDER_LINE = 'DRAMA_ORDER r_1 "Spring Sale"'
ORDER = ("r_1", "Spring Sale")
KEY_VALUE = "SECRETKEY-NEVER-IN-A-RECEIPT"

FAILED = []
VACUOUS = []
_IMPORT_N = [0]
TMP = None


# ---------------------------------------------------------------- plants
# One targeted textual mutation per check. The anchor must appear exactly once.
PLANTS = {
    "off_default": [(
        '    if not os.path.isfile(path):\n        return "off", None',
        '    if not os.path.isfile(path):\n        return "named", {"client": "X", '
        '"approved_by": "T", "approved_at": "d", "cap_usd": 1, "run_root": "/tmp", '
        '"background": True}')],
    "named_approval": [(
        '    if not isinstance(client, str) or not CLIENT_RE.match(client.strip()):\n'
        '        return "invalid", "the approval does not name a client"',
        '    if False:\n        return "invalid", "x"')],
    "lock": [(
        '    return "held" if (now - started) < LOCK_STALE_S else "stale"',
        '    return "free"')],
    "cap": [(
        '    return "%g" % float(cap)', '    return "100"')],
    "scoped_command": [(
        '            "Read"]', '            "Read", "Write"]')],
    "log_receipt": [(
        '    rp = os.path.join(d, receipt["name"] + ".json")',
        '    receipt = dict(receipt)\n'
        '    try:\n'
        '        receipt["leaked_key"] = open(os.path.join(sd, "machine.key")).read().strip()\n'
        '    except Exception:\n'
        '        pass\n'
        '    rp = os.path.join(d, receipt["name"] + ".json")')],
    "selected_root_env": [(
        '    env.pop("CLAUDE_CONFIG_DIR", None)',
        '    env["CLAUDE_CONFIG_DIR"] = "/tmp/planted-nope"')],
    "no_activation": [(
        'if __name__ == "__main__":',
        'def _planted_installer():\n'
        '    import subprocess\n'
        '    subprocess.run(["launchctl", "load", "/tmp/planted.plist"])\n\n\n'
        'if __name__ == "__main__":')],
}


# ---------------------------------------------------------------- helpers
def import_module(path, name):
    _IMPORT_N[0] += 1
    spec = importlib.util.spec_from_file_location("%s_%d" % (name, _IMPORT_N[0]), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def planted_copy(check):
    src = open(RUNNER, encoding="utf-8").read()
    for old, new in PLANTS[check]:
        if src.count(old) != 1:
            raise RuntimeError("plant anchor for %s appears %d times" % (check, src.count(old)))
        src = src.replace(old, new)
    d = tempfile.mkdtemp(prefix=TMP_PREFIX + "plant-", dir=TMP)
    p = os.path.join(d, "option3_runner.py")
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(src)
    return p


def fresh_state(name):
    d = os.path.join(TMP, "state-" + name)
    os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def valid_rec(root_dir):
    return {"client": "Karen Vaughn", "approved_by": "Trevor", "approved_at": "2026-10-11",
            "cap_usd": 10.0, "run_root": root_dir, "background": True}


def write_record(sd, rec):
    with open(os.path.join(sd, "option3-approval.json"), "w", encoding="utf-8") as fh:
        json.dump(rec, fh)


def args(**kw):
    base = {"launcher": "claude-nine", "order_id": None, "order_title": None,
            "state": None, "root": None, "every": 120}
    base.update(kw)
    return types.SimpleNamespace(**base)


def fake_parse(line):
    return ORDER if line else None


class Spy:
    """Records the child call. NEVER runs anything."""
    def __init__(self, rc=0, text="OK\n"):
        self.calls = []
        self.rc = rc
        self.text = text

    def __call__(self, argv, cwd, env):
        self.calls.append({"argv": list(argv), "cwd": cwd, "env": dict(env)})
        return self.rc, self.text


# ---------------------------------------------------------------- checks
def check_off_default(mod, src):
    """OFF is the shipped state: no approval means no order lookup, no lock, no run."""
    sd = fresh_state("off")
    assert mod.read_approval(sd) == ("off", None), "an empty state must read as off"
    spy = Spy()
    rc = mod.cmd_check(args(), SKILL, sd, runner=spy,
                       fetch_line=lambda: ORDER_LINE, parse_order=fake_parse)
    assert rc == 0, "check must exit 0 when off, got %r" % rc
    assert spy.calls == [], "check started a child while off: %r" % spy.calls
    assert not os.path.exists(mod.lock_path(sd)), "check took a lock while off"
    assert not os.path.isdir(mod.runs_dir(sd)), "check wrote a run folder while off"
    return True


def check_named_approval(mod, src):
    """A named, dated, capped, rooted record is required; anything else is refused."""
    sd = fresh_state("named")
    root_dir = os.path.join(TMP, "root-named")
    os.makedirs(root_dir, exist_ok=True)
    write_record(sd, valid_rec(root_dir))
    state, rec = mod.read_approval(sd)
    assert state == "named" and rec["client"] == "Karen Vaughn", (state, rec)

    bad = []
    r = valid_rec(root_dir); r.pop("client"); bad.append(("no client", r))
    r = valid_rec(root_dir); r["client"] = "   "; bad.append(("blank client", r))
    r = valid_rec(root_dir); r.pop("approved_by"); bad.append(("no approver", r))
    r = valid_rec(root_dir); r.pop("approved_at"); bad.append(("no date", r))
    r = valid_rec(root_dir); r["background"] = False; bad.append(("not background", r))
    r = valid_rec(root_dir); r["run_root"] = "relative/path"; bad.append(("relative root", r))
    for label, r in bad:
        sdir = fresh_state("bad-" + label.replace(" ", "-"))
        write_record(sdir, r)
        state, why = mod.read_approval(sdir)
        assert state == "invalid", "%s must be invalid, got %r" % (label, state)
        spy = Spy()
        rc = mod.cmd_check(args(), SKILL, sdir, runner=spy,
                           fetch_line=lambda: ORDER_LINE, parse_order=fake_parse)
        assert rc == 2, "%s must refuse with 2, got %r" % (label, rc)
        assert spy.calls == [], "%s started a child anyway" % label
    return True


def check_lock(mod, src):
    """One run at a time; a stale lock is reclaimed so a killed run cannot wedge."""
    sd = fresh_state("lock")
    now = 1_000_000.0
    ok, why = mod.acquire_lock(sd, "Karen Vaughn", now=now)
    assert ok and why == "acquired", (ok, why)
    ok2, why2 = mod.acquire_lock(sd, "Karen Vaughn", now=now + 10)
    assert not ok2 and why2 == "held", (ok2, why2)
    assert mod.lock_status(sd, now + 10) == "held"
    mod.release_lock(sd)
    assert mod.lock_status(sd, now) == "free"
    with open(mod.lock_path(sd), "w", encoding="utf-8") as fh:
        json.dump({"pid": 1, "client": "Karen Vaughn",
                   "started_epoch": now - mod.LOCK_STALE_S - 60}, fh)
    assert mod.lock_status(sd, now) == "stale", "an old lock must read stale"
    ok3, _ = mod.acquire_lock(sd, "Karen Vaughn", now=now)
    assert ok3, "a stale lock must be reclaimed"
    mod.release_lock(sd)
    return True


def check_cap(mod, src):
    """A positive per-run cap is required and it reaches the command."""
    sd = fresh_state("cap")
    root_dir = os.path.join(TMP, "root-cap")
    os.makedirs(root_dir, exist_ok=True)
    for label, value in (("missing", None), ("zero", 0), ("negative", -5),
                         ("text", "10")):
        r = valid_rec(root_dir)
        if value is None:
            r.pop("cap_usd")
        else:
            r["cap_usd"] = value
        write_record(sd, r)
        state, why = mod.read_approval(sd)
        assert state == "invalid" and "cap" in why, (label, state, why)
    rec = valid_rec(root_dir)
    argv = mod.plan_command(rec, SKILL, "r_1")
    i = argv.index("--max-budget-usd")
    assert argv[i + 1] == "10", argv[i + 1]
    return True


def check_scoped_command(mod, src):
    """Exactly two script rules plus Read, dontAsk with prompts off, no bypass."""
    rec = valid_rec("/tmp")
    argv = mod.plan_command(rec, SKILL, "r_1", launcher="claude-nine")
    assert argv[0] == "claude-nine"
    assert argv[1] == "-p" and "studio order r_1" in argv[2], argv[2]
    assert argv[argv.index("--permission-mode") + 1] == "dontAsk"
    assert argv[argv.index("--permission-prompts") + 1] == "none"
    assert argv[argv.index("--output-format") + 1] == "json"
    assert argv[argv.index("--name") + 1] == "drama-studio-r_1"
    tools = argv[argv.index("--allowedTools") + 1:
                 argv.index("--max-budget-usd")]
    assert len(tools) == 3, "allowed tools must be exactly three entries: %r" % tools
    assert tools[0].startswith("Bash(python3 ") and tools[0].endswith("factory.py *)"), tools[0]
    assert tools[1].endswith("studio_bridge.py *)"), tools[1]
    assert tools[2] == "Read", tools[2]
    assert "/drama-song-ad-factory/scripts/core/intake_preflight/factory.py" in tools[0]
    for t in tools:
        assert t not in ("Write", "Edit", "Bash"), t
    for flag in mod.FORBIDDEN_FLAGS:
        assert flag not in argv, "forbidden flag %r reached the command" % flag
    for bad in (["claude", "--bare"], ["claude", "bypassPermissions"],
                ["claude", "--dangerously-skip-permissions"]):
        try:
            mod.assert_scoped(bad)
            raise AssertionError("assert_scoped let %r through" % bad)
        except ValueError:
            pass
    return True


def check_log_receipt(mod, src):
    """Every run writes a log and a receipt, and the receipt never carries the key."""
    sd = fresh_state("receipt")
    root_dir = os.path.join(TMP, "root-receipt")
    os.makedirs(root_dir, exist_ok=True)
    with open(os.path.join(sd, "machine.key"), "w", encoding="utf-8") as fh:
        fh.write(KEY_VALUE + "\n")
    rec = valid_rec(root_dir)
    spy = Spy(rc=0, text="child said hi\n")
    out = mod.do_run(sd, SKILL, rec, ORDER, runner=spy, now=1_000_000.0)
    assert "receipt" in out and os.path.isfile(out["receipt"]), out
    assert os.path.isfile(out["log"]), out
    body = open(out["receipt"], encoding="utf-8").read()
    recd = json.loads(body)
    for k in ("name", "client", "order_id", "order_title", "started_at", "ended_at",
              "exit_code", "cap_usd", "launcher", "selected_root", "argv_sha256"):
        assert k in recd, "receipt is missing %s" % k
    assert recd["client"] == "Karen Vaughn" and recd["order_id"] == "r_1"
    assert recd["cap_usd"] == 10.0 and recd["exit_code"] == 0
    assert KEY_VALUE not in body, "the machine key leaked into the receipt"
    assert "CLAUDE_PLUGIN_ROOT" not in body, "the child environment leaked into the receipt"
    assert not os.path.exists(mod.lock_path(sd)), "the lock was not released"
    return True


def check_selected_root_env(mod, src):
    """The child runs in the selected root and carries it in its environment."""
    sd = fresh_state("env")
    root_dir = os.path.join(TMP, "root-env")
    os.makedirs(root_dir, exist_ok=True)
    rec = valid_rec(root_dir)
    spy = Spy()
    mod.do_run(sd, SKILL, rec, ORDER, runner=spy, now=1_000_000.0)
    assert len(spy.calls) == 1, spy.calls
    call = spy.calls[0]
    assert call["cwd"] == root_dir, call["cwd"]
    assert call["env"]["DRAMA_STUDIO_SELECTED_ROOT"] == root_dir, call["env"].get(
        "DRAMA_STUDIO_SELECTED_ROOT")
    assert "CLAUDE_CONFIG_DIR" not in call["env"], "claude-nine must reuse the one config root"
    assert call["env"]["DRAMA_STUDIO_SKILL_ROOT"] == SKILL
    assert call["argv"][0] == "claude-nine"
    return True


ACTIVATION_TOKENS = ("launchctl", "schtasks", "bootstrap", "launchd.plist")
APPROVAL_WRITE_RE = re.compile(r"open\([^)]*APPROVAL_FILE[^)]*[\"']w")


def check_no_activation(mod, src):
    """This file installs nothing and writes no approval: nothing can turn it on."""
    lowered = src.lower()
    for tok in ACTIVATION_TOKENS:
        assert tok not in lowered, "the runner mentions an installer token: %r" % tok
    assert not APPROVAL_WRITE_RE.search(src), "the runner writes the approval record"
    assert "option3-approval.json" not in src.replace('APPROVAL_FILE = "option3-approval.json"', "")
    for flag in ("--approve", "--enable", "--install", "--activate"):
        assert flag not in src, "the runner exposes an activating flag: %r" % flag
    plist = mod.job_plist("/tmp/state-x", SKILL)
    assert "StartInterval" in plist and "check" in plist, "the previewed job is malformed"
    assert "launchctl" not in plist.lower(), "the preview must not load anything"
    return True


CHECKS = [
    ("off_default", check_off_default),
    ("named_approval", check_named_approval),
    ("lock", check_lock),
    ("cap", check_cap),
    ("scoped_command", check_scoped_command),
    ("log_receipt", check_log_receipt),
    ("selected_root_env", check_selected_root_env),
    ("no_activation", check_no_activation),
]


def main(argv):
    global TMP
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--runner", default=RUNNER)
    ap.add_argument("--tmp", default=os.environ.get("DRAMA_STUDIO_OPT3_TMP") or "/tmp")
    a = ap.parse_args(argv)
    runner = os.path.abspath(a.runner)
    if not os.path.isfile(runner):
        sys.stderr.write("%s prover cannot run: runner under test is missing: %s\n"
                         % ("AF-DS-OPT3-PROVE", runner))
        return 3
    src = open(runner, encoding="utf-8").read()
    TMP = tempfile.mkdtemp(prefix=TMP_PREFIX, dir=a.tmp)
    try:
        mod = import_module(runner, "opt3_real")
        for name, fn in CHECKS:
            try:
                fn(mod, src)
                real_ok = True
                why = ""
            except Exception as exc:
                real_ok = False
                why = "%s: %s" % (type(exc).__name__, exc)
            if not real_ok:
                FAILED.append(name)
                print("FAIL  %-18s real run did not pass -- %s" % (name, why))
                continue
            bad_path = planted_copy(name)
            bad = import_module(bad_path, "opt3_bad_" + name)
            try:
                fn(bad, open(bad_path, encoding="utf-8").read())
                VACUOUS.append(name)
                print("VACUOUS %-16s planted-bad copy stayed green" % name)
            except Exception:
                print("ok    %-18s real pass, planted-bad caught" % name)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    if FAILED or VACUOUS:
        sys.stderr.write("AF-DS-OPT3-PROVE: failed=%s vacuous=%s\n"
                         % (",".join(FAILED) or "-", ",".join(VACUOUS) or "-"))
        return 2
    print("prove_option3_runner: %d checks, every planted-bad control caught" % len(CHECKS))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
