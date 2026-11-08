#!/usr/bin/env python3
"""prove_browser_route_contract.py — ONE runnable proof for BFX-101.

WHAT IT PROVES
--------------
1. SATISFIED. A receipt written by the REAL adapter (its own
   ``_ocb_finish`` -> ``_ocb_completion_status`` -> ``_ocb_write_receipt``
   path, run against a stub ``openclaw`` CLI, no browser, no network) carries
   ``references_fresh: true`` and an honest ``cleanup``, and
   ``PublicGhlAdapter._dispatch_browser`` accepts it for a browser-only row
   (``forms.authoring``, route_class ``skill06_authoring``) as
   ``Status.ok`` with ``transport == "browser"`` and no HTTP leg.
2. REFUSED — stale refs. The same receipt with ``references_fresh: false``
   while still claiming completion is refused with
   ``browser_route_contract_invalid``.
3. REFUSED — dishonest cleanup. ``cleanup.closed_all: true``, and a
   ``released`` session the rung never owned, are refused with
   ``browser_route_cleanup_invalid``.
4. REFUSED — this harness. Run end to end through
   ``openclaw_browser_route.adapter_browser_route`` as a real subprocess, the
   adapter's Gate 0 refuses (exit 75, no receipt); the route still answers
   ``browser_route_incomplete``. The managed-browser lane is absent here, so
   that refusal is the correct answer and no receipt exists to soften it.

The receipt in (1) is produced by the adapter's real completion machinery,
which every real verb calls; the harness gate keeps real verbs from reaching
it in this harness, and (4) proves that gate is still in force. Nothing here
writes to the network or starts a browser: ``openclaw`` on the proof PATH is
a throwaway argv-echo stub, exactly as in the adapter's own selftest.

Run:  python3 tools/prove_browser_route_contract.py
Exit: 0 all checks pass, 1 any check failed.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
_SKILL_DIR = os.path.dirname(_TOOLS_DIR)
_ENGINE_ROOT = os.path.join(
    os.path.dirname(_SKILL_DIR), "convert-and-flow-operator", "tools", "engine"
)
for _path in (_TOOLS_DIR, _ENGINE_ROOT):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from openclaw_browser_route import adapter_browser_route  # noqa: E402

from cli_anything.gohighlevel.public import PublicGhlAdapter  # noqa: E402
from cli_anything.gohighlevel.public.auth import (  # noqa: E402
    AuthContext,
    AuthKind,
    TenantBinding,
)
from cli_anything.gohighlevel.public.operations import OPERATIONS  # noqa: E402
from cli_anything.gohighlevel.public.result import Status  # noqa: E402

ADAPTER = os.path.join(_TOOLS_DIR, "openclaw_browser_adapter.sh")
BROWSER_ONLY_OPERATION = "forms.authoring"
TENANT = "loc-proof"
CAPABILITY = {
    "lanes": {"openclaw_managed_browser": {"cliWorks": True}},
    "operationCapabilities": {
        "scope": "per-operation+per-connected-location",
        "transports": {
            "browser": {
                "routes": ["openclaw_managed_browser"],
                "selectedLane": "openclaw_managed_browser",
            }
        },
    },
}

_FAILS = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global _FAILS
    if condition:
        print(f"  ok:   {name}")
    else:
        _FAILS += 1
        print(f"  FAIL: {name}{(' — ' + detail) if detail else ''}", file=sys.stderr)


class _NoTransport:
    """The browser route must never touch HTTP. Any call is a proof failure."""

    def request(self, **kwargs):  # pragma: no cover - must never run
        raise AssertionError("the browser route opened an HTTP transport")


def _stub_cli(directory: str) -> str:
    path = os.path.join(directory, "openclaw")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write('#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\nexit 0\n')
    os.chmod(path, 0o755)
    return directory


def _real_receipt(tmp: str) -> dict:
    """Write a receipt with the adapter's OWN completion machinery.

    Same technique the adapter's selftest uses: source the script without its
    final ``main "$@"`` and call the functions every verb calls. No verb runs,
    no browser, no network.
    """

    with open(ADAPTER, "r", encoding="utf-8") as handle:
        lines = handle.read().splitlines()
    sourced = os.path.join(tmp, "sourced.sh")
    with open(sourced, "w", encoding="utf-8") as handle:
        handle.write("\n".join(ln for ln in lines if ln.strip() != 'main "$@"') + "\n")

    capability = os.path.join(tmp, "capability.json")
    with open(capability, "w", encoding="utf-8") as handle:
        json.dump(CAPABILITY, handle)
    output = os.path.join(tmp, "cli-out.txt")
    receipt = os.path.join(tmp, "receipt.json")

    script = (
        'set -u\n'
        '. "$OCB_PROOF_SOURCED"\n'
        '_OCB_OPERATION="%s"\n'
        '_OCB_LOCATION="%s"\n'
        '_OCB_EXPECT_TOKEN="Saved"\n'
        '_OCB_REFRESH=1\n'
        '_OCB_RECEIPT="$OCB_PROOF_RECEIPT"\n'
        'printf "Saved\\n" > "$OCB_PROOF_OUT"\n'
        '_ocb_finish open 0 "$OCB_PROOF_OUT"\n'
    ) % (BROWSER_ONLY_OPERATION, TENANT)

    env = dict(os.environ)
    env.update(
        {
            "PATH": _stub_cli(tmp) + ":/usr/bin:/bin",
            "GHL_SKILL6_CAPABILITY_JSON": capability,
            "OCB_PROOF_SOURCED": sourced,
            "OCB_PROOF_RECEIPT": receipt,
            "OCB_PROOF_OUT": output,
        }
    )
    proc = subprocess.run(
        ["bash", "-c", script], capture_output=True, text=True, env=env, timeout=120
    )
    if not os.path.isfile(receipt):
        raise AssertionError(
            f"adapter wrote no receipt (rc={proc.returncode}): {proc.stderr.strip()}"
        )
    with open(receipt, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _adapter_with(route) -> PublicGhlAdapter:
    return PublicGhlAdapter(
        auth=AuthContext(
            kind=AuthKind.location_pit,
            location_id=TENANT,
            resolve_secret=lambda name: "proof-not-a-secret",
            source="proof:bfx-101",
        ),
        operations=OPERATIONS,
        transport=_NoTransport(),
        browser_route=route,
    )


def _dispatch(route):
    return _adapter_with(route).dispatch(
        operation_id=BROWSER_ONLY_OPERATION,
        tenant=TenantBinding(location_id=TENANT, source="proof:bfx-101"),
        run_id="run-bfx-101",
        native_object_ids={"form": "form-proof"},
    )


def main() -> int:
    print("openclaw browser route contract proof (offline; no browser, no network):")

    with tempfile.TemporaryDirectory(prefix="ocb-proof-") as tmp:
        check_parts = []

        # ── 1. SATISFIED: a real adapter receipt is accepted ────────────────
        receipt = _real_receipt(tmp)
        check_parts.append(("adapter receipt reports references_fresh=true",
                            receipt.get("references_fresh") is True, repr(receipt.get("references_fresh"))))
        check_parts.append(("adapter receipt carries an honest cleanup record",
                            isinstance(receipt.get("cleanup"), dict)
                            and receipt["cleanup"].get("closed_all") is False,
                            repr(receipt.get("cleanup"))))
        check_parts.append(("adapter receipt claims the operation that was requested",
                            receipt.get("operation") == BROWSER_ONLY_OPERATION,
                            repr(receipt.get("operation"))))

        seen = {}

        def satisfied_route(request):
            seen["operation_id"] = request.operation_id
            return dict(receipt)

        result = _dispatch(satisfied_route)
        check_parts.append(("browser-only row reached the browser route",
                            seen.get("operation_id") == BROWSER_ONLY_OPERATION,
                            repr(seen)))
        check_parts.append(("_dispatch_browser accepts the run: Status.ok",
                            result.status is Status.ok, result.status.value))
        check_parts.append(("accepted on the browser transport, not HTTP",
                            result.transport == "browser", str(result.transport)))
        check_parts.append(("operation_complete recorded for the requested operation",
                            bool((result.evidence or {}).get("operation_complete")) is True,
                            repr((result.evidence or {}).get("operation_complete"))))

        for name, ok, detail in check_parts:
            check(name, ok, detail)

        # ── 2. REFUSED: completion claimed with stale refs ──────────────────
        stale = dict(receipt)
        stale["references_fresh"] = False
        stale_result = _dispatch(lambda request: dict(stale))
        check("stale refs are refused (browser_route_contract_invalid)",
              stale_result.status is Status.unavailable
              and (stale_result.error or {}).get("rule") == "browser_route_contract_invalid",
              f"{stale_result.status.value} / {(stale_result.error or {}).get('rule')}")

        # ── 3. REFUSED: cleanup that closes everything, or releases a
        #        session the rung never owned ────────────────────────────────
        closed_all = dict(receipt)
        closed_all["cleanup"] = {"released": [], "closed_all": True}
        closed_result = _dispatch(lambda request: dict(closed_all))
        check("cleanup.closed_all is refused (browser_route_cleanup_invalid)",
              closed_result.status is Status.unavailable
              and (closed_result.error or {}).get("rule") == "browser_route_cleanup_invalid",
              f"{closed_result.status.value} / {(closed_result.error or {}).get('rule')}")

        foreign = dict(receipt)
        foreign["cleanup"] = {"released": ["tab:somebody-elses-session"],
                              "closed_all": False}
        foreign_result = _dispatch(lambda request: dict(foreign))
        check("releasing a session the rung never owned is refused",
              foreign_result.status is Status.unavailable
              and (foreign_result.error or {}).get("rule") == "browser_route_cleanup_invalid",
              f"{foreign_result.status.value} / {(foreign_result.error or {}).get('rule')}")

        # ── 4. REFUSED: the real end-to-end run in THIS harness ─────────────
        refused = adapter_browser_route(
            type("Req", (), {
                "operation_id": BROWSER_ONLY_OPERATION,
                "tenant": TENANT,
                "run_id": "run-bfx-101",
                "native_object_ids": {"form": "form-proof"},
            })(),
            verb_args=["open", "https://example.invalid/proof"],
            env={**os.environ, "PATH": "/usr/bin:/bin"},
        )
        check("a real adapter run in this harness writes no receipt and refuses",
              refused.get("ok") is False and refused.get("exitCode") == 75,
              repr({k: refused.get(k) for k in ("ok", "exitCode", "detail")}))

        refused_result = _dispatch(lambda request: refused)
        check("the route records that refusal as browser_route_incomplete",
              refused_result.status is Status.unavailable
              and (refused_result.error or {}).get("rule") == "browser_route_incomplete",
              f"{refused_result.status.value} / {(refused_result.error or {}).get('rule')}")

    if _FAILS:
        print(f"PROOF FAILED: {_FAILS} check(s)", file=sys.stderr)
        return 1
    print("PROOF PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
