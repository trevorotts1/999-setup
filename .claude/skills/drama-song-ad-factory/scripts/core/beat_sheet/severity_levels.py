"""beat_sheet.severity -- the three levels on the story checks and the review (N-99).

Section 3J: MINOR is counted, MEDIUM passes and is logged, MAJOR stops that one
item and repairs only it. The MAJOR list is fixed; the story checks own items 8
to 12 (a wrong singer, a story-logic break, a MISMATCH line, a missing required
scene or shot) and they gate the pictures. WEAK verdicts and the reviewer's
taste notes are MEDIUM: shown to the run owner, never fixed on their word.

The per-code table lives in beat_sheet._SEVERITY; this module is the one place
that turns a finding list into the two lists the run owner and the gate need.

Pure data checks. Stdlib only, no IO, no mutation.
"""
from __future__ import annotations

from .beat_sheet import MAJOR, MEDIUM, MINOR, severity


def annotate(finding):
    """One finding, with its 3J level and MAJOR item number filled in."""
    out = dict(finding)
    level = severity(out.get("code"))
    out["level"] = out.get("level") or level["level"]
    if out.get("item") is None:
        out["item"] = level["item"]
    return out


def annotate_all(findings):
    return [annotate(finding) for finding in (findings or [])
            if isinstance(finding, dict)]


def blocking(findings):
    """The findings that stop an item: MAJOR only (3J.1)."""
    return [found for found in annotate_all(findings) if found["level"] == MAJOR]


def pass_with_notes(findings):
    """MEDIUM and MINOR, logged for the run owner and never stopping a run."""
    return [found for found in annotate_all(findings) if found["level"] != MAJOR]


def gate_verdict(findings):
    """The story gate as the run reads it: blocked or passed, with the notes."""
    major = blocking(findings)
    return {
        "ok": not major,
        "blocking": major,
        "owner_notes": pass_with_notes(findings),
        "counts": {
            MAJOR: len(major),
            MEDIUM: sum(1 for f in annotate_all(findings) if f["level"] == MEDIUM),
            MINOR: sum(1 for f in annotate_all(findings) if f["level"] == MINOR),
        },
    }


def story_gate_codes():
    """The MAJOR codes the story checks and review may raise (items 8 to 12)."""
    from .beat_sheet import _SEVERITY

    return sorted(code for code, (level, item) in _SEVERITY.items()
                  if level == MAJOR and item in (8, 9, 10, 11, 12))


def _selfcheck():
    assert annotate({"code": "MISMATCH"})["level"] == MAJOR
    assert annotate({"code": "WEAK"})["level"] == MEDIUM
    assert annotate({"code": "TASTE_NOTE"})["level"] == MEDIUM
    assert annotate({"code": "NOT_ON_THE_LIST"})["level"] == MEDIUM
    verdict = gate_verdict([{"code": "MISMATCH"}, {"code": "WEAK"}])
    assert verdict["ok"] is False and len(verdict["blocking"]) == 1
    assert len(verdict["owner_notes"]) == 1
    codes = story_gate_codes()
    for expected in ("WRONG_SINGER", "DOUBLE_ENTRANCE", "MISMATCH",
                     "OPENING_MISSING", "SHOT_OFF_BEAT"):
        assert expected in codes, expected


if __name__ == "__main__":
    _selfcheck()
    print("beat_sheet.severity_levels selfcheck: OK")
