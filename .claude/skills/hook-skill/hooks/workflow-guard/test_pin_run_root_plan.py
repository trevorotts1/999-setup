"""Regression (live 2026-10-06, W3-04): the plan was armed by `staffing.py start --cwd <plan dir>` (pins nothing) while the session's cwd
was elsewhere. A scriptPath-only launch was refused, the retry with full args was admitted with NO plan governing it, so it got no
launch_tags/attempt_ids row: its QC agents' verdict writes were refused ("not part of the admitted run") and the plan owed the
workflow forever. The launch must now be pinned to its RUN_ROOT plan, tagged, its agents allowed to write verdicts, and the plan done."""
import json, subprocess, sys
from pathlib import Path
from test_returned_run_live import guard, st, env, SID, RESPONSE  # noqa: F401

ROOT = Path(__file__).resolve().parent


def test_launch_with_full_args_after_refused_scriptpath_only_is_linked(env, capsys):
    plan = Path(st._mkplan(env.proj, {'W3-04': 2}, status='running', maw=1)).resolve()
    lane = env.tmp / 'lane'; elsewhere = env.tmp / 'elsewhere'; elsewhere.mkdir()
    subprocess.run([sys.executable, str(ROOT / 'make-workflow.py'), '--plan', str(plan), '--workflow-id', 'W3-04', '--out-dir', str(lane),
                    '--state-dir', str(guard.STATE)], check=True, capture_output=True)
    launch = json.loads((lane / 'launch-W3-04.json').read_text())
    base = {'hook_event_name': 'PreToolUse', 'tool_name': 'Workflow', 'session_id': SID, 'cwd': str(elsewhere),
            'transcript_path': str(env.tmp / 's' / (SID + '.jsonl'))}
    assert guard.hook({**base, 'tool_use_id': 'tu0', 'tool_input': {'scriptPath': launch['scriptPath']}}) == 2  # refused: no units
    assert guard.hook({**base, 'tool_use_id': 'tu1', 'tool_input': launch}) == 0
    run_dir = env.tmp / 's' / SID / 'subagents' / 'workflows' / 'wf_cmp-1'; run_dir.mkdir(parents=True)
    guard.hook({**base, 'hook_event_name': 'PostToolUse', 'tool_use_id': 'tu1', 'tool_input': launch,
                'tool_response': RESPONSE.replace('wf_15f2b116-4f7', 'wf_cmp-1') % run_dir})
    ev = []
    for unit, b, q in (('W3-04-U1', 'b1', 'q1'), ('W3-04-U2', 'b2', 'q2')):
        for aid, label, model in ((b, 'build:' + unit, 'opus'), (q, 'qc:' + unit, 'sonnet')):
            ev += [{'type': 'started', 'key': 'k' + aid, 'agentId': aid, 'label': label}, {'type': 'result', 'key': 'k' + aid, 'agentId': aid}]
            (run_dir / ('agent-%s.meta.json' % aid)).write_text(json.dumps({'model': model}))
    (run_dir / 'journal.jsonl').write_text(''.join(json.dumps(e, separators=(',', ':')) + '\n' for e in ev))
    c = guard.db()
    tag = c.execute("SELECT workflow_id,plan FROM launch_tags WHERE id='tu1'").fetchone(); c.close()
    assert tuple(tag) == ('W3-04', str(plan))
    for unit, q in (('W3-04-U1', 'q1'), ('W3-04-U2', 'q2')):
        vf = plan.parent / 'evidence' / 'W3-04' / (unit + '.verdict.json'); vf.parent.mkdir(parents=True, exist_ok=True)
        body = json.dumps({'verdict': 'PASS', 'unit_id': unit, 'attempt_id': launch['args']['attemptId'], 'builder_model': 'opus', 'reviewer_model': 'sonnet'})
        w = {**base, 'agent_id': q, 'tool_name': 'Write', 'tool_input': {'file_path': str(vf), 'content': body}}
        assert not guard.hook(w)  # a QC agent of the admitted run may write its verdict
        vf.write_text(body)
        guard.hook({**w, 'hook_event_name': 'PostToolUse'})
    snap = st.snapshot(str(elsewhere), guard.STATE, SID, reap=False, plan=(plan, json.loads(plan.read_text())))
    assert snap['state']['done'] == ['W3-04'] and snap['state']['owed'] == []


def test_launch_is_checked_against_the_plan_that_owns_its_workflow_id(env):
    """Live 2026-10-06: session governed by plan A (cwd / pin) launched W4-01 generated from a different, planned-not-running
    plan file (W4-SWARM-PLAN.json). dispatch-gate/guard bound the launch to plan A: "workflowId must equal a workflow_id of this
    plan". The RUN_ROOT plan that owns the id must govern; an id that NO plan owns must still be refused."""
    a = Path(st._mkplan(env.proj, {'C-01': 2}, status='running', maw=1)).resolve()  # governing plan A, owns only C-01
    d = env.tmp / 'swarm-plans'; d.mkdir()
    b = Path(st._mkplan(d, {'W4-01': 2}, status='planned-not-running', maw=1)).resolve()
    b = b.rename(d / 'W4-SWARM-PLAN.json')
    lane = env.tmp / 'lane4'
    subprocess.run([sys.executable, str(ROOT / 'make-workflow.py'), '--plan', str(b), '--workflow-id', 'W4-01', '--out-dir', str(lane),
                    '--state-dir', str(guard.STATE)], check=True, capture_output=True)
    launch = json.loads((lane / 'launch-W4-01.json').read_text())
    ok, why = st.check_launch(launch, str(env.proj), session=SID, state_dir=guard.STATE, reap=False, record=False)
    assert ok, why
    assert st.plan_for_launch(str(env.proj), SID, guard.STATE, 'W4-01', (lane / launch['scriptPath']).read_text() if not Path(launch['scriptPath']).is_absolute() else Path(launch['scriptPath']).read_text())[0] == b
    bad = json.loads(json.dumps(launch)); bad['args']['workflowId'] = 'ZZ-99'
    ok, why = st.check_launch(bad, str(env.proj), session=SID, state_dir=guard.STATE, reap=False, record=False)
    assert not ok and str(a) in why and 'must equal a workflow_id of this plan' in why
