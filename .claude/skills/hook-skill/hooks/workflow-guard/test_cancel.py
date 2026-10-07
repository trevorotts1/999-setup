"""staffing.py cancel: operator cancellation of a workflow. Temp dirs and a private state dir only; nothing live is touched."""
import json, sqlite3
from pathlib import Path
from test_returned_run_live import guard, st, env  # noqa: F401

S = str(Path(guard.ROOT) / "staffing.py")


def setup(tmp_path, specs=None):
    sd = tmp_path / "sd"; sd.mkdir()
    d = tmp_path / "plans"; d.mkdir()
    p = st._mkplan(d, specs or {"BM-01": 2}, status="running")
    return sd, d, p


def cancel(p, sd, wid="BM-01"):
    return st.cmd_cancel(str(p), wid, "stopped by operator", "other.json:BM-02", str(sd))


def test_cancel_clears_owed_not_done_and_settles_plan(tmp_path, capsys):
    sd, d, p = setup(tmp_path)
    c = st.open_journal(sd); c.execute("INSERT INTO session_pins VALUES('s1',?,1)", (str(p.resolve()),)); c.commit(); c.close()
    assert st.snapshot(str(d), str(sd), "s1", reap=False)["state"]["owed"] == ["BM-01"]
    assert cancel(p, sd) == 0
    snap = st.snapshot(str(d), str(sd), "s1", reap=False)
    s = snap["state"]
    assert s["owed"] == [] and s["done"] == [] and s["cancelled"] == ["BM-01"]
    assert json.loads(p.read_text())["status"] == "planned-not-running"
    db = sqlite3.connect(sd / "guard.sqlite3")
    assert db.execute("SELECT COUNT(*) FROM session_pins").fetchone()[0] == 0
    assert db.execute("SELECT workflow_id,superseded_by FROM cancellations").fetchall() == [("BM-01", "other.json:BM-02")]
    assert p.exists()
    st.cmd_status(str(d), str(sd), False)
    assert "cancelled (1): BM-01" in capsys.readouterr().out


def test_partial_cancel_keeps_plan_running(tmp_path):
    sd, d, p = setup(tmp_path, {"BM-01": 2, "BM-02": 2})
    assert cancel(p, sd) == 0
    assert json.loads(p.read_text())["status"] == "running"
    assert st.snapshot(str(d), str(sd), "s1", reap=False)["state"]["owed"] == ["BM-02"]


def test_cancel_unknown_workflow_refused(tmp_path):
    sd, d, p = setup(tmp_path)
    assert cancel(p, sd, "NOPE") == 1


def test_rearm_skips_settled_plan(env):
    sd = guard.STATE
    p = st._mkplan(env.proj, {"BM-01": 2}, status="running")
    c = st.open_journal(sd)
    c.execute("INSERT INTO launch_tags VALUES('t1','sX','BM-01',?,1)", (str(p.resolve()),)); c.commit(); c.close()
    assert st.cmd_cancel(str(p), "BM-01", "r", None, str(sd)) == 0
    assert json.loads(p.read_text())["status"] == "planned-not-running"
    guard._rearm_launched("sX")
    assert json.loads(p.read_text())["status"] == "planned-not-running"


def test_rearm_still_works_for_unsettled_plan(env):
    p = st._mkplan(env.proj, {"BM-01": 2}, status="planned-not-running")
    c = st.open_journal(guard.STATE)
    c.execute("INSERT INTO launch_tags VALUES('t1','sX','BM-01',?,1)", (str(p.resolve()),)); c.commit(); c.close()
    guard._rearm_launched("sX")
    assert json.loads(p.read_text())["status"] == "running"


def test_governed_session_cannot_cancel(env):
    cmd = "python3 %s cancel --plan /x/SWARM-PLAN.json --workflow BM-01 --reason r" % S
    assert guard._staffing_bad(cmd) and not guard._staffing_ok(cmd)
    assert "cancel" not in guard.STAFFING_VERBS


def test_check_launch_refuses_cancelled(tmp_path):
    sd, d, p = setup(tmp_path, {"BM-01": 2, "BM-02": 2})
    assert cancel(p, sd) == 0
    ok, msg = st.check_launch({"args": {"workflowId": "BM-01"}}, str(d), session="s1", state_dir=str(sd), reap=False, record=False)
    assert not ok and "cancelled by operator: stopped by operator" in msg


# ---------------------------------------------------------------- copy source is a read; refusals count as failures
def test_copy_from_governed_is_read_to_governed_is_write(env):
    plan = st._mkplan(env.proj, {"G-01": 2}, status="running")
    d = {"cwd": str(env.proj), "session_id": "s1"}
    ok = lambda cmd: guard.protected_write_block(d, "Bash", {"command": cmd}, "s1") is None
    src = env.tmp / "src.py"
    src.write_text("import shutil\nshutil.copyfile('%s', '/private/tmp/guard-roc.sqlite3')\n" % plan)
    assert ok("python3 %s" % src)  # governed SOURCE, /tmp destination
    assert ok("python3 -c \"import shutil; shutil.copy2('%s', '/private/tmp/x.json')\"" % plan)
    to = env.tmp / "cp_bm.py"
    to.write_text("import shutil\nshutil.copyfile('/x/a.json', '%s/BM-SWARM-PLAN.json')\n" % env.proj)
    assert not ok("python3 %s" % to)  # governed DESTINATION
    mv = env.tmp / "mv.py"
    mv.write_text("import shutil\nshutil.move('%s', '/private/tmp/x.json')\n" % plan)
    assert not ok("python3 %s" % mv)  # move removes the source
    rm = env.tmp / "rm.py"
    rm.write_text("import os\nos.remove('%s')\n" % plan)
    assert not ok("python3 %s" % rm)
    assert ok("cp %s /private/tmp/x.json" % plan)
    assert not ok("cp /private/tmp/x.json %s" % plan)
    assert not ok("mv %s /private/tmp/x.json" % plan)


def test_identical_refused_command_hits_third_attempt_rule(env, capsys):
    plan = st._mkplan(env.proj, {"G-01": 2}, status="running")
    bad = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "session_id": "s9", "cwd": str(env.proj),
           "tool_input": {"command": "mv %s /private/tmp/x.json" % plan}}
    other = dict(bad, tool_input={"command": "rm %s" % plan})
    guard.pre_checks(bad, "Bash", "s9"); capsys.readouterr()
    assert guard.pre_checks(bad, "Bash", "s9") == 2
    assert "Third identical" not in capsys.readouterr().err
    assert guard.pre_checks(bad, "Bash", "s9") == 2
    assert "Third identical attempt" in capsys.readouterr().err
    assert guard.pre_checks(other, "Bash", "s9") == 2
    assert "Third identical" not in capsys.readouterr().err  # a different command is not blocked by the counter
