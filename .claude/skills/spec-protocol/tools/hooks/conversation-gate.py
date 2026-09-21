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

SCOPE -- and why this cannot fire on an ordinary session. Every check is gated
on `00-INPUT/ANSWERS.md` existing beneath the session's working directory. That
file exists only inside a real spec-protocol project folder. A session merely
DISCUSSING spec-protocol -- including the one that wrote this hook -- has no such
file and is never evaluated.

CONTRACT (identical to gate0-claim-gate.py, which is proven in service)
  - reads the hook payload on stdin, ALWAYS exits 0
  - blocks ONLY by printing {"decision":"block","reason":...} to stdout
  - honours stop_hook_active, so a block can never re-trigger on itself
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


def _answers_path(cwd):
    """The run's own ledger, or None. This is the whole scope gate."""
    if not cwd or not os.path.isdir(cwd):
        return None
    p = os.path.join(cwd, ANSWERS_REL)
    return p if os.path.isfile(p) else None


def _last_client_message(transcript_path):
    """The final assistant prose of this turn -- what the client actually read."""
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except Exception:
        return None
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("isSidechain") or d.get("type") != "assistant":
            continue
        content = (d.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        text = "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text").strip()
        if text:
            return text
    return None


def _strip_quote_markers(text):
    """The skill speaks in markdown blockquotes; the client sees the words."""
    return "\n".join(re.sub(r"^\s*>\s?", "", ln) for ln in text.splitlines()).strip()


def _ends_on_question(text):
    tail = text.rsplit("?", 1)
    if len(tail) < 2:
        return False, None
    after = tail[1]
    return bool(TRAILING_NOISE.match(after)), after


def _owed(answers_text):
    """Question keys the RUN still owes -- asked-side blank, not client-side."""
    out = []
    for block in re.split(r"\n(?=## )", answers_text):
        if UNSPOKEN.search(block):
            head = block.splitlines()[0].strip()
            out.append(head.lstrip("# ").strip())
    return out


def _two_paragraph_questions(text):
    paras = [p for p in re.split(r"\n\s*\n", text) if "?" in p]
    return len(paras) >= 2


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
    r"computer program|website|selling pages|mobile app|web app|desktop software|funnel)",
    re.I)
AUTO_SLUG = re.compile(r"^[a-z]+(-[a-z]+)*-\d{4}-\d{2}-\d{2}$")
SELF_RESOLVED_FORK = re.compile(
    r"(unless you (say|tell me) otherwise|I'?m going with the|I'?ll go with the|"
    r"going with (the )?(first|second|option))", re.I)
GENERIC_DIRS = {"projects", "downloads", "documents", "desktop", "tmp", "src", "work"}


def _project_name(cwd):
    """A real name for the thing, from the folder the run lives in."""
    base = os.path.basename(os.path.normpath(cwd or ""))
    if not base or base.lower() in GENERIC_DIRS or AUTO_SLUG.match(base):
        return None
    trimmed = re.sub(r"\s+(Program|Project|Folder|App)$", "", base).strip()
    return trimmed or None


def evaluate(message, answers_text, project_name=None):
    """Return a block reason, or None. Pure -- this is what the selftest drives."""
    clean = _strip_quote_markers(message)
    if not clean:
        return None
    ends_q, after = _ends_on_question(clean)
    owed = _owed(answers_text)

    # E -- the 1.21.1 defect: a category label where a real name exists.
    m = CATEGORY_NAMING.search(clean)
    if m and project_name:
        return ("CATEGORY WORD INSTEAD OF THE NAME. You said \"call it your %s\" while this "
                "thing is called \"%s\". Reading everything and then using a bucket label "
                "reads exactly like having read nothing. Call it by its name; the category "
                "word is only for a project that genuinely has no name."
                % (m.group(1), project_name))

    # F -- the 1.21.4 defect: a fork announced and decided in the same breath.
    if not ends_q and SELF_RESOLVED_FORK.search(clean):
        return ("FORK SELF-RESOLVED. You have announced a choice the client never got to "
                "make and ended the turn on it. A genuine fork is ASKED: two plain options, "
                "one sentence saying which you would pick and why, then the question -- and "
                "the message ends there. The default may only be taken in a LATER turn, "
                "after the question has gone unanswered, and is recorded as a DEFAULT.")

    if ends_q:
        if _two_paragraph_questions(clean):
            return ("TWO QUESTIONS IN ONE MESSAGE. Question marks appear in two separate "
                    "paragraphs. One question at a time (audience.md §1): ask the first, let "
                    "the client answer, then ask the next. An either/or inside a single "
                    "paragraph is one question and is fine; these are two.")
        pending = re.search(r"\*\*Answer:\*\*\s*_?(blank|not yet)", answers_text, re.I)
        if answers_text and not pending and not _recorded(clean, answers_text):
            return ("QUESTION SPOKEN BUT NOT RECORDED. You asked the client something and "
                    "00-INPUT/ANSWERS.md shows nothing awaiting an answer, so this question "
                    "exists only in the conversation. Write it there under **Asked:** with a "
                    "blank answer BEFORE yielding -- an interruption will otherwise lose it "
                    "and it will never come back.")
        return None

    # Did not end on a question.
    if after is not None and len(after.strip()) > PROSE_AFTER_Q_CHARS:
        return ("PROSE AFTER THE QUESTION MARK. %d characters follow your last question, "
                "so it reads as a remark the client scrolls past rather than something to "
                "answer. The question is the LAST thing in the message and the message ends "
                "there. Move what follows it to before it, or to the next turn."
                % len(after.strip()))
    if owed:
        return ("TURN ENDED ON A STATEMENT WHILE A QUESTION IS OWED: %s. "
                "A client-facing turn ends ON a question. You have handed the client a "
                "statement and stopped, so they have nothing to answer and the run waits "
                "for a reply to nothing. Ask the owed question now -- an acknowledgement "
                "may open the message, the question closes it." % ", ".join(owed))
    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    if not isinstance(payload, dict) or payload.get("stop_hook_active"):
        return
    answers = _answers_path(payload.get("cwd") or os.getcwd())
    if not answers:
        return                       # not a spec-protocol run; never evaluated
    message = _last_client_message(payload.get("transcript_path", ""))
    if not message:
        return
    try:
        with open(answers, encoding="utf-8", errors="replace") as fh:
            answers_text = fh.read()
    except Exception:
        return
    reason = evaluate(message, answers_text,
                      _project_name(payload.get("cwd") or os.getcwd()))
    if reason:
        print(json.dumps({"decision": "block", "reason": reason}))


# ---------------------------------------------------------------------------
# The selftest -- every fixture is a real message from a real run
# ---------------------------------------------------------------------------
OWED = """# Answers
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


def _selftest():
    fails = 0

    def t(name, msg, answers, want_block, project=None):
        nonlocal fails
        r = evaluate(msg, answers, project)
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
      "Wonderful — that's exactly what I'll build for you. From here on I'll call it Studio Nerds.",
      OWED, True)
    t("1.21.4 defect: prose after the question mark",
      "Got it. You want a program people use on their computer. Did I get that right?\n\n"
      "From here on I'll call it Studio Nerds, which is the name already on your notes.",
      OWED, True)

    # --- the shapes that MUST be allowed through ----------------------------
    t("correct: acknowledgement then the owed question, ends on ?",
      "Wonderful — that's exactly what I'll build for you. From here on I'll call it Studio Nerds.\n\n"
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
      OWED, True, "Studio Nerds")
    t("the same line is fine when nothing supplies a name",
      "Wonderful. From here on I'll call it your computer program, until you give it a name.\n\n"
      "Which would you rather do?", OWED, False, None)
    t("using the real name is never blocked",
      "Wonderful. From here on I'll call it Studio Nerds.\n\nWhich would you rather do?",
      OWED, False, "Studio Nerds")
    t("1.21.4 defect: fork announced and self-resolved",
      "There are two different jobs hiding in your sentence. I'm going with the first one "
      "unless you say otherwise.", OWED, True, "Studio Nerds")
    t("the same fork, properly ASKED, is allowed",
      "There are two different jobs hiding in your sentence: Higgsfield as the bar, or "
      "rebuilding from it. I'd pick the first. Which would you rather?",
      OWED, False, "Studio Nerds")
    t("auto-slug folder supplies no name",
      "I'll call it your website.\n\nWhich would you rather do?", OWED, False, None)

    # --- safety -------------------------------------------------------------
    t("empty message is never blocked", "", OWED, False)
    t("no ledger content is never blocked", "Anything at all.", "", False)

    # --- scope gate ---------------------------------------------------------
    import tempfile
    d = tempfile.mkdtemp()
    ok = _answers_path(d) is None
    print(("PASS  " if ok else "FAIL  ") + "scope gate: a folder with no 00-INPUT/ANSWERS.md is never evaluated")
    if not ok:
        fails += 1
    ok = _answers_path("/nonexistent-dir-xyz") is None
    print(("PASS  " if ok else "FAIL  ") + "scope gate: a missing cwd is survived")
    if not ok:
        fails += 1

    if fails:
        print(f"conversation-gate.py selftest: {fails} FAILED")
        sys.exit(2)
    print("conversation-gate.py selftest: ALL PASS (19 checks)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    try:
        main()
    except Exception:
        pass    # a broken gate must never wedge a session
