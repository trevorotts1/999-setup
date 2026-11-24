"""action_scope.py: N-20 -- a remake only makes the storyboard's own action bigger.

A remake exists to make the beat the storyboard already planned land harder. It
never invents a new prop action: a remake that adds a door slam, a dropped cup
or a new gesture is a NEW story beat, and a new story beat reopens approval
(N-17). ``check_remake_action()`` refuses such a remake with
``REMAKE_INVENTS_ACTION``; an amplification (same action, more of it) passes.
Stdlib only, no network, no spend.
"""
from __future__ import annotations

TOOL_NAME = "action_scope"
TOOL_VERSION = "1.0.0"

REMAKE_INVENTS_ACTION = "REMAKE_INVENTS_ACTION"
REMAKE_ACTION_SCOPE_OK = "REMAKE_ACTION_SCOPE_OK"


def check_remake_action(storyboard_action, remake):
    """A remake may only amplify the storyboard's own action (N-20).

    ``storyboard_action``: the action text the approved storyboard carries.
    ``remake``: a record with
      * ``new_prop_actions``: list of prop actions the remake would add; ANY
        entry refuses (a new prop action is a new story beat);
      * ``amplifies``: True when the remake makes the SAME action bigger --
        the only allowed change;
      * optionally ``action``: the remake's action text (echoed back).

    Returns ``{'outcome':'ok','code':REMAKE_ACTION_SCOPE_OK,'action',
    'amplifies':True}``, or a refusal naming the invented action.
    """
    if not isinstance(remake, dict):
        return {"outcome": "rejected", "code": "INVALID_REQUEST",
                "reason": "remake must be a record",
                "tool": TOOL_NAME, "tool_version": TOOL_VERSION,
                "recovery": "describe the remake's action"}
    new_props = remake.get("new_prop_actions") or []
    if not isinstance(new_props, (list, tuple)):
        return {"outcome": "rejected", "code": "INVALID_REQUEST",
                "reason": "new_prop_actions must be a list",
                "tool": TOOL_NAME, "tool_version": TOOL_VERSION}
    invented = [str(p).strip() for p in new_props
                if isinstance(p, str) and p.strip()]
    if invented:
        return {"outcome": "rejected", "code": REMAKE_INVENTS_ACTION,
                "reason": ("remake invents new prop action(s) %s; a remake only "
                           "makes the storyboard's own action bigger (N-20). A "
                           "new beat reopens approval."
                           % ", ".join(repr(x) for x in invented)),
                "storyboard_action": storyboard_action,
                "tool": TOOL_NAME, "tool_version": TOOL_VERSION,
                "recovery": "amplify the planned action, or send the new beat "
                            "back for approval"}
    return {"outcome": "ok", "code": REMAKE_ACTION_SCOPE_OK,
            "storyboard_action": storyboard_action,
            "action": remake.get("action", storyboard_action),
            "amplifies": True,
            "tool": TOOL_NAME, "tool_version": TOOL_VERSION}
