"""Unit S75-W00-U3 negative canaries and native cancel/restart proof (spec 10.1, 10.3, 10.4, 10.5, D16).

Every canary runs at the SAME boundary the host supports for tool calls (the PreToolUse hook /
admission path of guard.py) and asserts an actual DENIAL with its contract marker. The honest
enforcement level is asserted too: this is a same-user best-effort hook, NOT an operating-system
security boundary, and absolute prevention is never claimed. Fixtures only (tmp dirs, private
state dir); nothing live is touched."""
import json, os, re, shutil, sqlite3, subprocess, time
from pathlib import Path
import pytest
from test_returned_run_live import guard, st, env, j  # noqa: F401  (env is a fixture; guard/st share one state root)

ROOT = Path(guard.__file__).resolve().parent

# ---- helpers ------------------------------------------------------------------------------------

def pre(tool, tool_input, session='u3-orch', cwd=None, **extra):
    data = {'hook_event_name': 'PreToolUse', 'tool_name': tool, 'tool_input': tool_input, 'session_id': session, **extra}
    if cwd is not None:
        data['cwd'] = str(cwd)
    return guard.hook(data)


def register(session, run_root):
    """Register session as a program (the orchestrator seat) with the guard's own registrar."""
    guard.write_txn([('INSERT INTO programs VALUES(?,?,?) ON CONFLICT(session) DO UPDATE SET run_root=excluded.run_root',
                      (session, str(run_root), time.time()))])


def compact_journal(run):
    """Real run journals write compact JSON ("agentId":"x"); _agent_in_run matches that exact
    form, so re-emit the test helper's journal with compact separators."""
    jp = run / 'journal.jsonl'
    evs = [json.loads(l) for l in jp.read_text().splitlines() if l.strip()]
    jp.write_text(''.join(json.dumps(e, separators=(',', ':')) + '\n' for e in evs))


def mkplan(env, specs={'CN-01': 2}, status='running'):
    p = st._mkplan(env.proj, specs, status=status)
    return str(Path(p).resolve())


# ---- negative canaries (spec 10.1): each must be DENIED with its marker ---------------------------

def test_canary_hidden_worker_denied(env, capsys):
    plan = mkplan(env)
    r = pre('Agent', {'subagent_type': 'general-purpose', 'description': 'builder', 'prompt': 'build and implement the module'}, cwd=env.proj)
    err = capsys.readouterr().err
    assert r == 2 and re.search(r'HIDDEN (BUILD|WORKER)', err), err


def test_canary_hidden_worker_indirect_shell_form_denied(env, capsys):
    register('u3-orch', env.proj)
    r = pre('Bash', {'command': 'nohup claude -p "build it" &'}, cwd=env.proj)
    err = capsys.readouterr().err
    assert r == 2 and 'ORCHESTRATOR ALLOWLIST' in err and 'hidden agent spawning' in err, err


def test_canary_orchestrator_implementation_edit_denied(env, capsys):
    register('u3-orch', env.proj)
    r = pre('Edit', {'file_path': str(env.proj / 'impl.py'), 'old_string': 'a', 'new_string': 'b'}, cwd=env.proj)
    err = capsys.readouterr().err
    assert r == 2 and 'ORCHESTRATOR ALLOWLIST' in err and 'implementation writes are denied' in err, err
    # and an indirect Bash form of the same write
    r = pre('Bash', {'command': 'python3 -c "open(\\"%s\\",\\"w\\").write(1)"' % (env.proj / 'impl.py')}, cwd=env.proj)
    err = capsys.readouterr().err
    assert r == 2 and re.search(r'ORCHESTRATOR ALLOWLIST|arbitrary execution', err), err
    # named accounting trees stay writable for the seat
    assert pre('Edit', {'file_path': str(env.proj / 'lanes' / 'x-lane' / 'note.md'), 'old_string': 'a', 'new_string': 'b'}, cwd=env.proj) == 0
    assert pre('Edit', {'file_path': str(env.proj / 'evidence' / 'receipt.md'), 'old_string': 'a', 'new_string': 'b'}, cwd=env.proj) == 0


def test_canary_eleven_agents_in_one_workflow_denied(env, capsys):
    """11 concurrent agents in one workflow: refused at BOTH admission boundaries - the launch
    validator (computed peak vs effective cap 10) and the atomic launch reservation."""
    script = ("// SCRATCH ISOLATION lanes/<UNIT-ID>-<box-slug>/\n"
              "export const meta={name:'u3-11L',description:'t',phases:[{title:'Build'},{title:'QC'}]};\n"
              "const r=await pipeline(args.units,u=>agent(u.prompt,{model:'opus',phase:'Build',label:'build:'+u.id}),"
              "(b,u)=>agent(u.prompt,{model:'sonnet',phase:'QC',label:'qc:'+u.id}));return r;")
    args = {'units': [{'id': 'CN-%03d' % k, 'prompt': 'p'} for k in range(1, 12)]}
    node = os.environ.get('WORKFLOW_GUARD_NODE') or 'node'
    r = subprocess.run([node, str(ROOT / 'validate.mjs')], input=json.dumps({'script': script, 'args': args}),
                       capture_output=True, text=True)
    out = json.loads(r.stdout)
    assert out['ok'] is False and any('Computed upper bound 11 concurrent agents exceeds effective cap 10' in e for e in out['errors']), out
    # and the reservation boundary refuses the declared peak atomically
    tx = env.tmp / 'e.jsonl'; tx.write_text('')
    msg = guard.admit_launch(('LE', 'u3-orch', str(tx), time.time(), 'h', 'VALIDATED', 'CN-11', 11, ''), None)
    assert msg and 'above the operator limit of 10 per workflow' in msg, msg
    capsys.readouterr()


def test_canary_global_cap_breach_denied(env, capsys):
    """Global concurrent-agent ceiling (500) is enforced at admission, atomically."""
    sd = Path(guard.STATE); (sd / 'limits.json').write_text(json.dumps(
        {'concurrent_agents_per_workflow': 10, 'concurrent_workflows_per_program': 50, 'concurrent_agents_total': 12, 'session_lease_seconds': 3600}))
    tx = env.tmp / 'g.jsonl'; tx.write_text('')
    plan = mkplan(env, {'CN-01': 2})
    now = time.time()
    # one live launch already accounting 10 agents
    assert guard.admit_launch(('L0', 'u3-orch', str(tx), now, 'h', 'VALIDATED', 'CN-01', 10, ''), None) is None
    msg = guard.admit_launch(('L1', 'u3-orch', str(tx), now, 'h', 'VALIDATED', 'CN-01', 3, ''), None)
    assert msg and 'above the operator limit of 12 total' in msg, msg
    capsys.readouterr()


def test_canary_stale_writer_after_revocation_denied(env, capsys):
    """After revoke-attempt the old attempt token cannot write (fenced writer) and cannot spend
    (admission refuses a relaunch of a revoked attemptId)."""
    plan = mkplan(env, {'CN-01': 2})
    tx, run = st._mkrun(env.proj, 'CN-01')  # real-shaped run: journal agentIds bu-CN-01-U1 .. qc-CN-01-U2
    compact_journal(run)
    aid = 'bu-CN-01-U1'
    now = time.time()
    guard.write_txn([('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', ('LW', 'u3-sess', str(tx), now, 'h', 'RETURNED', 'CN-01', 2, json.dumps({'run_id': 'wf_CN-01', 'transcript_dir': str(run)}))),
                     ('INSERT INTO launch_tags VALUES(?,?,?,?,?)', ('LW', 'u3-sess', 'CN-01', plan, now)),
                     ('INSERT INTO attempt_ids VALUES(?,?,?,?,?)', (plan, 'A1', 'CN-01', 'LW', now))])
    guard.revoke_attempt(plan, 'CN-01', 'A1', reason='canary quarantine', by='u3-test')
    capsys.readouterr()
    # fenced WRITE: the stale writer's verdict write is refused
    vpath = Path(plan).parent / 'evidence' / 'CN-01' / 'CN-01-U1.verdict.json'
    vpath.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps({'verdict': 'PASS', 'unit_id': 'CN-01-U1', 'attempt_id': 'A1', 'builder_model': 'mimo-pro', 'reviewer_model': 'glm-5.3'})
    r = pre('Write', {'file_path': str(vpath), 'content': content}, session='u3-sess', cwd=env.proj, agent_id=aid)
    err = capsys.readouterr().err
    assert r == 2 and 'IS REVOKED' in err and 'cannot write' in err, err
    # and its PostToolUse write is never journaled (fenced at the evidence boundary)
    guard.hook({'hook_event_name': 'PostToolUse', 'tool_name': 'Write', 'session_id': 'u3-sess', 'cwd': str(env.proj),
                'agent_id': aid, 'tool_input': {'file_path': str(vpath), 'content': content}})
    rows = guard.read_rows('SELECT * FROM verdict_records', ())
    assert rows == [], rows
    # fenced SPEND: admission refuses a dispatch carrying the revoked attemptId
    # (the old run is finished first, so the refusal is the revoked fence itself, not live-queueing)
    guard.write_txn([("UPDATE launches SET state='COMPLETED' WHERE id='LW'", ())])
    msg = guard.admit_launch(('L9', 'u3-sess', str(tx), time.time(), 'h', 'VALIDATED', 'CN-01', 2, ''), ('CN-01', plan, 'A1', 2))
    assert msg and 'REVOKED (fenced attempt)' in msg and 'never be reused' in msg, msg
    capsys.readouterr()


def test_canary_fabricated_qc_denied(env, capsys):
    """A fabricated QC record is denied: the conductor may not write a verdict at all, and an agent
    outside the admitted run of the owning workflow may not write one either."""
    plan = mkplan(env, {'CN-01': 1})
    vpath = Path(plan).parent / 'evidence' / 'CN-01' / 'CN-01-U1.verdict.json'
    vpath.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps({'verdict': 'PASS', 'unit_id': 'CN-01-U1', 'attempt_id': 'A1', 'builder_model': 'opus', 'reviewer_model': 'sonnet'})
    r = pre('Write', {'file_path': str(vpath), 'content': content}, session='u3-conductor', cwd=env.proj)  # no agent_id = the conductor
    err = capsys.readouterr().err
    assert r == 2 and 'may not write unit verdict files' in err, err
    # an unlinked agent (its run has no admitted launch) is refused as well
    r = pre('Write', {'file_path': str(vpath), 'content': content}, session='u3-sess', cwd=env.proj, agent_id='ghost-agent')
    err = capsys.readouterr().err
    assert r == 2 and 'not part of the admitted run' in err, err


def test_canary_direct_provider_dispatch_denied(env, capsys):
    register('u3-orch', env.proj)
    r = pre('Bash', {'command': 'curl -s https://openrouter.ai/api/v1/chat/completions -d {}'}, cwd=env.proj)
    err = capsys.readouterr().err
    assert r == 2 and 'direct provider dispatch' in err, err
    r = pre('WebFetch', {'url': 'https://api.anthropic.com/v1/messages'}, cwd=env.proj)
    err = capsys.readouterr().err
    assert r == 2 and 'direct provider dispatch' in err, err


# ---- honest enforcement accounting (spec 10.1) ---------------------------------------------------

def test_enforcement_level_never_overclaims(env, capsys):
    e = guard.enforcement_state()
    assert e['os_security_boundary'] is False
    assert 'best-effort' in e['enforcement_level'] and 'NOT an operating-system security boundary' in e['enforcement_level']
    assert 'absolute' not in e['enforcement_level'].lower().replace('no absolute prevention is claimed', '')
    assert e['production_dispatch'] == 'closed' and e['blocker']
    # opening production dispatch demands an attested visible specialist; a bare open is refused
    r = subprocess.run(['python3', str(ROOT / 'guard.py'), 'enforcement', '--open-dispatch'],
                       capture_output=True, text=True, env={**os.environ, 'WORKFLOW_GUARD_STATE': str(guard.STATE)})
    assert r.returncode == 2 and 'REFUSED' in r.stderr and 'boundary-established-by' in r.stderr
    # dispatch stays closed to every plan outside an explicit allowed set
    plan = mkplan(env, {'CN-01': 2})
    guard.write_enforcement({'production_dispatch': 'closed', 'allowed_plans': [str(Path(plan).parent / 'specialist.json')], 'blocker': 'canary', 'updated_by': 'u3-test'})
    assert guard.dispatch_blocker(plan) is not None
    capsys.readouterr()


# ---- spec 10.3: raw census counts, never clamped to a declared peak; missing = UNKNOWN ----------

def test_census_raw_counts_not_clamped_and_missing_is_unknown(env, capsys):
    mkplan(env, {'CN-01': 2})
    tx, run = st._mkrun(env.proj, 'CN-01')  # 2 units -> 4 agents in the journal
    compact_journal(run)
    now = time.time()
    # observed journal (4 agents) with a DECLARED PEAK of 10 must report 4, not clamp to 10
    guard.write_txn([('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', ('L1', 's1', str(tx), now, 'h', 'RETURNED', 'CN-01', 10, json.dumps({'run_id': 'wf_CN-01', 'transcript_dir': str(run)})))])
    c = guard.db()
    try:
        occ = guard.occupancy(c, now)
    finally:
        c.close()
    assert occ['agents_observed'] == 4 and occ['unknown_runs'] == 0, occ
    # a run above its declared peak is reported raw (12 observed with peak 10 reports 12)
    j(run / 'journal.jsonl', *[{'type': 'started', 'key': 'k%d' % k, 'agentId': 'a%d' % k} for k in range(12)])
    c = guard.db()
    try:
        occ = guard.occupancy(c, now)
    finally:
        c.close()
    assert occ['agents_observed'] == 12 and occ['agents_total'] == 12, occ
    # a run with NO readable native census falls back to the declared peak but is counted UNKNOWN, never zero
    tx2 = env.tmp / 'nojournal.jsonl'; tx2.write_text('')
    guard.write_txn([('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', ('L2', 's2', str(tx2), now, 'h', 'RETURNED', 'CN-02', 7, json.dumps({'run_id': 'wf_CN-02-missing'})))])
    c = guard.db()
    try:
        occ = guard.occupancy(c, now)
    finally:
        c.close()
    assert occ['unknown_runs'] == 1 and occ['agents_observed'] == 12 and occ['agents_total'] == 12 + 7, occ
    capsys.readouterr()


# ---- D16 family identity: MiMo Pro/Flash cannot masquerade as independent families --------------

def test_canary_mimo_family_normalization(env, capsys):
    assert st.model_family('xiaomi/mimo-v2.6-pro') == 'mimo'
    assert st.model_family('openrouter/xiaomi/mimo-v2.6-flash') == 'mimo'
    # and in plan validation (swarm-plan.mjs), same normalization: a v2 plan built with a Pro/Flash
    # pair is validated through the tool's own CLI, and its readiness check refuses the MiMo/MiMo
    # verdict (one family) while a MiMo/GLM verdict passes the very same file layout.
    tool = ROOT.parent.parent.parent / 'spec-protocol' / 'tools' / 'swarm-plan.mjs'
    node = os.environ.get('WORKFLOW_GUARD_NODE') or 'node'
    root = env.tmp / 'mimo-plan'; root.mkdir()
    unit = {'unit_id': 'M-01-U1', 'work': 'build one', 'owned_output': 'out/M-01/1.md', 'acceptance': 'a',
            'source': 's', 'verdict_file': 'evidence/M-01/M-01-U1.verdict.json'}
    plan = {'schema': 'blackceo.swarm-plan/v2', 'status': 'planned-not-running',
            'policy': {'max_active_workflows': 2, 'max_agents_per_workflow': 10, 'max_working_agents': 500},
            'workflows': [{'workflow_id': 'M-01', 'agent_count': 1, 'concurrency': 1, 'dependencies': [], 'units': [unit]}]}
    pf = root / 'SWARM-PLAN.json'; pf.write_text(json.dumps(plan))
    assert subprocess.run([node, str(tool), 'check', str(pf)], capture_output=True, text=True).returncode == 0
    ev = root / 'evidence' / 'M-01'; ev.mkdir(parents=True)
    (ev / 'M-01-U1.verdict.json').write_text(json.dumps(
        {'verdict': 'PASS', 'unit_id': 'M-01-U1', 'attempt_id': 'a1', 'builder_model': 'xiaomi/mimo-v2.6-pro',
         'reviewer_model': 'openrouter/xiaomi/mimo-v2.6-flash'}))
    ready = json.loads(subprocess.run([node, str(tool), 'ready', str(pf), '--root', str(root)],
                                      capture_output=True, text=True).stdout)
    assert 'M-01' not in ready.get('done', []), ready
    (ev / 'M-01-U1.verdict.json').write_text(json.dumps(
        {'verdict': 'PASS', 'unit_id': 'M-01-U1', 'attempt_id': 'a1', 'builder_model': 'xiaomi/mimo-v2.6-pro',
         'reviewer_model': 'z-ai/glm-5.3'}))
    ready = json.loads(subprocess.run([node, str(tool), 'ready', str(pf), '--root', str(root)],
                                      capture_output=True, text=True).stdout)
    assert 'M-01' in ready.get('done', []), ready
    # Staffing layer (staffing.py unit_done): TWO independent MiMo masquerade doors are shut.
    plan = mkplan(env, {'CN-01': 1})
    pdir = Path(plan).parent
    doc = json.loads(Path(plan).read_text())
    wf = st.workflows(doc)[0]
    # door 1: the verdict's own builder/reviewer fields must be different FAMILIES - a Pro/Flash
    # pair in the verdict JSON is never DONE even with a healthy run behind it
    st._verdict(pdir, 'CN-01', v='PASS', attempt='A1',
                builder='xiaomi/mimo-v2.6-pro', reviewer='openrouter/xiaomi/mimo-v2.6-flash')
    st._mkrun(pdir, 'CN-01', builder='xiaomi/mimo-v2.6-pro', checker='z-ai/glm-5.3')
    recs = st._file_records(pdir, 'CN-01')['CN-01']
    assert st.is_done(pdir, wf, attempts=('A1',), records=recs, proof=st._proof(pdir, 'CN-01')['CN-01']) is False
    # door 2: even a verdict CLAIMING different families is undone when the run's ACTUAL roles
    # (agent meta.json models) share a family - Pro/Flash cannot masquerade as independent
    st._verdict(pdir, 'CN-01', v='PASS', attempt='A1',
                builder='xiaomi/mimo-v2.6-pro', reviewer='z-ai/glm-5.3')
    shutil.rmtree(pdir / '.tx')
    st._mkrun(pdir, 'CN-01', builder='xiaomi/mimo-v2.6-pro', checker='openrouter/xiaomi/mimo-v2.6-flash')
    recs = st._file_records(pdir, 'CN-01')['CN-01']
    assert st.is_done(pdir, wf, attempts=('A1',), records=recs, proof=st._proof(pdir, 'CN-01')['CN-01']) is False
    # control: genuinely different actual families -> done
    shutil.rmtree(pdir / '.tx')
    st._mkrun(pdir, 'CN-01', builder='xiaomi/mimo-v2.6-pro', checker='z-ai/glm-5.3')
    assert st.is_done(pdir, wf, attempts=('A1',), records=recs, proof=st._proof(pdir, 'CN-01')['CN-01']) is True
    capsys.readouterr()


# ---- spec 10.5: native cancellation/restart, end to end ------------------------------------------

def _admit_attempt(env, plan, attempt, launch_id, session='u3-sess', units=2, run_id='wf_CN-01'):
    tx, run = st._mkrun(env.proj, 'CN-01')
    compact_journal(run)
    now = time.time()
    guard.write_txn([('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', (launch_id, session, str(tx), now, 'h', 'RETURNED', 'CN-01', units, json.dumps({'run_id': run_id}))),
                     ('INSERT INTO launch_tags VALUES(?,?,?,?,?)', (launch_id, session, 'CN-01', plan, now)),
                     ('INSERT INTO attempt_ids VALUES(?,?,?,?,?)', (plan, attempt, 'CN-01', launch_id, now))])
    return tx, run


def test_cancel_restart_protocol_end_to_end(env, capsys):
    plan = mkplan(env, {'CN-01': 2})
    tx, run = _admit_attempt(env, plan, 'A1', 'L1')
    aid = 'bu-CN-01-U1'
    vpath = Path(plan).parent / 'evidence' / 'CN-01' / 'CN-01-U1.verdict.json'
    vpath.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps({'verdict': 'PASS', 'unit_id': 'CN-01-U1', 'attempt_id': 'A1', 'builder_model': 'xiaomi/mimo-v2.6-pro', 'reviewer_model': 'z-ai/glm-5.3'})
    assert pre('Write', {'file_path': str(vpath), 'content': content}, session='u3-sess', cwd=env.proj, agent_id=aid) == 0
    guard.hook({'hook_event_name': 'PostToolUse', 'tool_name': 'Write', 'session_id': 'u3-sess', 'cwd': str(env.proj),
                'agent_id': aid, 'tool_input': {'file_path': str(vpath), 'content': content}})
    assert len(guard.read_rows('SELECT * FROM verdict_records', ())) == 1  # accepted output journaled
    # 1) quarantine + 2) checkpoint + 3) lease revocation in one operator act
    ck = guard.revoke_attempt(plan, 'CN-01', 'A1', reason='canary violation', by='u3-test')
    assert [r['unit_id'] for r in ck['accepted_outputs']] == ['CN-01-U1']
    assert ck['unfinished_units'] == ['CN-01-U2']
    assert guard.attempt_revoked(plan, 'A1') and guard.attempt_revoked(plan, 'A1')['reason'] == 'canary violation'
    # 4) native stop with acknowledgement: a verified TaskStop receipt cancels the launch and
    #    records the acknowledgement on the fence
    guard.write_txn([('UPDATE launches SET receipt=? WHERE id=?', (json.dumps({'task_id': 'wstop12345', 'run_id': 'wf_CN-01'}), 'L1'))])
    guard.hook({'hook_event_name': 'PostToolUse', 'tool_name': 'TaskStop', 'session_id': 'u3-sess',
                'tool_input': {'task_id': 'wstop12345'}, 'tool_response': {'message': 'Successfully stopped task: wstop12345'}})
    state = guard.read_rows('SELECT state FROM launches WHERE id=?', ('L1',))[0]['state']
    assert state == 'CANCELLED'
    rows = guard.read_rows('SELECT ack FROM attempt_revocations WHERE plan=? AND attempt_id=?', (plan, 'A1'))
    assert rows and 'stopped' in rows[0]['ack']
    # 5) fenced writes/spend again at the boundary that matters
    msg = guard.admit_launch(('L5', 'u3-sess', str(tx), time.time(), 'h', 'VALIDATED', 'CN-01', 2, ''), ('CN-01', plan, 'A1', 2))
    assert msg and 'REVOKED (fenced attempt)' in msg
    # 6) restart ONLY the unfinished work under a NEW attempt ID, linked to its predecessor
    r = subprocess.run(['python3', str(ROOT / 'guard.py'), 'restart-attempt', '--plan', plan, '--workflow', 'CN-01',
                        '--supersedes', 'A1', '--new-attempt', 'A2', '--reason', 'canary restart'],
                       capture_output=True, text=True, env={**os.environ, 'WORKFLOW_GUARD_STATE': str(guard.STATE)})
    out = json.loads(r.stdout)
    assert out['restart']['unfinished_units'] == ['CN-01-U2'] and out['restart']['accepted_outputs_preserved'] == 1
    # 7) the new attempt may dispatch (and its phase-two confirm records the live attempt ID);
    #    restarting INTO that live id is refused; the old one can never be reused
    assert guard.admit_launch(('L6', 'u3-sess', str(tx), time.time(), 'h', 'VALIDATED', 'CN-01', 1, ''), ('CN-01', plan, 'A2', 1)) is None
    guard.confirm_launch({'id': 'L6'})
    r = subprocess.run(['python3', str(ROOT / 'guard.py'), 'restart-attempt', '--plan', plan, '--workflow', 'CN-01',
                        '--supersedes', 'A1', '--new-attempt', 'A2', '--reason', 'dup'],
                       capture_output=True, text=True, env={**os.environ, 'WORKFLOW_GUARD_STATE': str(guard.STATE)})
    assert r.returncode == 2 and 'already in use' in r.stderr
    guard.write_txn([("UPDATE launches SET state='COMPLETED' WHERE id='L6'", ()), ('DELETE FROM reservations WHERE id=?', ('L6',))])
    msg = guard.admit_launch(('L7', 'u3-sess', str(tx), time.time(), 'h', 'VALIDATED', 'CN-01', 1, ''), ('CN-01', plan, 'A1', 1))
    assert msg and 'REVOKED (fenced attempt)' in msg
    # 8) restarting WITHOUT revoking first is refused (revocation is the fence, not a flag)
    r = subprocess.run(['python3', str(ROOT / 'guard.py'), 'restart-attempt', '--plan', plan, '--workflow', 'CN-01',
                        '--supersedes', 'A2', '--new-attempt', 'A3', '--reason', 'premature'],
                       capture_output=True, text=True, env={**os.environ, 'WORKFLOW_GUARD_STATE': str(guard.STATE)})
    assert r.returncode == 2 and 'is not revoked' in r.stderr
    capsys.readouterr()
