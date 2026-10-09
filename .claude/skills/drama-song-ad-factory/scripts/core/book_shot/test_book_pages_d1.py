#!/usr/bin/env python3
"""FU-U11 D1: printed pages, the plan hash, the card block and the excerpt seam.

Proves, behaviourally, the four cases the unit brief names:

  (a) a WHITE-PAGE fixture FAILs BOOK_BLANK_PAGES and a PRINTED-PAGE fixture
      PASSes the same check on the same code path;
  (b) a book video job with no approved plan hash is REFUSED (the plan-hash
      requirement U10 left dormant is ACTIVATED here, after U11's producer);
  (c) a changed prompt changes the hash and is refused until re-approved;
  (d) the client excerpt is NEVER sent to a video model: the assembled H3
      prompt carries no excerpt text, because the overlay is posted as DATA.

(d) is designed to pass WITHOUT U9 (the caption burn module is U9's artifact
and has not landed): no test is deferred here except the OCR read-back of the
burned overlay itself. It never weakens into a silent pass -- it asserts the
absent text AND that the overlay payload still carries the excerpt as data.

Run: HOME=$(mktemp -d) python3 scripts/core/book_shot/test_book_pages_d1.py
stdlib + cv2/numpy (PREREQS python-mediapipe); no network, no spend.
"""
from __future__ import annotations

import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.dirname(HERE)
if CORE not in sys.path:
    sys.path.insert(0, CORE)

import book_shot as BS                                    # noqa: E402 (package)
import book_shot.book_shot as BSM                         # noqa: E402 (module)
from book_shot.fixtures import build_fixtures as FIX       # noqa: E402

FAILS = []

def check(name, cond, detail=""):
    print("%s: %s%s" % ("ok" if cond else "FAIL", name,
                        (" (%s)" % (detail,)) if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def main():
    TMP = tempfile.mkdtemp(prefix="book-pages-d1-")
    try:
        _cases(TMP)
    finally:
        import shutil
        shutil.rmtree(TMP, ignore_errors=True)
    print("")
    if FAILS:
        print("FAILED %d: %s" % (len(FAILS), "; ".join(FAILS)))
        return 1
    print("all checks pass")
    return 0


def _cases(TMP):
    import cv2
    import numpy as np
    FX = FIX.build(TMP)

    # ---------------------------------------------------------------- (a) --
    # A white-page fixture against a printed-page fixture, same checker.
    printed = FIX.pages_frame(cv2, np, "printed")
    white = FIX.pages_frame(cv2, np, "white")
    ok = BS.check_pages(printed)
    bad = BS.check_pages(white)
    check("(a) a printed-page frame PASSes check_pages",
          ok["verdict"] == "PASS", ok)
    check("(a) a white-page frame FAILs with BOOK_BLANK_PAGES",
          bad["verdict"] == "FAIL" and bad["reason_code"] == "BOOK_BLANK_PAGES",
          bad)
    check("(a) the blank-page verdict names the measured blank fraction",
          (bad.get("checks") or {}).get("pages", {}).get("empty_cells", 0)
          > (ok.get("checks") or {}).get("pages", {}).get("empty_cells", 0),
          bad)

    # A clip whose OPEN FRAMES are mostly white fails on the sampled window,
    # not only on a single handed-in image.
    open_frames = [FX["paths"]["cover_frame"]] if "cover_frame" in FX["paths"] \
        else [printed]
    open_frames = open_frames + [white, white, white]
    # (the white frames sit AFTER the closed cover, i.e. in the open window)
    seq = BS.check_pages_sequence(open_frames)
    check("(a) more than one blank page among the open frames FAILs",
          seq["verdict"] == "FAIL" and seq["reason_code"] == "BOOK_BLANK_PAGES",
          seq)
    seq_ok = BS.check_pages_sequence([printed, printed, printed])
    check("(a) all-printed open frames PASS the sequence check",
          seq_ok["verdict"] == "PASS", seq_ok)

    # ---------------------------------------------------------------- (b) --
    # A book video job with no approved plan hash is refused.
    KD = _kie()
    spec = BS.plan_spec({"book_title": FX["title"], "pages": "texture"})
    sha = BS.plan_sha256(spec)
    frame_with_cover = FX["paths"]["front_frame"]
    base = {"shot_kind": "book", "request_kind": "video",
            "book_start_frame": frame_with_cover,
            "book_cover_path": FX["paths"]["cover"]}
    no_hash = KD.book_shot_refusal("kling-3.0/video", dict(base))
    check("(b) a book job with NO book_plan_sha256 is REFUSED",
          no_hash is not None
          and no_hash["reason_code"] == "BOOK_PLAN_NOT_APPROVED", no_hash)
    matching = KD.book_shot_refusal(
        "kling-3.0/video",
        dict(base, book_plan_sha256=sha, approved_book_plan_sha256=sha))
    check("(b) a matching approved plan hash passes",
          matching is None, matching)

    # ---------------------------------------------------------------- (c) --
    # A changed prompt changes the hash and is refused until re-approved.
    changed = BS.plan_spec({"book_title": FX["title"], "pages": "texture",
                            "subject": "A different subject line"})
    sha2 = BS.plan_sha256(changed)
    check("(c) a changed prompt changes the plan hash", sha != sha2,
          (sha, sha2))
    stale = KD.book_shot_refusal(
        "kling-3.0/video",
        dict(base, book_plan_sha256=sha2, approved_book_plan_sha256=sha))
    check("(c) the changed prompt is REFUSED until re-approved",
          stale is not None
          and stale["reason_code"] == "BOOK_PLAN_NOT_APPROVED", stale)
    reapproved = KD.book_shot_refusal(
        "kling-3.0/video",
        dict(base, book_plan_sha256=sha2, approved_book_plan_sha256=sha2))
    check("(c) re-approving the new hash lets it through",
          reapproved is None, reapproved)

    # ---------------------------------------------------------------- (d) --
    # The excerpt is DATA, never prompt text.
    EXCERPT = ["The kitchen was never empty on a Sunday.",
               "She kept the recipe cards in a tin.",
               "Every table remembers who sat there."]
    out = BS.excerpt_overlay(EXCERPT, provenance="provided")
    check("(d) the overlay carries the excerpt as DATA",
          out["overlay"]["lines"] == EXCERPT, out)
    check("(d) the overlay is marked data-only, never prompt",
          out.get("to_video_model") is False, out)
    spec_d = BS.plan_spec({"book_title": FX["title"], "pages": "texture",
                           "excerpt": EXCERPT})
    try:
        blocks = BS.prompt_blocks(spec_d, "flip")
        prompt = BS.build_prompt(spec_d, "flip", blocks)
    except Exception as exc:                              # noqa: BLE001
        prompt = ""
        check("(d) the book prompt still assembles with an excerpt present",
              False, exc)
    # Every DISTINCTIVE word of the excerpt must be absent. Common words
    # ("the", "she") live in every prompt already, so they are not evidence;
    # a distinctive word appearing would be real leakage.
    STOP = {"the", "a", "an", "she", "he", "it", "was", "were", "on", "in",
            "and", "or", "to", "of", "for", "her", "his", "every", "never",
            "who", "there", "that", "they", "their", "kept"}
    words = {w.strip(".,").lower() for ln in EXCERPT for w in ln.split()}
    distinctive = words - STOP
    pwords = set(re.findall(r"[a-z']+", prompt.lower()))
    leaked = sorted(w for w in distinctive if w and w in pwords)
    check("(d) the assembled prompt NEVER carries excerpt words",
          not leaked, leaked)
    check("(d) no whole excerpt line appears in the prompt",
          not [ln for ln in EXCERPT if ln.lower() in prompt.lower()], prompt)
    check("(d) the prompt names no overlay text at all",
          "overlay" not in prompt.lower(), prompt)

    # The U9 boundary: one named hook, and it does not burn anything itself.
    hook = BS.EXCERPT_OVERLAY_HOOK
    check("(d) exactly one overlay hook is named, for U9",
          hook == "final_assembler.captions_burn.overlay_excerpt", hook)

    # ------------------------------------------------- intake excerpt ------
    from intake_book import book as IB
    brief = {"book_title": "T", "author": "A", "buy_link": "https://x.example/b",
             "audience": "a", "pain_or_transformation": "p"}
    with_ex = dict(brief, excerpt_lines=EXCERPT)
    r1 = IB.evaluate(with_ex)
    check("intake: a supplied excerpt is carried with provenance 'provided'",
          r1["summary"].get("excerpt_lines") == EXCERPT
          and r1["summary"].get("excerpt_provenance") == "provided", r1)
    r2 = IB.evaluate(dict(brief))
    check("intake: no excerpt -> no excerpt key at all",
          "excerpt_lines" not in (r2.get("summary") or {}), r2.get("summary"))
    r3 = IB.evaluate(dict(brief, excerpt_lines=["one", "two", "three", "four"]))
    check("intake: more than 3 excerpt lines is REFUSED",
          r3["outcome"] == "rejected"
          and r3["reason_code"] == "book_excerpt_invalid", r3)
    r4 = IB.evaluate(dict(brief, excerpt_lines=["The kitchn was empty"]))
    check("intake: a misspelled excerpt is REFUSED",
          r4["outcome"] == "rejected"
          and r4["reason_code"] == "book_excerpt_invalid", r4)
    check("intake: a refused excerpt never reaches the questions",
          r4["questions"] == [], r4["questions"])
    try:
        BS.normalize_excerpt(["The kitchn was empty"])
        check("book_shot: a misspelled excerpt raises", False)
    except BS.BookShotError as exc:
        check("book_shot: a misspelled excerpt raises",
              exc.code == BS.BOOK_EXCERPT_INVALID, exc)

    # ------------------------------------------- card approval block -------
    plan = BS.plan_spec({"book_title": FX["title"], "author": FX["author"],
                         "pages": "texture", "excerpt": EXCERPT[:2]})
    block = BS.plan_card_block(plan, ["No buy link supplied."])
    text = "\n".join(block)
    check("card: the block shows the plan hash",
          BS.plan_sha256(plan) in text, text)
    check("card: the block shows the title and the author",
          FX["title"] in text and FX["author"] in text, text)
    check("card: the block shows the excerpt as client-supplied",
          "client-supplied" in text, text)
    check("card: the block carries the notice it was given",
          "No buy link supplied." in text, text)
    check("card: the block offers NO new choice (no numbered options)",
          not re.search(r"^\s*\d+\.\s", text, re.M), text)
    check("card: a non-book plan adds no block",
          BS.plan_card_block(None) == [], BS.plan_card_block(None))

    import importlib
    CR = importlib.import_module("catalog_calculator.card_render")
    card = {"length": "60 seconds", "book_plan": plan}
    rendered, _ = CR.render(card, None)
    check("card: the calculator card carries the book block",
          "Book shots" in rendered and BS.plan_sha256(plan) in rendered,
          rendered[-400:])
    plain, _ = CR.render({"length": "60 seconds"}, None)
    check("card: a non-book card is unchanged (no book block)",
          "Book shots" not in plain, plain[-200:])

    IC = importlib.import_module("choice_card.intake_card.intake_card")
    icheck = IC.render_card(None, book_plan=plan)
    check("card: the intake card carries the book block",
          "Book shots" in icheck and BS.plan_sha256(plan) in icheck, "")
    plain_ic = IC.render_card(None)
    check("card: a non-book intake card is unchanged",
          "Book shots" not in plain_ic, "")
    msgs = IC.render_messages(None, book_plan=plan)
    check("card: the intake messages carry the block and stay under the limit",
          any("Book shots" in m for m in msgs)
          and all(len(m) <= IC.TELEGRAM_LIMIT for m in msgs),
          [len(m) for m in msgs])
    # The block is an approval, not a question: the question count and the
    # answer instruction are IDENTICAL with and without it.
    with_b = "\n\n".join(IC.render_messages(None, book_plan=plan))
    without_b = "\n\n".join(IC.render_messages(None))
    import re as _re
    q_with = len(_re.findall(r"Question \d+ of \d+", with_b))
    q_without = len(_re.findall(r"Question \d+ of \d+", without_b))
    check("card: the block never adds a question",
          q_with == q_without and q_with == len(IC.QUESTIONS),
          (q_with, q_without, len(IC.QUESTIONS)))
    check("card: the closing answer line is unchanged",
          IC.CLOSING_LINE in with_b and IC.CLOSING_LINE in without_b,
          "")


def _kie():
    import importlib
    return importlib.import_module("kie_dispatch.kie_dispatch")


if __name__ == "__main__":
    raise SystemExit(main())
