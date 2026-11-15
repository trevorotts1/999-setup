#!/usr/bin/env python3
# test_option3_runner_lock.py — the Option-3 lock is exclusive under real contention.
#
# The runner's lock used to be check-then-write: eight `check` calls started at the same
# moment could all read "free" and all take it. This test starts eight real operating
# system processes on a multiprocessing barrier and requires exactly one to acquire. A
# second test plants a stale lock and requires exactly one of eight to reclaim it.
#
# IT ACTIVATES NOTHING. acquire_lock and release_lock touch only the state folder: no
# child is started, no order is looked up, no network call is made.
#
# EXIT CODES
#   0  both tests passed
#   2  a test failed
#   3  the runner under test is missing
import importlib.util
import json
import multiprocessing
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, "option3_runner.py")
LOCK_NAME = "option3.lock.json"
WORKERS = 8
NOW = 1_000_000.0


def load_runner(path=None):
    path = path or RUNNER
    spec = importlib.util.spec_from_file_location("opt3_lock_%d" % os.getpid(), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _racer(runner, state, now, barrier, queue):
    """One real process: wait at the barrier, then race for the lock exactly once."""
    try:
        mod = load_runner(runner)
        barrier.wait(timeout=60)
        ok, why = mod.acquire_lock(state, "Lock Test", now=now)
        queue.put((os.getpid(), bool(ok), why))
    except BaseException as exc:            # never leave the parent waiting on a dead worker
        queue.put((os.getpid(), False, "%s: %s" % (type(exc).__name__, exc)))


def _race(state, now=NOW):
    ctx = multiprocessing.get_context("spawn")
    barrier = ctx.Barrier(WORKERS)
    queue = ctx.Queue()
    procs = [ctx.Process(target=_racer, args=(RUNNER, state, now, barrier, queue))
             for _ in range(WORKERS)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(120)
    for p in procs:
        if p.is_alive():
            p.terminate()
    results = []
    for _ in range(WORKERS):
        try:
            results.append(queue.get(timeout=10))
        except Exception:
            break
    assert len(results) == WORKERS, "only %d of %d racers reported: %r" % (
        len(results), WORKERS, results)
    return results


def _state(prefix):
    return tempfile.mkdtemp(prefix=prefix)


def _assert_one_winner(state, results, verb):
    winners = [r for r in results if r[1]]
    assert len(winners) == 1, "exactly one racer must %s, got %r" % (verb, winners)
    pid, ok, why = winners[0]
    assert ok and why == "acquired", winners[0]
    path = os.path.join(state, LOCK_NAME)
    assert os.path.isfile(path), "the winner left no lock file"
    with open(path, encoding="utf-8") as fh:
        record = json.load(fh)
    assert record.get("pid") == pid, "the lock file names %r, not the winner %d" % (
        record.get("pid"), pid)
    return winners[0]


def test_eight_racers_exactly_one_acquires():
    """Eight processes start on one barrier; one lock, one winner."""
    state = _state("opt3-lock-race-")
    try:
        _assert_one_winner(state, _race(state), "acquire")
    finally:
        shutil.rmtree(state, ignore_errors=True)


def test_one_of_eight_reclaims_a_stale_lock():
    """A planted stale lock is reclaimed by exactly one of eight."""
    state = _state("opt3-lock-stale-")
    try:
        mod = load_runner()
        stale = {"pid": 1, "client": "Gone",
                 "started_epoch": NOW - mod.LOCK_STALE_S - 60}
        with open(os.path.join(state, LOCK_NAME), "w", encoding="utf-8") as fh:
            json.dump(stale, fh)
        _assert_one_winner(state, _race(state), "reclaim")
    finally:
        shutil.rmtree(state, ignore_errors=True)


TESTS = [
    ("eight_racers_exactly_one_acquires", test_eight_racers_exactly_one_acquires),
    ("one_of_eight_reclaims_a_stale_lock", test_one_of_eight_reclaims_a_stale_lock),
]


def main():
    if not os.path.isfile(RUNNER):
        sys.stderr.write("AF-DS-OPT3-LOCK: runner under test is missing: %s\n" % RUNNER)
        return 3
    failures = 0
    for name, fn in TESTS:
        try:
            fn()
            print("ok    %s" % name)
        except Exception as exc:
            failures += 1
            print("FAIL  %s -- %s: %s" % (name, type(exc).__name__, exc))
    if failures:
        sys.stderr.write("AF-DS-OPT3-LOCK: %d of %d tests failed\n" % (failures, len(TESTS)))
        return 2
    print("test_option3_runner_lock: %d tests, exactly one caller holds the lock" % len(TESTS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
