#!/usr/bin/env python3
"""Stop hook — enforce the spec-protocol CONVERSATION contract mechanically.

WHY THIS EXISTS. Seven releases in one day rewrote this contract in prose and
every one of them produced a NEW conversational defect on the next run: the
naming line used a category word; the entry-mode question was bundled onto it;
an interrupted question was dropped; ANSWERS.md was not created; a GATE 0 check
was never run; a question ended a message but the turn then stalled on a full
stop. The ONLY fix that survived contact was not prose -- it was a Stop hook
(gate0-claim-gate.py), and it has never regressed.

So the conversation contract moves out of SKILL.md and into this script. Prose
in a skill file is ADVISORY to a model. A Stop hook is not.

WHAT IT CHECKS, when a spec-protocol run yields the turn to its client:

  A  STATEMENT-YIELD WITH A QUESTION OWED. The message does not end on a
     question mark while ANSWERS.md still carries an entry marked
     "not yet spoken". That is the 1.21.5 stall: the client is handed a
     statement to stare at and the run waits for a reply to nothing.

  B  PROSE AFTER THE QUESTION MARK. Anything of substance following the last
     "?" turns a question into a remark the client scrolls past. That is the
     1.21.4 defect ("Did I get that right?" ... "From here on I'll call it X.").

  C  TWO QUESTIONS IN ONE MESSAGE -- detected as two question marks separated
     by a BLANK LINE, never as a raw count. An either/or inside one paragraph
     ("Does it need to remember things? Or can it start fresh?") is ONE
     question and must not trip this; two questions in separate paragraphs is
     the wall audience.md forbids.

  D  A QUESTION SPOKEN BUT NOT RECORDED. The message ends on a question whose
     text does not appear under any "**Asked:**" line in ANSWERS.md, so the
     interrupted-question ledger cannot bring it back.

  H  AN INTERRUPTED QUESTION DROPPED. A question was SPOKEN and its answer is
     still blank, and the turn ends on a DIFFERENT question. That is the
     2026-09-20 10:34 failure: entry-mode was asked, the client corrected
     something, the run asked "Did I get that right?" and entry-mode never came
     back. A spoken-but-unanswered question returns before any new one.

  J  LAST TURN'S QUESTION WAS NEVER RECORDED. The PREVIOUS client-facing
     message ended on a question that appears under no "**Asked:**" entry. That
     is the 10:33 half of the same failure and the one H cannot see: with no
     Asked text there is nothing for H to compare, and D is switched off by
     some other entry's blank. The question is already lost when this fires.

  I  BUILD TARGET CONTRADICTS THE PROFILE. The run confirms a surface back to
     the client ("an app people can use on their phone") that the project's own
     .spec-protocol.json targets deny. That is the 2026-09-20 10:30 failure.
     The targets DECIDE the taxonomy; the surface is never re-guessed from the
     word "app".

  K  TURN 1 IS NOT THE OPENING. The first client-facing text after the
     /spec-protocol invocation must begin "Hi, I'm Candace." (or be the GATE 0
     refusal). Detection lines and update offers belong in the operator log.

  L  QUESTION COUNTER BROKEN. "Question N of no more than C": N rises by one
     per turn (a same-words re-ask may repeat N); C rises only ONCE, on the count
     right after the mode question (advanced mode's longer list), and is lowered
     only with interview.md's sentence "Good news -- it will be at most C' now";
     once counting has begun, a question before the last one carries its number.
     After the walk-away (line or `watch-tick.sh --record-session`) L stands down.

  N  NAMING OR STATUS AFTER THE QUESTION in the same paragraph, or more than
     two "?" in one paragraph (an either/or is two; the mandated "Not sure?"
     closer and the client's quoted words are not counted).

  M  ANSWERS.md MISSING after this session ran `answers.sh <project> init`.

  G  JARGON. tools/speech-check.sh runs on every client-facing turn of a run.

SCOPE -- and why this cannot fire on an ordinary session. Nothing runs unless
THIS session's transcript shows the harness invoking the skill (a mid-turn
Skill load of it counts as the run, but never as a client turn boundary). The
ledger checks (A, D, H, I, J, M) additionally need the ledger, and it comes ONLY
from this session's own answers.sh result line `ANSWERS | init|flush | <abs>`
(latest wins) -- including a HELD ledger (`answers.sh init --hold <run-id>`) on
the turns before the project folder exists. No ledger -> the message-shape
checks (B, C, F, K, L, N, G) still run; the ledger checks are not evaluated.
The old ancestor/child-folder search is gone: from ~/Downloads it read a
different client's ledger.

CONTRACT (identical to gate0-claim-gate.py, which is proven in service)
  - reads the hook payload on stdin, ALWAYS exits 0
  - blocks ONLY by printing {"decision":"block","reason":...} to stdout
  - at most 3 blocks per session-turn (counter file under
    $CLAUDE_CONFIG_DIR/spec-protocol/blocks/<session_id>, shared with
    gate0-claim-gate.py), then stands down -- so retries ARE checked, but a
    block can never loop forever
  - any internal error is silent and non-blocking: a broken gate must never
    wedge a session, and a conversation gate that jams is worse than the bug
"""
import json
import os
import re
import sys

ANSWERS_REL = os.path.join("00-INPUT", "ANSWERS.md")
TRAILING_NOISE = re.compile(r"^[\s\"'`)\]\*_>.!-]*$")
UNSPOKEN = re.compile(r"\*\*Asked:\*\*\s*_?(not yet spoken|blank)", re.I)
ASKED_LINE = re.compile(r"^\*\*Asked:\*\*\s*(.+)$", re.M)
PROSE_AFTER_Q_CHARS = 20


# The repo copy beside this hook first (so the selftest tests the file being
# edited), then the installed skill under the config root the hooks live in.
SPEECH_CANDIDATES = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "speech-check.sh"),
    os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"),
                 "skills", "spec-protocol", "tools", "speech-check.sh"),
    os.path.expanduser("~/.claude-nine/skills/spec-protocol/tools/speech-check.sh"),
    os.path.expanduser("~/.claude/skills/spec-protocol/tools/speech-check.sh"),
]
MAX_BLOCKS = 3


def _speech_check(message, home):
    """Lint what the client is about to read. Returns a block reason, or None.

    `speech-check.sh` has existed and worked for weeks and NOTHING ever ran it.
    Its own tick alarm was conditioned on a drafted file under CONTROL/.speech/,
    so speaking without drafting produced no draft, therefore no alarm, therefore
    a silent pass -- a hole shaped exactly like the GATE 0 failure the instrument
    was built to prevent. It accepts stdin, so the message can be linted here,
    where it is already in hand.

    ONLY exit 3 (REJECT) blocks. Exit 2 is UNDETERMINED and 4 is a selftest
    failure: an instrument that could not run proves nothing and must never be
    reported as a fault in the message.
    """
    import subprocess
    import shutil
    for path in SPEECH_CANDIDATES:
        path = os.path.abspath(path)
        if not os.path.isfile(path):
            continue
        cmd = [shutil.which("bash") or "/bin/bash", path, "-"]
        if home and os.path.isdir(home):
            cmd += ["--home", home]
        try:
            r = subprocess.run(cmd, input=message, capture_output=True, text=True, timeout=5)
        except Exception:
            return None                      # could not run it: prove nothing
        if r.returncode != 3:
            return None
        head = (r.stdout or "").splitlines()
        verdict = head[0] if head else "SPEECH-CHECK | verdict=REJECT"
        hits = [ln.strip() for ln in head[1:8] if ln.strip()]
        return ("CLIENT-FACING JARGON. This message carries wording a non-technical "
                "client cannot act on, or an unfilled <placeholder>.\n\n%s\n%s\n\nFill every "
                "placeholder with the real words. Say what the thing DOES instead of "
                "naming it (references/audience.md §2). File paths, workflow ids, law "
                "numbers, model names and dollar figures never reach the client; machine "
                "detail goes to the session log." % (verdict, "\n".join(hits)))
    return None


def _answers_path(project):
    """<project>/00-INPUT/ANSWERS.md when it exists, else None. No searching:
    the project is named by this session's own `answers.sh <project> init`."""
    if not project or not os.path.isdir(project):
        return None
    p = os.path.join(project, ANSWERS_REL)
    return p if os.path.isfile(p) else None


SKILL_INVOKED = re.compile(
    r"Base directory for this skill:\s*\S*spec-protocol|<command-name>/?spec-protocol",
    re.I)
# `answers.sh <project> init` -- the project may be quoted.
INIT_CALL = re.compile(
    r"answers\.sh['\"]?\s+(?:\"([^\"]+)\"|'([^']+)'|([^\s;&|'\"]+))\s+init\b")


def _user_kind(rec):
    """For a `user` record: 'inv' (the harness invoking the skill), 'user' (a real
    turn boundary), 'fb' (a Stop hook's own feedback) or None (a tool result).
    Neither 'fb' nor None is the client speaking; treating hook feedback as a new
    turn would reset the block counter and let a block loop forever."""
    msg = rec.get("message") or {}
    c = msg.get("content")
    if isinstance(c, list) and all(isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
        return None
    if isinstance(c, str) and c.lstrip().startswith("Stop hook feedback"):
        return "fb"
    # Only the harness's own injection counts as an invocation: a plain string or
    # a `text` block. A tool_result or tool_use QUOTING the marker is not one --
    # that is precisely how this hook once caught its own author.
    texts = [c] if isinstance(c, str) else [
        b.get("text") or "" for b in (c or []) if isinstance(b, dict) and b.get("type") == "text"]
    # A skill loaded MID-TURN by the Skill tool arrives as a user record carrying
    # the sourceToolUseID of that call. It is the harness, not the client: never a
    # turn boundary (G7). A mid-turn load of THIS skill still marks the run ('minv').
    mid_turn = bool(rec.get("sourceToolUseID"))
    if msg.get("role") == "user" and any(SKILL_INVOKED.search(t) for t in texts):
        return "minv" if mid_turn else "inv"
    if mid_turn:
        return None
    return "user"


RUN_KINDS = ("inv", "minv")
# answers.sh's own result line: the ledger it actually wrote, as an absolute path.
RESULT_LINE = re.compile(r"^ANSWERS \| (?:init|flush) \| (/.*ANSWERS\.md)\s*$", re.M)
HELD_MARK = os.sep + os.path.join("spec-protocol", "runs") + os.sep


def _result_text(rec):
    """The text of every tool_result block in a user record."""
    out = []
    for b in (rec.get("message") or {}).get("content") or []:
        if not isinstance(b, dict) or b.get("type") != "tool_result":
            continue
        c = b.get("content")
        if isinstance(c, str):
            out.append(c)
        elif isinstance(c, list):
            out += [x.get("text") or "" for x in c if isinstance(x, dict)]
    return "\n".join(out)


def _events(transcript_path):
    """This session's main chain, forward: (kind, value, line_no) with kind in
    inv / minv (mid-turn load of this skill) / user / fb (hook feedback) / text
    (assistant prose) / cmd (a tool_use `command` string) / res (tool result text)."""
    out = []
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for n, line in enumerate(fh, 1):
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if not isinstance(d, dict) or d.get("isSidechain"):
                    continue
                if d.get("type") == "user":
                    k = _user_kind(d)
                    if k:
                        out.append((k, None, n))
                    else:
                        res = _result_text(d)
                        if "ANSWERS |" in res:
                            out.append(("res", res, n))
                elif d.get("type") == "assistant":
                    for b in (d.get("message") or {}).get("content") or []:
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "text" and (b.get("text") or "").strip():
                            out.append(("text", b["text"], n))
                        elif b.get("type") == "tool_use":
                            cmd = (b.get("input") or {}).get("command")
                            if isinstance(cmd, str):
                                out.append(("cmd", cmd, n))
    except Exception:
        return []
    return out


# D2 -- a MID-TURN load of the skill (an operator session reading it through the
# Skill tool) is a run only when this session also opened one: `gate0.sh --open`
# or `answers.sh ... init`. A typed /spec-protocol ('inv') is always a run.
RUN_PROOF = re.compile(r"gate0\.sh['\"]?\s[^\n]*--open\b|answers\.sh['\"]?\s[^\n]*\binit\b")


def _is_run(ev):
    if any(k == "inv" for k, _, _ in ev):
        return True
    return any(k == "minv" for k, _, _ in ev) and \
        any(k == "cmd" and RUN_PROOF.search(v) for k, v, _ in ev)


def _is_spec_protocol_run(transcript_path):
    """Is THIS SESSION a spec-protocol client conversation? Only the harness's
    skill injection counts; discussing, editing or standing in the folder does
    not."""
    return _is_run(_events(transcript_path))


def _project_from_events(ev, cwd=None):
    """The project whose ledger this session's latest answers.sh init/flush wrote,
    as an absolute path, or None (then only the message-shape checks run).

    The path comes from answers.sh's own RESULT line in the tool result
    (`ANSWERS | init | <abs>/00-INPUT/ANSWERS.md`), never from the command text:
    `"$P"` or `.` after a cd cannot be resolved from the words typed (G2). An
    absolute path in the command is the fallback for a call whose result is
    missing (init that failed: check M). A HELD ledger (`init --hold`) resolves to
    its run folder under the config root; `_is_held` names that case."""
    project = None
    for k, v, _ in ev:
        if k == "res":
            for m in RESULT_LINE.finditer(v):
                project = os.path.dirname(os.path.dirname(m.group(1).strip()))
        elif k == "cmd":
            for m in INIT_CALL.finditer(v):
                p = os.path.expanduser(next(g for g in m.groups() if g))
                if "$" not in p and os.path.isabs(p):
                    project = p
    return os.path.abspath(project) if project else None


def _is_held(project):
    return bool(project) and HELD_MARK in project + os.sep


def _turn_start(ev):
    return max((n for k, _, n in ev if k in ("inv", "user")), default=0)


def _turn_key(transcript_path):
    """Line number of the last real user record: every block and retry inside one
    turn shares it. Same definition in gate0-claim-gate.py (shared counter)."""
    return _turn_start(_events(transcript_path))


def _spend_block(payload, turn):
    """True when this session-turn may still block (and spends one block).

    Replaces stop_hook_active, which left every retry unchecked. After
    MAX_BLOCKS blocks in one turn the gate stands down. If the counter cannot be
    kept, fall back to stop_hook_active so a block still cannot loop forever.
    """
    sid = re.sub(r"[^A-Za-z0-9_-]", "_", str(payload.get("session_id") or ""))
    if not sid:
        return not payload.get("stop_hook_active")
    path = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"),
                        "spec-protocol", "blocks", sid)
    # ponytail: read-modify-write without a lock; two Stop hooks racing can lose
    # one increment (4 blocks instead of 3). Add flock if that ever matters.
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


# --- K: turn 1 of the run is the opening ------------------------------------
GREETING = "Hi, I'm Candace."
GATE0_REFUSAL = re.compile(r"\s+".join(
    ["one", "switch", "has", "to", "be", "on",
     "before", "i", "can", "start", "my", "helpers"]), re.I)


def _opening_text(ev):
    """The first client-facing text of the run when THIS turn is turn 1, else None.

    Turn 1 = no assistant prose between the latest invocation and this turn's
    start. Within the turn, the text after the latest Stop-hook block is judged,
    so a corrected retry is not re-judged on the words it replaced.
    """
    last_inv = max((n for k, _, n in ev if k in RUN_KINDS), default=None)
    if last_inv is None:
        return None
    start = _turn_start(ev)
    if any(k == "text" and last_inv < n <= start for k, _, n in ev):
        return None
    start = max([start] + [n for k, _, n in ev if k == "fb"])
    texts = [v for k, v, n in ev if k == "text" and n > start]
    return texts[0] if texts else None


def _opening_problem(text):
    clean = re.sub(r"^[\s>*_#]+", "", _strip_quote_markers(text or "")).replace("’", "'")
    if not clean or clean.startswith(GREETING) or GATE0_REFUSAL.search(clean):
        return None
    return ("TURN 1 IS NOT THE OPENING. The first thing the client reads in a run is the "
            "opening script, beginning exactly \"%s\" (or the GATE 0 refusal). Detection "
            "lines, update offers and setup notes go to the operator log, never to the "
            "client. Say the opening script now, and nothing before it." % GREETING)


# --- L: the question counter -------------------------------------------------
COUNTER = re.compile(r"Question\s+(\d+)\s+of\s+no\s+more\s+than\s+(\d+)\W*(.{0,60})", re.I | re.S)
# D3 -- the walk-away (audience.md §5) ends the interview; watch-tick records it.
WALKED_CMD = re.compile(r"watch-tick\.sh['\"]?\s[^\n]*--record-session\b")
WALKED_LINE = re.compile(r"That['’]s everything I need\.\s*Leave this window open", re.I)
# D5 -- the mode question (interview.md §3 item 1). Its answer may set the list
# length (advanced adds section 4), so C may rise ONCE, on the very next count.
MODE_Q = re.compile(r"handle most of (?:it|the decisions) for you", re.I)


def _counter_problem(message, prior_texts):
    """Block when "Question N of no more than C" does not rise by exactly one, or
    C moved other than DOWN with interview.md's lowering sentence ("Good news --
    it will be at most C' now"), or -- once counting has begun and is not
    finished -- a question is asked without its number. A re-ask of the same
    question in the same words (check H demands it) may repeat N."""
    prev, ceiling, after_mode = None, None, False
    for t in prior_texts:
        found = COUNTER.findall(t or "")
        if found:
            prev, ceiling = found[-1], int(found[-1][1])
        low = LOWERING.findall(t or "")
        if low and ceiling is not None:
            ceiling = min(ceiling, int(low[-1]))
        # D5: true only while the LATEST earlier message is the mode question.
        after_mode = bool(MODE_Q.search(t or ""))
    if not prev:
        return None                  # counting has not begun
    msg = ODD_QUESTION_MARK.sub("?", message or "")
    cur = COUNTER.findall(msg)
    low = LOWERING.findall(msg)
    if low and int(low[-1]) > ceiling:
        return ("QUESTION COUNT RAISED. The client was promised at most %d; \"at most %s\" "
                "raises it. The ceiling may only ever be lowered." % (ceiling, low[-1]))
    allowed = int(low[-1]) if low else ceiling
    if after_mode and cur and int(cur[-1][1]) > ceiling:
        allowed = int(cur[-1][1])    # the one sanctioned raise: advanced mode's longer list
    if not cur:
        clean = _strip_quote_markers(msg)
        if int(prev[0]) < ceiling and not STATUS_SHAPE.match(clean) and \
                _ends_on_question(MANDATED_TAILS.sub("", clean).strip() or clean)[0]:
            return ("COUNTED QUESTION WITHOUT ITS NUMBER. Counting began at Question 1, so "
                    "every question until the last is spoken as \"Question %d of no more "
                    "than %d -- <the question>\" (interview.md §6)." % (int(prev[0]) + 1, allowed))
        return None
    (n, c, q), (pn, pc, pq) = cur[-1], prev
    flat = lambda s: re.sub(r"\s+", " ", s).strip()
    if int(c) != allowed:
        return ("QUESTION COUNT CHANGED. The client was last told \"of no more than %d\"; now "
                "\"of no more than %s\". The ceiling never rises, and it is lowered only by "
                "saying first: \"Good news -- it will be at most <C'> now, because <the "
                "reason>.\" Keep it at %d." % (ceiling, c, allowed))
    if int(n) == int(pn) + 1 or (n == pn and flat(q) == flat(pq)):
        return None
    return ("QUESTION NUMBER OUT OF ORDER. The last counted question was Question %s; this one "
            "says Question %s. Each counted question is the next number, Question %d. (Re-asking "
            "an unanswered question in the same words keeps its number.)" % (pn, n, int(pn) + 1))


def _client_prose(transcript_path, back=0):
    """Assistant prose of THIS turn (back=0) or the turn before it (back=1).

    The walk must STOP at the user's own message. Without that boundary a turn
    that produced only tool_use blocks (a build step, a file write) falls
    through to the PREVIOUS turn's prose and the gate judges a message the
    client read and already answered -- blocking work on a settled sentence.
    A `tool_result` record is the harness handing a tool's output back, not the
    user speaking, so the walk continues through those. Same boundary idiom as
    gate0-claim-gate.py `_this_turn`. Counting those boundaries is also how the
    PREVIOUS turn is reached, which is what check J needs.
    """
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except Exception:
        return None
    crossed = 0
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
        if d.get("type") == "user":
            if _user_kind(d) in (None, "fb", "minv"):
                continue            # a tool RESULT, hook feedback or mid-turn skill load is not the user speaking
            crossed += 1
            if crossed > back:
                return None         # walked past the turn asked for
            continue
        if d.get("type") != "assistant":
            continue
        content = (d.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        text = "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text").strip()
        if text and crossed == back:
            return text
    return None


def _last_client_message(transcript_path):
    """The final assistant prose of THIS TURN -- what the client actually read."""
    return _client_prose(transcript_path, 0)


def _strip_quote_markers(text):
    """The skill speaks in markdown blockquotes; the client sees the words."""
    return "\n".join(re.sub(r"^\s*>\s?", "", ln) for ln in text.splitlines()).strip()


def _ends_on_question(text):
    tail = text.rsplit("?", 1)
    if len(tail) < 2:
        return False, None
    after = tail[1]
    return bool(TRAILING_NOISE.match(after)), after


UNANSWERED_CELL = re.compile(
    r"^\|\s*([^|]+?)\s*\|\s*(_*(?:blank|not\s*yet|pending|awaiting)[^|]*|—|-{1,3})?\s*\|",
    re.I | re.M)


def _owed(answers_text):
    """Question keys the RUN still owes -- asked-side blank, not client-side.

    TWO ledger shapes exist in the wild and both are legitimate: the key/value
    form this skill writes today, and the markdown TABLE the 2026-09-08 runs
    wrote. A reader that knows only one shape silently reports nothing owed on
    the other, which disables the stall guard exactly where it is needed.
    """
    out = []
    for block in re.split(r"\n(?=## )", answers_text):
        if UNSPOKEN.search(block):
            head = block.splitlines()[0].strip()
            out.append(head.lstrip("# ").strip())
    for m in UNANSWERED_CELL.finditer(answers_text):
        key = m.group(1).strip()
        if key and key.lower() not in ("key", "question", "---"):
            out.append(key)
    return out


FENCED_BLOCK = re.compile(r"```.*?```", re.S)
QUOTED_SPAN = re.compile(r"\"[^\"\n]*\"")


def _countable(text):
    """The text as the TWO-QUESTION count must see it.

    A "?" inside a ``` fenced block is an EXAMPLE, not a question put to the
    client. A "?" inside double quotes is the CLIENT's own words said back to
    them -- which references/interview.md requires ("say the answer back in
    their words"). Counting either as a second question blocks two shapes the
    interview mandates. This trims the COUNT only; `_ends_on_question` still
    reads the real text, so a message genuinely ending on a quoted question is
    unaffected.
    """
    return QUOTED_SPAN.sub(" ", FENCED_BLOCK.sub(" ", text))


def _two_paragraph_questions(text):
    paras = [p for p in re.split(r"\n\s*\n", text) if "?" in p]
    return len(paras) >= 2


ANSWER_BLANK = re.compile(r"\*\*Answer:\*\*\s*[_\s]*(blank|not\s*yet|pending|awaiting|—)", re.I)


def _pending(answers_text):
    """Questions SPOKEN and still unanswered -- the interrupted-question set.

    Distinct from `_owed`, which is the asked-side blank ("not yet spoken").
    These were said OUT LOUD to the client and the answer slot is still empty,
    so they are what the run must come back to. Both ledger shapes again: the
    key/value blocks this skill writes, and the markdown table the 2026-09-08
    runs wrote, where the key cell IS the question text.
    """
    out = []
    for block in re.split(r"\n(?=## )", answers_text):
        if UNSPOKEN.search(block):
            continue                        # never spoken: that is _owed's job
        m = ASKED_LINE.search(block)
        if not m:
            continue
        asked = m.group(1).strip().strip('"').strip()
        if not asked or asked.startswith("_"):
            continue                        # a placeholder, not a spoken question
        if not ANSWER_BLANK.search(block):
            continue
        out.append((block.splitlines()[0].lstrip("# ").strip(), asked))
    for line in answers_text.splitlines():
        m = UNANSWERED_CELL.match(line)
        if not m:
            continue
        key = m.group(1).strip()
        if not key or key.lower() in ("key", "question", "---") or "?" not in key:
            continue                        # a row whose key carries no question
        out.append((key, key))
    return out


def _ellipsis(text, n):
    """Quote the first n chars, and SAY it was cut -- a mid-word truncation
    followed by the sentence's own full stop reads as the whole question."""
    return text if len(text) <= n else text[:n].rstrip() + "..."


def _final_question_para(text):
    paras = [p for p in re.split(r"\n\s*\n", text) if "?" in p]
    return paras[-1] if paras else text


def _matches_pending(message, pend):
    """Is the question this turn ends on one of the hanging ones?"""
    tail = re.sub(r"\s+", " ", _final_question_para(message)).strip()[-40:]
    flat_msg = re.sub(r"\s+", " ", message)
    for _key, asked in pend:
        flat = re.sub(r"\s+", " ", asked).strip()
        if tail and tail in flat:
            return True
        if flat and flat[-40:] in flat_msg:
            return True
    return False


def _recorded(question_text, answers_text):
    tail = re.sub(r"\s+", " ", question_text).strip()[-40:]
    flat = re.sub(r"\s+", " ", answers_text)
    if tail and tail in flat:
        return True
    for m in ASKED_LINE.finditer(answers_text):
        asked = re.sub(r"\s+", " ", m.group(1)).strip().strip('"')
        if asked and (asked[-40:] in re.sub(r"\s+", " ", question_text)):
            return True
    return False


CATEGORY_NAMING = re.compile(
    r"call it your\s+(app for phones|website you sign into|app for phones and computers|"
    r"computer program|website|selling pages|mobile app|web app|desktop software|funnel|"
    r"application|app|program|platform|software)\b",
    re.I)
AUTO_SLUG = re.compile(r"^[a-z]+(-[a-z]+)*-\d{4}-\d{2}-\d{2}$")
SELF_RESOLVED_FORK = re.compile(
    r"(unless you (say|tell me) otherwise|I'?m going with the|I'?ll go with the|"
    r"going with (the )?(first|second|option))", re.I)
# A DEFAULT taken in a LATER turn is the shape interview.md MANDATES ("I don't
# know earns a default"). It reads like a self-resolved fork because it IS the
# same sentence -- one turn later, after the question went unanswered. The
# marker is what separates the two, so F must stand down when it is present.
DEFAULT_TAKEN = re.compile(
    r"(didn['’]?t say|no answer|went unanswered|"
    r"recorded as (a |the )?default|as (a|the) default)", re.I)
# Fullwidth and variant question marks. A client pasting from a phone keyboard
# or a CJK IME produces these, and every "?" test in this file then reads the
# turn as ending on a statement -- the exact stall the gate exists to catch,
# caused by the gate itself.
ODD_QUESTION_MARK = re.compile(r"[？⁇﹖]")
# SKILL.md ORDERS this sentence onto the end of every either/or question, and
# interview.md orders the second onto the end of a reassured one. Both end on a
# full stop, so without this the gate blocks the wording it mandates.
_TAIL_BODY = (r"(?:"
              r"Not sure\?\s*That['’]?s okay\.\s*I['’]?ll choose what makes the most sense\."
              r"|If you don['’]?t know,?\s*that['’]?s okay\."
              r")")
MANDATED_TAILS = re.compile(r"\s*" + _TAIL_BODY + r"\s*$", re.I)
MANDATED_TAIL_ANY = re.compile(_TAIL_BODY, re.I)
# G5 -- a naming or status sentence tucked after the final "?" in the SAME
# paragraph turns the question into a remark (the 1.21.4 shape, one line down).
NAMING_OR_STATUS = re.compile(
    r"(from here on|I['’]?ll call it|\bcall it\b|\bI['’]?ve (named|saved|recorded|written|filed|noted)\b|"
    r"\bI (named|saved|recorded|wrote|filed|noted)\b|still working|pieces done|\bprogress\b)", re.I)
MAX_Q_PER_PARA = 2
# G4 -- interview.md's lowering sentence: "Good news — it will be at most <C'> now".
LOWERING = re.compile(r"it will be at most\s+(\d+)", re.I)
# A mandated REQUEST is a yield too: the key asks end "Copy it, then say ready,
# and I'll file it..." and the pictures ask ends "...then say done." The client
# has something to do and a word to reply with; that is not a stall.
YIELD_REQUEST = re.compile(r"\bthen say (ready|done)\b", re.I)
GENERIC_DIRS = {"projects", "downloads", "documents", "desktop", "tmp", "src", "work"}
# A folder named after the CATEGORY supplies no name. Without this, a project in
# .../projects/Website is told off by check E for saying "your website" -- the
# only words available to it.
CATEGORY_DIRS = {"website", "web app", "webapp", "app", "mobile app", "funnel",
                 "software", "desktop software", "computer program", "site",
                 "program", "project"}
# A progress report is not a conversational turn. Without this, ONE stale
# "not yet spoken" line nags every status message for the rest of a long build.
STATUS_SHAPE = re.compile(r"^\s*(still working|working\s*[:✓]|i'?m still|progress:)", re.I)


def _project_name(cwd):
    """A real name for the thing, from the folder the run lives in."""
    base = os.path.basename(os.path.normpath(cwd or ""))
    if not base or base.lower() in GENERIC_DIRS or AUTO_SLUG.match(base):
        return None
    if re.sub(r"[-_]+", " ", base).strip().lower() in CATEGORY_DIRS:
        return None              # the folder IS the category; it is not a name
    trimmed = re.sub(r"\s+(Program|Project|Folder|App)$", "", base).strip()
    return trimmed or None


def _ledger_name(answers_text):
    """D1 -- on a fresh run (held ledger, no folder name) the name comes from the
    client's own recorded words: the `name` answer, else the `idea` answer. A bare
    category ("an app", "a website") is not a name."""
    for key in ("name", "idea"):
        m = re.search(r"^## %s[ \t]*\n(?:(?!## ).*\n)*?\*\*Answer:\*\*\s*\"([^\"\n]+)\"" % key,
                      answers_text or "", re.M)
        if not m:
            continue
        v = m.group(1).strip()
        bare = re.sub(r"^(an?|the|my)\s+", "", v.strip(" .!").lower())
        if v and bare not in CATEGORY_DIRS:
            return v
    return None


# --- I: the declared profile decides the surface, not the word "app" --------
CONFIRM_SENTENCE = re.compile(
    r"call it your|you want an?\b|did I get that right|what I['’]?ll build", re.I)
SURFACE_CLAIM = (
    ("mobile", re.compile(r"app for phones\b(?! and)|on their phones?\b|phone app|mobile app", re.I)),
    ("desktop", re.compile(r"computer program|desktop software|lives on your computer|"
                           r"on your computer\b", re.I)),
    ("web", re.compile(r"website|web app|selling pages|funnel|sign into", re.I)),
)


def _target_family(target):
    t = str(target or "").lower()
    if t.startswith("desktop-"):
        return "desktop"
    if t.endswith("-web") or t.startswith("web-"):
        return "web"
    if re.match(r"(ios|android|mobile)-", t):
        return "mobile"
    return None                  # an unrecognised target decides nothing


def _target_clash(clean, targets):
    """(claim family, target, profile family) when the spoken surface is wrong.

    Only a CONFIRM or NAMING sentence counts. "People can use it on their
    phones" said in passing about a desktop program is a description of reach,
    not a claim about what is being built; "You want an app people can use on
    their phone" is the claim, and it is the one that ships a phone app to a
    client who asked for a Mac program.
    """
    if not isinstance(targets, list) or not targets:
        return None
    primary = str(targets[0])
    fam = _target_family(primary)
    if not fam:
        return None
    for sentence in re.split(r"(?<=[.!?])\s+", clean):
        if not CONFIRM_SENTENCE.search(sentence):
            continue
        for claim, rx in SURFACE_CLAIM:
            if claim != fam and rx.search(sentence):
                return claim, primary, fam
    return None


def evaluate(message, answers_text, project_name=None, targets=None, prev_message=None):
    """Return a block reason, or None. Pure -- this is what the selftest drives."""
    message = ODD_QUESTION_MARK.sub("?", message or "")
    clean = _strip_quote_markers(message)
    if not clean:
        return None
    # A MANDATED closer is part of the question it follows, not prose after it.
    ends_q, after = _ends_on_question(MANDATED_TAILS.sub("", clean).strip() or clean)
    owed = _owed(answers_text)

    # I -- the 10:30 defect: a surface confirmed that the profile denies.
    clash = _target_clash(clean, targets)
    if clash:
        return ("BUILD TARGET CONTRADICTS THE PROFILE. You described %s while "
                ".spec-protocol.json declares targets[0] = %s (%s). A profile's targets "
                "DECIDE the taxonomy (SKILL.md); the client is confirmed from the declared "
                "target, never re-guessed from the word 'app'. Restate it from the profile."
                % (clash[0], clash[1], clash[2]))

    # E -- the 1.21.1 defect: a category label where a real name exists.
    m = CATEGORY_NAMING.search(clean)
    if m and project_name:
        return ("CATEGORY WORD INSTEAD OF THE NAME. You said \"call it your %s\" while a "
                "name is already in hand: \"%s\". Reading everything and then using a bucket "
                "label reads exactly like having read nothing. Call it by its name; the "
                "category word is only for a project that genuinely has no name."
                % (m.group(1), _ellipsis(project_name, 80)))

    # F -- the 1.21.4 defect: a fork announced and decided in the same breath.
    # A LATER-turn default carries its marker and is the mandated shape, not this.
    if not ends_q and SELF_RESOLVED_FORK.search(clean) and not DEFAULT_TAKEN.search(clean):
        return ("FORK SELF-RESOLVED. You have announced a choice the client never got to "
                "make and ended the turn on it. A genuine fork is ASKED: two plain options, "
                "one sentence saying which you would pick and why, then the question -- and "
                "the message ends there. The default may only be taken in a LATER turn, "
                "after the question has gone unanswered, and is recorded as a DEFAULT.")

    # J -- the 10:33 half of the same failure, and the one H cannot see: the
    # question was SPOKEN last turn and never written down, so the ledger still
    # says "not yet spoken" and there is no Asked text for H to find. D is off
    # because some OTHER entry is blank. Runs whatever shape this turn takes.
    if prev_message:
        prev = _strip_quote_markers(ODD_QUESTION_MARK.sub("?", prev_message))
        prev_q = _final_question_para(prev)
        if prev and _ends_on_question(MANDATED_TAILS.sub("", prev).strip() or prev)[0] \
                and not _recorded(prev_q, answers_text):
            return ("QUESTION SPOKEN LAST TURN WAS NEVER RECORDED. Last turn you asked: \"%s\". "
                    "00-INPUT/ANSWERS.md carries no **Asked:** entry for it, so it was never "
                    "on the re-ask list and it is about to be lost. Record it now under its "
                    "key with the client's reply, or with a blank answer if they did not "
                    "answer it, BEFORE asking anything else."
                    % _ellipsis(re.sub(r"\s+", " ", prev_q).strip(), 80))

    # G5 -- a naming or status sentence after the final "?" in the same
    # paragraph; and more than two "?" in one paragraph (an either/or is two;
    # the mandated "Not sure?" closer and quoted client words do not count).
    if after is not None and NAMING_OR_STATUS.search(re.split(r"\n\s*\n", after)[0]):
        return ("NAMING OR STATUS AFTER THE QUESTION. After your last question the same "
                "paragraph goes on to %r, so the client reads a remark, not a question. Say "
                "the naming or status line FIRST, then ask; the question is the last thing "
                "in the message." % _ellipsis(re.split(r"\n\s*\n", after)[0].strip(), 60))
    for para in re.split(r"\n\s*\n", _countable(MANDATED_TAIL_ANY.sub(" ", clean))):
        if para.count("?") > MAX_Q_PER_PARA:
            return ("TOO MANY QUESTIONS IN ONE PARAGRAPH. One paragraph carries %d question "
                    "marks. One question at a time (audience.md §1); an either/or is the "
                    "most one paragraph may hold." % para.count("?"))

    # A question whose SAME paragraph carries a trailing reassurance or example
    # ("...yourbusiness.com? If you don't know, that's okay.") still ends the
    # turn on that question -- the house style check B already allows. Judging
    # it as a statement-yield blocked 6 mandated wordings on a placeholder
    # ledger (selftest case 22).
    if ends_q or (after is not None and not re.search(r"\n\s*\n\s*\S", after)):
        if _two_paragraph_questions(_countable(clean)):
            return ("TWO QUESTIONS IN ONE MESSAGE. Question marks appear in two separate "
                    "paragraphs. One question at a time (audience.md §1): ask the first, let "
                    "the client answer, then ask the next. An either/or inside a single "
                    "paragraph is one question and is fine; these are two.")

        # H -- the 10:34 defect: a spoken question left hanging while a NEW one
        # is asked. Check A cannot see this (the turn DID end on a question) and
        # check D is switched off by the very blank that proves the problem.
        # UNCONDITIONAL on what else is planned: SKILL.md makes a key with a
        # blank answer the re-ask list, "read before every question", so at
        # yield time a spoken-and-blank entry IS hanging no matter what else the
        # run intends to ask next.
        pend = _pending(answers_text)
        if pend and not _matches_pending(clean, pend):
            return ("RETURN TO THE UNANSWERED QUESTION: %s. A question that was spoken and "
                    "never answered comes back before any new one (SKILL.md: an interrupted "
                    "question is unanswered, and it comes back). Ask it again now, in the "
                    "same words." % ", ".join(k for k, _ in pend))

        pending = (re.search(r"\*\*Answer:\*\*\s*_?(blank|not yet)", answers_text, re.I)
                   or UNANSWERED_CELL.search(answers_text))
        # Match the question itself, not a same-paragraph closer after it.
        if answers_text and not pending and not _recorded(clean[:clean.rfind("?") + 1],
                                                          answers_text):
            return ("QUESTION SPOKEN BUT NOT RECORDED. You asked the client something and "
                    "00-INPUT/ANSWERS.md shows nothing awaiting an answer, so this question "
                    "exists only in the conversation. Write it there under **Asked:** with a "
                    "blank answer BEFORE yielding -- an interruption will otherwise lose it "
                    "and it will never come back.")
        return None

    # Did not end on a question.
    # What must not follow a question is a NEW STATEMENT ON A NEW TOPIC -- the
    # naming line after "Did I get that right?". A trailing reassurance or example
    # list in the SAME paragraph belongs to the question and is the house style for
    # a non-technical client: "...something like yourbusiness.com? If you don't
    # know, that's okay." Measured against references/interview.md, a naive
    # character count blocks 15 of 48 mandated wordings -- the gate would jam the
    # interview it exists to protect. Paragraph separation is the real signal.
    if after is not None and re.search(r"\n\s*\n\s*\S", after):
        tail = after.strip().split("\n\n")[-1].strip()
        return ("NEW PARAGRAPH AFTER THE QUESTION. Your last question is followed by a "
                "separate paragraph (%r...), so it reads as a remark the client scrolls "
                "past rather than something to answer. The question is the LAST thing in "
                "the message. A reassurance or an example list in the SAME paragraph is "
                "fine and is the house style; a new paragraph is not."
                % tail[:60])
    # A stands down while H has a pending entry: A would demand the next UNSPOKEN
    # question while H demands the spoken-and-unanswered one back -- two gates
    # ordering two different questions. The hanging one wins.
    if owed and not STATUS_SHAPE.match(clean) and not _pending(answers_text) \
            and not YIELD_REQUEST.search(clean):
        return ("TURN ENDED ON A STATEMENT WHILE A QUESTION IS OWED: %s. "
                "A client-facing turn ends ON a question. You have handed the client a "
                "statement and stopped, so they have nothing to answer and the run waits "
                "for a reply to nothing. Ask the owed question now -- an acknowledgement "
                "may open the message, the question closes it." % ", ".join(owed))
    return None


def _reason(payload):
    """The block reason for this Stop, or None."""
    tp = payload.get("transcript_path", "")
    ev = _events(tp)
    if not _is_run(ev):
        return None                  # not a run: an operator session, a discussion
    message = _last_client_message(tp)
    if not message:
        return None
    cwd = payload.get("cwd") or os.getcwd()

    # K -- turn 1 is the opening script.
    opening = _opening_text(ev)
    if opening is not None:
        r = _opening_problem(opening)
        if r:
            return r

    # L -- the question counter, against the last counted question of an
    # EARLIER turn (a blocked attempt in this turn is not a previous question).
    # D3 -- after the walk-away the interview is over: nothing is counted.
    start = _turn_start(ev)
    walked = any((k == "cmd" and WALKED_CMD.search(v)) or (k == "text" and WALKED_LINE.search(v))
                 for k, v, _ in ev)
    r = None if walked else _counter_problem(
        message, [v for k, v, n in ev if k == "text" and n < start])
    if r:
        return r

    project = _project_from_events(ev, cwd)
    held = _is_held(project)
    answers_text = None
    if project:
        answers = os.path.join(project, ANSWERS_REL)
        # M -- init was run in this session, so the ledger must exist.
        if not os.path.isfile(answers):
            return ("ANSWERS.MD IS MISSING. This session ran `answers.sh %s init`, but "
                    "%s does not exist, so no question can be recorded and none can come "
                    "back after an interruption. Run `tools/answers.sh <project> init` again "
                    "and check it succeeded before speaking to the client."
                    % (os.path.basename(project), os.path.join(os.path.basename(project), ANSWERS_REL)))
        try:
            with open(answers, encoding="utf-8", errors="replace") as fh:
                answers_text = fh.read()
        except Exception:
            answers_text = None
        if answers_text is not None:
            targets = None
            try:
                with open(os.path.join(project, ".spec-protocol.json"), encoding="utf-8") as fh:
                    declared = (json.load(fh) or {}).get("targets")
                if isinstance(declared, list) and declared:
                    targets = declared
            except Exception:
                targets = None        # no profile, or unreadable: check I stands down
            # A HELD ledger's folder is a run id, never the thing's name; then the
            # client's recorded name/idea answer supplies it (D1).
            name = (None if held else _project_name(project)) or _ledger_name(answers_text)
            r = evaluate(message, answers_text, name, targets, _client_prose(tp, 1))
            if r:
                return r
    if answers_text is None:
        # G1 -- no ledger yet (turns 2-3 of a run that never held one): the
        # message-shape checks still run. No ledger means no owed/pending set and
        # nothing for J to look up, so those stand down rather than guess.
        r = evaluate(message, "")
        if r:
            return r

    # G -- the jargon lint, on every client-facing turn of a run.
    return _speech_check(_strip_quote_markers(message), None if held else project)


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


# ---------------------------------------------------------------------------
# The selftest -- every fixture is a real message from a real run
# ---------------------------------------------------------------------------
# The ordinary mid-interview state: the last question is ANSWERED and written
# down, and the next one is planned but not yet spoken. A run that acknowledges
# an answer has, by contract, recorded it before yielding -- so this, not
# HANGING, is the ledger behind a turn that moves on to the next question.
OWED = """# Answers
## build-target (step 3)
**Asked:** "Got it. You want a program people use directly on their computer. Did I get that right?"
**Answer:** ANSWERED yes

## entry-mode (step 3)
**Asked:** _not yet spoken — comes immediately after build-target confirms_
**Answer:** _blank_
"""

# The same ledger with build-target still SPOKEN AND BLANK. That entry is the
# re-ask list, so any new question yielded against this ledger drops it.
HANGING = """# Answers
## build-target (step 3)
**Asked:** "Got it. You want a program people use directly on their computer. Did I get that right?"
**Answer:** _blank — spoken, awaiting reply_

## entry-mode (step 3)
**Asked:** _not yet spoken — comes immediately after build-target confirms_
**Answer:** _blank_
"""

SETTLED = """# Answers
## build-target (step 3)
**Asked:** "Did I get that right?"
**Answer:** ANSWERED yes

## entry-mode (step 3)
**Asked:** I can learn about your idea in one of two ways. Which would you rather do?
**Answer:** ANSWERED own words
"""

# The 2026-09-20 10:34 failure: entry-mode was SPOKEN, the client corrected
# something else, and it was never answered. Nothing is left unspoken, so the
# run has no planned question to move to -- any new question drops this one.
INTERRUPTED = """# Answers
## build-target (step 3)
**Asked:** "You want a program people use directly on their computer. Did I get that right?"
**Answer:** ANSWERED yes

## entry-mode (step 4)
**Asked:** "I can learn about your idea in one of two ways: you tell me in your own words, or I ask you a short list. Which would you rather do?"
**Answer:** _blank — spoken, awaiting reply_
"""

ENTRY_MODE_Q = ("I can learn about your idea in one of two ways: you tell me in your own "
                "words, or I ask you a short list. Which would you rather do?")

# The table shape, with the question living in the key cell and no answer yet.
PENDING_TABLE = ("# ANSWERS\n\n| Question | Answer |\n|---|---|\n"
                 "| What is your business name? | Brightside Studio |\n"
                 "| Do you picture people using this on their phones, or on a computer? "
                 "| _blank_ |\n")


# Placeholder-style ledgers: what `answers.sh init` leaves before anything is
# spoken (every planned key "_not yet spoken_"), in both shapes.
PLACEHOLDER_KV = ("# Answers\n\n## idea\n**Asked:** _not yet spoken_\n**Answer:** _blank_\n\n"
                  "## entry-mode\n**Asked:** _not yet spoken_\n**Answer:** _blank_\n")
PLACEHOLDER_TABLE = ("# ANSWERS\n\n| Key | Answer | Status |\n|---|---|---|\n"
                     "| idea | _blank_ | |\n| entry-mode | _blank_ | |\n")


def _quoted_scripts(doc):
    """The client wordings a document mandates: each blockquote group (a
    multi-paragraph quote is one message) that is spoken as a turn (carries a
    "?" or asks for a reply), plus every double-quoted wording carrying a "?".
    Operator notes quoted in bold and status-bar samples in backticks are not
    client turns."""
    out, cur = [], []
    for ln in doc.splitlines() + ["."]:
        if ln.startswith(">"):
            cur.append(ln)
        elif not ln.strip() and cur:
            cur.append("")
        else:
            body = "\n".join(cur).strip()
            first = body.lstrip("> ")
            if body and not first.startswith(("**", "`")) and (
                    "?" in body or YIELD_REQUEST.search(body)):
                out.append(body)
            cur = []
    out += [m for m in re.findall(r"\"([^\"\n]*\?[^\"\n]*)\"", doc)]
    return out


def _selftest():
    fails = 0

    total = 0

    def t2(name, got, want):
        nonlocal fails, total
        total += 1
        ok = got == want
        print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"  (got {got}, want {want})"))
        if not ok:
            fails += 1

    def t(name, msg, answers, want_block, project=None, targets=None, prev=None):
        nonlocal fails, total
        total += 1
        r = evaluate(msg, answers, project, targets, prev)
        got = bool(r)
        ok = got == want_block
        print(("PASS  " if ok else "FAIL  ") + name +
              ("" if ok else f"  (got block={got}, want {want_block})"))
        if r and ok and want_block:
            print("        -> " + r.split(".")[0])
        if not ok:
            fails += 1

    # --- the two defects that actually shipped today -------------------------
    t("1.21.5 stall: statement-yield, entry-mode unspoken",
      "Wonderful — that's exactly what I'll build for you. From here on I'll call it Brightside Studio.",
      OWED, True)
    t("1.21.4 defect: prose after the question mark",
      "Got it. You want a program people use on their computer. Did I get that right?\n\n"
      "From here on I'll call it Brightside Studio, which is the name already on your notes.",
      OWED, True)

    # --- the shapes that MUST be allowed through ----------------------------
    t("correct: acknowledgement then the owed question, ends on ?",
      "Wonderful — that's exactly what I'll build for you. From here on I'll call it Brightside Studio.\n\n"
      "I can learn about your idea in one of two ways. Which would you rather do?",
      OWED, False)
    t("either/or in ONE paragraph is one question, not two",
      "Does it need to remember anything they did before? Or can it start fresh each time?",
      OWED, False)
    t("skill speaks in blockquotes -- markers stripped, still a question",
      "> I can learn about your idea in one of two ways.\n>\n> Which would you rather do?",
      OWED, False)
    t("mid-build status line, nothing unspoken -> not the interview, allowed",
      "Still working: 14 of 40 pieces done, 6 being checked, nothing waiting on you.",
      SETTLED, False)
    t("short closer after the question is not prose",
      "Which would you rather do? (I'll wait.)", SETTLED, False)

    # --- the remaining two checks -------------------------------------------
    t("two questions in separate paragraphs is a wall",
      "What would you like people to find on your website?\n\n"
      "And do you already own a web address?", SETTLED, True)
    t("question spoken but never written to ANSWERS.md",
      "What is the name of your business or project?", SETTLED, True)

    # --- E and F: the other two defects that shipped today ------------------
    t("1.21.1 defect: category word while the thing has a name",
      "Wonderful. From here on I'll call it your computer program.\n\nWhich would you rather do?",
      OWED, True, "Brightside Studio")
    t("the same line is fine when nothing supplies a name",
      "Wonderful. From here on I'll call it your computer program, until you give it a name.\n\n"
      "Which would you rather do?", OWED, False, None)
    t("using the real name is never blocked",
      "Wonderful. From here on I'll call it Brightside Studio.\n\nWhich would you rather do?",
      OWED, False, "Brightside Studio")
    t("1.21.4 defect: fork announced and self-resolved",
      "There are two different jobs hiding in your sentence. I'm going with the first one "
      "unless you say otherwise.", OWED, True, "Brightside Studio")
    t("the same fork, properly ASKED, is allowed",
      "There are two different jobs hiding in your sentence: PixelForge as the bar, or "
      "rebuilding from it. I'd pick the first. Which would you rather?",
      OWED, False, "Brightside Studio")
    t("auto-slug folder supplies no name",
      "I'll call it your website.\n\nWhich would you rather do?", OWED, False, None)

    # --- the three holes the adversarial agents found ------------------------
    TABLE = ("# ANSWERS\n\n| Key | Answer | Status |\n|---|---|---|\n"
             "| idea | \"a website\" | confirmed |\n| entry-mode | _blank_ | |\n")
    t2("table-shaped ledger is read (2026-09-08 runs)", _owed(TABLE) != [], True)
    t("table ledger: stall still caught",
      "Wonderful. From here on I'll call it Corner Post Framing.", TABLE, True, None)
    t("status line does not trip the stall guard on a stale line",
      "Still working: 14 of 40 pieces done, nothing waiting on you.", OWED, False)
    t2("scope: an unrelated folder is still never evaluated",
       bool(_answers_path("/tmp")), False)

    # --- G: the jargon lint that existed for weeks and never ran -------------
    dirty = _speech_check("I wrote it to /Users/x/CONTROL/state.json using claude-opus-5.", "/tmp")
    t2("jargon: paths and a model id are blocked", bool(dirty), True)
    for clean in ["I can learn about your idea in one of two ways. Which would you rather do?",
                  "Wonderful - from here on I will call it Brightside Studio.",
                  "What would you like people to find on your website?",
                  "Does it need to remember anything they did before? Or can it start fresh?",
                  "I need your Convert and Flow (GoHighLevel, GHL) Private Integration Token."]:
        t2("jargon: real interview wording passes -- %s..." % clean[:34],
           bool(_speech_check(clean, "/tmp")), False)

    # --- the nine defects reproduced against 1.21.x, each with its control ---

    # 1 -- a default taken in a LATER turn is the shape interview.md mandates.
    t("1 later-turn default is allowed",
      "You didn't say, so I'm going with the first one, recorded as a default.",
      SETTLED, False)
    t("1 control: the same-turn self-resolve still blocks",
      "Here are two options: PixelForge as the bar, or rebuilding from it. I'm going with "
      "the first one unless you say otherwise.", SETTLED, True)

    # 2 -- the turn boundary: a tool-only turn must not be judged on old prose.
    import tempfile
    dturn = tempfile.mkdtemp()

    def _transcript(name, *records):
        p = os.path.join(dturn, name)
        with open(p, "w") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        return p

    def _asst(*blocks):
        return {"type": "assistant", "message": {"role": "assistant", "content": list(blocks)}}

    _TXT = {"type": "text", "text": "PREVIOUS TURN statement."}
    _USE = {"type": "tool_use", "name": "Write", "input": {"file_path": "/x/y"}}
    leak = _transcript("leak.jsonl", _asst(_TXT),
                       {"type": "user", "message": {"role": "user", "content": "ok"}},
                       _asst(_USE))
    t2("2 tool-only turn does not leak the previous turn's prose",
       _last_client_message(leak), None)
    spoke = _transcript("spoke.jsonl", _asst(_TXT),
                        {"type": "user", "message": {"role": "user", "content": "ok"}},
                        _asst(_USE, {"type": "text", "text": "THIS TURN. Which would you rather do?"}))
    t2("2 control: this turn's own prose is still returned",
       _last_client_message(spoke), "THIS TURN. Which would you rather do?")
    carried = _transcript("carried.jsonl",
                          {"type": "user", "message": {"role": "user", "content": "ok"}},
                          _asst({"type": "text", "text": "THIS TURN spoke first."}),
                          _asst(_USE),
                          {"type": "user", "message": {"role": "user", "content":
                           [{"type": "tool_result", "content": "done"}]}})
    t2("2 control: a tool_result does not end the turn",
       _last_client_message(carried), "THIS TURN spoke first.")

    # 3 -- a fullwidth question mark is still a question mark.
    t("3 fullwidth ? ends the turn on a question", "What should I call it？", OWED, False)
    t("3 control: two fullwidth questions still hit the wall",
      "What would you like people to find on your website？\n\n"
      "And do you already own a web address？", SETTLED, True)

    # 4 -- a "?" inside a code fence is an example, not a second question.
    t("4 a fenced block is not a second question",
      "What is your business name?\n\n```\nAnd do you own a domain?\n```", OWED, False)
    t("4 control: two real paragraphs still hit the wall",
      "What is your business name?\n\n```\nsome notes\n```\n\nAnd do you own a domain?",
      OWED, True)

    # 5 -- the client's own words said back carry their own "?".
    t("5 a quoted client question is not a second question",
      "You said \"what if nobody can find it?\" -- got it.\n\nDo you own a domain?",
      OWED, False)
    t("5 control: the same second question unquoted still hits the wall",
      "You said what if nobody can find it? -- got it.\n\nDo you own a domain?",
      OWED, True)

    # 6 -- a folder named for the category supplies no name.
    t2("6 a category folder supplies no name", _project_name("/x/projects/Website"), None)
    t2("6 control: a real folder name still supplies a name",
       _project_name("/x/projects/Brightside Studio"), "Brightside Studio")
    t("6 the category line is allowed when the folder IS the category",
      "I'll call it your website.\n\nWhich would you rather do?",
      OWED, False, _project_name("/x/projects/Website"))

    # 7 -- the closer SKILL.md orders onto every either/or question.
    t("7 the mandated either/or closer still ends on the question",
      "Do you picture people using this on their phones, or on a computer? Not sure? "
      "That's okay. I'll choose what makes the most sense.", OWED, False)
    t("7 the mandated reassurance closer is allowed",
      "Do you already own a web address, something like yourbusiness.com? If you don't "
      "know, that's okay.", OWED, False)
    # #22 let a same-paragraph sentence belong to the question (a reassurance or
    # an example); G5 still blocks a NAMING or STATUS line tucked in there.
    t("7/G5 a naming line after the question in the same paragraph blocks",
      "Do you picture people using this on their phones, or on a computer? From here on "
      "I'll call it Brightside Studio.", OWED, True)
    t("7 control: a same-paragraph example after the question is allowed",
      "Do you already own a web address? Something like yourbusiness.com.", OWED, False)

    # 8 -- the interrupted question, dropped for a different one (10:34).
    t("8 a new question while a spoken one hangs must return to it",
      "Got it — you'd rather I use the notes you already wrote. Did I get that right?",
      INTERRUPTED, True)
    t("8 control a: re-asking the hanging question is silent", ENTRY_MODE_Q, INTERRUPTED, False)
    t("8 control b: no pending entries, H never fires",
      "I can learn about your idea in one of two ways. Which would you rather do?",
      SETTLED, False)
    t2("8 table ledger: the pending row is read",
       [k for k, _ in _pending(PENDING_TABLE)],
       ["Do you picture people using this on their phones, or on a computer?"])
    t("8 control c: a table ledger names the pending row",
      "Got it — you'd rather start fresh. Did I get that right?", PENDING_TABLE, True)
    t2("8 a recorded answer leaves nothing pending", [k for k, _ in _pending(OWED)], [])
    t2("8 a spoken-and-blank entry is pending",
       [k for k, _ in _pending(HANGING)], ["build-target (step 3)"])
    t("8 the next planned question while a spoken one is blank -> H blocks",
      "Wonderful — that's exactly what I'll build for you.\n\n"
      "I can learn about your idea in one of two ways. Which would you rather do?",
      HANGING, True)

    # J -- the 10:33 half: a question spoken last turn and never written down.
    t("J last turn's question was never recorded",
      "Then I didn't hear it right, and that's on me.\n\nGot it. You want a program people "
      "use directly on their computer. Did I get that right?",
      OWED, True, None, None, "I can learn about your idea in one of two ways. "
      "Which would you rather do?")
    t("J control a: the previous question IS on the ledger", "Did I get that right?",
      SETTLED, False, None, None,
      "I can learn about your idea in one of two ways. Which would you rather do?")
    t("J control b: no previous prose (first turn)",
      "I can learn about your idea in one of two ways. Which would you rather do?",
      OWED, False, None, None, None)
    t("J control c: the previous turn ended on a statement",
      "I can learn about your idea in one of two ways. Which would you rather do?",
      OWED, False, None, None, "From here on I'll call it Brightside Studio.")
    t("J control d: a table ledger carrying the question text",
      "Do you picture people using this on their phones, or on a computer?",
      PENDING_TABLE, False, None, None,
      "Do you picture people using this on their phones, or on a computer?")
    t2("J the previous turn's prose is reachable", _client_prose(spoke, 1), "PREVIOUS TURN statement.")

    # 9 -- the declared profile decides the surface (10:30).
    _CLAIM = "Got it. You want an app people can use on their phone. Did I get that right?"
    t("9 a phone claim against a desktop profile is blocked",
      _CLAIM, SETTLED, True, None, ["desktop-macos-arm64", "web"])
    t("9 control: no profile, check I never fires", _CLAIM, SETTLED, False, None, None)
    t("9 control: the profile agrees, silent", _CLAIM, SETTLED, False, None, ["ios-arm64"])
    t("9 control: the claim outside a confirm sentence is silent",
      "People can use it on their phones whenever they like.",
      SETTLED, False, None, ["desktop-macos-arm64"])
    t2("9 an unrecognised target decides nothing", _target_family("frobnicator"), None)

    # --- safety -------------------------------------------------------------
    t("empty message is never blocked", "", OWED, False)
    t("no ledger content is never blocked", "Anything at all.", "", False)

    # --- the scope escape that caught its own author -------------------------
    import tempfile
    d2 = tempfile.mkdtemp()
    op = os.path.join(d2, "operator.jsonl")
    with open(op, "w") as fh:
        fh.write(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "text", "text": "I repaired the deadlock in scripts/state.mjs."}]}}) + "\n")
    t2("operator session standing in a project folder is NOT policed",
       _is_spec_protocol_run(op), False)
    run = os.path.join(d2, "run.jsonl")
    with open(run, "w") as fh:
        fh.write(json.dumps({"type": "user", "message": {"role": "user", "content":
                 "Base directory for this skill: /x/skills/spec-protocol"}}) + "\n")
    t2("a session that actually invoked the skill IS policed",
       _is_spec_protocol_run(run), True)
    t2("a missing transcript is not a run", _is_spec_protocol_run("/nope.jsonl"), False)
    quoted = os.path.join(d2, "quoted.jsonl")
    with open(quoted, "w") as fh:
        fh.write(json.dumps({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "content": "<command-name>/spec-protocol</command-name>"}]}}) + "\n")
        fh.write(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "input": {"command": "grep 'Base directory for this skill: x/spec-protocol'"}}]}}) + "\n")
    t2("a session that merely QUOTES the marker in tool traffic is NOT a run",
       _is_spec_protocol_run(quoted), False)

    # --- scope gate ---------------------------------------------------------
    import tempfile
    d = tempfile.mkdtemp()
    t2("scope gate: a folder with no 00-INPUT/ANSWERS.md is never evaluated",
       _answers_path(d), None)
    t2("scope gate: a missing cwd is survived", _answers_path("/nonexistent-dir-xyz"), None)

    # --- v1.24.0 fixes: one case each ---------------------------------------
    import subprocess
    d3 = tempfile.mkdtemp()
    cfg = os.path.join(d3, "cfg")
    INV = {"type": "user", "message": {"role": "user",
           "content": "<command-name>/spec-protocol</command-name>"}}

    def _say(text):
        return _asst({"type": "text", "text": text})

    def _bash(cmd):
        return _asst({"type": "tool_use", "name": "Bash", "input": {"command": cmd}})

    def _run(name, *records):
        """Drive the real main() in a child process; return what it printed."""
        tp = _transcript(name, *records)
        payload = {"session_id": name, "transcript_path": tp, "cwd": d3}
        env = dict(os.environ, CLAUDE_CONFIG_DIR=cfg)
        r = subprocess.run([sys.executable, os.path.abspath(__file__)], input=json.dumps(payload),
                           capture_output=True, text=True, timeout=30, env=env)
        return r.stdout

    # 4 -- the project comes ONLY from this session's `answers.sh <project> init`.
    proj = os.path.join(d3, "Corner Post")
    decoy = os.path.join(d3, "decoy")
    for p in (proj, decoy):
        os.makedirs(os.path.join(p, "00-INPUT"))
        open(os.path.join(p, ANSWERS_REL), "w").write(OWED)
    with_call = _transcript("p4a.jsonl", INV, _bash('bash tools/answers.sh "%s" init' % proj))
    without = _transcript("p4b.jsonl", INV, _say("Hi, I'm Candace."))
    t2("#4 project = this session's init call; a ledger beside cwd is ignored",
       (_project_from_events(_events(with_call), decoy), _project_from_events(_events(without), decoy)),
       (proj, None))

    # 17 -- the jargon lint runs on a run's turn even before any project exists.
    t2("#17 speech-check blocks a client turn (no project yet)",
       "CLIENT-FACING JARGON" in _run("p17", INV, _say("Hi, I'm Candace. I saved it to /Users/x/CONTROL/state.json.")),
       True)

    # 20 -- 3 blocks per session-turn, then stand down; a new turn resets.
    saved = os.environ.get("CLAUDE_CONFIG_DIR")
    os.environ["CLAUDE_CONFIG_DIR"] = cfg
    try:
        spent = [_spend_block({"session_id": "s20"}, 7) for _ in range(4)] + \
                [_spend_block({"session_id": "s20"}, 9)]
    finally:
        if saved is None:
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
        else:
            os.environ["CLAUDE_CONFIG_DIR"] = saved
    t2("#20 block counter: 3 per turn, then stands down, resets next turn",
       spent, [True, True, True, False, True])

    # 21 -- A stands down while H has a pending entry (HANGING: one spoken and
    # blank, one unspoken). Before the fix A demanded the unspoken one.
    t("#21 statement-yield with a pending entry: A stands down",
      "Wonderful — that's exactly what I'll build for you.", HANGING, False)

    # 22 -- every mandated wording in SKILL.md / interview.md passes both
    # placeholder ledger shapes. Skipped (not failed) where the docs are not
    # beside the hook, i.e. an installed copy under <config>/hooks/.
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    docs = [os.path.join(root, "SKILL.md"), os.path.join(root, "references", "interview.md")]
    if all(os.path.isfile(p) for p in docs):
        scripts = [s for p in docs for s in _quoted_scripts(open(p, encoding="utf-8").read())]
        tripped = [s[:50] for s in scripts for led in (PLACEHOLDER_KV, PLACEHOLDER_TABLE)
                   if evaluate(s, led)]
        t2("#22 %d mandated wordings pass both ledger shapes" % len(scripts),
           (len(scripts) >= 10, tripped), (True, []))
    else:
        print("SKIP  #22 mandated wordings (SKILL.md not beside this hook)")

    # 23 -- init ran in this session but the ledger file is missing.
    gone = os.path.join(d3, "Never Made")
    t2("#23 ANSWERS.md missing after this session's init call blocks",
       "ANSWERS.MD IS MISSING" in _run("p23", INV, _bash("bash tools/answers.sh '%s' init" % gone),
                                        _say("Hi, I'm Candace. I'm going to help.")), True)

    # 24 -- the counter must rise by exactly one.
    prior = ["Question 3 of no more than 15 — What do you sell?"]
    t2("#24 counter: a jump blocks, the next number passes",
       (bool(_counter_problem("Question 5 of no more than 15 — How do people reach you?", prior)),
        _counter_problem("Question 4 of no more than 15 — How do people reach you?", prior)),
       (True, None))

    # 25 -- turn 1 must open with the greeting line.
    t2("#25 turn 1: an update offer blocks, the greeting passes",
       ("TURN 1 IS NOT THE OPENING" in _run("p25a", INV, _say(
           "I have an update for my own tools. Take it now?")),
        _run("p25b", INV, _say("> Hi, I'm Candace. I'm going to help turn your idea into "
                               "something real.\n\n> First question: what do you want to create?"))),
       (True, ""))

    # --- round 3 (G1-G7): one case each, with its control --------------------
    def _result(text):
        return {"type": "user", "message": {"role": "user", "content":
                [{"type": "tool_result", "content": text}]}}
    USER = {"type": "user", "message": {"role": "user", "content": "a booking site for my bakery"}}
    OPEN = "Hi, I'm Candace. First question: what do you want to create?"

    # G1 -- turn 2, no project yet: the HELD ledger catches the 1.21.5 stall, and
    # with no ledger at all the message-shape checks still run.
    held = os.path.join(cfg, "spec-protocol", "runs", "r1", "00-INPUT", "ANSWERS.md")
    os.makedirs(os.path.dirname(held))
    open(held, "w").write('# Answers\n\n## idea\n**Asked:** "%s"\n**Answer:** "a booking site"\n\n'
                          '## entry-mode\n**Asked:** _not yet spoken_\n**Answer:** _blank_\n' % OPEN)
    stall = "Wonderful. From here on I'll call it Brightside Studio."
    t2("G1 held ledger: the 1.21.5 stall is caught on turn 2 (control: re-asked properly passes)",
       ("TURN ENDED ON A STATEMENT" in _run("g1a", INV, _say(OPEN),
                                            _bash("bash tools/answers.sh init --hold r1 --planned entry-mode"),
                                            _result("ANSWERS | init | " + held), USER, _say(stall)),
        _run("g1b", INV, _say(OPEN), _bash("bash tools/answers.sh init --hold r1"),
             _result("ANSWERS | init | " + held), USER,
             _say(stall + "\n\nI can learn about your idea in one of two ways. Which would you rather do?"))),
       (True, ""))
    t2("G1 no ledger at all: prose after the question still blocks",
       "NEW PARAGRAPH AFTER THE QUESTION" in _run(
           "g1c", INV, _say(OPEN), USER,
           _say("You want a booking site. Did I get that right?\n\nFrom here on I'll call it Brightside Studio.")),
       True)

    # G2 -- the project comes from answers.sh's RESULT line, so "$P" resolves.
    g2a = _transcript("g2a.jsonl", INV, _bash('bash tools/answers.sh "$P" init'),
                      _result("ANSWERS | init | %s/00-INPUT/ANSWERS.md" % proj))
    g2b = _transcript("g2b.jsonl", INV, _bash("cd x && bash tools/answers.sh . init"))
    t2("G2 result line resolves \"$P\"; a relative command alone resolves nothing",
       (_project_from_events(_events(g2a)), _project_from_events(_events(g2b))), (proj, None))

    # G3 -- stated and skipped keys are never owed and never hanging.
    STATED = ("# Answers\n\n## idea\n**Asked:** _stated — read back from the client's documents_\n"
              "**Answer:** \"a booking site\"\n\n## budget\n**Asked:** _skipped — does not apply_\n"
              "**Answer:** _skipped_\n")
    t2("G3 stated/skip are not owed or pending (control: a placeholder is owed)",
       (_owed(STATED), _pending(STATED), _owed(PLACEHOLDER_KV) != []), ([], [], True))

    # G4 -- a lowering WITH the sentence passes; unannounced lowering, a raise,
    # and an unnumbered question mid-count block; after the last one, nothing.
    q3 = ["Question 3 of no more than 15 — What do you sell?"]
    t2("G4 counter: announced lowering ok; silent lowering, raise, missing number block",
       (_counter_problem("Good news — it will be at most 12 now, because you told me already.\n\n"
                         "Question 4 of no more than 12 — How do people reach you?", q3),
        bool(_counter_problem("Question 4 of no more than 12 — How do people reach you?", q3)),
        bool(_counter_problem("Question 4 of no more than 16 — How do people reach you?", q3)),
        bool(_counter_problem("How do people reach you?", q3)),
        _counter_problem("Anything else?", ["Question 15 of no more than 15 — Last one?"])),
       (None, True, True, True, None))

    # G5 -- three "?" in one paragraph block; either/or plus the mandated closer passes.
    t("G5 three questions in one paragraph blocks",
      "What do you sell? Who buys it? Where do they find you?", SETTLED, True)
    t("G5 control: either/or plus the mandated closer is fine",
      "Does it need to remember things? Or can it start fresh? Not sure? That's okay. "
      "I'll choose what makes the most sense.", OWED, False)

    # G6 -- "your app" / "your platform" is a category word when a name exists.
    t("G6 'call it your app' with a real name blocks",
      "From here on I'll call it your app.\n\nWhich would you rather do?", OWED, True, "Brightside Studio")
    t("G6 control: 'your apple' is not the category word",
      "From here on I'll call it your apple stand.\n\nWhich would you rather do?", OWED, False, "Brightside Studio")

    # G7 -- a mid-turn Skill load is the harness, not the client: no boundary.
    load = {"type": "user", "isMeta": True, "sourceToolUseID": "call_1", "message": {"role": "user",
            "content": [{"type": "text", "text": "Base directory for this skill: /x/skills/eli5"}]}}
    t2("G7 a mid-turn skill load does not end the turn (control: a real user message does)",
       (_last_client_message(_transcript("g7a.jsonl", USER, _asst({"type": "text", "text": "THIS TURN."}),
                                         load, _asst(_USE))),
        _last_client_message(_transcript("g7b.jsonl", _asst({"type": "text", "text": "THIS TURN."}),
                                         USER, _asst(_USE)))),
       ("THIS TURN.", None))

    # --- round 4 (D1-D5): one case each, with its control --------------------
    # D1 -- held ledger: the recorded idea answer is the name check E uses.
    held2 = os.path.join(cfg, "spec-protocol", "runs", "r4", "00-INPUT", "ANSWERS.md")
    os.makedirs(os.path.dirname(held2))
    open(held2, "w").write('# Answers\n\n## idea\n**Asked:** "%s"\n**Answer:** "a booking page for '
                           'Brightside Studio"\n\n## entry-mode\n**Asked:** _not yet spoken_\n'
                           '**Answer:** _blank_\n' % OPEN)
    t2("D1 held run: 'your website' blocks against the idea answer (control: bare category)",
       ("CATEGORY WORD" in _run("d1", INV, _say(OPEN), _bash("bash tools/answers.sh init --hold r4"),
                                _result("ANSWERS | init | " + held2), USER,
                                _say("Wonderful. From here on I'll call it your website, until you give "
                                     "it a name.\n\nI can learn about your idea in one of two ways. "
                                     "Which would you rather do?")),
        _ledger_name('## idea\n**Asked:** "x"\n**Answer:** "a website"\n')),
       (True, None))

    # D2 -- a mid-turn load of this skill is a run only with gate0 --open / answers init.
    mload = {"type": "user", "sourceToolUseID": "call_2", "message": {"role": "user",
             "content": [{"type": "text", "text": "Base directory for this skill: /x/skills/spec-protocol"}]}}
    t2("D2 operator mid-turn load is silent (control: with gate0.sh --open it is a run)",
       (_is_spec_protocol_run(_transcript("d2a.jsonl", USER, mload, _say("Read it."))),
        _is_spec_protocol_run(_transcript("d2b.jsonl", USER, mload,
                                          _bash('bash tools/gate0.sh --open "$HOLD"')))),
       (False, True))

    # D3 -- after the walk-away, an unnumbered question is no counter defect.
    q15 = _say("Question 3 of no more than 15 — What do you sell?")
    ask = _say("Your AI account is running low. Want me to keep going?")
    t2("D3 counting stops after watch-tick --record-session (control: before it, it blocks)",
       ("COUNTED QUESTION WITHOUT" in _run("d3a", INV, q15, USER, ask),
        _run("d3b", INV, q15, _bash("bash tools/watch-tick.sh --record-session /p"), USER, ask)),
       (True, ""))

    # D5 -- C may rise once, right after the mode question; any other raise blocks.
    modeq = "Question 1 of no more than 12 — Should I handle most of it for you, or would you like to choose?"
    t2("D5 raise allowed once after the mode question (controls: elsewhere, or twice, blocks)",
       (_counter_problem("Question 2 of no more than 17 — What do you sell?", [modeq]),
        bool(_counter_problem("Question 4 of no more than 17 — x?", q3)),
        bool(_counter_problem("Question 3 of no more than 19 — x?",
                              [modeq, "Question 2 of no more than 17 — What do you sell?"]))),
       (None, True, True))

    if fails:
        print(f"conversation-gate.py selftest: {fails} FAILED")
        sys.exit(2)
    print("conversation-gate.py selftest: ALL PASS (%d checks)" % total)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    try:
        main()
    except Exception:
        pass    # a broken gate must never wedge a session
