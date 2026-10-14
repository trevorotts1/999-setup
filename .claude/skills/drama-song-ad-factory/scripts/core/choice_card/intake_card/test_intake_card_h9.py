#!/usr/bin/env python3
"""H9 tests: the intake card keeps one question per block, one option per line,
a blank line between questions, and the send payloads keep those newlines.

The companion contract (SPEC item 10, both halves kept side by side) lives
here too: the card is the only source of its own total, so the module count,
the rendered count and every help string and docstring the CLIs print must all
say the same number, and that number is 14 today -- and no help text or
docstring anywhere in the shipped card files may state a different total, so a
box can never re-diverge onto a stale count.

Run: python3 core/choice_card/intake_card/test_intake_card_h9.py
"""
import ast
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, CORE)
from choice_card.intake_card import intake_card as IC  # noqa: E402

N = len(IC.QUESTIONS)
CARD = IC.render_card()

#: Every count word the regex below accepts, as a number (one source of truth).
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
}
#: A stated TOTAL of questions: "nine questions", "14 questions". Plural on
#: purpose — "one question at a time" is a format note, not a count of the card.
COUNT_CLAIM = re.compile(r"\b(\d+|" + "|".join(NUMBER_WORDS) + r") questions\b")

#: The only help/docstring text that may state the card's total. The CHANGELOG
#: is history and stays as written; comments (#) document sub-counts, so a line
#: comment is dropped before matching.
COUNT_SOURCES = [
    os.path.join(HERE, "__init__.py"),
    os.path.join(HERE, "intake_card.py"),
    os.path.join(CORE, "intake_preflight", "factory.py"),
]

#: ---- AST half (kept alongside the line-based half above) ----
#: The text a human reads as the card's total: every help/description literal
#: and every module docstring in the files that ship the card.
_AST_SOURCES = (os.path.join(HERE, "__init__.py"),
                os.path.join(HERE, "intake_card.py"),
                os.path.join(CORE, "intake_preflight", "factory.py"))

_AST_NUMWORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
                 "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
                 "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
                 "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
                 "twenty": 20}

#: A total-count claim: a count on the word "questions" (plural only, so "ONE
#: question as its own message" is not one), on the saved-character wording, or
#: in a rendered "Question 1 of N" header.
_AST_CLAIM = re.compile(r"Question 1 of (\d+)\b"
                        r"|\b(\d+|[a-z]+)\s+questions\b"
                        r"|\b(\d+|[a-z]+)\s+with a saved character\b", re.I)


def _AST_as_count(token):
    return int(token) if token.isdigit() else _AST_NUMWORDS.get(token.lower())


def _AST_claims(text):
    """(phrase, count) for every total-count claim in `text`. A word that is
    not a number ("story-brief questions") names a kind, not a total: skipped."""
    out = []
    for m in _AST_CLAIM.finditer(text):
        count = _AST_as_count(m.group(1) or m.group(2) or m.group(3))
        if count is not None:
            out.append((m.group(0), count))
    return out


def _AST_readable_strings(path):
    """The help/description literals and the module docstring of `path` --
    the strings a human actually reads. Comments and code are not scanned."""
    tree = ast.parse(open(path, encoding="utf-8").read())
    where = os.path.basename(path)
    out = []
    doc = ast.get_docstring(tree)
    if doc:
        out.append((where + " docstring", doc))
    for node in ast.walk(tree):
        if isinstance(node, ast.keyword) and node.arg in ("help", "description"):
            for s in ast.walk(node.value):
                if isinstance(s, ast.Constant) and isinstance(s.value, str):
                    out.append(("%s:%d" % (where, node.lineno), s.value))
    return out


def _blocks(text):
    return text.split("\n\n")


def test_fourteen_questions_each_own_block():
    assert N == 14                                  # five story brief + nine production choices
    blocks = _blocks(CARD)
    assert len(blocks) == N + 1                       # fourteen questions + closing
    for i, b in enumerate(blocks[:N], 1):
        first = b.split("\n")[0]
        assert first.startswith("Question %d of %d - " % (i, N)), first
    labels = [b.split("\n")[0].split(" - ")[1] for b in blocks[:N]]
    assert labels == ["OFFER", "OFFER LINK", "AUDIENCE", "CHARACTER", "PHOTOS",
                      "AI MODELS", "LENGTH", "MUSIC STYLE", "VIDEO STYLE", "VIDEO MODEL",
                      "BUDGET", "STORYBOARD APPROVAL", "SONG APPROVAL", "SCRIPT APPROVAL"]


def test_module_count_equals_rendered_count():
    """One total, read from the module, printed by the card -- never a second
    number. A hardcoded count anywhere in this chain breaks one of these."""
    headers = re.findall(r"^Question (\d+) of (\d+) - ", CARD, re.M)
    assert [int(i) for i, _ in headers] == list(range(1, N + 1))
    assert {int(t) for _, t in headers} == {N}            # one total, the live one
    assert len(headers) == len(IC.QUESTIONS) == IC.CARD_QUESTION_COUNT
    assert IC.CARD_SUMMARY.endswith("(%d questions)" % N)
    assert IC.studio_json()["question_count"] == N
    assert len(IC._with_saved_character(None)) == N      # no client folder: the plain card


def test_module_count_equals_rendered_count_item10():
    """Item 10: the live source count, the card, and every header agree on 14.

    This is the one that goes red if anyone re-hardcodes a total: change the
    module's QUESTIONS, the rendered header total, or the block count and the
    numbers stop lining up.
    """
    assert len(IC.QUESTIONS) == 14                       # module count
    assert N == len(IC.QUESTIONS)                        # N is never its own number
    heads = re.findall(r"^Question (\d+) of (\d+) - ", CARD, flags=re.M)
    assert len(heads) == len(IC.QUESTIONS)               # every question rendered, no extra
    assert [int(i) for i, _ in heads] == list(range(1, len(IC.QUESTIONS) + 1))
    assert {int(t) for _, t in heads} == {len(IC.QUESTIONS)}   # no header carries another total
    assert len(_blocks(CARD)) == len(IC.QUESTIONS) + 1    # fourteen questions + closing


def test_no_help_or_docstring_claims_a_count_other_than_the_live_one():
    """Goes red the moment a help string or docstring hardcodes a total that is
    not the card's own -- the "nine questions" lie cannot come back."""
    for path in _AST_SOURCES:
        for where, text in _AST_readable_strings(path):
            wrong = [(w, c) for w, c in _AST_claims(text) if c != N]
            assert not wrong, "%s in %s: %s" % (where, path, wrong)


def test_no_help_or_docstring_claims_a_different_count():
    """Item 10: no help text or docstring may state a total other than the live
    one. A stale "nine questions" is exactly how a box's copy diverged from the
    card it ships, so the assertion reads the source files it never edits."""
    stale = []
    for path in COUNT_SOURCES:
        with open(path, encoding="utf-8") as fh:
            for no, line in enumerate(fh, 1):
                code = line.split("#", 1)[0]              # line comments carry sub-counts
                for m in COUNT_CLAIM.finditer(code):
                    word = m.group(1)
                    value = int(word) if word.isdigit() else NUMBER_WORDS[word]
                    if value != N:
                        rel = os.path.relpath(path, CORE)
                        stale.append(f"{rel}:{no}: {m.group(0)!r} states {value}, live {N}")
    assert not stale, "stale question count:\n  " + "\n  ".join(stale)


def test_the_nine_questions_lie_is_gone_from_every_shipped_string():
    for path in _AST_SOURCES:
        src = open(path, encoding="utf-8").read().lower()
        assert "nine questions" not in src, path
        assert "ten with a saved character" not in src, path


def test_cli_help_prints_the_live_count():
    """Both entry points must say the number the card renders, in the same
    words, or the agent has nothing accurate to repeat to the client."""
    live = "%d questions" % N
    runs = ((os.path.join(HERE, "intake_card.py"), ["--help"]),
            (os.path.join(CORE, "intake_preflight", "factory.py"), ["--help"]),
            (os.path.join(CORE, "intake_preflight", "factory.py"), ["card", "--help"]))
    for script, argv in runs:
        out = subprocess.run([sys.executable, script] + argv, cwd=CORE,
                             capture_output=True, text=True).stdout
        assert live in out, (script, argv, out[:600])
        assert not [c for c in _AST_claims(out) if c[1] != N], (script, argv, out[:600])


def test_each_option_on_its_own_numbered_line_recommended_marked():
    for q, b in zip(IC.QUESTIONS, _blocks(CARD)):
        if q.get("free_text"):              # a brief block has no menu to number
            assert b.split("\n")[-1] == IC.FREE_TEXT_HINT, b
            continue
        lines = b.split("\n")
        opts = [l for l in lines[2:] if not l.startswith("   Watch: ")]   # sample links sit under their option
        assert len(opts) == len(q["options"])
        for n, line in enumerate(opts, 1):
            assert re.match(r"^%d\. .+ - .+[.)\d]$" % n, line), line  # a priced line ends in the dollar figure
            assert "\n" not in line
        if q["recommended"] is None:        # unpriced BUDGET: nothing to recommend
            assert not any(IC.REC in l for l in opts)
            continue
        assert sum(IC.REC in l for l in opts) == 1
        assert IC.REC in opts[q["recommended"]]


def test_closing_line_last():
    assert _blocks(CARD)[-1] == IC._closing(IC.QUESTIONS)
    assert CARD.startswith("Question 1 of 14")


def test_no_markup_that_a_sender_could_strip():
    assert not re.search(r"[*_`<>]|\\n", CARD)


def test_messages_under_limit_and_split_between_questions():
    one = IC.render_messages()
    # fourteen questions no longer fit one Telegram message; they split only on
    # the blank-line seams, so joining them back gives the whole card.
    assert "\n\n".join(one) == CARD and all(len(m) <= IC.TELEGRAM_LIMIT for m in one)
    # 1000 not 400: the video question now carries five sample links (FU-STYLE-QUESTIONS)
    small = IC.render_messages(limit=1000)
    assert len(small) > 1
    assert all(len(m) <= 1000 for m in small)
    assert "\n\n".join(small) == CARD         # only blank-line seams were cut
    for m in small:                       # never starts a message mid-question
        assert m.startswith("Question") or m == IC._closing(IC.QUESTIONS)
    # a single oversize question still splits on line boundaries
    models = next(q for q in IC.QUESTIONS if q["id"] == "models")
    big = [dict(models, options=[("Opt %d" % i, "x" * 60) for i in range(80)])]
    parts = IC.render_messages(big, limit=500)
    assert all(len(p) <= 500 for p in parts) and len(parts) > 1


def test_telegram_payload_keeps_newlines():
    for m in IC.render_messages(limit=500):
        body = json.loads(json.dumps(IC.telegram_payload("123", m)))
        assert body["text"] == m and body["text"].count("\n") == m.count("\n")
        assert "parse_mode" not in body and len(body["text"]) <= 4096
    assert "\n" in IC.telegram_payload("1", CARD)["text"]


def test_openclaw_argv_keeps_newlines_through_a_real_subprocess():
    argv = IC.openclaw_send_argv("123", CARD)
    assert argv[:6] == ["openclaw", "message", "send", "--channel", "telegram", "--target"]
    msg = argv[argv.index("--message") + 1]
    # round-trip through a real process boundary (no shell): echo argv back
    out = subprocess.run([sys.executable, "-c", "import sys;sys.stdout.write(sys.argv[1])", msg],
                         capture_output=True, text=True, check=True).stdout
    assert out == CARD and out.count("\n") == CARD.count("\n")


def test_cli_text_is_raw_newlines_and_json_formats():
    script = os.path.join(HERE, "intake_card.py")
    raw = subprocess.run([sys.executable, script], capture_output=True, text=True).stdout
    assert raw == CARD + "\n" and "\\n" not in raw
    js = json.loads(subprocess.run([sys.executable, script, "--format", "openclaw-json",
                                    "--target", "9"], capture_output=True, text=True).stdout)
    assert js[0][-1].count("\n") > 10


def test_format_questions_blank_line_between():
    msg = IC.format_questions(["What product?", "Who is it for?", "How much?"])
    assert msg.split("\n\n")[0] == "Question 1 of 3\nWhat product?"
    assert len(msg.split("\n\n")) == 4 and IC.format_questions([]) is None


def test_intake_question_message_uses_it():
    sys.path.insert(0, os.path.join(CORE, "intake_preflight"))
    import intake as I  # noqa: E402
    r = I.evaluate({}, {}, None, "h9")
    m = r["question_message"]
    assert m and "\n\n" in m and m.count("Question ") == len(r["questions"])


def test_closing_example_answer_count_matches_question_count():
    # The "like a, a, a" example belongs to the all-choice card; a card with a
    # typed question closes with its own sentence instead (see below).
    choices = [q for q in IC.QUESTIONS if not q.get("free_text")]
    for qs in (choices, choices[:-1] + [dict(choices[-1], recommended=None)],
               choices + [choices[0]]):
        ex = re.search(r'like "([^"]+)"', IC._closing(qs)).group(1)
        assert len(ex.split(", ")) == len(qs)


def test_a_card_with_typed_questions_closes_with_its_own_sentence():
    closing = IC._closing(IC.QUESTIONS)
    assert closing.startswith("How to answer: type your own words for Offer, Offer Link, "
                               "Audience, Character, Photos"), closing
    # the unpriced BUDGET has nothing to recommend, so the shortcut stays off
    assert "all recommended" not in closing, closing
    priced = [IC.spend_question(18.5) if q["id"] == "spend" else q for q in IC.QUESTIONS]
    assert 'Say "all recommended"' in IC._closing(priced)
    assert IC.CLOSING_LINE == IC._closing(IC.QUESTIONS)     # the exported line is the real one


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("PASS", name)
            except Exception as e:  # noqa: BLE001
                fails += 1
                print("FAIL", name, repr(e))
    print("ALL PASS" if not fails else "%d FAILED" % fails)
    sys.exit(1 if fails else 0)
