"""beat_sheet.emotion_track: the Emotion Track tag on every row (N-69).

Plan section 3G.1. Every beat-sheet row (the story script's rows) carries three
more columns:

  * **emotion** -- one of the ten words: pain, worry, exhaustion, anger, hope,
    relief, joy, pride, tenderness, resolve;
  * **intensity** -- 1 (held in), 2 (plain to see), 3 (overflowing);
  * **facial cues** -- six short entries: eyes, brows, mouth, smile, teeth,
    tears.

A row missing any of the three is refused with ``EMOTION_MISSING`` (3J MAJOR
item 11). The story-logic review (N-67) also asks whether each line's emotion
fits its words and moves believably line to line; a "no" there is a MEDIUM fit
note shown to the run owner, never a silent pass (3J.2).

The ten words and the six cue keys are the section 3G.1 table verbatim. The
cue values are a starting point the writer edits per line.

Stdlib only; data in, verdicts out; no model call, no write.
"""
from __future__ import annotations

from ._util import finding, norm, rows
from .beat_sheet import EMOTIONS, FACIAL_CUES, INTENSITIES

#: the standard cues a writer starts from (3G.1), one row per emotion
STANDARD_CUES = {
    "pain": {"eyes": "glassed or shut", "brows": "drawn up and together",
             "mouth": "pressed or trembling", "smile": "no", "teeth": "no",
             "tears": "at intensity 3"},
    "worry": {"eyes": "searching", "brows": "knit", "mouth": "lips pressed",
              "smile": "no", "teeth": "no", "tears": "none"},
    "exhaustion": {"eyes": "heavy lids", "brows": "slack", "mouth": "slightly open",
                   "smile": "no", "teeth": "no", "tears": "none"},
    "anger": {"eyes": "hard", "brows": "down", "mouth": "jaw set",
              "smile": "no", "teeth": "clenched at intensity 3", "tears": "none"},
    "hope": {"eyes": "lifting", "brows": "soft", "mouth": "corners just rising",
             "smile": "small, closed", "teeth": "no", "tears": "none"},
    "relief": {"eyes": "closing then opening", "brows": "released",
               "mouth": "a breath out", "smile": "small", "teeth": "no",
               "tears": "none"},
    "joy": {"eyes": "bright", "brows": "raised cheeks", "mouth": "smiling",
            "smile": "yes", "teeth": "at intensity 2 and 3", "tears": "none"},
    "pride": {"eyes": "steady", "brows": "level", "mouth": "chin up",
              "smile": "small, closed", "teeth": "no", "tears": "none"},
    "tenderness": {"eyes": "soft", "brows": "soft", "mouth": "head slightly tilted",
                   "smile": "soft, closed", "teeth": "no", "tears": "none"},
    "resolve": {"eyes": "level", "brows": "set", "mouth": "firm",
                "smile": "no", "teeth": "no", "tears": "none"},
}

#: the fixed list the story review answers about the emotion (3G.1, N-67)
FIT_QUESTIONS = (
    "does each line's emotion fit its words",
    "does the emotion move in a way a viewer would believe from line to line",
)


def standard_cues(emotion):
    """The starting cues for one emotion, or an empty map for an unknown word."""
    return dict(STANDARD_CUES.get(norm(emotion), {}))


def row_defects(row, index=0):
    """Every row carries an emotion, an intensity and the six facial cues."""
    pointer = "/rows/%d" % index
    out = []
    emotion = norm(row.get("emotion"))
    if emotion not in EMOTIONS:
        out.append(finding("EMOTION_MISSING", pointer + "/emotion",
                           "one of: " + ", ".join(EMOTIONS)))
    if row.get("intensity") not in INTENSITIES:
        out.append(finding("EMOTION_MISSING", pointer + "/intensity",
                           "1 (held in), 2 (plain to see) or 3 (overflowing)"))
    cues = row.get("facial_cues")
    if not isinstance(cues, dict):
        out.append(finding("EMOTION_MISSING", pointer + "/facial_cues",
                           "the six facial cues are required"))
    else:
        for key in FACIAL_CUES:
            value = cues.get(key)
            if value is None or (isinstance(value, str) and not value.strip()):
                out.append(finding("EMOTION_MISSING",
                                   pointer + "/facial_cues/" + key,
                                   "the six cues are eyes, brows, mouth, smile, "
                                   "teeth, tears"))
    return out


def emotion_defects(script):
    """Every row's tag, over the joined story script (N-69)."""
    out = []
    for index, row in enumerate(rows(script)):
        out.extend(row_defects(row, index))
    return out


def fit_defects(script, review):
    """The review's emotion-fit answers, as MEDIUM notes for the run owner."""
    out = []
    answers = review.get("emotion_fit") if isinstance(review, dict) else None
    if not answers:
        return out
    if isinstance(answers, dict):
        answers = [answers]
    for index, answer in enumerate(answers):
        if not isinstance(answer, dict):
            continue
        if norm(answer.get("fit")) in ("no", "false", "weak"):
            out.append(finding("EMOTION_FIT_NOTE", "/review/emotion_fit/%d" % index,
                               "the review finds the emotion does not fit the words",
                               line_id=answer.get("line_id")))
    return out


def check_emotion(script, review=None):
    """Result envelope for the Emotion Track tag and fit (N-69)."""
    defects = emotion_defects(script)
    if review:
        defects.extend(fit_defects(script, review))
    return {"ok": not any(d.get("level") == "MAJOR" for d in defects),
            "defects": defects}


def _selfcheck():
    cues = {"eyes": "steady", "brows": "set", "mouth": "firm",
            "smile": "no", "teeth": "no", "tears": "none"}
    good = {"rows": [{"row_id": "r1", "line_id": "l1", "emotion": "resolve",
                      "intensity": 2, "facial_cues": cues}]}
    assert check_emotion(good)["ok"], check_emotion(good)["defects"]
    bad = {"rows": [{"row_id": "r1", "line_id": "l1", "emotion": "grumpy",
                     "intensity": 4, "facial_cues": {"eyes": "x"}}]}
    codes = [d["code"] for d in check_emotion(bad)["defects"]]
    assert codes.count("EMOTION_MISSING") >= 3, codes
    note = check_emotion(good, review={"emotion_fit": [{"line_id": "l1", "fit": "no"}]})
    assert note["ok"]                  # a fit note is MEDIUM, never blocking
    assert any(d["code"] == "EMOTION_FIT_NOTE" for d in note["defects"])


if __name__ == "__main__":
    _selfcheck()
    print("beat_sheet.emotion_track selfcheck: OK")
