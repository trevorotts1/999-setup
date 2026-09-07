#!/usr/bin/env python3
"""PreToolUse gate for the Workflow tool -- refuses the forbidden swarm shapes.

Why this exists: RULE 2's width floor and the forbidden shapes of SPEC 8.4.1
were prose. A conductor that resolved the ambiguity conservatively dispatched
"3 agents when 10 were possible" and nothing in the harness said no. This hook
says no, at launch, in the one place the model cannot talk its way past.

It reads the script the launch is about to run (inline `script` or `scriptPath`)
and blocks (exit 2) five shapes, naming the fix for each:

  1. parallel(build) followed by parallel(qc)      -> pipeline(units, build, qc)
  2. a judge stage with fewer items than the build stage  -> one judge per unit
  3. a bare agent() with no model:                 -> pin the seat (workflows.md 0.0)
  4. an item count below min(dispatchable, CLIENT_CAP), when a CAPACITY-LEDGER.md
     is found upward from cwd and the script carries no `dep=` reason
  5. a merge agent inside a build tree             -> Law 3: it runs outside the tree

FAILS OPEN by design, exactly like ~/.claude/hooks/workflow-syntax-gate.py: an
unreadable input, an unparseable script, an undetermined item count, any
exception at all -> exit 0 and the launch proceeds. A gate that cannot see the
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

    print("\n".join(results))
    print("")
    if fails == 0:
        print("dispatch-gate.py selftest: ALL PASS (13 checks)")
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
