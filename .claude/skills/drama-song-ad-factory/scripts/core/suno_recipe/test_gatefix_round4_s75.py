#!/usr/bin/env python3
"""Round-4 gate findings on PR #465 (head 692f208): two false verdicts.

F1 - Silent lyric loss (suno_recipe.py): parse_lyrics keeps
"[Intro spoken: over a light instrumental bed]" as spoken with its lyric,
but render_lyrics drops the lyric because is_no_voice_tag scans the whole
tag including the cue. On head 692f208 the lyric is lost; after the fix the
rendered sheet keeps it.

F2 - Negation bypass (story_arc.py): a domain period splits the sentence, so
"Do not visit example.com and take the quiz." counts the negated quiz as a
commercial call. On head 692f208 both domain cases pass (counted); after the
fix both are refused. Real calls with a domain ("Take the quiz:
https://example.com", "Book a call at example.com now.", a call in its own
sentence after a domain) still count.

Failing-first: every test_* below FAILS on head 692f208 and PASSES after.
Pins hold: real no-voice sections still refuse a lyric, declared (spoken)
sections stay voiced, and the round-2/round-3 quiz rows are unchanged.

Run: python3 scripts/core/suno_recipe/test_gatefix_round4_s75.py
stdlib only, no network, no spend.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.dirname(HERE)
sys.path.insert(0, CORE)

import suno_recipe as R               # noqa: E402
import story_arc.story_arc as SA       # noqa: E402


def test_f1_render_keeps_spoken_cue_lyric():
    sheet = R.parse_lyrics("[Intro spoken: over a light instrumental bed]\n"
                           "Keep this lyric.\n[End]")
    assert sheet and sheet[0].get("delivery") == "spoken", sheet
    out = R.render_lyrics(sheet)
    assert "Keep this lyric." in out, out


def test_f1_cue_never_makes_a_section_no_voice():
    assert not R.is_no_voice_tag("Intro spoken: over a light instrumental bed")
    assert not R.is_no_voice_tag("Verse: instrumental bed")
    assert not R.is_no_voice_tag({"tag": "Break", "delivery": "spoken",
                                  "lines": ["x"]})


def test_f2_domain_period_never_splits_the_negation():
    assert SA._commercial_calls(
        "Do not visit example.com and take the quiz.") == []
    assert SA._commercial_calls(
        "Never visit example.com and book a call.") == []


def test_f2_domain_calls_still_count():
    assert SA._commercial_calls("Take the quiz: https://example.com") == \
        ["take the quiz"]
    assert "book" in SA._commercial_calls("Book a call at example.com now.")
    assert SA._commercial_calls("Visit example.com. Take the quiz now.") == \
        ["take the quiz"]
    assert SA._commercial_calls("Do not wait. Take the quiz now.") == \
        ["take the quiz"]


def test_pins_hold():
    # real no-voice sections still refuse a lyric
    for tag in ("[Instrumental]", "[Instrumental Break: band only]",
                "[Break]"):
        assert len(R.check_no_voice_lines(tag + "\nlyric")) == 1, tag
    # declared spoken stays voiced everywhere
    decl = "[Intro (spoken): over a light instrumental bed]"
    assert R.parse_tag(decl) == "spoken"
    assert not R.is_no_voice_tag("Instrumental (spoken)")
    # round-2/round-3 quiz rows unchanged
    def closing(line):
        return SA.check_payload_closing("[CTA (spoken)]\n" + line)["outcome"]
    assert closing("The quiz is beautiful.") == "rejected"
    assert closing("Nobody should take the quiz.") == "rejected"
    assert closing("Never\ntake the quiz.") == "rejected"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok:", name)
    print("ALL PASS")
