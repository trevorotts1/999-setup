#!/usr/bin/env python3
# prove_option2_monitor.py — the runnable proof for the Drama Studio Option-2 monitor (U14).
#
# It exercises the REAL studio_check.py in throwaway state folders under /tmp and, for every
# check, ALSO runs a planted-bad copy carrying exactly that one defect. A check only counts
# when the real run passes AND the planted-bad run is caught; a plant that stays green is
# vacuous and the prover exits 2.
#
# It installs, loads, enables or arms NOTHING. It registers no monitor live. It never sends a
# notice and writes no settings file anywhere. The studio is driven only through the FAKE
# knobs in studio_check.py.
#
# TWO RUNS. `--skill PATH` points the prover at another copy of the skill, so the SAME checks
# can be run against the pre-change script (they must fail) and the changed script (they must
# pass). The default is this prover's own skill folder.
#
#   python3 prove/prove_option2_monitor.py                 # the skill beside this file
#   python3 prove/prove_option2_monitor.py --skill <dir>   # any other copy of the skill
#
# EXIT CODES
#   0  every check passed and every planted-bad control was caught
#   2  a named check failed, or a planted-bad control was NOT caught (vacuous)
#   3  the prover could not run (a file under test is missing)
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

PY = sys.executable or "python3"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SKILL = os.path.dirname(HERE)

BOX = "trevor-macmini"
UNIT = "U14-U1"
ORDER_ID = "r_123"
ORDER_LINE = 'DRAMA_ORDER r_123 "Spring Sale"'
NOTICE_WORDS = ("Drama Studio", "Spring Sale")
FALLBACK_WORDS = ("skill-local permissions", "interactive approval", "Monitor tool")
SETTINGS_NAME = "option2-settings.json"

TMP = None
PLANTED = None
FAILED = []
VACUOUS = []


class PlantError(Exception):
    pass


# ---------------------------------------------------------------- helpers
def child_env(**kw):
    e = dict(os.environ)
    for k in ("CLAUDE_PLUGIN_ROOT", "DRAMA_STUDIO_SKILL_ROOT", "DRAMA_STUDIO_FAKE",
              "DRAMA_STUDIO_FAKE_LINE", "DRAMA_STUDIO_FAKE_DELAY", "DRAMA_STUDIO_FAKE_ERROR",
              "DRAMA_STUDIO_FAKE_CALLS", "DRAMA_STUDIO_FAKE_PAIR", "DRAMA_STUDIO_FAKE_OPTION",
              "DRAMA_STUDIO_URL", "DRAMA_STUDIO_DESKTOP_CMD", "DRAMA_STUDIO_OPTION",
              "DRAMA_STUDIO_SKILL_LOCAL_PERMS"):
        e.pop(k, None)
    e["DRAMA_STUDIO_FAKE"] = "1"
    # a planted-bad copy lives outside the skill folder: point the root at the real one so the
    # root guard is never what silences a planted copy (that would make the plant vacuous).
    e["DRAMA_STUDIO_SKILL_ROOT"] = SKILL
    for k, v in kw.items():
        if v is None:
            e.pop(k, None)
        else:
            e[k] = str(v)
    return e


def run(script, args, env, stdin="", timeout=60):
    t0 = time.monotonic()
    p = subprocess.run([PY, script] + args, input=stdin, env=env,
                       capture_output=True, text=True, timeout=timeout)
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


def plant(name, old, new):
    """Copy the script under test and make exactly one edit. A no-op plant -> error."""
    src = read(CHECK)
    if old not in src:
        raise PlantError("plant %s: anchor not found (the plant would be vacuous)" % name)
    dest = os.path.join(PLANTED, name + ".py")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(src.replace(old, new, 1))
    os.chmod(dest, 0o755)
    return dest


def watch(args, env, tag):
    sd = new_state(tag)
    env = dict(env)
    env["DRAMA_STUDIO_STATE"] = sd
    return run(CHECK, ["--watch", "--once"] + args, env)


def say(ok, name, why):
    tag = "PASS" if ok else "FAIL"
    print("%-4s %s%s" % (tag, name, (" — " + why) if why else ""))
    return ok


def announce_words(out):
    return all(w in out for w in NOTICE_WORDS)


def fallback_words(out):
    return all(w in out for w in FALLBACK_WORDS)


# ---------------------------------------------------------------- checks
def monitor_entries(path):
    """The monitors array at `path`, or a reason it is not a valid U14 watcher file."""
    try:
        data = json.loads(read(path))
    except Exception as exc:
        return None, "not JSON: %s" % exc
    if not isinstance(data, list) or not data:
        return None, "not a non-empty array"
    for entry in data:
        if not isinstance(entry, dict):
            return None, "an entry is not an object"
        for key in ("name", "command", "description"):
            if not entry.get(key):
                return None, "an entry is missing %s" % key
        if "studio_check.py" not in entry["command"] or "--watch" not in entry["command"]:
            return None, "an entry does not run studio_check.py --watch"
        if entry.get("when", "always") != "always":
            return None, "an entry is not armed at session start"
    return data, ""


def check_monitor_manifest():
    """U14 (delivery): monitors/monitors.json is the armed Option-2 watcher line."""
    path = os.path.join(SKILL, "monitors", "monitors.json")
    entries, why = monitor_entries(path)
    real_ok = entries is not None

    bad = os.path.join(TMP, "monitors-bad.json")
    with open(bad, "w", encoding="utf-8") as fh:
        json.dump([{"name": "drama-studio-option2"}], fh)      # no command, no description
    bad_entries, _ = monitor_entries(bad)
    planted_caught = bad_entries is None

    return say(real_ok and planted_caught, "monitor-manifest",
               "%s=%s | planted missing-command caught=%s"
               % (os.path.relpath(path, SKILL), real_ok, planted_caught))


def check_option_handling():
    """U14-a: the watcher acts for Option 2 alone; Option 1 and Option 3 stay silent."""
    env = child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    pos_ok = announce_words(watch(["--option", "2"], env, "a2")[1])
    one_ok = watch(["--option", "1"], env, "a1")[1].strip() == ""
    three_ok = watch(["--option", "3"], env, "a3")[1].strip() == ""
    env_default = child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE, DRAMA_STUDIO_OPTION="1")
    default_ok = watch([], env_default, "a4")[1].strip() == ""
    real_ok = pos_ok and one_ok and three_ok and default_ok
    evidence = ("option2 announces=%s option1 silent=%s option3 silent=%s env-option1 silent=%s"
                % (pos_ok, one_ok, three_ok, default_ok))
    if not real_ok:
        return say(False, "option-handling", "before-change: " + evidence)

    blind = plant("blind-option",
                  "    if option != WATCH_OPTION:", "    if False:")
    sd = new_state("a1p")
    env_p = child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    env_p["DRAMA_STUDIO_STATE"] = sd
    planted_caught = announce_words(run(blind, ["--watch", "--once", "--option", "1"], env_p)[1])
    return say(planted_caught, "option-handling",
               "%s | planted blind-option announced option1=%s caught=%s"
               % (evidence, planted_caught, planted_caught))


def check_watch_dedup():
    """U14-b: one line per order over many cycles; a copy that repeats is caught."""
    sd = new_state("b")
    env = child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    env["DRAMA_STUDIO_STATE"] = sd
    r1 = run(CHECK, ["--watch", "--once", "--option", "2"], env)
    r2 = run(CHECK, ["--watch", "--once", "--option", "2"], env)
    real_ok = announce_words(r1[1]) and r2[1].strip() == ""
    evidence = ("cycle1 announces=%s cycle2 silent=%s" % (announce_words(r1[1]), r2[1].strip() == ""))
    if not real_ok:
        return say(False, "watch-dedup", "before-change: " + evidence)

    dup = plant("repeat-order",
                "        if oid not in announced and oid not in claimed:",
                "        if oid not in claimed:")
    sd2 = new_state("bp")
    env2 = child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    env2["DRAMA_STUDIO_STATE"] = sd2
    run(dup, ["--watch", "--once", "--option", "2"], env2)
    r2b = run(dup, ["--watch", "--once", "--option", "2"], env2)
    planted_caught = announce_words(r2b[1])
    return say(planted_caught, "watch-dedup",
               "%s | planted repeat announced=%s caught=%s" % (evidence, planted_caught, planted_caught))


def check_claimed_state():
    """U14-c: an order recorded as picked up is never announced again, even by a fresh watcher."""
    # positive control first: the SAME state, no claim, DOES announce, so silence means something.
    control_ok = announce_words(watch(["--option", "2"], child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE), "c0")[1])

    # claim r_123, then watch with the order still waiting: it must stay silent.
    sd = new_state("c")
    env = child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE)
    rc_claim, _oc, _ec, _d = run(CHECK, ["--claim", ORDER_ID], dict(env, DRAMA_STUDIO_STATE=sd))
    r = run(CHECK, ["--watch", "--once", "--option", "2"], dict(env, DRAMA_STUDIO_STATE=sd))
    real_ok = rc_claim == 0 and r[1].strip() == ""
    evidence = ("control announces=%s | claimed then watch silent=%s (claim rc=%d)"
                % (control_ok, r[1].strip() == "", rc_claim))
    if not (control_ok and real_ok):
        return say(False, "claimed-state", "before-change: " + evidence)

    blind = plant("blind-claimed",
                  "        if oid not in announced and oid not in claimed:",
                  "        if oid not in announced:")
    sd2 = new_state("cp")
    run(blind, ["--claim", ORDER_ID], dict(env, DRAMA_STUDIO_STATE=sd2))
    r2 = run(blind, ["--watch", "--once", "--option", "2"], dict(env, DRAMA_STUDIO_STATE=sd2))
    planted_caught = announce_words(r2[1])
    return say(planted_caught, "claimed-state",
               "%s | planted blind-claimed announced=%s caught=%s"
               % (evidence, planted_caught, planted_caught))


def check_interactive_fallback():
    """U14-d: with no skill-local permissions the watcher stops with the interactive fallback,
    prints no order line, and writes no settings file; a copy that ignores it is caught."""
    unsupported = child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE, DRAMA_STUDIO_SKILL_LOCAL_PERMS="unsupported")
    control_ok = announce_words(
        watch(["--option", "2"], child_env(DRAMA_STUDIO_FAKE_LINE=ORDER_LINE), "d0")[1])

    sd = new_state("d")
    env = dict(unsupported)
    env["DRAMA_STUDIO_STATE"] = sd
    rc, out, _e, _d = run(CHECK, ["--watch", "--once", "--option", "2"], env)
    real_ok = rc == 0 and fallback_words(out) and not announce_words(out)
    stray = sorted(f for f in os.listdir(sd) if "settings" in f)
    evidence = ("control announces=%s | unsupported prints fallback=%s order-line=%s rc=%d no-settings=%s"
                % (control_ok, fallback_words(out), announce_words(out), rc, not stray))
    if not (control_ok and real_ok):
        return say(False, "interactive-fallback", "before-change: " + evidence)

    blind = plant("blind-fallback",
                  "    if not skill_local_perms_ok(st):", "    if False:")
    sd2 = new_state("dp")
    env2 = dict(unsupported)
    env2["DRAMA_STUDIO_STATE"] = sd2
    r2 = run(blind, ["--watch", "--once", "--option", "2"], env2)
    planted_caught = announce_words(r2[1]) and not fallback_words(r2[1])
    return say(planted_caught, "interactive-fallback",
               "%s | planted ignored fallback caught=%s" % (evidence, planted_caught))


def frontmatter_tools(text):
    m = re.search(r"^---\n(.*?)\n---\n", text, re.S | re.M)
    if not m:
        return ""
    a = re.search(r"^allowed-tools:\s*(.+)$", m.group(1), re.M)
    return a.group(1) if a else ""


def walk_names(root, needle):
    hits = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if needle in fn:
                hits.append(os.path.join(dirpath, fn))
    return hits


def code_lines(text):
    """The text without full-line comments, so a comment naming a settings file is not a write."""
    return "\n".join(ln for ln in text.splitlines() if not ln.strip().startswith("#"))


def check_skill_local_only():
    """The U14 hard constraints: permissions are skill-local only, and no option2-settings.json
    exists anywhere; the scripts never write to a settings file. Guards, expected before AND after."""
    tools = frontmatter_tools(read(SKILLMD))
    tools_ok = all(t in tools for t in ("Read", "studio.py", "studio_check.py"))

    stray = walk_names(SKILL, SETTINGS_NAME)
    no_stray = stray == []

    named = [rel for rel in ("studio_check.py", "studio.py", "monitors/monitors.json")
             if "settings.json" in code_lines(read(os.path.join(SKILL, *rel.split("/"))))]
    scripts_clean = named == []

    # planted controls: a stripped allowed-tools line, a planted settings file, and a real
    # settings write planted as CODE in a copy of the script under test.
    stripped = re.sub(r"^allowed-tools:.*$", "", read(SKILLMD), count=1, flags=re.M)
    tools_caught = "studio_check.py" not in frontmatter_tools(stripped)
    if frontmatter_tools(stripped) == tools:
        raise PlantError("plant stripped-tools had no effect")

    plantdir = os.path.join(TMP, "planted-skill")
    os.makedirs(plantdir, exist_ok=True)
    with open(os.path.join(plantdir, SETTINGS_NAME), "w", encoding="utf-8") as fh:
        fh.write("{}\n")
    file_caught = walk_names(plantdir, SETTINGS_NAME) != []

    write_bad = os.path.join(TMP, "settings-write.py")
    with open(write_bad, "w", encoding="utf-8") as fh:
        fh.write(read(CHECK) + '\nopen(os.path.join(sd, "settings.json"), "w")\n')
    write_caught = "settings.json" in code_lines(read(write_bad))

    ok = tools_ok and no_stray and scripts_clean and tools_caught and file_caught and write_caught
    return say(ok, "skill-local-only",
               "allowed-tools skill-local=%s | no %s in tree=%s | scripts write no settings file=%s"
               " | planted stripped-tools caught=%s planted settings-file caught=%s"
               " planted settings-write caught=%s"
               % (tools_ok, SETTINGS_NAME, no_stray, scripts_clean,
                  tools_caught, file_caught, write_caught))


CHECKS = [
    check_monitor_manifest,
    check_option_handling,
    check_watch_dedup,
    check_claimed_state,
    check_interactive_fallback,
    check_skill_local_only,
]


def usage(code=3):
    print("usage: prove_option2_monitor.py [--skill DIR]", file=sys.stderr)
    return code


def main(argv):
    global TMP, PLANTED, SKILL, CHECK, SKILLMD
    skill = DEFAULT_SKILL
    i = 0
    while i < len(argv):
        if argv[i] == "--skill" and i + 1 < len(argv):
            skill = argv[i + 1]
            i += 2
            continue
        if argv[i] in ("-h", "--help"):
            return usage(0)
        return usage(3)
    SKILL = os.path.abspath(skill)
    CHECK = os.path.join(SKILL, "studio_check.py")
    SKILLMD = os.path.join(SKILL, "SKILL.md")
    for p in (CHECK, SKILLMD):
        if not os.path.isfile(p):
            print("PROVER cannot run: missing %s" % p, file=sys.stderr)
            return 3
    TMP = tempfile.mkdtemp(prefix="%s-%s-" % (BOX, UNIT), dir="/tmp")
    PLANTED = os.path.join(TMP, "planted")
    os.makedirs(PLANTED, exist_ok=True)
    print("prover skill: %s" % SKILL)
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
                print("FAIL %s — a run exceeded its timeout" % fn.__name__)
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
    sys.exit(main(sys.argv[1:]))
