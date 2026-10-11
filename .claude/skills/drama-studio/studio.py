#!/usr/bin/env python3
# studio.py — the Drama Studio pairing and link command (U13).
#
# Usage:
#   studio.py pair ABCD-2345 [--studio URL] [--dry-run]
#   studio.py link [--print] [--studio URL]
#
# pair sends the one-time code, this computer's name, its operating system and which
# tools are present (claude, claude-nine) to U2's POST /api/studio/pair. It burns the
# code, then stores the per-machine key ONCE on this computer:
#   Mac/Linux: ~/.drama-studio/machine.key   folder 700, file 600
#   Windows:   the DPAPI folder beside it (this file writes the plain path; the
#              encryption helper is nine-router-setup/scripts/windows/Protect-LocalState.ps1)
# The key is NEVER printed and NEVER written into any settings.json (decision 11).
# The studio address is not a secret and lives beside the key as studio.url.
#
# EXIT CODES
#   0  paired, or the link was shown
#   2  a named refusal: AF-DS-PAIR-SHAPE, AF-DS-PAIR-FAILED, AF-DS-ARGS
#   3  the command could not run (no studio address, no network module)
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

STATE_DIR_NAME = ".drama-studio"
# The alphabet has no look-alike characters (no 0/O, no 1/I/L), four and four.
CODE_RE = re.compile(r"^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$")
AF_SHAPE = "AF-DS-PAIR-SHAPE"
AF_FAILED = "AF-DS-PAIR-FAILED"
AF_ARGS = "AF-DS-ARGS"
KEY_FILE = "machine.key"
URL_FILE = "studio.url"
NETWORK_BUDGET_S = 3.0


def state_dir():
    d = os.environ.get("DRAMA_STUDIO_STATE") or os.path.join(os.path.expanduser("~"), STATE_DIR_NAME)
    return os.path.abspath(d)


def studio_url(explicit=None):
    if explicit:
        return explicit.rstrip("/")
    env = os.environ.get("DRAMA_STUDIO_URL")
    if env:
        return env.rstrip("/")
    try:
        with open(os.path.join(state_dir(), URL_FILE), encoding="utf-8") as fh:
            return fh.read().strip().rstrip("/")
    except Exception:
        return ""


def write_private(path, text):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    try:
        os.chmod(os.path.dirname(path), 0o700)
    except OSError:
        pass
    tmp = path + ".tmp.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def which_tools():
    present = []
    for name in ("claude", "claude-nine"):
        if shutil.which(name):
            present.append(name)
    return present


def validate_code(code):
    return bool(CODE_RE.match(code or ""))


def pair_body(code):
    return {"code": code, "computer_name": os.uname().nodename if hasattr(os, "uname") else os.environ.get("COMPUTERNAME", ""),
            "os": sys.platform, "tools": which_tools()}


def call_pair(url, code):
    req = urllib.request.Request(
        url.rstrip("/") + "/api/studio/pair",
        data=json.dumps(pair_body(code)).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=NETWORK_BUDGET_S) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def cmd_pair(a):
    if not a.code or not validate_code(a.code):
        sys.stderr.write("%s refused: a pairing code is four and four, ABCD-2345, no look-alikes\n" % AF_SHAPE)
        return 2
    url = studio_url(a.studio)
    canned = os.environ.get("DRAMA_STUDIO_FAKE_PAIR")
    if canned:                                   # the prover drives this path; no network, no browser
        out = json.loads(canned)
    elif a.dry_run or os.environ.get("DRAMA_STUDIO_FAKE") == "1":
        body = pair_body(a.code)
        body["code"] = "<code>"          # the one-time code is never echoed
        sys.stdout.write("AF-DS-PAIR-DRY %s\n" % json.dumps(body, sort_keys=True))
        return 0
    elif not url:
        sys.stderr.write("%s refused: no studio address; run once with --studio URL\n" % AF_FAILED)
        return 3
    else:
        try:
            out = call_pair(url, a.code)
        except Exception as exc:
            sys.stderr.write("%s refused: %s\n" % (AF_FAILED, type(exc).__name__))
            return 2
    if not out.get("ok") or not out.get("key"):
        sys.stderr.write("%s refused: %s\n" % (AF_FAILED, out.get("code") or "no key returned"))
        return 2
    sd = state_dir()
    write_private(os.path.join(sd, KEY_FILE), out["key"] + "\n")
    write_private(os.path.join(sd, URL_FILE), url + "\n")
    sys.stdout.write("Drama Studio paired (%s). The key is stored on this computer and was not printed.\n"
                     % out.get("client_id", "client"))
    return cmd_link(a) if url else 0


def cmd_link(a):
    url = studio_url(a.studio)
    if not url:
        sys.stderr.write("%s refused: no studio address yet; pair this computer first\n" % AF_FAILED)
        return 3
    sys.stdout.write("Drama Studio: %s\n" % url)
    if (not getattr(a, "print_only", False) and sys.platform == "darwin"
            and os.environ.get("DRAMA_STUDIO_FAKE") != "1"):
        subprocess.run(["open", url], check=False)
    return 0


def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("pair")
    p.add_argument("code", nargs="?")
    p.add_argument("--studio")
    p.add_argument("--dry-run", action="store_true")
    l = sub.add_parser("link")
    l.add_argument("--studio")
    l.add_argument("--print", dest="print_only", action="store_true")
    try:
        a = ap.parse_args(argv)
    except SystemExit:
        return 2
    if a.cmd == "pair":
        return cmd_pair(a)
    if a.cmd == "link":
        return cmd_link(a)
    sys.stderr.write("%s need: studio.py pair <CODE> | studio.py link\n" % AF_ARGS)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
