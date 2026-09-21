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


SPEECH_CANDIDATES = [
    os.path.expanduser("~/.claude-nine/skills/spec-protocol/tools/speech-check.sh"),
    os.path.expanduser("~/.claude/skills/spec-protocol/tools/speech-check.sh"),
    os.path.join(os.path.dirname(__file__), "..", "speech-check.sh"),
]


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
        try:
            r = subprocess.run([shutil.which("bash") or "/bin/bash", path, "-", "--home", home],
                               input=message, capture_output=True, text=True, timeout=15)
        except Exception:
            return None                      # could not run it: prove nothing
        if r.returncode != 3:
            return None
        head = (r.stdout or "").splitlines()
        verdict = head[0] if head else "SPEECH-CHECK | verdict=REJECT"
        hits = [ln.strip() for ln in head[1:8] if ln.strip()]
        return ("CLIENT-FACING JARGON. This message carries wording a non-technical "
                "client cannot act on.\n\n%s\n%s\n\nSay what the thing DOES instead of "
                "naming it (references/audience.md §2). File paths, workflow ids, law "
                "numbers, model names and dollar figures never reach the client; machine "
                "detail goes to the session log." % (verdict, "\n".join(hits)))
    return None


def _answers_path(cwd):
    """The run's own ledger, or None. This is the whole scope gate.

    A direct cwd join is not enough: on the UNPROFILED path the skill creates
    ~/Downloads/projects/<slug>/ and the session may sit in a parent or a
    sibling, so a cwd-only check silently no-ops on exactly the runs that most
    need watching. Look at cwd, up to three ancestors, and one level down --
    bounded, so this can never wander the disk.
    """
    if not cwd or not os.path.isdir(cwd):
        return None
    here = os.path.abspath(cwd)
    for _ in range(4):
        p = os.path.join(here, ANSWERS_REL)
        if os.path.isfile(p):
            return p
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    try:
        for entry in sorted(os.listdir(cwd)):
            p = os.path.join(cwd, entry, ANSWERS_REL)
            if os.path.isfile(p):
                return p
    except Exception:
        pass
    return None


SKILL_INVOKED = re.compile(
    r"Base directory for this skill:\s*\S*spec-protocol|<command-name>/?spec-protocol",
    re.I)


def _is_spec_protocol_run(transcript_path):
    """Is THIS SESSION a spec-protocol client conversation?

    A ledger under cwd is not enough. An operator session that merely `cd`s into
    a project folder to repair it inherits that folder's `00-INPUT/ANSWERS.md`
    and gets policed as though it were talking to a client -- which is exactly
    what happened to the session that wrote this hook, mid-repair. The run must
    also have actually INVOKED the skill: the harness writes the skill's base
    directory into the transcript when it does, and nothing else produces that
    line. Discussing spec-protocol, editing it, or standing in its folder does
    not.
    """
    # Only the harness's own injection counts: a `user` record whose content is
    # a plain string or a `text` block. A `tool_result` or `tool_use` block that
    # QUOTES the marker (an operator reading a run's transcript, or SKILL.md)
    # is not an invocation -- that is precisely how this hook caught its author.
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
            c = (d.get("message") or {}).get("content")
            if isinstance(c, list) and all(
                    isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
                continue            # a tool RESULT is not the user speaking
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
    r"computer program|website|selling pages|mobile app|web app|desktop software|funnel)",
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
MANDATED_TAILS = re.compile(
    r"\s*(?:"
    r"Not sure\?\s*That['’]?s okay\.\s*I['’]?ll choose what makes the most sense\."
    r"|If you don['’]?t know,?\s*that['’]?s okay\."
    r")\s*$", re.I)
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
        return ("CATEGORY WORD INSTEAD OF THE NAME. You said \"call it your %s\" while this "
                "thing is called \"%s\". Reading everything and then using a bucket label "
                "reads exactly like having read nothing. Call it by its name; the category "
                "word is only for a project that genuinely has no name."
                % (m.group(1), project_name))

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

    if ends_q:
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
        if answers_text and not pending and not _recorded(clean, answers_text):
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
    if owed and not STATUS_SHAPE.match(clean):
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
        return                       # no ledger anywhere near: never evaluated
    if not _is_spec_protocol_run(payload.get("transcript_path", "")):
        return                       # an operator session standing in the folder
    message = _last_client_message(payload.get("transcript_path", ""))
    if not message:
        return
    try:
        with open(answers, encoding="utf-8", errors="replace") as fh:
            answers_text = fh.read()
    except Exception:
        return
    cwd = payload.get("cwd") or os.getcwd()
    targets = None
    try:
        # The profile sits beside 00-INPUT/, never beside the session's cwd.
        with open(os.path.join(os.path.dirname(os.path.dirname(answers)),
                               ".spec-protocol.json"), encoding="utf-8") as fh:
            declared = (json.load(fh) or {}).get("targets")
        if isinstance(declared, list) and declared:
            targets = declared
    except Exception:
        targets = None            # no profile, or unreadable: check I stands down
    reason = evaluate(message, answers_text, _project_name(cwd), targets,
                      _client_prose(payload.get("transcript_path", ""), 1))
    if not reason:
        reason = _speech_check(_strip_quote_markers(message), cwd)
    if reason:
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
                 "| What is your business name? | Studio Nerds |\n"
                 "| Do you picture people using this on their phones, or on a computer? "
                 "| _blank_ |\n")


def _selftest():
    fails = 0

    def t2(name, got, want):
        nonlocal fails
        ok = got == want
        print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"  (got {got}, want {want})"))
        if not ok:
            fails += 1

    def t(name, msg, answers, want_block, project=None, targets=None, prev=None):
        nonlocal fails
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

    # --- the three holes the adversarial agents found ------------------------
    TABLE = ("# ANSWERS\n\n| Key | Answer | Status |\n|---|---|---|\n"
             "| idea | \"a website\" | confirmed |\n| entry-mode | _blank_ | |\n")
    t2("table-shaped ledger is read (2026-09-08 runs)", _owed(TABLE) != [], True)
    t("table ledger: stall still caught",
      "Wonderful. From here on I'll call it Corner Post Framing.", TABLE, True, None)
    t("status line does not trip the stall guard on a stale line",
      "Still working: 14 of 40 pieces done, nothing waiting on you.", OWED, False)
    t2("scope: cwd itself", bool(_answers_path(
        "/Users/blackceomacmini/Downloads/Studio Nerds Program")), True)
    t2("scope: one level DOWN from a parent", bool(_answers_path(
        "/Users/blackceomacmini/Downloads/projects")), True)
    t2("scope: an unrelated folder is still never evaluated",
       bool(_answers_path("/tmp")), False)

    # --- G: the jargon lint that existed for weeks and never ran -------------
    dirty = _speech_check("I wrote it to /Users/x/CONTROL/state.json using claude-opus-5.", "/tmp")
    t2("jargon: paths and a model id are blocked", bool(dirty), True)
    for clean in ["I can learn about your idea in one of two ways. Which would you rather do?",
                  "Wonderful - from here on I will call it Studio Nerds.",
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
      "Here are two options: Higgsfield as the bar, or rebuilding from it. I'm going with "
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
       _project_name("/x/projects/Studio Nerds"), "Studio Nerds")
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
    t("7 control: any other trailing sentence still blocks",
      "Do you picture people using this on their phones, or on a computer? From here on "
      "I'll call it Studio Nerds.", OWED, True)

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
      OWED, False, None, None, "From here on I'll call it Studio Nerds.")
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
    print("conversation-gate.py selftest: ALL PASS (71 checks)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    try:
        main()
    except Exception:
        pass    # a broken gate must never wedge a session
