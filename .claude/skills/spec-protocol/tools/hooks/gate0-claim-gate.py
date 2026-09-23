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
  - at most 3 blocks per session-turn (counter file under
    $CLAUDE_CONFIG_DIR/spec-protocol/blocks/<session_id>, shared with
    conversation-gate.py), then stands down: retries are checked, loops cannot
    happen
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
# A LITERAL single space between the words did NOT survive wrapping: a newline,
# a double space or a non-breaking space between any two words made the refusal
# invisible to this gate. `\s+` covers all three — Python's `\s` matches U+00A0
# (and every other Unicode space) for str patterns.
REFUSAL = re.compile(r"\s+".join(
    ["one", "switch", "has", "to", "be", "on",
     "before", "i", "can", "start", "my", "helpers"]), re.I)
RAN_CHECK = re.compile(r"gate0\.sh[^\n]{0,200}--check-session", re.I)
# This hook's own feedback carrying an "ultracode is off" verdict: the check DID
# run (the hook ran it) and agrees, so a restated refusal is earned.
HOOK_RAN_OFF = re.compile(r"GATE0 SESSION \| verdict=NO-SESSION-ULTRACODE")
MAX_BLOCKS = 3

CANDIDATES = [
    os.path.expanduser("~/.claude-nine/skills/spec-protocol/tools/gate0.sh"),
    os.path.expanduser("~/.claude/skills/spec-protocol/tools/gate0.sh"),
    os.path.join(os.path.dirname(__file__), "..", "gate0.sh"),
]


def _text_of(content, tools_only=False, prose_only=False):
    """Text of a message. tools_only: ONLY tool_use inputs. prose_only: ONLY
    text blocks -- what a client actually reads.

    Prose is not evidence that a command ran. Pooling it let a turn satisfy the
    gate by merely WRITING "gate0.sh --check-session" in a sentence, which is
    precisely the failure this hook exists to prevent. The mirror holds for the
    refusal itself: a tool INPUT that quotes the refusal wording (an operator
    probing this very regex) was never spoken to anyone, and treating it as
    speech blocked the session that maintains this hook.
    """
    if isinstance(content, str):
        return "" if tools_only else content
    out = []
    for b in content or []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "tool_use" and not prose_only:
            out.append(json.dumps(b.get("input", {})))
        elif b.get("type") == "text" and not tools_only:
            out.append(b.get("text", ""))
    return "\n".join(out)


SKILL_INVOKED = re.compile(
    r"Base directory for this skill:\s*\S*spec-protocol|<command-name>/?spec-protocol",
    re.I)


def _is_spec_protocol_run(transcript_path):
    """Is THIS SESSION a spec-protocol run? Same test as conversation-gate.py:
    only the harness's own skill injection in a user-role string/text record
    counts. A tool_result or tool_use that merely quotes the marker does not."""
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if not SKILL_INVOKED.search(line):
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                msg = rec.get("message") or {}
                if rec.get("type") != "user" or msg.get("role") != "user":
                    continue
                content = msg.get("content")
                if isinstance(content, str) and SKILL_INVOKED.search(content):
                    return True
                if isinstance(content, list):
                    for block in content:
                        if (isinstance(block, dict) and block.get("type") == "text"
                                and SKILL_INVOKED.search(block.get("text") or "")):
                            return True
    except Exception:
        return False
    return False


def _is_feedback(content):
    return isinstance(content, str) and content.lstrip().startswith("Stop hook feedback")


def _this_turn(transcript_path):
    """Assistant text and tool calls since the last real user message.

    A Stop hook's feedback is not the user speaking: the walk goes through it.
    `said` keeps only the text after the latest feedback (the retry is judged,
    not the words it replaced); the feedback text joins `called`, because a
    verdict this hook printed is evidence the check ran.
    """
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except Exception:
        return None, None
    said, called = [], []
    past_feedback = False
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
                continue     # a tool RESULT is not a tool CALL; never evidence
            if _is_feedback(c):
                past_feedback = True
                called.append(c)
                continue
            break
        if t == "assistant":
            if not past_feedback:
                said.append(_text_of(msg.get("content"), prose_only=True))
            called.append(_text_of(msg.get("content"), tools_only=True))
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


def _turn_key(transcript_path):
    """Line number of the last real user record (not a tool result, not hook
    feedback). Same definition as conversation-gate.py: the counter is shared."""
    key = 0
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for n, line in enumerate(fh, 1):
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if not isinstance(d, dict) or d.get("isSidechain") or d.get("type") != "user":
                    continue
                c = (d.get("message") or {}).get("content")
                if isinstance(c, list) and all(
                        isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
                    continue
                if not _is_feedback(c):
                    key = n
    except Exception:
        pass
    return key


def _spend_block(payload, turn):
    """True when this session-turn may still block (and spends one block).
    Replaces stop_hook_active. Falls back to it when no counter can be kept."""
    sid = re.sub(r"[^A-Za-z0-9_-]", "_", str(payload.get("session_id") or ""))
    if not sid:
        return not payload.get("stop_hook_active")
    path = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"),
                        "spec-protocol", "blocks", sid)
    # ponytail: no lock; two Stop hooks racing can lose one increment.
    try:
        try:
            with open(path, encoding="utf-8") as fh:
                t, n = fh.read().split()
            n = int(n) if t == str(turn) else 0
        except Exception:
            n = 0
        if n >= MAX_BLOCKS:
            return False
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("%s %d\n" % (turn, n + 1))
        return True
    except Exception:
        return not payload.get("stop_hook_active")


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    reason = _reason(payload)
    if reason and _spend_block(payload, _turn_key(payload.get("transcript_path", ""))):
        print(json.dumps({"decision": "block", "reason": reason}))


def _reason(payload):
    if not _is_spec_protocol_run(payload.get("transcript_path", "")):
        return                      # an operator session is not a client run
    said, called = _this_turn(payload.get("transcript_path", ""))
    if not said or not REFUSAL.search(said):
        return                      # no GATE 0 refusal spoken; nothing to police
    if called and (RAN_CHECK.search(called) or HOOK_RAN_OFF.search(called)):
        return                      # the check was run; the refusal is earned

    rc, line = _run_check()
    if rc == 0:
        return ((
            "GATE 0 REFUSAL BLOCKED — the check behind it was never run, and it is wrong.\n\n"
            f"{line}\n\n"
            "Ultracode IS on in this session. Signals 3 and 4 are COMMANDS, not judgements: "
            "a model cannot observe its own environment variables by thinking about them. "
            "Do not tell the client to switch on something they already have. "
            "Delete that refusal, treat GATE 0 as PASSED via signal 4, and continue with "
            "THE OPENING SCRIPT."))
    if rc is None:
        return ((
            "GATE 0 REFUSAL BLOCKED — you refused without running the check, and the check "
            f"could not be run either ({line}). That is UNDETERMINED, not 'the switch is off'. "
            "Say so in one line, name what could not be run, and do not claim a state you "
            "did not measure."))
    return ((
        "GATE 0 refusal spoken with no check behind it. The check has now been run and it "
        f"does agree with you:\n\n{line}\n\n"
        "Re-state the refusal ONCE, this time citing that verdict line as its evidence, so the "
        "transcript carries the proof the protocol requires."))


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
    # The three ways a real transcript breaks the phrase apart. Before \s+ each
    # of these MISSED, and a refusal spoken that way walked straight past.
    t("a LINE-WRAPPED refusal is recognised",
      bool(REFUSAL.search("One switch has to be on before I can\nstart my helpers.")), True)
    t("a DOUBLE-SPACED refusal is recognised",
      bool(REFUSAL.search("One switch has to be on  before I can start my helpers.")), True)
    t("a NON-BREAKING-SPACE refusal is recognised",
      bool(REFUSAL.search("One switch has to be on" + chr(0xA0) + "before I can start my helpers.")), True)
    t("prose about a switch is still not the refusal",
      bool(REFUSAL.search("The switch is on, so I can start my helpers.")), False)
    t("a run of the check is recognised",
      bool(RAN_CHECK.search('{"command":"bash tools/gate0.sh --check-session"}')), True)
    t("an unrelated command is not",
      bool(RAN_CHECK.search('{"command":"ls -la"}')), False)
    t("the bare flag without the script is not proof",
      bool(RAN_CHECK.search('{"command":"echo --check-session"}')), False)
    t("PROSE naming the command is not evidence it ran",
      bool(_text_of([{"type": "text", "text": "I would run gate0.sh --check-session here."}],
                    tools_only=True)), False)
    t("a real tool_use IS evidence",
      bool(_text_of([{"type": "tool_use", "name": "Bash",
                      "input": {"command": "bash gate0.sh --check-session"}}],
                    tools_only=True)), True)
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
    # The scope escape that blocked this hook's own maintainer: the refusal
    # wording inside a tool INPUT is not speech, and a session that never
    # invoked the skill is not a client run.
    tq = os.path.join(d, "quoted.jsonl")
    with open(tq, "w") as fh:
        fh.write(json.dumps({"type": "user", "message": {"role": "user", "content": "probe the regex"}}) + "\n")
        fh.write(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "Bash", "input": {"command": "python3 -c 'print(\"%s\")'" % REF}}]}}) + "\n")
    said_q, _ = _this_turn(tq)
    t("the refusal inside a tool INPUT is not speech", bool(said_q and REFUSAL.search(said_q)), False)
    t("a session that never invoked the skill is not a run", _is_spec_protocol_run(tq), False)
    tr = os.path.join(d, "run.jsonl")
    with open(tr, "w") as fh:
        fh.write(json.dumps({"type": "user", "message": {"role": "user",
                 "content": "<command-name>/spec-protocol</command-name>"}}) + "\n")
    t("a session that invoked the skill IS a run", _is_spec_protocol_run(tr), True)
    tm = os.path.join(d, "mention.jsonl")
    with open(tm, "w") as fh:
        fh.write(json.dumps({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "content": "<command-name>/spec-protocol</command-name>"}]}}) + "\n")
    t("a marker quoted in a tool_result is not an invocation", _is_spec_protocol_run(tm), False)
    # 20 -- 3 blocks per session-turn, then stand down; and on the retry this
    # hook's own "off" verdict counts as the check having run (no 3x loop).
    saved = os.environ.get("CLAUDE_CONFIG_DIR")
    os.environ["CLAUDE_CONFIG_DIR"] = d
    try:
        spent = [_spend_block({"session_id": "s20"}, 5) for _ in range(4)]
    finally:
        if saved is None:
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
        else:
            os.environ["CLAUDE_CONFIG_DIR"] = saved
    tf = os.path.join(d, "fb.jsonl")
    with open(tf, "w") as fh:
        for rec in ({"type": "user", "message": {"role": "user", "content": "/spec-protocol"}},
                    {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": REF}]}},
                    {"type": "user", "isMeta": True, "message": {"role": "user", "content":
                     "Stop hook feedback:\nGATE0 SESSION | verdict=NO-SESSION-ULTRACODE | env=high"}},
                    {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": REF}]}}):
            fh.write(json.dumps(rec) + "\n")
    said_f, called_f = _this_turn(tf)
    t("#20 3 blocks then stand down; the hook's own verdict is evidence on the retry",
      (spent, _turn_key(tf), bool(HOOK_RAN_OFF.search(called_f)), said_f.count("One switch")),
      ([True, True, True, False], 1, True, 1))
    rc, line = _run_check()
    t("gate0.sh is locatable and runnable", rc in (0, 1, 2), True)
    print(f"  (live check said: {line})")
    if fails:
        print(f"gate0-claim-gate.py selftest: {fails} FAILED")
        sys.exit(2)
    print("gate0-claim-gate.py selftest: ALL PASS (20 checks)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    try:
        main()
    except Exception:
        pass    # a broken gate must never wedge a session
