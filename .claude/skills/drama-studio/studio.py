#!/usr/bin/env python3
# studio.py — the Drama Studio pairing and link command (U13).
#
# Usage:
#   studio.py pair ABCD-2345 [--studio URL] [--dry-run]
#   studio.py link [--new] [--print] [--studio URL]
#
# pair sends the one-time code, this computer's name, its operating system and which
# tools are present (claude, claude-nine) to U2's POST /api/studio/pair. It burns the
# code, then stores the per-machine key ONCE on this computer:
#   Mac/Linux: ~/.drama-studio/machine.key   folder 700, file 600
#   Windows:   the DPAPI folder beside it (this file writes the plain path; the
#              encryption helper is nine-router-setup/scripts/windows/Protect-LocalState.ps1)
# The key is NEVER printed and NEVER written into any settings.json (decision 11).
# The studio address is not a secret and lives beside the key as studio.url. `pair`
# resolves it as --studio, then DRAMA_STUDIO_URL, then the stored studio.url, then this
# distribution's own documented DEFAULT_STUDIO_URL, so the documented command
# `studio.py pair ABCD-2345` works on a computer that was never paired during install.
# The client's personal link (the #k= address) lives beside both as client.url (600);
# `link` shows it and opens it, `link --new` makes a new one (the old one stops working).
#
# EXIT CODES
#   0  paired, or the link was shown
#   2  a named refusal: AF-DS-PAIR-SHAPE, AF-DS-PAIR-FAILED, AF-DS-ARGS
#   3  nothing could be done without the caller acting (a computer with no address and
#      no key to pair it; a build carrying no default studio address)
import argparse
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
import webbrowser

STATE_DIR_NAME = ".drama-studio"
# The alphabet has no look-alike characters (no 0/O, no 1/I/L), four and four.
CODE_RE = re.compile(r"^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$")
AF_SHAPE = "AF-DS-PAIR-SHAPE"
AF_FAILED = "AF-DS-PAIR-FAILED"
AF_ARGS = "AF-DS-ARGS"
KEY_FILE = "machine.key"
URL_FILE = "studio.url"
LINK_FILE = "client.url"
NETWORK_BUDGET_S = 3.0
#: The studio address this distribution ships with — the one AGENT_INSTALL.md pairs
#: against. It is the same constant studio_bridge.py names STUDIO_BASE_URL. `pair`
#: falls back to it so `/drama-studio pair CODE` works on a computer that was never
#: paired during install, where DRAMA_STUDIO_URL is unset and studio.url does not
#: exist yet (there is nothing to have stored it). It is a documented address, never
#: a guess; DRAMA_STUDIO_URL, --studio and studio.url still all win over it.
DEFAULT_STUDIO_URL = "https://studio.zerohumanworkforce.com"

# The studio sits behind Cloudflare, which refuses Python's default User-Agent
# ("Python-urllib/3.x") with HTTP 403 "error code: 1010". Every request from this
# module therefore carries this ONE explicit User-Agent. Keep it identical in
# studio_bridge.py, studio.py and studio_check.py; prove/prove_user_agent.py
# asserts all three strings are equal before it drives a request.
STUDIO_USER_AGENT = "drama-studio-client/2.7.48 (+https://studio.zerohumanworkforce.com)"

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


def read_private(name):
    try:
        with open(os.path.join(state_dir(), name), encoding="utf-8") as fh:
            return fh.read().strip()
    except Exception:
        return ""


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
        headers={"content-type": "application/json", "User-Agent": STUDIO_USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=NETWORK_BUDGET_S) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def cmd_pair(a):
    if not a.code or not validate_code(a.code):
        sys.stderr.write("%s refused: a pairing code is four and four, ABCD-2345, no look-alikes\n" % AF_SHAPE)
        return 2
    # The address resolves the same way its siblings resolve one: --studio, then
    # DRAMA_STUDIO_URL, then the stored studio.url, then this distribution's own
    # documented default. Only a build carrying no default can still come up short.
    url = studio_url(a.studio) or DEFAULT_STUDIO_URL
    canned = os.environ.get("DRAMA_STUDIO_FAKE_PAIR")
    if canned:                                   # the prover drives this path; no network, no browser
        out = json.loads(canned)
    elif a.dry_run or os.environ.get("DRAMA_STUDIO_FAKE") == "1":
        body = pair_body(a.code)
        body["code"] = "<code>"          # the one-time code is never echoed
        sys.stdout.write("AF-DS-PAIR-DRY %s\n" % json.dumps(body, sort_keys=True))
        return 0
    elif not url:
        sys.stderr.write(
            "%s refused: this build carries no studio address. Ask the operator for it, then run "
            "this command once more with --studio URL, or set DRAMA_STUDIO_URL. Never invent one.\n"
            % AF_FAILED)
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
    if url and not canned:
        # best effort: the pair itself already succeeded, so exit 0 either way. A canned
        # pair is the no-network knob (the prover drives it), so it never reaches out for
        # the link either — with no --studio it would otherwise dial the real studio with
        # a key that does not exist.
        cmd_link(a)
    return 0


def call_link(url, key, rotate):
    req = urllib.request.Request(
        url.rstrip("/") + "/api/studio/link",
        data=json.dumps({"rotate": bool(rotate)}).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json", "User-Agent": STUDIO_USER_AGENT,
                 "x-ds-key": key},
    )
    with urllib.request.urlopen(req, timeout=NETWORK_BUDGET_S) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def cmd_link(a):
    url = studio_url(a.studio)
    if not url:
        sys.stderr.write("%s refused: no studio address yet; pair this computer first\n" % AF_FAILED)
        return 3
    rotate = bool(getattr(a, "new", False))
    link = read_private(LINK_FILE)
    if rotate or not link:
        key = read_private(KEY_FILE)
        if not key:
            sys.stderr.write("%s refused: no machine key; pair this computer first\n" % AF_FAILED)
            return 3
        try:
            out = call_link(url, key, rotate)
        except Exception as exc:
            sys.stderr.write("%s refused: %s\n" % (AF_FAILED, type(exc).__name__))
            return 2
        if not out.get("link"):
            if out.get("exists") and not link and not rotate:
                sys.stdout.write("Your link was made on another computer. Run `/drama-studio link new` "
                                 "to make a new one (the old one stops working).\n")
                return 0
            sys.stderr.write("%s refused: %s\n" % (AF_FAILED, out.get("code") or "no link returned"))
            return 2
        link = out["link"]
        write_private(os.path.join(state_dir(), LINK_FILE), link + "\n")
    sys.stdout.write("Your Drama Studio link: %s\n" % link)
    if not getattr(a, "print_only", False) and os.environ.get("DRAMA_STUDIO_FAKE") != "1":
        try:
            webbrowser.open(link)
        except Exception:
            pass
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
    l.add_argument("--new", action="store_true")
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
