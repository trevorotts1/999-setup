#!/usr/bin/env python3
"""ACC-046 proof: caps are running-at-once, atomic at launch, and dead runs reap.

Stdlib only. Runs against an isolated state dir so it never touches the live guard.
Each check is an assert, so a failure is a non-zero exit with the real numbers.
"""
import atexit, importlib.util, os, shutil, sqlite3, sys, tempfile, threading, time
from pathlib import Path

ROOT = Path(os.environ.get('WG_ROOT') or Path(__file__).resolve().parent)
STATE = Path(tempfile.mkdtemp(prefix='wg-a46-'))
atexit.register(shutil.rmtree, STATE, True)  # removed at exit, pass or fail
os.environ['WORKFLOW_GUARD_STATE'] = str(STATE)

spec = importlib.util.spec_from_file_location('guard', ROOT / 'guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

def reset():
    for p in STATE.glob('guard.sqlite3*'):
        p.unlink()
    f = STATE / 'limits.json'
    if f.exists():
        f.unlink()

def raw():
    guard.db().close()  # ensure the schema exists (reset() may have removed it)
    c = sqlite3.connect(STATE / 'guard.sqlite3', timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    return c

def launch_row(ident, session, peak=1, created=None, state='VALIDATED'):
    return (ident, session, '/tmp/t.jsonl', time.time() if created is None else created,
            'sha-' + ident, state, 'wf-' + ident, peak, '')

def occ():
    c = raw()
    try:
        return guard.occupancy(c)
    finally:
        c.close()

def test_1_running_at_once_not_cumulative():
    reset()
    c = raw()
    c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', launch_row('a', 's1'))
    c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', launch_row('b', 's1'))
    c.commit(); c.close()
    o = occ()
    assert o['workflows'] == 2, 'two live launches in one program must count 2, got %r' % o
    assert o['per_program']['s1'] == 2, 'per-program count wrong: %r' % o
    # A finished run is not load: release one and the same program drops to 1.
    c = raw()
    c.execute("UPDATE launches SET state='REAPED' WHERE id='a'")
    c.commit(); c.close()
    o = occ()
    assert o['workflows'] == 1, 'finished run must stop counting, got %r' % o
    assert o['per_program']['s1'] == 1, 'per-program count wrong after finish: %r' % o
    print('PASS test_1_running_at_once_not_cumulative: live=2 after one finish=1 (cumulative would read 2)')

def test_2_atomic_cap_thirty_threads():
    reset()
    assert guard.limits()['concurrent_workflows_per_program'] == 50, 'default per-program cap must be 50'
    # Lower the cap the way the operator does, so the race tests the enforced value.
    guard.write_limits()
    (STATE / 'limits.json').write_text('{"concurrent_workflows_per_program": 10}')
    cap = guard.limits()['concurrent_workflows_per_program']
    assert cap == 10, 'operator cap must apply, got %r' % cap
    n = 30
    barrier = threading.Barrier(n)
    out = [None] * n

    def worker(i):
        barrier.wait()
        out[i] = guard.admit_launch(launch_row('x%02d' % i, 'race'))

    ts = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in ts: t.start()
    for t in ts: t.join()
    admitted = [r for r in out if r is None]
    refused = [r for r in out if r]
    c = raw()
    rows = c.execute("SELECT COUNT(*) n FROM launches WHERE state='VALIDATED'").fetchone()['n']
    c.close()
    assert len(admitted) == cap, 'cap %d: exactly %d must be admitted, got %d' % (cap, cap, len(admitted))
    assert len(refused) == n - cap, 'exactly %d must be refused, got %d' % (n - cap, len(refused))
    assert rows == cap, 'ledger must hold exactly %d live rows, got %d' % (cap, rows)
    assert len(admitted) + len(refused) == n, 'every launch must get a verdict'
    print('PASS test_2_atomic_cap_thirty_threads: %d admitted, %d refused, %d live rows, cap %d never exceeded'
          % (len(admitted), len(refused), rows, cap))

def test_3_aged_session_is_reaped():
    reset()
    old = time.time() - 100000
    c = raw()
    c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', launch_row('g', 'ghost', created=old))
    c.commit()
    c.execute("INSERT INTO session_liveness VALUES('ghost',?)", (old,))
    c.commit(); c.close()
    assert occ()['workflows'] == 0, 'a session silent past the lease must not count'
    c = raw()
    row = c.execute("SELECT state FROM launches WHERE id='g'").fetchone()
    live = c.execute("SELECT COUNT(*) n FROM session_liveness WHERE session='ghost'").fetchone()['n']
    c.close()
    assert row['state'] == 'REAPED', 'dead launch must be released, got %r' % row['state']
    assert live == 0, 'dead session liveness row must be dropped, got %d' % live
    print('PASS test_3_aged_session_is_reaped: aged session counted 0, launch REAPED, liveness row dropped')

def test_4_backfilled_row_aged_from_its_own_creation():
    reset()
    old = time.time() - 100000
    c = raw()
    c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)', launch_row('h', 'legacy', created=old))
    c.commit(); c.close()
    # No liveness row exists: it must age from the launch's own creation, not read live.
    assert occ()['workflows'] == 0, 'legacy row aged past the lease must not count'
    c = raw()
    st = c.execute("SELECT state FROM launches WHERE id='h'").fetchone()['state']
    c.close()
    assert st == 'REAPED', 'legacy row must be released, got %r' % st
    print('PASS test_4_backfilled_row_aged_from_its_own_creation: legacy row REAPED from its own created time')

def test_5_finished_run_reaped_from_its_own_journals():
    reset()
    t = STATE / 'sess' / 'transcript.jsonl'
    t.parent.mkdir(parents=True, exist_ok=True)
    d = t.parent / 'transcript' / 'subagents' / 'workflows' / 'wf_run1' / 'journal.jsonl'
    c = raw()
    c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)',
              ('fin', 's-fin', str(t), time.time(), 'sha-fin', 'VALIDATED', 'wf-fin', 2, ''))
    # No journal yet: the run stays live, because absence is not evidence.
    assert occ()['workflows'] == 1, 'a launch with no journal yet must stay live, got %r' % occ()
    c.execute('INSERT INTO watches VALUES(?,?,?,?,?,?)', (str(d), 's-fin', time.time(), '', 'AGENTS_RETURNED', ''))
    c.commit(); c.close()
    o = occ()
    assert o['workflows'] == 0, 'a run whose journals all returned must stop counting, got %r' % o
    c = raw()
    st = c.execute("SELECT state FROM launches WHERE id='fin'").fetchone()['state']
    c.close()
    assert st == 'COMPLETED', 'finished launch must be released, got %r' % st
    print('PASS test_5_finished_run_reaped_from_its_own_journals: live with no journal, COMPLETED once its journal returned')

def test_6_operator_limits_are_read_from_config():
    reset()
    f = guard.write_limits()
    assert f == STATE / 'limits.json', 'limits file must live in the state dir, got %r' % f
    assert guard.limits() == guard.LIMITS_DEFAULTS, 'defaults must be exactly 10/50/500 + lease, got %r' % guard.limits()
    f.write_text('{"concurrent_workflows_per_program": 2, "concurrent_agents_total": 7}')
    lim = guard.limits()
    assert lim['concurrent_workflows_per_program'] == 2, 'operator value must win, got %r' % lim
    assert lim['concurrent_agents_total'] == 7, 'operator value must win, got %r' % lim
    assert lim['concurrent_agents_per_workflow'] == 10, 'unset key must keep its default, got %r' % lim
    # The operator's lowered cap is what admit enforces.
    for i in range(2):
        assert guard.admit_launch(launch_row('c%d' % i, 'cfg')) is None
    refusal = guard.admit_launch(launch_row('c3', 'cfg'))
    assert refusal, 'third launch must be refused under the operator cap of 2'
    assert occ()['workflows'] == 2, 'exactly 2 live under operator cap, got %r' % occ()
    print('PASS test_6_operator_limits_are_read_from_config: config wins over defaults; %r' % lim)

if __name__ == '__main__':
    fails = 0
    for fn in (test_1_running_at_once_not_cumulative,
               test_2_atomic_cap_thirty_threads,
               test_3_aged_session_is_reaped,
               test_4_backfilled_row_aged_from_its_own_creation,
               test_5_finished_run_reaped_from_its_own_journals,
               test_6_operator_limits_are_read_from_config):
        try:
            fn()
        except AssertionError as e:
            fails += 1
            print('FAIL %s: %s' % (fn.__name__, e))
        except Exception as e:
            fails += 1
            print('ERROR %s: %s: %s' % (fn.__name__, type(e).__name__, e))
    print('---')
    print('OK: all checks passed' if not fails else 'FAILED: %d check(s)' % fails)
    sys.exit(1 if fails else 0)
