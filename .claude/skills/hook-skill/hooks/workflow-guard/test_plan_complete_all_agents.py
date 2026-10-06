"""Regression: a plan-tagged run is COMPLETED only when results exist for EVERY expected agent (builder + checker per
launched unit). pipeline(units,build,qc) starts a unit's checker after its builder returns, so there is an instant where
pending==0 and results>0 while the run is still going; that must not release the launch."""
import json, time
import pytest
import test_returned_run_live as base
from test_returned_run_live import guard, st, env, j, SID, RESPONSE  # noqa: F401
from pathlib import Path


def _launch(env, capsys, units, wid='W3-04'):
    plan = str(Path(st._mkplan(env.proj, {wid: units}, status='running', maw=1)).resolve())
    run_dir = env.tmp / 's' / SID / 'subagents' / 'workflows' / 'wf_cmp-1'; run_dir.mkdir(parents=True)
    now = time.time(); c = guard.db()
    c.execute("INSERT INTO launches VALUES('tu1',?,?,?,'h','RESERVED','n',?,'')", (SID, str(env.tmp / 's' / (SID + '.jsonl')), now, units))
    c.execute("INSERT INTO reservations VALUES('tu1',?,?,?,'A-1',?)", (SID, plan, wid, now))
    if units: c.execute("INSERT INTO launch_units VALUES('tu1',?)", (units,))
    c.commit(); c.close()
    guard.hook({'hook_event_name': 'PostToolUse', 'tool_name': 'Workflow', 'session_id': SID, 'tool_use_id': 'tu1',
                'cwd': str(env.proj), 'tool_response': RESPONSE.replace('wf_15f2b116-4f7', 'wf_cmp-1') % run_dir})
    capsys.readouterr()
    return run_dir / 'journal.jsonl'


def _state():
    c = guard.db(); s = c.execute("SELECT state FROM launches WHERE id='tu1'").fetchone()[0]; c.close(); return s


def _tick(): guard.tick(time.time()); guard.reap_now()


def _ev(kind, *keys): return [{'type': kind, 'key': k} for k in keys]


def test_one_unit_builder_returned_checker_not_started(env, capsys):
    jr = _launch(env, capsys, 1)
    j(jr, *_ev('started', 'b'), *_ev('result', 'b'))
    _tick(); _tick()
    assert _state() == 'RETURNED'
    assert guard.stop_omission({'cwd': str(env.proj), 'session_id': SID}, SID) is None
    guard.hook({'hook_event_name': 'Stop', 'session_id': SID, 'cwd': str(env.proj)})
    assert '"decision": "block"' not in capsys.readouterr().out
    j(jr, *_ev('started', 'b', 'q'), *_ev('result', 'b', 'q'))
    _tick(); _tick()
    assert _state() == 'COMPLETED'


def test_three_units_partial_stays_running(env, capsys):
    jr = _launch(env, capsys, 3)
    j(jr, *_ev('started', 'b1', 'b2', 'b3', 'q1', 'q2'), *_ev('result', 'b1', 'b2', 'b3', 'q1', 'q2'))
    _tick()
    assert _state() == 'RETURNED'
    j(jr, *_ev('started', 'b1', 'b2', 'b3', 'q1', 'q2', 'q3'), *_ev('result', 'b1', 'b2', 'b3', 'q1', 'q2', 'q3'))
    _tick(); _tick()
    assert _state() == 'COMPLETED'


def test_legacy_launch_unchanged(env, capsys):
    jr = _launch(env, capsys, 0)  # no units recorded: old rule
    j(jr, *_ev('started', 'b'), *_ev('result', 'b'))
    _tick(); _tick()
    assert _state() == 'COMPLETED'
