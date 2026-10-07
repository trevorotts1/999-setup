"""Enforcement v22: atomic admission under real concurrent processes, protected-path writes, journal-attested DONE,
pin lifecycle, Stop fail-closed, repair launches. Every test runs real guard.py hook subprocesses on a TEMP state dir;
the real guard.sqlite3 is never touched. Rejection fixtures assert the specific reason text."""
import concurrent.futures as cf
import importlib.util, json, os, sqlite3, subprocess, sys, time
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parent
PY = sys.executable
_s = importlib.util.spec_from_file_location('staffing_v22', ROOT / 'staffing.py'); st = importlib.util.module_from_spec(_s); _s.loader.exec_module(st)
LIM = {'concurrent_agents_per_workflow': 10, 'concurrent_workflows_per_program': 50, 'concurrent_agents_total': 500, 'session_lease_seconds': 3600}


class Env:
    def __init__(self, tmp):
        self.tmp = tmp
        self.sd = tmp / 'state'; self.sd.mkdir(); (self.sd / 'limits.json').write_text(json.dumps(LIM))
        self.qg = tmp / 'qg'; self.qg.mkdir()
        self.proj = tmp / 'proj'; self.proj.mkdir()
        self.env = {**os.environ, 'WORKFLOW_GUARD_STATE': str(self.sd), 'QUESTION_GATE_STATE': str(self.qg)}

    def hook(self, payload, cwd=None):
        p = subprocess.run([PY, str(ROOT / 'guard.py'), 'hook'], input=json.dumps(payload), capture_output=True, text=True, env=self.env, cwd=str(cwd or self.proj), timeout=120)
        return p.returncode, p.stdout + p.stderr

    def pre(self, tool, ti, sid='S1', cwd=None, tuid=None, **extra):
        return self.hook({'hook_event_name': 'PreToolUse', 'tool_name': tool, 'tool_input': ti, 'cwd': str(cwd or self.proj), 'session_id': sid,
                          'tool_use_id': tuid or 'tu-%d' % time.time_ns(), 'transcript_path': extra.pop('transcript_path', ''), **extra})

    def stop(self, sid='S1', cwd=None):
        rc, out = self.hook({'hook_event_name': 'Stop', 'session_id': sid, 'cwd': str(cwd or self.proj), 'stop_hook_active': False, 'transcript_path': ''}, cwd)
        d = json.loads(out.splitlines()[0]) if out.strip().startswith('{') else {}
        return d.get('reason') if d.get('decision') == 'block' else None

    def prompt(self, text, sid='S1', cwd=None):
        return self.hook({'hook_event_name': 'UserPromptSubmit', 'session_id': sid, 'cwd': str(cwd or self.proj), 'prompt': text, 'source': 'user'}, cwd)

    def gen(self, wid, proj=None, extra=()):
        proj = proj or self.proj
        out = self.tmp / 'gen' / proj.name
        r = subprocess.run([PY, str(ROOT / 'make-workflow.py'), '--plan', str(proj / 'SWARM-PLAN.json'), '--workflow-id', wid, '--out-dir', str(out), '--state-dir', str(self.sd), *extra],
                           capture_output=True, text=True, env=self.env)
        assert r.returncode == 0, r.stderr
        return json.loads((out / ('launch-%s.json' % wid)).read_text())

    def post(self, tool, ti, sid='S1', cwd=None, tuid=None, response='', event='PostToolUse', **extra):
        return self.hook({'hook_event_name': event, 'tool_name': tool, 'tool_input': ti, 'cwd': str(cwd or self.proj), 'session_id': sid,
                          'tool_use_id': tuid or 'tu-%d' % time.time_ns(), 'transcript_path': extra.pop('transcript_path', ''), 'tool_response': response, **extra})

    def confirm(self, tuid, sid='S1', cwd=None, run='wf_L', transcript=''):
        """PostToolUse of a launch (phase two of the two-phase admission): confirms the reservation made by the PreToolUse."""
        return self.post('Workflow', {}, sid=sid, cwd=cwd, tuid=tuid, response='Task ID: wabcdefgh Run ID: %s' % run, transcript_path=transcript)

    def launch(self, wid, aid, proj=None, sid='S1', transcript='', run='wf_L', confirm=True):
        proj = proj or self.proj
        g = self.gen(wid, proj)
        a = dict(g['args']); a['attemptId'] = aid
        r = self.pre('Workflow', {'scriptPath': g['scriptPath'], 'args': a}, sid=sid, cwd=proj, tuid='L-' + aid, transcript_path=transcript)
        if r[0] == 0 and confirm:
            self.confirm('L-' + aid, sid=sid, cwd=proj, run=run, transcript=transcript)
        return r

    def q(self, sql, *params):
        c = sqlite3.connect(self.sd / 'guard.sqlite3')
        try:
            return c.execute(sql, params).fetchall()
        finally:
            c.close()

    def snap(self, sid='S1', cwd=None):
        return st.snapshot(str(cwd or self.proj), self.sd, sid, reap=False)


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


# ------------------------------------------------------------------ defect 3: atomic admission, real concurrent processes
@pytest.mark.parametrize('rnd', range(3))
def test_N22a_concurrent_launches_never_exceed_max_active(tmp_path, rnd):
    e = Env(tmp_path)
    st._mkplan(e.proj, {'W0-01': 2, 'W0-02': 2, 'W0-03': 2}, status='running', maw=2)
    gs = {w: e.gen(w) for w in ('W0-01', 'W0-02', 'W0-03')}

    def go(item):
        wid, sid = item
        a = dict(gs[wid]['args']); a['attemptId'] = 'r-' + wid
        return e.pre('Workflow', {'scriptPath': gs[wid]['scriptPath'], 'args': a}, sid=sid, tuid='race-' + wid)
    with cf.ThreadPoolExecutor(3) as ex:
        res = list(ex.map(go, [('W0-01', 'SA'), ('W0-02', 'SB'), ('W0-03', 'SC')]))
    live = e.q("SELECT COUNT(DISTINCT r.workflow_id) FROM reservations r JOIN launches l ON l.id=r.id WHERE l.state='RESERVED'")[0][0]  # reserved in PreToolUse; no tag until PostToolUse
    assert live == 2, (live, res)
    assert sorted(rc for rc, _ in res) == [0, 0, 2]
    refusal = [out for rc, out in res if rc == 2][0]
    assert 'the plan runs at most 2 workflows at once and 2 are running' in refusal or 'is already running' in refusal or 'admission re-check' in refusal, refusal


@pytest.mark.parametrize('rnd', range(3))
def test_N22b_same_workflow_launched_twice_concurrently_admits_one(tmp_path, rnd):
    e = Env(tmp_path)
    st._mkplan(e.proj, {'W0-01': 2}, status='running', maw=5)
    g = e.gen('W0-01')

    def go(item):
        aid, sid = item
        a = dict(g['args']); a['attemptId'] = aid
        return e.pre('Workflow', {'scriptPath': g['scriptPath'], 'args': a}, sid=sid, tuid='dup-' + aid)
    with cf.ThreadPoolExecutor(2) as ex:
        res = list(ex.map(go, [('d1', 'SA'), ('d2', 'SB')]))
    assert e.q("SELECT COUNT(*) FROM reservations WHERE workflow_id='W0-01'")[0][0] == 1, res
    assert sorted(rc for rc, _ in res) == [0, 2]
    assert 'workflow W0-01 is already running' in [out for rc, out in res if rc == 2][0] or 'already running' in [out for rc, out in res if rc == 2][0]


def test_admission_recheck_reason_when_view_is_stale(env):
    """admit_launch alone (no check_launch): a live launch of the same workflow, inserted behind its back, refuses the admit."""
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    spec = importlib.util.spec_from_file_location('guard_v22', ROOT / 'guard.py'); g = importlib.util.module_from_spec(spec)
    os.environ['WORKFLOW_GUARD_STATE'] = str(env.sd); spec.loader.exec_module(g); g.STATE = env.sd; g.LIMITS_FILE = env.sd / 'limits.json'
    plan = str((env.proj / 'SWARM-PLAN.json').resolve())
    row = lambda i, sid: (i, sid, '', time.time(), 'h', 'VALIDATED', 'n', 2, '')
    assert g.admit_launch(row('x1', 'SA'), ('W0-01', plan, 'a1')) is None
    msg = g.admit_launch(row('x2', 'SB'), ('W0-01', plan, 'a2'))
    assert msg == 'workflow W0-01 is already running (another launch of it was admitted first); do not launch it twice.', msg
    assert g.admit_launch(row('x3', 'SB'), ('W0-01', plan, 'a1')) is not None  # attemptId reuse still refused


# ------------------------------------------------------------------ defects 4 + 5: protected writes
VF = 'evidence/W0-01/W0-01-U1.verdict.json'


def armed(env, specs=None):
    st._mkplan(env.proj, specs or {'W0-01': 2}, status='running')
    return env.proj / 'SWARM-PLAN.json'


@pytest.mark.parametrize('rel,why', [
    ('evidence/W0-01/W0-01-U1.VERDICT.JSON', 'may not write unit verdict files'),
    ('evidence/W0-01/W0-01-U1.Verdict.Json', 'may not write unit verdict files'),
    ('elsewhere/x.verdict.json', 'may not write unit verdict files'),
])
def test_N8b_main_session_verdict_names_any_case_any_dir(env, rel, why):
    armed(env)
    for tool, ti in (('Write', {'file_path': str(env.proj / rel), 'content': '{}'}), ('Edit', {'file_path': str(env.proj / rel), 'old_string': 'a', 'new_string': 'b'}),
                     ('MultiEdit', {'file_path': str(env.proj / rel), 'edits': []}), ('NotebookEdit', {'notebook_path': str(env.proj / rel), 'new_source': 'x'})):
        rc, out = env.pre(tool, ti)
        assert rc == 2 and why in out, (tool, rel, out)


def test_verdict_block_has_no_plan_condition(env):
    rc, out = env.pre('Write', {'file_path': str(env.tmp / 'noplan' / 'a.verdict.json'), 'content': '{}'}, cwd=env.tmp)
    assert rc == 2 and 'may not write unit verdict files' in out and 'this rule holds everywhere' in out


def test_N8c_symlinked_dir_and_N8d_case_variant_of_plan_dir(env):
    armed(env)
    (env.proj / 'evidence' / 'W0-01').mkdir(parents=True)
    link = env.tmp / 'link-to-proj'; link.symlink_to(env.proj)
    rc, out = env.pre('Write', {'file_path': str(link / 'evidence/W0-01/notes.txt'), 'content': 'x'})
    assert rc == 2 and 'may not write the evidence tree of armed plan' in out, out
    rc, out = env.pre('Write', {'file_path': str(link / 'evidence/W0-01/W0-01-U1.verdict.json'), 'content': '{}'})
    assert rc == 2 and 'may not write unit verdict files' in out, out
    variant = str(env.proj / 'evidence/W0-01/notes.txt').replace('/proj/', '/PROJ/')
    rc, out = env.pre('Write', {'file_path': variant, 'content': 'x'})
    assert rc == 2 and 'may not write the evidence tree of armed plan' in out, out
    # a symlink FILE that points at a verdict path
    (env.tmp / 'innocent.json').symlink_to(env.proj / VF)
    rc, out = env.pre('Write', {'file_path': str(env.tmp / 'innocent.json'), 'content': '{}'})
    assert rc == 2 and 'may not write unit verdict files' in out, out


def test_N24_N26_N27_plan_file_and_state_dirs_protected(env):
    plan = armed(env)
    for tool, ti, needle in (
            ('Write', {'file_path': str(plan), 'content': '{}'}, 'may not write or rename the armed plan file'),
            ('Edit', {'file_path': str(plan), 'old_string': 'a', 'new_string': 'b'}, 'may not write or rename the armed plan file'),
            ('Write', {'file_path': str(env.sd / 'guard.sqlite3'), 'content': 'x'}, 'may not write the guard or question-gate state'),
            ('Write', {'file_path': str(env.qg / 'S1.json'), 'content': '{"mode":"question"}'}, 'may not write the guard or question-gate state'),
            ('Write', {'file_path': str(Path.home() / '.claude/hooks/question-gate/state/S1.json'), 'content': '{}'}, 'may not write the guard or question-gate state'),
            ('Write', {'file_path': str(Path.home() / '.claude/hooks/workflow-guard/state/limits.json'), 'content': '{}'}, 'may not write the guard or question-gate state'),
            ('Write', {'file_path': str(Path.home() / '.claude-nine/hooks/workflow-guard/state/limits.json'), 'content': '{}'}, 'may not write the guard or question-gate state')):
        rc, out = env.pre(tool, ti)
        assert rc == 2 and needle in out, (tool, ti['file_path'], out)
    rc, out = env.pre('Write', {'file_path': str(env.proj / 'out' / 'a.md'), 'content': 'x'})
    assert rc == 0, out  # ordinary work is untouched


@pytest.mark.parametrize('cmd', [
    'mv {plan} {proj}/PLAN.bak', 'cp /tmp/x {plan}', 'rm {plan}', 'rm -rf {proj}/evidence', "sed -i '' s/running/done/ {plan}",
    "sqlite3 {sd}/guard.sqlite3 'UPDATE continuations SET latched=1'", "echo '{{\"mode\":\"question\"}}' > {qg}/S1.json", 'tee {sd}/limits.json < /tmp/x',
    "python3 -c \"open('{sd}/guard.sqlite3','wb').write(b'')\"", 'rsync -a /tmp/stage/ {proj}/evidence/', 'tar -xf /tmp/f.tar -C {proj}/evidence',
    'unzip -o /tmp/f.zip -d {proj}/evidence', 'git checkout forge -- evidence/W0-01/x.md', 'ln -sf /tmp/x {sd}/guard.sqlite3',
    "echo x > ~/.claude/hooks/question-gate/state/S1.json",
])
def test_bash_writes_to_governing_paths_refused(env, cmd):
    plan = armed(env)
    rc, out = env.pre('Bash', {'command': cmd.format(plan=plan, proj=env.proj, sd=env.sd, qg=env.qg)})
    assert rc == 2 and 'writes, moves or deletes something that governs the session' in out, (cmd, out)


@pytest.mark.parametrize('cmd', [
    'python3 {root}/staffing.py status --cwd {proj}', 'python3 {root}/staffing.py start --cwd {proj}', '/opt/homebrew/bin/python3 {root}/staffing.py status --cwd {proj} --json 2>&1',
    'cat {sd}/STATUS.md', 'ls {sd} 2>/dev/null', 'cat {plan}', 'ls evidence/ 2>&1',
])
def test_bash_staffing_and_reads_allowed(env, cmd):
    plan = armed(env)
    rc, out = env.pre('Bash', {'command': cmd.format(plan=plan, proj=env.proj, sd=env.sd, root=ROOT)})
    assert rc == 0, (cmd, out)


@pytest.mark.parametrize('cmd', [
    'python3 {root}/make-workflow.py --plan {plan} --workflow-id W3-06 --out-dir {proj}/run/w3-06-repair',  # `-i` inside --workflow-id is not a write flag
    "python3 -c \"print(1 >= 0)\" # {plan}",  # >= is a comparison, not a redirect
    "python3 -c \"print(2 > 1)\" {plan}",  # a bare > inside a quoted expression, target is not governed
])
def test_bash_flag_lookalikes_allowed(env, cmd):
    plan = armed(env)
    rc, out = env.pre('Bash', {'command': cmd.format(plan=plan, proj=env.proj, root=ROOT)})
    assert rc == 0, (cmd, out)


@pytest.mark.parametrize('cmd', [
    'sed -i s/a/b/ {plan}', 'echo x > {plan}', 'echo x >> {plan}', 'perl -pi -e s/a/b/ {plan}', 'perl -i.bak -e 1 {plan}', 'echo x >{proj}/evidence/W0-01/a.md',
])
def test_bash_real_mutations_still_refused(env, cmd):
    plan = armed(env)
    rc, out = env.pre('Bash', {'command': cmd.format(plan=plan, proj=env.proj)})
    assert rc == 2 and 'governs the session' in out, (cmd, out)


def test_staffing_start_cannot_be_chained_with_a_write(env):
    plan = armed(env)
    rc, out = env.pre('Bash', {'command': 'python3 %s/staffing.py status --cwd %s; rm %s' % (ROOT, env.proj, plan)})
    assert rc == 2 and 'governs the session' in out


def test_subagent_is_not_blocked_from_ordinary_writes_and_unarmed_plan_is_editable(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='planned-not-running')
    rc, out = env.pre('Write', {'file_path': str(env.proj / 'SWARM-PLAN.json'), 'content': '{}'})
    assert rc == 0, out  # an unarmed plan is still being authored by the main session
    rc, out = env.pre('Write', {'file_path': str(env.proj / 'out.md'), 'content': 'x'}, agent_id='a1', agent_type='general-purpose')
    assert rc == 0, out  # ordinary subagent work is untouched
    # Rule change (final pass): a subagent may never write a plan file, armed or not.
    rc, out = env.pre('Write', {'file_path': str(env.proj / 'SWARM-PLAN.json'), 'content': '{}'}, agent_id='a1', agent_type='general-purpose')
    assert rc == 2 and 'subagent may not write' in out.lower(), out


# ------------------------------------------------------------------ defect 5: vanished plan
def test_N23b_renamed_plan_file_holds_stop_with_plan_file_missing(env):
    st._mkplan(env.proj, {'W0-01': 2, 'W0-02': 2}, status='planned-not-running')
    assert env.launch('W0-01', 'a1')[0] == 0
    assert 'Owed now' in env.stop()
    (env.proj / 'SWARM-PLAN.json').rename(env.proj / 'PLAN.bak')
    away = env.tmp / 'away'; away.mkdir()
    for cwd in (env.proj, away):
        r = env.stop(cwd=cwd)
        assert r and 'plan file missing' in r and 'armed but INVALID' in r, (cwd, r)


# ------------------------------------------------------------------ defect 6/7: pin lifecycle
def test_N18c_pause_then_continue_keeps_the_pin(env):
    st._mkplan(env.proj, {'W0-01': 2, 'W0-02': 2}, status='planned-not-running')
    assert env.launch('W0-01', 'L1', sid='L')[0] == 0
    away = env.tmp / 'away'; away.mkdir()
    assert 'Owed now' in env.stop('L', away)
    env.prompt('stop all agents', 'L', away)
    assert env.stop('L', away) is None
    assert len(env.q("SELECT plan FROM session_pins WHERE session='L'")) == 1
    env.prompt('ok, continue the build', 'L', away)
    r = env.stop('L', away)
    assert r and r.startswith('Owed now: W0-02'), r


def test_N15c_second_armed_plan_does_not_replace_pin_and_owed_is_union(env):
    parent = env.tmp / 'parent'; parent.mkdir(); child = env.tmp / 'child'; child.mkdir()
    st._mkplan(parent, {'P-01': 2, 'P-02': 2}, status='running'); st._mkplan(child, {'C-01': 2}, status='running')
    r = env.stop('S1', parent)
    assert r and 'P-01' in r
    r = env.stop('S1', child)
    assert r and 'C-01' in r and 'P-01' in r and 'P-02' in r and r.count('[plan ') == 2, r
    assert len(env.q("SELECT plan FROM session_pins WHERE session='S1'")) == 2


# ------------------------------------------------------------------ defect 8: Stop fails closed
def test_N25_corrupt_journal_blocks_stop_only_when_a_plan_is_running(env):
    st._mkplan(env.proj, {'W0-01': 2}, status='running')
    assert env.stop() is not None
    for f in env.sd.glob('guard.sqlite3*'):
        f.unlink()
    (env.sd / 'guard.sqlite3').write_bytes(b'this is not a database' * 100)
    r = env.stop()
    assert r and r.startswith('guard unavailable: ') and 'status running' in r, r
    st._mkplan(env.proj, {'W0-01': 2}, status='planned-not-running')
    assert env.stop() is None  # other errors stay fail-open
    noplan = env.tmp / 'noplan'; noplan.mkdir()
    assert env.stop(cwd=noplan) is None


# ------------------------------------------------------------------ defect 11: DONE needs a journal record
def mk_run_files(run, units_agents, builder='opus', checker='sonnet'):
    """Real-shaped run folder: journal.jsonl 'started' lines + agent-<id>.meta.json (ACTUAL model). units_agents: [(unit_id, checker_agent_id)];
    the unit's builder is agent B-<unit_id>. staffing requires the verdict writer to be the qc:<unit> agent and the actual families to differ."""
    run.mkdir(parents=True, exist_ok=True)
    lines = []
    for uid, chk in units_agents:
        for aid, label, model in (('B-' + uid, 'build:' + uid, builder), (chk, 'qc:' + uid, checker)):
            lines.append(json.dumps({'type': 'started', 'key': 'k' + aid + uid, 'agentId': aid, 'label': label, 'phase': 'x'}))
            (run / ('agent-%s.meta.json' % aid)).write_text(json.dumps({'model': model}))
            (run / ('agent-%s.jsonl' % aid)).write_text('{}\n')
    (run / 'journal.jsonl').write_text('\n'.join(lines) + '\n')


class Attested:
    def __init__(self, env):
        self.e = env
        st._mkplan(env.proj, {'W0-01': 1}, status='running')
        self.tp = env.tmp / 'main.jsonl'
        self.run = env.tmp / 'main' / 'subagents' / 'workflows' / 'wf_abc'
        self.run.mkdir(parents=True)
        mk_run_files(self.run, [('W0-01-U1', 'AGENTX1')])
        assert env.launch('W0-01', 'AID1', transcript=str(self.tp), run='wf_abc')[0] == 0
        self.vf = env.proj / 'evidence/W0-01/W0-01-U1.verdict.json'
        self.body = json.dumps({'verdict': 'PASS', 'unit_id': 'W0-01-U1', 'attempt_id': 'AID1', 'builder_model': 'opus', 'reviewer_model': 'sonnet'})

    def sub_write(self, agent_id, content=None, tool='Write'):
        ti = {'file_path': str(self.vf), 'content': self.body if content is None else content}
        kw = dict(agent_id=agent_id, agent_type='general-purpose', transcript_path=str(self.run / ('agent-%s.jsonl' % agent_id)))
        r = self.e.pre(tool, ti, **kw)
        if r[0] == 0:
            self.e.post(tool, ti, **kw)  # the journal record is written by the PostToolUse (the write succeeded), never before
        return r

    def disk(self, content=None):
        self.vf.parent.mkdir(parents=True, exist_ok=True)
        self.vf.write_text(self.body if content is None else content)

    def done(self):
        s = self.e.snap()
        return s['state']['done']


def test_verdict_counts_only_with_journal_record_from_a_linked_agent(env):
    a = Attested(env)
    a.disk()
    assert a.done() == [], 'a verdict file nobody journaled (hand-written) must not count'
    rc, out = a.sub_write('AGENTXOTHER'); a.disk()
    assert rc == 2 and 'not part of the admitted run' in out and a.done() == [], 'an agent that is not part of the admitted run may not write the verdict, let alone produce a DONE'
    assert env.q('SELECT COUNT(*) FROM verdict_records')[0][0] == 0
    rc, out = a.sub_write('AGENTX1'); a.disk()
    assert rc == 0 and env.q('SELECT unit_id,attempt_id,agent_id FROM verdict_records') == [('W0-01-U1', 'AID1', 'AGENTX1')]
    assert a.done() == ['W0-01']
    a.disk(a.body.replace('"opus"', '"opus-edited"'))  # edited after journaling
    assert a.done() == [], 'a verdict whose sha256 no longer matches its journal record must not count'
    a.disk()
    assert a.done() == ['W0-01']


def test_verdict_with_unadmitted_attempt_or_conductor_write_is_not_recorded(env):
    a = Attested(env)
    rc, out = a.sub_write('AGENTX1', a.body.replace('AID1', 'forged-attempt')); a.disk(a.body.replace('AID1', 'forged-attempt'))  # allowed (run member) but never recorded
    assert rc == 0 and env.q('SELECT COUNT(*) FROM verdict_records')[0][0] == 0 and a.done() == []
    rc, out = env.pre('Write', {'file_path': str(a.vf), 'content': a.body})  # conductor: blocked outright
    assert rc == 2 and 'may not write unit verdict files' in out
    a.disk()
    assert a.done() == []


def test_subagent_edit_of_a_verdict_is_refused_with_reason(env):
    a = Attested(env)
    rc, out = a.e.pre('Edit', {'file_path': str(a.vf), 'old_string': 'a', 'new_string': 'b'}, agent_id='AGENTX1', agent_type='general-purpose')
    assert rc == 2 and 'Write unit verdicts with the Write tool (full content)' in out, out


# ------------------------------------------------------------------ defects 13/15/18 + make-workflow, end to end through the hook
def test_N13e_rewritten_unit_object_refused_by_the_hook(env):
    st._mkplan(env.proj, {'W0-01': 3}, status='running')
    g = env.gen('W0-01')
    a = dict(g['args']); a['attemptId'] = 'o1'; a['units'] = [dict(u, work='rm -rf the repo instead') for u in a['units']]
    rc, out = env.pre('Workflow', {'scriptPath': g['scriptPath'], 'args': a})
    assert rc == 2 and "differ from the plan's unit object" in out, out
    assert env.q('SELECT COUNT(*) FROM launch_tags')[0][0] == 0


def test_N3d_same_model_two_names_is_not_done_and_make_workflow_refuses_it(env):
    st._mkplan(env.proj, {'W0-01': 1}, status='running')
    r = subprocess.run([PY, str(ROOT / 'make-workflow.py'), '--plan', str(env.proj / 'SWARM-PLAN.json'), '--workflow-id', 'W0-01', '--out-dir', str(env.tmp / 'o'),
                        '--builder', 'claude-opus-4-5', '--reviewer', 'anthropic/opus'], capture_output=True, text=True, env=env.env)
    assert r.returncode != 0 and 'different nonempty model families' in r.stderr, r.stderr


def test_repair_make_workflow_emits_only_not_yet_pass_units_and_hook_admits_it(env):
    st._mkplan(env.proj, {'W0-01': 3}, status='running')
    g = env.gen('W0-01')
    tp = env.tmp / 'main.jsonl'
    a = dict(g['args']); a['attemptId'] = 'first-1'
    rc, out = env.pre('Workflow', {'scriptPath': g['scriptPath'], 'args': a}, tuid='first', transcript_path=str(tp))
    assert rc == 0, out
    env.confirm('first', run='wf_r', transcript=str(tp))
    run = env.tmp / 'main' / 'subagents' / 'workflows' / 'wf_r'; mk_run_files(run, [('W0-01-U1', 'AG1'), ('W0-01-U2', 'AG2')])
    for u in ('W0-01-U1', 'W0-01-U2'):
        body = json.dumps({'verdict': 'PASS', 'unit_id': u, 'attempt_id': 'first-1', 'builder_model': 'opus', 'reviewer_model': 'sonnet'})
        f = env.proj / 'evidence/W0-01' / (u + '.verdict.json')
        assert env.pre('Write', {'file_path': str(f), 'content': body}, agent_id='AG' + f.name[7], agent_type='general-purpose', transcript_path=str(tp))[0] == 0
        env.post('Write', {'file_path': str(f), 'content': body}, agent_id='AG' + f.name[7], agent_type='general-purpose', transcript_path=str(tp))
        f.parent.mkdir(parents=True, exist_ok=True); f.write_text(body)
    env.q("SELECT 1")
    c = sqlite3.connect(env.sd / 'guard.sqlite3'); c.execute("UPDATE launches SET state='COMPLETED'"); c.commit(); c.close()
    rg = env.gen('W0-01', extra=('--repair',))
    assert [u['unit_id'] for u in rg['args']['units']] == ['W0-01-U3']
    assert 'args.units.filter' not in Path(rg['scriptPath']).read_text()
    ra = dict(rg['args']); ra['attemptId'] = 'repair-1'
    rc, out = env.pre('Workflow', {'scriptPath': rg['scriptPath'], 'args': ra}, tuid='repair', transcript_path=str(tp))
    assert rc == 0, out
    env.confirm('repair', run='wf_r2', transcript=str(tp))
    bad = dict(ra, attemptId='repair-2', units=[u for u in g['args']['units']])
    c = sqlite3.connect(env.sd / 'guard.sqlite3'); c.execute("UPDATE launches SET state='COMPLETED'"); c.commit(); c.close()
    rc, out = env.pre('Workflow', {'scriptPath': rg['scriptPath'], 'args': bad}, tuid='repair-bad')
    assert rc == 2 and 'a repair relaunch must carry exactly the 1 not-yet-PASS units ["W0-01-U3"]' in out, out
    # the third admitted launch without DONE is the last: handback after 3
    c = sqlite3.connect(env.sd / 'guard.sqlite3'); c.execute("UPDATE launches SET state='COMPLETED'"); c.commit(); c.close()
    ra3 = dict(ra, attemptId='repair-3')
    assert env.pre('Workflow', {'scriptPath': rg['scriptPath'], 'args': ra3}, tuid='repair3')[0] == 0
    env.confirm('repair3', run='wf_r3')
    c = sqlite3.connect(env.sd / 'guard.sqlite3'); c.execute("UPDATE launches SET state='COMPLETED'"); c.commit(); c.close()
    s = env.snap()
    assert s['state']['handback'] == ['W0-01']


def test_make_workflow_plan_output_never_derives_a_unit_list(env):
    st._mkplan(env.proj, {'W0-01': 12}, status='running')
    text = Path(env.gen('W0-01')['scriptPath']).read_text()
    assert 'pipeline(args.units,' in text
    assert 'args.units.' not in text.replace('args.units.length', '') and '.filter(' not in text.replace('.filter(Boolean)', '')


# ------------------------------------------------------------------ single arming definition: armed <=> status "running"
@pytest.mark.parametrize('cmd', ['echo x > a.verdict.json', 'cat > A.VERDICT.JSON', 'tee evidence/z.Verdict.Json < /tmp/x'])
def test_bash_verdict_write_refused_with_no_plan(env, cmd):
    noplan = env.tmp / 'noplan'; noplan.mkdir()
    rc, out = env.pre('Bash', {'command': cmd}, cwd=noplan)
    assert rc == 2 and 'may not write unit verdict files' in out and 'this rule holds everywhere' in out, out
    # Rule change (final pass): a subagent is refused the same Bash verdict writes (only the Write tool is journaled)
    rc, out = env.pre('Bash', {'command': cmd}, cwd=noplan, agent_id='a1', agent_type='general-purpose')
    assert rc == 2 and 'may not write unit verdict files' in out, out
    # ...while agent_type ALONE (the main thread of `claude --agent`) is not a subagent: it is refused too
    rc, out = env.pre('Bash', {'command': cmd}, cwd=noplan, agent_type='general-purpose')
    assert rc == 2, out


def test_first_admission_flips_status_then_broken_journal_blocks_stop(env):
    plan = st._mkplan(env.proj, {'W0-01': 2}, status='planned-not-running')
    assert env.snap()['armed'] is False
    assert env.launch('W0-01', 'FLIP1')[0] == 0
    text = plan.read_text()
    assert json.loads(text)['status'] == 'running' and text.endswith('}\n') and '\n  "status": "running"' in text
    assert env.snap()['armed'] is True
    for f in env.sd.glob('guard.sqlite3*'):
        f.unlink()
    (env.sd / 'guard.sqlite3').write_bytes(b'this is not a database' * 100)
    r = env.stop()
    assert r and r.startswith('guard unavailable: ') and 'status running' in r, r
    pkt = ROOT.parents[2] / 'Downloads/CLAUDE_NINE_DRAMA_SONG_AD_FACTORY_BUILD_PACKET/claude-nine-swarm'
    if (pkt / 'SWARM-PLAN.json').is_file():  # the real plan, copied to temp and flipped by the same helper the guard uses
        cp = env.tmp / 'realcopy.json'; cp.write_text((pkt / 'SWARM-PLAN.json').read_text())
        assert st.set_running(cp) and json.loads(cp.read_text())['status'] == 'running'
        p = subprocess.run([PY, str(pkt / 'swarm_plan_check.py'), '--plan', str(cp)], capture_output=True, text=True)
        assert p.returncode == 0, p.stdout + p.stderr


def test_refused_launch_does_not_flip_status(env):
    plan = st._mkplan(env.proj, {'W0-01': 2}, status='planned-not-running')
    rc, out = env.pre('Workflow', {'script': 'x', 'args': {'workflowId': 'W0-01'}})
    assert rc == 2 and json.loads(plan.read_text())['status'] == 'planned-not-running'


# ---- false-block fixes (2026-10-07): interpreter READS and `staffing.py status` are not writes ----
@pytest.mark.parametrize('cmd', [
    "python3 - <<'EOF'\nimport json\nt = json.load(open('{plan}'))\nn = dict(t)\njson.dump(n, open('/private/tmp/new-plan.json', 'w'))\nEOF",
    "python3 -c \"import json;print(len(json.load(open('{plan}', 'rb'))))\"",
    "python3 -c \"import sqlite3;sqlite3.connect('file:{sd}/guard.sqlite3?mode=ro', uri=True).execute('select 1')\"",
    "python3 -c \"print(open('{plan}', encoding='utf-8').read().replace('a','b'))\"",
    'python3 {root}/staffing.py status --cwd {proj} 2>&1 | head -10; echo ===STATUS===; stat -f "%m" {sd}/STATUS.md',
])
def test_bash_interpreter_reads_and_staffing_status_allowed(env, cmd):
    plan = armed(env)
    rc, out = env.pre('Bash', {'command': cmd.format(plan=plan, proj=env.proj, sd=env.sd, root=ROOT)})
    assert rc == 0, (cmd, out)


@pytest.mark.parametrize('cmd', [
    "python3 -c \"import shutil;shutil.copyfile('/tmp/n.json','{plan}')\"",
    "python3 -c \"import shutil;shutil.copy('/tmp/n.json','{plan}')\"",
    "python3 -c \"import shutil;shutil.move('{plan}','/tmp/x')\"",
    "python3 -c \"import shutil;shutil.rmtree('{proj}/evidence')\"",
    "python3 -c \"open('{plan}','w').write('x')\"",
    "python3 -c \"open('{plan}','a').write('x')\"",
    "python3 -c \"open('{plan}','x')\"",
    "python3 -c \"open('{plan}','w+')\"",
    "python3 -c \"open('{plan}','r+')\"",
    "python3 -c \"open('{plan}',mode='w')\"",
    "python3 -c \"m='w';open('{plan}',m)\"",
    "python3 -c \"from pathlib import Path;Path('{plan}').write_text('x')\"",
    "python3 -c \"from pathlib import Path;Path('{plan}').write_bytes(b'x')\"",
    "python3 -c \"import os;os.remove('{plan}')\"",
    "python3 -c \"import os;os.unlink('{plan}')\"",
    "python3 -c \"import os;os.rename('{plan}','/tmp/x')\"",
    "python3 -c \"import os;os.replace('/tmp/x','{plan}')\"",
    "python3 -c \"import json;json.dump({{}}, open('{plan}','w'))\"",
    "python3 -c \"import sqlite3;sqlite3.connect('{sd}/guard.sqlite3').execute('delete from launches')\"",
    "python3 -c \"import shutil;p='{plan}';shutil.copyfile('/tmp/n.json',p)\"",
    'python3 {root}/staffing.py reset --plan {plan}',
    'python3 {root}/staffing.py status --plan {plan}; python3 {root}/staffing.py finish --plan {plan}',
    'perl -pi -e s/a/b/ {plan}',
])
def test_bash_interpreter_real_writes_still_refused(env, cmd):
    plan = armed(env)
    rc, out = env.pre('Bash', {'command': cmd.format(plan=plan, proj=env.proj, sd=env.sd, root=ROOT)})
    assert rc == 2 and 'governs the session' in out, (cmd, out)
