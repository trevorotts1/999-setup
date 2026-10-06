#!/usr/bin/env python3
"""Workflow staffing rules: the ONE implementation of the swarm-plan contract. Stdlib only.

The plan document decides how many workflows run at once and how many agents each
one has. Nothing here carries a flat per-workflow number of its own; the ceilings
(10 agents per workflow, 50 workflows, 500 agents) are maximums a plan may not exceed.
The per-workflow cap is MEASURED from the box (capacity_probe.py: RAM, cores, container limits)
and recorded in the plan as policy.max_agents_per_workflow (integer 1..10).

PLAN DISCOVERY  walking upward from cwd (max 40 levels), at each level in this order:
  (1) .spec-protocol.json key "swarmPlan" (path relative to that file),
  (2) SWARM-PLAN.json, (3) claude-nine-swarm/SWARM-PLAN.json. First hit wins.
  No plan found -> no floor; only ceilings apply.
PLAN SCHEMA     "blackceo.swarm-plan/v2": policy.max_active_workflows (1..50),
  policy.max_agents_per_workflow (int 1..10, the measured cap), policy.max_working_agents <= 500.
  Optional policy.capacity_probe {per_workflow_cap, ...}: when present its cap must equal policy.max_agents_per_workflow. Each workflow:
  workflow_id, dependencies, units [{unit_id "<WID>-U<n>", work, owned_output (repo-relative file, or directory ending "/"; no
  overlap across the plan: equal or path-prefix of another unit's owned_output is rejected), acceptance, source, verdict_file "evidence/<WID>/<unit_id>.verdict.json"}],
  agent_count = min(policy.max_agents_per_workflow, len(units)), concurrency = agent_count,
  no leftover staffing keys (builders, checkers, repair_extra_executions_max, max_total_executions),
  verdict_file "evidence/<WID>/verdict.json".
DONE      verdict_file (relative to the plan file's directory) exists, parses, "verdict"=="PASS".
          A plan's own "status" field never decides readiness or completion.
RUNNING   the guard journal has a live launch tagged with that workflowId (and this plan).
READY     not done, not running, every dependency done, not in handback.
OWED      required_running = min(max_active_workflows, program cap, running + ready);
          owed = the first (required_running - running) ready workflows in plan order.
HANDBACK  launched 3 times (recorded) without becoming done: not owed, an alert is written.
ARMED     plan found AND (status in {running, active} OR the journal recorded a launch
          carrying a workflowId of this plan).
LAUNCH CONTRACT (check_launch) a Workflow call under a found plan must carry args.workflowId
          of a READY workflow, args.units with exactly that workflow's unit_ids, and a script
          that fans out over args.units in one stage. Undeterminable -> blocked (the only
          fail-closed rule).

CLI:  staffing.py status --cwd DIR [--state-dir DIR] [--json]   |   staffing.py --selftest
"""
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

SCHEMA = "blackceo.swarm-plan/v2"
CEIL_AGENTS, CEIL_WORKFLOWS, CEIL_TOTAL = 10, 50, 500
MAX_WALK = 40
HANDBACK_LAUNCHES = 3
RELEASE_ATTEMPTS = 3
LIVE_STATES = ("VALIDATED", "RETURNED", "LAUNCH_UNVERIFIED")
HERE = Path(__file__).resolve().parent
def _find_gate():
    """dispatch-gate.py (it owns the script parser). Installed layout: ~/.claude/hooks/dispatch-gate.py is the
    parent of this file's folder. Also accepted: beside this file, DISPATCH_GATE_PATH, and the 999-setup
    checkout layout (so the hook-skill tests run from the repo). dispatch-gate.py also sets GATE_PATH itself."""
    cands = [os.environ.get("DISPATCH_GATE_PATH") or "", HERE.parent / "dispatch-gate.py", HERE / "dispatch-gate.py",
             HERE.parents[2] / "spec-protocol" / "tools" / "hooks" / "dispatch-gate.py" if len(HERE.parents) > 2 else ""]
    for c in cands:
        if c and Path(c).is_file():
            return Path(c)
    return HERE.parent / "dispatch-gate.py"


GATE_PATH = _find_gate()


def default_state_dir():
    return Path(os.environ.get("WORKFLOW_GUARD_STATE", str(HERE / "state")))


# ---------------------------------------------------------------- plan discovery
def _jload(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def find_plan(cwd):
    """(plan_path, doc) for the nearest plan, walking up <= 40 levels; None if none.
    doc is None when the file exists but is unreadable or not a JSON object."""
    try:
        p = Path(cwd).resolve()
    except (OSError, ValueError, TypeError):
        return None
    for _ in range(MAX_WALK):
        cands = []
        prof = p / ".spec-protocol.json"
        if prof.is_file():
            d = _jload(prof)
            ref = d.get("swarmPlan") if isinstance(d, dict) else None
            if isinstance(ref, str) and ref.strip():
                cands.append((p / ref).resolve())
        cands += [p / "SWARM-PLAN.json", p / "claude-nine-swarm" / "SWARM-PLAN.json"]
        for f in cands:
            if f.is_file():
                d = _jload(f)
                return f, (d if isinstance(d, dict) else None)
        if p.parent == p:
            break
        p = p.parent
    return None


# ---------------------------------------------------------------- plan accessors
def workflows(doc):
    w = doc.get("workflows") if isinstance(doc, dict) else None
    return [x for x in w if isinstance(x, dict)] if isinstance(w, list) else []


def unit_ids(wf):
    return [u.get("unit_id") for u in (wf.get("units") or []) if isinstance(u, dict)]


LEFTOVER_KEYS = ("builders", "checkers", "repair_extra_executions_max", "max_total_executions",
                 "total_executions", "repair_reserve", "executions_total")


def plan_cap(doc):
    """policy.max_agents_per_workflow when it is an int 1..10, else None (plan invalid)."""
    v = policy(doc).get("max_agents_per_workflow")
    return v if _int(v) and 1 <= v <= CEIL_AGENTS else None


def agent_count(wf, cap=CEIL_AGENTS):
    return min(cap, len(wf.get("units") or []))


def policy(doc):
    p = doc.get("policy") if isinstance(doc, dict) else None
    return p if isinstance(p, dict) else {}


def _int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _nonempty(v):
    return isinstance(v, str) and bool(v.strip())


_PLACEHOLDER = re.compile(r"slices/|[<>*]|TBD|TODO", re.I)


def _bad_owned(oo):
    """ONE RULE: concrete repo-relative file, or directory ending in '/'."""
    if not _nonempty(oo):
        return "must be a concrete repo-relative file or directory path (empty)"
    if oo.startswith("/") or re.match(r"[A-Za-z]:", oo) or oo.startswith("~"):
        return "must be repo-relative, not absolute: %r" % oo
    if ".." in oo.split("/"):
        return "must not contain '..': %r" % oo
    if _PLACEHOLDER.search(oo):
        return "is a placeholder: %r" % oo
    return None


def _overlap(a, b):
    return a == b or (a.endswith("/") and b.startswith(a)) or (b.endswith("/") and a.startswith(b))


def validate_plan(doc):
    """Return a list of error strings; empty means the plan satisfies the v2 schema."""
    if not isinstance(doc, dict):
        return ["plan is unreadable or not a JSON object"]
    errs = []
    if doc.get("schema") != SCHEMA:
        errs.append("schema must be %r, got %r" % (SCHEMA, doc.get("schema")))
    pol = policy(doc)
    maw = pol.get("max_active_workflows")
    if not (_int(maw) and 1 <= maw <= CEIL_WORKFLOWS):
        errs.append("policy.max_active_workflows must be an integer 1..%d" % CEIL_WORKFLOWS)
    cap = plan_cap(doc)
    if cap is None:
        errs.append("policy.max_agents_per_workflow must be an integer 1..%d (the measured per-workflow cap)" % CEIL_AGENTS)
    cp = pol.get("capacity_probe")
    if cp is not None and (not isinstance(cp, dict) or cp.get("per_workflow_cap") != pol.get("max_agents_per_workflow")):
        errs.append("policy.max_agents_per_workflow must equal policy.capacity_probe.per_workflow_cap")
    mwa = pol.get("max_working_agents")
    if not (_int(mwa) and 1 <= mwa <= CEIL_TOTAL):
        errs.append("policy.max_working_agents must be an integer 1..%d" % CEIL_TOTAL)
    wfs = doc.get("workflows")
    if not isinstance(wfs, list) or not wfs or not all(isinstance(w, dict) for w in wfs):
        errs.append("workflows must be a nonempty list of objects")
        return errs
    ids = [w.get("workflow_id") for w in wfs]
    for i in ids:
        if not _nonempty(i):
            errs.append("every workflow needs a nonempty workflow_id")
    good = [i for i in ids if _nonempty(i)]
    if len(set(good)) != len(good):
        errs.append("workflow_id values must be unique")
    owned = []
    for w in wfs:
        wid = w.get("workflow_id")
        if not _nonempty(wid):
            continue
        deps = w.get("dependencies")
        if not isinstance(deps, list):
            errs.append("%s: dependencies must be a list" % wid)
        else:
            for d in deps:
                if d not in good:
                    errs.append("%s: dependency %r is not a workflow in this plan" % (wid, d))
                if d == wid:
                    errs.append("%s: depends on itself" % wid)
        units = w.get("units")
        if not isinstance(units, list) or not units:
            errs.append("%s: units must be a nonempty list" % wid)
            continue
        seen = set()
        works = set()
        for k, u in enumerate(units, 1):
            if not isinstance(u, dict):
                errs.append("%s: unit %d must be an object" % (wid, k))
                continue
            uid = u.get("unit_id")
            if not (isinstance(uid, str) and re.fullmatch(re.escape(wid) + r"-U[0-9]+", uid)):
                errs.append("%s: unit_id %r must look like %s-U<n>" % (wid, uid, wid))
            elif uid in seen:
                errs.append("%s: duplicate unit_id %s" % (wid, uid))
            seen.add(uid)
            for key in ("work", "acceptance", "source"):
                if not _nonempty(u.get(key)):
                    errs.append("%s: %s needs a nonempty %s" % (wid, uid, key))
            wk = u.get("work")
            if _nonempty(wk):
                if re.search(r"slice \d+ of \d+", wk, re.I):
                    errs.append("%s: %s work is \"slice N of M\" padding" % (wid, uid))
                norm = re.sub(r"[\d\s]+", "", wk).lower()  # digits, whitespace and case ignored
                if norm and norm in works:
                    errs.append("%s: %s work duplicates another unit (padding)" % (wid, uid))
                works.add(norm)
            oo = u.get("owned_output")
            bad = _bad_owned(oo)
            if bad:
                errs.append("%s: %s owned_output %s" % (wid, uid, bad))
            else:
                for q, other in owned:
                    if _overlap(oo, q):
                        errs.append("%s: owned_output %s overlaps %s %s" % (uid, oo, other, q))
                owned.append((oo, uid))
            if u.get("verdict_file") != "evidence/%s/%s.verdict.json" % (wid, uid):
                errs.append("%s: %s verdict_file must be evidence/%s/%s.verdict.json" % (wid, uid, wid, uid))
        for k in LEFTOVER_KEYS:
            if k in w:
                errs.append("%s: leftover key %s \u2014 staffing is derived from units" % (wid, k))
        want = min(cap or CEIL_AGENTS, len(units))
        if w.get("agent_count") != want or not _int(w.get("agent_count")):
            errs.append("%s: agent_count must be min(max_agents_per_workflow, len(units)) = %d" % (wid, want))
        if w.get("concurrency") != want or not _int(w.get("concurrency")):
            errs.append("%s: concurrency must equal agent_count = %d" % (wid, want))
        if w.get("verdict_file") != "evidence/%s/verdict.json" % wid:
            errs.append("%s: verdict_file must be evidence/%s/verdict.json" % (wid, wid))
    # dependency cycles
    deps_of = {w["workflow_id"]: [d for d in (w.get("dependencies") or []) if d in good]
               for w in wfs if _nonempty(w.get("workflow_id")) and isinstance(w.get("dependencies"), list)}
    state = {}

    def visit(n):
        if state.get(n) == 1:
            return True
        if state.get(n) == 2:
            return False
        state[n] = 1
        if any(visit(d) for d in deps_of.get(n, [])):
            return True
        state[n] = 2
        return False
    if any(visit(n) for n in list(deps_of)):
        errs.append("workflow dependencies contain a cycle")
    return errs


# ---------------------------------------------------------------- done / ready / owed
def is_done(plan_dir, wf):
    """True iff wf's verdict_file (under the plan's directory) parses with verdict == PASS."""
    vf = wf.get("verdict_file")
    if not _nonempty(vf):
        return False
    try:
        base = Path(plan_dir).resolve()
        target = (base / vf).resolve()
        target.relative_to(base)
        d = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(d, dict) and d.get("verdict") == "PASS"


def compute(plan_path, doc, running=(), launches=None, program_cap=CEIL_WORKFLOWS, agent_cap=None):
    """Pure state computation. running: workflowIds with a live launch. launches: wid -> count."""
    launches = launches or {}
    wfs = workflows(doc)
    order = [w["workflow_id"] for w in wfs]
    done = {w["workflow_id"] for w in wfs if is_done(Path(plan_path).parent, w)}
    run = [i for i in order if i in set(running)]
    handback = [i for i in order if i not in done and i not in run and launches.get(i, 0) >= HANDBACK_LAUNCHES]
    ready = []
    for w in wfs:
        i = w["workflow_id"]
        if i in done or i in run or i in handback:
            continue
        if all(d in done for d in (w.get("dependencies") or [])):
            ready.append(i)
    maw = policy(doc).get("max_active_workflows")
    maw = maw if _int(maw) and maw > 0 else CEIL_WORKFLOWS
    required = min(maw, program_cap, len(run) + len(ready))
    owed = ready[:max(0, required - len(run))]
    acap = agent_cap or plan_cap(doc) or CEIL_AGENTS
    counts = {w["workflow_id"]: agent_count(w, acap) for w in wfs}
    return {"order": order, "done": sorted(done, key=order.index), "running": run, "ready": ready,
            "owed": owed, "handback": handback, "required_running": required,
            "max_active": maw, "agents": counts}


def is_armed(doc, any_launch):
    return str(doc.get("status") or "").lower() in ("running", "active") or bool(any_launch)


def describe_owed(state):
    return ", ".join("%s (%d agents)" % (i, state["agents"][i]) for i in state["owed"])


# ---------------------------------------------------------------- journal (guard.sqlite3)
def migrate(conn):
    """Idempotent: tag table for workflowId on each launch, and denied/failed attempt table."""
    conn.executescript(
        "CREATE TABLE IF NOT EXISTS launch_tags(id TEXT PRIMARY KEY,session TEXT,workflow_id TEXT,plan TEXT,created REAL);"
        "CREATE TABLE IF NOT EXISTS session_plans(session TEXT PRIMARY KEY,plan TEXT,armed REAL);"
        "CREATE TABLE IF NOT EXISTS launch_attempts(attempt TEXT PRIMARY KEY,session TEXT,plan TEXT,workflow_id TEXT,outcome TEXT,detail TEXT,created REAL);")


def journal_view(conn, plan_path, ids, session=None):
    """Read the journal for one plan. Returns dict(running=set, launches={wid:n}, failed={wid:n}, any=bool).
    failed counts this session's FAILED launches plus hook-denied attempts."""
    out = {"running": set(), "launches": {}, "failed": {}, "any": False}
    p = str(plan_path)
    idset = set(ids)
    try:
        q = ",".join("?" * len(LIVE_STATES))
        for (wid,) in conn.execute("SELECT DISTINCT t.workflow_id FROM launch_tags t JOIN launches l ON l.id=t.id WHERE t.plan=? AND l.state IN (%s)" % q, (p,) + LIVE_STATES):
            if wid in idset:
                out["running"].add(wid)
        for wid, n in conn.execute("SELECT workflow_id,COUNT(*) FROM launch_tags WHERE plan=? GROUP BY workflow_id", (p,)):
            if wid in idset:
                out["launches"][wid] = n
        out["any"] = bool(out["launches"])
        if session is not None:
            for wid, n in conn.execute("SELECT t.workflow_id,COUNT(*) FROM launch_tags t JOIN launches l ON l.id=t.id WHERE t.plan=? AND t.session=? AND l.state='FAILED' GROUP BY t.workflow_id", (p, session)):
                out["failed"][wid] = out["failed"].get(wid, 0) + n
            for wid, n in conn.execute("SELECT workflow_id,COUNT(*) FROM launch_attempts WHERE plan=? AND session=? GROUP BY workflow_id", (p, session)):
                out["failed"][wid] = out["failed"].get(wid, 0) + n
    except sqlite3.Error:
        pass
    return out


def open_journal(state_dir=None):
    """Read-write connection with the staffing tables present, or None when it cannot be had."""
    sd = Path(state_dir) if state_dir else default_state_dir()
    try:
        sd.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(sd / "guard.sqlite3", timeout=5)
        c.execute("PRAGMA busy_timeout=5000")
        migrate(c)
        return c
    except (OSError, sqlite3.Error):
        return None


def _reap(state_dir):
    """Let the guard release finished/dead launches first, so RUNNING is not stale. Best effort."""
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("guard_for_staffing", HERE / "guard.py")
        g = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(g)
        if state_dir:
            g.STATE = Path(state_dir)
            g.LIMITS_FILE = g.STATE / "limits.json"
        c = g.db()
        try:
            g.reap_dead(c)
        finally:
            c.close()
    except Exception:
        pass


def program_cap(state_dir=None):
    sd = Path(state_dir) if state_dir else default_state_dir()
    d = _jload(sd / "limits.json")
    v = d.get("concurrent_workflows_per_program") if isinstance(d, dict) else None
    return v if _int(v) and v > 0 else CEIL_WORKFLOWS


def launch_agent_cap(doc, state_dir=None):
    """Launch/stop math cap: min(plan cap, limits.json concurrent_agents_per_workflow)."""
    sd = Path(state_dir) if state_dir else default_state_dir()
    d = _jload(sd / "limits.json")
    v = d.get("concurrent_agents_per_workflow") if isinstance(d, dict) else None
    return min(plan_cap(doc) or CEIL_AGENTS, v if _int(v) and v > 0 else CEIL_AGENTS)


def remember_session_plan(state_dir, session, plan_path):
    """Pin an ARMED plan to a session so it keeps governing it after the cwd moves."""
    conn = open_journal(state_dir)
    if not conn:
        return
    try:
        conn.execute("INSERT OR REPLACE INTO session_plans VALUES(?,?,?)", (str(session), str(plan_path), time.time()))
        conn.commit()
    except sqlite3.Error:
        pass
    finally:
        conn.close()


def resolve_plan(cwd, session=None, state_dir=None):
    """The plan governing this session: (path, doc) or None.
    A plan found from cwd that is ARMED (status running/active, or the journal recorded a launch of
    one of its workflows) is pinned to the session and keeps governing it wherever the cwd goes, until
    every workflow is done or the user's stop latch is set. An unarmed plan stays cwd-scoped."""
    found = find_plan(cwd)
    if not session:
        return found
    conn = open_journal(state_dir)
    if not conn:
        return found
    try:
        if found and found[1] is not None:
            path, doc = found
            status = str(doc.get("status") or "").lower() in ("running", "active")
            launched = conn.execute("SELECT 1 FROM launch_tags WHERE plan=? LIMIT 1", (str(path),)).fetchone()
            if status or launched:
                conn.execute("INSERT OR REPLACE INTO session_plans VALUES(?,?,?)", (str(session), str(path), time.time()))
                conn.commit()
                return found
        row = conn.execute("SELECT plan FROM session_plans WHERE session=?", (str(session),)).fetchone()
        if row:
            p = Path(row[0])
            d = _jload(p) if p.is_file() else None
            try:
                latched = (conn.execute("SELECT latched FROM continuations WHERE session=?", (str(session),)).fetchone() or [0])[0]
            except sqlite3.Error:
                latched = 0
            wfs = workflows(d) if isinstance(d, dict) else []
            finished = bool(wfs) and all(is_done(p.parent, w) for w in wfs)
            if isinstance(d, dict) and not latched and not finished:
                return p, d
            conn.execute("DELETE FROM session_plans WHERE session=?", (str(session),))
            conn.commit()
    except sqlite3.Error:
        pass
    finally:
        conn.close()
    return found


def snapshot(cwd, state_dir=None, session=None, reap=True):
    """Everything a caller needs: plan, errors, journal view, computed state, armed flag. None if no plan."""
    found = resolve_plan(cwd, session, state_dir)
    if not found:
        return None
    path, doc = found
    errs = validate_plan(doc)
    snap = {"path": path, "doc": doc, "errors": errs, "view": None, "state": None, "armed": False}
    if errs:
        return snap
    if reap:
        _reap(state_dir)
    ids = [w["workflow_id"] for w in workflows(doc)]
    conn = open_journal(state_dir)
    try:
        view = journal_view(conn, path, ids, session) if conn else {"running": set(), "launches": {}, "failed": {}, "any": False}
    finally:
        if conn:
            conn.close()
    snap["view"] = view
    snap["state"] = compute(path, doc, view["running"], view["launches"], program_cap(state_dir), launch_agent_cap(doc, state_dir))
    snap["armed"] = is_armed(doc, view["any"])
    return snap


def record_attempt(state_dir, session, plan_path, wid, outcome, detail, attempt_id=None):
    """Record one hook-denied/failed launch attempt. Idempotent per attempt id."""
    conn = open_journal(state_dir)
    if not conn:
        return
    try:
        aid = "%s|%s" % (session, attempt_id or time.time_ns())
        conn.execute("INSERT OR IGNORE INTO launch_attempts VALUES(?,?,?,?,?,?,?)",
                     (aid, str(session), str(plan_path), wid or "", outcome, str(detail)[:300], time.time()))
        conn.commit()
    except sqlite3.Error:
        pass
    finally:
        conn.close()


# ---------------------------------------------------------------- launch contract
_GATE = []


def _gate():
    if not _GATE:
        import importlib.util
        spec = importlib.util.spec_from_file_location("dispatch_gate_for_staffing", GATE_PATH)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _GATE.append(m)
    return _GATE[0]


def _unit_list(v):
    """Accept a list of strings or of objects with unit_id. None if the shape is wrong."""
    if not isinstance(v, list):
        return None
    out = []
    for x in v:
        if isinstance(x, str):
            out.append(x)
        elif isinstance(x, dict) and isinstance(x.get("unit_id"), str):
            out.append(x["unit_id"])
        else:
            return None
    return out


def fans_out_over_units(script, run_args):
    """True when one parallel()/pipeline() stage takes args.units (directly, via .map, or via a
    const bound to args.units) and its resolved item count equals len(args.units)."""
    g = _gate()
    code = g.sanitize(script)
    n = len(run_args["units"])
    for kind in ("pipeline", "parallel"):
        for _start, args in g.find_calls(code, kind):
            a = args.lstrip()
            direct = re.match(r"args\s*\.\s*units\b", a)
            m = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\.\s*map\b|,|$)", a)
            via = bool(m and re.search(r"(?:const|let|var)\s+" + re.escape(m.group(1)) + r"\s*=\s*args\s*\.\s*units\s*(?:[;\n]|$)", code))
            if (direct or via) and g.count_items(args, code, run_args) == n:
                return True
    return False


def _read_script(ti, cwd):
    s = ti.get("script")
    if isinstance(s, str) and s.strip():
        return s, None
    p = ti.get("scriptPath")
    if not isinstance(p, str) or not p.strip():
        return None, "a launch by saved name has no script this guard can read"
    path = Path(p).expanduser()
    if not path.is_absolute():
        path = Path(cwd) / path
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None, "scriptPath %s cannot be read" % path
    return (text, None) if text.strip() else (None, "script %s is empty" % path)


def check_launch(tool_input, cwd, session=None, state_dir=None, attempt_id=None, reap=None, record=True):
    """The launch contract. Returns (ok, message). (True, '') when no plan is found."""
    found = resolve_plan(cwd, session, state_dir)
    if not found:
        return True, ""
    ti = tool_input if isinstance(tool_input, dict) else {}
    snap = snapshot(cwd, state_dir, session, reap=(state_dir is None) if reap is None else reap)
    path = snap["path"]
    head = "WORKFLOW LAUNCH CONTRACT (plan %s): " % path
    if snap["errors"]:
        return False, head + "the plan itself is invalid, so no launch can be checked against it. Fix the plan first:\n  - " + "\n  - ".join(snap["errors"][:12])
    st, doc = snap["state"], snap["doc"]
    wfs = {w["workflow_id"]: w for w in workflows(doc)}
    args = ti.get("args")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = None
    args = args if isinstance(args, dict) else {}
    wid = args.get("workflowId")
    problems = []

    def fix_for(target):
        w = wfs[target]
        return ("FIX: launch workflow %s with args.workflowId=%s, args.units = its %d planned unit_ids %s "
                "(agent_count %d), and a script that fans out in ONE stage over args.units: "
                "pipeline(args.units, build, check) with a model: pin on every agent(). "
                "Concurrency inside the launch is min(cap, len(units)) = %d; do not add or drop units."
                % (target, json.dumps(target), len(unit_ids(w)), json.dumps(unit_ids(w)), st["agents"][target], st["agents"][target]))

    target = wid if isinstance(wid, str) and wid in wfs else None
    if target is None:
        problems.append("args.workflowId is %s; it must equal a workflow_id of this plan" % (json.dumps(wid) if "workflowId" in args else "missing"))
    elif target in st["done"]:
        problems.append("workflow %s is already done (its verdict file is PASS); do not launch it again" % target)
    elif target in st["running"]:
        problems.append("workflow %s is already running" % target)
    elif target in st["handback"]:
        problems.append("workflow %s was launched %d times without becoming done: it is in HANDBACK and needs the user, not a relaunch" % (target, HANDBACK_LAUNCHES))
    elif target not in st["ready"]:
        unmet = [d for d in (wfs[target].get("dependencies") or []) if d not in st["done"]]
        problems.append("workflow %s is not ready: unfinished dependencies %s" % (target, unmet))
    elif len(st["running"]) >= min(st["max_active"], program_cap(state_dir)):
        problems.append("the plan runs at most %d workflows at once and %d are running; launch %s when one finishes" % (min(st["max_active"], program_cap(state_dir)), len(st["running"]), target))
    required = target if target and not problems else None
    if required is None:
        required = (st["owed"] or st["ready"] or [None])[0]
    if required is None:
        msg = head + "; ".join(problems or ["no workflow"]) + ". No workflow of this plan is launchable right now (done, running, in handback or waiting on dependencies); do not launch."
        _record(record, state_dir, session, path, wid if target else None, attempt_id, msg)
        return False, msg
    w = wfs[required]
    if target and not problems:
        want = unit_ids(w)
        got = _unit_list(args.get("units"))
        if got is None:
            problems.append("args.units is %s; it must be the list of this workflow's unit_ids" % ("missing" if "units" not in args else "malformed"))
        elif sorted(got) != sorted(want) or len(got) != len(want):
            problems.append("args.units has %d unit(s) %s; workflow %s plans exactly %d: %s" % (len(got), json.dumps(got), required, len(want), json.dumps(want)))
        else:
            script, why = _read_script(ti, cwd)
            if script is None:
                problems.append("undeterminable launch (blocked, fail closed): " + why)
            else:
                try:
                    ok = fans_out_over_units(script, {"units": got})
                except Exception as e:  # parser trouble under a plan is undeterminable
                    problems.append("undeterminable launch (blocked, fail closed): %s while reading the script" % type(e).__name__)
                else:
                    if not ok:
                        problems.append("the script has no stage that fans out over args.units (pipeline(args.units, ...) or parallel(args.units.map(...))) with %d items" % len(want))
    if not problems:
        return True, ""
    msg = head + "; ".join(problems) + ".\n" + fix_for(required)
    _record(record, state_dir, session, path, required, attempt_id, msg)
    return False, msg


def _record(record, state_dir, session, path, wid, attempt_id, msg):
    if record and session:
        record_attempt(state_dir, session, path, wid, "denied", msg, attempt_id)


# ---------------------------------------------------------------- CLI
def cmd_status(cwd, state_dir, as_json):
    snap = snapshot(cwd, state_dir)
    if snap is None:
        print("no plan found from %s (no floor; ceilings only: %d workflows / %d agents per workflow / %d agents)" % (cwd, CEIL_WORKFLOWS, CEIL_AGENTS, CEIL_TOTAL))
        return 0
    if snap["errors"]:
        print("plan %s is INVALID:\n  - %s" % (snap["path"], "\n  - ".join(snap["errors"])))
        return 1
    st = snap["state"]
    row = {"plan": str(snap["path"]), "armed": snap["armed"], "max_active": st["max_active"], "required_running": st["required_running"],
           "done": st["done"], "running": st["running"], "ready": st["ready"], "owed": [{"workflow_id": i, "agents": st["agents"][i]} for i in st["owed"]],
           "handback": st["handback"]}
    if as_json:
        print(json.dumps(row, indent=2))
        return 0
    print("plan: %s\narmed: %s\nactive workflows allowed: %d  required running now: %d" % (row["plan"], row["armed"], row["max_active"], row["required_running"]))
    print("done (%d): %s" % (len(st["done"]), ", ".join(st["done"]) or "none"))
    print("running (%d): %s" % (len(st["running"]), ", ".join(st["running"]) or "none"))
    print("owed now: %s" % (describe_owed(st) or "none"))
    print("handback: %s" % (", ".join(st["handback"]) or "none"))
    return 0


# ---------------------------------------------------------------- selftest
def _mkplan(root, specs, status="planned", maw=3, deps=None, cap=10):
    """specs: {wid: n_units}. Writes SWARM-PLAN.json under root and returns its path."""
    wfs = []
    for wid, n in specs.items():
        units = [{"unit_id": "%s-U%d" % (wid, k), "work": "work item " + "".join(chr(97 + int(c)) for c in str(k)), "owned_output": "out/%s/%d.md" % (wid, k), "acceptance": "a",
                  "source": "s", "verdict_file": "evidence/%s/%s-U%d.verdict.json" % (wid, wid, k)} for k in range(1, n + 1)]
        wfs.append({"workflow_id": wid, "dependencies": (deps or {}).get(wid, []), "units": units, "agent_count": min(cap, n),
                    "concurrency": min(cap, n), "verdict_file": "evidence/%s/verdict.json" % wid})
    doc = {"schema": SCHEMA, "status": status, "policy": {"max_active_workflows": maw, "max_agents_per_workflow": cap, "max_working_agents": 500}, "workflows": wfs}
    p = Path(root) / "SWARM-PLAN.json"
    p.write_text(json.dumps(doc))
    return p


def _verdict(root, wid, v="PASS"):
    f = Path(root) / "evidence" / wid / "verdict.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"verdict": v}))


GOOD_SCRIPT = ("export const meta = { name: 'x', description: 'y' }\n"
               "const r = await pipeline(args.units, (u) => agent('build ' + u, { label: 'b', phase: 'Build', model: 'opus' }),"
               " (b, u) => agent('check ' + u, { label: 'c', phase: 'QC', model: 'sonnet' }))\nreturn r\n")


def selftest():
    fails = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + ((" -- " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    tmp = Path(tempfile.mkdtemp(prefix="staffing-selftest."))
    proj, sd = tmp / "proj", tmp / "state"
    (proj / "a" / "b").mkdir(parents=True)
    sd.mkdir()
    plan = _mkplan(proj, {"W0-01": 8, "W0-02": 6, "W0-03": 12, "W0-04": 3}, maw=2, deps={"W0-04": ["W0-01"]})
    doc = json.loads(plan.read_text())
    check("valid plan has no errors", validate_plan(doc) == [], validate_plan(doc))
    check("agent_count = min(cap 10, units)", [agent_count(w, plan_cap(doc)) for w in workflows(doc)] == [8, 6, 10, 3])
    # measured cap 6: 8 units -> 6 accepted, 8 rejected; cap missing / 11 rejected; probe mismatch rejected
    c6 = {"W6-01": 8}
    d6 = json.loads(_mkplan(tmp / "c6", c6, cap=6).read_text()) if (tmp / "c6").mkdir() is None else None
    check("cap 6, 8 units -> agent_count 6 accepted", d6["workflows"][0]["agent_count"] == 6 and validate_plan(d6) == [], validate_plan(d6))
    d6["workflows"][0]["agent_count"] = d6["workflows"][0]["concurrency"] = 8
    check("cap 6, agent_count 8 rejected", any("agent_count" in x for x in validate_plan(d6)))
    d6 = json.loads(json.dumps(doc)); del d6["policy"]["max_agents_per_workflow"]
    check("missing policy.max_agents_per_workflow rejected", any("max_agents_per_workflow" in x for x in validate_plan(d6)))
    d6["policy"]["max_agents_per_workflow"] = 11
    check("policy cap 11 rejected", any("max_agents_per_workflow" in x for x in validate_plan(d6)))
    d6 = json.loads(json.dumps(doc)); d6["policy"]["capacity_probe"] = {"per_workflow_cap": 10}
    check("capacity_probe matching cap accepted", validate_plan(d6) == [], validate_plan(d6))
    d6["policy"]["capacity_probe"]["per_workflow_cap"] = 6
    check("capacity_probe differing cap rejected", any("capacity_probe" in x for x in validate_plan(d6)))
    for k in LEFTOVER_KEYS:
        d6 = json.loads(json.dumps(doc)); d6["workflows"][0][k] = 1
        check("leftover key %s rejected" % k, "W0-01: leftover key %s \u2014 staffing is derived from units" % k in validate_plan(d6), validate_plan(d6))
    lsd = tmp / "lim"; lsd.mkdir(); (lsd / "limits.json").write_text(json.dumps({"concurrent_agents_per_workflow": 4}))
    check("launch cap = min(plan 10, limits 4) = 4", launch_agent_cap(doc, lsd) == 4 and compute(plan, doc, agent_cap=4)["agents"]["W0-03"] == 4)
    bad = json.loads(plan.read_text())
    bad["workflows"][0]["agent_count"] = 10
    bad["workflows"][1]["units"][0]["owned_output"] = bad["workflows"][1]["units"][1]["owned_output"]
    bad["policy"]["max_active_workflows"] = 51
    e = validate_plan(bad)
    check("invalid plan reports agent_count, owned_output, max_active", len(e) >= 3 and any("agent_count" in x for x in e) and any("owned_output" in x for x in e), e)
    def _oo(*vals):
        d = json.loads(json.dumps(doc)); us = d["workflows"][0]["units"]
        for u, v in zip(us, vals): u["owned_output"] = v
        return validate_plan(d)
    ov = lambda e: any("overlaps" in x for x in e)
    check("owned dir accepted", not _oo("t/creative/", "t/other.py"), _oo("t/creative/", "t/other.py"))
    check("owned file accepted", not _oo("t/a.py", "t/b.py"))
    check("dir/file overlap rejected", ov(_oo("a/b/", "a/b/c.py")))
    check("equal owned rejected", ov(_oo("a/b.py", "a/b.py")))
    check("sibling prefix a/b vs a/bc.py accepted", not _oo("a/b", "a/bc.py"))
    check("absolute owned rejected", bool(_oo("/etc/x.py", "t/b.py")))
    check("dotdot owned rejected", bool(_oo("a/../x.py", "t/b.py")))
    # discovery
    check("find_plan walks upward", find_plan(proj / "a" / "b")[0] == plan.resolve())
    nop = tmp / "noplan"
    nop.mkdir()
    check("no plan -> allowed (ceilings only)", find_plan(nop) is None and check_launch({"args": {}}, nop, state_dir=sd, reap=False)[0])
    alt = tmp / "alt"
    (alt / "sub").mkdir(parents=True)
    (alt / "docs").mkdir()
    pplan = _mkplan(alt / "docs", {"P-01": 2})
    (alt / ".spec-protocol.json").write_text(json.dumps({"swarmPlan": "docs/SWARM-PLAN.json"}))
    check("swarmPlan pointer wins", find_plan(alt / "sub")[0] == pplan.resolve())
    # compute
    s = compute(plan, doc)
    check("owed follows plan max_active (2) and plan order", s["owed"] == ["W0-01", "W0-02"] and s["ready"] == ["W0-01", "W0-02", "W0-03"], s)
    check("dependent workflow not ready", "W0-04" not in s["ready"])
    s = compute(plan, doc, running={"W0-01"})
    check("running counts toward max_active", s["owed"] == ["W0-02"], s)
    s = compute(plan, doc, running={"W0-01", "W0-02"})
    check("at max_active nothing owed", s["owed"] == [], s)
    _verdict(proj, "W0-01", "FAIL")
    check("FAIL verdict is not done", compute(plan, doc)["done"] == [])
    _verdict(proj, "W0-01", "PASS")
    s = compute(plan, doc)
    check("PASS verdict makes done and releases dependents", s["done"] == ["W0-01"] and s["ready"] == ["W0-02", "W0-03", "W0-04"] and s["owed"] == ["W0-02", "W0-03"], s)
    doc2 = json.loads(plan.read_text())
    doc2["status"] = "complete"
    check("status field ignored for done", compute(plan, doc2)["done"] == ["W0-01"])
    s = compute(plan, doc, launches={"W0-02": 3})
    check("handback after 3 launches, not owed", s["handback"] == ["W0-02"] and "W0-02" not in s["owed"] and s["owed"] == ["W0-03", "W0-04"], s)
    check("armed by status or recorded launch", is_armed({"status": "running"}, False) and is_armed({"status": "planned"}, True) and not is_armed({"status": "planned"}, False))
    # journal + launch contract (reap off: temp state)
    conn = open_journal(sd)
    conn.executescript("CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,session TEXT,transcript TEXT,created REAL,script_hash TEXT,state TEXT,name TEXT,peak INTEGER,receipt TEXT);")
    conn.execute("INSERT INTO launches VALUES('t1','s1','',?,'h','VALIDATED','n',8,'')", (time.time(),))
    conn.execute("INSERT INTO launch_tags VALUES('t1','s1','W0-02',?,?)", (str(plan), time.time()))
    conn.commit()
    v = journal_view(conn, plan, ["W0-02", "W0-03"], "s1")
    check("journal view: live launch is running + armed", v["running"] == {"W0-02"} and v["launches"] == {"W0-02": 1} and v["any"], v)
    conn.execute("DELETE FROM launch_tags")
    conn.commit()
    conn.close()
    want = unit_ids(workflows(doc)[2])  # W0-03: 12 units; but agent_count 10
    w3 = {"workflowId": "W0-03", "units": want}
    cases = [
        ("wrong workflowId blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "NOPE", "units": want}}, False, "W0-02"),
        ("missing workflowId blocked", {"script": GOOD_SCRIPT, "args": {"units": want}}, False, "W0-02"),
        ("missing units blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03"}}, False, "args.units"),
        ("11 of 12 units blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03", "units": want[:-1]}}, False, "exactly 12"),
        ("extra unit blocked", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03", "units": want + ["W0-03-U13"]}}, False, "exactly 12"),
        ("name-only launch blocked", {"args": w3}, False, "undeterminable"),
        ("no fan-out stage blocked", {"script": GOOD_SCRIPT.replace("args.units", "['a','b','c']"), "args": w3}, False, "fans out"),
        ("unreadable scriptPath blocked", {"scriptPath": str(tmp / "missing.js"), "args": w3}, False, "undeterminable"),
        ("exact match allowed", {"script": GOOD_SCRIPT, "args": w3}, True, ""),
        ("units as objects allowed", {"script": GOOD_SCRIPT, "args": {"workflowId": "W0-03", "units": [{"unit_id": u} for u in want]}}, True, ""),
        ("args as JSON text allowed", {"script": GOOD_SCRIPT, "args": json.dumps(w3)}, True, ""),
    ]
    for name, ti, want_ok, needle in cases:
        ok, msg = check_launch(ti, proj / "a", session="s1", state_dir=sd, reap=False, attempt_id=name)
        check(name, ok == want_ok and (not needle or needle in msg) and (ok or ("W0-0" in msg and "agent_count" in msg)), msg[:300])
    dep = tmp / "dep"
    dep.mkdir()
    _mkplan(dep, {"A-01": 2, "A-02": 2}, deps={"A-02": ["A-01"]})
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "A-02", "units": ["A-02-U1", "A-02-U2"]}}, dep, state_dir=sd, reap=False)
    check("dependency-blocked workflow blocked", not ok and "not ready" in msg and "A-01" in msg, msg[:200])
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "W0-02", "units": unit_ids(workflows(doc)[1])}}, proj, session="s1", state_dir=sd, reap=False)
    check("ready W0-02 allowed", ok, msg)
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {"workflowId": "W0-01", "units": unit_ids(workflows(doc)[0])}}, proj, session="s1", state_dir=sd, reap=False)
    check("done W0-01 relaunch blocked", not ok and "already done" in msg, msg[:200])
    conn = open_journal(sd)
    n = conn.execute("SELECT COUNT(*) FROM launch_attempts").fetchone()[0]
    check("denied attempts recorded once each", n >= 8, n)
    conn.close()
    # session-pinned (armed) plans survive a cwd change; unarmed plans stay cwd-scoped
    away = tmp / "away"
    away.mkdir()
    armed = tmp / "armed"
    armed.mkdir()
    _mkplan(armed, {"R-01": 2}, status="running")
    unarmed = tmp / "unarmed"
    unarmed.mkdir()
    _mkplan(unarmed, {"N-01": 2}, status="planned")
    check("unarmed plan + cwd away -> no plan", (resolve_plan(unarmed, "sA", sd), resolve_plan(away, "sA", sd)) [1] is None)
    check("armed plan found from its cwd", resolve_plan(armed, "sB", sd)[0] == (armed / "SWARM-PLAN.json").resolve())
    pinned = resolve_plan(away, "sB", sd)
    check("armed session keeps its plan after cwd moves", pinned is not None and pinned[0] == (armed / "SWARM-PLAN.json").resolve())
    check("another session is unaffected", resolve_plan(away, "sC", sd) is None)
    ok, msg = check_launch({"script": GOOD_SCRIPT, "args": {}}, away, session="sB", state_dir=sd, reap=False)
    check("armed session + cwd away + unplanned Workflow blocked", not ok and "R-01" in msg, msg[:200])
    c2 = open_journal(sd)
    c2.execute("CREATE TABLE IF NOT EXISTS continuations(session TEXT PRIMARY KEY,count INTEGER,latched INTEGER,updated REAL)")
    c2.execute("INSERT OR REPLACE INTO continuations VALUES('sB',0,1,0)")
    c2.commit()
    c2.close()
    check("the user's stop latch releases the pinned plan", resolve_plan(away, "sB", sd) is None)
    print("staffing.py selftest: %s" % ("ALL PASS" if not fails else "%d FAILED: %s" % (len(fails), ", ".join(fails))))
    return 1 if fails else 0


def main(argv):
    if len(argv) > 1 and argv[1] == "--selftest":
        return selftest()
    if len(argv) > 1 and argv[1] == "status":
        cwd, sd, js = os.getcwd(), None, False
        i = 2
        while i < len(argv):
            if argv[i] == "--cwd" and i + 1 < len(argv):
                cwd = argv[i + 1]
                i += 1
            elif argv[i] == "--state-dir" and i + 1 < len(argv):
                sd = argv[i + 1]
                i += 1
            elif argv[i] == "--json":
                js = True
            i += 1
        return cmd_status(cwd, sd, js)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
