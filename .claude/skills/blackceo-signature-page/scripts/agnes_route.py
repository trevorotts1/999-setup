#!/usr/bin/env python3
"""agnes_route.py: the 999 edition's Agnes image route.

Fix plan Item 28, Row 5. The onboarding route for Agnes is Skill 63
(agnes-image), an OpenClaw skill; nothing in this harness serves the
route, so this module vendors the documented subset: submit, poll,
save, cost. The Agnes image endpoint is synchronous (Skill 63's own
documentation): one POST to
https://apihub.agnes-ai.com/v1/images/generations returns the image
as a URL or base64 in the same response. There is no task to poll;
`poll` here reports the state recorded at submit time, labeled as
such. The endpoint returns no task id, so the receipt's task_id is a
local identifier minted by this module and labeled
"task_id_source": "local". The API key is read from the
AGNES_AI_API_KEY environment variable at call time; its value is
never printed or written anywhere. When the variable is not set,
this module refuses in writing, and so does intake
(scripts/write_intake.py refuses image_engine agnes).

The model is the caller's: the client selects their model or their
configured default applies. This module prescribes none.

Usage:
  agnes_route.py submit --run-dir DIR --file REL --prompt-file F
      --model ID --size SIZE --requested-ratio R --budget-exit N
  agnes_route.py poll --run-dir DIR --task-id ID
  agnes_route.py save --run-dir DIR --task-id ID
  agnes_route.py cost --run-dir DIR --task-id ID

Receipt files land in <run-dir>/private/receipts/agnes/<task_id>.json
with the same field shape kie_transport.py writes, adapter "agnes".
The stage receipt's transport block names skill "63-agnes-image"
(the gate's route name for this rail); this module prints the task
entry for assembly into it.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ENDPOINT = "https://apihub.agnes-ai.com/v1/images/generations"
KEY_VAR = "AGNES_AI_API_KEY"


def receipt_path(run_dir, task_id):
    return Path(run_dir) / "private" / "receipts" / "agnes" / f"{task_id}.json"


def load_receipt(run_dir, task_id):
    path = receipt_path(run_dir, task_id)
    if not path.is_file():
        print(f"FAIL: no Agnes receipt for {task_id!r} at {path}",
              file=sys.stderr)
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_receipt(run_dir, receipt):
    path = receipt_path(run_dir, receipt["task_id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return path


def submit(args):
    key = os.environ.get(KEY_VAR)
    if not key:
        print(f"FAIL: {KEY_VAR} is not set in this environment. The "
              "Agnes route cannot run without the configured key; "
              "intake refuses image_engine agnes for the same reason. "
              "No value was requested or recorded.", file=sys.stderr)
        return 2
    prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    task_id = f"agnes-{int(time.time())}-{os.getpid()}"
    receipt = {
        "task_id": task_id,
        "task_id_source": "local: the Agnes image endpoint is synchronous and returns no task id",
        "adapter": "agnes",
        "state": "failed",
        "file": args.file,
        "model_id": args.model,
        "model_source": "explicit-request" if args.model else "latest-family",
        "requested_ratio": args.requested_ratio,
        "generated_ratio": None,
        "preflight_ok": True,
        "budget_exit": args.budget_exit,
        "credits_before": None,
        "credits_after": None,
        "cost": None,
        "cost_note": "the Agnes API response carries no cost figure; none is invented",
    }
    payload = {
        "model": args.model,
        "prompt": prompt,
        "size": args.size,
        "extra_body": {"response_format": "b64_json"},
    }
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read())
    except Exception as exc:  # network or API failure: record, never invent
        receipt["error"] = f"{type(exc).__name__}: {exc}"
        save_receipt(args.run_dir, receipt)
        print(json.dumps(receipt))
        return 1
    data = (body.get("data") or [{}])[0]
    if data.get("b64_json"):
        target = Path(args.run_dir) / args.file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(data["b64_json"]))
        receipt["state"] = "success"
        receipt["saved_via"] = "b64_json"
    elif data.get("url"):
        receipt["source_url"] = data["url"]
        receipt["state"] = "generated-not-saved"
    save_receipt(args.run_dir, receipt)
    print(json.dumps(receipt))
    return 0 if receipt["state"] == "success" else 1


def poll(args):
    receipt = load_receipt(args.run_dir, args.task_id)
    if receipt is None:
        return 2
    print(json.dumps({"task_id": args.task_id, "state": receipt["state"],
                      "note": "the Agnes image endpoint is synchronous; "
                              "this is the state recorded at submit time"}))
    return 0


def save(args):
    receipt = load_receipt(args.run_dir, args.task_id)
    if receipt is None:
        return 2
    if receipt["state"] == "success":
        print(json.dumps({"task_id": args.task_id, "saved": receipt["file"]}))
        return 0
    url = receipt.get("source_url")
    if not url:
        print("FAIL: nothing to save for this receipt (no saved file, no "
              "source URL).", file=sys.stderr)
        return 1
    target = Path(args.run_dir) / receipt["file"]
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as resp:
        target.write_bytes(resp.read())
    receipt["state"] = "success"
    receipt["saved_via"] = "url"
    save_receipt(args.run_dir, receipt)
    print(json.dumps({"task_id": args.task_id, "saved": receipt["file"]}))
    return 0


def cost(args):
    receipt = load_receipt(args.run_dir, args.task_id)
    if receipt is None:
        return 2
    print(json.dumps({"task_id": args.task_id, "cost": receipt.get("cost"),
                      "note": receipt.get("cost_note")}))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("submit")
    s.add_argument("--run-dir", type=Path, required=True)
    s.add_argument("--file", required=True)
    s.add_argument("--prompt-file", required=True)
    s.add_argument("--model", required=True)
    s.add_argument("--size", required=True)
    s.add_argument("--requested-ratio", required=True)
    s.add_argument("--budget-exit", type=int, required=True)
    for name in ("poll", "save", "cost"):
        p = sub.add_parser(name)
        p.add_argument("--run-dir", type=Path, required=True)
        p.add_argument("--task-id", required=True)
    args = parser.parse_args()
    return {"submit": submit, "poll": poll, "save": save, "cost": cost}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
