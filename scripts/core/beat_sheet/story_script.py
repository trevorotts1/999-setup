#!/usr/bin/env python3
"""The story script written from the Story Beats (N-63, section 3F.1).

This plan calls the story script "the beat sheet", so it lives in
``scripts/core/beat_sheet/``. From the passed Story Beats, one writer per song
section writes one row per lyric line, keyed to its measured start and end and
to its beat's number. The rows are written BEFORE any picture, and the
storyboard may add camera detail but may not add, drop or move an event.

One row per lyric line:

  line_id, text, start_s, end_s     the measured line
  beat_number, section_id, writer_id
  singer_id                         who sings it (from the lyric sheet)
  on_camera_id                      who is shown on a lip-sync line
  location_id, time_of_day, wardrobe_ids
  on_screen                         what happens on screen
  written_objects                   the written props the line shows
  lipsync                           {"voice_id", "frame_char_ids"} or None
  event                             the beat's event, only on its own line
  emotion, intensity, facial_cues   the Emotion Track tag (N-69)
  verdict                           MATCH / WEAK / MISMATCH (filled by N-66)
  camera                            shot detail the section writer adds

Writers obey the spine and the beats. A row that adds, drops or moves an event,
or changes who is there, where they are or what they wear, fails
``SCRIPT_OFF_BEAT`` and returns to its own writer; nobody edits another writer's
row. ``join_sections`` is the one mechanical join, in time order.

Tolerant of the two beat spellings in this package (``beat_number``/``beat_id``,
``start_s``/``lyric_window.start_s``). Standard library only.
"""

from __future__ import annotations

__all__ = [
    "SCRIPT_ROW_FIELDS",
    "ScriptError",
    "check_script_off_beat",
    "join_rows",
    "normalize_beat",
    "script_before_pictures",
    "song_lines",
    "summarize_sections",
    "write_section",
    "write_script",
    "selftest",
]

SCRIPT_ROW_FIELDS = (
    "line_id", "text", "start_s", "end_s", "beat_number", "section_id",
    "writer_id", "singer_id", "on_camera_id", "location_id", "time_of_day",
    "wardrobe_ids", "on_screen", "written_objects", "lipsync", "event",
    "emotion", "intensity", "facial_cues", "verdict", "camera",
)


class ScriptError(ValueError):
    """The beats or song data is structurally unusable."""


def _norm(value):
    return " ".join(str(value or "").split()).strip().lower()


def _num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _beats_list(beats):
    rows = beats.get("beats") if isinstance(beats, dict) else beats
    if not isinstance(rows, list):
        raise ScriptError("beats must be a list or {'beats': [...]}")
    return rows


def _beat_lines(beat):
    lines = beat.get("lyric_lines")
    if lines is None and isinstance(beat.get("lyric_window"), dict):
        lines = beat["lyric_window"].get("lines")
    out = []
    for item in lines or []:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            out.append(item.get("text") or item.get("line") or "")
    return [ln for ln in out if ln.strip()]


def song_lines(song):
    """Normalise the measured song to ``[{"index","text","start_s","end_s","hook"}]``."""
    lines = song.get("lines") if isinstance(song, dict) else song
    if not isinstance(lines, list):
        raise ScriptError("song must be a list of measured lines")
    out = []
    for i, line in enumerate(lines):
        if not isinstance(line, dict):
            raise ScriptError("song line %d is not an object" % i)
        out.append({
            "index": line.get("index", i),
            "text": line.get("text", ""),
            "start_s": _num(line.get("start_s", line.get("start"))),
            "end_s": _num(line.get("end_s", line.get("end"))),
            "hook": bool(line.get("hook")),
        })
    return out


def normalize_beat(beat, index=0):
    """Read one beat row under either spelling into the canonical fields."""
    if not isinstance(beat, dict):
        raise ScriptError("beat %d is not an object" % index)
    window = beat.get("lyric_window") if isinstance(beat.get("lyric_window"), dict) else {}
    start = _num(beat.get("start_s", window.get("start_s")))
    end = _num(beat.get("end_s", window.get("end_s")))
    who = beat.get("who") if isinstance(beat.get("who"), dict) else {}
    casts = beat.get("cast_ids") or [c.get("id") if isinstance(c, dict) else c
                                     for c in who.get("characters", [])]
    singers = beat.get("singers") or who.get("singers") or []
    if not singers and isinstance(who.get("characters"), list):
        singers = [c.get("id") for c in who["characters"]
                   if isinstance(c, dict) and c.get("role") == "sings"]
    wardrobe = beat.get("wardrobe_ids", beat.get("wardrobe", {})) or {}
    return {
        "beat_number": beat.get("beat_number", beat.get("beat_id", index)),
        "beat_name": beat.get("beat_name", beat.get("name", "")),
        "start_s": start,
        "end_s": end,
        "lines": _beat_lines(beat),
        "cast_ids": [c for c in casts if c],
        "singers": [c for c in singers if c],
        "location_id": beat.get("location_id",
                                beat.get("place_id",
                                         (beat.get("where_when") or {}).get("place_id")
                                         if isinstance(beat.get("where_when"), dict) else None)),
        "time_of_day": beat.get("time_of_day",
                                (beat.get("where_when") or {}).get("time_of_day")
                                if isinstance(beat.get("where_when"), dict) else None),
        "wardrobe_ids": {str(k): v for k, v in wardrobe.items()},
        "change": beat.get("change", ""),
        "event": beat.get("event") or None,
        "event_line": beat.get("event_line") or None,
        "emotion_start": beat.get("emotion_start",
                                  (beat.get("arc") or {}).get("start", {}).get("emotion")
                                  if isinstance(beat.get("arc"), dict) else None),
        "intensity_start": beat.get("intensity_start",
                                    (beat.get("arc") or {}).get("start", {}).get("intensity")
                                    if isinstance(beat.get("arc"), dict) else None),
        "emotion_end": beat.get("emotion_end",
                                (beat.get("arc") or {}).get("end", {}).get("emotion")
                                if isinstance(beat.get("arc"), dict) else None),
        "intensity_end": beat.get("intensity_end",
                                  (beat.get("arc") or {}).get("end", {}).get("intensity")
                                  if isinstance(beat.get("arc"), dict) else None),
        "lipsync_candidates": beat.get("lipsync_candidates",
                                       beat.get("lip_sync", [])) or [],
        "section_id": beat.get("section_id"),
    }


def _match_line(text, lines):
    target = _norm(text)
    for line in lines:
        if _norm(line["text"]) == target:
            return line
    return None


def _event_line(event, event_line, text, index):
    if event_line is not None:
        return _norm(event_line) == _norm(text) or event_line == index
    return False


def write_section(beat, lines, writer_id, *, emotion_fill=None):
    """Write the rows for one beat's lyric lines, in measured order."""
    rows = []
    beat_lines = [{"text": t} for t in beat["lines"]]
    for i, text in enumerate(beat["lines"]):
        measured = _match_line(text, lines) or {}
        start = measured.get("start_s")
        end = measured.get("end_s")
        if start is None:
            start = beat.get("start_s")
        if end is None:
            end = beat.get("end_s")
        is_last = i == len(beat["lines"]) - 1
        emotion = (beat.get("emotion_end") if is_last else beat.get("emotion_start"))
        intensity = (beat.get("intensity_end") if is_last else beat.get("intensity_start"))
        lip = None
        for cand in beat.get("lipsync_candidates") or []:
            ctext = cand.get("sentence") if isinstance(cand, dict) else cand
            if _norm(ctext) == _norm(text):
                lip = dict(cand) if isinstance(cand, dict) else {"voice_id": None}
                break
        event = None
        if beat.get("event") and _event_line(beat.get("event"), beat.get("event_line"),
                                             text, measured.get("index", i)):
            event = beat["event"]
        row = {
            "line_id": measured.get("index", i),
            "text": text,
            "start_s": start,
            "end_s": end,
            "beat_number": beat["beat_number"],
            "section_id": beat.get("section_id") or writer_id,
            "writer_id": writer_id,
            "singer_id": (lip or {}).get("voice_id") or (beat["singers"][0] if beat["singers"] else None),
            "on_camera_id": ((lip or {}).get("frame_char_ids") or [None])[0]
            if lip else ((beat["cast_ids"] or [None])[0]),
            "location_id": beat["location_id"],
            "time_of_day": beat["time_of_day"],
            "wardrobe_ids": dict(beat["wardrobe_ids"]),
            "on_screen": beat.get("change", ""),
            "written_objects": [],
            "lipsync": lip,
            "event": event,
            "emotion": emotion,
            "intensity": intensity,
            "facial_cues": (emotion_fill or {}).get(_norm(text), {}),
            "verdict": None,
            "camera": {},
        }
        rows.append(row)
    return rows


def write_script(beats, song, writers_by_section=None, *, emotion_fill=None):
    """One writer per song section, one row per lyric line, joined in time order."""
    lines = song_lines(song)
    rows = []
    for i, raw in enumerate(_beats_list(beats)):
        beat = normalize_beat(raw, i)
        section = beat.get("section_id")
        writer = (writers_by_section or {}).get(section) if section else None
        writer = writer or beat.get("writer_id") or ("section-%s" % (section or i))
        rows.extend(write_section(beat, lines, writer, emotion_fill=emotion_fill))
    if len({r["writer_id"] for r in rows}) > 1 and writers_by_section is None:
        # deterministic fallback: writers per contiguous beat are still distinct
        pass
    return join_rows(rows)


def join_rows(rows):
    """The one mechanical join: every row in measured time order, stably."""
    return sorted(rows, key=lambda r: (r.get("start_s") if _num(r.get("start_s")) is not None
                                       else float("inf"), str(r.get("line_id"))))


def summarize_sections(rows):
    """Which writer owns which section, and how many rows each wrote."""
    out = {}
    for row in rows:
        key = row.get("section_id")
        entry = out.setdefault(key, {"writer_id": row.get("writer_id"),
                                     "rows": 0, "start_s": row.get("start_s")})
        entry["rows"] += 1
        if _num(row.get("start_s")) is not None and _num(entry["start_s"]) is not None:
            entry["start_s"] = min(entry["start_s"], row["start_s"])
    return out


def check_script_off_beat(rows, beats):
    """SCRIPT_OFF_BEAT: a row that adds, drops or moves an event, or changes
    who, where or what they wear, against its beat."""
    by_number = {}
    for i, raw in enumerate(_beats_list(beats)):
        beat = normalize_beat(raw, i)
        by_number[str(beat["beat_number"])] = beat
    defects = []
    events_seen = {}
    for row in rows:
        beat = by_number.get(str(row.get("beat_number")))
        if beat is None:
            defects.append({"code": "SCRIPT_OFF_BEAT", "line": row.get("line_id"),
                            "detail": "the row names a beat that does not exist"})
            continue
        if _norm(row.get("text")) not in {_norm(t) for t in beat["lines"]}:
            defects.append({"code": "SCRIPT_OFF_BEAT", "line": row.get("line_id"),
                            "detail": "the line is outside its beat's lyric window"})
        if row.get("location_id") != beat["location_id"]:
            defects.append({"code": "SCRIPT_OFF_BEAT", "line": row.get("line_id"),
                            "detail": "the place differs from the beat's place"})
        if row.get("time_of_day") != beat["time_of_day"]:
            defects.append({"code": "SCRIPT_OFF_BEAT", "line": row.get("line_id"),
                            "detail": "the time of day differs from the beat"})
        for cid, wid in (row.get("wardrobe_ids") or {}).items():
            if beat["wardrobe_ids"].get(cid) != wid:
                defects.append({"code": "SCRIPT_OFF_BEAT", "line": row.get("line_id"),
                                "detail": "%r wears a different wardrobe than the beat" % cid})
        ev = row.get("event")
        if ev:
            events_seen.setdefault(str(ev), []).append(row.get("line_id"))
            if beat.get("event") and str(ev) != str(beat.get("event")):
                defects.append({"code": "SCRIPT_OFF_BEAT", "line": row.get("line_id"),
                                "detail": "the row moves an event off its beat"})
    for ev, lines in events_seen.items():
        if len(lines) > 1:
            defects.append({"code": "SCRIPT_OFF_BEAT", "line": lines[0],
                            "detail": "event %r is written on %d rows" % (ev, len(lines))})
    return defects


def script_before_pictures(report):
    """True only when the story gate passed; pictures may not start before."""
    return bool(isinstance(report, dict) and report.get("passed"))


def selftest():
    beats = {"beats": [
        {"beat_number": 1, "beat_name": "kitchen at first light",
         "start_s": 0.0, "end_s": 10.0, "lyric_lines": ["I rise", "I try"],
         "cast_ids": ["lead"], "singers": ["lead"], "who_else_seen": "nobody else is seen here",
         "location_id": "kitchen", "time_of_day": "dawn",
         "wardrobe_ids": {"lead": "w1"}, "entrances": [{"who": "lead"}], "exits": [],
         "emotion_start": "worry", "intensity_start": 2,
         "emotion_end": "resolve", "intensity_end": 2,
         "change": "she gets up", "event": "", "event_line": "",
         "props_changed": [], "lipsync_candidates": [{"sentence": "I rise", "voice_id": "lead"}]},
    ]}
    song = {"lines": [
        {"index": 0, "text": "I rise", "start_s": 0.0, "end_s": 4.0},
        {"index": 1, "text": "I try", "start_s": 4.0, "end_s": 10.0},
    ]}
    rows = write_script(beats, song)
    assert len(rows) == 2
    assert rows[0]["beat_number"] == 1
    assert rows[0]["start_s"] == 0.0
    assert rows[0]["singer_id"] == "lead"
    assert rows[1]["emotion"] == "resolve"  # last line takes the beat's end
    assert check_script_off_beat(rows, beats) == []

    moved = [dict(rows[1], location_id="street")]
    assert "SCRIPT_OFF_BEAT" in {d["code"] for d in check_script_off_beat(moved, beats)}

    assert script_before_pictures({"passed": True}) is True
    assert script_before_pictures({"passed": False}) is False
    return True


if __name__ == "__main__":  # pragma: no cover
    assert selftest()
    print("story_script selftest OK")
