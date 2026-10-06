"""Regression (live canary 2026-10-06): a PostToolUse-confirmed Workflow launch must stay RUNNING while the native run's
journal is in progress, matched by the Run ID and Transcript dir the tool itself reported (not a cwd-derived slug).
Before the fix tick() treated RETURNED (the state a confirmed, still-running launch holds) as terminal, resolved the
run's watch and released the launch as COMPLETED seconds in, so Stop demanded a relaunch of work already running."""
import importlib.util, json, os, tempfile, time
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parent
os.environ['WORKFLOW_GUARD_STATE'] = tempfile.mkdtemp(prefix='wg-rrl-boot-')
spec = importlib.util.spec_from_file_location('guard_rrl', ROOT / 'guard.py')
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
st = guard._staffing()
LIM = {'concurrent_agents_per_workflow': 10, 'concurrent_workflows_per_program': 50, 'concurrent_agents_total': 500, 'session_lease_seconds': 3600}
SID = 'sess-canary'
RESPONSE = ("Workflow launched in background. Task ID: w9lftj4lk\nSummary: CAN-01: 3 planned units\n"
            "Transcript dir: %s\nScript file: /x/workflows/scripts/s.js\nRun ID: wf_15f2b116-4f7\n")


def j(path, *events):
    path.write_text(''.join(json.dumps(e) + '\n' for e in events))


@pytest.fixture
def env(tmp_path, monkeypatch):
    sd = tmp_path / 'state'; sd.mkdir(); qg = tmp_path / 'qg'; qg.mkdir()
    (sd / 'limits.json').write_text(json.dumps(LIM))
    monkeypatch.setattr(guard, 'STATE', sd); monkeypatch.setattr(guard, 'LIMITS_FILE', sd / 'limits.json'); monkeypatch.setattr(guard, 'QG_STATE', qg)
    proj = tmp_path / 'proj'; proj.mkdir()
    return type('E', (), {'proj': proj, 'tmp': tmp_path})


def test_confirmed_launch_running_until_journal_completes(env, capsys):
    plan = st._mkplan(env.proj, {'CAN-01': 3}, status='running', maw=1)
    plan = str(Path(plan).resolve())
    # Launching transcript lives under one slug; the run's journal under the dir the tool reported (another slug).
    launch_tx = env.tmp / 'proj-launch-slug' / (SID + '.jsonl')
    run_dir = env.tmp / 'proj-start-slug' / SID / 'subagents' / 'workflows' / 'wf_15f2b116-4f7'
    run_dir.mkdir(parents=True)
    jr = run_dir / 'journal.jsonl'
    j(jr, {'type': 'started', 'key': 'a'}, {'type': 'started', 'key': 'b'}, {'type': 'started', 'key': 'c'})
    now = time.time()
    c = guard.db()
    c.execute("INSERT INTO launches VALUES('tu1',?,?,?,'h','RESERVED','n',3,'')", (SID, str(launch_tx), now))
    c.execute("INSERT INTO reservations VALUES('tu1',?,?,'CAN-01','CAN-01-1',?)", (SID, plan, now))
    c.commit(); c.close()
    guard.hook({'hook_event_name': 'PostToolUse', 'tool_name': 'Workflow', 'session_id': SID, 'tool_use_id': 'tu1',
                'cwd': str(env.proj), 'tool_response': RESPONSE % run_dir})
    capsys.readouterr()
    c = guard.db()
    rec = json.loads(c.execute("SELECT receipt FROM launches WHERE id='tu1'").fetchone()[0]); c.close()
    assert rec['run_id'] == 'wf_15f2b116-4f7' and rec['transcript_dir'] == str(run_dir)

    def state():
        c = guard.db(); try_ = c.execute("SELECT state FROM launches WHERE id='tu1'").fetchone()[0]; c.close(); return try_

    def running():
        c = guard.db()
        try:
            return st.journal_view(c, plan, ['CAN-01'])['running']
        finally:
            c.close()

    # In progress (3 started, 1 result): run several watchdog ticks plus the Stop path.
    j(jr, {'type': 'started', 'key': 'a'}, {'type': 'started', 'key': 'b'}, {'type': 'started', 'key': 'c'}, {'type': 'result', 'key': 'a'})
    for _ in range(3):
        guard.tick(time.time()); guard.reap_now()
    assert state() == 'RETURNED' and running() == {'CAN-01'}
    assert guard.stop_omission({'cwd': str(env.proj), 'session_id': SID}, SID) is None  # not owed: it is running
    guard.hook({'hook_event_name': 'Stop', 'session_id': SID, 'cwd': str(env.proj)})
    assert '"decision": "block"' not in capsys.readouterr().out

    # Completed: every agent has a result -> handled as finished.
    j(jr, *[{'type': 'started', 'key': k} for k in 'abc'], *[{'type': 'result', 'key': k} for k in 'abc'])
    guard.tick(time.time()); guard.reap_now()
    assert state() == 'COMPLETED' and running() == set()


def test_failed_launch_still_resolves_residue_watch(env):
    # The terminal states that DO resolve a watch are unchanged: CANCELLED and FAILED.
    run_dir = env.tmp / 'w' / 'wf_dead-1'; run_dir.mkdir(parents=True)
    jr = run_dir / 'journal.jsonl'; j(jr, {'type': 'started', 'key': 'a'})
    old = time.time() - 700; os.utime(jr, (old, old))
    c = guard.db()
    c.execute("INSERT INTO watches VALUES(?,?,?,?,'OBSERVING','')", (str(jr), 's', old, ''))
    c.execute("INSERT INTO launches VALUES('lf','s','',?,'h','FAILED','n',1,?)", (time.time(), json.dumps({'run_id': 'wf_dead-1'})))
    c.commit(); c.close()
    assert guard.tick(time.time()) == []
