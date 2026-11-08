#!/usr/bin/env python3
"""openclaw_browser_route.py — the adapter -> ``_dispatch_browser`` seam.

WHY THIS EXISTS
---------------
``cli_anything.gohighlevel.public.adapter.PublicGhlAdapter._dispatch_browser``
hands an operation whose frozen row declares no API/MCP route to a
``browser_route`` callable and validates what comes back. It requires a
mapping whose ``references_fresh`` is ``True`` and whose ``cleanup`` record is
honest before it will accept a completion; anything else fails closed with
``browser_route_contract_invalid`` or ``browser_route_cleanup_invalid``.

Nothing in this tree ever RAN ``tools/openclaw_browser_adapter.sh``, so that
route had no producer and could not satisfy its own contract even when the
adapter learned to write the fields (F11 451d98b2b). This module is the
producer and nothing more.

WHAT IT DOES
------------
``run_adapter(argv, ...)`` runs the real adapter as a subprocess.
``adapter_browser_route(request, verb_args=..., ...)`` runs the adapter once
for one ``BrowserRouteRequest``, reads the receipt the adapter itself wrote
(``--receipt``), and returns it as the mapping the route validates.

WHAT IT NEVER DOES
------------------
* No build logic. ``verb_args`` is supplied by the caller that knows its
  surface's UI steps; this module never guesses a browser sequence.
* No invented fields. Every completion field (``ok``, ``operation_complete``,
  ``references_fresh``, ``owned_sessions``, ``cleanup``) is the adapter's own
  record, passed through unchanged.
* No softening. If the adapter writes no receipt (its Gate 0 harness refusal
  exits 75, or a usage error exits 64), the route returns
  ``{"ok": False, ...}`` with the adapter's own exit code and stderr, and
  ``_dispatch_browser`` records ``browser_route_incomplete``. In the 999
  harness the managed-browser lane is absent, so that refusal IS the correct
  answer here and this module must never turn it into progress.

The only fields added are identity the caller already owns: ``lane``,
``location_id`` (the receipt's ``locationId``, the ladder's spelling),
``run_id`` and ``native_ids`` from the request.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from typing import Any, Mapping, Sequence

LANE = "openclaw_managed_browser"
ADAPTER_FILENAME = "openclaw_browser_adapter.sh"
DEFAULT_TIMEOUT_S = 180
#: The board taxonomy literal for "no rung completed this operation"
#: (cc_board.py::_CC_BLOCK_REASONS). A refusal is a PARKED, never a pass.
PARKED = "PARKED"


def adapter_path() -> str:
    """Absolute path of the adapter next to this module."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), ADAPTER_FILENAME)


def run_adapter(
    argv: Sequence[str],
    *,
    adapter: str | None = None,
    env: Mapping[str, str] | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> tuple[int, str, str]:
    """Run the real adapter once. Returns ``(exit_code, stdout, stderr)``."""

    command = ["bash", adapter or adapter_path()] + [str(a) for a in argv]
    proc = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=float(timeout_s),
        env=dict(env) if env is not None else None,
    )
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def _refusal(exit_code: int, detail: str) -> dict[str, Any]:
    """A refusal mapping the route already understands: ``ok`` is boolean False."""

    return {
        "ok": False,
        "code": PARKED,
        "detail": detail,
        "lane": LANE,
        "status": "failed",
        "exitCode": int(exit_code),
    }


def adapter_browser_route(
    request: Any,
    *,
    verb_args: Sequence[str],
    expect_token: str | None = None,
    refresh_snapshot: bool = False,
    adapter: str | None = None,
    env: Mapping[str, str] | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> dict[str, Any]:
    """Run the adapter for one request and return its receipt.

    ``request`` is a ``BrowserRouteRequest`` (``operation_id``, ``tenant``,
    ``run_id``, ``native_object_ids``). ``verb_args`` is ``[verb, *args]`` as
    the surface's builder supplies it. Adapter flags are placed before the
    verb's own arguments so a caller's ``--`` separator cannot swallow them.
    """

    if not verb_args:
        return _refusal(64, "no adapter verb supplied; the caller owns the verb sequence")

    with tempfile.TemporaryDirectory(prefix="ocb-route-") as tmp:
        receipt_path = os.path.join(tmp, "receipt.json")
        argv: list[str] = [str(verb_args[0])]
        argv += ["--operation", str(request.operation_id)]
        argv += ["--location", str(request.tenant)]
        argv += ["--receipt", receipt_path]
        if expect_token:
            argv += ["--expect-token", str(expect_token)]
        if refresh_snapshot:
            argv.append("--refresh-snapshot")
        argv += [str(a) for a in verb_args[1:]]

        exit_code, _stdout, stderr = run_adapter(
            argv, adapter=adapter, env=env, timeout_s=timeout_s
        )

        if not os.path.isfile(receipt_path):
            detail = stderr.strip() or "no stderr"
            return _refusal(
                exit_code,
                f"the adapter wrote no receipt (exit {exit_code}): {detail}",
            )
        try:
            with open(receipt_path, "r", encoding="utf-8") as handle:
                outcome = json.load(handle)
        except (OSError, ValueError) as exc:
            return _refusal(
                exit_code,
                f"the adapter receipt is not readable JSON ({type(exc).__name__})",
            )

    if not isinstance(outcome, dict):
        return _refusal(exit_code, "the adapter receipt is not a JSON object")

    # Identity the caller already owns; never a completion claim.
    outcome["lane"] = LANE
    outcome.setdefault("location_id", outcome.get("locationId"))
    outcome["run_id"] = getattr(request, "run_id", None)
    outcome["native_ids"] = dict(getattr(request, "native_object_ids", {}) or {})
    return outcome


__all__ = [
    "ADAPTER_FILENAME",
    "DEFAULT_TIMEOUT_S",
    "LANE",
    "PARKED",
    "adapter_browser_route",
    "adapter_path",
    "run_adapter",
]
