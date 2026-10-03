#!/usr/bin/env python3
"""UserPromptSubmit: classify the user's prompt as question/action/neutral. Fails open."""
import json, os, re, sys, time

D = os.path.dirname(os.path.abspath(__file__))
VERBS = set("""fix do run send delete remove create build make stop kill deploy restart update install roll go apply
merge push clean set add change launch start dispatch use tell message give write edit reclaim find check
rename move copy commit revert reset rewrite replace patch enable disable save backup resume continue
execute proceed approve approved yes yep yeah ok okay sure""".split())
QWORDS = set("what why how is are was were can could do does did should would will where when which who whats what's explain".split())
FILLER = {"please", "now", "then", "also", "and", "so", "just", "hey", "ok", "okay", "alright", "right", "ahead"}
PHRASES = re.compile(r"\b(do it|go ahead|you have permission|proceed|approved|execute|send it|fix it|ship it)\b", re.I)
PRON = {"you", "we", "i", "they", "it", "he", "she", "the", "this", "that", "these", "those", "any", "all", "my", "our", "your", "everyone", "anyone"}


def is_action_clause(c):
    w = re.findall(r"[a-z0-9']+", c.lower())
    while w and w[0] in FILLER and not (w[0] in ("ok", "okay") and len(w) == 1):
        w.pop(0)
    if not w:
        return False
    v = w[0]
    if v in ("do", "does", "did") and len(w) > 1 and w[1] in PRON:
        return False  # "do you think..." is a question
    if v == "tell" and len(w) > 1 and w[1] == "me":
        return False  # "tell me ..." handled as question
    if v == "go" and len(w) > 1 and w[1] in ("figure", "see", "look"):
        return True
    if v in ("is", "are", "was", "were", "can", "could", "should", "would", "will", "does", "did"):
        return False
    return v in VERBS


def classify(p):
    for sent in re.split(r"(?<=[.!?;])\s+|\n+", p):
        s = sent.strip()
        if not s:
            continue
        if not s.endswith("?") and PHRASES.search(s):
            return "action"
        parts = [s] if s.endswith("?") else re.split(r",\s+|\s+(?:and|then)\s+", s)
        if any(is_action_clause(x) for x in parts):
            return "action"
    first = re.findall(r"[a-z']+", p.lower())[:2]
    if "?" in p or (first and (first[0] in QWORDS or first[:2] == ["tell", "me"])):
        return "question"
    return "neutral"


def main():
    try:
        d = json.load(sys.stdin)
        sid = re.sub(r"[^A-Za-z0-9_.-]", "_", str(d.get("session_id") or "nosession"))
        p = d.get("prompt") or ""
        mode = classify(p)
        os.makedirs(os.path.join(D, "state"), exist_ok=True)
        with open(os.path.join(D, "state", sid + ".json"), "w") as f:
            json.dump({"mode": mode, "at": int(time.time()), "prompt_head": p[:80]}, f)
        if mode == "question":
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext":
                "QUESTION ONLY: the user asked a question. Answer it. Do not change anything (no edits, no writes, no sends, no launches, no deletes) until they give an explicit order."}}))
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
