"""remake_rules.py: N-04 -- a new clip beats a patch.

A failed shot is REMADE from its locked picture in the one remake blast, never
patched. A patch is a crop, a zoom, a freeze or a hand-join used to get past a
check; section 3.8 refuses all of them, and every re-made piece in today's run
passed where the patched ones had failed.

The planner offers exactly one repair: ``remake_repair()`` returns the remake
record (start picture = this shot's locked keyframe, the run's one remake
blast) or refuses with ``CROP_REPAIR_REFUSED`` when the request names a patch.
Stdlib only, no network, no spend.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:                                       # the shared NEVER-AGAIN lock module
    import never_again as _na
except ImportError:                        # pragma: no cover - lane without it
    _na = None

TOOL_NAME = "remake_rules"
TOOL_VERSION = "1.0.0"

#: The patch kinds section 3.8 refuses as a way past a check.
PATCH_KINDS = frozenset({
    "crop", "zoom", "freeze", "stretch", "speed", "hand_join", "hand-join",
    "splice", "patch", "trim_to_pass",
})
CROP_REPAIR_REFUSED = (_na.CROP_REPAIR_REFUSED if _na is not None
                       else "CROP_REPAIR_REFUSED")
REMAKE_FROM_LOCKED_PICTURE = "REMAKE_FROM_LOCKED_PICTURE"


def remake_repair(shot, patch_kind=None, locked_keyframe=None):
    """One repair for a failed shot: a remake from its locked picture (N-04).

    ``shot``: the shot record (needs ``shot_id``). ``patch_kind``: what the
    caller proposed instead of a remake; any kind in PATCH_KINDS refuses with
    CROP_REPAIR_REFUSED. ``locked_keyframe``: this shot's own locked keyframe
    fingerprint; without it the remake has no start picture and is refused.

    Returns ``{'outcome': 'ok', 'code': REMAKE_FROM_LOCKED_PICTURE,
    'shot_id', 'start_picture', 'blast': 'one_remake_blast', 'patch':
    False}``, or the refusal envelope.
    """
    if not isinstance(shot, dict) or not shot.get("shot_id"):
        return {"outcome": "rejected", "code": "INVALID_REQUEST",
                "reason": "shot must be a record with a shot_id",
                "tool": TOOL_NAME, "tool_version": TOOL_VERSION,
                "recovery": "name the failed shot"}
    kind = str(patch_kind or "").strip().lower()
    if kind in PATCH_KINDS:
        return {"outcome": "rejected", "code": CROP_REPAIR_REFUSED,
                "reason": ("%r is a patch, not a repair: a failed shot is "
                           "remade from its locked picture, never cropped, "
                           "zoomed, frozen, stretched or hand-joined (3.8)"
                           % kind),
                "shot_id": shot["shot_id"],
                "tool": TOOL_NAME, "tool_version": TOOL_VERSION,
                "recovery": "remake the shot from its locked picture in the "
                            "one remake blast"}
    if not (isinstance(locked_keyframe, str) and locked_keyframe.strip()):
        return {"outcome": "rejected",
                "code": "REMAKE_PICTURE_MISSING",
                "reason": ("a remake starts from this shot's own locked "
                           "keyframe; none was named"),
                "shot_id": shot["shot_id"],
                "tool": TOOL_NAME, "tool_version": TOOL_VERSION,
                "recovery": "pass the shot's locked keyframe fingerprint"}
    return {"outcome": "ok", "code": REMAKE_FROM_LOCKED_PICTURE,
            "shot_id": shot["shot_id"],
            "start_picture": locked_keyframe.strip(),
            "blast": "one_remake_blast", "patch": False,
            "tool": TOOL_NAME, "tool_version": TOOL_VERSION}
