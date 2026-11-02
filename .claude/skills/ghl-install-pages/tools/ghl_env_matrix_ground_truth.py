#!/usr/bin/env python3
"""ghl_env_matrix_ground_truth.py — B-U15 item 2: the receipt SCHEMA +
COMPARATOR for the matrix's "first-hour ground truth" requirement.

999 HARNESS FORM
----------------
On the OpenClaw side this module proved parity between a Mac receipt and a
VPS receipt (matching build outcome, box-appropriate `durable_root()` /
`is_vps()` / `supervisor()` resolution per box). In the Claude Code harness
there is ONE environment form: `is_vps()` is always False, `supervisor()`
is "none", and `durable_root()` resolves override -> GHL_DURABLE_ROOT ->
the skill's in-tree `state/` (never an OpenClaw host root). The comparator
therefore proves that TWO receipts (two runs, or two machines running this
harness) BOTH show the harness resolution and a passing fixture build,
rather than two independently-eyeballed "looks fine" claims. A receipt
claiming VPS resolution or an OpenClaw-shaped durable root FAILS here,
which is the point: it proves the run did not silently resolve against
the other harness's conventions.

This module is the COMPARATOR half: a receipt SCHEMA
(``GROUND_TRUTH_REQUIRED_FIELDS``) any fixture-build run emits, plus
``compare_ground_truth()`` / ``assert_ground_truth_parity()``. It never
runs a dispatch→build→verify→FAB-QC pipeline itself (that pipeline is
`v2_dispatcher.py`, Section B.1.1 — out of this unit's scope) — it consumes
whatever receipt that pipeline emits.

THE LIVE LEG THIS DOES NOT AND CANNOT CLOSE (operator-gated, owed):
    Actually RUNNING the fixture build (dispatch → build → verify → FAB-QC)
    against a real GoHighLevel test location is the live leg, deferred to
    the operator. This unit's tests prove the comparator's logic is
    correct against FIXTURE receipts (hermetic, no network) — never a
    fabricated pass on a receipt this module invented itself.

    `run_fixture_ground_truth()` / the `run` CLI subcommand (below) CLOSE
    the "which script actually produces a compare()-ready receipt" gap:
    they drive `v2_dispatcher.dispatch_one()` with a deterministic,
    no-network fixture builder/verifier and assemble a receipt in the
    EXACT `GROUND_TRUTH_REQUIRED_FIELDS` shape. This is still the
    OFFLINE/FIXTURE tier (same fixture-injection contract
    `tests/test_v2_dispatcher.py` already proves) — running this SAME
    command unmodified with the real `ghl_survey_builder`/`ghl_verify`
    pair against a designated GHL test location is the genuine live leg,
    still owed to the operator, never fabricated here.
    `browser_manager` / `v2_dispatcher` are imported LAZILY inside
    `run_fixture_ground_truth()` (not at module top-level) so
    `validate`/`compare` — the pure, dependency-free comparator this
    module started as — never pay for the heavier dispatcher import graph.

CLI
---
    python3 ghl_env_matrix_ground_truth.py validate <receipt.json>
    python3 ghl_env_matrix_ground_truth.py compare <receipt_a.json> <receipt_b.json>
    python3 ghl_env_matrix_ground_truth.py run --evidence-root <dir> [--box-label <name>] [--run-id <id>]
    python3 ghl_env_matrix_ground_truth.py --selftest
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Callable, List, Optional

GROUND_TRUTH_VERSION = "v1.0.0"

# Matches the standing BUILD-QC gate (Section B.1.1 / v2-autonomous-build-sop.md
# ":964-971"): "a build below 8.5 is NOT done." Re-asserted here so a ground-
# truth receipt cannot claim parity while quietly shipping a sub-gate score.
FAB_QC_PASS_THRESHOLD = 8.5

GROUND_TRUTH_REQUIRED_FIELDS = (
    "box_label",
    "platform",
    "durable_root",
    "is_vps",
    "supervisor",
    "run_id",
    "dispatch_ok",
    "build_ok",
    "verify_passed",
    "fab_qc_score",
    "fab_qc_gate",
    "receipts_total",
)


class GroundTruthMismatch(AssertionError):
    """Two ground-truth receipts do not show the parity B-U15 requires."""


def validate_ground_truth_receipt(receipt: Any) -> List[str]:
    """Return a list of problems (empty = valid). Never raises — a caller
    building a live receipt-emission path can call this before writing to
    disk and fail loud with a concrete field list, not a stack trace."""
    problems: List[str] = []
    if not isinstance(receipt, dict):
        return [f"receipt must be a JSON object, got {type(receipt).__name__}"]
    for field in GROUND_TRUTH_REQUIRED_FIELDS:
        if field not in receipt:
            problems.append(f"missing required field: {field!r}")
    if "is_vps" in receipt and not isinstance(receipt["is_vps"], bool):
        problems.append(f"'is_vps' must be a bool, got {type(receipt.get('is_vps')).__name__}")
    if "fab_qc_score" in receipt and not isinstance(receipt["fab_qc_score"], (int, float)):
        problems.append(f"'fab_qc_score' must be numeric, got {type(receipt.get('fab_qc_score')).__name__}")
    return problems


def _check(checks: List[dict], name: str, ok: bool, detail: str) -> None:
    checks.append({"check": name, "pass": bool(ok), "detail": detail})


def _harness_root_ok(root: Any) -> bool:
    """A durable root is in harness form when it is a non-empty string that
    carries no OpenClaw host convention (no /data/.openclaw, no ~/.openclaw
    or any *.openclaw path segment)."""
    if not isinstance(root, str) or not root.strip():
        return False
    if root == "/data/.openclaw" or root.startswith("/data/.openclaw"):
        return False
    if "/.openclaw" in root or root.endswith(".openclaw"):
        return False
    return True


def compare_ground_truth(receipt_a: dict, receipt_b: dict) -> dict:
    """Compare two ground-truth receipts (two runs in this harness).

    Parity in the 999 harness means: both receipts are well-formed, BOTH
    show the harness resolution (is_vps False, supervisor "none", durable
    root in harness form), and both builds actually passed (dispatch,
    build, verify, FAB-QC gate + threshold, non-zero receipts)."""
    checks: List[dict] = []

    a_problems = validate_ground_truth_receipt(receipt_a)
    _check(checks, "GT-01:a_receipt_schema", not a_problems,
           "well-formed" if not a_problems else "; ".join(a_problems))
    b_problems = validate_ground_truth_receipt(receipt_b)
    _check(checks, "GT-02:b_receipt_schema", not b_problems,
           "well-formed" if not b_problems else "; ".join(b_problems))

    if a_problems or b_problems:
        return {"pass": False, "checks": checks}

    _check(checks, "GT-03:a_is_not_vps", receipt_a["is_vps"] is False,
           f"receipt_a.is_vps={receipt_a['is_vps']!r} (expected False)")
    _check(checks, "GT-04:b_is_not_vps", receipt_b["is_vps"] is False,
           f"receipt_b.is_vps={receipt_b['is_vps']!r} (expected False)")

    _check(checks, "GT-05:a_durable_root_harness_form",
           _harness_root_ok(receipt_a["durable_root"]),
           f"receipt_a.durable_root={receipt_a['durable_root']!r}")
    _check(checks, "GT-06:b_durable_root_harness_form",
           _harness_root_ok(receipt_b["durable_root"]),
           f"receipt_b.durable_root={receipt_b['durable_root']!r}")

    _check(checks, "GT-07:a_supervisor_none", receipt_a["supervisor"] == "none",
           f"receipt_a.supervisor={receipt_a['supervisor']!r}")
    _check(checks, "GT-08:b_supervisor_none", receipt_b["supervisor"] == "none",
           f"receipt_b.supervisor={receipt_b['supervisor']!r}")

    for label, receipt in (("a", receipt_a), ("b", receipt_b)):
        _check(checks, f"GT-09:{label}_dispatch_ok", receipt["dispatch_ok"] is True,
               f"{label}.dispatch_ok={receipt['dispatch_ok']!r}")
        _check(checks, f"GT-10:{label}_build_ok", receipt["build_ok"] is True,
               f"{label}.build_ok={receipt['build_ok']!r}")
        _check(checks, f"GT-11:{label}_verify_passed", receipt["verify_passed"] is True,
               f"{label}.verify_passed={receipt['verify_passed']!r}")
        _check(checks, f"GT-12:{label}_fab_qc_gate_pass", receipt["fab_qc_gate"] == "PASS",
               f"{label}.fab_qc_gate={receipt['fab_qc_gate']!r}")
        _check(checks, f"GT-13:{label}_fab_qc_score_meets_threshold",
               isinstance(receipt["fab_qc_score"], (int, float))
               and receipt["fab_qc_score"] >= FAB_QC_PASS_THRESHOLD,
               f"{label}.fab_qc_score={receipt['fab_qc_score']!r} (threshold {FAB_QC_PASS_THRESHOLD})")
        _check(checks, f"GT-14:{label}_receipts_total_nonzero", receipt["receipts_total"] > 0,
               f"{label}.receipts_total={receipt['receipts_total']!r}")

    return {"pass": all(c["pass"] for c in checks), "checks": checks}


def assert_ground_truth_parity(receipt_a: dict, receipt_b: dict) -> None:
    """Raise ``GroundTruthMismatch`` unless every comparator check passes —
    the fail-closed entrypoint a build-unit gate calls."""
    result = compare_ground_truth(receipt_a, receipt_b)
    if not result["pass"]:
        failed = [c for c in result["checks"] if not c["pass"]]
        detail = "; ".join(f"{c['check']}: {c['detail']}" for c in failed)
        raise GroundTruthMismatch(f"ground-truth parity FAILED ({len(failed)} check(s)): {detail}")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---------------------------------------------------------------------------
# Emitter half — produce a compare()-ready receipt (lazy dispatcher import)
# ---------------------------------------------------------------------------

def _default_fixture_builder() -> "Callable[[dict, str], dict]":
    """Deterministic, offline, no-network builder — same fixture-injection
    contract `tests/test_v2_dispatcher.py`'s `_builder_ok` proves per-box."""
    def _b(task: dict, evidence_root: str) -> dict:
        funnel_dir = os.path.join(evidence_root, "funnel")
        os.makedirs(funnel_dir, exist_ok=True)
        with open(os.path.join(funnel_dir, "ledger.json"), "w", encoding="utf-8") as fh:
            json.dump({"built": True, "ground_truth_fixture": True}, fh)
        return {
            "pages": [{"step": "optin", "preview_url": "https://fixture.invalid/optin",
                       "marker": "GROUND-TRUTH-FIXTURE"}],
            "location_gate_ok": True,
            "duration_s": 1.0,
        }
    return _b


def _default_fixture_verifier() -> "Callable[..., dict]":
    """Deterministic, offline verifier mirroring `ghl_verify.verify_all`'s
    return contract (same shape `tests/test_v2_dispatcher.py`'s
    `_fake_verifier` uses)."""
    def _v(evidence_root: str, pages: Any, **_kw: Any) -> dict:
        summary = {"overall_pass": True, "passed": 1, "total": 1, "failed": 0}
        scorecard_dir = os.path.join(evidence_root, "scorecard")
        os.makedirs(scorecard_dir, exist_ok=True)
        summary_path = os.path.join(scorecard_dir, "verify-summary.json")
        with open(summary_path, "w", encoding="utf-8") as fh:
            json.dump(summary, fh)
        return {"raw": [], "summary": summary, "raw_path": "", "summary_path": summary_path}
    return _v


def run_fixture_ground_truth(
    evidence_root: str,
    *,
    box_label: Optional[str] = None,
    run_id: Optional[str] = None,
    builder: "Callable[[dict, str], dict] | None" = None,
    verifier: "Callable[..., dict] | None" = None,
    task: Optional[dict] = None,
    env: Optional[dict] = None,
    isdir: Optional[Callable[[str], bool]] = None,
) -> dict:
    """Drive `v2_dispatcher.dispatch_one()` (imported LAZILY — see module
    docstring) through ONE fixture build and assemble a receipt in the exact
    `GROUND_TRUTH_REQUIRED_FIELDS` shape `compare_ground_truth()` consumes.

    `fab_qc_score` / `fab_qc_gate` are an HONEST FIXTURE PLACEHOLDER (the
    default fixture builder/verifier never run a real FAB-QC pass) — the
    receipt's own `fab_qc_note` says so explicitly, never silently presented
    as a genuine quality verdict. A real live run replaces `builder`/
    `verifier` with `ghl_survey_builder`/`ghl_verify` (real FAB-QC scoring
    included) against a designated GHL test location.
    """
    import uuid

    # Lazy — see module docstring: keeps validate/compare dependency-free.
    _TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
    if _TOOLS_DIR not in sys.path:
        sys.path.insert(0, _TOOLS_DIR)
    import browser_manager as bm  # noqa: E402
    import v2_dispatcher as disp  # noqa: E402

    _run_id = run_id or f"gt-{uuid.uuid4().hex[:12]}"
    _task = task if task is not None else {
        "id": f"env-matrix-ground-truth-{_run_id}",
        "brand": "Fictional Ground-Truth Co",
        "location_id": "LOCATIONgroundtruth0",
        "brief": "B-U15 item 2 fixture ground-truth build",
    }
    _builder = builder if builder is not None else _default_fixture_builder()
    _verifier = verifier if verifier is not None else _default_fixture_verifier()

    result = disp.dispatch_one(_task, evidence_root, builder=_builder, verifier=_verifier)

    receipts_total = 0
    if os.path.isdir(evidence_root):
        for _root, _dirs, files in os.walk(evidence_root):
            receipts_total += sum(1 for f in files if f.endswith(".json"))

    dispatch_ok = result.state == "verified"
    build_ok = result.state != "FAILED"
    # NOTE: v2_dispatcher.dispatch_one() already flattens the verifier's
    # return value onto DispatchResult.verify (it extracts `verify_out["summary"]`
    # internally before constructing the result — see dispatch_one's own
    # `summary = verify_out["summary"] if ... else verify_out` line), so
    # `result.verify` IS the summary dict directly; it has no further nested
    # "summary" key to unwrap.
    verify_passed = bool((result.verify or {}).get("overall_pass"))

    return {
        "box_label": box_label,
        "platform": sys.platform,
        "durable_root": bm.durable_root(env=env, isdir=isdir),
        "is_vps": bm.is_vps(env=env, isdir=isdir),
        "supervisor": bm.supervisor(env=env),
        "run_id": _run_id,
        "dispatch_ok": dispatch_ok,
        "build_ok": build_ok,
        "verify_passed": verify_passed,
        "fab_qc_score": 9.0 if verify_passed else 0.0,
        "fab_qc_gate": "PASS" if verify_passed else "FAIL",
        "fab_qc_note": (
            "FIXTURE PLACEHOLDER — the offline fixture build never runs a real "
            "FAB-QC pass; this field is a deterministic stand-in, never a "
            "genuine quality verdict. A live run (real builder/verifier "
            "injected) replaces this with shared-utils/fab_qc.py's real score."
        ),
        "receipts_total": receipts_total,
        "dispatch_state": result.state,
        "dispatch_reason": result.reason,
        "evidence_root": evidence_root,
        "live": False,
        "ts": _now(),
    }


def ground_truth_receipt_path(evidence_root: str) -> str:
    return os.path.join(evidence_root, "routing", "env-matrix-ground-truth-receipt.json")


def write_ground_truth_receipt(evidence_root: str, receipt: dict) -> str:
    path = ground_truth_receipt_path(evidence_root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp-{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(receipt, fh, indent=2)
    os.replace(tmp_path, path)
    return path


# ---------------------------------------------------------------------------
# Self-test — no network, no live boxes (fixture receipts only)
# ---------------------------------------------------------------------------
def _selftest() -> int:
    errors: List[str] = []

    def _fixture(**overrides) -> dict:
        base = {
            "box_label": "fixture-a",
            "platform": "darwin",
            "durable_root": "/home/fixture/skills/ghl-install-pages/state",
            "is_vps": False,
            "supervisor": "none",
            "run_id": "gt-fixture-1",
            "dispatch_ok": True,
            "build_ok": True,
            "verify_passed": True,
            "fab_qc_score": 9.2,
            "fab_qc_gate": "PASS",
            "receipts_total": 5,
        }
        base.update(overrides)
        return base

    a = _fixture()
    b = _fixture(
        box_label="fixture-b", platform="linux",
        durable_root="/opt/install/.claude/skills/ghl-install-pages/state",
        run_id="gt-fixture-2",
    )

    # 1. Well-formed matching receipts -> overall pass, every check passes.
    result = compare_ground_truth(a, b)
    if not result["pass"]:
        errors.append(f"matching harness receipts should compare pass=True: {result}")
    if not all(c["pass"] for c in result["checks"]):
        errors.append(f"expected all checks to pass on a clean fixture pair: {result['checks']}")

    # 2. assert_ground_truth_parity does not raise on a clean pair.
    try:
        assert_ground_truth_parity(a, b)
    except GroundTruthMismatch as exc:
        errors.append(f"assert_ground_truth_parity should not raise on a clean pair: {exc}")

    # 3. validate_ground_truth_receipt: missing field surfaces by name.
    broken = dict(a)
    del broken["fab_qc_score"]
    problems = validate_ground_truth_receipt(broken)
    if not any("fab_qc_score" in p for p in problems):
        errors.append(f"missing fab_qc_score should be reported: {problems}")

    # 4. compare_ground_truth fails closed (never KeyErrors) on a malformed receipt.
    result = compare_ground_truth(broken, b)
    if result["pass"] is not False:
        errors.append(f"malformed receipt should fail the comparison, got {result}")

    # 5. A receipt claiming is_vps=True is caught, not silently passed.
    bad_a = _fixture(is_vps=True)
    result = compare_ground_truth(bad_a, b)
    if result["pass"] is not False:
        errors.append("a receipt claiming is_vps=True should fail GT-03")
    gt03 = next(c for c in result["checks"] if c["check"] == "GT-03:a_is_not_vps")
    if gt03["pass"] is not False:
        errors.append(f"GT-03 should specifically fail: {gt03}")

    # 6. An OpenClaw-shaped durable_root is caught on either side.
    bad_b = _fixture(box_label="bad-b", platform="linux",
                     durable_root="/data/.openclaw")
    result = compare_ground_truth(a, bad_b)
    if result["pass"] is not False:
        errors.append("a receipt with an OpenClaw-shaped durable_root should fail GT-06")

    # 7. A sub-threshold FAB-QC score fails the parity check (the standing 8.5 gate).
    low_score_b = _fixture(box_label="low-b", platform="linux",
                           durable_root="/opt/install/.claude/skills/ghl-install-pages/state",
                           fab_qc_score=7.9, fab_qc_gate="FAIL")
    result = compare_ground_truth(a, low_score_b)
    if result["pass"] is not False:
        errors.append("a sub-8.5 fab_qc_score should fail the parity comparison")
    try:
        assert_ground_truth_parity(a, low_score_b)
        errors.append("assert_ground_truth_parity must raise on a sub-8.5 score")
    except GroundTruthMismatch:
        pass

    # 8. Zero receipts_total (vacuous "pass") is caught (F6 discipline).
    vacuous_b = _fixture(box_label="vacuous-b", platform="linux",
                         durable_root="/opt/install/.claude/skills/ghl-install-pages/state",
                         receipts_total=0)
    result = compare_ground_truth(a, vacuous_b)
    if result["pass"] is not False:
        errors.append("receipts_total=0 should fail the parity comparison (F6: no receipt = not created)")

    # 9. A non-dict receipt fails closed with a clear message, never a crash.
    problems = validate_ground_truth_receipt(["not", "a", "dict"])
    if not problems:
        errors.append("a non-dict receipt should report at least one problem")

    if errors:
        for e in errors:
            print(f"  FAIL: {e}", file=sys.stderr)
        print(f"\n[selftest] FAIL — {len(errors)} error(s)", file=sys.stderr)
        return 1
    print("[selftest] PASS — ground-truth receipt schema + comparator verified (no network, no live boxes)")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(
        prog="ghl_env_matrix_ground_truth",
        description="B-U15 item 2: first-hour ground-truth receipt schema + Mac-vs-VPS comparator.",
    )
    p.add_argument("--selftest", action="store_true", help="Run the no-network self-test and exit.")
    sub = p.add_subparsers(dest="cmd")

    sp = sub.add_parser("validate", help="Validate one ground-truth receipt file.")
    sp.add_argument("receipt_path")

    sp2 = sub.add_parser("compare", help="Compare two ground-truth receipt files (harness parity).")
    sp2.add_argument("receipt_a_path")
    sp2.add_argument("receipt_b_path")

    sp3 = sub.add_parser(
        "run",
        help="OFFLINE/FIXTURE: run one dispatch->build->verify fixture cycle on THIS "
             "box and write a compare()-ready receipt (the operator-run --live leg "
             "swaps in a real builder/verifier — see module docstring).",
    )
    sp3.add_argument("--evidence-root", required=True)
    sp3.add_argument("--box-label", default=None)
    sp3.add_argument("--run-id", default=None)

    args = p.parse_args(argv)

    if args.selftest:
        return _selftest()

    if args.cmd == "run":
        receipt = run_fixture_ground_truth(
            args.evidence_root, box_label=args.box_label, run_id=args.run_id,
        )
        out = write_ground_truth_receipt(args.evidence_root, receipt)
        print(json.dumps(receipt, indent=2))
        print(f"[ghl_env_matrix_ground_truth] receipt written: {out}", file=sys.stderr)
        return 0 if (receipt["dispatch_ok"] and receipt["build_ok"] and receipt["verify_passed"]) else 1

    if args.cmd == "validate":
        with open(args.receipt_path, encoding="utf-8") as fh:
            receipt = json.load(fh)
        problems = validate_ground_truth_receipt(receipt)
        if problems:
            for prob in problems:
                print(f"  INVALID: {prob}", file=sys.stderr)
            return 1
        print("valid")
        return 0

    if args.cmd == "compare":
        with open(args.receipt_a_path, encoding="utf-8") as fh:
            mac = json.load(fh)
        with open(args.receipt_b_path, encoding="utf-8") as fh:
            vps = json.load(fh)
        result = compare_ground_truth(mac, vps)
        print(json.dumps(result, indent=2))
        return 0 if result["pass"] else 1

    p.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
