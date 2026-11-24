"""beat_sheet.story_script_checks -- the checks on the joined story script.

Plan 3F.2: every lyric line gets MATCH, WEAK or MISMATCH against its on-screen
row; any MISMATCH blocks, and WEAK lines are capped at one in five. An event the
lyrics name happens once, on the line that names it, and nothing is buried under
a lip-sync piece (3F.2 "Nothing buried", N-54).

Rows are the beat-sheet rows: ``line_id``, ``beat_number``, ``start_s``,
``end_s``, ``line``, ``who_sings``, ``on_screen``, ``lip_sync``,
``line_match``, plus the event a row carries as ``event`` / ``event_line``.

Pure data checks. Stdlib only, no IO, no model call, no mutation.
"""
from __future__ import annotations

from .beat_sheet import LINE_MATCH_VERDICTS, _defect, _norm

#: one WEAK line in five is the ceiling the run owner is shown (3F.2)
WEAK_ONE_IN = 5


def _rows(rows):
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _row_label(row, index):
    return row.get("line_id") or row.get("row_id") or index


def line_match_defects(rows):
    """MATCH, WEAK or MISMATCH for every lyric line; MISMATCH blocks (N-66)."""
    defects = []
    clean = _rows(rows)
    weak = 0
    for index, row in enumerate(clean):
        label = _row_label(row, index)
        verdict = row.get("line_match")
        if verdict not in LINE_MATCH_VERDICTS:
            defects.append(_defect(
                "LINE_MATCH_MISSING", "/script-rows/%d/line_match" % index,
                "line %r has no MATCH, WEAK or MISMATCH verdict" % (label,),
                line_id=label))
            continue
        if verdict == "MISMATCH":
            defects.append(_defect(
                "MISMATCH", "/script-rows/%d/line_match" % index,
                "line %r is unrelated to or contradicts its on-screen row" % (label,),
                line_id=label))
        elif verdict == "WEAK":
            weak += 1
    ceiling = max(1, len(clean) // WEAK_ONE_IN)
    if weak > ceiling:
        defects.append(_defect(
            "WEAK_CAP_EXCEEDED", "/script-rows",
            "%d WEAK lines; at most one in five (%d here) is allowed" % (weak, ceiling)))
    return defects


def _row_line(row):
    value = row.get("line")
    if value is None:
        value = row.get("text")
    return _norm(value)


def event_placement_defects(rows):
    """One event, one lyric; nothing buried under a lip-sync piece (N-66)."""
    defects = []
    clean = _rows(rows)
    seen = {}
    for index, row in enumerate(clean):
        event = row.get("event")
        name = None
        if isinstance(event, dict):
            name = _norm(event.get("kind") or event.get("name"))
        elif isinstance(event, str):
            name = _norm(event)
        if not name:
            continue
        label = _row_label(row, index)
        seen.setdefault(name, []).append(index)
        own = _norm(row.get("event_line"))
        if not own:
            own = _norm(event.get("line")) if isinstance(event, dict) else ""
        if own and own != _row_line(row):
            defects.append(_defect(
                "EVENT_OFF_LYRIC", "/script-rows/%d/event" % index,
                "the event %r is not on the line that names it" % (name,),
                line_id=label))
        if row.get("lip_sync") is True:
            defects.append(_defect(
                "EVENT_UNDER_LIP_WINDOW", "/script-rows/%d" % index,
                "the event %r sits under a lip-sync piece" % (name,),
                line_id=label))
    for name, indexes in seen.items():
        if len(indexes) > 1:
            defects.append(_defect(
                "EVENT_REPEATED", "/script-rows",
                "the event %r happens %d times; it happens once" % (name, len(indexes))))
    return defects


def script_row_defects(rows):
    """Both 3F.2 row checks as one ordered finding list."""
    return line_match_defects(rows) + event_placement_defects(rows)


def _selfcheck():
    rows = [
        {"line_id": "L1", "line": "the bill is on the table", "line_match": "MATCH",
         "event": {"kind": "bill"}, "event_line": "the bill is on the table"},
        {"line_id": "L2", "line": "she picks up the phone", "line_match": "WEAK"},
    ]
    assert script_row_defects(rows) == []
    bad = [dict(rows[0], line_match="MISMATCH"), rows[1]]
    codes = {d["code"] for d in script_row_defects(bad)}
    assert "MISMATCH" in codes
    buried = [dict(rows[0], lip_sync=True)]
    assert "EVENT_UNDER_LIP_WINDOW" in {d["code"] for d in script_row_defects(buried)}
    again = [rows[0], dict(rows[1], event={"kind": "bill"}, event_line="she picks up the phone")]
    assert "EVENT_REPEATED" in {d["code"] for d in script_row_defects(again)}
    assert script_row_defects([{"line_id": "L9"}])[0]["code"] == "LINE_MATCH_MISSING"


if __name__ == "__main__":
    _selfcheck()
    print("beat_sheet.story_script_checks selfcheck: OK")
