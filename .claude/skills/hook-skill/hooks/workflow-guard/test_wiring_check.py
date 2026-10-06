"""Wiring self-check (Layer 3): SessionStart reads the ACTIVE config dir's settings and warns loudly when a required
registration is missing or weaker. Temp settings, temp state, never rewrites settings."""
import copy, importlib.util, io, json, os, tempfile
from contextlib import redirect_stdout
from pathlib import Path
import pytest

os.environ['WORKFLOW_GUARD_STATE'] = tempfile.mkdtemp(prefix='wg-wiring-')
spec = importlib.util.spec_from_file_location('guard', Path(__file__).resolve().parent / 'guard.py')
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

PRE = 'Workflow|Agent|Task|SendMessage|TaskOutput|Edit|Write|MultiEdit|NotebookEdit|Bash'
POST = 'Workflow|TaskStop|Agent|Task|TaskOutput|Write'


def entry(script, matcher=None, timeout=120):
    e = {'hooks': [{'type': 'command', 'command': 'python3 /h/hooks/%s hook' % script, 'timeout': timeout}]}
    return {'matcher': matcher, **e} if matcher else e


def complete():
    return {'env': {'CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS': '4'}, 'hooks': {
        'SessionStart': [entry('workflow-guard/guard.py')], 'UserPromptSubmit': [entry('workflow-guard/guard.py')],
        'Stop': [entry('workflow-guard/guard.py')],
        'PreToolUse': [entry('workflow-guard/guard.py', PRE), entry('dispatch-gate.py', 'Workflow|Agent|Task|SendMessage')],
        'PostToolUse': [entry('workflow-guard/guard.py', POST)],
        'PostToolUseFailure': [entry('workflow-guard/guard.py', '.*')]}}


@pytest.fixture
def box(tmp_path, monkeypatch):
    monkeypatch.setenv('HOME', str(tmp_path))
    cfg = tmp_path / 'cfg'; (cfg / 'hooks').mkdir(parents=True)
    (cfg / 'hooks' / 'dispatch-gate.py').write_text('# present')
    monkeypatch.setenv('CLAUDE_CONFIG_DIR', str(cfg))
    def put(doc):
        (cfg / 'settings.json').write_text(json.dumps(doc))
    return put, cfg


def session_start():
    out = io.StringIO()
    with redirect_stdout(out):
        assert g.hook({'hook_event_name': 'SessionStart', 'session_id': 's-wire'}) == 0
    return json.loads(out.getvalue())['hookSpecificOutput']['additionalContext']


def test_complete_is_silent(box):
    put, _ = box; put(complete())
    assert g.wiring_problems() == []
    assert 'HOOK WIRING INCOMPLETE' not in session_start()


def test_missing_write_matcher_names_it(box):
    put, _ = box; d = complete()
    d['hooks']['PreToolUse'][0]['matcher'] = PRE.replace('|Write', '')
    put(d)
    ctx = session_start()
    assert 'HOOK WIRING INCOMPLETE' in ctx and 'missing Write' in ctx
    assert 'Enforcement is degraded. Re-run the Hook Skill installer.' in ctx


def test_missing_dispatch_gate_warns(box):
    put, _ = box; d = complete()
    d['hooks']['PreToolUse'].pop(1)
    put(d)
    assert 'dispatch-gate.py registration' in session_start()


def test_dispatch_gate_not_required_when_not_installed(box):
    put, cfg = box; d = complete()
    d['hooks']['PreToolUse'].pop(1); put(d)
    (cfg / 'hooks' / 'dispatch-gate.py').unlink()
    assert g.wiring_problems() == []


def test_short_timeout_warns(box):
    put, _ = box; d = complete()
    d['hooks']['PreToolUse'][0]['hooks'][0]['timeout'] = 10
    put(d)
    ctx = session_start()
    assert 'timeout is 10' in ctx and 'needs >= 120' in ctx


def test_missing_env_and_missing_event_warn(box):
    put, _ = box; d = complete()
    del d['env']['CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS']; del d['hooks']['Stop']
    put(d)
    p = ' '.join(g.wiring_problems())
    assert 'CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS' in p and 'Stop has no workflow-guard/guard.py' in p


def test_missing_or_broken_settings_warns(box):
    put, cfg = box
    assert 'missing or not valid JSON' in ' '.join(g.wiring_problems())
    (cfg / 'settings.json').write_text('{not json')
    assert 'missing or not valid JSON' in ' '.join(g.wiring_problems())


def test_alert_written_and_cleared(box):
    put, cfg = box; d = complete(); d['hooks'].pop('Stop'); put(d)
    session_start()
    st = Path(g.STATE)
    assert 'HOOK_WIRING_INCOMPLETE' in (st / 'alerts.json').read_text()
    assert 'HOOK WIRING INCOMPLETE' in (st / 'STATUS.md').read_text()
    put(complete()); session_start()
    assert not g.read_rows("SELECT 1 FROM plan_alerts WHERE key=?", ('wiring|' + str(cfg / 'settings.json'),))


def test_never_rewrites_settings(box):
    put, cfg = box; d = complete(); d['hooks'].pop('Stop'); put(d)
    before = (cfg / 'settings.json').read_bytes()
    session_start()
    assert (cfg / 'settings.json').read_bytes() == before


def test_active_dir_defaults_to_home_claude(tmp_path, monkeypatch):
    monkeypatch.setenv('HOME', str(tmp_path)); monkeypatch.delenv('CLAUDE_CONFIG_DIR', raising=False)
    assert g.active_settings() == tmp_path / '.claude' / 'settings.json'
