"""Guard-level enforcement: refused launches are never journaled, attempt ids, per-workflow cap, verdict-write blocking.
Every test runs on a temp state dir and temp plan; the real guard.sqlite3 is never touched."""
import importlib.util, json, os, subprocess, tempfile, time
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parent
_boot = tempfile.mkdtemp(prefix='wg-enf-boot-')
os.environ['WORKFLOW_GUARD_STATE'] = _boot
spec = importlib.util.spec_from_file_location('guard_enf', ROOT / 'guard.py')
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
st = guard._staffing()


@pytest.fixture
def env(tmp_path, monkeypatch):
    sd = tmp_path / 'state'; sd.mkdir(); qg = tmp_path / 'qg'; qg.mkdir()
    (sd / 'limits.json').write_text(json.dumps({'concurrent_agents_per_workflow': 10, 'concurrent_workflows_per_program': 50, 'concurrent_agents_total': 500, 'session_lease_seconds': 3600}))
    monkeypatch.setattr(guard, 'STATE', sd); monkeypatch.setattr(guard, 'LIMITS_FILE', sd / 'limits.json'); monkeypatch.setattr(guard, 'QG_STATE', qg)
    monkeypatch.setenv('WORKFLOW_GUARD_STATE', str(sd))
    proj = tmp_path / 'proj'; proj.mkdir()
    return type('E', (), {'sd': sd, 'proj': proj, 'tmp': tmp_path})


def gen(e, specs, wid, cap=10):
    st._mkplan(e.proj, specs, status='running', cap=cap)
    out = e.tmp / 'gen'
    r = subprocess.run(['python3', str(ROOT / 'make-workflow.py'), '--plan', str(e.proj / 'SWARM-PLAN.json'), '--workflow-id', wid, '--out-dir', str(out)],
                       capture_output=True, text=True, env={**os.environ, 'WORKFLOW_GUARD_STATE': str(e.sd)})
    assert r.returncode == 0, r.stderr
    return json.loads((out / ('launch-%s.json' % wid)).read_text())


def hook(e, ti, tuid, sid='s1', tool='Workflow', **extra):
    return guard.hook({'hook_event_name': 'PreToolUse', 'tool_name': tool, 'tool_input': ti, 'cwd': str(e.proj), 'session_id': sid, 'tool_use_id': tuid, 'transcript_path': '', **extra})


def rows(e, table):
    c = guard.db()
    try:
        return c.execute('SELECT * FROM %s' % table).fetchall()
    finally:
        c.close()


def test_refused_launch_records_nothing_then_correct_relaunch_is_admitted(env, capsys):
    L = gen(env, {'W0-01': 3, 'W0-02': 2}, 'W0-01')
    bad = {'scriptPath': L['scriptPath'], 'args': dict(L['args'], units=L['args']['units'][:2])}
    assert hook(env, bad, 'bad1') == 2
    assert 'plans exactly 3' in capsys.readouterr().err
    assert rows(env, 'launches') == [] and rows(env, 'launch_tags') == [] and rows(env, 'attempt_ids') == []
    assert hook(env, dict(L), 'good1') == 0
    assert len(rows(env, 'launches')) == 1 and [r['workflow_id'] for r in rows(env, 'launch_tags')] == ['W0-01']
    assert [r['attempt_id'] for r in rows(env, 'attempt_ids')] == [L['args']['attemptId']]
    snap = st.snapshot(str(env.proj), env.sd, 's1', reap=False)
    assert snap['view']['launches'] == {'W0-01': 1} and snap['state']['owed'] == ['W0-02']
    # the same attemptId cannot be admitted twice
    guard.write_txn([("UPDATE launches SET state='COMPLETED'", None)])
    assert hook(env, dict(L), 'again') == 2
    assert 'attemptId' in capsys.readouterr().err and len(rows(env, 'launches')) == 1


def test_launch_without_attempt_id_is_refused(env, capsys):
    L = gen(env, {'W0-01': 3}, 'W0-01'); a = dict(L['args']); a.pop('attemptId')
    assert hook(env, {'scriptPath': L['scriptPath'], 'args': a}, 'x') == 2 and rows(env, 'launch_tags') == []
    assert 'args.attemptId is missing' in capsys.readouterr().err


def test_cap_6_with_8_units_window_6_admitted_peak_6_and_no_window_refused(env, capsys):
    L = gen(env, {'W6-01': 8}, 'W6-01', cap=6)
    script = Path(L['scriptPath']).read_text()
    assert 'const WG_WINDOW = 6;' in script
    assert hook(env, dict(L), 'w6') == 0
    assert [r['peak'] for r in rows(env, 'launches')] == [6]
    bare = script.replace('wgSlot(() => agent(', 'agent(').replace('})),', '}),').replace('}));', '});')
    bare = bare.split('const WG_WINDOW', 1)[0] + bare[bare.index('const RESULT'):]
    guard.write_txn([('DELETE FROM launches', None), ('DELETE FROM launch_tags', None), ('DELETE FROM attempt_ids', None)])
    capsys.readouterr()
    assert hook(env, {'script': bare, 'args': dict(L['args'], attemptId='other-1')}, 'w6b') == 2
    err = capsys.readouterr().err
    assert 'per-workflow cap of 6' in err and 'make-workflow.py' in err and rows(env, 'launches') == []


def test_limits_json_narrows_the_cap_the_script_may_use(env, capsys):
    L = gen(env, {'W0-01': 8}, 'W0-01', cap=10)  # window helper absent: 8 <= 10
    assert 'WG_WINDOW' not in Path(L['scriptPath']).read_text()
    (env.sd / 'limits.json').write_text(json.dumps({'concurrent_agents_per_workflow': 5}))
    assert hook(env, dict(L), 'n1') == 2  # now 8 units exceed cap 5 with no window
    assert 'per-workflow cap of 5 agents' in capsys.readouterr().err


VERDICT = 'evidence/W0-01/W0-01-U1.verdict.json'


@pytest.mark.parametrize('tool,ti,rc', [
    ('Write', {'file_path': VERDICT, 'content': '{}'}, 2),
    ('Edit', {'file_path': VERDICT, 'old_string': 'a', 'new_string': 'b'}, 2),
    ('MultiEdit', {'file_path': VERDICT, 'edits': []}, 2),
    ('Write', {'file_path': 'out/W0-01/1.md', 'content': 'x'}, 0),
    ('Bash', {'command': "echo '{}' > " + VERDICT}, 2),
    ('Bash', {'command': "echo '{}' >> " + VERDICT}, 2),
    ('Bash', {'command': "echo '{}' | tee " + VERDICT}, 2),
    ('Bash', {'command': 'cp /tmp/x.json ' + VERDICT}, 2),
    ('Bash', {'command': 'mv /tmp/x.json ' + VERDICT}, 2),
    ('Bash', {'command': "python3 -c \"open('" + VERDICT + "','w').write('{}')\""}, 2),
    ('Bash', {'command': "python3 -c \"from pathlib import Path; Path('" + VERDICT + "').write_text('{}')\""}, 2),
    ('Bash', {'command': 'cat ' + VERDICT}, 0),
    ('Bash', {'command': 'ls evidence/W0-01/ 2>/dev/null'}, 0),
])
def test_main_session_cannot_write_verdict_files(env, tool, ti, rc, capsys):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    assert hook(env, ti, 'v', tool=tool) == rc
    err = capsys.readouterr().err
    assert ('may not write unit verdict files' in err) == (rc == 2), err


def test_subagent_may_write_verdict_files_and_main_session_is_refused_everywhere(env, capsys):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    assert hook(env, {'file_path': VERDICT, 'content': '{}'}, 'v', tool='Write', agent_id='a1', agent_type='general-purpose') == 0
    assert hook(env, {'command': "echo '{}' > " + VERDICT}, 'v2', tool='Bash', agent_id='a1') == 0
    capsys.readouterr()
    for tool in ('Edit', 'MultiEdit'):  # subagent edits are not journaled, so they are refused
        assert hook(env, {'file_path': VERDICT, 'content': '{}'}, 've' + tool, tool=tool, agent_id='a1') == 2
        assert 'Write unit verdicts with the Write tool' in capsys.readouterr().err
    (env.proj / 'SWARM-PLAN.json').unlink()  # defect 4: main-session refusal needs no plan, any case
    for path in (VERDICT, VERDICT.upper()):
        assert hook(env, {'file_path': path, 'content': '{}'}, 'v3', tool='Write') == 2
        assert 'The conductor session may not write unit verdict files' in capsys.readouterr().err
