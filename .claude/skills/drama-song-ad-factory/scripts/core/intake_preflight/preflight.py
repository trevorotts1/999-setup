"""preflight.py: dependency/auth checks before paid work (24.2 row 2). stdlib only.

NAMES only: resolves tools via shutil.which, disk via shutil.disk_usage.
Never executes tools, never submits generation, never logs credential values.
Successful exit never means paid submission occurred.
"""
import importlib
import os
import shutil
import sys

# ponytail: no network/catalog probe; add provider allowlist fetch when needed.


def check_tools(names):
    return {n: (shutil.which(n) is not None) for n in (names or [])}


def check_modules(names):
    out = {}
    for n in (names or []):
        try:
            importlib.import_module(n)
            out[n] = True
        except Exception:
            out[n] = False
    return out


def check_disk(path, min_free_bytes=0):
    try:
        u = shutil.disk_usage(path)
        return {"total": u.total, "free": u.free,
                "ok": u.free >= (min_free_bytes or 0)}
    except Exception as e:
        return {"error": str(e)[:200], "ok": False}


def check_storage_writable(path):
    return os.path.isdir(path) and os.access(path, os.W_OK | os.X_OK)


def check_credentials(names, env=None):
    env = env if env is not None else os.environ
    return {n: bool(env.get(n)) for n in (names or [])}  # presence only, values never returned


def _load_card_gate():
    """card_gate (F15) from core/style_defaults, or None; caller fails closed."""
    try:
        core = os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.dirname(os.path.abspath(__file__)))))
        if core not in sys.path:
            sys.path.insert(0, core)
        from style_defaults import card_gate as CG  # noqa: PLC0415
        return CG
    except Exception:  # noqa: BLE001 - fall back to the local fail-closed check
        return None


def check_card_receipt(run_state, card_receipt):
    """F15 (Critical, owner order 2026-10-08): before ANY paid job the run
    state must carry the recorded choice-card receipt -- one card, four
    answers (video_style, audio_style, length, video_model). ``card_receipt``
    overrides; else ``run_state['card_receipt']`` (or the run state's own
    card record) is read. Never silently passes: a missing/blank answer is
    reason ``CARD_UNANSWERED``."""
    cg = _load_card_gate()
    record = card_receipt if card_receipt is not None else run_state
    if cg is not None:
        ok, refusal = cg.gate_run_state(record if isinstance(record, dict) else None)
        if not ok:
            return refusal
        return None
    # Local fail-closed copy for the (defensive) case card_gate cannot import.
    answers = record if isinstance(record, dict) else None
    if isinstance(answers, dict):
        for key in ("answers", "card_answers", "card", "choice_card"):
            inner = answers.get(key)
            if isinstance(inner, dict):
                answers = inner
                break
    missing = [f for f in ("video_style", "audio_style", "length", "video_model")
               if not isinstance(answers, dict)
               or answers.get(f) is None
               or (isinstance(answers.get(f), str) and not answers.get(f).strip())]
    if missing:
        return {"reason_code": "CARD_UNANSWERED", "missing": missing,
                "next_action": "Show the choice card and record all four "
                               "answers (video style, audio style, length, "
                               "video model), with who and when, before any "
                               "paid job."}
    return None


def _inside(root, p):
    root = os.path.realpath(root)
    target = os.path.realpath(os.path.join(root, p)) if not os.path.isabs(p) else os.path.realpath(p)
    return target == root or target.startswith(root + os.sep), target


# Reuse the existing leaf registry so the 120-second delivery profile cannot
# disappear between the card and this distribution's explicit preflight.
from suno_recipe.duration_registry import (durations, shapes, preflight_profiles)

PROFILE_LENGTHS_S = durations()
PROFILE_SHAPES = shapes()
DEFAULT_PROFILES = preflight_profiles()


def check(payload):
    """payload keys: tools, modules, storage_dir, min_free_bytes, approved_root,
    references[], profile, allowed_profiles[], schema_version, allowed_schemas[],
    credentials[], env{}, auth{}, summary_digest, run_dir, run_id, stage. Returns outcome/reason/checks."""
    p = payload or {}
    checks = {}
    schemas = p.get("allowed_schemas") or ["blackceo.campaign/v1"]
    sv = p.get("schema_version") or "blackceo.campaign/v1"
    checks["schema_trusted"] = sv in schemas
    if not checks["schema_trusted"]:
        return {"outcome": "error", "reason_code": "schema-untrusted",
                "checks": checks, "next_action": f"Use a trusted schema: {schemas}."}
    allowed = p.get("allowed_profiles") or list(DEFAULT_PROFILES)
    checks["profile_known"] = (p.get("profile") or DEFAULT_PROFILES[0]) in allowed
    if not checks["profile_known"]:
        return {"outcome": "rejected", "reason_code": "delivery-profile-unknown",
                "checks": checks, "next_action": f"Choose a delivery profile in {allowed}."}
    root = p.get("approved_root") or p.get("storage_dir") or os.getcwd()
    bad, outside = [], []
    for r in (p.get("references") or []):
        ok, target = _inside(root, r)
        if not ok:
            outside.append(r)
        elif not (os.path.isfile(target) and os.path.getsize(target) > 0):
            bad.append(r)
    checks["references_ok"] = not bad
    checks["references_inside_approved_storage"] = not outside
    if outside:
        return {"outcome": "rejected", "reason_code": "reference-outside-approved-storage",
                "checks": checks, "missing": [], "outside": outside,
                "next_action": "Move references inside approved storage and retry."}
    if bad:
        return {"outcome": "error", "reason_code": "reference-missing-or-truncated",
                "checks": checks, "missing": bad,
                "next_action": "Restore missing/truncated references and retry."}
    tools = check_tools(p.get("tools"))
    checks["tools"] = tools
    if not all(tools.values()):
        return {"outcome": "error", "reason_code": "tool-unavailable",
                "checks": checks, "missing": sorted(k for k, v in tools.items() if not v),
                "next_action": "Install missing runtime tools and retry."}
    mods = check_modules(p.get("modules"))
    checks["modules"] = mods
    if not all(mods.values()):
        return {"outcome": "error", "reason_code": "module-unavailable",
                "checks": checks, "missing": sorted(k for k, v in mods.items() if not v),
                "next_action": "Install missing Python modules and retry."}
    sdir = p.get("storage_dir") or root
    checks["storage_writable"] = check_storage_writable(sdir)
    disk = check_disk(sdir, p.get("min_free_bytes") or 0)
    checks["disk"] = {k: disk[k] for k in ("total", "free", "ok") if k in disk}
    if not checks["storage_writable"]:
        return {"outcome": "error", "reason_code": "storage-not-writable",
                "checks": checks, "next_action": f"Make {sdir} writable and retry."}
    if not disk.get("ok"):
        return {"outcome": "error", "reason_code": "disk-limit",
                "checks": checks, "next_action": "Free disk space and retry."}
    creds = check_credentials(p.get("credentials"), p.get("env"))
    checks["credentials_present"] = creds
    if creds and not all(creds.values()):
        return {"outcome": "rejected", "reason_code": "credential-missing",
                "checks": checks, "missing": sorted(k for k, v in creds.items() if not v),
                "next_action": "Provide credentials (presence only; values never logged)."}
    # Caller auth may restrict scope/expiry; it never creates production authority.
    auth = p.get("auth") or {}
    if auth:
        import time
        exp = auth.get("expires_unix")
        if isinstance(exp, (int, float)) and int(time.time()) > exp:
            return {"outcome": "rejected", "reason_code": "approval-expired",
                    "checks": checks, "next_action": "Renew expired authorization."}
        scope = auth.get("scope")
        dgst = p.get("summary_digest")
        if scope not in ("campaign", dgst):
            return {"outcome": "rejected", "reason_code": "approval-out-of-scope",
                    "checks": checks, "next_action": "Bind authorization to this campaign summary digest."}
    # Preserve this distribution's explicit tool/module/storage/credential checks.
    # Unlike the canonical distribution, this version has no D05 auto-derivation.
    checks["mode"] = p.get("mode") or "quick"
    checks["generating"] = checks["mode"] != "diagnostic"
    if p.get("run_dir") and checks["generating"]:
        import production_process
        try:
            if not production_process.needs_media_dependencies(p.get("stage")):
                checks.update(mode="planning", generating=False)
        except (ImportError, ValueError, TypeError, KeyError) as exc:
            return {"outcome": "error", "reason_code": "PRODUCTION_PROCESS_UNVERIFIED",
                    "checks": checks, "production_admitted": False,
                    "next_action": "The canonical planning dependency graph cannot be verified: " + str(exc)}
    if checks["mode"] == "diagnostic":
        checks["readiness"] = "diagnostic-only"
        return {"outcome": "ok", "reason_code": "preflight-pass-diagnostic",
                "checks": checks, "mode": "diagnostic", "generating": False,
                "readiness": "diagnostic-only", "production_admitted": False,
                "next_action": "Diagnostic only: this is not production admission."}
    card_refusal = check_card_receipt(p.get("run_state"), p.get("card_receipt"))
    checks["card_recorded"] = card_refusal is None
    if card_refusal is not None and not p.get("run_dir"):
        return {"outcome": "waiting", "reason_code": card_refusal["reason_code"],
                "checks": checks, "missing": card_refusal.get("missing", []),
                "next_action": card_refusal.get("next_action", "Show and answer the choice card first.")}
    if not p.get("run_dir"):
        checks["readiness"] = "dependencies-only"
        return {"outcome": "ok", "reason_code": "preflight-pass-dependencies",
                "checks": checks, "readiness": "dependencies-only", "production_admitted": False,
                "next_action": "Dependencies checked. Resume governed intake, then name the run and stage for production admission."}
    import production_process
    stage = p.get("stage")
    authority = (production_process.admit_production(p["run_dir"], stage, run_id=p.get("run_id"))
                 if stage else production_process.inspect_intake(p["run_dir"], run_id=p.get("run_id")))
    checks["production_process"] = authority
    if not authority["ok"]:
        checks["readiness"] = "unverified"
        return {"outcome": "waiting", "reason_code": authority["reason_code"],
                "checks": checks, "readiness": "unverified", "production_admitted": False,
                "next_action": authority["detail"] + " " + authority["next_action"]}
    checks["card_recorded"] = True
    admitted = bool(stage)
    checks["readiness"] = "stage-admitted" if admitted else "planning-only"
    return {"outcome": "ok", "reason_code": "preflight-pass" if admitted else "preflight-pass-planning",
            "checks": checks, "readiness": checks["readiness"], "production_admitted": admitted,
            "next_action": "Proceed through the admitted stage runner." if admitted else
                           "Intake confirmed. Unpaid planning may proceed; paid stages require current admission."}
