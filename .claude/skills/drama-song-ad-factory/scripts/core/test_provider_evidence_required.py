#!/usr/bin/env python3
"""Provider evidence is required before reconciling a paid attempt to failed.

A reconciled `failed` job is exactly what plan() treats as grounds for a NEW
paid attempt (spend_ledger.py plan(), the `ok_retry` branch). reconcile() let
provider_ref and evidence_ref default to "" and still wrote state=reconciled,
final_outcome=failed -- so a timed-out paid take could be resubmitted with no
provider record at all. Onboarding refuses that sequence; this pins the same
guarantee here without blocking the abandon path.

Pinned:
  (a) the S10 sequence (unknown -> reconcile failed, no refs) is refused with
      MISSING_PROVIDER_EVIDENCE;
  (b) after such a refusal plan() cannot mint a new paid attempt;
  (c) reconcile WITH a provider_ref (or evidence_ref) still reconciles and
      still permits the retry;
  (d) mark_unknown / cancel still succeed with no evidence and still forbid a
      paid attempt;
  (e) a submit that never reached the provider (no remote_task_id) still
      reconciles as failed with no refs -- the shipped submit-failure path,
      which has no provider id to look up;
  (f) identity/ordinal behaviour is unchanged (ledger mints inside the
      transaction, ordinal from persisted attempt_no, replay mints, explicit
      reuse refused, concurrent plans serialise).

stdlib only, no network, no paid calls.

Run from the skill root:
  python3 scripts/core/test_provider_evidence_required.py
"""
import importlib
import os
import sqlite3
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

L = importlib.import_module("spend_ledger")

FAILS = []


def check(name, got, want):
    if got == want:
        print("ok %s" % name)
    else:
        print("FAIL %s: got %r want %r" % (name, got, want))
        FAILS.append(name)


def fresh(prefix="pev-"):
    tmp = tempfile.mkdtemp(prefix=prefix)
    db = os.path.join(tmp, "spend.db")
    L.init_run(db, "run-pev", 10000)
    return db


def _to_unknown(db, key, digest, cost=100):
    """plan -> reserve -> submitted -> unknown. Returns the minted id."""
    p = L.plan(db, "run-pev", key, "", digest, cost)
    assert p["outcome"] == "ok", p
    aid = p["attempt_id"]
    assert L.reserve(db, "run-pev", key, aid)["outcome"] == "ok"
    assert L.mark_submitted(db, "run-pev", key, aid, "remote-1")["outcome"] == "ok"
    assert L.mark_unknown(db, "run-pev", key, aid)["outcome"] == "ok"
    return aid


def _retry(db, key, digest, cost=100):
    return L.plan(db, "run-pev", key, "", digest, cost)


def test_a_refused():
    db = fresh()
    d = L.digest_request({"k": 1})
    aid = _to_unknown(db, "video/v1", d)
    r = L.reconcile(db, "run-pev", "video/v1", aid, "failed", 100,
                    provider_ref="", evidence_ref="")
    check("a1: reconcile failed with no refs is refused",
          r["outcome"], "rejected")
    check("a2: typed refusal code", r["reason_code"],
          "MISSING_PROVIDER_EVIDENCE")
    check("a3: next_action names the abandon path",
          "--provider-ref" in r["next_action"]
          and "mark_unknown" in r["next_action"], True)
    state = sqlite3.connect(db).execute(
        "SELECT state,final_outcome FROM jobs WHERE attempt_id=?",
        (aid,)).fetchone()
    check("a4: the job did not move to reconciled", state, ("unknown", None))
    rec = sqlite3.connect(db).execute(
        "SELECT COUNT(*) FROM receipts WHERE attempt_id=?", (aid,)).fetchone()[0]
    check("a5: no receipt written for a refused reconcile", rec, 0)
    # whitespace-only refs are the same as empty
    r2 = L.reconcile(db, "run-pev", "video/v1", aid, "failed", 100,
                     provider_ref="  ", evidence_ref="\t")
    check("a6: whitespace-only refs are refused too",
          r2["reason_code"], "MISSING_PROVIDER_EVIDENCE")


def test_b_retry_still_blocked():
    db = fresh()
    d = L.digest_request({"k": 2})
    aid = _to_unknown(db, "video/v1", d)
    L.reconcile(db, "run-pev", "video/v1", aid, "failed", 100)
    p = _retry(db, "video/v1", d)
    check("b1: no paid retry after the refusal", p["outcome"], "rejected")
    check("b2: refused for the ordinary reason (attempt still active)",
          p["reason_code"], "DUPLICATE_LOGICAL_JOB")
    check("b3: no second paid attempt was minted",
          sqlite3.connect(db).execute(
              "SELECT COUNT(*) FROM jobs").fetchone()[0], 1)


def test_c_with_ref_retries():
    for field in ("provider_ref", "evidence_ref"):
        db = fresh("pev-%s-" % field)
        d = L.digest_request({"k": 3})
        aid = _to_unknown(db, "video/v1", d)
        kw = {field: "provider-task-42" if field == "provider_ref"
              else "operator-note://proof"}
        r = L.reconcile(db, "run-pev", "video/v1", aid, "failed", 100, **kw)
        check("c1[%s]: reconcile with evidence is accepted" % field,
              r["outcome"], "ok")
        p = _retry(db, "video/v1", d)
        check("c2[%s]: the paid retry is permitted" % field,
              p["outcome"], "ok")
        check("c3[%s]: it is attempt 2" % field,
              p["evidence"]["attempt_no"], 2)
        ref = sqlite3.connect(db).execute(
            "SELECT provider_ref,evidence_ref FROM receipts WHERE attempt_id=?",
            (aid,)).fetchone()
        want = ("provider-task-42", "") if field == "provider_ref" \
            else ("", "operator-note://proof")
        check("c4[%s]: the receipt keeps the ref" % field, ref, want)

    # a succeeded outcome never unlocked a retry, so it stays ref-free
    db = fresh("pev-ok-")
    d = L.digest_request({"k": 4})
    aid = _to_unknown(db, "video/v1", d)
    check("c5: reconcile succeeded needs no provider ref",
          L.reconcile(db, "run-pev", "video/v1", aid,
                      "succeeded", 100)["outcome"], "ok")
    check("c6: succeeded does not permit a new paid attempt",
          _retry(db, "video/v1", d)["reason_code"], "RETRY_NOT_FAILED")


def test_d_abandon_path():
    db = fresh("pev-unknown-")
    d = L.digest_request({"k": 5})
    aid = _to_unknown(db, "video/v1", d)
    p = _retry(db, "video/v1", d)
    check("d1: an unknown attempt forbids a paid retry",
          p["reason_code"], "DUPLICATE_LOGICAL_JOB")

    # cancel() is the abandon path from an active state; also evidence-free
    db2 = fresh("pev-cancel-")
    d2 = L.digest_request({"k": 6})
    p1 = L.plan(db2, "run-pev", "video/v2", "", d2, 100)
    a1 = p1["attempt_id"]
    L.reserve(db2, "run-pev", "video/v2", a1)
    L.mark_submitted(db2, "run-pev", "video/v2", a1, "remote-1")
    c = L.cancel(db2, "run-pev", "video/v2", a1)
    check("d2: cancel with no evidence still works", c["outcome"], "ok")
    check("d3: cancelled work sits in unknown",
          sqlite3.connect(db2).execute(
              "SELECT state FROM jobs WHERE attempt_id=?", (a1,)).fetchone()[0],
          "unknown")
    check("d4: and a paid retry is still refused",
          L.plan(db2, "run-pev", "video/v2", "", d2, 100)["reason_code"],
          "DUPLICATE_LOGICAL_JOB")

    # after a ref-free refusal the operator can still park and stop
    check("d5: operator parking stays available",
          L.park_run(db, "run-pev", "OPERATOR_PARK")["outcome"], "parked")


def test_e_never_submitted():
    """A paid submit that failed before any remote id existed must still be
    reconcilable as failed: there is no provider task to look up, and the
    cancel/mark_unknown trail is its own evidence. This is kie_dispatch's
    submit-failure path (task_id empty -> cancel -> mark_terminal -> reconcile
    at zero)."""
    db = fresh("pev-nosub-")
    d = L.digest_request({"k": 9})
    p = L.plan(db, "run-pev", "video/v3", "", d, 100)
    a = p["attempt_id"]
    L.reserve(db, "run-pev", "video/v3", a)
    check("e1: cancel with no remote id", L.cancel(db, "run-pev", "video/v3",
                                                   a)["outcome"], "ok")
    check("e2: terminal failed", L.mark_terminal(db, "run-pev", "video/v3", a,
                                                 "failed")["outcome"], "ok")
    r = L.reconcile(db, "run-pev", "video/v3", a, "failed", 0)
    check("e3: reconcile failed at zero needs no provider ref",
          r["outcome"], "ok")
    check("e4: and the retry is permitted, as shipped",
          L.plan(db, "run-pev", "video/v3", "", d, 100)["outcome"], "ok")


def test_f_identity_untouched():
    """The certified identity/ordinal behaviour must be byte-for-byte the
    same: nothing here may depend on reconcile's new branch."""
    db = fresh("pev-id-")
    d = L.digest_request({"k": 7})
    p1 = L.plan(db, "run-pev", "song/v1", "", d, 100)
    a1 = p1["attempt_id"]
    check("e1[S1]: ledger mints the identity",
          p1["evidence"]["identity_minted_by_ledger"], True)
    check("e2[S1]: ordinal derived as 1", p1["evidence"]["attempt_no"], 1)
    # S4: explicit reuse refused
    L.reserve(db, "run-pev", "song/v1", a1)
    L.mark_submitted(db, "run-pev", "song/v1", a1, "remote-1")
    L.mark_terminal(db, "run-pev", "song/v1", a1, "failed")
    check("e3[S4]: explicit reuse is refused",
          L.plan(db, "run-pev", "song/v1", a1, d, 100)["reason_code"],
          "DUPLICATE_ATTEMPT")
    # S6/S7: replay mints a fresh id, no string suffix relation, ordinal 2
    p2 = L.plan(db, "run-pev", "song/v1", "", d, 100)
    a2 = p2["attempt_id"]
    check("e4[S6]: replay mints", p2["evidence"]["identity_minted_by_ledger"],
          True)
    check("e5[S6]: new id differs", a2 != a1, True)
    check("e6[S7]: no suffix/superstring relation",
          a1 in a2 or a2 in a1, False)
    check("e7[S7]: ordinal 2 from persisted history",
          p2["evidence"]["attempt_no"], 2)
    # S8: concurrent planners serialise -- exactly one wins the slot
    db3 = fresh("pev-race-")
    d3 = L.digest_request({"k": 8})
    results = []

    def go():
        results.append(L.plan(db3, "run-pev", "song/v9", "", d3, 100))

    ts = [threading.Thread(target=go) for _ in range(6)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    oks = [r for r in results if r["outcome"] == "ok"]
    others = [r for r in results if r["outcome"] != "ok"]
    check("e8[S8]: exactly one concurrent plan wins", len(oks), 1)
    check("e9[S8]: the rest are refused, not errors",
          all(r["outcome"] == "rejected" for r in others), True)
    check("e10[S8]: one job row for the key",
          sqlite3.connect(db3).execute(
              "SELECT COUNT(*) FROM jobs WHERE logical_key='song/v9'"
          ).fetchone()[0], 1)


def main():
    for fn in (test_a_refused, test_b_retry_still_blocked,
               test_c_with_ref_retries, test_d_abandon_path,
               test_e_never_submitted, test_f_identity_untouched):
        try:
            fn()
        except Exception as e:                       # noqa: BLE001
            import traceback
            traceback.print_exc()
            FAILS.append("%s raised %s: %s"
                         % (fn.__name__, type(e).__name__, e))
    print()
    if FAILS:
        print("%d FAILED: %s" % (len(FAILS), ", ".join(map(str, FAILS))))
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
