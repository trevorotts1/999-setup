#!/usr/bin/env python3
"""Deterministic Candice derivative pipeline (FIX-004).

Contract
--------
- Reads ONLY the 16 canonical originals in assets/candice/source/operator-approved/
  and their manifest (asset-manifest.json).
- Writes ONLY to assets/candice/derived/ (DERIVATIVE-MANIFEST.json + one
  subdirectory per tier). The experimental-kie quarantine and the source
  directory are never touched.
- Reproducible: fixed encoder parameters, fixed file mtimes, sorted iteration,
  spec-pinned crop rectangles, no timestamps or randomness. Two builds from a
  clean derived/ tree must produce byte-identical outputs and identical hashes.
- The derivative manifest records every output: id, file, format, dimensions,
  source ids + source sha256, transform parameters, bytes, sha256. `status`
  stays pending until FIX-003 operator approval lands; the pinned hashes make
  that approval bind instantly.

Rules from DOC-ASSET-HANDLING-NOTE.md apply: this script works on disk with
PIL; no pixel bytes may be read into a model context by any lane.

Exit codes: 0 success, 2 tool/misconfig failure, 3 source integrity failure.
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import PIL
from PIL import Image

FIXED_MTIME = 1767225600  # 2026-01-01T00:00:00Z, same for every output file

# Ordered exactly like the manifests so two runs emit identical records.
# (Order of dict keys is preserved by json.dumps; iteration over a spec
# dict follows insertion order, so records are stable.)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fail(msg: str, code: int) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(code)


def png_info(path: Path):
    """width, height, bit depth, color type from the PNG IHDR (metadata only)."""
    with open(path, "rb") as fh:
        data = fh.read(33)
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n":
        fail(f"not a PNG: {path}", 2)
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    depth = data[24]
    color_type = data[25]
    names = {0: "GRAY", 2: "RGB", 3: "PALETTE", 4: "GRAYA", 6: "RGBA"}
    return {
        "width": width,
        "height": height,
        "bitDepth": depth,
        "colorType": names.get(color_type, f"UNKNOWN({color_type})"),
    }


def alpha_ok(rgba: Image.Image) -> bool:
    return rgba.getchannel("A").getextrema()[0] < 255


def fit_size(w: int, h: int, tw: int, th: int):
    scale = min(tw / w, th / h)
    return max(1, round(w * scale)), max(1, round(h * scale))


def encode_png(img: Image.Image, dest: Path) -> None:
    # optimize=False pinned: zlib level from compress_level only, no trial runs.
    img.save(dest, "PNG", compress_level=6, optimize=False)
    os.utime(dest, (FIXED_MTIME, FIXED_MTIME))


def encode_webp(img: Image.Image, dest: Path) -> None:
    # lossless=False + quality=95: measured before choosing (see spec note).
    # Pillow's "lossless" WebP is still lossy in RGB; this spec declares
    # WebP honestly as a pinned 95-quality derivative. PNG is the lossless one.
    img.save(dest, "WEBP", lossless=False, quality=95, method=6)
    os.utime(dest, (FIXED_MTIME, FIXED_MTIME))


def decode(path: Path) -> Image.Image:
    with Image.open(path) as im:
        if im.info.get("icc_profile"):
            fail(f"unexpected ICC profile in source {path.name}; sources are measured ICC-free", 3)
        rgba = im.convert("RGBA")
        rgba.load()
        if not alpha_ok(rgba):
            fail(f"source {path.name} is opaque; transparency preservation would be violated", 3)
        return rgba


def write_json(path: Path, obj) -> None:
    text = json.dumps(obj, indent=2, sort_keys=False) + "\n"
    path.write_text(text, encoding="utf-8")
    os.utime(path, (FIXED_MTIME, FIXED_MTIME))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic Candice derivative pipeline (FIX-004)"
    )
    parser.add_argument(
        "--out-root",
        type=Path,
        default=None,
        help=(
            "Override derived output root (verification builds). Default: "
            "assets/candice/derived/approved-pending. The manifest is written "
            "next to the outputs under the chosen root."
        ),
    )
    args = parser.parse_args()

    app_root = Path(__file__).resolve().parents[1]
    assets_root = app_root / "assets" / "candice"
    source_dir = assets_root / "source" / "operator-approved"
    derived_dir = assets_root / "derived"
    spec_path = assets_root / "DERIVATIVE-SPEC.json"
    manifest_path = assets_root / "asset-manifest.json"

    for needed in (source_dir, spec_path, manifest_path):
        if not needed.exists():
            fail(f"missing required input: {needed}", 2)

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if spec.get("schema") != "candice/derivative-spec@1":
        fail("derivative spec schema mismatch", 2)
    if manifest.get("canonicalAuthority") != "operator-originals":
        fail("source manifest is not operator-originals authority", 3)
    if spec.get("parentContract") != manifest.get("contract"):
        fail("spec parent contract does not match source manifest contract", 3)

    source_ids = {a["id"]: a for a in manifest["assets"]}
    if len(source_ids) != 16:
        fail(f"expected 16 canonical sources, manifest has {len(source_ids)}", 3)

    for a in sorted(source_ids.values(), key=lambda x: x["id"]):
        p = source_dir / a["file"]
        if not p.exists():
            fail(f"canonical source missing: {p}", 3)
        if sha256_file(p) != a["sha256"]:
            fail(f"canonical source hash mismatch: {a['file']}", 3)
        info = png_info(p)
        if (info["width"], info["height"]) != (a["width"], a["height"]):
            fail(f"dimension mismatch for {a['file']}", 3)

    # Derived outputs, sorted by (tier, format, id) so the record list is stable.
    out_dir = args.out_root if args.out_root else derived_dir / "approved-pending"
    records = []
    missing_inputs = []

    for tier_name, tier in spec["tiers"].items():
        tier_dir = out_dir / tier_name
        fit = tier.get("fit", "fit-inside")
        target_w = tier["target"]["width"]
        target_h = tier["target"]["height"]
        crop = tier.get("crop")
        for input_id in tier["inputs"]:
            src_entry = source_ids.get(input_id)
            if src_entry is None:
                missing_inputs.append(input_id)
                continue
            src_path = source_dir / src_entry["file"]
            base = decode(src_path)

            if fit == "crop-then-fit":
                if not crop:
                    fail(f"tier {tier_name} declares crop-then-fit without a pinned crop", 2)
                box = (crop["x0"], crop["y0"], crop["x1"], crop["y1"])
                if not (0 <= box[0] < box[2] <= base.width and 0 <= box[1] < box[3] <= base.height):
                    fail(f"tier {tier_name} crop box outside source bounds", 2)
                work = base.crop(box)
                # Crop band aspect is the band's own, not the frame's.
                work_w, work_h = work.size
                fw, fh = fit_size(work_w, work_h, target_w, target_h)
            else:
                work = base
                fw, fh = fit_size(base.width, base.height, target_w, target_h)

            if (fw, fh) > (base.width, base.height):
                fail(f"tier {tier_name} upscales beyond native for {input_id}", 2)

            resized = work.resize((fw, fh), Image.LANCZOS)

            for fmt in spec["formats"]:
                if fmt == "PNG":
                    fname = f"{input_id}-{tier_name}.png"
                    tier_dir.mkdir(parents=True, exist_ok=True)
                    dest = tier_dir / fname
                    encode_png(resized, dest)
                elif fmt == "WEBP":
                    fname = f"{input_id}-{tier_name}.webp"
                    tier_dir.mkdir(parents=True, exist_ok=True)
                    dest = tier_dir / fname
                    encode_webp(resized, dest)
                else:
                    fail(f"unsupported format {fmt}", 2)

                records.append({
                    "id": f"{input_id}-{tier_name}-{fmt.lower()}",
                    "file": f"{tier_name}/{fname}",
                    "format": fmt,
                    "tier": tier_name,
                    "fit": fit,
                    "sourceIds": [input_id],
                    "sourceSha256": [src_entry["sha256"]],
                    "width": fw,
                    "height": fh,
                    "transform": {
                        "crop": crop,
                        "resample": "LANCZOS",
                        "scaledTo": [fw, fh],
                        "targetBox": [target_w, target_h],
                        "aspectPreserved": True,
                    },
                    "bytes": dest.stat().st_size,
                    "sha256": sha256_file(dest),
                    "encoder": {
                        "PNG": {"compressLevel": 6, "optimize": False},
                        "WEBP": {"lossless": False, "quality": 95, "method": 6},
                    }[fmt],
                })

    if missing_inputs:
        fail(f"spec references unknown source ids: {', '.join(missing_inputs)}", 2)

    out_manifest = {
        "schema": "candice/derivative-manifest@1",
        "contract": "candice-derivatives-v1",
        "spec": "DERIVATIVE-SPEC.json",
        "generatedAt": "reproducible",
        "status": "PENDING-OPERATOR-APPROVAL",
        "approvalGate": "FIX-003 operator approval pending; hashes in this file pin the build so approval binds instantly",
        "sourceManifestSha256": sha256_file(manifest_path),
        "specSha256": sha256_file(spec_path),
        "tool": {
            "name": "python3",
            "version": ".".join(map(str, sys.version_info[:3])),
            "pillow": PIL.__version__,
            "host": "not recorded (determinism)",
            "fixedMtime": FIXED_MTIME,
        },
        "derivativeCount": len(records),
        "derivatives": records,
        "prohibited": [
            "No generated, synthesized, or AI-produced art enters derived/",
            "No background fill, flattening, or color manipulation",
            "Sources are never rewritten; derived outputs land only under derived/approved-pending/",
            "experimental-kie quarantine remains untouched and is never production authority",
        ],
    }
    write_json(out_dir / "DERIVATIVE-MANIFEST.json", out_manifest)

    total_bytes = sum(r["bytes"] for r in records)
    print(f"BUILD OK: {len(records)} derivatives, {total_bytes} bytes -> {out_dir}")
    print(f"manifest: {out_dir / 'DERIVATIVE-MANIFEST.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
