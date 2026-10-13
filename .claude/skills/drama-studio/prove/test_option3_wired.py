#!/usr/bin/env python3
# test_option3_wired.py — main('check') really starts the child.
#
# The runner shipped with `main` calling `cmd_check(a, root, sd)` with no runner,
# so `do_run` skipped the child and an approved check wrote an exit_code 0 receipt
# that started nothing. This test drives the PUBLIC entry point (`main(['check'])`)
# with a named approval, a waiting order and a stub `real_runner`, and requires the
# stub to be the thing that ran.
#
# IT ACTIVATES NOTHING. No subprocess is ever started: `real_runner` is replaced by
# a spy before `main` is called, and the studio check-in is a fake module, so no
# network call happens either. A planted-bad copy of the runner (the bare
# `cmd_check(a, root, sd)` call restored) is run through the same scenario and must
# leave the spy uncalled — that control is what makes the wiring check a real flip
# and not a tautology.
#
# EXIT CODES
#   0  wired, off-by-default and the planted-bad control all behaved as proven
#   2  a named check failed, or the planted-bad control stayed green
#   3  the prover could not run (the runner under test is missing)
import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
RUNNER = os.path.join(SKILL, "option3_runner.py")
TMP_PREFIX = "operator-U16-U4-"
ORDER_LINE = 'DRAMA_ORDER r_1 "Spring Sale"'
BAD_CALL = "return cmd_check(a, root, sd)"
GOOD_CALL = "return cmd_check(a, root, sd, runner=real_runner)"


def import_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Spy:
    """Stands in for real_runner. NEVER starts a subprocess."""
    def __init__(self):
        self.calls = []

    def __call__(self, argv, cwd, env):
        self.calls.append({"argv": list(argv), "cwd": cwd, "env": dict(env)})
        return 0, "stub child ran\n"


class FakeStudio:
    """The check-in, offline. Same line and the same parse rule as studio_check."""
    ORDER_RE = re.compile(r'^DRAMA_ORDER\s+(\S+)\s+"([^"]*)"\s*$')

    def fetch_line(self):
        return ORDER_LINE

    def parse_order(self, line):
        if not line:
            return None
        m = self.ORDER_RE.match(str(line).strip())
        return (m.group(1), m.group(2)) if m else None


def wire(mod, tmp):
    """A named approval, an existing selected root, an offline studio, a spy runner."""
    sd = os.path.join(tmp, "state")
    os.makedirs(sd, mode=0o700, exist_ok=True)
    root_dir = os.path.join(tmp, "client-root")
    os.makedirs(root_dir, exist_ok=True)
    with open(os.path.join(sd, "option3-approval.json"), "w", encoding="utf-8") as fh:
        json.dump({"client": "Test Client", "approved_by": "Operator",
                   "approved_at": "2026-10-13", "cap_usd": 10.0,
                   "run_root": root_dir, "background": True}, fh)
    mod.load_check_module = lambda root: FakeStudio()
    spy = Spy()
    mod.real_runner = spy
    return sd, root_dir, spy


def run(mod, sd):
    return mod.main(["check", "--state", sd, "--root", SKILL, "--launcher", "claude-nine"])


def check_wired(mod, tmp):
    """main(['check']) with an approval starts the child, in the selected root."""
    sd, root_dir, spy = wire(mod, os.path.join(tmp, "wired"))
    rc = run(mod, sd)
    assert rc == 0, "check must exit 0 after a run that exited 0, got %r" % rc
    assert len(spy.calls) == 1, "main('check') did not start the runner: %r" % spy.calls
    call = spy.calls[0]
    prompt = call["argv"][call["argv"].index("-p") + 1]
    assert "studio order r_1" in prompt, prompt
    assert "/drama-studio start" in prompt, prompt
    assert call["cwd"] == root_dir, call["cwd"]
    assert call["env"]["DRAMA_STUDIO_SELECTED_ROOT"] == root_dir, call["env"].get(
        "DRAMA_STUDIO_SELECTED_ROOT")
    assert "CLAUDE_CONFIG_DIR" not in call["env"], "the child got a config-root override"
    runs = os.path.join(sd, "option3-runs")
    receipts = [f for f in os.listdir(runs) if f.endswith(".json")]
    assert len(receipts) == 1, receipts
    body = json.load(open(os.path.join(runs, receipts[0]), encoding="utf-8"))
    assert body["exit_code"] == 0 and body["order_id"] == "r_1", body
    return True


def check_off_stays_off(mod, tmp):
    """Without an approval, check stays silent and starts nothing."""
    sd = os.path.join(tmp, "off-state")
    os.makedirs(sd, mode=0o700, exist_ok=True)
    mod.load_check_module = lambda root: FakeStudio()
    spy = Spy()
    mod.real_runner = spy
    rc = run(mod, sd)
    assert rc == 0, "check must exit 0 while off, got %r" % rc
    assert spy.calls == [], "check started the runner while off: %r" % spy.calls
    return True


def check_planted_bare_call(mod, tmp, src):
    """The old call (no runner) must leave the stub uncalled — the control flip."""
    if src.count(GOOD_CALL) != 1:
        raise AssertionError("expected exactly one %r, found %d"
                             % (GOOD_CALL, src.count(GOOD_CALL)))
    d = os.path.join(tmp, "planted")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, "option3_runner.py")
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(src.replace(GOOD_CALL, BAD_CALL))
    bad = import_module(p, "opt3_wired_bare")
    sd, root_dir, spy = wire(bad, os.path.join(d, "run"))
    rc = run(bad, sd)
    assert rc == 0, "the planted copy must still exit 0, got %r" % rc
    assert spy.calls == [], \
        "the planted bare cmd_check(a, root, sd) started the runner anyway: %r" % spy.calls
    return True


CHECKS = ["wired", "off_stays_off", "planted_bare_call"]


def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--runner", default=RUNNER)
    ap.add_argument("--tmp", default=os.environ.get("DRAMA_STUDIO_OPT3_TMP") or "/tmp")
    a = ap.parse_args(argv)
    runner = os.path.abspath(a.runner)
    if not os.path.isfile(runner):
        sys.stderr.write("AF-DS-OPT3-WIRED prover cannot run: runner under test is missing: %s\n"
                         % runner)
        return 3
    src = open(runner, encoding="utf-8").read()
    tmp = tempfile.mkdtemp(prefix=TMP_PREFIX, dir=a.tmp)
    try:
        mod = import_module(runner, "opt3_wired_real")
        failures = []
        for name, fn in (("wired", lambda m, t: check_wired(m, t)),
                         ("off_stays_off", lambda m, t: check_off_stays_off(m, t)),
                         ("planted_bare_call",
                          lambda m, t: check_planted_bare_call(m, t, src))):
            try:
                fn(mod, tmp)
                print("ok    %-18s" % name)
            except Exception as exc:
                failures.append(name)
                print("FAIL  %-18s %s: %s" % (name, type(exc).__name__, exc))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if failures:
        sys.stderr.write("AF-DS-OPT3-WIRED: failed=%s\n" % ",".join(failures))
        return 2
    print("test_option3_wired: %d checks, main('check') starts the real runner"
          % len(CHECKS))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
