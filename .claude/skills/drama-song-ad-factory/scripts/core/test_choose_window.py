#!/usr/bin/env python3
"""choose_window: phrase-boundary cuts from Suno word stamps, 2-try pricing. $0.
Run: python3 scripts/core/test_choose_window.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lipsync_clips as C                              # noqa: E402


def words(spec, t0=0.0):
    """spec: [(word, dur, gap_after)] -> Suno-style stamps."""
    out, t = [], t0
    for w, d, g in spec:
        out.append({"word": w, "start_s": t, "end_s": t + d})
        t += d + g
    return out


# a 12-word line, steady 0.4 s words with a 0.1 s gap, then a rest, then a second line
LINE = [("hold", .4, .1), ("on", .4, .1), ("to", .4, .1), ("the", .4, .1), ("light", .4, .1),
        ("you", .4, .1), ("bring", .4, .1), ("me", .4, .1), ("back", .4, .1),
        ("home", .4, .1), ("again", .4, 1.0)]


def test_total_is_four_to_six_seconds_with_the_padding():
    p = C.choose_window(words(LINE * 2, t0=1.0))
    assert 4.0 <= p["total_s"] <= 6.0 and p["lead_in_s"] == 0.30 and p["tail_s"] == 0.20
    first, last = p["used_lines"][0], p["used_lines"][-1]
    assert abs(p["cut_start"] - (first[1] - 0.30)) < 1e-6 or p["cut_start"] == 0.0
    assert abs(p["total_s"] - (p["cut_end"] - p["cut_start"])) < 1e-6 or p["cut_start"] == 0.0


def test_cuts_on_word_boundaries_with_padding_never_inside_a_word():
    ws = words(LINE * 2)
    p = C.choose_window(ws)
    starts = {round(w["start_s"], 3) for w in ws}
    ends = {round(w["end_s"], 3) for w in ws}
    assert round(p["cut_start"] + p["lead_in_s"], 3) in starts
    assert round(p["cut_end"] - p["tail_s"], 3) in ends


def test_onset_density_at_least_one_and_a_half_per_second():
    p = C.choose_window(words(LINE * 2, t0=1.0))
    assert p["onsets_per_s"] >= C.MIN_ONSETS_PER_S and "SPARSE_ONSETS" not in p["flags"]
    sparse = words([("ooh", .9, .3)] * 8)
    assert "SPARSE_ONSETS" in C.choose_window(sparse)["flags"]


def test_no_held_word_over_one_point_two_seconds():
    spec = [("hold", .4, .1)] * 4 + [("home", 1.6, .2)] + [("light", .4, .1)] * 12
    p = C.choose_window(words(spec))
    assert p["held_max_s"] <= C.MAX_HELD_WORD_S and p["flags"] == []
    # every window holds a long note -> shortest held note wins, marked HELD_NOTE
    allheld = words([("aaah", 1.4, .1)] * 6)
    q = C.choose_window(allheld)
    assert "HELD_NOTE" in q["flags"] and q["held_max_s"] == 1.4


def test_prefers_p_b_m_f_v_w_words():
    ws = words([("sun", .4, .1)] * 10 + [("pray", .4, .1), ("bring", .4, .1),
                ("me", .4, .1), ("from", .4, .1), ("wave", .4, .1)] * 2 + [("sun", .4, .1)] * 10)
    p = C.choose_window(ws)
    plain = words([("sun", .4, .1)] * 10)
    assert p["bilabial_words"] >= C.choose_window(plain)["bilabial_words"]
    assert p["bilabial_words"] >= 6


def test_repeated_hook_gets_a_different_line_each_time():
    hook = words(LINE * 3)
    a = C.choose_window(hook, role="hook")
    b = C.choose_window(hook, role="hook", used_lines=a["used_lines"])
    c = C.choose_window(hook, role="hook", used_lines=a["used_lines"] + b["used_lines"])
    sa, sb, sc = (set(x["used_lines"]) for x in (a, b, c))
    assert not (sa & sb), "second clip must not reuse the first clip's words"
    assert b["shared"] == 0
    assert c is not None


def test_next_best_window_is_a_changed_input():
    ws = words(LINE * 2)
    first, second = C.choose_window(ws, step=1), C.choose_window(ws, step=2)
    assert (first["cut_start"], first["cut_end"]) != (second["cut_start"], second["cut_end"])
    assert C.choose_window(words([("a", .3, .1)]), step=1) is None      # too short for 4 s


def test_two_try_rule_prices_both_tries():
    assert C.MAX_TRIES == 2
    assert C.estimate_cost_usd(35, 0.04) == round(35 * 0.04 * 2, 4)
    assert C.estimate_cost_usd(35, 0.04, attempts=1) == round(35 * 0.04, 4)
    assert C.check_budget(35, 0.04, 10)["cost_usd"] == 2.8
    try:
        C.check_budget(35, 0.04, 2.0)                 # one try fits, two tries do not
    except C.LipsyncClipsError as e:
        assert e.code == C.OVER_CAP
    else:
        raise AssertionError("the cap check must price 2 tries")


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
    print("ALL CHECKS PASS")
