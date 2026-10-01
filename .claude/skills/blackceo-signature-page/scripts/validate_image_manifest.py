#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

# Shared minimum contract, present in every dialect the skill writes.
BASE_REQUIRED = ["id", "job", "filename", "status"]
# Prompt-plan entries (artifact-contracts.md "Image-map JSON" example).
AUTHORING_REQUIRED = [
    "source_passage", "scene", "people", "shot_plan",
    "style_grade", "text_mode", "references", "technical_plan",
]
# Generated-asset/map entries: the image-map stage output shape.
MAP_REQUIRED = ["alt_text", "intended_ratio", "crop_focal", "asset_path"]
# Fields that identify the map dialect when no prompt-plan fields are present.
MAP_MARKERS = ("alt_text", "intended_ratio", "intended_desktop_slot", "section_name")

STATUSES = {"planned", "blocked", "prompt_ready", "generated", "qc_failed", "ready", "missing"}
PROMPT_STATUSES = {"prompt_ready", "generated", "qc_failed", "ready"}
ASSET_STATUSES = {"generated", "qc_failed", "ready"}


def identifier(value):
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return None


def validate(data, base_dir=None, check_files=False):
    errors = []
    if not isinstance(data, dict) or not isinstance(data.get("images"), list):
        return ["Top-level JSON must contain an images array."]

    ids = []
    filenames = []
    entries = []
    for idx, item in enumerate(data["images"], start=1):
        prefix = f"images[{idx}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix} must be an object.")
            entries.append(None)
            continue

        item_id = identifier(item.get("id"))
        if item_id is None:
            errors.append(f"{prefix}.id must be a non-empty string or number.")
        else:
            ids.append(item_id)

        filename = identifier(item.get("filename"))
        status = item.get("status")
        if status in PROMPT_STATUSES:
            # Guide invariant: one image-map entry -> one correctly named file.
            if filename is None:
                errors.append(f"{prefix}.filename must be a non-empty string or number for status {status!r}.")
            else:
                filenames.append(filename)
        elif filename is not None:
            filenames.append(filename)

        # Dialect: the map stage writes placement/alt fields, the prompt-plan stage
        # writes prompt-authoring fields; an entry with neither meets only the
        # shared minimum contract.
        if any(item.get(marker) is not None for marker in MAP_MARKERS):
            dialect = "map"
        elif item.get("source_passage") is not None:
            dialect = "authoring"
        else:
            dialect = None
        required = BASE_REQUIRED + {
            "map": MAP_REQUIRED,
            "authoring": AUTHORING_REQUIRED,
            None: [],
        }[dialect]
        for key in required:
            if key not in item:
                errors.append(f"{prefix} missing required field {key!r}.")

        if dialect == "authoring" and not isinstance(item.get("references", []), list):
            errors.append(f"{prefix}.references must be an array.")
        if status not in STATUSES:
            errors.append(f"{prefix}.status is invalid: {status!r}.")
        if status in PROMPT_STATUSES and not item.get("prompt_file"):
            errors.append(f"{prefix} with status {status!r} requires prompt_file.")
        # The asset field is spelled asset_file in the prompt plan and asset_path in
        # the map stage; either satisfies the requirement for a generated asset.
        if status in ASSET_STATUSES and not (item.get("asset_file") or item.get("asset_path")):
            errors.append(f"{prefix} with status {status!r} requires asset_file (or asset_path).")

        entries.append((prefix, item, item_id, dialect))

    id_set = set(ids)
    duplicate_ids = sorted({x for x in ids if ids.count(x) > 1}, key=lambda x: str(x))
    duplicate_names = sorted({x for x in filenames if filenames.count(x) > 1}, key=lambda x: str(x))
    if duplicate_ids:
        errors.append("Duplicate image IDs: " + ", ".join(str(x) for x in duplicate_ids))
    if duplicate_names:
        errors.append("Duplicate filenames: " + ", ".join(str(x) for x in duplicate_names))

    for entry in entries:
        if entry is None:
            continue
        prefix, item, item_id, _ = entry
        master_id = identifier(item.get("master_id"))
        if master_id is None:
            continue
        if master_id == item_id:
            errors.append(f"{prefix}.master_id cannot reference itself.")
        elif master_id not in id_set:
            errors.append(f"{prefix}.master_id references unknown ID {master_id!r}.")

    if check_files:
        base_dir = Path(base_dir or ".")
        for entry in entries:
            if entry is None:
                continue
            prefix, item, _, _ = entry
            for key in ("prompt_file", "asset_file"):
                value = item.get(key)
                if value and not (base_dir / value).exists():
                    errors.append(f"{prefix}.{key} does not exist: {value}")

    return errors


def main():
    parser = argparse.ArgumentParser(description="Validate BlackCEO image-map JSON.")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--check-files", action="store_true")
    args = parser.parse_args()
    try:
        data = json.loads(args.manifest.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"FAIL: could not read JSON: {exc}")
        return 2

    errors = validate(data, args.manifest.parent, args.check_files)
    if errors:
        print("FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"PASS: {len(data['images'])} image-map entries are structurally valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
