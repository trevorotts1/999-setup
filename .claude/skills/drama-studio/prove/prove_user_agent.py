#!/usr/bin/env python3
# prove_user_agent.py — the runnable proof for the Drama Studio client User-Agent (CHECKIN-UA).
#
# WHAT IT PROVES. Cloudflare in front of the studio refuses Python's default
# User-Agent ("Python-urllib/3.x") with HTTP 403 and the body "error code: 1010".
# An explicit User-Agent gets 200. Every urllib request this skill sends
# (studio.py call_pair, studio_check.py fetch_checkin, studio_bridge.py _http) must
# therefore carry exactly
#
#     drama-studio-client/2.7.48 (+https://studio.zerohumanworkforce.com)
#
# REAL MODULE, REAL SERVER, LOCALHOST ONLY. The prover starts a fake studio on
# 127.0.0.1 (an ephemeral port) that answers 403 "error code: 1010" to any request
# whose User-Agent is absent or starts with "Python-urllib", and 200 JSON to a
# request carrying the one expected string. It then drives the REAL request
# function of each of the three modules at it and requires 200 AND the exact
# string on the wire.
#
# NO NETWORK, NO KEY, NO CLIENT BOX. Nothing here reaches studio.zerohumanworkforce.com,
# sends x-ds-key to a live host, writes a machine key or touches a client box. It
# installs nothing and starts no Claude.
#
# FOR EVERY CHECK, A PLANTED-BAD COPY ON THE SAME INSTRUMENT. Each check also runs
# against a copy of the module with exactly ONE planted defect (the User-Agent line
# removed, or the constant drifted) and requires that copy to FAIL. A planted-bad
# copy that stays green makes the check vacuous and the prover exits 2. That is what
# makes each check a real flip rather than a wording test.
#
# EXIT CODES
#   0  every check passed and every planted-bad control was caught
#   2  a named check failed, or a planted-bad control stayed green (vacuous)
#   3  the prover could not run (a module under test is missing, or the instrument
#      itself does not discriminate — a control that cannot fail proves nothing)
import argparse
import http.server
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
TMP_PREFIX = "operator-CHECKIN-UA-"

EXPECTED = "drama-studio-client/2.7.48 (+https://studio.zerohumanworkforce.com)"
MODULES = ("studio.py", "studio_check.py", "studio_bridge.py")
CODE = "ABCD-2345"          # a shape-valid pairing code; no live server ever sees it

FAILED = []
VACUOUS = []
SEEN = []                   # the User-Agent header of every request the fake studio saw
TMP = None

# ---------------------------------------------------------------- instrument

class _Handler(http.server.BaseHTTPRequestHandler):
    """A fake studio: 403 `error code: 1010` for the default User-Agent, 200 else."""

    def _serve(self):
        try:
            n = int(self.headers.get("content-length") or 0)
        except ValueError:
            n = 0
        if n:
            self.rfile.read(n)
        ua = self.headers.get("User-Agent") or ""
        SEEN.append(ua)
        if not ua or ua.startswith("Python-urllib"):
            return self._send(403, b"error code: 1010\n", "text/plain")
        if ua != EXPECTED:
            return self._send(403, b'{"ok":false,"code":"BAD_UA"}', "application/json")
        return self._send(200, json.dumps({"ok": True, "line": None, "key": "prove",
                                           "client_id": "prove"}).encode("utf-8"),
                          "application/json")

    def _send(self, status, body, ctype):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _serve

    def log_message(self, *a):     # keep the prover's output clean
        pass


def start_studio():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, "http://127.0.0.1:%d" % srv.server_address[1]


def instrument_control(base):
    """The instrument must discriminate. A control that cannot fail proves nothing."""
    bare = None
    try:
        urllib.request.urlopen(base + "/api/studio/health", timeout=10)
    except urllib.error.HTTPError as e:
        bare = (e.code, e.read().decode("utf-8", "replace").strip())
    if bare != (403, "error code: 1010"):
        raise AssertionError("instrument control: bare urllib did not get 403/1010 (%r)" % (bare,))
    req = urllib.request.Request(base + "/api/studio/health", headers={"User-Agent": EXPECTED})
    with urllib.request.urlopen(req, timeout=10) as r:
        if r.status != 200:
            raise AssertionError("instrument control: explicit User-Agent did not get 200 (%d)" % r.status)
    # a wrong-but-explicit User-Agent is refused too, so the server is not merely
    # "anything but the default" — the exact string is what it accepts
    wrong = urllib.request.Request(base + "/api/studio/health", headers={"User-Agent": "curl/8"})
    try:
        urllib.request.urlopen(wrong, timeout=10)
        raise AssertionError("instrument control: a wrong explicit User-Agent was accepted")
    except urllib.error.HTTPError as e:
        if e.code != 403:
            raise AssertionError("instrument control: wrong User-Agent got %d, not 403" % e.code)

# ---------------------------------------------------------------- module loading

def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError("cannot load module: %s" % path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def load_skill(skill, tag):
    """Import the three modules under test from `skill` under unique names."""
    mods = {}
    for fname in MODULES:
        key = fname[:-3]
        path = os.path.join(skill, fname)
        if not os.path.isfile(path):
            raise AssertionError("module under test is missing: %s" % path)
        mods[key] = load_module(path, "%s_%s" % (tag, key))
    return mods


def planted_copy(skill, fname, tag, replacements):
    """A copy of one module carrying exactly ONE planted defect (anchor must be unique)."""
    src = open(os.path.join(skill, fname), encoding="utf-8").read()
    for old, new in replacements:
        if src.count(old) != 1:
            raise AssertionError("plant anchor %r appears %d times in %s"
                                 % (old, src.count(old), fname))
        src = src.replace(old, new)
    out = os.path.join(TMP, "%s_%s" % (tag, fname))
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(src)
    return out


UA_LINE = 'STUDIO_USER_AGENT = "drama-studio-client/2.7.48 (+https://studio.zerohumanworkforce.com)"'

# ---------------------------------------------------------------- checks
# Every check raises on failure and returns a one-line detail on success.

def check_constant(mods, skill, base):
    vals = {k: getattr(mods[k], "STUDIO_USER_AGENT", None) for k in ("studio", "studio_check", "studio_bridge")}
    if vals != {"studio": EXPECTED, "studio_check": EXPECTED, "studio_bridge": EXPECTED}:
        raise AssertionError("the one User-Agent is not identical in all three modules: %r" % (vals,))
    return "studio.py == studio_check.py == studio_bridge.py == %r" % EXPECTED


def check_studio_pair(mods, skill, base):
    out = mods["studio"].call_pair(base, CODE)
    if not isinstance(out, dict):
        raise AssertionError("studio.call_pair returned %r" % (out,))
    if SEEN[-1] != EXPECTED:
        raise AssertionError("studio.call_pair sent User-Agent %r" % (SEEN[-1],))
    return "call_pair 200, User-Agent == the one string"


def check_studio_check(mods, skill, base):
    os.environ["DRAMA_STUDIO_URL"] = base
    os.environ.pop("DRAMA_STUDIO_FAKE", None)
    os.environ.pop("DRAMA_STUDIO_FAKE_LINE", None)
    out = mods["studio_check"].fetch_checkin()
    if not isinstance(out, dict) or "line" not in out:
        raise AssertionError("studio_check.fetch_checkin returned %r" % (out,))
    if SEEN[-1] != EXPECTED:
        raise AssertionError("studio_check.fetch_checkin sent User-Agent %r" % (SEEN[-1],))
    return "fetch_checkin 200, User-Agent == the one string"


def check_studio_bridge(mods, skill, base):
    status, body = mods["studio_bridge"]._http("GET", base + "/api/studio/health", timeout=10)
    if status != 200 or not body.get("ok"):
        raise AssertionError("studio_bridge._http returned (%r, %r)" % (status, body))
    if SEEN[-1] != EXPECTED:
        raise AssertionError("studio_bridge._http sent User-Agent %r" % (SEEN[-1],))
    return "_http 200, User-Agent == the one string"

# ---------------------------------------------------------------- plants (one per check)
# check name -> (module key it exercises, file on disk, the one textual defect to plant)

PLANTS = {
    "constant": ("studio", "studio.py",
                 [(UA_LINE, 'STUDIO_USER_AGENT = "drama-studio-client/0.0.0 (+https://example.invalid)"')]),
    "studio_pair": ("studio", "studio.py",
                    [('headers={"content-type": "application/json", "User-Agent": STUDIO_USER_AGENT},',
                      'headers={"content-type": "application/json"},')]),
    "studio_check": ("studio_check", "studio_check.py",
                     [('"User-Agent": STUDIO_USER_AGENT},', '},')]),
    "studio_bridge": ("studio_bridge", "studio_bridge.py",
                      [('    req.add_header("User-Agent", STUDIO_USER_AGENT)\n', '')]),
}

CHECKS = (
    ("constant", check_constant),
    ("studio_pair", check_studio_pair),
    ("studio_check", check_studio_check),
    ("studio_bridge", check_studio_bridge),
)


def run_check(fn, mods, skill, base):
    try:
        detail = fn(mods, skill, base)
        return True, detail
    except Exception as exc:                                   # noqa: BLE001
        return False, "%s: %s" % (type(exc).__name__, exc)


def main(argv):
    global TMP
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--skill", default=SKILL, help="the drama-studio skill folder under test")
    ap.add_argument("--tmp", default=os.environ.get("DRAMA_STUDIO_UA_TMP") or "/tmp")
    a = ap.parse_args(argv)
    skill = os.path.abspath(a.skill)
    for fname in MODULES:
        if not os.path.isfile(os.path.join(skill, fname)):
            sys.stderr.write("AF-DS-UA-PROVE: prover cannot run: module under test is missing: %s\n"
                             % os.path.join(skill, fname))
            return 3

    TMP = tempfile.mkdtemp(prefix=TMP_PREFIX, dir=a.tmp)
    srv, base = start_studio()
    try:
        try:
            instrument_control(base)
            print("ok    %-18s fake studio 403/1010 on the default User-Agent, 200 on the one string"
                  % "instrument")
        except Exception as exc:                               # noqa: BLE001
            sys.stderr.write("AF-DS-UA-PROVE: prover cannot run: instrument does not discriminate: "
                             "%s: %s\n" % (type(exc).__name__, exc))
            return 3

        mods = load_skill(skill, "ua_real")
        for name, fn in CHECKS:
            ok, detail = run_check(fn, mods, skill, base)
            if not ok:
                FAILED.append(name)
                print("FAIL  %-18s real run did not pass -- %s" % (name, detail))
                continue
            key, fname, repl = PLANTS[name]
            bad_path = planted_copy(skill, fname, "bad_" + name, repl)
            try:
                bad = {key: load_module(bad_path, "ua_bad_%s" % name)}
            except Exception as exc:                           # noqa: BLE001
                FAILED.append(name)
                print("FAIL  %-18s planted-bad copy would not import -- %s" % (name, exc))
                continue
            bad_mods = dict(mods)
            bad_mods[key] = bad[key]
            bad_ok, _ = run_check(fn, bad_mods, skill, base)
            if bad_ok:
                VACUOUS.append(name)
                print("VACUOUS %-16s planted-bad copy stayed green" % name)
            else:
                print("ok    %-18s real pass, planted-bad caught" % name)
    finally:
        srv.shutdown()
        srv.server_close()
        shutil.rmtree(TMP, ignore_errors=True)

    if FAILED or VACUOUS:
        sys.stderr.write("AF-DS-UA-PROVE: failed=%s vacuous=%s\n"
                         % (",".join(FAILED) or "-", ",".join(VACUOUS) or "-"))
        return 2
    print("prove_user_agent: %d checks, every planted-bad control caught" % len(CHECKS))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
