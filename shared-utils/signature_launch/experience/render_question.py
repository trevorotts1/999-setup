#!/usr/bin/env python3
"""One canonical question, three shapes.

Claude Code and claude-nine get the structured question tool payload (2-4 options,
short header, ONE question per call, free text via Other). OpenClaw and plain get one
short numbered chat message per question and `parse_reply` for the answer. The agent
says the message in its OWN session channel: this module sends nothing and reads no
credentials.

A question is the bank's object: id, text (or prompt), why (or reason),
choices (strings or {label,value,description|example}, at most 3), optional example,
header, group, default.value (never_default questions have none), and a nested
help object. The nested `help.examples`, the `default.value` and every per-option
explanation are preserved all the way into the rendered question: they are never
flattened into a phrase like "Use this one". "I'm not sure, help me" is always added,
and its description names the coaching ways out (show an example, help me answer,
recommend from what is already known). Resume: `pending` reads the answers file, so a
confirmed answer is never asked twice.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness_profile  # noqa: E402

HELP_LABEL = "I'm not sure, help me"
TYPE_LABEL = "Type my own answer"
MAX_CHOICES = 3
MAX_TOOL_QUESTIONS = 1  # one question at a time: the client is never handed a wall of questions
MAX_HEADER = 12
DONE_STATUSES = ("provided", "default_to_confirm")  # unknown/suggested get asked again
_HELP_WORDS = {"help", "?", "not sure", "im not sure", "i'm not sure", "idk", "i dont know",
               "i don't know", "dont know", "don't know", "no idea", "help me",
               "help me answer", "show me an example", "give me an example",
               "recommend using what is known"}
_HELP_PHRASES = re.compile(
    r"\b(?:not sure|no idea|no clue|don'?t know|help|show me an example|give me an example)\b")
_MAX_HELP_WORDS = 6  # longer replies are real answers that merely mention a phrase
_DEFAULT_WORDS = {"default", "use default", "skip", "you choose", "you pick"}


def _choice(c):
    """One choice, keeping its own explanation. A per-option `example` counts as its
    explanation, so a bank that explains options that way is never flattened."""
    if isinstance(c, dict):
        label = str(c.get("label") or c.get("value"))
        return {"label": label, "value": c.get("value", label),
                "description": str(c.get("description") or c.get("example") or "")}
    return {"label": str(c), "value": str(c), "description": ""}

def _examples(q):
    """The nested help examples, never dropped when they are the only examples there are."""
    out = []
    for e in ((q.get("help") or {}).get("examples") or []):
        if str(e).strip() and str(e) not in out:
            out.append(str(e))
    if q.get("example") and str(q["example"]) not in out:
        out.insert(0, str(q["example"]))
    return out

def _safe_default(q):
    """The safe default from the bank. The nested default.value wins over a flat key."""
    nested = (q.get("default") or {}).get("value") if isinstance(q.get("default"), dict) else None
    return nested if nested not in (None, "") else q.get("safe_default")

def normalize(q):
    choices = [_choice(c) for c in (q.get("choices") or [])]
    for c in choices:  # every choice keeps an explanation, even when the bank gives none
        c["description"] = c["description"] or f"Choose {c['label']}."
    qid = str(q["id"])
    examples = _examples(q)
    return {
        "id": qid,
        "text": str(q.get("text") or q.get("prompt") or qid),
        "why": str(q.get("why") or q.get("reason") or ""),
        "example": examples[0] if examples else "",
        "examples": examples,
        "help_text": str((q.get("help") or {}).get("explain") or ""),
        "choices": choices[:MAX_CHOICES],
        "dropped": [c["label"] for c in choices[MAX_CHOICES:]],
        "header": str(q.get("header") or q.get("group") or qid.split("_", 1)[-1])
        .replace("_", " ").strip().title()[:MAX_HEADER].strip() or "Question",
        "group": str(q.get("group") or q.get("phase") or ""),
        "safe_default": _safe_default(q),
        "never_default": bool(q.get("never_default")),
    }


def can_default(n):
    return n["safe_default"] not in (None, "") and not n["never_default"]


def structured(questions):
    """Calls for the structured question tool, ONE question per call.

    The client is asked one thing at a time: handing over four pickers at once is exactly
    the overwhelm the guided experience removes. MAX_TOOL_QUESTIONS is the single place
    that decides how many go in one call.
    """
    calls = []
    for i in range(0, len(questions), MAX_TOOL_QUESTIONS):
        chunk = questions[i:i + MAX_TOOL_QUESTIONS]
        calls.append({"tool": "AskUserQuestion", "questions": [_tool_question(normalize(q)) for q in chunk],
                      "ids": [str(q["id"]) for q in chunk]})
    return calls

def _coach(n):
    """What the help option promises, in the client's own words: concrete ways out."""
    ways = ["show me an example"]
    if n["help_text"]:
        ways.append("explain it in plain language")
    if can_default(n):
        ways.append("recommend something using what is already known")
    return "I will " + ", ".join(ways[:-1] + ["or " + ways[-1]]) if len(ways) > 1 else ways[0]

def _tool_question(n):
    opts = [{"label": c["label"], "description": c["description"]} for c in n["choices"]]
    if not opts:
        opts.append({"label": TYPE_LABEL,
                     "description": "Pick Other below and type your own answer, or pick this and I will ask in chat"})
    opts.append({"label": HELP_LABEL, "description": _coach(n)})
    text = n["text"]
    if n["why"]:
        text += "\n" + n["why"]
    return {"question": text, "header": n["header"], "multiSelect": False, "options": opts}

def chat(q, index=None, total=None):
    n = normalize(q)
    head = f"Question {index} of {total}: " if index and total else ""
    lines = [head + n["text"]]
    if n["why"]:
        lines.append(f"Why we ask: {n['why']}")
    for ex in n["examples"][:2]:
        lines.append(f"Example: {ex}")
    if n["help_text"] and n["examples"]:
        lines.append(f"If none of that fits: {n['help_text']}")
    if n["choices"]:
        lines.append("Reply with a number, or type your own answer:")
        for i, c in enumerate(n["choices"], 1):
            lines.append(f"{i}. {c['label']}" + (f" - {c['description']}" if c["description"] else ""))
        lines.append(f"{len(n['choices']) + 1}. {HELP_LABEL}")
    else:
        lines.append("Just type your answer. Not sure? Reply \"help\" and I will show you options.")
    if can_default(n):
        lines.append("Or reply \"default\" and I will use a safe one and mark it \"to confirm\".")
    return "\n".join(lines)


def parse_reply(q, reply):
    """-> {kind: choice|free_text|help|default|repeat, value}. Never a dead end."""
    n = normalize(q)
    t = str(reply or "").strip()
    low = re.sub(r"[.!?]+$", "", t.lower().replace("\u2019", "'").replace("\u2018", "'"))
    if not t:
        return {"kind": "repeat", "value": None}
    if not low or low in _HELP_WORDS:  # bare "?" or "??" strips to empty: still a help request
        return {"kind": "help", "value": None}
    if low in _DEFAULT_WORDS:  # a never-default question turns "skip" into help, not a silent gap
        return ({"kind": "default", "value": n["safe_default"]} if can_default(n)
                else {"kind": "help", "value": None})
    if n["choices"] and low.isdigit():
        k = int(low)
        if 1 <= k <= len(n["choices"]):
            return {"kind": "choice", "value": n["choices"][k - 1]["value"]}
        if k == len(n["choices"]) + 1:
            return {"kind": "help", "value": None}
    for c in n["choices"]:
        if low == c["label"].lower():
            return {"kind": "choice", "value": c["value"]}
    if low == HELP_LABEL.lower() or (len(low.split()) <= _MAX_HELP_WORDS and _HELP_PHRASES.search(low)):
        return {"kind": "help", "value": None}
    return {"kind": "free_text", "value": t}


def records(answers):
    """{question_id: record} from the answers file (dict or list form)."""
    a = (answers or {}).get("answers", answers or {})
    if isinstance(a, list):
        return {str(r.get("question_id") or r.get("id")): r for r in a if isinstance(r, dict)}
    return {str(k): (v if isinstance(v, dict) else {"value": v, "status": "provided"})
            for k, v in a.items() if k not in ("to_confirm", "harness", "runtime")}


def pending(questions, answers):
    done = {k for k, r in records(answers).items() if r.get("status") in DONE_STATUSES}
    return [q for q in questions if str(q["id"]) not in done]


def render(questions, profile):
    if profile["question_shape"] == "structured":
        return structured(questions)
    return [{"message": chat(q, i, len(questions)), "id": q["id"]}
            for i, q in enumerate(questions, 1)]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--questions-file", required=True, help="JSON list, or {questions:[...]}")
    ap.add_argument("--answers-file")
    ap.add_argument("--harness")
    a = ap.parse_args(argv)
    qs = json.loads(Path(a.questions_file).read_text(encoding="utf-8"))
    qs = qs.get("questions", qs)
    answers = json.loads(Path(a.answers_file).read_text(encoding="utf-8")) if a.answers_file else None
    prof = harness_profile.detect(a.harness, answers)
    print(json.dumps({"profile": prof, "render": render(pending(qs, answers), prof)}, indent=2))


if __name__ == "__main__":
    main()
