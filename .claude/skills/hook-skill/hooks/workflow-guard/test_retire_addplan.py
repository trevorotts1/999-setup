"""staffing.py retire / add-plan: the two sanctioned plan operations, and the guard letting exactly those verbs through.
All fixtures live in tmp dirs with a private state dir; no live plan or journal is touched."""
import json, sqlite3
from pathlib import Path
import pytest
from test_returned_run_live import guard, st, env  # noqa: F401


def setup(tmp_path):
    """canonical plan tmp/SWARM-PLAN.json (W-01 PASS, W-02 owed) and a stale plan tmp/swarm-plans/SWARM-PLAN.json holding W-01."""
    sd = tmp_path / "sd"; sd.mkdir()
    canon = tmp_path
    st._mkplan(canon, {"W-01": 2, "W-02": 2}, status="running")
    st._verdict(canon, "W-01")
    stale_dir = tmp_path / "swarm-plans"; stale_dir.mkdir()
    stale = st._mkplan(stale_dir, {"W-01": 2})
    return sd, stale, stale_dir


def vfile(plan_dir, wid, n):
    return Path(plan_dir) / "evidence" / wid / ("%s-U%d.verdict.json" % (wid, n))


def retire(plan, sd, dry=False):
    return st.cmd_retire(".", str(plan), dry, sd)


# ---------------------------------------------------------------- retire
def test_retire_proven_under_other_plan_and_dry_run_changes_nothing(tmp_path, capsys):
    sd, stale, _ = setup(tmp_path)
    stale_doc = json.loads(stale.read_text()); stale_doc["status"] = "running"; stale.write_text(json.dumps(stale_doc))
    c = st.open_journal(sd); c.execute("INSERT INTO session_pins VALUES('s1',?,1)", (str(stale.resolve()),)); c.commit(); c.close()
    before = stale.read_text()
    assert retire(stale, sd, dry=True) == 0 and stale.read_text() == before
    assert "PASS under" in capsys.readouterr().out
    assert retire(stale, sd) == 0
    assert json.loads(stale.read_text())["status"] == "planned-not-running"
    assert sqlite3.connect(sd / "guard.sqlite3").execute("SELECT COUNT(*) FROM session_pins").fetchone()[0] == 0
    assert (tmp_path / "evidence" / "W-01").is_dir()  # evidence never deleted


def test_retire_own_evidence(tmp_path):
    d = tmp_path / "solo"; d.mkdir(); sd = tmp_path / "sd"; sd.mkdir()
    p = st._mkplan(d, {"S-01": 2}, status="running"); st._verdict(d, "S-01")
    assert retire(p, sd) == 0 and json.loads(p.read_text())["status"] == "planned-not-running"


@pytest.mark.parametrize("breakage", ["fail", "missing", "hash"])
def test_retire_refuses_and_changes_nothing(tmp_path, capsys, breakage):
    d = tmp_path / "solo"; d.mkdir(); sd = tmp_path / "sd"; sd.mkdir()
    p = st._mkplan(d, {"S-01": 2}, status="running"); st._verdict(d, "S-01")
    c = st.open_journal(sd); c.execute("INSERT INTO session_pins VALUES('s1',?,1)", (str(p.resolve()),)); c.commit()
    if breakage == "fail":
        st._verdict(d, "S-01", "FAIL", unit_ids_={"S-01-U2"})
    elif breakage == "missing":
        vfile(d, "S-01", 2).unlink()
    else:
        c.execute("INSERT INTO verdict_records VALUES(?,?,?,?,?,?,?,?)", (str(p.resolve()), "S-01", "S-01-U1", "A1", "0" * 64, "a", "l", 0))
        c.commit()
    c.close()
    before = p.read_text()
    assert retire(p, sd) == 1
    out = capsys.readouterr().out
    assert "REFUSED" in out and ("S-01-U1" if breakage == "hash" else "S-01-U2") in out
    assert p.read_text() == before
    assert sqlite3.connect(sd / "guard.sqlite3").execute("SELECT COUNT(*) FROM session_pins").fetchone()[0] == 1


# ---------------------------------------------------------------- add-plan
def draft(tmp_path, specs, deps=None, name="draft.json", mutate=None):
    d = tmp_path / "d0"; d.mkdir(exist_ok=True)
    doc = json.loads(st._mkplan(d, specs, deps=deps).read_text())
    if mutate:
        mutate(doc)
    f = tmp_path / name; f.write_text(json.dumps(doc))
    return f


def add(src, dest, sd, dry=False):
    return st.cmd_add_plan(str(src), str(dest), dry, sd)


def test_add_plan_valid_with_proven_external_dependency(tmp_path, capsys):
    sd, _, sdir = setup(tmp_path)
    src = draft(tmp_path, {"N-01": 2}, deps={"N-01": ["W-01"]})
    dest = sdir / "W5-SWARM-PLAN.json"
    assert add(src, dest, sd, dry=True) == 0 and not dest.exists()
    assert add(src, dest, sd) == 0
    doc = json.loads(dest.read_text())
    assert doc["status"] == "planned-not-running" and st.validate_plan(doc) == [] and doc["workflows"][0]["dependencies"] == []
    assert not list(sdir.glob("*.tmp"))


@pytest.mark.parametrize("case", ["schema", "exists", "unknown_dep", "unfinished_dep", "running", "weaker_units", "weaker_acceptance"])
def test_add_plan_refuses_and_writes_nothing(tmp_path, capsys, case):
    sd, _, sdir = setup(tmp_path)
    dest = sdir / "W5-SWARM-PLAN.json"
    specs, deps, mutate = {"N-01": 2}, None, None
    if case == "schema":
        mutate = lambda d: d.update(schema="nope")
    elif case == "unknown_dep":
        deps = {"N-01": ["ZZ-99"]}
    elif case == "unfinished_dep":
        deps = {"N-01": ["W-02"]}
    elif case == "running":
        mutate = lambda d: d.update(status="running")
    elif case == "weaker_units":  # W-02 is owed (2 units) in the armed canonical plan
        specs = {"W-02": 1}
    elif case == "weaker_acceptance":
        specs = {"W-02": 2}
        mutate = lambda d: d["workflows"][0]["units"][0].update(acceptance="x")
        canon = tmp_path / "SWARM-PLAN.json"; cd = json.loads(canon.read_text())
        cd["workflows"][1]["units"][0]["acceptance"] = "strict and detailed"; canon.write_text(json.dumps(cd))
    src = draft(tmp_path, specs, deps=deps, mutate=mutate)
    if case == "exists":
        dest.write_text("keep me")
    assert add(src, dest, sd) == 1
    assert "REFUSED" in capsys.readouterr().out
    assert dest.read_text() == "keep me" if case == "exists" else not dest.exists()


# ---------------------------------------------------------------- guard
def test_guard_allows_new_verbs_and_refuses_the_rest(env):
    S = str(Path(st.__file__).resolve())
    assert guard._staffing_ok("python3 %s retire --plan /x/SWARM-PLAN.json --dry-run" % S)
    assert guard._staffing_ok("python3 %s add-plan --src /x/d.json --dest /x/W5-SWARM-PLAN.json" % S)
    assert not guard._staffing_ok("python3 %s reset --cwd /x" % S)
    assert not guard._staffing_ok("python3 /tmp/evil/staffing.py retire --plan /x")
    assert not guard._staffing_bad("python3 %s retire --plan /x" % S) and guard._staffing_bad("python3 %s reset --cwd /x" % S)


def test_guard_still_refuses_direct_plan_writes_including_via_script(env):
    plan = st._mkplan(env.proj, {"G-01": 2}, status="running")
    d = {"cwd": str(env.proj), "session_id": "s1"}
    S = str(Path(st.__file__).resolve())
    ok = lambda cmd: guard.protected_write_block(d, "Bash", {"command": cmd}, "s1") is None
    assert ok("python3 %s retire --plan %s --dry-run" % (S, plan))
    assert not ok("python3 %s reset --plan %s" % (S, plan))
    assert not ok("python3 -c \"import shutil; shutil.copyfile('/x/a.json', '%s/BM-SWARM-PLAN.json')\"" % env.proj)
    bad = env.tmp / "cp_bm.py"
    bad.write_text("import shutil\nshutil.copyfile('/x/a.json', '%s/BM-SWARM-PLAN.json')\n" % env.proj)
    assert not ok("python3 %s" % bad)  # the 2026-10-07 bypass: path hidden inside a script file
    fine = env.tmp / "hello.py"
    fine.write_text("print('hello')\n")
    assert ok("python3 %s" % fine)


def test_script_scan_is_per_statement_and_skips_guard_tooling(env):
    plan = st._mkplan(env.proj, {"G-01": 2}, status="running")
    d = {"cwd": str(env.proj), "session_id": "s1"}
    ok = lambda cmd: guard.protected_write_block(d, "Bash", {"command": cmd}, "s1") is None
    gate = Path.home() / ".claude/hooks/dispatch-gate.py"
    assert ok("python3 %s --selftest" % gate)  # (a) guard tooling under ~/.claude/hooks is never scanned
    rd = env.tmp / "reader.py"  # (b) mentions + reads a governed plan, writes only elsewhere
    rd.write_text("import json\np=json.load(open('%s'))\nopen('/private/tmp/out.txt','w').write('x')\n# evidence/ swarm-plan.json\n" % plan)
    assert ok("python3 %s" % rd)
    cp = env.tmp / "cp_bm2.py"  # (c) copy onto a governed path
    cp.write_text("import shutil\nshutil.copyfile('/x/a.json', '%s/BM-SWARM-PLAN.json')\n" % env.proj)
    assert not ok("python3 %s" % cp)
    wr = env.tmp / "wr.py"  # (d) open(governed,'w')
    wr.write_text("open('%s','w').write('{}')\n" % plan)
    assert not ok("python3 %s" % wr)
