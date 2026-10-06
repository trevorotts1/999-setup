"""Final fix pass on guard.py: two-phase admission (reserve in PreToolUse, confirm in PostToolUse), agent_id-only subagent
detection, arming before admission, subagent write fences, run-journal protection, one script read, run-id-bound verdict credit,
the plan Agent/Task rule, no count-based release, human-only question-only, anchored staffing.py allowance, PostToolUse verdict
journaling, and no lease release for armed plans. Every test runs on a TEMP state dir and temp plans; the real guard.sqlite3 is
never touched and no real Workflow is launched."""
import hashlib, importlib.util, json, os, sqlite3, time
from pathlib import Path
import pytest
from test_enforcement_v22 import Env, Attested, ROOT, st, mk_run_files


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


def age(env, seconds):
    c = sqlite3.connect(env.sd / 'guard.sqlite3')
    c.execute('UPDATE launches SET created=created-?', (seconds,)); c.execute('UPDATE reservations SET created=created-?', (seconds,)); c.commit(); c.close()


def load_guard(env, monkeypatch=None):
    os.environ['WORKFLOW_GUARD_STATE'] = str(env.sd)
    spec = importlib.util.spec_from_file_location('guard_final', ROOT / 'guard.py'); g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
    g.STATE = env.sd; g.LIMITS_FILE = env.sd / 'limits.json'; g.QG_STATE = env.qg
    return g


# ---------------------------------------------------------------- 1: two-phase admission
def test_refused_by_another_hook_leaves_nothing_live_and_stays_owed(env):
    """A19d: the guard admits, dispatch-gate refuses, so no PostToolUse ever arrives."""
    st._mkplan(env.proj, {'W0-01': 2, 'W0-02': 2}, status='running')
    assert env.launch('W0-01', 'a1', confirm=False)[0] == 0
    # reservation counts while it lives: the same workflow cannot be launched twice
    rc, out = env.launch('W0-01', 'a2', confirm=False)
    assert rc == 2 and 'already running' in out, out
    # ...but it is not admitted: no tag, no attempt id, no pin, no handback count
    assert env.q('SELECT COUNT(*) FROM launch_tags')[0][0] == 0 and env.q('SELECT COUNT(*) FROM attempt_ids')[0][0] == 0
    s = env.snap()
    assert s['state']['running'] == [] and s['view']['launches'] == {} and s['state']['handback'] == []
    age(env, 300)  # TTL (120 s) lapses
    assert 'W0-01' in env.stop()  # still owed
    rc, out = env.launch('W0-01', 'a3', confirm=False)
    assert rc == 0, out  # relaunch allowed
    assert env.q("SELECT COUNT(*) FROM launches WHERE state='UNCONFIRMED'")[0][0] == 1


def test_three_refused_launches_never_hand_the_workflow_back(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    for i in range(4):
        assert env.launch('W0-01', 'r%d' % i, confirm=False)[0] == 0
        age(env, 300)
    s = env.snap()
    assert s['state']['handback'] == [] and 'W0-01' in s['state']['owed'] and 'W0-01' in env.stop()


def test_post_tool_use_failure_drops_the_reservation_at_once(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    assert env.launch('W0-01', 'f1', confirm=False)[0] == 0
    env.post('Workflow', {}, tuid='L-f1', event='PostToolUseFailure', response='boom')
    assert env.q('SELECT COUNT(*) FROM launches')[0][0] == 0 and env.q('SELECT COUNT(*) FROM reservations')[0][0] == 0
    assert env.launch('W0-01', 'f2', confirm=False)[0] == 0  # relaunch allowed immediately


def test_confirm_admits_tags_attempt_pin_and_counts_toward_handback(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='planned-not-running')
    assert env.launch('W0-01', 'c1', confirm=False)[0] == 0
    assert json.loads((env.proj / 'SWARM-PLAN.json').read_text())['status'] == 'planned-not-running'  # PreToolUse arms nothing
    env.confirm('L-c1')
    assert json.loads((env.proj / 'SWARM-PLAN.json').read_text())['status'] == 'running'
    assert env.q('SELECT workflow_id FROM launch_tags') == [('W0-01',)] and env.q('SELECT attempt_id FROM attempt_ids') == [('c1',)]
    assert env.q("SELECT COUNT(*) FROM session_pins WHERE session='S1'")[0][0] == 1 and env.q('SELECT COUNT(*) FROM reservations')[0][0] == 0
    assert env.q("SELECT state FROM launches WHERE id='L-c1'") == [('RETURNED',)]
    for i in (2, 3):
        c = sqlite3.connect(env.sd / 'guard.sqlite3'); c.execute("UPDATE launches SET state='COMPLETED'"); c.commit(); c.close()
        assert env.launch('W0-01', 'c%d' % i)[0] == 0
    c = sqlite3.connect(env.sd / 'guard.sqlite3'); c.execute("UPDATE launches SET state='COMPLETED'"); c.commit(); c.close()
    assert env.snap()['state']['handback'] == ['W0-01']


def test_late_confirm_after_ttl_still_admits_a_launch_that_really_ran(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    assert env.launch('W0-01', 'late', confirm=False)[0] == 0
    age(env, 500)  # slow permission prompt
    env.confirm('L-late')
    assert env.q('SELECT workflow_id FROM launch_tags') == [('W0-01',)] and env.q("SELECT state FROM launches WHERE id='L-late'") == [('RETURNED',)]


def test_reservations_count_toward_the_operator_caps(env):
    (env.sd / 'limits.json').write_text(json.dumps({'concurrent_workflows_per_program': 1}))
    st._mkplan(env.proj, {'W0-01': 2, 'W0-02': 2}, status='running')
    assert env.launch('W0-01', 'k1', confirm=False)[0] == 0
    rc, out = env.launch('W0-02', 'k2', confirm=False)
    assert rc == 2 and 'already running 1 workflows' in out, out


# ---------------------------------------------------------------- 4: never admitted on an unarmed plan
def test_launch_refused_when_the_plan_cannot_be_armed(env):
    if os.geteuid() == 0:
        pytest.skip('root ignores directory permissions')
    p = st._mkplan(env.proj, {'W0-01': 2}, status='planned-not-running')
    g = env.gen('W0-01')
    os.chmod(env.proj, 0o555)
    try:
        a = dict(g['args']); a['attemptId'] = 'ro1'
        rc, out = env.pre('Workflow', {'scriptPath': g['scriptPath'], 'args': a}, tuid='ro1')
    finally:
        os.chmod(env.proj, 0o755)
    assert rc == 2 and 'cannot be armed' in out, out
    assert env.q('SELECT COUNT(*) FROM launches')[0][0] == 0


def test_flip_failure_at_confirm_never_tags_the_launch(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='planned-not-running')
    assert env.launch('W0-01', 'z1', confirm=False)[0] == 0
    d = json.loads((env.proj / 'SWARM-PLAN.json').read_text()); d['status'] = 'planned'  # unflippable by set_running
    (env.proj / 'SWARM-PLAN.json').write_text(json.dumps(d))
    env.confirm('L-z1')
    assert env.q('SELECT COUNT(*) FROM launch_tags')[0][0] == 0 and env.q('SELECT COUNT(*) FROM attempt_ids')[0][0] == 0
    assert env.q("SELECT state FROM plan_alerts") == [('PLAN_ARM_FAILED',)]


# ---------------------------------------------------------------- 3: agent_id ONLY
def test_agent_type_alone_is_not_a_subagent(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    for tool, ti in (('Write', {'file_path': str(env.sd / 'limits.json'), 'content': '{}'}),
                     ('Write', {'file_path': str(env.proj / 'SWARM-PLAN.json'), 'content': '{}'}),
                     ('Bash', {'command': "sqlite3 %s/guard.sqlite3 'delete from launches'" % env.sd})):
        rc, out = env.pre(tool, ti, agent_type='general-purpose')
        assert rc == 2 and 'governed session may not' in out or 'governs the session' in out, (tool, out)


# ---------------------------------------------------------------- 2 + 7: subagent write fences, run journals
def test_subagent_refused_guard_state_plan_limits_cache_and_journals(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    journal = env.tmp / 'main' / 'subagents' / 'workflows' / 'wf_x' / 'journal.jsonl'
    paths = [env.sd / 'guard.sqlite3', env.sd / 'limits.json', env.sd / 'capacity-probe-cache.json', env.qg / 'S1.json', env.proj / 'SWARM-PLAN.json',
             env.tmp / 'elsewhere' / 'SWARM-PLAN.json', journal]
    for pth in paths:
        for tool in ('Write', 'Edit', 'MultiEdit', 'NotebookEdit'):
            ti = {'notebook_path': str(pth), 'new_source': 'x'} if tool == 'NotebookEdit' else {'file_path': str(pth), 'content': 'x', 'old_string': 'a', 'new_string': 'b'}
            rc, out = env.pre(tool, ti, agent_id='sub1', agent_type='general-purpose')
            assert rc == 2 and 'subagent may not' in out.lower(), (tool, pth, out)
    for cmd in ("sqlite3 %s/guard.sqlite3 'update launches set state=1'" % env.sd, "sed -i '' s/running/planned/ %s" % (env.proj / 'SWARM-PLAN.json'),
                "echo '{}' > %s" % (env.sd / 'limits.json'), "echo x >> %s" % (env.sd / 'capacity-probe-cache.json'), "echo x > %s" % journal,
                "rm -rf %s" % journal.parent):
        rc, out = env.pre('Bash', {'command': cmd}, agent_id='sub1')
        assert rc == 2 and 'subagent may not' in out.lower(), (cmd, out)
    for ok in ('ls %s' % env.sd, 'cat %s' % (env.proj / 'SWARM-PLAN.json'), 'echo hi > %s' % (env.proj / 'out.txt')):
        assert env.pre('Bash', {'command': ok}, agent_id='sub1')[0] == 0, ok


def test_main_session_cannot_forge_a_run_journal(env):
    journal = env.tmp / 'main' / 'subagents' / 'workflows' / 'wf_x' / 'journal.jsonl'
    rc, out = env.pre('Write', {'file_path': str(journal), 'content': '{}'})
    assert rc == 2 and 'run journal' in out, out
    rc, out = env.pre('Bash', {'command': "echo '{}' >> %s" % journal})
    assert rc == 2 and 'governs the session' in out, out
    assert env.pre('Bash', {'command': 'cat %s' % journal})[0] == 0


def test_run_finishes_only_by_its_own_run_id_never_a_sibling_journal(env):
    g = load_guard(env)
    t = env.tmp / 'main.jsonl'
    sib = env.tmp / 'main' / 'subagents' / 'workflows' / 'wf_sibling' / 'journal.jsonl'
    c = g.db()
    c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', ('norun', 'S1', str(t), time.time(), 'h', 'LAUNCH_UNVERIFIED', 'n', 2, ''))
    c.execute('INSERT INTO watches VALUES(?,?,?,?,?,?)', (str(sib), 'S1', time.time(), '', 'AGENTS_RETURNED', ''))
    c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', ('hasrun', 'S1', str(t), time.time(), 'h', 'RETURNED', 'n', 2, '{"run_id": "wf_sibling"}'))
    c.commit()
    assert g.reap_finished(c) == 1  # only the launch whose run id matches the journal
    c.commit()
    assert dict(c.execute('SELECT id,state FROM launches').fetchall()) == {'norun': 'LAUNCH_UNVERIFIED', 'hasrun': 'COMPLETED'}
    c.close()


# ---------------------------------------------------------------- 2 + 9 + 14: verdicts
def test_subagent_verdict_only_by_write_only_verdict_json_only_by_run_member_recorded_in_post_with_sha(env):
    a = Attested(env)
    ti = {'file_path': str(a.vf), 'content': a.body}
    kw = dict(agent_id='AGENTX1', agent_type='general-purpose')
    rc, out = env.pre('Write', ti, **kw)
    assert rc == 0, out
    assert env.q('SELECT COUNT(*) FROM verdict_records')[0][0] == 0, 'PreToolUse must not journal: the write has not happened'
    env.post('Write', ti, **kw)
    assert env.q('SELECT sha256 FROM verdict_records') == [(hashlib.sha256(a.body.encode()).hexdigest(),)]
    ev = env.proj / 'evidence' / 'W0-01'
    rc, out = env.pre('Write', {'file_path': str(ev / 'notes.md'), 'content': 'x'}, **kw)
    assert rc == 2 and 'only *.verdict.json' in out, out
    rc, out = env.pre('Edit', {'file_path': str(a.vf), 'old_string': 'a', 'new_string': 'b'}, **kw)
    assert rc == 2 and 'Write tool' in out, out
    rc, out = env.pre('Bash', {'command': "echo '{}' > %s" % a.vf}, **kw)
    assert rc == 2, out
    rc, out = env.pre('Write', ti, agent_id='NOTINRUN', agent_type='general-purpose')
    assert rc == 2 and 'not part of the admitted run' in out, out


def test_run_membership_needs_the_launchs_own_run_id(env):
    g = load_guard(env)
    t = env.tmp / 'main.jsonl'
    other = env.tmp / 'main' / 'subagents' / 'workflows' / 'wf_other'
    mk_run_files(other, [('W0-02-U1', 'W2AGENT')])
    assert g._agent_in_run(str(t), '{"run_id": "wf_other"}', 'W2AGENT') is True
    assert g._agent_in_run(str(t), '{"run_id": "wf_mine"}', 'W2AGENT') is False  # another workflow's run
    assert g._agent_in_run(str(t), '', 'W2AGENT') is False  # no run id: nobody is credited
    assert g._agent_in_run(str(t), '{"run_id": "../x"}', 'W2AGENT') is False


# ---------------------------------------------------------------- 8: one read of the script
def test_script_is_read_once_and_every_check_uses_that_copy(env, monkeypatch):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    gen = env.gen('W0-01')
    sp = Path(gen['scriptPath']); good = sp.read_text()
    g = load_guard(env)
    orig = Path.read_text; n = {'k': 0}

    def rt(self, *a, **kw):
        if str(self) == str(sp):
            n['k'] += 1
            return good if n['k'] == 1 else good.replace('model', 'modxl')  # any later read would see different bytes
        return orig(self, *a, **kw)
    monkeypatch.setattr(Path, 'read_text', rt)
    seen = {}
    real = g._staffing().check_launch

    def spy(ti, *a, **kw):
        seen['script'] = ti.get('script'); return real(ti, *a, **kw)
    monkeypatch.setattr(g._staffing(), 'check_launch', spy)
    args = dict(gen['args']); args['attemptId'] = 'once'
    data = {'hook_event_name': 'PreToolUse', 'tool_name': 'Workflow', 'tool_input': {'scriptPath': str(sp), 'args': args}, 'cwd': str(env.proj), 'session_id': 'S1', 'tool_use_id': 'once', 'transcript_path': ''}
    g.hook(data)
    assert n['k'] == 1 and seen['script'] == good


# ---------------------------------------------------------------- 10: plan Agent/Task rule inside the guard
@pytest.mark.parametrize('tool', ['Agent', 'Task'])
def test_plan_agent_rule(env, tool):
    ti = lambda prompt, kind, desc='scan': {'description': desc, 'prompt': prompt, 'subagent_type': kind}
    noplan = env.tmp / 'noplan'; noplan.mkdir()
    assert env.pre(tool, ti('build the thing', 'general-purpose'), cwd=noplan)[0] == 0  # no plan: untouched
    st._mkplan(env.proj, {'W0-01': 2}, status='planned-not-running')  # found (not even armed)
    rc, out = env.pre(tool, ti('read the files and summarize', 'general-purpose'))
    assert rc == 2 and 'HIDDEN BUILD' in out, out
    assert env.pre(tool, ti('list the files in src and summarize', 'Explore'))[0] == 0
    assert env.pre(tool, ti('Explore the repo, then write the code for unit 1', 'Explore'))[0] == 2
    assert env.pre(tool, ti('read guard.sqlite3 and tell me what is in it', 'Explore'))[0] == 2  # names a guard-owned file
    assert env.pre(tool, ti('wr1te it', 'Plan'))[0] in (0, 2)  # (obfuscation is dispatch-gate's normalisation job; no crash)
    assert env.pre(tool, ti('read src', 'Explore'), agent_id='sub1')[0] == 0


def test_plan_agent_rule_fails_closed_on_error(env, monkeypatch):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    g = load_guard(env)
    monkeypatch.setattr(g, 'plan_agent_allowed', lambda ti: 1 / 0)
    assert g.plan_agent_block({'cwd': str(env.proj), 'session_id': 'S1', 'tool_input': {'prompt': 'read'}}, 'S1') == 2


# ---------------------------------------------------------------- 11: no count-based release
def test_no_release_c_even_when_every_owed_workflow_failed_three_times(env):
    st._mkplan(env.proj, {'W0-01': 2, 'W0-02': 2}, status='running', maw=1)
    g = load_guard(env)
    c = g.db()
    for i in range(3):
        c.execute("INSERT INTO launches VALUES(?,?,'',?,'h','FAILED','n',2,'')", ('f%d' % i, 'S1', time.time()))
        c.execute('INSERT INTO launch_tags VALUES(?,?,?,?,?)', ('f%d' % i, 'S1', 'W0-01', str((env.proj / 'SWARM-PLAN.json').resolve()), time.time()))
    c.commit(); c.close()
    r = env.stop()
    assert r and 'W0-02' in r  # W0-01 is handed back, W0-02 stays owed: the Stop is never released by a failure count
    assert env.q("SELECT state FROM plan_alerts WHERE key LIKE '%HANDBACK'") == [('WORKFLOW_HANDBACK',)]


# ---------------------------------------------------------------- 12: question-only needs a human prompt
def test_question_only_ignores_machine_prompts(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    (env.qg / 'S1.json').write_text(json.dumps({'mode': 'question', 'at': int(time.time())}))
    assert env.stop() is not None  # no human prompt on record: the state came from a machine message
    env.hook({'hook_event_name': 'UserPromptSubmit', 'session_id': 'S1', 'cwd': str(env.proj), 'prompt': 'agent report', 'source': 'poll_event'})
    assert env.stop() is not None
    env.prompt('what is the status?')
    assert env.stop() is None


# ---------------------------------------------------------------- 13: anchored staffing.py
def test_staffing_allowance_is_anchored_to_this_guards_staffing_py(env, monkeypatch):
    g = load_guard(env)
    monkeypatch.chdir(env.tmp)  # a relative staffing.py resolves against the command's cwd: a lookalike here is not ours
    assert g._staffing_ok('python3 %s start --cwd /x' % (ROOT / 'staffing.py'))
    assert g._staffing_ok('/opt/homebrew/bin/python3 %s status --cwd /x 2>&1' % (ROOT / 'staffing.py'))
    assert not g._staffing_ok('python3 /tmp/evil/staffing.py start')
    assert not g._staffing_ok('python3 ./staffing.py start')
    assert not g._staffing_ok('python3 %s start; rm x' % (ROOT / 'staffing.py'))
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    rc, out = env.pre('Bash', {'command': 'python3 /tmp/evil/staffing.py start > %s' % (env.proj / 'SWARM-PLAN.json')})
    assert rc == 2


# ---------------------------------------------------------------- lease: armed plan pins are never silently released
def test_silent_session_with_an_armed_plan_pin_is_not_reaped(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    g = load_guard(env)
    plan = str((env.proj / 'SWARM-PLAN.json').resolve())
    old = time.time() - 100000
    c = g.db()
    for sid in ('pinned', 'plain'):
        c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', ('l-' + sid, sid, '', old, 'h', 'RETURNED', 'n', 2, ''))
        c.execute('INSERT INTO session_liveness VALUES(?,?)', (sid, old))
    c.execute('INSERT INTO session_pins VALUES(?,?,?)', ('pinned', plan, old))
    c.commit()
    g.reap_dead(c)
    assert dict(c.execute('SELECT id,state FROM launches').fetchall()) == {'l-pinned': 'RETURNED', 'l-plain': 'REAPED'}
    c.close()
