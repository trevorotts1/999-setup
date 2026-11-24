"""beat_sheet.model -- the Story Beats record and the story spine (N-115, N-74).

Plan section "Story Beats": one row per beat, eleven fields, written by the
spine's author after the spine and before any script row. Plan 3F.1 step 2 and
plan 10B guard 1 give the spine its 300-to-500-word floor and make it the single
story every parallel writer obeys.

Data in, defects out. Stdlib only. No provider call, no spend, no write.
"""
from __future__ import annotations

EMOTIONS = (
    "pain", "worry", "exhaustion", "anger", "hope",
    "relief", "joy", "pride", "tenderness", "resolve",
)

#: the six facial cues every beat-sheet row carries (3G.1)
CUE_KEYS = ("eyes", "brows", "mouth", "smile", "teeth", "tears")

#: story-clock order; a beat's time of day may never go backward
TIME_ORDER = ("dawn", "morning", "midday", "afternoon", "evening", "night")

SPINE_MIN_WORDS = 300
SPINE_MAX_WORDS = 500

#: the eleven fields of the beats table, plus the id and the short name
BEAT_FIELDS = (
    "beat_id", "name", "lyric_window", "who", "where", "wardrobe",
    "entrance_exit", "emotion_arc", "change", "event", "props",
    "lip_sync_candidates",
)

NOBODY_ELSE = "nobody else is seen here"


def defect(code, field, detail=None):
    """The repo-wide defect shape: a code, the field, and a plain detail."""
    record = {"code": code, "field": field}
    if detail is not None:
        record["detail"] = detail
    return record


def is_blank(value):
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict, tuple)):
        return not value
    return False


def text(value):
    return value.strip() if isinstance(value, str) else ""


def words(value):
    return text(value).split()


def spine_defects(spine_text):
    """N-74: the spine is 300 to 500 words, written before the beats."""
    body = text(spine_text)
    if not body:
        return [defect("SPINE_MISSING", "spine", "the story spine is absent")]
    count = len(words(body))
    if count < SPINE_MIN_WORDS:
        return [defect("SPINE_LENGTH", "spine",
                       "%d words; the floor is %d" % (count, SPINE_MIN_WORDS))]
    if count > SPINE_MAX_WORDS:
        return [defect("SPINE_LENGTH", "spine",
                       "%d words; the ceiling is %d" % (count, SPINE_MAX_WORDS))]
    return []


def _tag_defects(tag, field):
    if not isinstance(tag, dict):
        return [defect("BEAT_FIELD_MISSING", field, "an emotion tag object is required")]
    out = []
    if tag.get("emotion") not in EMOTIONS:
        out.append(defect("BEAT_FIELD_MISSING", field + ".emotion",
                          "one of: " + ", ".join(EMOTIONS)))
    intensity = tag.get("intensity")
    if intensity not in (1, 2, 3):
        out.append(defect("BEAT_FIELD_MISSING", field + ".intensity",
                          "1 (held in), 2 (plain to see) or 3 (overflowing)"))
    return out


def _window_defects(window):
    if not isinstance(window, dict):
        return [defect("BEAT_FIELD_MISSING", "lyric_window", "a measured window is required")]
    out = []
    start, end = window.get("start_s"), window.get("end_s")
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        out.append(defect("LYRIC_WINDOW_INVALID", "lyric_window",
                          "start_s and end_s are measured seconds"))
    elif end <= start:
        out.append(defect("LYRIC_WINDOW_INVALID", "lyric_window",
                          "end_s must be after start_s"))
    lines = window.get("lines")
    if not isinstance(lines, list) or not lines:
        out.append(defect("BEAT_FIELD_MISSING", "lyric_window.lines",
                          "the lyric lines inside the window, word for word"))
    return out


def beat_defects(beat):
    """Every required field of one beat row, by the Story Beats table (N-115)."""
    if not isinstance(beat, dict):
        return [defect("BEAT_NOT_OBJECT", "beat", "one beat row is an object")]
    out = []
    for field in ("beat_id", "name", "change"):
        if is_blank(beat.get(field)):
            out.append(defect("BEAT_FIELD_MISSING", field))
    name = text(beat.get("name"))
    if name and len(words(name)) > 5:
        out.append(defect("BEAT_NAME_TOO_LONG", "name",
                          "a beat's name is five words or fewer"))
    out.extend(_window_defects(beat.get("lyric_window")))

    who = beat.get("who")
    if not isinstance(who, dict):
        out.append(defect("BEAT_FIELD_MISSING", "who", "a who object is required"))
    else:
        if not isinstance(who.get("characters"), list):
            out.append(defect("BEAT_FIELD_MISSING", "who.characters",
                              "every character on screen, by id"))
        if not isinstance(who.get("singers"), list):
            out.append(defect("BEAT_FIELD_MISSING", "who.singers",
                              "who sings or speaks"))
        seen = who.get("who_else_seen")
        if not isinstance(seen, list):
            out.append(defect("BEAT_FIELD_MISSING", "who.who_else_seen",
                              "the people the place needs, or the sentence "
                              "'%s'" % NOBODY_ELSE))
        elif not seen:
            out.append(defect("BEAT_FIELD_MISSING", "who.who_else_seen",
                              "an empty list is not a decision; use '%s'" % NOBODY_ELSE))
        elif NOBODY_ELSE in seen and len(seen) != 1:
            out.append(defect("BEAT_FIELD_MISSING", "who.who_else_seen",
                              "the nobody-else sentence stands alone"))

    where = beat.get("where")
    if not isinstance(where, dict):
        out.append(defect("BEAT_FIELD_MISSING", "where", "a where object is required"))
    else:
        if is_blank(where.get("location_id")):
            out.append(defect("BEAT_FIELD_MISSING", "where.location_id"))
        if where.get("time_of_day") not in TIME_ORDER:
            out.append(defect("BEAT_FIELD_MISSING", "where.time_of_day",
                              "one of: " + ", ".join(TIME_ORDER)))

    wardrobe = beat.get("wardrobe")
    if not isinstance(wardrobe, dict) or not wardrobe:
        out.append(defect("BEAT_FIELD_MISSING", "wardrobe",
                          "one wardrobe id per character"))

    moves = beat.get("entrance_exit")
    if not isinstance(moves, dict):
        out.append(defect("BEAT_FIELD_MISSING", "entrance_exit",
                          "an entrance_exit object is required"))
    else:
        for key in ("entrances", "exits"):
            entries = moves.get(key)
            if not isinstance(entries, list):
                out.append(defect("BEAT_FIELD_MISSING", "entrance_exit." + key))
                continue
            for number, entry in enumerate(entries):
                if (not isinstance(entry, dict)
                        or is_blank(entry.get("character_id"))
                        or is_blank(entry.get("place_id"))):
                    out.append(defect(
                        "ENTRANCE_INVALID",
                        "entrance_exit.%s.%d" % (key, number),
                        "each move names a character id and a place id"))

    arc = beat.get("emotion_arc")
    if not isinstance(arc, dict):
        out.append(defect("BEAT_FIELD_MISSING", "emotion_arc",
                          "the emotion at the beat's start and at its end"))
    else:
        out.extend(_tag_defects(arc.get("start"), "emotion_arc.start"))
        out.extend(_tag_defects(arc.get("end"), "emotion_arc.end"))

    event = beat.get("event")
    if event is not None:
        if not isinstance(event, dict):
            out.append(defect("BEAT_FIELD_MISSING", "event",
                              "null, or the event and the exact line it happens on"))
        else:
            if is_blank(event.get("name")):
                out.append(defect("BEAT_FIELD_MISSING", "event.name"))
            if is_blank(event.get("line")):
                out.append(defect("BEAT_FIELD_MISSING", "event.line",
                                  "the exact lyric line the event happens on"))

    if not isinstance(beat.get("props"), list):
        out.append(defect("BEAT_FIELD_MISSING", "props",
                          "story props whose place or state changes (may be empty)"))
    candidates = beat.get("lip_sync_candidates")
    if not isinstance(candidates, list):
        out.append(defect("BEAT_FIELD_MISSING", "lip_sync_candidates",
                          "the whole sentences that could be sung here (may be empty)"))
    else:
        for number, entry in enumerate(candidates):
            if not isinstance(entry, dict) or is_blank(entry.get("line")):
                out.append(defect("LIP_CANDIDATE_INVALID",
                                  "lip_sync_candidates.%d" % number,
                                  "a candidate names its lyric line"))
    return out
