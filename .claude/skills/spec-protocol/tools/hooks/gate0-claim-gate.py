#!/usr/bin/env python3
"""Stop hook — refuse the GATE 0 refusal when the check behind it was never run.

WHY THIS EXISTS. GATE 0's four signals are not alike. Signals 1 and 2 are read
from the turn's own text; signals 3 and 4 are facts on disk and in this process's
environment, and a model cannot observe its own environment by introspection --
it has to ask the shell. Told to "test four signals", models have repeatedly
evaluated all four in their heads, concluded no, and told a client to switch on
ultracode they already had. That has now happened to a session whose title bar
read `--effort ultracode`, whose status line read `ultracode`, and whose
environment carried CLAUDE_NINE_ULTRACODE=1.

Prose did not stop it. Three separate releases rewrote the rule and the fourth
run broke it again. So the rule moves out of the document and into a script:

  if the turn speaks the GATE 0 refusal
  and gate0.sh --check-session does not appear in that turn's tool calls
  then THIS HOOK RUNS IT, and if it passes, the stop is blocked and the real
  verdict is handed back.

WHAT IT NEVER DOES. It never lets a run past a genuinely closed gate: when the
check it runs says ultracode is off, the refusal stands and the hook gets out of
the way. It only ever refuses an UNPROVEN refusal.

CONTRACT (matching the other claim gates on this box)
  - reads the hook payload on stdin, always exits 0
  - blocking is communicated ONLY by printing {"decision":"block","reason":...}
  - honours stop_hook_active so the block cannot re-trigger on itself
  - any internal error is silent and non-blocking: a broken gate must never
    wedge a session
"""
import json
import os
import re
import shutil
import subprocess
import sys

# The refusal, as SKILL.md fixes it. Matched loosely enough to survive wrapping
# and smart quotes, tightly enough that ordinary prose cannot trip it.
REFUSAL = re.compile(
    r"one switch has to be on before i can start my helpers", re.I)
RAN_CHECK = re.compile(r"gate0\.sh['\"]?\s+--check-session|--check-session", re.I)

CANDIDATES = [
    os.path.expanduser("~/.claude-nine/skills/spec-protocol/tools/gate0.sh"),
    os.path.expanduser("~/.claude/skills/spec-protocol/tools/gate0.sh"),
    os.path.join(os.path.dirname(__file__), "..", "gate0.sh"),
]


def _text_of(content):
    if isinstance(content, str):
        return content
    out = []
    for b in content or []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "text":
            out.append(b.get("text", ""))
        elif b.get("type") == "tool_use":
            out.append(json.dumps(b.get("input", {})))
    return "\n".join(out)


def _this_turn(transcript_path):
    """Assistant text and tool calls since the last real user message."""
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except Exception:
        return None, None
    said, called = [], []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("isSidechain"):
            continue
        t = d.get("type")
        msg = d.get("message") or {}
        if t == "user":
            c = msg.get("content")
            # A tool result is not the user speaking; keep walking back.
            if isinstance(c, list) and any(
                    isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
                called.append(_text_of(c))
                continue
            break
        if t == "assistant":
            body = _text_of(msg.get("content"))
            said.append(body)
            called.append(body)
    return "\n".join(said), "\n".join(called)


def _run_check():
    for path in CANDIDATES:
        path = os.path.abspath(path)
        if not os.path.isfile(path):
            continue
        bash = shutil.which("bash") or "/bin/bash"
        try:
            r = subprocess.run([bash, path, "--check-session"],
                               capture_output=True, text=True, timeout=20)
        except Exception:
            return None, "gate0.sh could not be executed"
        return r.returncode, (r.stdout or r.stderr or "").strip()
    return None, "gate0.sh not found in any known location"


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    if not isinstance(payload, dict) or payload.get("stop_hook_active"):
        return
    said, called = _this_turn(payload.get("transcript_path", ""))
    if not said or not REFUSAL.search(said):
        return                      # no GATE 0 refusal spoken; nothing to police
    if called and RAN_CHECK.search(called):
        return                      # the check was run; the refusal is earned

    rc, line = _run_check()
    if rc == 0:
        print(json.dumps({"decision": "block", "reason": (
            "GATE 0 REFUSAL BLOCKED — the check behind it was never run, and it is wrong.\n\n"
            f"{line}\n\n"
            "Ultracode IS on in this session. Signals 3 and 4 are COMMANDS, not judgements: "
            "a model cannot observe its own environment variables by thinking about them. "
            "Do not tell the client to switch on something they already have. "
            "Delete that refusal, treat GATE 0 as PASSED via signal 4, and continue with "
            "THE OPENING SCRIPT.")}))
        return
    if rc is None:
        print(json.dumps({"decision": "block", "reason": (
            "GATE 0 REFUSAL BLOCKED — you refused without running the check, and the check "
            f"could not be run either ({line}). That is UNDETERMINED, not 'the switch is off'. "
            "Say so in one line, name what could not be run, and do not claim a state you "
            "did not measure.")}))
        return
    print(json.dumps({"decision": "block", "reason": (
        "GATE 0 refusal spoken with no check behind it. The check has now been run and it "
        f"does agree with you:\n\n{line}\n\n"
        "Re-state the refusal ONCE, this time citing that verdict line as its evidence, so the "
        "transcript carries the proof the protocol requires.")}))


def _selftest():
    """Prove the instrument discriminates, before any verdict is believed."""
    import tempfile
    fails = 0
    def t(name, got, want):
        nonlocal fails
        ok = got == want
        print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f" (got {got!r} want {want!r})"))
        if not ok:
            fails += 1
    REF = "One switch has to be on before I can start my helpers."
    t("refusal text is recognised", bool(REFUSAL.search(REF)), True)
    t("ordinary prose is not", bool(REFUSAL.search("Hi, I'm Candace.")), False)
    t("a run of the check is recognised",
      bool(RAN_CHECK.search('{"command":"bash tools/gate0.sh --check-session"}')), True)
    t("an unrelated command is not",
      bool(RAN_CHECK.search('{"command":"ls -la"}')), False)
    d = tempfile.mkdtemp()
    tp = os.path.join(d, "t.jsonl")
    with open(tp, "w") as fh:
        fh.write(json.dumps({"type": "user", "message": {"role": "user", "content": "/spec-protocol"}}) + "\n")
        fh.write(json.dumps({"type": "assistant", "message": {"role": "assistant",
                 "content": [{"type": "text", "text": REF}]}}) + "\n")
    said, called = _this_turn(tp)
    t("this turn's speech is read back", bool(said and REFUSAL.search(said)), True)
    t("no check is seen when none was run", bool(called and RAN_CHECK.search(called)), False)
    t("a missing transcript is survived", _this_turn("/nope/none.jsonl"), (None, None))
    rc, line = _run_check()
    t("gate0.sh is locatable and runnable", rc in (0, 1, 2), True)
    print(f"  (live check said: {line})")
    if fails:
        print(f"gate0-claim-gate.py selftest: {fails} FAILED")
        sys.exit(2)
    print("gate0-claim-gate.py selftest: ALL PASS (8 checks)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    try:
        main()
    except Exception:
        pass    # a broken gate must never wedge a session
