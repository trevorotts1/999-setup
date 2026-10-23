#!/usr/bin/env python3
"""The guided client experience: the introduction, the computed length estimate, the
progress line, and the plan review that ends the interview.

The client is an entrepreneur, not a software engineer or a marketing expert. Everything
here is written for that reader: plain words, one thing at a time, decisions explained,
and no technical detail (schema names, ids, hashes, provider routing) ever shown.

Every number is COMPUTED from the questions that actually apply to this run. Nothing is
stored and nothing is hardcoded, so a Black Friday run, a launch run and a legacy run
each report their own real length, and a run that already knows some answers reports a
shorter one. When a computed estimate changes, `estimate_change()` says why.

Stdlib only. No network, no credentials, no client messages: the agent says the lines in
its OWN session channel.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_CLIENT_INTAKE = HERE.parent.parent / "client_intake"
if str(_CLIENT_INTAKE) not in sys.path:
    sys.path.insert(0, str(_CLIENT_INTAKE))

MODES = {
    "A": "recommend a plan for me",
    "B": "guide me through each decision",
    "C": "I already have a plan",
}

INTRO = (
    "I am going to help you get this launch live, and I will keep it simple.\n"
    "I will ask you one thing at a time, in plain language, and tell you why each one matters.\n"
    "You will never need to know any technical detail: that is my job, not yours.\n"
    "If a question does not fit, say \"I don't know\" and I will explain it, show you an "
    "example, or suggest something from what I already know. Nothing is guessed and nothing "
    "is built until you approve the plan.")

CHOICES = (
    "Before we start, one choice about how you want me to work:\n"
    "  A. Recommend a plan for me. I use what you tell me, ask only what is still missing, "
    "and you review the plan before anything is built.\n"
    "  B. Guide me through each decision. I explain the options in plain words and help you choose.\n"
    "  C. I already have a plan. I help you act on it and flag anything important that may be missed.\n"
    "You can change this at any time.")


def _bank(bank=None):
    import engine  # shared-utils/client_intake/engine.py
    return bank if bank is not None else engine.load_bank()


def applicable_questions(doc, bank=None):
    """The questions that actually apply to this run, in bank order.

    A conditional topic whose condition is false is not counted and is never asked, so a
    legacy run is not told about launch or Black Friday decisions."""
    import engine
    return engine.applicable(doc, bank or _bank(bank))


def estimate(doc, bank=None):
    """(remaining, total) computed from the applicable questions right now."""
    import engine
    total = len(applicable_questions(doc, bank))
    remaining = len([q for q in applicable_questions(doc, bank) if engine._askable(doc, q)])
    return remaining, total


def estimate_line(doc, bank=None):
    """One plain sentence with the real number, never a stored one."""
    remaining, total = estimate(doc, bank)
    if total == 0:
        return "I have everything I need for this launch."
    if remaining == 0:
        return f"That was all {total} question{'s' if total != 1 else ''} this launch needed."
    return (f"Expect about {remaining} short question{'s' if remaining != 1 else ''}, "
            f"depending on what we already know ({total} apply to your launch in total).")


def estimate_change(before, after, reason):
    """A changed estimate is explained, never silently revised."""
    if before == after:
        return None
    shorter = after < before
    return (f"The estimate changed from {before} to {after} question"
            f"{'s' if after != 1 else ''}: {reason}. "
            + ("The answer you gave covers several of them at once."
               if shorter else "One of your answers opened a follow-up I did not expect."))


def progress_line(doc, bank=None):
    """Progress over the applicable questions only, plus the stage being worked on."""
    remaining, total = estimate(doc, bank)
    answered = total - remaining
    pct = 0 if total == 0 else round(100 * answered / total)
    q = None
    try:
        import engine
        q = engine.next_question(doc, bank)
    except Exception:  # a doc no engine can read is still honestly reported
        q = None
    stage = _stage_name(q.get("group") if q else None)
    tail = f" Next: {stage}." if stage else ""
    return f"{answered} of {total} answered ({pct}%).{tail}"


_STAGES = {
    "start": "how you want me to work", "you": "you and your business",
    "offer": "your offer and what it costs", "funnel": "the shape of your funnel",
    "design": "your look and brand", "launch": "the launch decisions",
    "black-friday": "the seasonal decisions", "approval": "your review of the plan",
}


def _stage_name(group):
    return _STAGES.get(str(group or ""), str(group or "").replace("_", " "))


def _fact(doc, qid, fallback="not answered yet"):
    import engine
    v = engine.view(doc).get(qid)
    if v in (None, "", [], {}):
        return fallback
    if isinstance(v, list):
        return "; ".join(str(x) for x in v)
    if isinstance(v, dict):
        return v.get("display_name") or v.get("description") or v.get("text") or fallback
    return str(v)


def plan_review(doc, plan=None, costs=None, assumptions=None):
    """The ending: the client's own plan review, in four parts.

    1 what the client told us, 2 what we understand and recommend and why, 3 what will be
    built and the outcome it is meant to produce, 4 what is still assumed or limited and
    what it costs. Approval stays a separate, explicit step: this text recommends and
    never approves, and it never promises sales."""
    lines = ["Here is where we are. Please read it and tell me if anything is wrong.", ""]
    lines.append("What you told me:")
    for label, qid in (("Your business", "business_name"), ("What you are offering", "offer_name"),
                       ("Who it is for", "audience"), ("What changes for them", "offer_transformation"),
                       ("What the buyer gets", "deliverables"), ("Your price", "price")):
        lines.append(f"  - {label}: {_fact(doc, qid)}")
    lines.append("")
    lines.append("What I understand, and what I recommend:")
    shape = _fact(doc, "funnel_shape", "one offer")
    lines.append(f"  - Shape: {shape}. This is what decides whether buyers choose between "
                 f"packages or go straight to checkout, and I recommend it because it follows "
                 f"how you described your offer.")
    lines.append(f"  - Style: {_fact(doc, 'design_style', 'the standard look')}. Chosen to match "
                 f"the feeling you described for your brand.")
    lines.append("")
    lines.append("What will be built, and what it is meant to do:")
    lines.append("  - The pages of your funnel, drawn for desktop and phone and written in your words.")
    lines.append("  - The checkout that takes the payment, and the follow-up a buyer gets afterwards.")
    lines.append("  - The outcome this is meant to produce: more of the right people seeing your offer "
                 "and a clear, easy way for them to buy it.")
    lines.append("")
    lines.append("Assumptions, limits and costs:")
    items = list(assumptions or [])
    import engine
    ev = doc.get("answers", {})
    for qid, e in ev.items():
        if e.get("status") in ("default_to_confirm", "suggested"):
            items.append(f"{qid.replace('_', ' ')}: I used {e.get('value')!r} and marked it to confirm.")
    lines += [f"  - {i}" for i in items] or ["  - Nothing is assumed: every answer above came from you."]
    lines.append(f"  - Costs: {costs or 'the plan itself costs nothing to approve; paid pictures need their own approval first.'}")
    lines.append("")
    lines.append("I am recommending this, not approving it for you. Nothing is built until you say so, "
                 "and I cannot promise sales figures; what I can promise is that the launch is built "
                 "the way we agreed.")
    return "\n".join(lines)


def opening(doc=None):
    """The introduction plus the computed length estimate."""
    tail = f"\n\n{estimate_line(doc)}" if doc is not None else ""
    return f"{INTRO}\n\n{CHOICES}{tail}"


def main(argv=None):
    ap_args = sys.argv[1:] if argv is None else argv
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("answers_file", nargs="?")
    ap.add_argument("--mode", default="launch", choices=("launch", "legacy", "bf"))
    ap.add_argument("--harness")
    ap.add_argument("--what", default="opening", choices=("opening", "estimate", "progress", "review"))
    a = ap.parse_args(ap_args)
    import engine
    doc = engine.load(a.answers_file, a.mode) if a.answers_file else engine.new_doc(a.mode)
    doc["meta"]["mode"] = a.mode
    if a.what == "opening":
        print(opening(doc))
    elif a.what == "estimate":
        print(estimate_line(doc))
    elif a.what == "progress":
        print(progress_line(doc))
    else:
        print(plan_review(doc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
