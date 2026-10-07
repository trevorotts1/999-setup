"""Tamper detection (guard.py tamper_before / tamper_after): a governed MAIN-session Bash call that changes the protected set through a target the
command text never names is let run, then recorded as a TAMPER alert; the session's Workflow launches are refused and Stop is blocked until an
operator runs `staffing.py clear-tamper`. Everything goes through the real hook entry point on a TEMP state dir."""
import json, os, subprocess, sys
from pathlib import Path
import pytest
from test_enforcement_v22 import Env, st, ROOT, armed, Attested  # noqa: F401

PY = sys.executable


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path)
    e.plan = armed(e)
    (e.proj / 'evidence' / 'W0-01').mkdir(parents=True)
    e.vf = e.proj / 'evidence' / 'W0-01' / 'W0-01-U1.verdict.json'
    e.vf.write_text('{"verdict": "PASS"}')
    e.target = e.tmp / 'target.txt'
    return e


def variable_script(env, body):
    """A script whose mutation target is read from a file at run time: not a literal, so PreToolUse cannot see it."""
    s = env.tmp / 'vt.py'
    s.write_text("t = open(%r).read().strip()\n%s\n" % (str(env.target), body))
    return s


def bash(env, cmd, tuid, run=True):
    rc, out = env.pre('Bash', {'command': cmd}, tuid=tuid)
    assert rc == 0, (cmd, out)
    if run:
        subprocess.run(cmd, shell=True, check=True, cwd=str(env.proj))
    return out


def next_call(env, tuid):
    return env.pre('Bash', {'command': 'true'}, tuid=tuid)


def alerts(env):
    return env.q('SELECT change, path, tool_use_id, cleared FROM tamper_alerts ORDER BY at')


def test_variable_target_script_modifies_plan_runs_is_recorded_blocks_launch_and_stop_then_operator_clears(env):
    env.target.write_text(str(env.plan))
    s = variable_script(env, "open(t, 'a').write('\\n')")
    out = bash(env, 'python3 %s' % s, 'T1')  # runs: the target is not a literal
    assert alerts(env) == [] and env.q('SELECT COUNT(*) FROM tamper_snap')[0][0] == 1
    assert next_call(env, 'T2')[0] == 0  # the NEXT guarded call reconciles; it is not itself refused
    a = alerts(env)
    assert a == [('modified', str(env.plan.resolve()), 'T1', 0)], a
    assert env.q('SELECT COUNT(*) FROM tamper_snap WHERE tool_use_id=?', 'T1')[0][0] == 0
    status = (env.sd / 'STATUS.md').read_text()
    assert '- TAMPER: session S1: modified %s by Bash call T1: python3 %s' % (env.plan.resolve(), s) in status, status
    # next Workflow launch refused, Stop blocked
    g = env.gen('W0-01')
    a_ = dict(g['args']); a_['attemptId'] = 'TA1'
    rc, out = env.pre('Workflow', {'scriptPath': g['scriptPath'], 'args': a_}, tuid='L-TA1')
    assert rc == 2 and 'TAMPER' in out and 'clear-tamper' in out and str(env.plan.resolve()) in out, out
    assert env.q("SELECT COUNT(*) FROM launches WHERE id='L-TA1'")[0][0] == 0
    reason = env.stop()
    assert reason and reason.startswith('TAMPER') and 'Bash call' in reason, reason
    # the governed session can not clear it
    rc, out = env.pre('Bash', {'command': 'python3 %s/staffing.py clear-tamper --session S1 --reason mine' % ROOT}, tuid='T3')
    assert rc == 2 and 'governs the session' in out, out
    # another session is not affected
    assert 'TAMPER' not in (env.stop(sid='OTHER') or '')
    # the operator clears it
    p = subprocess.run([PY, str(ROOT / 'staffing.py'), 'clear-tamper', '--session', 'S1', '--reason', 'reviewed by test', '--state-dir', str(env.sd)], capture_output=True, text=True)
    assert p.returncode == 0 and '1 row(s) cleared' in p.stdout, p.stdout + p.stderr
    assert env.q('SELECT cleared, cleared_reason FROM tamper_alerts') == [(1, 'reviewed by test')]
    assert 'TAMPER_CLEARED: session S1' in (env.sd / 'STATUS.md').read_text()
    rc, out = env.pre('Workflow', {'scriptPath': g['scriptPath'], 'args': a_}, tuid='L-TA2')
    assert rc == 0, out
    reason = env.stop()
    assert not reason or 'TAMPER' not in reason, reason
    # and the same call does not alert twice
    assert len(alerts(env)) == 1


def test_clear_tamper_needs_session_and_reason(env):
    p = subprocess.run([PY, str(ROOT / 'staffing.py'), 'clear-tamper', '--session', 'S1', '--state-dir', str(env.sd)], capture_output=True, text=True)
    assert p.returncode == 2 and 'usage' in p.stdout


def test_read_only_variable_path_script_raises_no_alert(env):
    env.target.write_text(str(env.plan))
    s = variable_script(env, "print(len(open(t).read()))")
    bash(env, 'python3 %s' % s, 'R1')
    assert next_call(env, 'R2')[0] == 0
    assert alerts(env) == []
    assert env.stop() is None or 'TAMPER' not in env.stop()


def test_variable_target_delete_of_the_plan_is_caught(env):
    env.target.write_text(str(env.plan))
    bash(env, 'python3 %s' % variable_script(env, "import os; os.remove(t)"), 'D1')
    next_call(env, 'D2')
    assert [(c, Path(p).name) for c, p, *_ in alerts(env)] == [('deleted', 'SWARM-PLAN.json')]


def test_variable_target_create_and_verdict_forgery_are_caught(env):
    # a created sibling plan in the plan folder
    env.target.write_text(str(env.proj / 'BM-SWARM-PLAN.json'))
    bash(env, 'python3 %s' % variable_script(env, "open(t, 'w').write('{}')"), 'C1')
    next_call(env, 'C2')
    # a forged / modified verdict
    env.target.write_text(str(env.vf))
    bash(env, 'python3 %s' % variable_script(env, "open(t, 'w').write('{\"verdict\": \"PASS\", \"forged\": 1}')"), 'V1')
    next_call(env, 'V2')
    got = sorted((c, Path(p).name) for c, p, *_ in alerts(env))
    assert got == sorted([('created', 'BM-SWARM-PLAN.json'), ('modified', 'W0-01-U1.verdict.json')]), got


def test_subagent_verdict_journaled_by_its_write_is_not_tamper(env):
    a = Attested(env)
    kw = dict(agent_id='AGENTX1', agent_type='general-purpose')
    bash(env, 'sleep 0', 'S1A', run=True)
    # a subagent writes its verdict with the Write tool while the main Bash call is "running"
    ti = {'file_path': str(a.vf), 'content': a.body}
    assert env.pre('Write', ti, **kw)[0] == 0
    a.vf.parent.mkdir(parents=True, exist_ok=True); a.vf.write_text(a.body)
    env.post('Write', ti, **kw)  # journaled in verdict_records with its sha256
    assert next_call(env, 'S1B')[0] == 0
    assert alerts(env) == [], alerts(env)


def test_sanctioned_plan_writers_are_not_tamper(env):
    bash(env, 'sleep 0', 'N1', run=True)
    doc = json.loads(env.plan.read_text()); doc['status'] = 'running'; doc['policy']['max_active_workflows'] = 4
    env.plan.write_text(json.dumps(doc))
    st.sanction(env.plan, env.sd)  # what the guard / staffing.py record right after they write
    assert next_call(env, 'N2')[0] == 0
    assert alerts(env) == []
    # the same write WITHOUT a sanction is a tamper
    bash(env, 'sleep 0', 'N3', run=True)
    doc['policy']['max_active_workflows'] = 5
    env.plan.write_text(json.dumps(doc))
    next_call(env, 'N4')
    assert len(alerts(env)) == 1


def test_staffing_add_plan_cli_records_its_write_as_sanctioned(env):
    draft = env.tmp / 'draft'; draft.mkdir()
    st._mkplan(draft, {'W9-01': 2})
    dest = env.proj / 'W9-SWARM-PLAN.json'
    bash(env, 'sleep 0', 'A1', run=True)
    p = subprocess.run([PY, str(ROOT / 'staffing.py'), 'add-plan', '--src', str(draft / 'SWARM-PLAN.json'), '--dest', str(dest), '--state-dir', str(env.sd)], capture_output=True, text=True)
    assert p.returncode == 0 and dest.exists(), p.stdout + p.stderr
    assert env.q('SELECT COUNT(*) FROM sanctioned_writes')[0][0] == 1
    assert next_call(env, 'A2')[0] == 0
    assert alerts(env) == []


def test_subagent_bash_is_not_snapshotted_and_refused_calls_leave_no_snapshot(env):
    env.pre('Bash', {'command': 'echo hi'}, tuid='SA1', agent_id='sub1')
    assert env.q('SELECT COUNT(*) FROM tamper_snap')[0][0] == 0
    rc, _ = env.pre('Bash', {'command': 'rm %s' % env.plan}, tuid='RF1')
    assert rc == 2 and env.q('SELECT COUNT(*) FROM tamper_snap')[0][0] == 0


def test_no_plan_no_snapshot_and_hashing_trouble_never_blocks(env, tmp_path):
    other = tmp_path / 'noplan'; other.mkdir()
    rc, out = env.pre('Bash', {'command': 'echo hi'}, tuid='NP1', cwd=other, sid='NOPLAN')
    assert rc == 0 and env.q("SELECT COUNT(*) FROM tamper_snap WHERE session='NOPLAN'")[0][0] == 0
    # an unreadable protected file: the snapshot just skips it
    os.chmod(env.vf, 0)
    try:
        rc, out = env.pre('Bash', {'command': 'echo hi'}, tuid='H1')
        assert rc == 0, out
        rc, out = env.pre('Bash', {'command': 'echo hi'}, tuid='H2')
        assert rc == 0, out
    finally:
        os.chmod(env.vf, 0o644)


def _other_proj(env, name='projB'):
    b = env.tmp / name; b.mkdir()
    st._mkplan(b, {'W0-01': 1}, status='running')
    return b


def test_preexisting_plan_newly_covered_by_a_later_cwd_is_not_created(env):
    # `cd <other plan folder> && read-only` : the later hook's cwd covers an OLD plan that was never in the before-snapshot
    b = _other_proj(env)
    import time; time.sleep(2.3)  # older than the snapshot's 2 s slack
    bash(env, 'true', 'X1')
    assert env.pre('Bash', {'command': 'true'}, tuid='X2', cwd=b)[0] == 0
    assert alerts(env) == [], alerts(env)


def test_plan_genuinely_created_in_a_newly_covered_dir_during_the_call_alerts(env):
    bash(env, 'true', 'Y1')
    b = _other_proj(env)  # appears after the before-snapshot
    assert env.pre('Bash', {'command': 'true'}, tuid='Y2', cwd=b)[0] == 0
    assert [(c, Path(p).name) for c, p, *_ in alerts(env)] == [('created', 'SWARM-PLAN.json')], alerts(env)
