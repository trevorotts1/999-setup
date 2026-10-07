"""Stop check and reminders against the swarm-plan contract (staffing.py). The plan's own numbers decide
what is owed; verdict files decide done; the status field never does. Every test runs on a temp state dir
and a temp plan; the real guard.sqlite3 is never touched."""
import importlib.util, json, os, tempfile, time
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parent
_boot = tempfile.mkdtemp(prefix='wg-omit-boot-')
os.environ['WORKFLOW_GUARD_STATE'] = _boot  # import-time default; each test re-points it
spec = importlib.util.spec_from_file_location('guard_omit', ROOT / 'guard.py')
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
st = guard._staffing()
LIM = {'concurrent_agents_per_workflow': 10, 'concurrent_workflows_per_program': 50, 'concurrent_agents_total': 500, 'session_lease_seconds': 3600}


@pytest.fixture
def env(tmp_path, monkeypatch):
    sd = tmp_path / 'state'; sd.mkdir(); qg = tmp_path / 'qg'; qg.mkdir()
    (sd / 'limits.json').write_text(json.dumps(LIM))
    monkeypatch.setattr(guard, 'STATE', sd); monkeypatch.setattr(guard, 'LIMITS_FILE', sd / 'limits.json'); monkeypatch.setattr(guard, 'QG_STATE', qg)
    proj = tmp_path / 'proj'; proj.mkdir()
    return type('E', (), {'st': sd, 'qg': qg, 'proj': proj, 'away': tmp_path})


def plan(proj, specs=None, status='running', maw=50, deps=None):
    return st._mkplan(proj, specs or {'W0-01': 8, 'W0-02': 6}, status=status, maw=maw, deps=deps)


def stop(e, sid='s1', cwd=None):
    return guard.stop_omission({'cwd': str(cwd or e.proj), 'session_id': sid}, sid)


def launch(e, wid, state='VALIDATED', sid='s1', plan_path=None, lid=None):
    lid = lid or '%s-%s-%d' % (wid, state, time.time_ns())
    c = guard.db()
    c.execute("INSERT INTO launches VALUES(?,?,'',?,'h',?,'n',8,'')", (lid, sid, time.time(), state))
    c.execute('INSERT INTO launch_tags VALUES(?,?,?,?,?)', (lid, sid, wid, str(plan_path or (e.proj / 'SWARM-PLAN.json').resolve()), time.time()))
    c.commit(); c.close()


def admit(e, wid, aid='A1'):
    """Record an admitted attempt id for wid (what guard.admit_launch does on admission)."""
    c = guard.db()
    c.execute('INSERT OR IGNORE INTO attempt_ids VALUES(?,?,?,?,?)', (str((e.proj / 'SWARM-PLAN.json').resolve()), aid, wid, 'l-' + aid, time.time()))
    c.commit(); c.close()


def denied(e, wid, n, sid='s1'):
    for i in range(n):
        st.record_attempt(e.st, sid, (e.proj / 'SWARM-PLAN.json').resolve(), wid, 'denied', 'x', '%s-a%d' % (wid, i))


def test_owed_by_plan_numbers_and_message(env):
    plan(env.proj)
    r = stop(env)
    assert r == 'Owed now: W0-01 (8 agents), W0-02 (6 agents). Launch each now with args.workflowId and its exact planned units. Do not end the turn while planned workflows are unlaunched.'


def test_no_flat_ten(env):
    plan(env.proj, {'W0-01': 3})
    r = stop(env); assert '3 agents' in r and '10 agents' not in r


def test_hook_emits_block_json(env, capsys):
    plan(env.proj)
    rc = guard.hook({'hook_event_name': 'Stop', 'session_id': 's1', 'cwd': str(env.proj)})
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out['decision'] == 'block' and 'W0-01 (8 agents)' in out['reason']


def test_max_active_workflows_limits_owed(env):
    plan(env.proj, {'W0-01': 8, 'W0-02': 6, 'W0-03': 2}, maw=1)
    assert stop(env).startswith('Owed now: W0-01 (8 agents).')


def test_running_workflow_counts_against_plan_max(env):
    plan(env.proj, {'W0-01': 8, 'W0-02': 6, 'W0-03': 2}, maw=2)
    launch(env, 'W0-01')
    r = stop(env); assert r.startswith('Owed now: W0-02 (6 agents).')
    launch(env, 'W0-02')
    assert stop(env) is None  # both active workflows are running, nothing owed


def test_done_is_decided_by_verdict_file_pass(env):
    plan(env.proj, {'W0-01': 2, 'W0-02': 2}, deps={'W0-02': ['W0-01']})
    assert stop(env).startswith('Owed now: W0-01 (2 agents).')  # W0-02 waits for its dependency
    st._verdict(env.proj, 'W0-01', 'FAIL')
    assert 'W0-01' in stop(env)  # FAIL is not done
    st._verdict(env.proj, 'W0-01', 'PASS')
    assert stop(env).startswith('Owed now: W0-01 (2 agents).')  # PASS whose attempt_id the guard never admitted is not done
    admit(env, 'W0-01')
    assert stop(env).startswith('Owed now: W0-01 (2 agents).')  # admitted, but a verdict file WITHOUT a journal record is not done
    st._journal_verdicts(env.st, env.proj, 'W0-01')
    r = stop(env); assert r.startswith('Owed now: W0-02 (2 agents).')
    st._verdict(env.proj, 'W0-02', 'PASS', attempt='A2'); admit(env, 'W0-02', 'A2'); st._journal_verdicts(env.st, env.proj, 'W0-02')
    assert stop(env) is None


def test_status_fields_never_decide_done(env):
    p = plan(env.proj, {'W0-01': 2}); d = json.loads(p.read_text())
    d['workflows'][0]['status'] = 'accepted'; p.write_text(json.dumps(d))
    assert 'W0-01' in stop(env)  # a self-written status is not a verdict file


def test_no_count_based_release(env):
    plan(env.proj)
    for _ in range(12):
        assert (stop(env) or '').startswith('Owed now:')


def test_release_a_stop_latch(env, capsys):
    plan(env.proj)
    guard.write_txn([("INSERT INTO continuations VALUES('s1',0,1,0)", None)])
    assert guard.hook({'hook_event_name': 'Stop', 'session_id': 's1', 'cwd': str(env.proj)}) == 0
    assert capsys.readouterr().out == ''


def human_prompt(sid='s1', source='user'):
    guard.user_prompt({'session_id': sid, 'prompt': 'what is the status?', 'source': source})


def test_release_b_question_only(env):
    # Only the most recent HUMAN prompt may set question-only: the question-gate state must be stamped right after it.
    plan(env.proj); human_prompt(); (env.qg / 's1.json').write_text(json.dumps({'mode': 'question', 'at': int(time.time())}))
    assert stop(env) is None


def test_release_b_question_state_without_a_human_prompt_does_not_release(env):
    # A machine prompt (agent report, wakeup) is classified by the question-gate too, but the guard never saw a human prompt for it.
    plan(env.proj); (env.qg / 's1.json').write_text(json.dumps({'mode': 'question', 'at': int(time.time())}))
    assert (stop(env) or '').startswith('Owed now:')
    human_prompt(source='schedule_wakeup')  # machine source: not recorded as human
    assert (stop(env) or '').startswith('Owed now:')
    human_prompt()
    assert stop(env) is None
    (env.qg / 's1.json').write_text(json.dumps({'mode': 'question', 'at': int(time.time()) + 3600}))  # a stale/other stamp is not that human prompt
    assert (stop(env) or '').startswith('Owed now:')


def test_hook_refusals_never_release_the_stop(env):
    plan(env.proj)
    denied(env, 'W0-01', 5); denied(env, 'W0-02', 5)
    assert (stop(env) or '').startswith('Owed now:')  # refusals recorded by the old guard are not admitted launches and never count


def test_release_c_admitted_launches_that_failed(env):
    plan(env.proj, {'W0-01': 2, 'W0-02': 2})
    launch(env, 'W0-01', 'FAILED'); launch(env, 'W0-01', 'FAILED'); launch(env, 'W0-02', 'FAILED')
    assert (stop(env) or '').startswith('Owed now:')  # two and one failures: still owed
    launch(env, 'W0-02', 'FAILED'); launch(env, 'W0-02', 'FAILED')
    assert 'W0-01' in stop(env) and 'W0-02' not in stop(env).split('Launch each')[0]  # W0-02 reached handback (3 launches)


def test_release_c_every_owed_workflow_has_three_failed_admitted_launches(env):
    plan(env.proj, {'W0-01': 2}, maw=1)
    for _ in range(2): launch(env, 'W0-01', 'FAILED')
    assert (stop(env) or '').startswith('Owed now:')
    launch(env, 'W0-01', 'FAILED')
    assert stop(env) is None  # handback: not owed, alert written, Trevor decides
    alerts = json.loads((env.st / 'alerts.json').read_text())['alerts']
    assert any(a['state'] == 'WORKFLOW_HANDBACK' for a in alerts)


def test_failures_in_another_session_do_not_release(env):
    plan(env.proj, {'W0-01': 2}); launch(env, 'W0-01', 'FAILED', sid='other'); launch(env, 'W0-01', 'FAILED', sid='other')
    assert (stop(env, 's1') or '').startswith('Owed now:')


def test_handback_after_three_launches(env):
    plan(env.proj, {'W0-01': 2, 'W0-02': 2})
    for _ in range(3): launch(env, 'W0-01', 'COMPLETED')
    r = stop(env); assert r.startswith('Owed now: W0-02') and 'W0-01' not in r
    alerts = json.loads((env.st / 'alerts.json').read_text())['alerts']
    assert any(a['state'] == 'WORKFLOW_HANDBACK' and a['workflow'] == 'W0-01' for a in alerts)
    st._verdict(env.proj, 'W0-02', 'PASS', attempt='A2'); admit(env, 'W0-02', 'A2')
    assert stop(env).startswith('Owed now: W0-02')  # no journal record for the file: not done
    st._journal_verdicts(env.st, env.proj, 'W0-02')
    assert stop(env) is None  # only the handback remains: not owed


def test_no_plan_allows(env):
    assert stop(env) is None


def test_plan_not_armed_allows(env):
    plan(env.proj, status='planned-not-running'); assert stop(env) is None


def test_plan_armed_by_the_first_admitted_launch(env):
    # single arming definition: only status "running" arms; guard.admit_launch flips planned-not-running -> running
    p = plan(env.proj, {'W0-01': 2, 'W0-02': 2}, status='planned-not-running', maw=2)
    assert stop(env) is None
    row = ('L1', 's1', '', time.time(), 'h', 'VALIDATED', 'n', 8, '')
    assert guard.admit_launch(row, ('W0-01', str(p.resolve()), 'A1')) is None
    assert json.loads(p.read_text())['status'] == 'planned-not-running'  # phase one only reserves; nothing is armed yet
    assert stop(env) is None
    guard.confirm_launch(guard.read_rows("SELECT * FROM launches WHERE id='L1'")[0])  # phase two (PostToolUse)
    assert json.loads(p.read_text())['status'] == 'running'
    assert stop(env).startswith('Owed now: W0-02')
    # Rule change (final pass): a plan with a CONFIRMED launch of this session is re-armed at Stop if its status was reverted out of band
    d = json.loads(p.read_text()); d['status'] = 'planned-not-running'; p.write_text(json.dumps(d))
    assert stop(env).startswith('Owed now: W0-02')
    assert json.loads(p.read_text())['status'] == 'running'


def test_armed_invalid_plan_blocks_stop_and_lists_errors(env, capsys):
    p = plan(env.proj); d = json.loads(p.read_text()); d['policy']['max_active_workflows'] = 99; p.write_text(json.dumps(d))
    r = stop(env)
    assert r and 'INVALID' in r and 'policy.max_active_workflows' in r
    assert guard.hook({'hook_event_name': 'Stop', 'session_id': 's1', 'cwd': str(env.proj)}) == 0
    assert json.loads(capsys.readouterr().out)['decision'] == 'block'
    human_prompt(); (env.qg / 's1.json').write_text(json.dumps({'mode': 'question', 'at': int(time.time())}))
    assert stop(env) is None  # a question-only HUMAN turn still releases
    (env.qg / 's1.json').unlink()
    guard.write_txn([("INSERT OR REPLACE INTO continuations VALUES('s1',0,1,0)", None)])
    assert guard.hook({'hook_event_name': 'Stop', 'session_id': 's1', 'cwd': str(env.proj)}) == 0 and capsys.readouterr().out == ''  # Trevor's pause releases


def test_unarmed_invalid_plan_does_not_trap_the_stop(env):
    p = plan(env.proj, status='planned-not-running'); d = json.loads(p.read_text()); d['policy']['max_active_workflows'] = 99; p.write_text(json.dumps(d))
    assert stop(env) is None


def test_valid_plan_status_running_zero_launches_blocks_with_owed_list(env):
    plan(env.proj, status='running')
    r = stop(env); assert r.startswith('Owed now: W0-01 (8 agents), W0-02 (6 agents).')


def test_status_active_does_not_arm_and_is_invalid(env):
    p = plan(env.proj, status='active')
    assert st.validate_plan(json.loads(p.read_text())) and stop(env) is None


def test_armed_plan_pins_to_session_after_cwd_moves(env):
    plan(env.proj)
    assert (stop(env) or '').startswith('Owed now:')  # recorded against s1 while the cwd is the project
    assert 'W0-01' in stop(env, cwd=env.away)
    assert stop(env, sid='s2', cwd=env.away) is None  # another session never entered the plan


def test_exception_fails_open(env, monkeypatch):
    plan(env.proj); monkeypatch.setattr(guard, 'plan_snapshot', lambda d, s: 1 / 0)
    assert guard.hook({'hook_event_name': 'Stop', 'session_id': 's1', 'cwd': str(env.proj)}) == 0


def ctx(capsys):
    out = capsys.readouterr().out
    return json.loads(out)['hookSpecificOutput']['additionalContext'] if out.strip() else ''


def test_reminder_lines_armed_plan(env, capsys):
    p = plan(env.proj)
    for ev in ('SessionStart', 'UserPromptSubmit'):
        guard.hook({'hook_event_name': ev, 'session_id': 's1', 'cwd': str(env.proj), 'prompt': 'hello', 'source': 'user'})
        t = ctx(capsys)
        assert 'Plan %s: owed now: W0-01 (8 agents), W0-02 (6 agents); running 0/50.' % p.resolve() in t
        assert 'every workflow runs 10 agents' not in t and 'Required: every workflow' not in t


def test_reminder_lines_without_plan(env, capsys):
    for ev in ('SessionStart', 'UserPromptSubmit'):
        guard.hook({'hook_event_name': ev, 'session_id': 's1', 'cwd': str(env.proj), 'prompt': 'hello', 'source': 'user'})
        t = ctx(capsys)
        assert "Ceilings: 50 workflows / 10 agents per workflow / 500 agents; a plan's own numbers govern when present." in t
        assert 'every workflow runs' not in t


def test_unarmed_plan_gets_the_not_started_line(env, capsys):
    p = plan(env.proj, status='planned-not-running')
    for ev in ('SessionStart', 'UserPromptSubmit'):
        guard.hook({'hook_event_name': ev, 'session_id': 's1', 'cwd': str(env.proj), 'prompt': 'hi', 'source': 'user'})
        t = ctx(capsys)
        assert 'Plan %s found, not started. Start the build with: python3 ~/.claude/hooks/workflow-guard/staffing.py start --cwd %s' % (p.resolve(), p.resolve().parent) in t


def test_start_cli_validates_then_arms(env, capsys):
    p = plan(env.proj, status='planned-not-running')
    assert st.cmd_start(env.proj) == 0 and json.loads(p.read_text())['status'] == 'running'
    assert (stop(env) or '').startswith('Owed now:')  # armed now: owed workflows block the Stop
    bad = json.loads(p.read_text()); bad['status'] = 'planned-not-running'; bad['policy']['max_active_workflows'] = 99; p.write_text(json.dumps(bad))
    capsys.readouterr()
    assert st.cmd_start(env.proj) == 1 and json.loads(p.read_text())['status'] == 'planned-not-running'  # an invalid plan is not started
    out = capsys.readouterr().out
    assert 'INVALID, not started' in out and 'policy.max_active_workflows must be an integer 1..50' in out
