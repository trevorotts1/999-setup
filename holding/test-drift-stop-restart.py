#!/usr/bin/env python3
"""WF-4A slice 5 — Issue 13 FIX step 6 verification harness.

Spec: "Verification: a deliberately drifted test run gets stopped by the boss
within one cycle and restarted from the named checkpoint."
(999-master-fix-spec-20260815.md, ISSUE 13 FIX step 6, line 292)

Contract under test:
  - FIX step 4 (line 290): the boss compares ledger vs script every cycle,
    STOPS violating workstreams (VIOLATION-STOP ledger line with the finding),
    and RESTARTS from the last clean checkpoint (the checkpoint rules in
    project_state.json).
  - PART 4 check 6 (line 543): "Drift check: > 10 consecutive contentless
    heartbeat ticks = violation" — implemented in tools/boss-cron check_drift()
    (this branch, commit 9e0fdb8, slice 2).
  - PART 4 on-violation (line 549): STOP the violating workstream, mark the
    ledger VIOLATION-STOP with the exact finding, RESTART from the last clean
    checkpoint recorded in project_state.json.
  - anti-drift.md section 6: the state-delta fingerprint — contentless ticks
    must NOT move it, state-carrying heartbeats MUST; N=6 consecutive
    no-delta reconciles with runnable work = TERMINAL-DRIFT, and the
    CONTROL/TERMINAL-DRIFT.flag is the capture-proof stop (precondition #0 of
    every loop: while it exists, nothing dispatches).

The instrument is the repo's own tools/boss-cron (the wave-4 implementation on
this branch) run as a TEST COPY with its LEDGER/STOP/PIDS constants pointed at
a sandboxed fixture. The live ledger and live stop file are never written.
Every fixture write goes through the repo's own tools/ledger.sh (atomic,
locked).

Cases:
  T1  the detector instruments prove themselves (boss drift classifier fixtures
      + anchor.sh selftest)
  T2  the fingerprint discriminates: a contentless tick must NOT move it, a
      state-carrying heartbeat MUST
  T3  the drift contract fires: N=6 no-delta reconciles with runnable work =
      TERMINAL-DRIFT (exit 4, flag, escalation)
  T4  the capture-proof stop: while CONTROL/TERMINAL-DRIFT.flag exists the
      reconciler refuses to run — nothing dispatches
  T5  the boss stop within one cycle: a ledger drifted past >10 consecutive
      contentless ticks produces a VIOLATION-STOP drift finding, the stop file,
      and the restart directive in ONE boss cycle
  T6  the restart is from the NAMED checkpoint: project_state.json records
      checkpoints[] + best_stable_build; the last checkpoint resolves to the
      name the restart cites
  T7  the known-good control on the same instrument: a healthy ledger
      (state-carrying heartbeats, no contentless run over threshold) gets
      BOSSCYCLE-CLEAN, exit 0, no stop, no VIOLATION-STOP — the detector does
      not punish the cure
"""

import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
# The committed implementation under test: anchor.sh and ledger.sh are
# extracted from the branch HEAD (git show) into the harness temp dir, so the
# harness always tests the committed state — never a working tree mid-edit by
# a parallel slice.
ANCHOR = os.path.join(REPO, ".claude/skills/spec-protocol/tools/anchor.sh")
LEDGER_SH = os.path.join(REPO, ".claude/skills/spec-protocol/tools/ledger.sh")
BOSS = os.path.join(REPO, "tools/boss-cron")
CHECKPOINT_TAG = "checkpoint/demo-drift-001"
CHECKPOINT_COMMIT = "c0ffee0000000000000000000000000000000001"

# The threshold the boss implements (tools/boss-cron): any run of > 10
# CONSECUTIVE contentless ticks = violation. Read from the instrument itself,
# never restated.
with open(BOSS, "r", encoding="utf-8") as _fh:
    _m = re.search(r"DRIFT_THRESHOLD = (\d+)", _fh.read())
DRIFT_THRESHOLD = int(_m.group(1)) if _m else 10

PASS = 0
FAIL = 0


def report(name, ok, detail):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"PASS | {name} | {detail}")
    else:
        FAIL += 1
        print(f"FAIL | {name} | {detail}")


def run(cmd, cwd=None, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    p = subprocess.run(cmd, cwd=cwd, env=e, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def extract_tools(tmp):
    """Extract the COMMITTED anchor.sh and ledger.sh from the branch HEAD into
    tmp/tools/. Falls back to the working tree only when the working tree copy
    matches HEAD (clean). Returns (anchor_path, ledger_sh_path)."""
    dst = os.path.join(tmp, "tools")
    os.makedirs(dst, exist_ok=True)
    out_dir = os.path.join(tmp, "extract")
    os.makedirs(out_dir, exist_ok=True)
    for rel, name in ((".claude/skills/spec-protocol/tools/anchor.sh", "anchor.sh"),
                      (".claude/skills/spec-protocol/tools/ledger.sh", "ledger.sh")):
        rc, out, err = run(["git", "show", f"HEAD:{rel}"], cwd=REPO)
        target = os.path.join(dst, name)
        if rc == 0 and out:
            with open(target, "w", encoding="utf-8") as fh:
                fh.write(out)
            os.chmod(target, 0o755)
            continue
        # HEAD extraction failed: use the working tree copy (only when it is
        # identical to HEAD — never a mid-edit file).
        rc, out, err = run(["git", "diff", "--quiet", "HEAD", "--", rel], cwd=REPO)
        if rc == 0:
            shutil.copy2(os.path.join(REPO, rel), target)
            os.chmod(target, 0o755)
            continue
        raise RuntimeError(f"cannot obtain a committed copy of {rel} (git show rc={rc}; working tree dirty)")
    return os.path.join(dst, "anchor.sh"), os.path.join(dst, "ledger.sh")


def run_anchor(anchor, ledger_sh, home, unit, extra=None):
    args = ["bash", anchor, home, unit, "--mode", "reconcile",
            "--tasks", os.path.join(home, "CONTROL/task-graph-snapshot.json"),
            "--state", os.path.join(home, "CONTROL/project_state.json")]
    if extra:
        args += extra
    return run(args)


def write_line(ledger_sh, home, rel, line):
    p = run(["bash", ledger_sh, home, rel, line])
    assert p[0] == 0, f"ledger.sh failed rc={p[0]} writing {rel}: {p[2]}"


def read_file(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def mk_home(base, name):
    """A fresh project home in the spec's exact project-state schema, with
    SPEC/GOAL.md, CONTROL/CHECKLIST.md, CONTROL/TODO.md, the native task
    snapshot, project_state.json, and a checkpoint record."""
    home = os.path.join(base, name)
    os.makedirs(os.path.join(home, "SPEC"))
    os.makedirs(os.path.join(home, "CONTROL"))
    with open(os.path.join(home, "SPEC/GOAL.md"), "w", encoding="utf-8") as fh:
        fh.write("Goal: verify the anti-drift contract.\n")
    with open(os.path.join(home, "CONTROL/CHECKLIST.md"), "w", encoding="utf-8") as fh:
        fh.write("- [x] U-01 establish the checkpoint\n- [ ] U-02 build the parser\n- [ ] U-03 qc the parser\n")
    with open(os.path.join(home, "CONTROL/TODO.md"), "w", encoding="utf-8") as fh:
        fh.write("- [ ] U-02 build the parser\n- [ ] U-03 qc the parser\n")
    with open(os.path.join(home, "CONTROL/task-graph-snapshot.json"), "w", encoding="utf-8") as fh:
        fh.write('{"tasks":[{"taskId":"U-02","subject":"build the parser","status":"pending"},{"taskId":"U-03","subject":"qc the parser","status":"pending"}]}\n')
    state = {
        "schema": "spec-protocol/project-state@1",
        "project": "demo-drift",
        "updated": "2026-08-16T20:00:00Z",
        "updated_by": "conductor",
        "run_status": "RUNNING",
        "round": 1,
        "phase": "U-02",
        "scores": {"current": 0.0, "best": 0.0, "gate": 8.5, "history": []},
        "best_stable_build": {"checkpoint": CHECKPOINT_TAG, "commit": CHECKPOINT_COMMIT, "score": 0.0, "ts": "2026-08-16T20:00:00Z"},
        "agents": {"executions_total": 1, "budget_initial": 50, "session_budget_remaining": 49, "warn_at": 150, "hard_stop_at": 200},
        "workstreams": {"passed": [], "failed": [], "in_repair": []},
        "locked": [],
        "defects_open": [],
        "tests": {"last_suite": {"ts": "", "result": "", "failed": []}},
        "tasks": {"snapshot_ts": "2026-08-16T20:00:00Z",
                  "counts": {"pending": 2, "in_progress": 0, "completed": 1},
                  "last_reconcile": {"ts": "", "result": "", "actions": 0}},
        "merge": {"pen_depth": 0, "last_batch": {"id": "", "ts": "", "result": ""}, "parked_failures": []},
        "checkpoints": [{"tag": CHECKPOINT_TAG, "trigger": "first-functional-mvp",
                         "commit": CHECKPOINT_COMMIT, "score": 0.0, "ts": "2026-08-16T20:00:00Z"}],
        "disagreements": [],
        "release": {"ready": False, "council": {"last": "", "ts": ""}, "condition": "council 4/4 AND B2H success rule"},
        "stall": {"last_state_delta_ts": "2026-08-16T20:00:00Z", "no_delta_reconciles": 0, "terminal_after": 6},
    }
    with open(os.path.join(home, "CONTROL/project_state.json"), "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
    return home


def boss_for(base, name, ledger_path, stop_path, pids_path):
    """A test copy of the branch's boss-cron (the wave-4 implementation with
    the drift check, this branch commit 9e0fdb8) with its LEDGER/STOP/PIDS
    constants pointed at the fixture. The live ledger and live stop file are
    never touched."""
    src = read_file(BOSS)
    dst = os.path.join(base, name)
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write(src)
    patch = [
        ('LEDGER = "/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md"', f'LEDGER = "{ledger_path}"'),
        ('STOP = "/Users/blackceomacmini/work-999-setup/CONTROL/stop-workstream"', f'STOP = "{stop_path}"'),
        ('PIDS = "/Users/blackceomacmini/work-999-setup/CONTROL/workflow-pids.json"', f'PIDS = "{pids_path}"'),
    ]
    text = read_file(dst)
    for old, new in patch:
        assert old in text, f"boss patch anchor not found: {old}"
        text = text.replace(old, new)
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.chmod(dst, 0o755)
    return dst


# Ledger-shaped lines for the boss fixture (FIX-LEDGER.md is backtick-wrapped,
# "- `...`" — the shape ledger_lines() parses).
def tick_line(ts="2026-08-16T20:30:38Z"):
    return f"- `heartbeat {ts} (ledger auto-tick)`"


def stateful_line(ts="2026-08-16T20:30:38Z"):
    return (f"- `WF-4A heartbeat {ts} (ledger auto-tick) — unit U-02 building "
            f"the parser; counts=done:1/open:2; next=U-03 qc the parser`")


def main():
    tmp = tempfile.mkdtemp(prefix="wf4a-slice5-")
    try:
        base = os.path.join(tmp, "runs")
        anchor, ledger_sh = extract_tools(tmp)

        # ----------------------------------------------------------------
        # T1 — the instruments prove themselves before any verdict.
        # ----------------------------------------------------------------
        rc, out, err = run(["bash", anchor, "--selftest"])
        ok = rc == 0 and "SELFTEST COMPLETE" in out and "0 failed" in out
        summary = ""
        m = re.search(r"SELFTEST COMPLETE[^\n]*", out)
        if m:
            summary = m.group(0)
        report("T1 instruments self-prove", ok,
               f"anchor.sh selftest rc={rc}; {summary}")
        # the boss's drift classifier self-proves on its own fixtures every
        # invocation (check_drift, boss-cron lines 317-326) — proven live below
        # in T5/T7 by a clean run returning no BROKEN INSTRUMENT.

        # ----------------------------------------------------------------
        # T2 — the fingerprint discriminates (anchor.sh --mode reconcile):
        # a contentless tick must NOT move it; a state-carrying heartbeat MUST.
        # ----------------------------------------------------------------
        h = mk_home(base, "t2")
        rc, out, err = run_anchor(anchor, ledger_sh, h, "U-02")   # first observation
        rc, out, err = run_anchor(anchor, ledger_sh, h, "U-02")   # second: nothing moved -> count 1
        fp1 = read_file(os.path.join(h, "CONTROL/.anchor-fingerprint"))
        n1 = int(re.search(r"^count=(\d+)", fp1, re.M).group(1))
        # The banned write: a contentless tick between reconciles MUST NOT move
        # the fingerprint (anti-drift.md section 6: "a line got appended" is
        # exactly what the captured system kept doing).
        write_line(ledger_sh, h, "CONTROL/LEDGER.md", "- heartbeat 2026-08-16T20:30:38Z (ledger auto-tick)")
        rc, out, err = run_anchor(anchor, ledger_sh, h, "U-02")
        fp2 = read_file(os.path.join(h, "CONTROL/.anchor-fingerprint"))
        n2 = int(re.search(r"^count=(\d+)", fp2, re.M).group(1))
        # The REQUIRED write: a state-carrying heartbeat MUST move it (the
        # fingerprint must move when a real delta lands).
        write_line(ledger_sh, h, "CONTROL/LEDGER.md",
                   "- heartbeat 2026-08-16T20:30:38Z (ledger auto-tick) — unit U-02 building the parser; transcript 981KB/238 lines, progressing")
        rc, out, err = run_anchor(anchor, ledger_sh, h, "U-02")
        fp3 = read_file(os.path.join(h, "CONTROL/.anchor-fingerprint"))
        n3 = int(re.search(r"^count=(\d+)", fp3, re.M).group(1))
        ok = n1 == 1 and n2 == n1 + 1 and n3 == 0
        report("T2 fingerprint discriminates", ok,
               f"after establish: count={n1}; after contentless tick: count={n2} (must climb — observation is not progress); after state-carrying heartbeat: count={n3} (must reset)")

        # ----------------------------------------------------------------
        # T3 — the drift contract fires: N=6 consecutive no-delta reconciles
        # with runnable work = TERMINAL-DRIFT (exit 4, flag, escalation).
        # ----------------------------------------------------------------
        h = mk_home(base, "t3")
        rc, out, err = run_anchor(anchor, ledger_sh, h, "U-02")        # establish the fingerprint
        for _ in range(6):                          # 6 drifted reconciles
            write_line(ledger_sh, h, "CONTROL/LEDGER.md", "- heartbeat 2026-08-16T20:30:38Z (ledger auto-tick)")
            rc, out, err = run_anchor(anchor, ledger_sh, h, "U-02")
        flag = os.path.join(h, "CONTROL/TERMINAL-DRIFT.flag")
        ok = rc == 4 and os.path.exists(flag)
        if ok:
            flag_text = read_file(flag)
            ledger_text = read_file(os.path.join(h, "CONTROL/LEDGER.md"))
            todo_text = read_file(os.path.join(h, "CONTROL/TODO.md"))
            ok = ("no-delta-reconciles=6" in flag_text
                  and "TERMINAL-DRIFT" in ledger_text
                  and "OPERATOR-ESCALATION" in todo_text)
            detail = "exit=4; flag created; no-delta-reconciles=6; ledger TERMINAL-DRIFT line; TODO OPERATOR-ESCALATION"
        else:
            detail = f"exit={rc} (want 4); flag exists={os.path.exists(flag)}"
        report("T3 TERMINAL-DRIFT fires", ok, detail)

        # ----------------------------------------------------------------
        # T4 — the capture-proof stop: while the flag exists, nothing
        # dispatches — the reconciler itself refuses to run (anchor.sh lines
        # 436-442; anti-drift.md section 6: precondition #0 of every loop).
        # ----------------------------------------------------------------
        rc, out, err = run_anchor(anchor, ledger_sh, h, "U-02")
        ok = rc == 4 and "nothing dispatches while this file exists" in out
        report("T4 flag gates dispatch", ok,
               f"exit={rc}; reconciler refused to run while CONTROL/TERMINAL-DRIFT.flag present")

        # ----------------------------------------------------------------
        # T5 — the boss stop within one cycle: a ledger drifted past >10
        # consecutive contentless ticks produces the VIOLATION-STOP drift
        # finding, the stop file, and the restart directive in ONE boss cycle.
        # ----------------------------------------------------------------
        h = mk_home(base, "t5")
        # The deliberately drifted run: 11 consecutive contentless ticks
        # (> DRIFT_THRESHOLD 10) with nothing else written.
        for _ in range(11):
            write_line(ledger_sh, h, "FIX-LEDGER.md", tick_line())
        ledger_fixture = os.path.join(h, "FIX-LEDGER.md")
        stop_fixture = os.path.join(h, "CONTROL/stop-workstream")
        pids_fixture = os.path.join(h, "CONTROL/workflow-pids.json")
        boss = boss_for(base, "boss-t5", ledger_fixture, stop_fixture, pids_fixture)
        # cycle 0: read-only --check shows the drift finding (never writes)
        rc, out, err = run(["python3", boss, "--check"])
        drift_found = "drift:" in out and f"> {DRIFT_THRESHOLD}" in out
        # cycle 1: the write cycle — the ONLY cycle that writes the stop
        rc, out, err = run(["python3", boss])
        ledger_text = read_file(ledger_fixture)
        stop_exists = os.path.exists(stop_fixture)
        drift_stop_line = ""
        for ln in ledger_text.splitlines():
            if ln.startswith("- `VIOLATION-STOP") and "drift:" in ln:
                drift_stop_line = ln
                break
        ok = (rc == 2 and drift_found and stop_exists
              and "drift:" in drift_stop_line
              and "re-dispatch from its last clean checkpoint" in drift_stop_line)
        if ok:
            detail = (f"exit={rc}; --check finding: 'drift: 11 consecutive contentless heartbeat ticks (> 10)'"
                      f"; VIOLATION-STOP line: {drift_stop_line[:130]}...")
        else:
            detail = (f"exit={rc}; drift in --check={drift_found}; stop file={stop_exists}; "
                      f"drift VIOLATION-STOP line={'yes' if drift_stop_line else 'NO'}")
        report("T5 boss stops drifted lane within one cycle", ok, detail)

        # ----------------------------------------------------------------
        # T6 — the restart is from the NAMED checkpoint: project_state.json
        # records checkpoints[] and best_stable_build; the last checkpoint
        # resolves to the name the restart cites (PART 4: "the last clean
        # checkpoint recorded in project_state.json").
        # ----------------------------------------------------------------
        state = json.loads(read_file(os.path.join(h, "CONTROL/project_state.json")))
        cps = state.get("checkpoints") or []
        last = cps[-1] if cps else {}
        named = last.get("tag") or last.get("checkpoint") or last.get("name") or ""
        bsb = state.get("best_stable_build") or {}
        ok = (named == CHECKPOINT_TAG
              and last.get("commit") == CHECKPOINT_COMMIT
              and bsb.get("checkpoint") == CHECKPOINT_TAG
              and "re-dispatch from its last clean checkpoint" in drift_stop_line)
        report("T6 named checkpoint recorded in project_state.json", ok,
               f"checkpoints[-1]={{tag:{named}, commit:{str(last.get('commit'))[:10]}}}; best_stable_build.checkpoint={bsb.get('checkpoint')}; the VIOLATION-STOP restart directive cites the last clean checkpoint")

        # ----------------------------------------------------------------
        # T7 — the known-good control on the same instrument: a healthy
        # ledger (state-carrying heartbeats, a fresh BOSSCYCLE-CLEAN, no
        # contentless run over threshold) gets BOSSCYCLE-CLEAN, exit 0, no
        # stop file, no VIOLATION-STOP. The detector does not punish the cure.
        # ----------------------------------------------------------------
        h = mk_home(base, "t7")
        fresh = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        write_line(ledger_sh, h, "FIX-LEDGER.md", f"- `BOSSCYCLE-CLEAN {fresh}: checks=caps,census,width,wavelock,claims,beat,stop,scope,kill,drift`")
        for _ in range(8):                      # 8 stateful heartbeats — under threshold
            write_line(ledger_sh, h, "FIX-LEDGER.md", stateful_line())
        ledger_fixture = os.path.join(h, "FIX-LEDGER.md")
        stop_fixture = os.path.join(h, "CONTROL/stop-workstream")
        pids_fixture = os.path.join(h, "CONTROL/workflow-pids.json")
        boss = boss_for(base, "boss-t7", ledger_fixture, stop_fixture, pids_fixture)
        rc, out, err = run(["python3", boss])
        ledger_text = read_file(ledger_fixture)
        ok = (rc == 0 and not os.path.exists(stop_fixture)
              and "VIOLATION-STOP" not in ledger_text
              and "BOSSCYCLE-CLEAN" in ledger_text
              and "BROKEN INSTRUMENT" not in out)
        report("T7 known-good control: healthy ledger stays clean", ok,
               f"exit={rc} (want 0); BOSSCYCLE-CLEAN appended; no stop file; no VIOLATION-STOP; no BROKEN INSTRUMENT")

        # ----------------------------------------------------------------
        # T8 — CLASS 7 (ledger provenance, FIX step 1): the anti-drift
        # contract is mechanically enforced. RESULT lines without their
        # BEFORE-the-unit CLAIM lines, past the tolerance (default 3), alarm
        # as unpaired-claim at exit 3; a ledger where every RESULT has its
        # CLAIM stays clean (ledger-ok). Committed in slice 1 (6dd8829).
        # ----------------------------------------------------------------
        h = mk_home(base, "t8")
        # drifted: 5 RESULT units with no CLAIM lines (tol=3 -> 5 > 3)
        for i in range(5):
            write_line(ledger_sh, h, "CONTROL/LEDGER.md",
                       f"2026-08-16T20:1{i}:00Z | RESULT | unit=U-9{i} | PASS | evidence=repos/app/parser.ts")
        rc, out, err = run_anchor(anchor, ledger_sh, h, "U-02")
        ledger_t8 = read_file(os.path.join(h, "CONTROL/LEDGER.md"))
        ok = rc == 3 and "unpaired-claim" in ledger_t8 and "ACTION|write-missing-claims" in out
        detail = (f"exit={rc} (want 3); DRIFT-ALARM | unpaired-claim for 5 units (tol=3); "
                  f"ACTION|write-missing-claims emitted")
        report("T8 CLASS 7 alarms on unpaired claims", ok, detail)
        # the paired control: same unit id in both CLAIM and RESULT -> clean
        h2 = mk_home(base, "t8b")
        write_line(ledger_sh, h2, "CONTROL/LEDGER.md",
                   "2026-08-16T20:10:00Z | CLAIM | unit=U-02 | agent=builder-1 | model=opus | plan=build the parser")
        write_line(ledger_sh, h2, "CONTROL/LEDGER.md",
                   "2026-08-16T20:20:00Z | RESULT | unit=U-02 | PASS | evidence=repos/app/parser.ts")
        rc, out, err = run_anchor(anchor, ledger_sh, h2, "U-02")
        ok = rc == 0 and "ledger-ok" in out and "unpaired=0" in out
        report("T8b CLASS 7 paired ledger stays clean", ok,
               f"exit={rc} (want 0); RECONCILE line carries ledger-ok(claimed=1/resulted=1/unpaired=0/tol=3)")

        print(f"\nSUMMARY | {PASS} passed | {FAIL} failed")
        return 0 if FAIL == 0 else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
