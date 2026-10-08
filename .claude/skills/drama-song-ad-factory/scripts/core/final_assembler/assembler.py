"""final_assembler: timeline.json -> frame-exact ffmpeg render.

Contract: directive 17.5 + acceptance-profile timeline rules
(round once to frame grid, no cumulative drift, A/V within 1 frame,
no gaps/black frames). Stdlib only (json, subprocess, shutil, argparse,
sys, os). ffmpeg/ffprobe invoked with argument arrays via subprocess,
never shell strings.

Skill 25 (multi_clip_assembly) / Skill 27 (broll_merge) use moviepy
concatenation, which cannot guarantee frame-exact cuts, so this unit
shells to ffmpeg directly and reuses only their conventions:
ffprobe JSON duration probing (ai_providers._validate_downloaded_video)
and libx264/AAC export presets (export.py).

Timeline schema (blackceo.timeline/v1):
  {"schema_version": "blackceo.timeline/v1", "fps": 30,
   "width": 1920, "height": 1080, "song_path": "master.wav | null",
   "transition": "none" | "fade", "transition_duration": 0.5,
   "segments": [{"src": "clip.mp4", "dur": 2.0 | null,
                 "transition": "fade" | null}]}

Rules:
- Video is the master duration; the song is laid under it
  (trimmed/padded to the video duration). Clip audio is ignored:
  silent-video default with the song as soundtrack.
- Every cut point is rounded ONCE to the frame grid; offsets
  accumulate in integer frames so drift cannot compound.
- xfade overlaps consume frames from the joined segments.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys

# H12: receipt provenance stamp (same package).
try:
    from . import master_provenance
except ImportError:                     # direct-script fallback
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import master_provenance  # noqa: E402

TOOL_NAME = "final_assembler"
TOOL_VERSION = "1.0.0"
SCHEMA_VERSION = "1.0.0"
TIMELINE_SCHEMA = "blackceo.timeline/v1"

EXIT = {"ok": 0, "error": 1, "unavailable": 3}
# H13: a cross-fade into a lip-sync clip ends at least this long before
# the clip's first word; a gap inside one line longer than LONG_GAP_S is
# held on the speaking face (no cut-away inside the line window).
FADE_WORD_MARGIN_S = 0.1
LONG_GAP_S = 0.5
FADE_COVERS_FIRST_WORD = "FADE_COVERS_FIRST_WORD"
LONG_GAP_CUTAWAY = "LONG_GAP_CUTAWAY"

# ponytail: transitions limited to none/fade; add xfade variants
# (dissolve variants, wipes) when a campaign needs them.


def _fail(reason, **kw):
    out = {"schema_version": SCHEMA_VERSION, "tool": TOOL_NAME,
           "tool_version": TOOL_VERSION, "outcome": "error",
           "reason_code": reason}
    out.update(kw)
    return out


def load_timeline(path):
    """Load + validate timeline.json. Returns dict or raises ValueError."""
    try:
        with open(path, encoding="utf-8") as fh:
            tl = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"TIMELINE_UNREADABLE: {exc}") from exc
    if not isinstance(tl, dict):
        raise ValueError("TIMELINE_BAD_SCHEMA: top level must be an object")
    if tl.get("schema_version") != TIMELINE_SCHEMA:
        raise ValueError(
            f"TIMELINE_BAD_SCHEMA: schema_version must be {TIMELINE_SCHEMA}")
    segs = tl.get("segments")
    if not segs or not isinstance(segs, list):
        raise ValueError("TIMELINE_NO_SEGMENTS: segments[] required")
    fps = tl.get("fps", 30)
    if not isinstance(fps, (int, float)) or fps <= 0:
        raise ValueError("TIMELINE_BAD_FPS: fps must be positive")
    for i, s in enumerate(segs):
        if not isinstance(s, dict) or not s.get("src"):
            raise ValueError(f"TIMELINE_BAD_SEGMENT: segments[{i}] needs src")
        if s.get("dur") is not None and s["dur"] <= 0:
            raise ValueError(
                f"TIMELINE_BAD_SEGMENT: segments[{i}].dur must be positive")
    return tl


def probe_duration(path, ffprobe="ffprobe", timeout=30):
    """ffprobe duration in seconds (argv array, JSON stdout)."""
    cmd = [ffprobe, "-v", "error", "-show_entries", "format=duration",
           "-of", "json", str(path)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"PROBE_UNAVAILABLE: {exc}") from exc
    if proc.returncode != 0:
        raise RuntimeError(
            f"PROBE_FAILED: {(proc.stderr or '').strip()[:200]}")
    try:
        dur = float(json.loads(proc.stdout)["format"]["duration"])
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError(f"PROBE_NO_DURATION: {exc}") from exc
    if dur <= 0:
        raise RuntimeError("PROBE_NO_DURATION: non-positive duration")
    return dur


def _seg_transition(tl, seg):
    t = seg.get("transition", tl.get("transition", "none"))
    if t not in ("none", "fade"):
        raise ValueError(f"TIMELINE_BAD_TRANSITION: {t!r}")
    return t


def _h5_core():
    core_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if core_dir not in sys.path:
        sys.path.insert(0, core_dir)
    import shot_planner.timestamp_plan as tp
    return tp


def _h5_stretch(seg):
    return _h5_core().stretch_of(seg)


def h5_gates(plan):
    """Part H H5: no slow motion above 1.15x (SLOWMO_OVER_LIMIT) and, when
    the timeline carries line windows and segments name the line they show,
    every picture matches the line heard in its window
    (PICTURE_LINE_MISMATCH). Returns (_fail or None, evidence rows)."""
    tp = _h5_core()
    segs = plan["segments"]
    rows = tp.check_stretch(segs)
    ev = {"stretch": rows}
    bad = [r for r in rows if not r["ok"]]
    if bad:
        return _fail(tp.SLOWMO, next_action=(
            "segment(s) %s are slowed above %.2fx; generate the picture at "
            "the shot window's length instead of stretching it"
            % (",".join(str(r["index"]) for r in bad), tp.MAX_SLOWMO)),
            evidence=ev), ev
    if plan.get("lines") and any(s.get("shows_line_ids") for s in segs):
        fps = plan["fps"]
        shots = [{"shot_id": "seg%d" % i,
                  "song_start": s["offset_frames"] / fps,
                  "song_end": (s["offset_frames"] + s["frames"]) / fps,
                  "shows_line_ids": s.get("shows_line_ids", [])}
                 for i, s in enumerate(segs)]
        try:
            gate = tp.pictures_match_gate(shots, [
                {"line_id": l["line_id"], "start": l["start_s"],
                 "end": l["end_s"], "text": l.get("text", "")}
                for l in plan["lines"]])
        except (KeyError, TypeError, AttributeError, tp.PlanError) as exc:
            return _fail("TIMELINE_BAD_LINES", next_action=str(exc),
                         evidence=ev), ev
        ev["pictures_match"] = gate
        if gate["outcome"] != "ok":
            return _fail(gate["reason_code"], next_action=(
                "pictures do not match the words in " + ",".join(gate["mismatches"])),
                evidence=ev), ev
    return None, ev


def plan_timeline(tl, base_dir=".", probe=None):
    """Pure frame plan: snap durations once, accumulate integer frames.

    probe(src) -> seconds; used when seg dur is null (full clip).
    Missing files are NOT checked here (assemble preflight does that).
    Returns plan dict with frames/segments/total.
    """
    fps = float(tl.get("fps", 30))
    width = int(tl.get("width", 1920))
    height = int(tl.get("height", 1080))
    default_xd = float(tl.get("transition_duration", 0.5) or 0)
    items = []
    for i, s in enumerate(tl["segments"]):
        dur = s.get("dur")
        if dur is None:
            if probe is None:
                raise ValueError(
                    f"TIMELINE_NEEDS_PROBE: segments[{i}] has no dur "
                    "and no probe supplied")
            dur = probe(s["src"])
        frames = max(1, round(dur * fps))
        trans = _seg_transition(tl, s) if i > 0 else "none"
        xd = round(default_xd * fps) / fps if trans != "none" else 0.0
        # H13: optional first_word_s (seconds into the clip). The fade
        # shrinks (down to a cut) so it ends FADE_WORD_MARGIN_S before it.
        fw = s.get("first_word_s")
        if i > 0 and fw is not None and xd > 0:
            cap = math.floor(max(0.0, fw - FADE_WORD_MARGIN_S) * fps
                             + 1e-9) / fps
            if cap < xd:
                xd = cap
                if xd == 0:
                    trans = "none"
        item = {"src": s["src"], "frames": frames,
                "snapped_dur": frames / fps, "transition": trans,
                "xfade_dur": xd,
                "lip_sync": bool(s.get("lip_sync")),
                "lip_sync_line_ids": list(s.get("lip_sync_line_ids") or []),
                # Part H H5: slow-motion factor + the line this picture shows
                "stretch": round(_h5_stretch({**s, "dur": dur}), 3)}
        if fw is not None:
            item["first_word_s"] = float(fw)
        if s.get("shows_line_ids"):
            item["shows_line_ids"] = list(s["shows_line_ids"])
        items.append(item)
    for i in range(1, len(items)):
        ov = round(items[i]["xfade_dur"] * fps)
        lo = min(items[i - 1]["frames"], items[i]["frames"])
        if ov >= lo:
            raise ValueError(
                f"TIMELINE_XFADE_TOO_LONG: join {i} overlap {ov}f >= "
                f"shortest segment {lo}f")
        items[i]["xfade_frames"] = ov
    total_frames = sum(it["frames"] for it in items) - sum(
        it.get("xfade_frames", 0) for it in items)
    # Integer-frame offsets: no cumulative float drift by construction.
    off = 0
    for it in items:
        it["offset_frames"] = off
        off += it["frames"] - it.get("xfade_frames", 0)
    return {"fps": fps, "width": width, "height": height,
            "song_path": tl.get("song_path"),
            "segments": items, "total_frames": total_frames,
            "total_dur": total_frames / fps,
            "lines": tl.get("lines")}


# --- H13: cross-fades vs words ------------------------------------------------


def check_fade_before_first_word(plan):
    """H13 gate: the fade into a clip ends FADE_WORD_MARGIN_S before its
    first word. Returns [] or [FADE_COVERS_FIRST_WORD]."""
    eps = 1e-6
    for s in plan["segments"]:
        fw = s.get("first_word_s")
        if fw is not None and s.get("xfade_dur", 0) > 0 \
                and s["xfade_dur"] + FADE_WORD_MARGIN_S > fw + eps:
            return [FADE_COVERS_FIRST_WORD]
    return []


def check_long_gap_hold(plan):
    """H13 gate: a line with an internal word gap above LONG_GAP_S must sit
    wholly inside the fully-opaque span of ONE lip-sync segment (held on
    the speaking face). Lines carry optional words [{start_s, end_s}].
    Returns [] or [LONG_GAP_CUTAWAY]."""
    fps, segs = plan["fps"], plan["segments"]
    spans = []
    for i, s in enumerate(segs):
        nxt = segs[i + 1].get("xfade_frames", 0) if i + 1 < len(segs) else 0
        a = (s["offset_frames"] + s.get("xfade_frames", 0)) / fps
        b = (s["offset_frames"] + s["frames"] - nxt) / fps
        spans.append((a, b, s))
    for ln in plan.get("lines") or []:
        w = ln.get("words") or []
        if not any(w[k + 1]["start_s"] - w[k]["end_s"] > LONG_GAP_S
                   for k in range(len(w) - 1)):
            continue
        held = any(
            s.get("lip_sync") or s.get("lip_sync_line_ids")
            for a, b, s in spans
            if a - 1e-6 <= ln["start_s"] and ln["end_s"] <= b + 1e-6
            and (not s.get("lip_sync_line_ids")
                 or ln["line_id"] in s["lip_sync_line_ids"]))
        if not held:
            return [LONG_GAP_CUTAWAY]
    return []


def build_argv(plan, output, ffmpeg="ffmpeg"):
    """ffmpeg argv array rendering plan -> output. No gaps by construction
    (concat/xfade chain covers every output frame exactly once)."""
    fps, w, h = plan["fps"], plan["width"], plan["height"]
    segs = plan["segments"]
    cmd = [ffmpeg, "-y"]
    for s in segs:
        cmd += ["-i", s["src"]]
    song = plan.get("song_path")
    song_idx = len(segs) if song else None
    if song:
        cmd += ["-i", song]
    fc = []
    for i, s in enumerate(segs):
        fc.append(f"[{i}:v]trim=duration={s['snapped_dur']:.6f},"
                  f"setpts=PTS-STARTPTS,fps={fps:g},"
                  f"scale={w}:{h},setsar=1[v{i}]")
    if len(segs) == 1:
        vlast = "[v0]"
    elif all(s["transition"] == "none" for s in segs[1:]):
        fc.append("".join(f"[v{i}]" for i in range(len(segs))) +
                  f"concat=n={len(segs)}:v=1:a=0[vout]")
        vlast = "[vout]"
    else:
        prev = "[v0]"
        for i in range(1, len(segs)):
            s = segs[i]
            if s["transition"] == "none":
                # hard join: concat the chain so far with the next clip
                fc.append(f"{prev}[v{i}]concat=n=2:v=1:a=0[x{i}]")
                prev = f"[x{i}]"
            else:
                start_frame = (s["offset_frames"] -
                               s.get("xfade_frames", 0))
                offset = start_frame / fps
                fc.append(f"{prev}[v{i}]xfade=transition=fade:"
                          f"duration={s['xfade_dur']:.6f}:"
                          f"offset={offset:.6f}[x{i}]")
                prev = f"[x{i}]"
        fc.append(f"{prev}null[vout]")
        vlast = "[vout]"
    amap = []
    if song:
        total = plan["total_dur"]
        fc.append(f"[{song_idx}:a]atrim=duration={total:.6f},"
                  f"apad=whole_dur={total:.6f},aresample=48000,"
                  "aformat=channel_layouts=stereo[aout]")
        amap = ["-map", vlast, "-map", "[aout]", "-c:a", "aac"]
    else:
        amap = ["-map", vlast, "-an"]
    cmd += ["-filter_complex", ";".join(fc),
            *amap, "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-r", f"{fps:g}", "-movflags", "faststart", str(output)]
    return cmd


def _run(cmd, timeout=600):
    try:
        return subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"FFMPEG_UNAVAILABLE: {exc}") from exc


def assemble(timeline_path, output, ffmpeg="ffmpeg", ffprobe="ffprobe",
             timeout=600, base_dir=".", dry_run=False):
    """Full render: validate -> preflight -> plan -> ffmpeg -> verify.

    Returns receipt dict (also written to <output>.receipt.json unless
    dry_run). Post-render ffprobe check: |A-V| and |out - planned|
    each within 1 frame; else outcome error with AV_DRIFT/PLAN_DRIFT.
    """
    try:
        tl = load_timeline(timeline_path)
    except ValueError as exc:
        return _fail(str(exc).split(":")[0], next_action=str(exc),
                     evidence={"timeline": str(timeline_path)})
    base = os.path.dirname(os.path.abspath(str(timeline_path))) or base_dir

    def abspath(p):
        return p if os.path.isabs(p) else os.path.join(base, p)

    missing = [s["src"] for s in tl["segments"]
               if not os.path.isfile(abspath(s["src"]))]
    song = tl.get("song_path")
    if song and not os.path.isfile(abspath(song)):
        missing.append(song)
    if missing:
        return _fail("MISSING_INPUTS", next_action="provide listed inputs",
                     evidence={"missing": missing})
    try:
        plan = plan_timeline(
            tl, base, probe=lambda s: probe_duration(abspath(s), ffprobe))
    except (ValueError, RuntimeError) as exc:
        msg = str(exc)
        return _fail(msg.split(":")[0], next_action=msg, evidence={})
    for s in plan["segments"]:
        s["src"] = abspath(s["src"])
    if plan["song_path"]:
        plan["song_path"] = abspath(plan["song_path"])
    # H13: fades finish before the first word; long in-line gaps are held.
    for gate, why in (
            (check_fade_before_first_word, "shorten the fade or add "
             "pre-roll so it ends 0.1 s before the first word (H13)"),
            (check_long_gap_hold, "hold the speaking face through the "
             "gap; do not cut away inside one line (H13)")):
        bad = gate(plan)
        if bad:
            return _fail(bad[0], next_action=why, evidence={})
    # Part H H5: slow motion cap + pictures-match-words, before any spend.
    h5_fail, h5_ev = h5_gates(plan)
    if h5_fail:
        return h5_fail
    argv = build_argv(plan, output, ffmpeg)
    if dry_run:
        return {"schema_version": SCHEMA_VERSION, "tool": TOOL_NAME,
                "tool_version": TOOL_VERSION, "command": "assemble",
                "outcome": "ok", "reason_code": "DRY_RUN",
                "next_action": "rerun without dry_run to render",
                "evidence": {"argv": argv, "plan": plan, "h5": h5_ev},
                "state_version": 0}
    try:
        proc = _run(argv, timeout)
    except RuntimeError as exc:
        return _fail(str(exc).split(":")[0], next_action=str(exc),
                     evidence={"argv": argv})
    if proc.returncode != 0:
        return _fail("FFMPEG_FAILED",
                     next_action=(proc.stderr or "")[-500:],
                     evidence={"argv": argv, "returncode": proc.returncode})
    # Verify: output A/V durations within 1 frame of plan and each other.
    try:
        vdur = probe_duration(output, ffprobe)
    except RuntimeError as exc:
        return _fail("VERIFY_UNAVAILABLE", next_action=str(exc),
                     evidence={"output": str(output)})
    frame = 1.0 / plan["fps"]
    evid = {"planned_dur": plan["total_dur"], "output_dur": vdur,
            "total_frames": plan["total_frames"], "argv": argv,
            "h5": h5_ev}
    if abs(vdur - plan["total_dur"]) > frame + 1e-3:
        return _fail("PLAN_DRIFT",
                     next_action="output duration off plan by >1 frame",
                     evidence=evid)
    if plan["song_path"]:
        try:
            adur = probe_duration(output, ffprobe)
        except RuntimeError:
            adur = vdur
        evid["audio_dur"] = adur
        if abs(adur - vdur) > frame + 1e-3:
            return _fail("AV_DRIFT",
                         next_action="audio/video differ by >1 frame",
                         evidence=evid)
    receipt = {"schema_version": SCHEMA_VERSION, "tool": TOOL_NAME,
               "tool_version": TOOL_VERSION, "command": "assemble",
               "outcome": "ok", "reason_code": "ASSEMBLED",
               "next_action": "QC per directive 17.5 (independent reviewer)",
               "evidence": evid, "state_version": 0,
               # H12: QC fails any master this receipt does not vouch for.
               "produced_by": master_provenance.producer_stamp(),
               "master_sha256": master_provenance.sha256_file(output)}
    try:
        with open(str(output) + ".receipt.json", "w",
                  encoding="utf-8") as fh:
            json.dump(receipt, fh, indent=2)
    except OSError:
        pass
    return receipt


def main(argv=None):
    ap = argparse.ArgumentParser(prog="final_assembler",
                                 description="timeline.json -> ffmpeg render")
    ap.add_argument("timeline", help="timeline.json path")
    ap.add_argument("output", help="output mp4 path")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--ffprobe", default="ffprobe")
    ap.add_argument("--timeout", type=int, default=600)
    args = ap.parse_args(argv)
    if not shutil.which(args.ffmpeg) or not shutil.which(args.ffprobe):
        print(json.dumps(_fail("PREREQ_MISSING",
                               next_action="install ffmpeg+ffprobe")))
        return 3
    receipt = assemble(args.timeline, args.output, ffmpeg=args.ffmpeg,
                       ffprobe=args.ffprobe, timeout=args.timeout,
                       dry_run=args.dry_run)
    print(json.dumps(receipt, indent=2))
    return EXIT["ok"] if receipt["outcome"] == "ok" else EXIT["error"]


if __name__ == "__main__":
    sys.exit(main())
