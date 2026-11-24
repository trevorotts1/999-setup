#!/usr/bin/env python3
"""speed.burst: the one-burst run path (F-SPD-1, N-79, N-83, N-87, N-88, N-92).

The wire point for `kie_dispatch.submit_all_ready`: the run calls
`run_burst` ONCE with every ready job instead of submitting them one by
one. It refuses before the picture gate (N-83), refuses a drip
(STAGGERED_SEND, N-79), stops at the spend guard (N-87), orders slowest
route first (N-97) and returns failed jobs for immediate resubmission
(N-88). Nothing here sleeps or calls a provider: the caller supplies
`submit_one` and does the waiting.

All numbers come from speed.speed (which reads references/speed-limits.json).
"""
from __future__ import annotations

import os as _os
import sys as _sys

try:  # packaged: speed.speed
    from . import speed as _S
except ImportError:  # run as a script: the sibling speed.py
    _HERE = _os.path.dirname(_os.path.abspath(__file__))
    if _HERE not in _sys.path:
        _sys.path.insert(0, _HERE)
    import speed as _S  # type: ignore


def run_burst(submit_one, jobs, *, picture_gate_passed, balance=None,
              estimate=None, batch_send=True):
    """Send the whole batch once. Returns ok + receipt, or a refusal dict.

    submit_one: callable(job) -> submit result, called once per job in the
    returned order (slowest route first). picture_gate_passed: N-83; False
    refuses before any submit. balance/estimate: the N-87 spend guard, in
    the same money unit.
    """
    ready = list(jobs or [])
    if not picture_gate_passed:
        return {"ok": False, "code": "SPEED_GATE_SKIPPED",
                "detail": "no H3 or lip-sync job is sent until the picture "
                          "gate has passed; a failed picture joins the clip "
                          "remake burst (N-83)"}
    if len(ready) > 1 and not batch_send:
        return {"ok": False, "code": "STAGGERED_SEND",
                "detail": "%d ready jobs belong in one burst paced at 20 per "
                          "15 s; never one by one (N-79)" % len(ready)}
    warn = ""
    if estimate is not None:
        status, _ceiling, code = _S.spend_guard(balance, estimate)
        if status == "stop":
            return {"ok": False, "code": code,
                    "detail": "paid bursts stop and the owner is asked once; "
                              "free work goes on - never a silent park (N-87)"}
        if status == "warn":
            warn = code
    ordered = _S.slow_route_first(ready)
    submitted = [{"result": submit_one(job)} for job in ordered]
    requests, window = _S.pacing()
    return {"ok": True, "code": "OK", "submitted": submitted,
            "receipt": {"max_at_once": requests,
                        "window_seconds": window,
                        "capped_by": "speed-limits",
                        "slowest_first": True},
            "warn": warn}


def resubmit_failed(failed, *, attempts=None):
    """N-88: a failure costs 0; resubmit at once, up to twice, same stage."""
    limits = _S.load_limits()
    cap = int((limits.get("resubmit") or {}).get("max_tries") or 2)
    attempts = dict(attempts or {})
    out = []
    for job in failed or []:
        key = job.get("logical_key") if isinstance(job, dict) else str(job)
        used = int(attempts.get(key, 0))
        if used < cap:
            attempts[key] = used + 1
            out.append(job)
    return out, attempts


def outlier_resend_due(elapsed_s, job_kind, *, stamped_limit_s=None):
    """N-80: the single re-send, due past twice the model's 9-in-10 time."""
    return _S.outlier_resend_due(elapsed_s, job_kind,
                                 stamped_limit_s=stamped_limit_s)


if __name__ == "__main__":  # self-check
    seen = []
    r = run_burst(lambda j: seen.append(j),
                  [{"route": "picture"}, {"route": "nine-picture"}],
                  picture_gate_passed=True)
    assert r["ok"] and len(r["submitted"]) == 2
    assert seen[0]["route"] == "nine-picture"  # slowest first
    assert run_burst(lambda j: None, [{"route": "picture"}],
                     picture_gate_passed=False)["code"] == "SPEED_GATE_SKIPPED"
    assert run_burst(lambda j: None, [{"r": 1}, {"r": 2}],
                     picture_gate_passed=True,
                     batch_send=False)["code"] == "STAGGERED_SEND"
    out, _ = resubmit_failed([{"logical_key": "a"}], attempts={})
    assert len(out) == 1
    assert outlier_resend_due(241, "picture") is True
    print("speed.burst self-check OK")
