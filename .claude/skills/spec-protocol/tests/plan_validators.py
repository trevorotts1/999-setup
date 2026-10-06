"""Run the swarm-plan validators on one plan dict and return {name: accepted}. Shared by the agreement test and by humans.

Validators: swarm-plan.mjs (node), staffing.py validate_plan (python), and -- only when SWARM_PLAN_CHECK_PY points at a
copy of a build packet's swarm_plan_check.py and the plan carries that checker's extra fields -- the packet checker.
"""
import importlib.util, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, "..", "tools")
STAFFING = os.path.join(TOOLS, "hooks", "staffing.py")
MJS = os.path.join(TOOLS, "swarm-plan.mjs")


def _staffing():
    spec = importlib.util.spec_from_file_location("staffing_for_agree", STAFFING)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def run_mjs(plan):
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, "plan.json")
        with open(f, "w") as fh:
            json.dump(plan, fh)
        r = subprocess.run(["node", MJS, "check", f], capture_output=True, text=True)
        if r.returncode not in (0, 1):
            raise RuntimeError("swarm-plan.mjs tooling failure: " + r.stderr)
        return r.returncode == 0, [l.split("| ", 1)[-1] for l in r.stderr.splitlines() if "REFUSED" in l]


def run_staffing(plan):
    errs = _staffing().validate_plan(plan)
    return not errs, errs


def run_packet(plan):
    path = os.environ.get("SWARM_PLAN_CHECK_PY")
    if not path:
        return None
    spec = importlib.util.spec_from_file_location("packet_checker", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    errs = m.errors(plan)
    # the packet checker also wants census/status evidence; only judge the plan rules it shares
    errs = [e for e in errs if "cannot claim running" not in e]
    return not errs, errs


def verdicts(plan):
    out = {"mjs": run_mjs(plan), "staffing": run_staffing(plan)}
    p = run_packet(plan)
    if p is not None:
        out["packet"] = p
    return out
