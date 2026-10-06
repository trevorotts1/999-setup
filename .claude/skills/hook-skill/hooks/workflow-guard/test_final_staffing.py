"""Final staffing rules: #5 exact concurrency window (min(cap, units)), #6 actual-model/writer proof, release (c) removal."""
import importlib.util, json, os, re, shutil, subprocess, sys
from pathlib import Path
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import staffing as st

NODE = os.environ.get('WORKFLOW_GUARD_NODE') or shutil.which('node') or ''


@pytest.fixture(autouse=True)
def _probe(monkeypatch):
    monkeypatch.setattr(st, 'PROBE', lambda: {'per_workflow_cap': 10})


def gen(tmp_path, n_units, cap, windowed_override=None):
    """Run the real make-workflow.py plan mode in-process; returns (script text, launch args)."""
    root = tmp_path / 'p'; root.mkdir(parents=True)
    st._mkplan(root, {'W0-01': n_units}, cap=cap)
    spec = importlib.util.spec_from_file_location('mkwf', HERE / 'make-workflow.py'); mk = importlib.util.module_from_spec(spec); spec.loader.exec_module(mk)
    out = tmp_path / 'o'
    mk.plan_main(['--plan', str(root / 'SWARM-PLAN.json'), '--workflow-id', 'W0-01', '--out-dir', str(out), '--state-dir', str(tmp_path / 'sd')])
    return (out / 'workflow-W0-01.js').read_text(), json.loads((out / 'launch-W0-01.json').read_text())['args']


def validate(script, args, cap):
    r = subprocess.run([NODE, str(HERE / 'validate.mjs')], input=json.dumps({'script': script, 'args': args, 'windowHelper': st.WINDOW_HELPER}), text=True, capture_output=True, env={**os.environ, 'WORKFLOW_GUARD_CAP': str(cap)})
    return json.loads(r.stdout)


def rewindow(script, args, n_window):
    """Tamper: same script, but the window helper says n_window (and the name's lane count follows the real peak)."""
    return script.replace(re.search(r'const WG_WINDOW = \d+;', script).group(0), 'const WG_WINDOW = %d;' % n_window)


def test_generated_plan_mode_script_is_exact(tmp_path):
    s7, a7 = gen(tmp_path / 'a', 7, 10)
    assert 'wgSlot' not in s7 and "label:'build:'+u.unit_id" in s7.replace('"', "'") and "label:'qc:'+u.unit_id" in s7.replace('"', "'")
    r = validate(s7, a7, 10)
    assert r['ok'] and r['conservativePeak'] == 7, r
    s12, a12 = gen(tmp_path / 'b', 12, 10)
    assert 'const WG_WINDOW = 10;' in s12
    r = validate(s12, a12, 10)
    assert r['ok'] and r['conservativePeak'] == 10, r
    s8, a8 = gen(tmp_path / 'c', 8, 6)
    assert 'const WG_WINDOW = 6;' in s8 and validate(s8, a8, 6)['ok']


def test_validate_refuses_window_1_for_12_units_because_window_must_equal_cap(tmp_path):
    s, a = gen(tmp_path, 12, 10)
    r = validate(rewindow(s, a, 1).replace('-10L', '-1L'), a, 10)
    assert not r['ok'] and any('exactly the cap 10' in e or 'must equal agent_count' in e for e in r['errors']), r
    r = validate(rewindow(s, a, 9).replace('-10L', '-9L'), a, 10)
    assert not r['ok'] and any('exactly the cap 10' in e for e in r['errors']), r


def test_validate_refuses_window_helper_when_units_fit_the_cap(tmp_path):
    s, a = gen(tmp_path / 'x', 7, 10)
    # take the 12-unit windowed shape and point it at 7 units: window helper is forbidden when units <= cap
    s12, _ = gen(tmp_path / 'y', 12, 10)
    wrapped = s12.replace('-10L', '-7L')
    r = validate(wrapped, a, 10)
    assert not r['ok'] and any('forbidden' in e for e in r['errors']), r


def test_window_problem_reasons():
    helper = lambda n: st.window_helper(n) + "pipeline(args.units, (u) => wgSlot(() => agent('b', {model:'opus',phase:'Build',label:'x'})), (b,u) => wgSlot(() => agent('c', {model:'sonnet',phase:'QC',label:'y'})))"
    plain = "pipeline(args.units, (u) => agent('b', {model:'opus',phase:'Build',label:'x'}), (b,u) => agent('c', {model:'sonnet',phase:'QC',label:'y'}))"
    assert 'forbidden' in st.window_problem(helper(1), 10, 7)
    assert 'forbidden' in st.window_problem(helper(10), 10, 7)
    assert st.window_problem(helper(10), 10, 12) is None
    assert 'exactly 10' in st.window_problem(helper(9), 10, 12)
    assert st.window_problem(helper(6), 6, 8) is None
    assert st.window_problem(plain, 10, 7) is None
    assert 'exactly 6' in st.window_problem(plain, 6, 8)


def _mk_done(tmp_path, builder='opus', checker='sonnet', writer='qc'):
    root = tmp_path / 'pl'; root.mkdir(parents=True)
    plan = st._mkplan(root, {'W0-01': 2}); doc = json.loads(plan.read_text())
    st._verdict(root, 'W0-01')  # JSON claims opus vs sonnet regardless of what really ran
    st._mkrun(root, 'W0-01', builder=builder, checker=checker)
    return plan, doc, st._file_records(root, 'W0-01'), st._proof(root, 'W0-01', writer)


def test_done_needs_qc_labelled_writer_and_different_actual_families(tmp_path):
    plan, doc, rec, proof = _mk_done(tmp_path / '1')
    assert st.compute(plan, doc, attempts={'W0-01': {'A1'}}, records=rec, proof=proof)['done'] == ['W0-01']
    plan, doc, rec, proof = _mk_done(tmp_path / '2', writer='bu')  # builder wrote its own PASS (A4a)
    assert st.compute(plan, doc, attempts={'W0-01': {'A1'}}, records=rec, proof=proof)['done'] == []
    plan, doc, rec, proof = _mk_done(tmp_path / '3', builder='opus', checker='claude-opus-4-5')  # both actually opus (A4b)
    assert st.compute(plan, doc, attempts={'W0-01': {'A1'}}, records=rec, proof=proof)['done'] == []
    plan, doc, rec, proof = _mk_done(tmp_path / '4')
    assert st.compute(plan, doc, attempts={'W0-01': {'A1'}}, records=rec)['done'] == []  # no proof: fail closed


def test_actual_models_unreadable_is_not_done(tmp_path):
    plan, doc, rec, proof = _mk_done(tmp_path)
    for f in (tmp_path / 'pl' / '.tx').rglob('agent-qc-*.meta.json'):
        f.unlink()
    assert st.compute(plan, doc, attempts={'W0-01': {'A1'}}, records=rec, proof=proof)['done'] == []


def test_launch_script_with_same_family_pins_is_refused():
    s = "pipeline(args.units, (u) => agent('b', {model:'opus',phase:'Build',label:'x'}), (b,u) => agent('c', {model:'claude-opus-4-5',phase:'QC',label:'y'}))"
    assert 'share the family' in st.family_pin_problem(s)
    assert st.family_pin_problem(s.replace('claude-opus-4-5', 'sonnet')) is None


def test_release_c_logic_removed():
    assert not hasattr(st, 'RELEASE_ATTEMPTS') and 'failed' not in st._empty_view()
