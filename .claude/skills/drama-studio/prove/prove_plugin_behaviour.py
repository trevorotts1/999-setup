#!/usr/bin/env python3
# prove_plugin_behaviour.py — the runnable proof for the Drama Studio skill plugin (U13).
#
# It exercises the REAL scripts in a throwaway state folder under /tmp and, for every
# check, ALSO runs a planted-bad copy that carries exactly that one defect. A check is
# only counted as proof when the real run passes AND the planted-bad run is caught. If a
# planted-bad copy stays green the check is vacuous and the prover exits 2.
#
# It installs, loads or enables NOTHING anywhere. It registers nothing live. It never
# sends a notice: the desktop sink is pointed at a scratch file, and the studio is driven
# through the FAKE knobs in studio_check.py / studio.py.
#
# EXIT CODES
#   0  every check passed and every planted-bad control was caught
#   2  a named check failed, a planted-bad control was NOT caught, or a plant was vacuous
#   3  the prover could not run (a script under test is missing)
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

PY = sys.executable or "python3"
HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
CHECK = os.path.join(SKILL, "studio_check.py")
PAIR = os.path.join(SKILL, "studio.py")
SKILLMD = os.path.join(SKILL, "SKILL.md")
HOOKSJSON = os.path.join(SKILL, "hooks", "hooks.json")
PLUGINJSON = os.path.join(SKILL, ".claude-plugin", "plugin.json")

BOX = "trevor-macmini"
UNIT = "U13-U1"
ORDER_LINE = 'DRAMA_ORDER r_123 "Spring Sale"'
NOTICE_WORDS = ("Drama Studio", "Spring Sale")

TMP = None          # the whole run's scratch root
PLANTED = None      # planted-bad copies
FAILED = []
VACUOUS = []


class PlantError(Exception):
    pass


# ---------------------------------------------------------------- helpers
def child_env(**kw):
    e = dict(os.environ)
    for k in ("CLAUDE_PLUGIN_ROOT", "DRAMA_STUDIO_SKILL_ROOT", "DRAMA_STUDIO_FAKE",
              "DRAMA_STUDIO_FAKE_LINE", "DRAMA_STUDIO_FAKE_DELAY", "DRAMA_STUDIO_FAKE_ERROR",
              "DRAMA_STUDIO_FAKE_CALLS", "DRAMA_STUDIO_FAKE_PAIR", "DRAMA_STUDIO_URL",
              "DRAMA_STUDIO_DESKTOP_CMD"):
        e.pop(k, None)
    e["DRAMA_STUDIO_FAKE"] = "1"
    # a planted-bad copy lives outside the skill folder, so point the root at the real
    # one: the root guard must not be what silences a planted copy (that would be vacuous).
    e["DRAMA_STUDIO_SKILL_ROOT"] = SKILL
    for k, v in kw.items():
        if v is None:
            e.pop(k, None)
        else:
            e[k] = str(v)
    return e


def run(script, args, env, stdin="", cwd=None):
    t0 = time.monotonic()
    p = subprocess.run([PY, script] + args, input=stdin, env=env, cwd=cwd,
                       capture_output=True, text=True, timeout=60)
    return p.returncode, p.stdout, p.stderr, time.monotonic() - t0


def new_state(tag):
    d = os.path.join(TMP, "state-" + tag)
    os.makedirs(d, exist_ok=True)
    return d


def read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except Exception:
        return ""


def plant(script, name, old, new):
    """Copy `script` to a planted-bad copy and make exactly one edit. Vacuous plant -> error."""
    src = read(script)
    if old not in src:
        raise PlantError("plant %s: anchor not found (the plant would be vacuous)" % name)
    dest = os.path.join(PLANTED, name + ".py")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(src.replace(old, new, 1))
    os.chmod(dest, 0o755)
    return dest


def make_sink(path):
    """A one-argument sink program for DRAMA_STUDIO_DESKTOP_CMD (no shell quoting games)."""
    py = path + ".sink.py"
    with open(py, "w", encoding="utf-8") as fh:
        fh.write("import sys\nopen(%r, 'a').write(sys.argv[1] + chr(10))\n" % path)
    return "%s %s \"$1\"" % (shlex.quote(PY), shlex.quote(py))


def say(ok, name, why):
    tag = "PASS" if ok else "FAIL"
    print("%-4s %s%s" % (tag, name, (" — " + why) if why else ""))
    return ok


# ---------------------------------------------------------------- checks
def check_hook_budget():
    """(a1) the hook stays inside its 10-second budget; a slow copy is rejected."""
    sd = new_state("a1")
    env = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    rc, out, _err, dt = run(CHECK, ["--hook"], env, stdin='{"source":"startup","session_id":"s1"}')
    real_ok = rc == 0 and any(w in out for w in NOTICE_WORDS) and dt < 10.0

    slow = plant(CHECK, "slow-hook",
                 "def hook_work(session_id, sd):\n    st = load_state(sd)",
                 "def hook_work(session_id, sd):\n    time.sleep(11)\n    st = load_state(sd)")
    sd2 = new_state("a1p")
    env2 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    rc2, out2, _e2, dt2 = run(slow, ["--hook"], env2, stdin='{"source":"startup","session_id":"s1"}')
    planted_caught = (out2.strip() == "" and dt2 <= 10.5)

    return say(real_ok and planted_caught, "hook-10s-budget",
               "real=%.2fs notice=%s | planted slow rejected=%s (%.2fs, %d chars out)"
               % (dt, real_ok, planted_caught, dt2, len(out2.strip())))


def check_network_budget():
    """(a2) the network call stays inside its 3-second budget; a copy that raises it is caught."""
    sd = new_state("a2")
    env = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE, DRAMA_STUDIO_FAKE_DELAY="5")
    rc, out, _err, dt = run(CHECK, ["--hook"], env, stdin='{"source":"startup","session_id":"s1"}')
    real_ok = rc == 0 and out.strip() == "" and 2.0 <= dt <= 4.5

    loose = plant(CHECK, "loose-network",
                  "NETWORK_BUDGET_S = 3.0", "NETWORK_BUDGET_S = 9.0")
    sd2 = new_state("a2p")
    env2 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE, DRAMA_STUDIO_FAKE_DELAY="5")
    rc2, out2, _e2, dt2 = run(loose, ["--hook"], env2, stdin='{"source":"startup","session_id":"s1"}')
    planted_caught = not (out2.strip() == "" and dt2 <= 4.5)

    return say(real_ok and planted_caught, "network-3s-budget",
               "real silent in %.2fs | planted (budget 9s) caught=%s (%.2fs, notice=%s)"
               % (dt, planted_caught, dt2, out2.strip() != ""))


def check_error_silence():
    """(b) an error produces SILENCE; a copy that leaks the error is caught."""
    sd = new_state("b")
    env = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_FAKE_ERROR="1")
    rc, out, err, _dt = run(CHECK, ["--hook"], env, stdin='{"source":"startup","session_id":"s1"}')
    real_ok = rc == 0 and out.strip() == ""

    loud = plant(CHECK, "loud-error",
                 "        return run_budget(lambda: hook_work(sid, sd), HOOK_BUDGET_S)\n"
                 "    except BaseException:\n        return None",
                 "        return run_budget(lambda: hook_work(sid, sd), HOOK_BUDGET_S)\n"
                 "    except BaseException as exc:\n"
                 "        sys.stdout.write('studio error: %s\\n' % exc)\n        return None")
    sd2 = new_state("bp")
    env2 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_FAKE_ERROR="1")
    rc2, out2, _e2, _d2 = run(loud, ["--hook"], env2, stdin='{"source":"startup","session_id":"s1"}')
    planted_caught = out2.strip() != ""

    return say(real_ok and planted_caught, "error-silence",
               "real rc=%d silent=%s | planted leak caught=%s" % (rc, real_ok, planted_caught))


def check_session_dedup():
    """(c) the same session cannot announce twice; a copy that double-announces is caught."""
    sd = new_state("c")
    env = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    hook_in = '{"source":"startup","session_id":"s1"}'
    rc1, out1, _e, _d = run(CHECK, ["--hook"], env, stdin=hook_in)
    rc2, out2, _e, _d = run(CHECK, ["--hook"], env, stdin=hook_in)
    real_ok = rc1 == 0 and any(w in out1 for w in NOTICE_WORDS) and rc2 == 0 and out2.strip() == ""

    dup = plant(CHECK, "double-announce",
                '    if (st.get("announced") or {}).get(key):\n        return None',
                '    if False:\n        return None')
    sd2 = new_state("cp")
    env2 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    _r1, _o1, _e1, _d1 = run(dup, ["--hook"], env2, stdin=hook_in)
    _r2, o2, _e2, _d2 = run(dup, ["--hook"], env2, stdin=hook_in)
    planted_caught = o2.strip() != ""

    return say(real_ok and planted_caught, "session-order-dedup",
               "real first=notice second=silent=%s | planted double announced caught=%s"
               % (out2.strip() == "", planted_caught))


def check_cache():
    """(d) the 60-second cache skips the network; a copy that ignores the cache is caught."""
    sd = new_state("d")
    calls = os.path.join(TMP, "calls-d.txt")
    env = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE, DRAMA_STUDIO_FAKE_CALLS=calls)
    run(CHECK, ["--hook"], env, stdin='{"source":"startup","session_id":"s1"}')
    n1 = len(read(calls).splitlines())
    # a NEW session within the cache window: dedup does not apply, so the only thing that
    # can keep the network quiet is the cache.
    env2 = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE,
                     DRAMA_STUDIO_FAKE_CALLS=calls, DRAMA_STUDIO_FAKE_DELAY="5")
    rc2, out2, _e, dt2 = run(CHECK, ["--hook"], env2, stdin='{"source":"startup","session_id":"s2"}')
    n2 = len(read(calls).splitlines())
    real_ok = n1 == 1 and n2 == 1 and rc2 == 0 and dt2 < 3.0 and any(w in out2 for w in NOTICE_WORDS)

    nocache = plant(CHECK, "no-cache", "CACHE_SECONDS = 60.0", "CACHE_SECONDS = 0.0")
    sd2 = new_state("dp")
    calls2 = os.path.join(TMP, "calls-dp.txt")
    env3 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE, DRAMA_STUDIO_FAKE_CALLS=calls2)
    run(nocache, ["--hook"], env3, stdin='{"source":"startup","session_id":"s1"}')
    env4 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_FAKE_LINE=ORDER_LINE,
                     DRAMA_STUDIO_FAKE_CALLS=calls2, DRAMA_STUDIO_FAKE_DELAY="5")
    run(nocache, ["--hook"], env4, stdin='{"source":"startup","session_id":"s2"}')
    n_p = len(read(calls2).splitlines())
    planted_caught = n_p == 2

    return say(real_ok and planted_caught, "60s-cache",
               "real calls=%d->%d (cached, %.2fs) | planted calls=%d caught=%s"
               % (n1, n2, dt2, n_p, planted_caught))


def check_desktop_optin():
    """(e) no opt-in means NO desktop notice; a copy that notifies anyway is caught."""
    sink = os.path.join(TMP, "desktop-sink.txt")
    cmd = make_sink(sink)
    sd = new_state("e")
    # opt-in OFF but an order cached: the notice must NOT fire.
    with open(os.path.join(sd, "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"cached_line": ORDER_LINE}, fh)
    env = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_DESKTOP_CMD=cmd)
    rc, out, _err, _dt = run(CHECK, ["--desktop"], env)
    off_ok = rc == 0 and out.strip() == "" and read(sink).strip() == ""

    # opt-in ON: it fires, once.
    with open(os.path.join(sd, "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"cached_line": ORDER_LINE, "desktop_opt_in": True}, fh)
    rc2, out2, _e, _d = run(CHECK, ["--desktop"], env)
    fired = read(sink).strip()
    on_ok = rc2 == 0 and out2.strip() != "" and "Open Claude Code" in fired

    always = plant(CHECK, "always-notify",
                   "    if not st.get(\"desktop_opt_in\"):\n        return None",
                   "    if False:\n        return None")
    sink2 = os.path.join(TMP, "desktop-sink-p.txt")
    cmd2 = make_sink(sink2)
    sd2 = new_state("ep")
    with open(os.path.join(sd2, "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"cached_line": ORDER_LINE}, fh)      # still NO opt-in
    env2 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_DESKTOP_CMD=cmd2)
    run(always, ["--desktop"], env2)
    planted_caught = read(sink2).strip() != ""

    return say(off_ok and on_ok and planted_caught, "desktop-opt-in",
               "no-opt-in silent=%s | opt-in fired=%s | planted ignoring opt-in caught=%s"
               % (off_ok, on_ok, planted_caught))


def desc_words(text):
    m = re.search(r"^---\n(.*?)\n---\n", text, re.S | re.M)
    if not m:
        return -1
    fm = m.group(1)
    d = re.search(r"^description:\s*>\s*\n(.*?)(?=^[A-Za-z0-9_-]+:)", fm, re.S | re.M)
    if not d:
        d = re.search(r"^description:\s*(.+)$", fm, re.M)
        return len(d.group(1).split()) if d else -1
    return len(d.group(1).split())


def check_about_words():
    """(f) the about/description text is about 300 words."""
    n = desc_words(read(SKILLMD))
    real_ok = 250 <= n <= 350

    planted = os.path.join(TMP, "SKILL-short.md")
    short = re.sub(r"^description:\s*>\s*\n(.*?)(?=^[A-Za-z0-9_-]+:)",
                   "description: >\n  A short one.\n", read(SKILLMD), count=1, flags=re.S | re.M)
    with open(planted, "w", encoding="utf-8") as fh:
        fh.write(short)
    n_p = desc_words(short)
    if n_p == n:
        raise PlantError("plant SKILL-short had no effect")
    planted_caught = not (250 <= n_p <= 350)

    return say(real_ok and planted_caught, "about-300-words",
               "real=%d words | planted=%d words caught=%s" % (n, n_p, planted_caught))


def allowed_tools(text):
    m = re.search(r"^---\n(.*?)\n---\n", text, re.S | re.M)
    if not m:
        return ""
    a = re.search(r"^allowed-tools:\s*(.+)$", m.group(1), re.M)
    return a.group(1) if a else ""


def check_state_root_tools():
    """(g) state, root and allowed-tools are correct, and a wrong root is refused."""
    # root: the real skill root prints; a folder without the markers is refused.
    rc, out, _e, _d = run(CHECK, ["--print-root", "--root", SKILL], child_env())
    root_ok = rc == 0 and os.path.realpath(out.strip()) == os.path.realpath(SKILL)

    bad = os.path.join(TMP, "not-the-skill")
    os.makedirs(bad, exist_ok=True)
    rc2, out2, err2, _d2 = run(CHECK, ["--print-root", "--root", bad], child_env())
    refuse_ok = rc2 == 2 and "AF-DS-ROOT" in err2 and out2.strip() == ""

    # state: the protected folder, distinct from the root.
    rc3, out3, _e3, _d3 = run(CHECK, ["--print-state"], child_env())
    state_ok = rc3 == 0 and os.path.basename(out3.strip()) == ".drama-studio" \
        and os.path.realpath(out3.strip()) != os.path.realpath(SKILL)

    # the hook itself is silent when it is run from a wrong root.
    rc4, out4, _e4, _d4 = run(CHECK, ["--hook", "--root", bad], child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE),
                              stdin='{"source":"startup","session_id":"s1"}')
    wrong_root_hook_ok = rc4 == 0 and out4.strip() == ""

    at = allowed_tools(read(SKILLMD))
    tools_ok = ("Read" in at) and ("studio.py" in at) and ("studio_check.py" in at)

    planted_md = os.path.join(TMP, "SKILL-no-tools.md")
    stripped = re.sub(r"^allowed-tools:.*$", "", read(SKILLMD), count=1, flags=re.M)
    with open(planted_md, "w", encoding="utf-8") as fh:
        fh.write(stripped)
    planted_caught = "studio.py" not in allowed_tools(stripped)
    if allowed_tools(stripped) == at:
        raise PlantError("plant SKILL-no-tools had no effect")

    ok = root_ok and refuse_ok and state_ok and wrong_root_hook_ok and tools_ok and planted_caught
    return say(ok, "state-root-allowed-tools",
               "root=%s wrong-refused=%s state=%s hook-wrong-root-silent=%s tools=%s planted caught=%s"
               % (root_ok, refuse_ok, state_ok, wrong_root_hook_ok, tools_ok, planted_caught))


def check_no_secret_printed():
    """(h) pairing stores the key 600 and never prints it; a copy that prints it is caught."""
    sd = new_state("h")
    canned = json.dumps({"ok": True, "key": "FAKE-KEY-NOT-REAL", "client_id": "c_1"})
    env = child_env(DRAMA_STUDIO_STATE=sd, DRAMA_STUDIO_FAKE_PAIR=canned)
    rc, out, err, _dt = run(PAIR, ["pair", "ABCD-2345", "--studio", "http://drama.invalid"], env)
    keyfile = os.path.join(sd, "machine.key")
    mode = oct(os.stat(keyfile).st_mode & 0o777) if os.path.isfile(keyfile) else "missing"
    stored = read(keyfile).strip()
    real_ok = (rc == 0 and "FAKE-KEY-NOT-REAL" not in out and "FAKE-KEY-NOT-REAL" not in err
               and stored == "FAKE-KEY-NOT-REAL" and mode == "0o600")

    rc_bad, _ob, err_bad, _db = run(PAIR, ["pair", "nope"], child_env(DRAMA_STUDIO_STATE=new_state("h2")))
    shape_ok = rc_bad == 2 and "AF-DS-PAIR-SHAPE" in err_bad

    loud = plant(PAIR, "loud-key",
                 '    sys.stdout.write("Drama Studio paired (%s). The key is stored on this computer'
                 ' and was not printed.\\n"\n                     % out.get("client_id", "client"))',
                 '    sys.stdout.write("key=%s\\n" % out["key"])')
    sd2 = new_state("hp")
    env2 = child_env(DRAMA_STUDIO_STATE=sd2, DRAMA_STUDIO_FAKE_PAIR=canned)
    _rc2, out2, _e2, _d2 = run(loud, ["pair", "ABCD-2345", "--studio", "http://drama.invalid"], env2)
    planted_caught = "FAKE-KEY-NOT-REAL" in out2

    return say(real_ok and shape_ok and planted_caught, "pair-no-secret-printed",
               "mode=%s stored=%s real silent=%s shape-refused=%s planted leak caught=%s"
               % (mode, bool(stored), real_ok, shape_ok, planted_caught))


def check_plugin_shape():
    """(extra) the plugin manifests parse and the hook budget in hooks.json is 10s."""
    try:
        plugin = json.loads(read(PLUGINJSON))
        hooks = json.loads(read(HOOKSJSON))
    except Exception as exc:
        return say(False, "plugin-shape", "manifest not JSON: %s" % exc)
    ss = (hooks.get("hooks") or {}).get("SessionStart") or []
    entry = (ss[0].get("hooks") or [{}])[0] if ss else {}
    budget_ok = entry.get("timeout") == 10 and "studio_check.py" in str(entry.get("command", ""))
    one_hook = len(ss) == 1
    name_ok = plugin.get("name") == "drama-studio"
    version_free = "version" not in plugin      # the batch PR owns the bump (JOINT PLAN 5.3.2)
    ok = budget_ok and one_hook and name_ok and version_free
    return say(ok, "plugin-shape",
               "name=%s session-hook=%d timeout=%s version-free=%s"
               % (plugin.get("name"), len(ss), entry.get("timeout"), version_free))


CHECKS = [
    check_hook_budget,
    check_network_budget,
    check_error_silence,
    check_session_dedup,
    check_cache,
    check_desktop_optin,
    check_about_words,
    check_state_root_tools,
    check_no_secret_printed,
    check_plugin_shape,
]


def main():
    global TMP, PLANTED
    for p in (CHECK, PAIR, SKILLMD, HOOKSJSON, PLUGINJSON):
        if not os.path.isfile(p):
            print("PROVER cannot run: missing %s" % p, file=sys.stderr)
            return 3
    TMP = tempfile.mkdtemp(prefix="%s-%s-" % (BOX, UNIT))
    PLANTED = os.path.join(TMP, "planted")
    os.makedirs(PLANTED, exist_ok=True)
    print("prover scratch: %s" % TMP)
    try:
        for fn in CHECKS:
            try:
                if not fn():
                    FAILED.append(fn.__name__)
            except PlantError as exc:
                VACUOUS.append("%s: %s" % (fn.__name__, exc))
                print("FAIL %s — %s" % (fn.__name__, exc))
            except subprocess.TimeoutExpired:
                FAILED.append(fn.__name__)
                print("FAIL %s — a run exceeded 60s" % fn.__name__)
        print("-" * 72)
        total = len(CHECKS)
        if VACUOUS:
            for v in VACUOUS:
                print("VACUOUS PLANT: %s" % v)
            return 2
        if FAILED:
            print("prover: %d/%d checks failed: %s" % (len(FAILED), total, ", ".join(FAILED)))
            return 2
        print("prover: %d/%d checks passed, every planted-bad control was caught" % (total, total))
        return 0
    finally:
        shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
