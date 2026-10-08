"""picture_gate.py: measured close-up gate + sha256 receipt (LPG001, LPG002).

Why: the 30-Day Reset close-up (face 28% of frame, smile 0.62) and the Perfect
Daughter close-up (face 34%, teeth, roll -7.8 deg) went to paid Kling lip-sync
unmeasured. The check existed on paper only. Now:

  gate_picture(path)   measure -> ONE free local crop if the face is small ->
                       up to MAX_PAID_REGENS paid regenerations for smile /
                       teeth / tilt -> receipt per picture tried -> refuse.
  make_regenerate()    the default paid regeneration: gpt-image-2
                       image-to-image from the 3D character, dispatched
                       through kie_dispatch (ledger + cap + load_governor).
  upload_measured()    uploads the exact measured bytes (hashed at upload
                       time, refused on mismatch) and binds the URL to them.
  require_receipt()    the kie_dispatch hard block: no PASS receipt for the
                       exact bytes (sha256), or an image_url that is not the
                       bound upload of those bytes = no paid lip-sync job.

Fail closed everywhere: mediapipe missing, face model missing, unreadable image,
0 or 2+ faces, any number over its limit -> verdict FAIL / refusal.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import time

try:
    from . import picture_measure as PM
except ImportError:                    # script import (tests run from here)
    import picture_measure as PM

TOOL_NAME = "lipsync_picture_gate"
SCHEMA = "blackceo.lipsync-picture-receipt/v1"

# ============================================================================
# ONE constants block. Same names, same values in onboarding and 999-setup.
# Evidence: 30-Day original 28.1% / smile 0.62 FAIL; Perfect Daughter original
# 34.4% / roll -7.8 / smile 0.83 FAIL; Perfect Daughter fix 37.8% / roll -4.3 /
# smile 0.36 PASS; 30-Day crop 36.8% / smile 0.59 PASS.
# ============================================================================
REQUIRED_FACE_COUNT = 1
MIN_FACE_HEIGHT_PCT = 35.0      # forehead(10)-chin(152) as % of frame height
MAX_FACE_HEIGHT_PCT = None      # no upper limit unless proven needed
MAX_ABS_ROLL_DEG = 5.0
MAX_ABS_YAW = 0.12
MAX_SMILE = 0.60
MAX_JAW_OPEN = 0.15
MAX_LIP_GAP_PCT = 1.0           # lip gap / face height (the teeth check)
MIN_SHARPNESS = 100.0           # Laplacian variance, face crop 256 px wide
CROP_TARGET_FACE_PCT = 38.0     # the free crop aims here
MAX_FREE_CROPS = 1              # one free local crop for a small face
MAX_PAID_REGENS = 2             # Trevor's 2-try rule, then refuse
REGEN_MODEL = "gpt-image-2-image-to-image"
REGEN_PROMPT = "neutral expression, lips closed, facing camera, head level"
# ============================================================================

# failures a paid regeneration can fix (smile, teeth, tilt, plus their kin)
REGEN_CODES = frozenset({"SMILE", "TEETH", "HEAD_ROLL", "HEAD_YAW", "MOUTH_OPEN"})

REFUSED = "LIPSYNC_PICTURE_NOT_GATED"


class LipsyncPictureNotGated(Exception):
    """kie_dispatch refuses the paid lip-sync job. .reason is the full text."""

    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def check_numbers(n):
    """Pure rules. n = picture_measure.measure() dict -> list of (code, text)."""
    r = []
    c = n.get("face_count")
    if c != REQUIRED_FACE_COUNT:
        return [("FACE_COUNT", "%s faces found; exactly %d is required"
                 % (c, REQUIRED_FACE_COUNT))]

    def num(key):
        v = n.get(key)
        ok = isinstance(v, (int, float)) and not isinstance(v, bool) and v == v
        if not ok:
            r.append(("UNMEASURED", "%s not measured" % key))
        return v if ok else None

    v = num("face_h_pct")
    if v is not None and (v < MIN_FACE_HEIGHT_PCT or (
            MAX_FACE_HEIGHT_PCT is not None and v > MAX_FACE_HEIGHT_PCT)):
        r.append(("FACE_SIZE", "face is %s%% of frame height; need at least %g%%"
                  % (v, MIN_FACE_HEIGHT_PCT)))
    for code, key, lim, label in (
            ("HEAD_ROLL", "roll_deg", MAX_ABS_ROLL_DEG, "head roll deg"),
            ("HEAD_YAW", "yaw_proxy", MAX_ABS_YAW, "yaw proxy")):
        v = num(key)
        if v is not None and abs(v) > lim:
            r.append((code, "%s %s is over the limit %s" % (label, v, lim)))
    for code, key, lim, label in (
            ("SMILE", "smile", MAX_SMILE, "smile blendshape"),
            ("MOUTH_OPEN", "jaw_open", MAX_JAW_OPEN, "jawOpen blendshape"),
            ("TEETH", "inner_gap_pct", MAX_LIP_GAP_PCT, "lip gap % of face height")):
        v = num(key)
        if v is not None and v > lim:
            r.append((code, "%s %s is over the limit %s" % (label, v, lim)))
    v = num("sharp_face_256")
    if v is not None and v < MIN_SHARPNESS:
        r.append(("SOFT", "sharpness %s is below the limit %s" % (v, MIN_SHARPNESS)))
    return r


def write_receipt(path, sha, verdict, numbers, reasons, attempts, receipt_dir):
    os.makedirs(receipt_dir, exist_ok=True)
    rec = {"schema": SCHEMA, "tool": TOOL_NAME, "image": os.path.abspath(path),
           "sha256": sha, "verdict": verdict, "numbers": numbers,
           "reasons": [list(x) for x in reasons], "attempts": attempts,
           "limits": {"face_count": REQUIRED_FACE_COUNT,
                      "face_h_pct_min": MIN_FACE_HEIGHT_PCT,
                      "face_h_pct_max": MAX_FACE_HEIGHT_PCT,
                      "roll_deg_abs": MAX_ABS_ROLL_DEG, "yaw_abs": MAX_ABS_YAW,
                      "smile": MAX_SMILE, "jaw_open": MAX_JAW_OPEN,
                      "lip_gap_pct": MAX_LIP_GAP_PCT, "sharpness_min": MIN_SHARPNESS},
           "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    p = os.path.join(receipt_dir, sha + ".json")
    with open(p, "w") as f:
        json.dump(rec, f, indent=1, sort_keys=True)
    return rec


def default_receipt_dir(path):
    return os.path.join(os.path.dirname(os.path.abspath(path)), ".lipgate")




def _measure_all(cur, measure):
    try:
        nums = measure(cur)
        return nums, check_numbers(nums)
    except PM.PictureGateUnavailable as exc:
        return {}, [("GATE_UNAVAILABLE", str(exc))]
    except Exception as exc:                               # fail closed
        return {}, [("MEASURE_ERROR", "%s: %s" % (type(exc).__name__, exc))]


def gate_picture(path, receipt_dir=None, measure=None, crop=None,
                 regenerate=None, max_regens=MAX_PAID_REGENS):
    """Measure one close-up; fix it; write a receipt per picture tried.
    Returns {"verdict", "image", "sha256", "numbers", "reasons", "attempts"}
    for the FINAL picture (its path is "image"; use it, not the input).

    Auto-fix, in this order:
      1. ONE free local crop (MAX_FREE_CROPS) when the face is too small.
      2. Up to MAX_PAID_REGENS paid regenerations when smile / teeth / tilt
         (REGEN_CODES) fail. regenerate(path, prompt) -> new_path. Use
         make_regenerate(): it goes through kie_dispatch (ledger, author cap,
         load_governor.kie_request). None = no paid fix.
      3. Then refuse (verdict FAIL).
    measure(path) -> numbers      default picture_measure.measure
    crop(path, out) -> out|None   default picture_measure.crop_to_face (free)
    """
    measure = measure or PM.measure
    crop = crop or (lambda p, o: PM.crop_to_face(p, o, CROP_TARGET_FACE_PCT))
    rdir = receipt_dir or default_receipt_dir(path)
    attempts, cur, crops, regens = [], path, 0, 0
    while True:
        sha = sha256_file(cur)
        nums, reasons = _measure_all(cur, measure)
        codes = {c for c, _ in reasons}
        verdict = "FAIL" if reasons else "PASS"
        attempts.append({"image": cur, "sha256": sha, "numbers": nums,
                         "verdict": verdict, "reasons": [list(x) for x in reasons]})
        rec = write_receipt(cur, sha, verdict, nums, reasons, attempts, rdir)
        if verdict == "PASS" or codes & {"GATE_UNAVAILABLE", "MEASURE_ERROR",
                                         "FACE_COUNT", "UNMEASURED"}:
            return dict(rec, image=cur)
        small = "FACE_SIZE" in codes and nums.get("face_h_pct", 100) < MIN_FACE_HEIGHT_PCT
        if small and crops < MAX_FREE_CROPS:
            crops += 1                                      # free, local, once
            out = os.path.splitext(cur)[0] + "-crop.png"
            try:
                made = crop(cur, out)
            except Exception:                               # cannot crop: no free fix
                made = None
            if made:
                cur = made
                continue
        if regenerate is None or regens >= max_regens or not codes & REGEN_CODES:
            return dict(rec, image=cur)
        regens += 1                                          # paid, capped
        try:
            cur = regenerate(cur, REGEN_PROMPT)
        except Exception as exc:                             # refuse, loudly
            rec = dict(rec, image=cur, reasons=rec["reasons"] + [
                ["REGEN_FAILED", "%s: %s" % (type(exc).__name__, exc)]])
            return rec


def require_receipt(path, receipt_dir=None):
    """The dispatcher block. Returns the receipt, or raises
    LipsyncPictureNotGated naming exactly what is wrong."""
    if not isinstance(path, str) or not path or not os.path.isfile(path):
        raise LipsyncPictureNotGated(
            "%s: lip-sync source picture is not a readable local file (%r); "
            "run gate_picture() on it first" % (REFUSED, path))
    sha = sha256_file(path)
    rp = os.path.join(receipt_dir or default_receipt_dir(path), sha + ".json")
    try:
        with open(rp) as f:
            rec = json.load(f)
    except (OSError, ValueError):
        raise LipsyncPictureNotGated(
            "%s: no gate receipt for %s (sha256 %s); measure it with "
            "gate_picture() before any paid lip-sync job" % (REFUSED, path, sha[:12]))
    if (rec.get("sha256") != sha or rec.get("verdict") != "PASS"
            or check_numbers(rec.get("numbers") or {})):
        raise LipsyncPictureNotGated(
            "%s: receipt for %s is %s, not PASS (%s)" % (
                REFUSED, path, rec.get("verdict"),
                "; ".join("%s: %s" % tuple(x) for x in rec.get("reasons", []))))
    return rec


# --- bind the upload to the measured bytes ----------------------------------

def _binding_path(sha, receipt_dir):
    return os.path.join(receipt_dir, sha + ".upload.json")


def upload_measured(path, uploader=None, receipt_dir=None):
    """Upload the EXACT measured picture and bind the URL to its sha256.
    The bytes are copied once to a private file, hashed at that moment, and the
    copy is what gets uploaded; a hash that differs from the PASS receipt
    refuses. uploader(file) -> https URL (default: adapter_uploader()).
    Returns the URL to put in the Kling request as input.image_url."""
    rec = require_receipt(path, receipt_dir)
    rdir = receipt_dir or default_receipt_dir(path)
    tmp = tempfile.mkdtemp(prefix="lipgate-up-")
    try:
        copy = os.path.join(tmp, os.path.basename(path))
        shutil.copyfile(path, copy)
        got = sha256_file(copy)
        if got != rec["sha256"]:
            raise LipsyncPictureNotGated(
                "%s: the file changed between measuring and upload (receipt "
                "sha256 %s, upload sha256 %s); re-run gate_picture()"
                % (REFUSED, rec["sha256"][:12], got[:12]))
        url = (uploader or adapter_uploader())(copy)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if not isinstance(url, str) or not url.startswith("http"):
        raise LipsyncPictureNotGated("%s: upload returned no URL (%r)" % (REFUSED, url))
    with open(_binding_path(got, rdir), "w") as f:
        json.dump({"sha256": got, "url": url}, f)
    return url


def require_upload_bound(path, url, receipt_dir=None):
    """The image URL in the Kling request must be the upload of `path`'s exact
    bytes. Raises LipsyncPictureNotGated otherwise."""
    sha = sha256_file(path)
    try:
        with open(_binding_path(sha, receipt_dir or default_receipt_dir(path))) as f:
            b = json.load(f)
    except (OSError, ValueError):
        b = {}
    if b.get("sha256") != sha or not url or b.get("url") != url:
        raise LipsyncPictureNotGated(
            "%s: image_url %r is not the upload of the measured file %s "
            "(sha256 %s); send the URL returned by upload_measured()"
            % (REFUSED, url, path, sha[:12]))


# --- default transport: skill 74 through kie_dispatch / load_governor -------

def _dispatch():
    import kie_dispatch.kie_dispatch as D    # core/ is on sys.path via PM
    return D


def adapter_uploader(adapter_path=None, runner=None):
    """uploader(file) -> URL through skill 74 `upload`. The runner is
    kie_dispatch.make_runner(), i.e. load_governor.kie_request."""
    def up(file):
        D = _dispatch()
        adapter = D.resolve_adapter(adapter_path)
        if not adapter:
            raise RuntimeError("skill 74 (74-kie-live-adapter) not found; cannot upload")
        rc, j, raw = D._call(runner or D.make_runner(), adapter,
                             ["upload", "--file", file,
                              "--upload-path", "lipsync/in", "--json"])
        url = ((j or {}).get("data") or {}).get("download_url") if isinstance(j, dict) else None
        if not url:
            raise RuntimeError("upload failed rc=%s: %s" % (rc, (raw or "")[-300:]))
        return url
    return up


class RegenerationFailed(Exception):
    pass


def make_regenerate(character_image, *, save_dir, ledger_db, run_id, logical_key,
                    estimated_cost, card_receipt, adapter_path=None, runner=None,
                    state_store=None, uploader=None, model=REGEN_MODEL):
    """The default PAID regeneration for gate_picture(regenerate=...).

    gpt-image-2 image-to-image from the 3D character (`character_image`, a
    local file) with the prompt gate_picture hands in (REGEN_PROMPT). Goes
    through kie_dispatch.dispatch: it reserves `estimated_cost` against the
    author's cap in the spend ledger, runs under the card gate, and every KIE
    call rides load_governor.kie_request. Each call is a new attempt id. A
    non-ok envelope raises RegenerationFailed (gate_picture then refuses)."""
    n = [0]

    def regenerate(_current, prompt):
        D = _dispatch()
        n[0] += 1
        url = (uploader or adapter_uploader(adapter_path, runner))(character_image)
        req = {"input": {"prompt": prompt, "input_urls": [url], "aspect_ratio": "9:16"},
               "card_receipt": card_receipt}
        env = D.dispatch(model=model, request=req, save_dir=save_dir,
                         ledger_db=ledger_db, run_id=run_id, logical_key=logical_key,
                         attempt_id="picture-regen-%d" % n[0],
                         estimated_cost=estimated_cost, prompt=prompt,
                         adapter_path=adapter_path, runner=runner,
                         state_store=state_store)
        saved = (env.get("evidence") or {}).get("saved_paths") or []
        if env.get("outcome") != "ok" or not saved:
            raise RegenerationFailed("%s %s: %s" % (
                env.get("outcome"), env.get("reason_code"), env.get("next_action")))
        return saved[0]
    return regenerate
