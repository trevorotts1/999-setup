"""from-census staffing floor: a plan workflow that exists in its declared census may not have fewer units than
min(census agent_count, cap). Fixtures only (tmp dirs, private state dir); no live plan or census is touched."""
import json, os
from pathlib import Path
import pytest
from test_bash_targets import env, run  # noqa: F401  (env is a fixture)
import staffing as st


def mk_census(root, specs):
    """v1-shaped census: specs {wid: agent_count}; each workflow has per-agent `units` plus a 2-seat agent_ownership (as the real packet)."""
    wfs = []
    for wid, n in specs.items():
        wfs.append({"workflow_id": wid, "purpose": "purpose of " + wid, "outputs": ["out/%s/" % wid], "agent_count": n, "dependencies": [],
                    "verification_method": "vm " + wid, "stop_condition": "sc",
                    "agent_ownership": [{"agent_name": wid + "-B1", "responsibility": "build", "scope_of_ownership": "out/%s/" % wid, "files_or_components_owned": ["out/%s/" % wid]},
                                        {"agent_name": wid + "-Q1", "responsibility": "check", "scope_of_ownership": "evidence/%s/verdict.json" % wid, "files_or_components_owned": ["evidence/%s/verdict.json" % wid]}],
                    "units": [{"unit_id": "%s-U%d" % (wid, k), "work": "part " + "abcdefghijklmnop"[k - 1] * 3, "owned_output": "out/%s/p%d.md" % (wid, k), "acceptance": "acc%d" % k, "source": "s"} for k in range(1, n + 1)]})
    c = {"schema": "blackceo.swarm-plan/v1", "policy": {"max_active_workflows": 5, "max_agents_per_workflow": 10, "max_working_agents": 500}, "workflows": wfs}
    p = Path(root) / "census.json"
    p.write_text(json.dumps(c))
    return p


def test_from_census_builds_n_units_and_validates(tmp_path):
    cen = mk_census(tmp_path, {"W4-02": 9, "W5-03": 8})
    out = tmp_path / "draft.json"
    assert st.cmd_from_census(str(cen), ["W4-02", "W5-03"], str(out), state_dir=str(tmp_path / "sd")) == 0
    d = json.loads(out.read_text())
    assert [len(w["units"]) for w in d["workflows"]] == [9, 8] and [w["agent_count"] for w in d["workflows"]] == [9, 8]
    assert st.validate_plan(d, tmp_path) == [] and d["census"] == str(cen.resolve())
    assert d["workflows"][0]["units"][0]["verdict_file"] == "evidence/W4-02/W4-02-U1.verdict.json"


def test_from_census_without_units_uses_ownership_and_refuses_understaffed_census(tmp_path):
    cen = mk_census(tmp_path, {"W1-01": 1})
    d = json.loads(cen.read_text()); w = d["workflows"][0]; w["units"] = []; w["agent_count"] = 1; cen.write_text(json.dumps(d))
    out = tmp_path / "d1.json"
    assert st.cmd_from_census(str(cen), ["W1-01"], str(out), state_dir=str(tmp_path / "sd")) == 0 and len(json.loads(out.read_text())["workflows"][0]["units"]) == 1
    w["agent_count"] = 5; cen.write_text(json.dumps(d))  # census promises 5 agents but names only one builder seat: refuse, never pad
    assert st.cmd_from_census(str(cen), ["W1-01"], str(tmp_path / "d2.json"), state_dir=str(tmp_path / "sd")) == 1 and not (tmp_path / "d2.json").exists()


def one_unit_plan(tmp_path, cen, wids=("W4-02",), census_key=True, name="draft1.json"):
    doc = {"schema": st.SCHEMA, "status": "planned-not-running", "policy": {"max_active_workflows": 3, "max_agents_per_workflow": 10, "max_working_agents": 500}, "workflows": []}
    if census_key:
        doc["census"] = str(cen)
    for wid in wids:
        doc["workflows"].append({"workflow_id": wid, "dependencies": [], "agent_count": 1, "concurrency": 1, "units": [
            {"unit_id": wid + "-U1", "work": "whole thing", "owned_output": "out/%s/" % wid, "acceptance": "a", "source": "s", "verdict_file": "evidence/%s/%s-U1.verdict.json" % (wid, wid)}]})
    p = tmp_path / name
    p.write_text(json.dumps(doc))
    return p


def test_add_plan_refuses_one_unit_for_census_workflow_and_accepts_from_census(tmp_path, capsys):
    cen = mk_census(tmp_path, {"W4-03": 7, "W4-07": 1})
    sd = tmp_path / "sd"; sd.mkdir()
    bad = one_unit_plan(tmp_path, cen, ("W4-03",))
    assert st.cmd_add_plan(str(bad), str(tmp_path / "live" / "W-PLAN.json"), True, str(sd)) == 1
    msg = capsys.readouterr().out
    assert "W4-03" in msg and "plans 7 agents" in msg and "gives 1 unit" in msg and "from-census" in msg
    good = tmp_path / "good.json"
    assert st.cmd_from_census(str(cen), ["W4-03"], str(good), state_dir=str(sd)) == 0
    assert st.cmd_add_plan(str(good), str(tmp_path / "live" / "W-PLAN.json"), False, str(sd)) == 0
    assert len(json.loads((tmp_path / "live" / "W-PLAN.json").read_text())["workflows"][0]["units"]) == 7


def test_cap_lowers_the_floor_and_non_census_workflow_is_unaffected(tmp_path):
    cen = mk_census(tmp_path, {"W4-03": 7})
    p = one_unit_plan(tmp_path, cen, ("W4-03", "BM-01"))
    d = json.loads(p.read_text())
    assert any("W4-03: under-staffed" in e for e in st.validate_plan(d, tmp_path))
    assert not any("BM-01" in e for e in st.validate_plan(d, tmp_path))  # not in the census
    d["workflows"][0]["units"] = d["workflows"][0]["units"] * 1
    d["policy"]["max_agents_per_workflow"] = 1  # cap 1: planned = min(7, 1) = 1
    assert st.validate_plan(d, tmp_path) == []


def test_no_census_no_check_and_implicit_binding_only_when_asked(tmp_path):
    cen = mk_census(tmp_path, {"W4-03": 7})
    (tmp_path / "packet" / "claude-nine-swarm").mkdir(parents=True)
    (tmp_path / "packet" / "claude-nine-swarm" / "SWARM-PLAN.json").write_text(cen.read_text())
    sub = tmp_path / "swarm-plans"; sub.mkdir()
    d = json.loads(one_unit_plan(sub, cen, ("W4-03",), census_key=False).read_text())
    assert st.validate_plan(d, sub) == []  # nothing declared: backward compatible
    assert any("under-staffed" in e for e in st.validate_plan(d, sub, implicit_census=True))  # project-bound census found by add-plan
    assert st.validate_plan(d) == []  # no plan_dir: no check


def test_unreadable_declared_census_is_an_error(tmp_path):
    p = one_unit_plan(tmp_path, tmp_path / "nope.json")
    assert any("unreadable" in e for e in st.validate_plan(json.loads(p.read_text()), tmp_path))


def test_from_census_refuses_governed_or_existing_out(tmp_path):
    cen = mk_census(tmp_path, {"W4-03": 7})
    sd = tmp_path / "sd"; sd.mkdir()
    for bad in (tmp_path / "SWARM-PLAN.json", tmp_path / "evidence" / "W4-03" / "x.json", sd / "x.json", tmp_path / "BM-SWARM-PLAN.json"):
        assert st.cmd_from_census(str(cen), ["W4-03"], str(bad), state_dir=str(sd)) == 1 and not bad.exists()
    (tmp_path / "taken.json").write_text("{}")
    assert st.cmd_from_census(str(cen), ["W4-03"], str(tmp_path / "taken.json"), state_dir=str(sd)) == 1 and (tmp_path / "taken.json").read_text() == "{}"


def test_governed_session_may_run_from_census_to_tmp_but_not_into_a_plan_path(env):
    cen = mk_census(env.tmp, {"W4-03": 7})
    out = "/private/tmp/census-test-%d.json" % os.getpid()
    Path(out).unlink(missing_ok=True)
    try:
        rc, o = run(env, "python3 {root}/staffing.py from-census --census %s --workflow W4-03 --out %s --state-dir {sd}" % (cen, out))
        assert rc == 0, o
        for tgt in ("{plan}", "{proj}/BM-SWARM-PLAN.json", "{ev}/x.json", "{sd}/x.json"):
            rc, o = run(env, "python3 {root}/staffing.py from-census --census %s --workflow W4-03 --out %s" % (cen, tgt))
            assert rc == 2 and "governs the session" in o, (tgt, o)
        rc, o = run(env, "python3 {root}/staffing.py cancel --plan {plan} --workflow W0-01 --reason r")
        assert rc == 2
    finally:
        Path(out).unlink(missing_ok=True)
