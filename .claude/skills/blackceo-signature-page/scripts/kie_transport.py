#!/usr/bin/env python3
"""kie_transport.py: the 999 edition's transport gap filler.

Fix plan Item 28, Row 2. The step-zero capability audit of this
repo's native kie skill (S8 audit, 999-setup at HEAD) found the
native adapter (installer-registration/helpers/74-kie-live-adapter,
kie_live_adapter.py) implements the transport surface Skill 71's
gate needs, EXCEPT two things:

  1. the credits before/after pair around a dispatch (single credits
     reads exist: the adapter's `credits` command and the preflight
     balance read; nothing pairs them around a run), and
  2. per-task receipt files carrying the gate's kie74 fields
     (task_id, model_id, model_source, requested ratio, generated
     ratio measured from the saved file, preflight_ok, budget_exit).

This module supplies exactly those two pieces and nothing else. It
drives the native adapter's own CLI primitives (credits, preflight,
run) and never reimplements createTask, polling, or saving. Where the
adapter's output cannot be parsed for a field, the receipt records
null for that field and keeps the adapter's raw output reference;
nothing is invented.

Usage:
  kie_transport.py credits
      Print the current KIE credit balance (single read, the
      adapter's own `credits` command).
  kie_transport.py run --run-dir DIR --file REL --model-id ID
      --model-source SRC --requested-ratio R --budget-exit N
      [--save-dir DIR] -- <adapter run arguments>
      Read credits, run the adapter preflight for the model, dispatch
      through the adapter's run command, read credits again, measure
      the saved file's ratio, write the per-task receipt to
      <run-dir>/private/receipts/kie74/<task_id>.json (adapter name
      "kie"), and print the transport task entry as JSON on stdout
      for assembly into the stage receipt's transport block.

Exit codes: 0 success; 1 preflight failed or the dispatch failed
(the receipt is still written, with state "failed"); 2 the native
adapter could not be located or its output was unusable (no receipt
is written; repair the install, do not hand-roll a call).
"""
import argparse
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

ADAPTER_REL = Path("installer-registration/helpers/74-kie-live-adapter"
                   "/scripts/kie_live_adapter.py")


def find_adapter():
    env = os.environ.get("KIE_LIVE_ADAPTER_PATH")
    if env:
        p = Path(env)
        return p if p.is_file() else None
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / ADAPTER_REL
        if candidate.is_file():
            return candidate
        nested = parent / ".claude" / "skills" / "blackceo-signature-page" / ADAPTER_REL
        if nested.is_file():
            return nested
    return None


def run_adapter(adapter, args):
    proc = subprocess.run([sys.executable, str(adapter), *args],
                          text=True, capture_output=True)
    return proc


def parse_json_output(proc):
    try:
        return json.loads(proc.stdout)
    except ValueError:
        return None


def extract_number(obj, keys):
    if isinstance(obj, dict):
        for key in keys:
            value = obj.get(key)
            if isinstance(value, (int, float)):
                return float(value)
        for value in obj.values():
            found = extract_number(value, keys)
            if found is not None:
                return found
    return None


def read_credits(adapter):
    proc = run_adapter(adapter, ["credits"])
    if proc.returncode != 0:
        return None
    data = parse_json_output(proc)
    return extract_number(data, ("balance", "credits", "credit", "amount"))


def find_task_id(obj):
    if isinstance(obj, dict):
        for key in ("task_id", "taskId", "id"):
            value = obj.get(key)
            if isinstance(value, str) and value:
                return value
        for value in obj.values():
            found = find_task_id(value)
            if found:
                return found
    if isinstance(obj, list):
        for value in obj:
            found = find_task_id(value)
            if found:
                return found
    return None


def find_saved_paths(obj):
    paths = []
    if isinstance(obj, dict):
        for key in ("saved_paths", "saved", "files"):
            value = obj.get(key)
            if isinstance(value, list):
                paths.extend(str(v) for v in value)
        for value in obj.values():
            paths.extend(find_saved_paths(value))
    if isinstance(obj, list):
        for value in obj:
            paths.extend(find_saved_paths(value))
    return paths


def measure_ratio(path):
    """Return 'W:H' reduced, measured from the saved file's bytes.
    PNG via its IHDR; anything else via PIL when available; else None."""
    try:
        data = Path(path).read_bytes()
    except OSError:
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        width, height = struct.unpack(">II", data[16:24])
        return reduce_ratio(width, height)
    try:
        from PIL import Image
        import io
        with Image.open(io.BytesIO(data)) as im:
            return reduce_ratio(im.width, im.height)
    except Exception:
        return None


def reduce_ratio(width, height):
    import math
    if not width or not height:
        return None
    g = math.gcd(width, height)
    return f"{width // g}:{height // g}"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("credits")
    run_p = sub.add_parser("run")
    run_p.add_argument("--run-dir", type=Path, required=True)
    run_p.add_argument("--file", required=True,
                       help="the generated file's path relative to the run dir")
    run_p.add_argument("--model-id", required=True)
    run_p.add_argument("--model-source", required=True)
    run_p.add_argument("--requested-ratio", required=True)
    run_p.add_argument("--budget-exit", type=int, required=True,
                       help="exit code of the prompt-budget check for this task")
    run_p.add_argument("--save-dir", type=Path, default=None)
    run_p.add_argument("adapter_args", nargs=argparse.REMAINDER,
                       help="arguments passed through to the adapter run command")
    args = parser.parse_args()

    adapter = find_adapter()
    if adapter is None:
        print("FAIL: the native kie adapter (74-kie-live-adapter) could "
              "not be located. Searched KIE_LIVE_ADAPTER_PATH and the "
              "repo's installer-registration/helpers tree. This module "
              "supplies only the audit-proven gaps; it never reimplements "
              "the adapter.", file=sys.stderr)
        return 2

    if args.command == "credits":
        balance = read_credits(adapter)
        if balance is None:
            print("FAIL: the adapter credits command returned no readable "
                  "balance.", file=sys.stderr)
            return 1
        print(json.dumps({"credits": balance}))
        return 0

    adapter_args = list(args.adapter_args)
    if adapter_args and adapter_args[0] == "--":
        adapter_args = adapter_args[1:]

    credits_before = read_credits(adapter)
    preflight = run_adapter(adapter, ["preflight", "--model", args.model_id])
    preflight_ok = preflight.returncode == 0

    receipt = {
        "task_id": None,
        "adapter": "kie",
        "state": "failed",
        "file": args.file,
        "model_id": args.model_id,
        "model_source": args.model_source,
        "requested_ratio": args.requested_ratio,
        "generated_ratio": None,
        "preflight_ok": preflight_ok,
        "budget_exit": args.budget_exit,
        "credits_before": credits_before,
        "credits_after": None,
    }
    if not preflight_ok:
        write_receipt(args.run_dir, receipt)
        print(json.dumps(receipt))
        return 1

    proc = run_adapter(adapter, ["run", *adapter_args])
    result = parse_json_output(proc)
    credits_after = read_credits(adapter)
    receipt["credits_after"] = credits_after
    if proc.returncode != 0 or result is None:
        receipt["adapter_output_unparsed"] = (proc.stdout or "")[:500]
        write_receipt(args.run_dir, receipt)
        print(json.dumps(receipt))
        return 1 if proc.returncode != 0 else 2

    task_id = find_task_id(result)
    saved = find_saved_paths(result)
    receipt["task_id"] = task_id
    receipt["state"] = "success" if task_id else "failed"
    target = None
    if saved:
        target = saved[0]
    elif (args.run_dir / args.file).is_file():
        target = str(args.run_dir / args.file)
    if target:
        receipt["generated_ratio"] = measure_ratio(target)
    if task_id:
        write_receipt(args.run_dir, receipt)
    print(json.dumps(receipt))
    return 0 if task_id else 2


def write_receipt(run_dir, receipt):
    task_id = receipt.get("task_id") or "unknown-task"
    dest = Path(run_dir) / "private" / "receipts" / "kie74" / f"{task_id}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
