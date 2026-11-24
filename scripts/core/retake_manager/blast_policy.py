"""blast_policy.py: F-SPD-6 -- remakes go back in ONE blast, never one by one.

The per-class retake budgets land in ``retake_manager.plan`` (F-CG-6). This is
the submit side of the same rule: every ready remake goes back in ONE blast up
to the rate limit. A serial submit -- one prompt at a time, one picture check at
a time, or a single lone drip resent while more are ready -- refuses
``RETAKE_DRIP`` (the shared NEVER-AGAIN lock), so no run ever nibbles its
remakes out one by one.
Stdlib only, no network, no spend.
"""
from __future__ import annotations

try:                                       # the shared NEVER-AGAIN lock module
    import never_again as _na
except ImportError:                        # pragma: no cover - lane without it
    _na = None

TOOL_NAME = "blast_policy"
TOOL_VERSION = "1.0.0"

RETAKE_DRIP = (_na.RETAKE_DRIP if _na is not None else "RETAKE_DRIP")
ONE_BLAST_OK = "ONE_BLAST_OK"


def one_blast(ready, limit=None, serial=False):
    """Return the ONE resubmit blast for every ready remake (F-SPD-6).

    ``ready``: the ready job/remake ids. ``limit``: the rate-limit ceiling for
    one blast (None = no cap). ``serial``: True when the caller means to send
    them one at a time (serial prompts or serial picture checks) -- refused.

    A blast that would send more than ``limit`` is split into back-to-back
    blasts of ``limit`` each (never a single drip). Returns
    ``{'outcome','code','blasts',[[ids]],'count','serial':False}`` or the
    RETAKE_DRIP refusal envelope.
    """
    if not isinstance(ready, (list, tuple)) or not ready:
        return {"outcome": "rejected", "code": "INVALID_REQUEST",
                "reason": "ready must be a non-empty list of remake ids",
                "tool": TOOL_NAME, "tool_version": TOOL_VERSION}
    ids = [str(x) for x in ready if str(x).strip()]
    if serial:
        return {"outcome": "rejected", "code": RETAKE_DRIP,
                "reason": ("serial submit refused: %d ready remake(s) belong "
                           "in ONE blast up to the rate limit, never one "
                           "prompt or picture check at a time" % len(ids)),
                "ready": ids, "serial": True,
                "tool": TOOL_NAME, "tool_version": TOOL_VERSION,
                "recovery": "send every ready remake in ONE blast"}
    if isinstance(limit, int) and not isinstance(limit, bool) and limit > 0:
        blasts = [ids[i:i + limit] for i in range(0, len(ids), limit)]
    else:
        blasts = [ids] if ids else []
    return {"outcome": "ok", "code": ONE_BLAST_OK,
            "blasts": blasts, "count": len(ids), "serial": False,
            "limit": limit, "tool": TOOL_NAME, "tool_version": TOOL_VERSION}
