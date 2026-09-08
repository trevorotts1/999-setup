#!/usr/bin/env python3
"""PreToolUse gate for the Workflow tool -- refuses the forbidden swarm shapes.

Why this exists: RULE 2's width floor and the forbidden shapes of SPEC 8.4.1
were prose. A conductor that resolved the ambiguity conservatively dispatched
"3 agents when 10 were possible" and nothing in the harness said no. This hook
says no, at launch, in the one place the model cannot talk its way past.

It reads the script the launch is about to run (inline `script` or `scriptPath`)
and blocks (exit 2) six shapes, naming the fix for each:

  1. parallel(build) followed by parallel(qc)      -> pipeline(units, build, qc)
  2. a judge stage with fewer items than the build stage  -> one judge per unit
  3. a bare agent() with no model:                 -> pin the seat (workflows.md 0.0)
  4. an item count below min(dispatchable, CLIENT_CAP), when a CAPACITY-LEDGER.md
     is found upward from cwd and the script carries no `dep=` reason
  5. a merge agent inside a build tree             -> Law 3: it runs outside the tree
  6. any launch at all while CONTROL/project_state.json (found upward from cwd)
     says the run is at or past its pause line or its ceiling -> the budget wall,
     the same arithmetic and the same message tools/dispatch-check.sh prints at
     exit 7 and exit 8. Shape 6 is not about the tree: it is about the RUN.

FAILS OPEN by design, exactly like ~/.claude/hooks/workflow-syntax-gate.py: an
unreadable input, an unparseable script, an undetermined item count, a state
file it cannot find or whose budget keys are absent, any exception at all ->
exit 0 and the launch proceeds. A gate that cannot see the
shape says NOTHING about the shape; it never guesses. Two consequences the
conductor owns: "the hook did not block" is never evidence that a tree is wide
enough, and a launch by saved NAME has no local file to read, so it passes the
gate unexamined.

  --selftest   proves the instrument: the four fixtures the work item names.
  --check FILE runs the same evaluation against a script file, for a human.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

MAX_SCRIPT_BYTES = 2_000_000

JUDGE_WORDS = ("judge", "qc", "verif", "review", "critic", "audit", "blind", "gauntlet")
BUILD_WORDS = ("build", "implement", "author", "scaffold", "repair", "construct", "fix")
MERGE_WORDS = ("merge", "merge-writer", "mergewriter")

FIX_1 = (
    "FIX: a barrier between build and QC idles every slot the slow builder is not using.\n"
    "  Replace  parallel(build)  then  parallel(qc)\n"
    "  with     pipeline(units, build, qc)  -- one chain per unit, no barrier between stages,\n"
    "  every stage carrying its own model: pin."
)
FIX_2 = (
    "FIX: one judge per landed unit. A QC phase narrower than the build phase is the\n"
    "  timid-dispatch pattern in its second form -- during it, most of the machine idles.\n"
    "  Pass the same item set to the judge stage, or make it a stage of the same pipeline()."
)
FIX_3 = (
    "FIX: every agent() carries model: -- the seat pin (references/workflows.md 0.0).\n"
    "  A bare agent() inherits whatever the session happens to be, which breaks the\n"
    "  independence rule (Law 7: the judge must not be the builder's model)."
)
FIX_5 = (
    "FIX: the merge writer runs OUTSIDE the build tree. One writer per repo (Law 3) is\n"
    "  why there is one of it; inside the tree it holds a build slot while nine idle.\n"
    "  Launch it as its own workflow after the tree returns."
)
FIX_6_PAUSE = (
    "FIX: this is not a defect in the tree -- it is the budget wall. agents.executions_total\n"
    "  in CONTROL/project_state.json is at or past agents.first_pause x\n"
    "  (agents.pause_blocks_granted + 1). Deploy the best stable build, write the plain\n"
    "  report, then ask the one question (SKILL.md section 6). Each 'keep going' the client\n"
    "  gives increments agents.pause_blocks_granted, which moves the wall up by one block\n"
    "  and the run resumes at FULL width -- a pause is never a stop. tools/dispatch-check.sh\n"
    "  refuses the same dispatch with exit 7; this hook is the half that holds when the\n"
    "  conductor never calls it."
)
FIX_6_CEILING = (
    "FIX: the absolute per-project ceiling (agents.ceiling, 2,000 -- operator decision\n"
    "  2026-09-07, finding G6) is reached. Stop dispatching, set run_status=STOPPED_CAP,\n"
    "  preserve the best stable build and write the blocker report. A LIMIT REACHED stop is\n"
    "  never a PASS and never drift, and it is never crossed without the operator.\n"
    "  tools/dispatch-check.sh refuses the same dispatch with exit 8. The ceiling is tested\n"
    "  BEFORE the pause: a run at the ceiling is also past its pause line, and calling that\n"
    "  a pause would leave a project able to answer 'keep going' past a line it can never\n"
    "  cross."
)

# The absolute per-project ceiling. A state file may lower it and may never
# raise it, which is why the state value is taken only when it is SMALLER --
# the same clamp tools/anchor.sh applies in its budget audit.
CEILING_DEFAULT = 2000


def allow():
    sys.exit(0)


def block(lines):
    sys.stderr.write(
        "BLOCKED: this workflow tree is a forbidden dispatch shape (SPEC 8.4.1;\n"
        "references/workflows.md forbidden shapes). It would have under-used the machine.\n\n"
        + "\n\n".join(lines)
        + "\n\nRe-author the script and launch again. If the narrow shape is CORRECT because a\n"
        "wave dependency forces it, say so in the script -- a comment containing `dep=<reason>`\n"
        "-- and this gate stands down on the width check.\n"
    )
    sys.exit(2)


# ---------------------------------------------------------------------------
# A same-length transform: comments blanked, string CONTENTS kept as bare words
# but stripped of every structural character. Offsets stay 1:1 with the source,
# so parens balance and no label text can fake a call.
# ---------------------------------------------------------------------------
NEUTRAL = set("(){}[],;:'\"`")


def sanitize(src):
    out = list(src)
    i, n, state = 0, len(src), None
    while i < n:
        c = src[i]
        if state is None:
            if c == "/" and i + 1 < n and src[i + 1] == "/":
                state, out[i], out[i + 1] = "line", " ", " "
                i += 2
                continue
            if c == "/" and i + 1 < n and src[i + 1] == "*":
                state, out[i], out[i + 1] = "block", " ", " "
                i += 2
                continue
            if c in "'\"`":
                state, out[i] = c, " "
                i += 1
                continue
            i += 1
            continue
        if state == "line":
            if c == "\n":
                state = None
            else:
                out[i] = " "
            i += 1
            continue
        if state == "block":
            if c == "*" and i + 1 < n and src[i + 1] == "/":
                out[i], out[i + 1], state = " ", " ", None
                i += 2
                continue
            if c != "\n":
                out[i] = " "
            i += 1
            continue
        # inside a string literal
        if c == "\\":
            out[i] = " "
            if i + 1 < n:
                out[i + 1] = " "
            i += 2
            continue
        if c == state:
            out[i], state = " ", None
            i += 1
            continue
        if c in NEUTRAL:
            out[i] = " "
        i += 1
    return "".join(out)


def match_close(code, open_idx, opener="(", closer=")"):
    depth, i, n = 0, open_idx, len(code)
    while i < n:
        c = code[i]
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def find_calls(code, name):
    """[(start, args_text)] for every call to `name(` that is not a property access."""
    out = []
    for m in re.finditer(r"(?<![A-Za-z0-9_$.])" + name + r"\s*\(", code):
        open_idx = m.end() - 1
        close_idx = match_close(code, open_idx)
        if close_idx < 0:
            continue
        out.append((m.start(), code[open_idx + 1 : close_idx]))
    return out


def count_array_elements(code, open_idx):
    depth, commas, i, n = 0, 0, open_idx, len(code)
    while i < n:
        c = code[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                inner = code[open_idx + 1 : i]
                if not inner.strip():
                    return 0
                return commas if inner.rstrip().endswith(",") else commas + 1
        elif c == "," and depth == 1:
            commas += 1
        i += 1
    return None


def resolve_identifier(code, ident):
    m = re.search(
        r"(?:const|let|var)\s+" + re.escape(ident) + r"\s*=\s*\[", code
    )
    if not m:
        return None
    return count_array_elements(code, m.end() - 1)


def count_items(args, code):
    """How many items this stage call passes. None = UNDETERMINED (never a verdict)."""
    a = args.lstrip()
    if a.startswith("["):
        return count_array_elements(args, args.index("["))
    m = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*map\b", a)
    if m:
        return resolve_identifier(code, m.group(1))
    m = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|$)", a)
    if m:
        return resolve_identifier(code, m.group(1))
    return None


def has_any(text, words):
    low = text.lower()
    return any(w in low for w in words)


def classify(args):
    if has_any(args, JUDGE_WORDS):
        return "judge"
    if has_any(args, BUILD_WORDS):
        return "build"
    return "other"


def option_values(args, key):
    """The bare-word values of `key:` options inside a call's argument text."""
    return [m.group(1).strip() for m in re.finditer(key + r"\s*:\s*([^,}\n]*)", args)]


def find_capacity_ledger(start_dir):
    d = os.path.abspath(start_dir)
    seen = 0
    while seen < 40:
        p = os.path.join(d, "CAPACITY-LEDGER.md")
        if os.path.isfile(p):
            return p
        nd = os.path.dirname(d)
        if nd == d:
            return None
        d, seen = nd, seen + 1
    return None


def parse_client_cap(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except Exception:
        return None
    m = re.search(r"^[ \t]*CLIENT_CAP[ \t]*=[ \t]*(\d+)", text, re.M)
    if m:
        n = int(m.group(1))
        return n if 1 <= n <= 64 else None
    stripped = re.sub(r"\[[^\]]*\]", "", text)
    for line in stripped.splitlines():
        if "clientcap" in line.lower():
            m = re.search(r"=\s*(\d+)\s*$", line)
            if m:
                n = int(m.group(1))
                return n if 1 <= n <= 64 else None
    return None


def find_state_file(start_dir):
    """CONTROL/project_state.json, searched upward from cwd like the ledger."""
    d = os.path.abspath(start_dir)
    seen = 0
    while seen < 40:
        p = os.path.join(d, "CONTROL", "project_state.json")
        if os.path.isfile(p):
            return p
        nd = os.path.dirname(d)
        if nd == d:
            return None
        d, seen = nd, seen + 1
    return None


def jnum(flat, key):
    """tools/anchor.sh's jnum, in Python.

    anchor.sh reads the state file with a GREEDY sed over the newline-stripped
    text, so it matches an exactly-quoted key at ANY nesting depth and returns
    the LAST occurrence when a key appears twice. tools/dispatch-check.sh copies
    that sed character for character; this is the same rule in the third
    instrument, because three gates that decide one pause must never disagree
    about how the file parses.
    """
    found = re.findall(r'"' + re.escape(key) + r'"[ \t]*:[ \t]*(-?\d+)', flat)
    if not found:
        return None
    return int(found[-1])


def budget_state(cwd):
    """(path, executions, pause_at, ceiling), or None when it cannot be read.

    None is the fail-open answer this hook owes: a gate that cannot read the
    budget says NOTHING about the budget. tools/dispatch-check.sh answers the
    same question differently ON PURPOSE -- it exits 2 and names
    tools/state-check.sh -- because it is CALLED by the conductor and can refuse
    a dispatch out loud, while a PreToolUse hook that blocked on an unreadable
    file would take the whole harness down with it.
    """
    path = find_state_file(cwd or os.getcwd())
    if not path:
        return None
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            flat = fh.read().replace("\n", "").replace("\r", "")
    except Exception:
        return None
    execs = jnum(flat, "executions_total")
    first_pause = jnum(flat, "first_pause")
    blocks = jnum(flat, "pause_blocks_granted")
    ceil = jnum(flat, "ceiling")
    if execs is None or first_pause is None or blocks is None or ceil is None:
        return None
    if any(v < 0 for v in (execs, first_pause, blocks, ceil)):
        return None
    if ceil > CEILING_DEFAULT:
        ceil = CEILING_DEFAULT
    pause = first_pause * (blocks + 1)
    if pause > ceil:
        pause = ceil
    return path, execs, pause, ceil


# ---------------------------------------------------------------------------
# The evaluation. Returns a list of findings; an empty list means "allow".
# ---------------------------------------------------------------------------
def evaluate(script, cwd=None):
    findings = []
    code = sanitize(script)

    # --- 3. bare agent() -----------------------------------------------------
    bare = 0
    for _start, args in find_calls(code, "agent"):
        if re.search(r"(?<![A-Za-z0-9_$])model\s*:", args):
            continue
        if "{" not in args:
            # options passed as an identifier or spread: UNDETERMINED, not bare.
            if re.search(r",\s*[A-Za-z_$][A-Za-z0-9_$]*\s*$", args) or "..." in args:
                continue
        bare += 1
    if bare:
        findings.append(
            "SHAPE 3 -- %d agent() call%s with no model: pin.\n%s"
            % (bare, "" if bare == 1 else "s", FIX_3)
        )

    # --- stage calls ---------------------------------------------------------
    stages = []
    for kind in ("parallel", "pipeline"):
        for start, args in find_calls(code, kind):
            stages.append(
                {
                    "kind": kind,
                    "start": start,
                    "args": args,
                    "class": classify(args),
                    "items": count_items(args, code),
                }
            )
    stages.sort(key=lambda s: s["start"])

    # --- 1. parallel(build) followed by parallel(qc) --------------------------
    par = [s for s in stages if s["kind"] == "parallel"]
    seen_build = False
    for s in par:
        if s["class"] == "build":
            seen_build = True
        elif s["class"] == "judge" and seen_build:
            findings.append(
                "SHAPE 1 -- a parallel() build barrier followed by a parallel() QC barrier.\n" + FIX_1
            )
            break

    # --- 2. a judge stage narrower than the build stage -----------------------
    builds = [s["items"] for s in stages if s["class"] == "build" and s["items"]]
    judges = [s["items"] for s in par if s["class"] == "judge" and s["items"] is not None]
    if builds and judges:
        b, j = max(builds), max(judges)
        if j < b:
            findings.append(
                "SHAPE 2 -- the build stage passes %d items, the judge stage passes %d.\n%s"
                % (b, j, FIX_2)
            )

    # --- 5. a merge agent inside a build tree --------------------------------
    if any(s["class"] == "build" for s in stages):
        for _start, args in find_calls(code, "agent"):
            names = option_values(args, "label") + option_values(args, "phase")
            if any(has_any(v, MERGE_WORDS) for v in names):
                findings.append(
                    "SHAPE 5 -- a merge agent (label/phase names it) runs inside a tree that\n"
                    "  also builds.\n" + FIX_5
                )
                break

    # --- 4. under-width against the machine's own measured cap ---------------
    if not re.search(r"dep\s*=", script):
        ledger = find_capacity_ledger(cwd or os.getcwd())
        cap = parse_client_cap(ledger) if ledger else None
        counts = [s["items"] for s in stages if s["items"]]
        if cap and counts:
            widest = max(counts)
            if widest < cap:
                findings.append(
                    "SHAPE 4 -- the widest stage passes %d items; this machine's measured\n"
                    "  clientCap is %d (%s).\n"
                    "FIX: pass every dispatchable unit to one pipeline() call and let the harness\n"
                    "  queue the rest -- the queue is a rolling window, never a batch. If fewer\n"
                    "  units are dispatchable because a wave dependency blocks them, write the\n"
                    "  reason in the script as a `dep=<reason>` comment and this check stands down."
                    % (widest, cap, ledger)
                )

    # --- 6. the budget wall: past the pause line, or at the ceiling ----------
    # The pause used to be decided in exactly ONE instrument, tools/anchor.sh,
    # which only runs when the five-minute tick runs. The 2026-09-07 canary
    # never armed the tick, so executions_total walked from its pause line of 20
    # to 72 with nothing refusing a launch. The refusal has to hold even when
    # the conductor never calls tools/dispatch-check.sh -- which is this hook.
    st = budget_state(cwd)
    if st:
        path, execs, pause, ceil = st
        if execs >= ceil:
            findings.append(
                "SHAPE 6 -- DISPATCH-CHECK CEILING | executions=%d | ceiling=%d\n"
                "  (read: %s)\n%s" % (execs, ceil, path, FIX_6_CEILING)
            )
        elif execs >= pause:
            findings.append(
                "SHAPE 6 -- DISPATCH-CHECK PAUSED | executions=%d | pause_at=%d | ceiling=%d\n"
                "  (read: %s)\n%s" % (execs, pause, ceil, path, FIX_6_PAUSE)
            )
    return findings


# ---------------------------------------------------------------------------
# The hook entry point
# ---------------------------------------------------------------------------
def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        allow()
    if not isinstance(data, dict) or data.get("tool_name") != "Workflow":
        allow()

    ti = data.get("tool_input") or {}
    if not isinstance(ti, dict):
        allow()

    script = ti.get("script")
    if not script:
        path = ti.get("scriptPath")
        if not path or not isinstance(path, str) or not os.path.isfile(path):
            allow()  # name-based launch: nothing local to read
        try:
            if os.path.getsize(path) > MAX_SCRIPT_BYTES:
                allow()
            with open(path, encoding="utf-8", errors="replace") as fh:
                script = fh.read()
        except Exception:
            allow()

    if not isinstance(script, str) or not script.strip():
        allow()

    try:
        findings = evaluate(script, os.getcwd())
    except Exception:
        allow()  # a gate that cannot see the shape claims nothing about it

    if findings:
        block(findings)
    allow()


# ---------------------------------------------------------------------------
# The selftest -- the instrument proven before any verdict is believed
# ---------------------------------------------------------------------------
FIXTURE_BAD_BARRIER = """export const meta = { name: 'x', description: 'y' }
phase('Build')
const BUILD = [
  { id: 'a', prompt: 'build a' },
  { id: 'b', prompt: 'build b' },
  { id: 'c', prompt: 'build c' },
]
const built = await parallel(BUILD.map(w => () => agent(w.prompt, { label: `build:${w.id}`, phase: 'Build', model: 'opus' })))
phase('QC')
const QC = [ { id: 'q1', prompt: 'qc it' } ]
const judged = await parallel(QC.map(q => () => agent(q.prompt, { label: `qc:${q.id}`, phase: 'QC', model: 'sonnet' })))
return { built, judged }
"""

FIXTURE_BARE_AGENT = """export const meta = { name: 'x', description: 'y' }
const r = await agent('do the thing', { label: 'lonely', phase: 'Build' })
return r
"""

FIXTURE_WAVE1 = """export const meta = {
  name: 'spec-protocol-wave1',
  description: 'wave 1 -- Opus builders, Sonnet judges',
  phases: [ { title: 'Build', detail: 'builder per item' }, { title: 'Judge', detail: 'judge per item' } ],
}
const ITEMS = args
log(`wave 1: ${ITEMS.length} items`)
const results = await pipeline(
  ITEMS,
  (item) => agent(buildPrompt(item), { label: `[Opus x1] build ${item.id}`, phase: 'Build', model: 'opus', schema: RESULT }),
  async (built, item) => {
    let verdict = await agent(judgePrompt(item, built), { label: `[Sonnet x1] judge ${item.id}`, phase: 'Judge', model: 'sonnet', schema: VERDICT })
    return { id: item.id, built, verdict }
  },
)
return results.filter(Boolean)
"""


def _run_child(payload, cwd):
    proc = subprocess.run(
        [sys.executable, os.path.abspath(__file__)],
        input=payload,
        capture_output=True,
        text=True,
        cwd=cwd,
        timeout=60,
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def selftest():
    fails = 0
    results = []

    def report(n, name, ok, detail):
        nonlocal fails
        results.append("%s %-2s %-26s %s" % ("PASS" if ok else "FAIL", n, name, detail))
        if not ok:
            fails += 1

    sandbox = tempfile.mkdtemp(prefix="dispatch-gate-selftest.")

    def payload(script):
        return json.dumps({"tool_name": "Workflow", "tool_input": {"script": script}})

    # 0 -- the control: a shape this gate MUST NOT block. Without it a gate that
    #      blocks everything would score four out of four.
    rc, out = _run_child(payload(FIXTURE_WAVE1), sandbox)
    report(0, "wave1-shape-allowed", rc == 0,
           "rc=%d (want 0) for pipeline(items, build, judge) with model pins on both stages%s"
           % (rc, "" if rc == 0 else " -- output: " + out.strip()[:400]))

    # 1 -- parallel(build) then parallel(qc)
    rc, out = _run_child(payload(FIXTURE_BAD_BARRIER), sandbox)
    ok = rc == 2 and "SHAPE 1" in out and "pipeline(units, build, qc)" in out
    report(1, "barrier-blocked", ok,
           "rc=%d (want 2); names the fix pipeline(units, build, qc): %s"
           % (rc, "yes" if "pipeline(units, build, qc)" in out else "NO"))

    # 1b -- the same fixture is also the narrow-judge shape (1 judge, 3 builds)
    ok = "SHAPE 2" in out
    report(2, "narrow-judge-blocked", ok,
           "the 3-build / 1-judge fixture also reports SHAPE 2: %s" % ("yes" if ok else "NO"))

    # 2 -- a bare agent()
    rc, out = _run_child(payload(FIXTURE_BARE_AGENT), sandbox)
    ok = rc == 2 and "SHAPE 3" in out
    report(3, "bare-agent-blocked", ok, "rc=%d (want 2); %s" % (rc, out.strip().splitlines()[-1][:120] if out.strip() else ""))

    # 3 -- garbage stdin fails OPEN
    rc, out = _run_child("this is not json at all {{{", sandbox)
    report(4, "garbage-fails-open", rc == 0, "rc=%d (want 0)" % rc)

    # 3b -- a non-Workflow tool call is none of this gate's business
    rc, _ = _run_child(json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls"}}), sandbox)
    report(5, "other-tool-ignored", rc == 0, "rc=%d (want 0)" % rc)

    # 3c -- an empty payload fails open
    rc, _ = _run_child("", sandbox)
    report(6, "empty-stdin-fails-open", rc == 0, "rc=%d (want 0)" % rc)

    # 4 -- the width check: same script, once without a ledger, once with one.
    narrow = ("export const meta = { name: 'n', description: 'd' }\n"
              "const UNITS = [ { id: 'u1' }, { id: 'u2' } ]\n"
              "const r = await pipeline(UNITS, (u) => agent('build ' + u.id, "
              "{ label: '[Opus x2] build', phase: 'Build', model: 'opus' }))\n"
              "return r\n")
    no_ledger = tempfile.mkdtemp(prefix="dispatch-gate-noledger.", dir=sandbox)
    rc_a, _ = _run_child(payload(narrow), no_ledger)
    with_ledger = tempfile.mkdtemp(prefix="dispatch-gate-ledger.", dir=sandbox)
    with open(os.path.join(with_ledger, "CAPACITY-LEDGER.md"), "w", encoding="utf-8") as fh:
        fh.write("CLIENT_CAP=10\n")
    rc_b, out_b = _run_child(payload(narrow), with_ledger)
    report(7, "width-needs-a-ledger", rc_a == 0 and rc_b == 2 and "SHAPE 4" in out_b,
           "no ledger -> rc=%d (want 0, the gate claims nothing it cannot measure); "
           "ledger CLIENT_CAP=10 -> rc=%d (want 2, 2 items < 10)" % (rc_a, rc_b))

    # 4b -- the dep= escape hatch
    rc_c, _ = _run_child(payload("// dep= only 2 units are unblocked until WI-04 lands\n" + narrow), with_ledger)
    report(8, "dep-comment-stands-down", rc_c == 0, "rc=%d (want 0) with a dep= comment present" % rc_c)

    # 5 -- a merge agent inside a build tree
    merge_tree = FIXTURE_BAD_BARRIER.replace(
        "return { built, judged }",
        "const m = await agent('merge it', { label: 'merge-trains', phase: 'Merge', model: 'haiku' })\nreturn { built, judged, m }",
    )
    rc, out = _run_child(payload(merge_tree), sandbox)
    report(9, "merge-in-tree-blocked", rc == 2 and "SHAPE 5" in out, "rc=%d (want 2) and SHAPE 5 named: %s"
           % (rc, "yes" if "SHAPE 5" in out else "NO"))

    # 6 -- a scriptPath launch reads the file
    sp = os.path.join(sandbox, "bad.js")
    with open(sp, "w", encoding="utf-8") as fh:
        fh.write(FIXTURE_BAD_BARRIER)
    rc, out = _run_child(json.dumps({"tool_name": "Workflow", "tool_input": {"scriptPath": sp}}), sandbox)
    report(10, "scriptPath-is-read", rc == 2 and "SHAPE 1" in out, "rc=%d (want 2) reading %s" % (rc, sp))

    # 7 -- a scriptPath that does not exist fails open
    rc, _ = _run_child(json.dumps({"tool_name": "Workflow", "tool_input": {"scriptPath": sp + ".missing"}}), sandbox)
    report(11, "missing-path-fails-open", rc == 0, "rc=%d (want 0)" % rc)

    # 8 -- prompt text cannot fake a call: the word "agent(" inside a string
    decoy = ("export const meta = { name: 'n', description: 'd' }\n"
             "const r = await agent('never write agent( without a model: pin', "
             "{ label: 'x', phase: 'Build', model: 'opus' })\nreturn r\n")
    rc, out = _run_child(payload(decoy), sandbox)
    report(12, "string-decoy-ignored", rc == 0, "rc=%d (want 0) -- 'agent(' inside a prompt string is text, not a call%s"
           % (rc, "" if rc == 0 else ": " + out.strip()[:300]))

    # 9 -- SHAPE 6, the budget wall: a pair on ONE script, two state files.
    #      The blocked half alone proves nothing -- a gate that blocked every
    #      launch would score it. The allowed half, one execution under the
    #      line, is what makes the pair a test instead of a class-wide refusal.
    def state_dir(name, execs, first_pause, blocks, ceil):
        d = tempfile.mkdtemp(prefix="dispatch-gate-%s." % name, dir=sandbox)
        os.makedirs(os.path.join(d, "CONTROL"), exist_ok=True)
        with open(os.path.join(d, "CONTROL", "project_state.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "schema": "spec-protocol/project-state@1",
                    "run_status": "RUNNING",
                    "agents": {
                        "executions_total": execs,
                        "initial": 35,
                        "warn_at": 150,
                        "first_pause": first_pause,
                        "pause_blocks_granted": blocks,
                        "ceiling": ceil,
                    },
                },
                fh,
                indent=2,
            )
        return d

    over = state_dir("over", 20, 20, 0, 2000)
    under = state_dir("under", 19, 20, 0, 2000)
    rc_over, out_over = _run_child(payload(FIXTURE_WAVE1), over)
    rc_under, _ = _run_child(payload(FIXTURE_WAVE1), under)
    ok = (
        rc_over == 2
        and "SHAPE 6" in out_over
        and "DISPATCH-CHECK PAUSED | executions=20 | pause_at=20 | ceiling=2000" in out_over
        and rc_under == 0
    )
    report(13, "past-pause-blocked", ok,
           "executions_total=20 against first_pause=20 -> rc=%d (want 2), carrying the same line "
           "tools/dispatch-check.sh prints at exit 7; the SAME script at 19 -> rc=%d (want 0)"
           % (rc_over, rc_under))

    # 9b -- a granted block moves the wall rather than raising a new number
    granted = state_dir("granted", 20, 20, 1, 2000)
    rc_g, _ = _run_child(payload(FIXTURE_WAVE1), granted)
    report(14, "granted-block-allows", rc_g == 0,
           "rc=%d (want 0) at the same executions_total=20 with pause_blocks_granted=1 "
           "-- the wall is 20 x (1+1) = 40" % rc_g)

    # 9c -- the ceiling outranks the pause (a run at 2,000 is past both lines)
    at_ceiling = state_dir("ceiling", 2000, 20, 0, 2000)
    rc_c2, out_c2 = _run_child(payload(FIXTURE_WAVE1), at_ceiling)
    ok = (rc_c2 == 2
          and "DISPATCH-CHECK CEILING | executions=2000 | ceiling=2000" in out_c2
          and "DISPATCH-CHECK PAUSED" not in out_c2)
    report(15, "ceiling-outranks-pause", ok,
           "rc=%d (want 2) and the message says CEILING, never PAUSED -- reporting the ceiling "
           "as a pause would let a project answer 'keep going' past a line it can never cross"
           % rc_c2)

    # 9d -- a state file with no budget keys says NOTHING (fails open)
    nobudget = tempfile.mkdtemp(prefix="dispatch-gate-nobudget.", dir=sandbox)
    os.makedirs(os.path.join(nobudget, "CONTROL"), exist_ok=True)
    with open(os.path.join(nobudget, "CONTROL", "project_state.json"), "w", encoding="utf-8") as fh:
        fh.write('{"agents": {"executions_total": 5000}}\n')
    rc_nb, _ = _run_child(payload(FIXTURE_WAVE1), nobudget)
    report(16, "no-budget-keys-fails-open", rc_nb == 0,
           "rc=%d (want 0) for a state file with executions_total and no pause line: this hook "
           "fails open on what it cannot measure. tools/dispatch-check.sh answers the same file "
           "with exit 2 naming tools/state-check.sh -- that is the gate that refuses, and the "
           "conductor owns the difference" % rc_nb)

    print("\n".join(results))
    print("")
    if fails == 0:
        print("dispatch-gate.py selftest: ALL PASS (17 checks)")
        return 0
    print("dispatch-gate.py selftest: %d FAILED -- this gate is a BROKEN INSTRUMENT; "
          "do not treat its silence as a verdict" % fails)
    return 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        sys.exit(selftest())
    if len(sys.argv) > 2 and sys.argv[1] == "--check":
        with open(sys.argv[2], encoding="utf-8", errors="replace") as _fh:
            _found = evaluate(_fh.read(), os.path.dirname(os.path.abspath(sys.argv[2])))
        if _found:
            print("\n\n".join(_found))
            sys.exit(2)
        print("no forbidden shape found (this is not proof the tree is wide enough)")
        sys.exit(0)
    main()
