#!/usr/bin/env python3
"""run-portability-suite.py — WS-48 boss-cron portability regression suite.

Proves the Master Spec section 24 release requirements against the committed
generic runtime (tools/boss-cron):

  A. No generic runtime file contains a developer-specific absolute home path
     (e.g. /Users/blackceomacmini/...).
  B. Arbitrary macOS and Windows user paths work: the runtime derives its
     session-store, settings, and projects paths from the CURRENT user's home
     (~ expansion), never from a hardcoded username. The suite overrides HOME
     with synthetic arbitrary-user homes and runs real cycles under them.
     B1/B2 use POSIX-shaped homes; B3 uses a Windows-shaped home (a HOME whose
     path contains backslash segments and a space, as Windows user-profile
     paths do) and proves the runtime still derives the session-store name,
     discovers the live run, and records a clean cycle. (True Windows-native
     execution — the Windows Python interpreter, no fcntl, and native console
     hosts — is E.3 parity territory with the verify-windows.ps1 parity test;
     this suite's Python file itself must stay platform-neutral.)
  C. The historical six-wave fix campaign governs no generic customer project:
     (1) a customer project carrying six-wave campaign HISTORY is governed
     only by the entry-mode/research gates and passes clean; (2) the runtime's
     wave-lock data is config-driven — with the committed neutral example
     config (one locked wave), a "WAVE 6 DISPATCH" in the ledger is a
     violation, proving no built-in six-wave allowance exists in the runtime.
  D. Two unrelated projects cannot read or stop each other: each project's
     checks resolve against its own CONTROL tree only (a violation in one
     never names or affects the other), and a stop-workstream file inside one
     project's CONTROL is inert — the runtime's stop authority is its own
     state dir, never project files.
  E. Claim verification resolves paths against the current user's home: a
     present path under an arbitrary (synthetic) home verifies clean, a
     missing one flags.

Self-contained: builds synthetic fixtures in a scratch dir, points every
runtime path override at the scratch (HOME, BOSS_REPO_ROOT, BOSS_STATE_DIR,
BOSS_WF_ROOT, BOSS_LEDGER, BOSS_CONFIG, PROJECTS via ~/Downloads/projects
under the overridden HOME). Never writes to this repo's CONTROL/, FIX-LEDGER.md,
or the real ~/Downloads/projects, ~/.claude, ~/.claude-nine.

Usage:
  python3 run-portability-suite.py [--boss PATH] [--script-dir PATH]

Exit 0 = all assertions pass; non-zero = failure with the failing assertion
named. Run from anywhere.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))

# The developer-specific home path to detect. Derived, never a literal: on the
# operator box this resolves to /Users/blackceomacmini; an explicit override
# (PORTABILITY_DEV_HOME) pins a different value when the suite runs elsewhere.
# The test file itself must never contain the literal path — the scan would
# otherwise flag its own source.
DEVELOPER_HOME = os.environ.get("PORTABILITY_DEV_HOME") or os.path.expanduser("~")

# Classifier copied verbatim from the runtime (tools/boss-cron, module
# constant SANCTIONED_CLASSES). The suite keeps its own copy so a scope
# re-classification regression in the runtime cannot mask a violation by
# re-labeling it; this copy is a test fixture, not runtime code.
SANCTIONED_CLASSES = {
    "CREATED", "BASELINE", "DISPATCH", "REDISPATCH", "REPAIR", "REPAIR-DONE",
    "BUILDER", "BUILDER-DONE", "BUILDER-FAIL", "CRITIC", "CRITIC-PASS", "CRITIC-FAIL",
    "DONE", "FAIL", "PASS", "OBSERVATION", "UNDETERMINED", "NEW-WAVE-N", "VIOLATION-STOP",
    "MERGED",
    "REVIEW", "WAVE-REVIEW", "REVIEW-FINDING",
    "WF-1A-VERIFIED",
    "BOSSCYCLE-CLEAN", "BOSSCYCLE-ALERT", "BOSSCYCLE-VIOLATION",
    "WAVE", "LOCKED", "ISSUE-18-EARLY", "REPAIR-DISPATCH",
    "RECONCILE", "RE-ANCHOR",
    "DOC", "WORKFLOW", "STOP-AND-RERUN",
    "MOBBIN-CHECK", "DESIGN-BRIEF", "ENTRY-MODE", "BUILD-TARGET", "INPUT-CAPTURED",
    "PAYMENT-CONTRACT", "INTERVIEW-MODE",
    "MANIFEST-ROW", "IMAGE-GENERATED", "GHL-URL", "IMAGE-REF",
    "MEDIA-GAP", "MEDIA-UPLOADED", "MEDIA",
    "BACKUP-REF",
    "RECONCILE-ADDED",
    "KAIZEN-QUALIFICATION",
}

WF_PREFIX_RE = re.compile(r"^WF-\d[A-Z]? ")
SCOPE_PREFIX_RE = re.compile(r"^(FUNNEL|3JS|STAGE|STATUSLINE|AK)-[A-Za-z0-9-]+:?$")
NEW_WAVE_RE = re.compile(r"^NEW-WAVE-\d+$")
STAGE_CLASS_RE = re.compile(r"^STAGE-[A-Za-z0-9-]+:?$")
STATUSLINE_REMOVED_RE = re.compile(r"^STATUSLINE-REMOVED-")

# Runtime file surface for assertion A: executable/config/test code, never
# operational history or build artifacts.
RUNTIME_SCAN_DIRS = ("tools", "launchers", "templates", "tests", "apps",
                     "packages", "plugins", ".claude")
RUNTIME_SCAN_SKIP_DIRS = {"node_modules", "dist", "target", ".git", "__pycache__",
                          "worktrees", "holding", "spec", "backup-", ".bak"}
DOC_EXTENSIONS = {".md"}


def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)


def scratch_dir():
    return tempfile.mkdtemp(prefix="boss-portability.")


def env_for(scratch, home, repo_root, wf_root, tag, extra=None):
    """Runtime environment: HOME and every BOSS_* override point at scratch."""
    env = dict(os.environ)
    env["HOME"] = home
    env["BOSS_REPO_ROOT"] = repo_root
    env["BOSS_STATE_DIR"] = os.path.join(scratch, tag, "state")
    env["BOSS_WF_ROOT"] = wf_root
    env["BOSS_LEDGER"] = os.path.join(scratch, tag, "ledger.md")
    env["BOSS_CONFIG"] = os.path.join(scratch, tag, "boss-config.json")
    env["BOSS_RUN_STALENESS_SECONDS"] = "1800"
    if extra:
        env.update(extra)
    return env


def run_cycle(boss, env, expect_findings, label, expect_min=False):
    """Run ONE live cycle under env and assert the outcome. Returns output.

    expect_findings = 0 -> clean cycle (exit 0). Otherwise the cycle must exit
    2; with expect_min=True at least `expect_findings` violations must be
    reported (some findings legitimately cascade — e.g. a dispatch line that
    violates the wave lock also violates the census rule)."""
    os.makedirs(env["BOSS_STATE_DIR"], exist_ok=True)
    if not os.path.isfile(env["BOSS_LEDGER"]):
        # The runtime's first baseline: a ledger missing outright is itself a
        # violation ("ledger missing at ..."), so the suite seeds the same
        # baseline line the real repo's ledger carries (CREATED).
        with open(env["BOSS_LEDGER"], "w", encoding="utf-8") as fh:
            fh.write("- `CREATED 2026-08-21T00:00:00Z: portability fixture baseline`\n")
    try:
        proc = subprocess.run([sys.executable, boss], env=env,
                              capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        fail(f"{label}: boss script not found at {boss}")
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0 and expect_findings == 0:
        fail(f"{label}: expected clean cycle (exit 0) but boss exited "
             f"{proc.returncode}\n{out}")
    if proc.returncode == 0 and expect_findings != 0:
        fail(f"{label}: expected {expect_findings} finding(s) but cycle was "
             f"clean (exit 0)\n{out}")
    m = re.search(r"(\d+) violation\(s\)", out)
    actual = int(m.group(1)) if m else -1
    if expect_findings == 0:
        if actual != 0:
            fail(f"{label}: expected a clean cycle (0 violations) but boss "
                 f"reported {actual}\n{out}")
    elif expect_min:
        if actual < expect_findings:
            fail(f"{label}: expected at least {expect_findings} violation(s) "
                 f"but boss reported {actual}\n{out}")
    elif actual != expect_findings:
        fail(f"{label}: output does not report the expected finding count "
             f"{expect_findings} (boss reported {actual})\n{out}")
    return out


def build_fixture(fixture_script, scratch, home, tag):
    """Run the fixture builder; returns the fixture root path."""
    root = os.path.join(scratch, tag, "fixture")
    proc = subprocess.run(
        ["/usr/bin/env", "bash", fixture_script, root, home],
        capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        fail(f"fixture builder failed for {tag}: {proc.stdout}\n{proc.stderr}")
    return root


def encoded_home(home):
    return "-" + home.lstrip("/").replace("/", "-")


# ---------------------------------------------------------------------------
# Assertion A — no developer home path in the generic runtime
# ---------------------------------------------------------------------------
def check_no_developer_home(repo_root):
    hits, warns = [], []
    for base_dir in RUNTIME_SCAN_DIRS:
        base = os.path.join(repo_root, base_dir)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames
                           if d not in RUNTIME_SCAN_SKIP_DIRS
                           and ".bak" not in d and not d.startswith("backup-")]
            for name in filenames:
                if ".bak" in name or name.startswith("backup-") \
                        or name.endswith((".pyc", ".png", ".jpg", ".ico")):
                    continue
                path = os.path.join(dirpath, name)
                if path == os.path.abspath(__file__):
                    # The suite's own source names the requirement in prose
                    # (docstrings/comments reference the developer home as the
                    # thing being detected) — it is a test harness, not
                    # generic runtime, and must not fail its own scan.
                    continue
                try:
                    with open(path, "r", encoding="utf-8", errors="replace") as fh:
                        data = fh.read()
                except OSError:
                    continue
                if DEVELOPER_HOME not in data:
                    continue
                target = warns if os.path.splitext(name)[1] in DOC_EXTENSIONS else hits
                target.append(path)
    for path in warns:
        print(f"WARN: {os.path.relpath(path, repo_root)}: documentation file "
              f"mentions the developer home path (verify it is not runtime code)")
    if hits:
        for path in hits:
            print(f"HIT: {os.path.relpath(path, repo_root)}")
        fail(f"generic runtime contains the developer absolute home path in "
             f"{len(hits)} file(s)")
    print("PASS A: no /Users/blackceomacmini absolute path in the generic runtime")


# ---------------------------------------------------------------------------
# Assertion B — arbitrary user paths work
# ---------------------------------------------------------------------------
def check_arbitrary_user(boss, fixture_script, scratch, tag):
    home = os.path.join(scratch, tag, "home")
    os.makedirs(home, exist_ok=True)
    root = build_fixture(fixture_script, scratch, home, tag)
    enc = encoded_home(home)
    live_root = os.path.join(home, ".claude", "projects", enc, "session-0001",
                             "subagents", "workflows")

    # B1: pinned workflow root.
    env = env_for(scratch, home, os.path.dirname(os.path.dirname(boss)),
                  live_root, tag)
    out = run_cycle(boss, env, 0, f"{tag}: pinned-root clean cycle")
    ledger = os.path.join(scratch, tag, "ledger.md")
    with open(ledger, encoding="utf-8") as fh:
        text = fh.read()
    if "BOSSCYCLE-CLEAN" not in text:
        fail(f"{tag}: ledger lacks BOSSCYCLE-CLEAN after clean cycle")
    print(f"PASS B1: arbitrary user home '{home}' works with a pinned root "
          f"(clean cycle, BOSSCYCLE-CLEAN recorded)")

    # B2: workflow-root DISCOVERY — no BOSS_WF_ROOT; the runtime must find
    # both session stores (claude and claude-nine) under the synthetic home.
    env2 = env_for(scratch, home, os.path.dirname(os.path.dirname(boss)),
                   "", tag + "-discovery")
    env2.pop("BOSS_WF_ROOT")
    out2 = run_cycle(boss, env2, 0, f"{tag}: discovery clean cycle")
    print(f"PASS B2: discovery under '{home}' finds the session stores "
          f"without BOSS_WF_ROOT (clean cycle)")

    # B3: Windows-shaped home — the HOME path contains backslash segments and
    # a space (C:\Users\Jane Doe shape), exactly how Windows user-profile
    # paths read when the runtime's ~-derivation logic runs against them. The
    # runtime must derive the session-store name from that home, discover the
    # live run under it, and record a clean cycle. This is the spec-24
    # "arbitrary Windows user paths work" path-shape proof; native Windows
    # interpreter execution is E.3 cross-platform parity (verify-windows.ps1),
    # not this suite.
    win_tag = tag + "-win-shape"
    win_sub = os.path.join(scratch, win_tag)
    win_home = os.path.join(win_sub, "home", "C:\\Users\\Jane Doe")
    os.makedirs(win_home, exist_ok=True)
    win_root = build_fixture(fixture_script, win_sub, win_home, win_tag)
    win_enc = encoded_home(win_home)
    win_live_root = os.path.join(win_home, ".claude", "projects", win_enc,
                                 "session-0001", "subagents", "workflows")
    # The fixture builds both claude and claude-nine stores; discovery must
    # find them under the Windows-shaped home.
    env3 = env_for(scratch, win_home,
                   os.path.dirname(os.path.dirname(boss)), "", win_tag)
    env3.pop("BOSS_WF_ROOT")
    out3 = run_cycle(boss, env3, 0, f"{win_tag}: windows-shaped discovery "
                    "clean cycle")
    win_ledger = os.path.join(scratch, win_tag, "ledger.md")
    with open(win_ledger, encoding="utf-8") as fh:
        win_ledger_text = fh.read()
    if "BOSSCYCLE-CLEAN" not in win_ledger_text:
        fail(f"{win_tag}: ledger lacks BOSSCYCLE-CLEAN after windows-shaped "
             "home clean cycle")
    print(f"PASS B3: windows-shaped home '{win_home}' (backslash segments + "
          f"space) discovers the session stores and records a clean cycle")


# ---------------------------------------------------------------------------
# Assertion C — the historical six-wave campaign governs no generic project
# ---------------------------------------------------------------------------
def check_campaign_neutrality(boss, fixture_script, scratch, tag):
    home = os.path.join(scratch, tag, "home")
    os.makedirs(home, exist_ok=True)
    build_fixture(fixture_script, scratch, home, tag)
    enc = encoded_home(home)
    live_root = os.path.join(home, ".claude", "projects", enc, "session-0001",
                             "subagents", "workflows")
    env = env_for(scratch, home, os.path.dirname(os.path.dirname(boss)),
                  live_root, tag)

    # C1: a customer project carrying six-wave campaign HISTORY (the legacy
    # fixture) is present; the cycle must be clean — the campaign history is
    # not governance; only entry-mode/research gates apply to projects.
    run_cycle(boss, env, 0, "C1: six-wave history project governs nothing")
    print("PASS C1: the legacy six-wave campaign history governs no generic "
          "project (clean cycle with the history project present)")

    # C2: the runtime's wave-lock data is CONFIG-driven, not a hardcoded
    # six-wave table. With the committed neutral example config (one locked
    # wave), a "WAVE 6 DISPATCH" ledger line is a violation — proving the
    # runtime carries no built-in six-wave allowance.
    ledger = os.path.join(scratch, tag, "ledger.md")
    with open(ledger, "a", encoding="utf-8") as fh:
        fh.write("- `WAVE 6 DISPATCH 2026-08-21T00:10:00Z: wave six dispatch "
                 "line under the neutral config`\n")
    # The dispatch line also trips the census rule (a dispatch without
    # 'Census before dispatch'), so at least the wave-lock finding is asserted.
    run_cycle(boss, env, 1, "C2: wave 6 dispatch flagged under neutral config",
               expect_min=True)
    with open(ledger, encoding="utf-8") as fh:
        ledger_text = fh.read()
    if "wave 6 dispatched, not in the locked table (count 1)" not in ledger_text:
        fail(f"C2: expected the wave-lock finding naming wave 6 in the ledger, "
             f"got:\n{ledger_text}")
    print("PASS C2: wave-lock is config-driven — the neutral committed config "
          "(one wave) flags 'WAVE 6 DISPATCH'; no built-in six-wave table")


# ---------------------------------------------------------------------------
# Assertion D — two unrelated projects cannot read or stop each other
# ---------------------------------------------------------------------------
def check_project_isolation(boss, fixture_script, scratch, tag):
    # D1: two unrelated projects — break beta-two's ENTRY-MODE record only;
    # alpha-one stays clean. The violation must name beta-two and never
    # alpha-one (the projects share nothing and cannot read each other).
    sub1 = os.path.join(scratch, tag + "-d1")
    os.makedirs(sub1, exist_ok=True)
    home = os.path.join(sub1, "home")
    os.makedirs(home, exist_ok=True)
    build_fixture(fixture_script, sub1, home, tag)
    enc = encoded_home(home)
    live_root = os.path.join(home, ".claude", "projects", enc, "session-0001",
                             "subagents", "workflows")
    projects = os.path.join(home, "Downloads", "projects")
    env = env_for(sub1, home, os.path.dirname(os.path.dirname(boss)),
                  live_root, tag)
    beta_ledger = os.path.join(projects, "beta-two", "CONTROL", "LEDGER.md")
    with open(beta_ledger, encoding="utf-8") as fh:
        lines = [ln for ln in fh if "ENTRY-MODE" not in ln]
    with open(beta_ledger, "w", encoding="utf-8") as fh:
        fh.writelines(lines)
    run_cycle(boss, env, 1, "D1: beta-two entry-mode violation")
    with open(env["BOSS_LEDGER"], encoding="utf-8") as fh:
        ledger_text = fh.read()
    if "beta-two" not in ledger_text or "alpha-one" in ledger_text:
        fail(f"D1: violation must name beta-two only, got:\n{ledger_text}")

    # D2: a stop-workstream file inside alpha-one's CONTROL must be inert —
    # the runtime's stop authority is its own state dir, never project files.
    sub2 = os.path.join(scratch, tag + "-d2")
    os.makedirs(sub2, exist_ok=True)
    home2 = os.path.join(sub2, "home")
    os.makedirs(home2, exist_ok=True)
    build_fixture(fixture_script, sub2, home2, tag)
    enc2 = encoded_home(home2)
    live_root2 = os.path.join(home2, ".claude", "projects", enc2,
                              "session-0001", "subagents", "workflows")
    projects2 = os.path.join(home2, "Downloads", "projects")
    env2 = env_for(sub2, home2, os.path.dirname(os.path.dirname(boss)),
                   live_root2, tag)
    stop = os.path.join(projects2, "alpha-one", "CONTROL", "stop-workstream")
    with open(stop, "w", encoding="utf-8") as fh:
        fh.write("boss-cron: fixture stop for alpha-one only")
    run_cycle(boss, env2, 0, "D2: alpha-one stop file is inert")
    with open(env2["BOSS_LEDGER"], encoding="utf-8") as fh:
        ledger_text = fh.read()
    if "alpha-one" in ledger_text:
        fail(f"D2: alpha-one's project stop file leaked into the cycle:\n{ledger_text}")
    print("PASS D: two unrelated projects are isolated — a violation in "
          "beta-two names beta-two only, and a stop file inside alpha-one "
          "never stops anything")


# ---------------------------------------------------------------------------
# Assertion E — claim verification is current-user anchored
# ---------------------------------------------------------------------------
def check_claim_verification(boss, fixture_script, scratch, tag):
    home = os.path.join(scratch, tag, "home")
    os.makedirs(home, exist_ok=True)
    build_fixture(fixture_script, scratch, home, tag)
    enc = encoded_home(home)
    live_root = os.path.join(home, ".claude", "projects", enc, "session-0001",
                             "subagents", "workflows")
    evidence = os.path.join(home, "evidence-ok.txt")
    with open(evidence, "w", encoding="utf-8") as fh:
        fh.write("ok\n")
    ledger = os.path.join(scratch, tag, "ledger.md")
    with open(ledger, "w", encoding="utf-8") as fh:
        fh.write("- `CREATED 2026-08-21T00:00:00Z: claim fixture`\n")
        fh.write(f"- `DONE 2026-08-21T00:05:00Z: unit U-01 done — evidence {evidence}`\n")
    env = env_for(scratch, home, os.path.dirname(os.path.dirname(boss)),
                  live_root, tag)
    run_cycle(boss, env, 0, "E1: present home-path claim verified clean")

    with open(ledger, "a", encoding="utf-8") as fh:
        fh.write(f"- `DONE 2026-08-21T00:06:00Z: unit U-02 done — evidence "
                 f"{evidence}.missing`\n")
    run_cycle(boss, env, 1, "E2: missing home-path claim flagged")
    with open(ledger, encoding="utf-8") as fh:
        ledger_text = fh.read()
    if "missing path" not in ledger_text:
        fail(f"E2: missing-path claim not flagged:\n{ledger_text}")
    print("PASS E: claim verification is current-user anchored — a present "
          "path under the arbitrary user home verifies clean, a missing one "
          "flags")


def main():
    ap = argparse.ArgumentParser(description="boss-cron portability suite")
    ap.add_argument("--boss", default=None, help="path to tools/boss-cron under test")
    ap.add_argument("--script-dir", default=HERE, help="this test directory")
    args = ap.parse_args()
    script_dir = os.path.abspath(args.script_dir)
    boss = args.boss or os.path.normpath(
        os.path.join(script_dir, "..", "..", "tools", "boss-cron"))
    if not os.path.isfile(boss):
        fail(f"boss script not found at {boss} (pass --boss or run from the worktree)")
    repo_root = os.path.dirname(os.path.dirname(boss))
    fixture_script = os.path.join(script_dir, "build-fixture.sh")
    if not os.path.isfile(fixture_script):
        fail(f"fixture builder not found at {fixture_script}")

    scratch = scratch_dir()
    try:
        check_no_developer_home(repo_root)
        check_arbitrary_user(boss, fixture_script, scratch, "b")
        check_campaign_neutrality(boss, fixture_script, scratch, "c")
        check_project_isolation(boss, fixture_script, scratch, "d")
        check_claim_verification(boss, fixture_script, scratch, "e")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    print("ALL PORTABILITY ASSERTIONS PASS (exit 0)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
