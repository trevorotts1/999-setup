#!/usr/bin/env python3
"""PreToolUse gate for the Workflow tool -- refuses the forbidden swarm shapes.

Why this exists: RULE 2's width floor and the forbidden shapes of SPEC 8.4.1
were prose. A conductor that resolved the ambiguity conservatively dispatched
"3 agents when 10 were possible" and nothing in the harness said no. This hook
says no, at launch, in the one place the model cannot talk its way past.

It reads the script the launch is about to run (inline `script` or `scriptPath`)
and blocks (exit 2) seven shapes, naming the fix for each:

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
  7. any launch whose DECLARED agent count, summed across every stage, is not
     booked by a CONTROL/dispatch-log.md row written within the last 120
     seconds -> the write-ahead rule of SKILL.md section 5, made mechanical.
     The message names both numbers: `declared=<n> booked=<n>`, or
     `booked=none` when nothing booked it at all.

SHAPE 7 IS SCOPED to spec-protocol projects. It is evaluated only when cwd,
or a parent up to forty levels above it, carries the GATE 0 marker -- the file
tools/gate0.sh --record writes after a genuine GATE 0 pass, present before any
dispatch and absent from any folder that merely has a CONTROL/ directory.
Everywhere else it fails OPEN and says so on stderr in one line, so an
operator's own orchestration folder -- which may carry a
CONTROL/dispatch-log.md of its own and no marker -- is never refused for a
booking rule it never agreed to. SHAPE 6 is NOT scoped: it reads the budget
through find_state_file and fails open on whatever it cannot measure. Shapes
1-5 are facts about the SCRIPT and are not scoped: they hold wherever a
Workflow launches.

PROFILED PROJECTS are detected before any CONTROL lookup. They have one narrow,
read-only branch: the hook requires the actual Workflow `args.specProtocol`
identity and asks the profile's packet checker for an exact `RESERVED` intent.
It does not reserve, consume, increment a counter, or claim that launch equals
native receipt; the packet writer records consumption after its observed native
receipt. A missing, malformed, mismatched, or already-consumed reservation
fails closed. This branch deliberately does not read legacy CONTROL state.

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
import calendar
import json
import os
import re
import subprocess
import sys
import tempfile
import time

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

FIX_7 = (
    "FIX: book the tree BEFORE you launch it. Run\n"
    "    bash tools/dispatch-check.sh <project> <units> <agents> \"[<Model> xN] <what>\"\n"
    "  with <agents> at least the declared count above -- one call books the WHOLE tree,\n"
    "  writing the CONTROL/dispatch-log.md row and incrementing agents.executions_total by\n"
    "  that count in the same step, and rolling the increment back if the row fails to land\n"
    "  -- then launch again within the window. This is SKILL.md section 5's write-ahead rule\n"
    "  (EVERY dispatch, research or build) with a wall behind it.\n"
    "  WHY: on 2026-09-07 ten stage-2 verifiers fired with NO dispatch-log row at all, so\n"
    "  agents.executions_total read 6 while 17 agents had run and the pause line was short by\n"
    "  whole trees. The counter was never the defect -- nothing forced the call that moves it.\n"
    "  RESIDUAL LIMIT (references/enforcement.md 1): this books a tree's DECLARED width at\n"
    "  launch. A PreToolUse hook fires once per launch, so an agent an already-running\n"
    "  workflow spawns internally is invisible here; tools/anchor.sh's dispatch-log census is\n"
    "  the cross-check, and a divergence between the two is a finding, never a rounding error."
)

# SHAPE 7's booking window. A row older than this booked a tree that has already
# fired, so it is not a booking for THIS launch. Two minutes is the same order as
# the step it enforces: write the row, then launch.
BOOKING_WINDOW_SECONDS = 120

# A dispatch-log row as tools/dispatch-check.sh writes it:
#   <ISO8601Z> | <unit> | dispatch | <label> | run=… | units=… | agents=<n> | …
ROW_TS = re.compile(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})")
ROW_AGENTS = re.compile(r"(?<![A-Za-z0-9_-])agents\s*=\s*(\d+)")

# The absolute per-project ceiling. A state file may lower it and may never
# raise it, which is why the state value is taken only when it is SMALLER --
# the same clamp tools/anchor.sh applies in its budget audit.
CEILING_DEFAULT = 2000

# --- THE SCOPE OF SHAPE 7 ----------------------------------------------------
# Shapes 1-5 are facts about the SCRIPT and hold wherever a Workflow launches.
# SHAPE 6 is NOT scoped: budget_state() already returns None when the state
# file is absent, and that None is the fail-open answer this hook owes.
# SHAPE 7 alone is a fact about a spec-protocol RUN -- its dispatch bookings --
# and is only true of a spec-protocol project. An operator's own orchestration
# folder can carry a CONTROL/dispatch-log.md of its own (a fleet roll's log,
# say) and no GATE 0 marker, and SHAPE 7 reading that log would refuse every
# launch from it for a booking rule that folder never agreed to. So SHAPE 7 is
# SCOPED: it is evaluated only when the launch's working directory, or a
# parent up to forty levels above it, carries BOTH a CONTROL/ directory and
# its CONTROL/.gate0-proven marker, written only by tools/gate0.sh --record
# after a genuine GATE 0 pass and therefore present before any dispatch.
# Anywhere else SHAPE 7 FAILS OPEN with SCOPE_NOTE on stderr -- the same
# fail-open direction as every other undetermined input in this hook, and said
# out loud so silence is never mistaken for a verdict.
GATE0_MARKER = ".gate0-proven"
SCOPE_NOTE = "SHAPE 7: not a spec-protocol project, not evaluated"
# cwd plus forty parents: a workflow may launch from a nested build directory,
# and a short walk would strand it outside its own project.
SCOPE_MAX_PARENTS = 40
PROFILE_FILE = ".spec-protocol.json"
PROFILE_ROLES = ("builder", "qc", "repair")


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


def profile_block(message):
    """A profile has one state writer, so an uncheckable launch fails closed."""
    sys.stderr.write(
        "BLOCKED: profiled workflow launch does not match its packet reservation.\n\n"
        + message
        + "\n\nRun the profile dispatch command with the exact task, role, label, units, "
          "agents, and native workflow identity first. The hook only checks that "
          "reservation; it never creates or consumes one.\n"
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


def call_span(code, start, args):
    """(open_offset, close_offset) of the call whose name begins at `start`.

    find_calls() already matched the balanced parens to slice `args`, so the
    closing offset is arithmetic rather than a second scan. SHAPE 7 needs it to
    say which agent() calls belong to which stage.
    """
    open_idx = code.find("(", start)
    if open_idx < 0:
        return None
    return open_idx, open_idx + 1 + len(args)


def declared_agents(code, stages):
    """Every agent() this script declares, across ALL stages. None = UNDETERMINED.

    It reuses the per-stage item counts SHAPE 2 and SHAPE 4 already computed
    rather than parsing the script a second time: a stage that passes N items and
    runs K agent() calls per item declares N x K agents, so a three-stage
    pipeline over ten units is thirty, not ten. agent() calls that sit outside
    every stage -- a lone judge, a merge writer -- count once each.

    Every fail-open rule of this file applies. A stage whose item count could not
    be resolved makes the whole total unknowable and the answer is None. A stage
    whose fan-out lives in a named helper contributes only the agent() calls this
    parser can actually see, which UNDER-counts rather than over-counts: a gate
    that guessed high would block a launch that was booked correctly, and the
    count it prints has to be one the conductor can act on.
    """
    agent_starts = [start for start, _args in find_calls(code, "agent")]
    if not agent_starts:
        return None
    spanned = [s for s in stages if s.get("span")]
    total, covered = 0, set()
    for s in spanned:
        lo, hi = s["span"]
        if any(o["span"][0] < lo and hi <= o["span"][1] for o in spanned if o is not s):
            continue  # nested inside another stage: the outer call already counts it
        inside = [start for start in agent_starts if lo < start < hi]
        if not inside:
            continue  # the fan-out is in a helper: only what is visible is counted
        covered.update(inside)
        if s["items"] is None:
            return None
        total += s["items"] * len(inside)
    total += len([start for start in agent_starts if start not in covered])
    return total or None


def visible_declared_agents(script):
    """Return an exact visible agent count, or None when the script is dynamic.

    This is intentionally the same conservative parser used by legacy Shape 7.
    A profiled reservation is a real capacity promise, so a script that visibly
    declares more direct agents than it reserved must stop before launch. But a
    named/dynamic fan-out or a name-only Workflow gives this hook no honest
    count; it remains reservation-checked rather than being assigned a guessed
    number.
    """
    code = sanitize(script)
    stages = []
    for kind in ("parallel", "pipeline"):
        for start, args in find_calls(code, kind):
            stages.append(
                {
                    "kind": kind,
                    "start": start,
                    "span": call_span(code, start, args),
                    "args": args,
                    "class": classify(args),
                    "items": count_items(args, code),
                }
            )
    stages.sort(key=lambda stage: stage["start"])
    return declared_agents(code, stages)


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


def profile_project(start_dir):
    """Return the nearest profile root without consulting legacy CONTROL paths."""
    d = os.path.abspath(start_dir or os.getcwd())
    for _ in range(SCOPE_MAX_PARENTS + 1):
        if os.path.isfile(os.path.join(d, PROFILE_FILE)):
            return d
        nd = os.path.dirname(d)
        if nd == d:
            return None
        d = nd
    return None


def profile_launch_identity(tool_input):
    """Read only the supported Workflow `args` payload; never invent input keys.

    The native Workflow input carries an arbitrary JSON `args` value to its
    script. The profile contract reserves `args.specProtocol` for the stable
    pre-launch identity. A returned native run/task ID does not exist yet, so a
    PreToolUse hook must not pretend one does.
    """
    args = tool_input.get("args")
    if not isinstance(args, dict):
        return None, "Workflow args must be an object containing args.specProtocol."
    identity = args.get("specProtocol")
    if not isinstance(identity, dict):
        return None, "Workflow args.specProtocol is required for a profiled launch."
    required_strings = ("taskId", "role", "intentId", "nativeWorkflowId", "label")
    if any(not isinstance(identity.get(k), str) or not identity[k] for k in required_strings):
        return None, "args.specProtocol must carry non-empty taskId, role, intentId, nativeWorkflowId, and label."
    if identity["role"] not in PROFILE_ROLES:
        return None, "args.specProtocol.role must be builder, qc, or repair."
    if not isinstance(identity.get("units"), int) or not isinstance(identity.get("agents"), int):
        return None, "args.specProtocol must carry integer units and agents."
    if identity["units"] < 1 or identity["agents"] < 1:
        return None, "args.specProtocol units and agents must be positive."
    return identity, None


def profile_reservation_check(root, identity):
    """Ask the packet's checker read-only whether this exact intent is reserved."""
    candidates = []
    configured = os.environ.get("SPEC_PROTOCOL_PROFILE_ADAPTER")
    if configured:
        candidates.append(os.path.abspath(configured))
    # Source skill location: tools/hooks/dispatch-gate.py -> tools/project-profile.mjs.
    candidates.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "project-profile.mjs")))
    # Installed hook location: ~/.claude/hooks/dispatch-gate.py, while the
    # skill stays at ~/.claude/skills/spec-protocol. No shell evaluation or
    # project-local copy is used; an explicit env path wins for custom roots.
    candidates.append(os.path.expanduser("~/.claude/skills/spec-protocol/tools/project-profile.mjs"))
    adapter = next((candidate for candidate in candidates if os.path.isfile(candidate)), None)
    if adapter is None:
        return "profile adapter unavailable; set SPEC_PROTOCOL_PROFILE_ADAPTER to the installed project-profile.mjs path."
    command = [
        "node", adapter, "dispatch", root,
        str(identity["units"]), str(identity["agents"]), identity["label"],
        "--check", "--task", identity["taskId"], "--role", identity["role"],
        "--native-workflow", identity["nativeWorkflowId"],
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, cwd=root, timeout=25)
    except Exception as exc:
        return "profile checker could not run: %s" % exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "profile checker refused without detail").strip()
        return "profile checker refused the read-only exact request: %s" % detail
    try:
        report = json.loads(result.stdout)
    except Exception:
        return "profile checker must emit one JSON reservation report."
    authorization = report.get("taskAuthorization") if isinstance(report, dict) else None
    if not isinstance(authorization, dict):
        return "profile checker report lacks taskAuthorization."
    expected = {
        "taskId": identity["taskId"],
        "role": identity["role"],
        "intentId": identity["intentId"],
        "nativeWorkflowId": identity["nativeWorkflowId"],
        "label": identity["label"],
        "units": identity["units"],
        "agents": identity["agents"],
    }
    if (authorization.get("approved") is not True
            or authorization.get("kind") != "reservation-check"
            or authorization.get("readOnly") is not True
            or any(authorization.get(key) != value for key, value in expected.items())):
        return "profile checker did not approve the exact reserved intent."
    reservation = authorization.get("reservation")
    if not isinstance(reservation, dict) or reservation.get("id") != identity["intentId"] or reservation.get("state") != "RESERVED":
        return "profile checker did not prove this intent remains RESERVED."
    if not isinstance(authorization.get("stateRevision"), int) or not authorization.get("sourceSpecHash"):
        return "profile checker omitted revision-bound state/source evidence."
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


def spec_protocol_project(start_dir):
    """The CONTROL/ directory that puts a launch IN SCOPE for SHAPE 7.

    Returns its path, or None. cwd plus at most SCOPE_MAX_PARENTS levels up;
    the FIRST CONTROL/ directory that also carries the .gate0-proven marker
    wins. A CONTROL/ directory without the marker is not this launch's
    project -- the walk continues upward rather than stopping, so a nested
    orchestration folder never masks a real project above it. This is the
    fail-open direction: a shape that cannot see the project says nothing
    about the project.
    """
    d = os.path.abspath(start_dir or os.getcwd())
    for _ in range(SCOPE_MAX_PARENTS + 1):
        control = os.path.join(d, "CONTROL")
        if os.path.isdir(control):
            if os.path.isfile(os.path.join(control, GATE0_MARKER)):
                return control
        nd = os.path.dirname(d)
        if nd == d:
            return None
        d = nd
    return None


def budget_state(cwd, path=None):
    """(path, executions, pause_at, ceiling), or None when it cannot be read.

    None is the fail-open answer this hook owes: a gate that cannot read the
    budget says NOTHING about the budget. tools/dispatch-check.sh answers the
    same question differently ON PURPOSE -- it exits 2 and names
    tools/state-check.sh -- because it is CALLED by the conductor and can refuse
    a dispatch out loud, while a PreToolUse hook that blocked on an unreadable
    file would take the whole harness down with it.
    """
    path = path or find_state_file(cwd or os.getcwd())
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


def dispatch_log_booking(control_dir, now):
    """(booked, rows, newest_age) from CONTROL/dispatch-log.md, or None.

    `booked` is the largest `agents=` field on a row whose timestamp is inside
    BOOKING_WINDOW_SECONDS -- the row this launch should have been written ahead
    of -- and None when no such row exists. `rows` and `newest_age` are for the
    message only.

    None (the whole return) is UNDETERMINED: a log that cannot be READ says
    nothing and the launch proceeds. A log that is simply ABSENT is a different
    answer, not the same one -- the project has a CONTROL/ directory and no row
    in it, which is exactly the unbooked launch this shape exists to refuse -- so
    it answers (None, 0, None) and prints booked=none.
    """
    path = os.path.join(control_dir, "dispatch-log.md")
    if not os.path.exists(path):
        return None, 0, None
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except Exception:
        return None
    booked, rows, newest = None, 0, None
    for line in text.splitlines():
        m = ROW_TS.search(line)
        a = ROW_AGENTS.search(line)
        if not m or not a:
            continue
        try:
            when = calendar.timegm(
                (int(m.group(1)), int(m.group(2)), int(m.group(3)),
                 int(m.group(4)), int(m.group(5)), int(m.group(6)), 0, 1, -1)
            )
        except Exception:
            continue
        rows += 1
        age = now - when
        if newest is None or age < newest:
            newest = age
        if abs(age) > BOOKING_WINDOW_SECONDS:
            continue
        n = int(a.group(1))
        if booked is None or n > booked:
            booked = n
    return booked, rows, newest


# ---------------------------------------------------------------------------
# The evaluation. Returns a list of findings; an empty list means "allow".
# ---------------------------------------------------------------------------
def evaluate(script, cwd=None, profiled=False):
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
                    "span": call_span(code, start, args),
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
    if not profiled and not re.search(r"dep\s*=", script):
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
    # SHAPE 6 is NOT scoped: budget_state() returns None when the state file is
    # absent, and that None is already the fail-open answer this hook owes.
    st = None if profiled else budget_state(cwd)
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

    # --- 7. the write-ahead rule: a tree that was never booked ---------------
    # tools/dispatch-check.sh books the WHOLE tree write-ahead and rolls the
    # booking back when the row fails to land, so agents.executions_total is
    # exact for every dispatch that CALLS it. On 2026-09-07 ten stage-2
    # verifiers fired without calling it at all -- no dispatch-log row, no
    # increment -- and the pause line was short by whole trees. SKILL.md
    # section 5 now binds EVERY dispatch, research or build, to book before it
    # fires; this is the half that holds when the conductor forgets.
    # --- 7 scope: outside a marked project the write-ahead rule does not ---
    # apply, so the launch proceeds unexamined. The log is read from the SAME
    # CONTROL/ the marker came out of, never from a nearer or farther one: the
    # marker that proves this IS a spec-protocol project says which log books
    # its dispatches.
    if not profiled:
        control = spec_protocol_project(cwd or os.getcwd())
        if control is None:
            sys.stderr.write(SCOPE_NOTE + "\n")
        else:
            declared = declared_agents(code, stages)
            if declared:
                log = dispatch_log_booking(control, time.time())
                if log is not None:
                    booked, rows, newest = log
                    if booked is None or booked < declared:
                        if rows == 0:
                            detail = "no row carries both a timestamp and an agents= field"
                        else:
                            detail = "%d booking row%s, newest %s old" % (
                                rows, "" if rows == 1 else "s",
                                "unknown age" if newest is None else "%ds" % int(newest),
                            )
                        findings.append(
                            "SHAPE 7 -- DISPATCH-LOG UNBOOKED | declared=%d booked=%s | window=%ds\n"
                            "  (read: %s -- %s)\n%s"
                            % (declared, "none" if booked is None else booked,
                               BOOKING_WINDOW_SECONDS,
                               os.path.join(control, "dispatch-log.md"), detail, FIX_7)
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

    event_cwd = data.get("cwd") if isinstance(data.get("cwd"), str) else os.getcwd()
    profiled_root = profile_project(event_cwd)
    if profiled_root:
        identity, problem = profile_launch_identity(ti)
        if problem:
            profile_block(problem)
        problem = profile_reservation_check(profiled_root, identity)
        if problem:
            profile_block(problem)

    script = ti.get("script")
    if not script:
        path = ti.get("scriptPath")
        if not path or not isinstance(path, str) or not os.path.isfile(path):
            # A profiled name-only launch was reservation-checked above. It has
            # no local bytes for shape analysis, which remains intentionally
            # fail-open just as it was for legacy launches.
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

    if profiled_root:
        try:
            declared = visible_declared_agents(script)
        except Exception:
            declared = None
        if declared is not None and declared > identity["agents"]:
            profile_block(
                "Workflow script explicitly declares %d direct agent() calls, but the "
                "matching reservation authorizes only %d agent(s). Reserve at least the "
                "visible declared count, or use a script whose dynamic fan-out cannot be "
                "counted here; this hook never invents a count."
                % (declared, identity["agents"])
            )

    try:
        findings = evaluate(script, event_cwd, profiled=bool(profiled_root))
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

FIXTURE_THREE_STAGE = """export const meta = { name: 'three-stage', description: 'ten units, three stages' }
const UNITS = [
  { id: 'u01' }, { id: 'u02' }, { id: 'u03' }, { id: 'u04' }, { id: 'u05' },
  { id: 'u06' }, { id: 'u07' }, { id: 'u08' }, { id: 'u09' }, { id: 'u10' },
]
const done = await pipeline(
  UNITS,
  (u) => agent('build ' + u.id, { label: `[Opus x1] build ${u.id}`, phase: 'Build', model: 'opus' }),
  (built, u) => agent('judge ' + u.id, { label: `[Sonnet x1] judge ${u.id}`, phase: 'Judge', model: 'sonnet' }),
  (judged, u) => agent('pen ' + u.id, { label: `[Sonnet x1] pen ${u.id}`, phase: 'Pen', model: 'sonnet' }),
)
return done
"""

FIXTURE_PROFILE_SIX_AGENT = """export const meta = { name: 'profiled-visible-six', description: 'six direct agents' }
const ITEMS = [
  { id: 'u01' }, { id: 'u02' }, { id: 'u03' },
  { id: 'u04' }, { id: 'u05' }, { id: 'u06' },
]
return await pipeline(
  ITEMS,
  (unit) => agent('build ' + unit.id, { label: `build:${unit.id}`, phase: 'Build', model: 'opus' }),
)
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

    # 9d -- a state file with no budget keys says NOTHING (fails open).
    #      SHAPE 6 is unscoped, so no marker ceremony belongs here: one state
    #      file, no pause line, rc 0 for exactly the reason the docstring says.
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

    # 10 -- SHAPE 7, the write-ahead rule: ONE fixture, three answers. Three
    #       stages over ten units declares thirty agents. Booked at thirty it is
    #       allowed; booked at ten it is blocked naming both numbers; booked
    #       nowhere it is blocked naming booked=none. If all three returned the
    #       same code the TEST would be broken, not the target -- which is why
    #       the allowed case is the first of the three and asserted first.
    def log_dir(name, agents, age_seconds=0, write_log=True):
        d = tempfile.mkdtemp(prefix="dispatch-gate-%s." % name, dir=sandbox)
        os.makedirs(os.path.join(d, "CONTROL"), exist_ok=True)
        # The GATE 0 marker is what puts these fixtures IN SCOPE for SHAPE 7
        # (WI-64). It is also what a real project has before its first
        # dispatch: tools/gate0.sh --record writes it at the GATE 0 pass.
        with open(os.path.join(d, "CONTROL", GATE0_MARKER), "w", encoding="utf-8") as fh:
            fh.write("signal=keyword\nrecorded=2026-09-08T00:00:00Z\nproject=selftest\n")
        if write_log:
            ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - age_seconds))
            with open(os.path.join(d, "CONTROL", "dispatch-log.md"), "w", encoding="utf-8") as fh:
                fh.write(
                    "# dispatch log\n\n"
                    "%s | u01-u10 | dispatch | [Opus x10] wave 1 | run=selftest | units=10 | "
                    "agents=%d | cap=10 | floor=10 | stages=3 | dep=none | executions_total=%d\n"
                    % (ts, agents, agents)
                )
        return d

    booked_full = log_dir("booked30", 30)
    rc_ok, out_ok = _run_child(payload(FIXTURE_THREE_STAGE), booked_full)
    report(17, "booked-tree-allowed", rc_ok == 0,
           "rc=%d (want 0): 10 units x 3 stages = 30 declared, and a fresh row books 30%s"
           % (rc_ok, "" if rc_ok == 0 else " -- output: " + out_ok.strip()[:400]))

    booked_short = log_dir("booked10", 10)
    rc_short, out_short = _run_child(payload(FIXTURE_THREE_STAGE), booked_short)
    ok = rc_short == 2 and "SHAPE 7" in out_short and "declared=30 booked=10" in out_short
    report(18, "under-booked-blocked", ok,
           "the SAME script with a row booking 10 -> rc=%d (want 2), naming "
           "declared=30 booked=10: %s"
           % (rc_short, "yes" if "declared=30 booked=10" in out_short else "NO"))

    unbooked = log_dir("unbooked", 0, write_log=False)
    rc_none, out_none = _run_child(payload(FIXTURE_THREE_STAGE), unbooked)
    ok = rc_none == 2 and "SHAPE 7" in out_none and "booked=none" in out_none
    report(19, "unbooked-blocked", ok,
           "the SAME script with no dispatch-log row at all -> rc=%d (want 2), naming "
           "booked=none: %s" % (rc_none, "yes" if "booked=none" in out_none else "NO"))

    stale = log_dir("stale", 30, age_seconds=600)
    rc_stale, out_stale = _run_child(payload(FIXTURE_THREE_STAGE), stale)
    ok = rc_stale == 2 and "booked=none" in out_stale
    report(20, "stale-row-is-not-a-booking", ok,
           "a row booking 30 but written 600s ago -> rc=%d (want 2) and booked=none: it "
           "booked a tree that already fired; without this case the %ds window is untested "
           "code" % (rc_stale, BOOKING_WINDOW_SECONDS))

    # 11 -- THE SCOPE PAIR (WI-64, re-pointed from WI-56e). ONE directory,
    #       two answers, and the ONLY thing that differs between them is the
    #       GATE 0 marker. That is what makes it a scope test rather than a
    #       claim: if the second leg also returned 0 the scope rule would be a
    #       blanket stand-down, and if the first leg blocked, the rule would
    #       not exist at all.
    #
    #       The first leg is the operator's own orchestration folder: a
    #       CONTROL/dispatch-log.md that belongs to something else entirely (a
    #       fleet roll's log), no .gate0-proven, and a spec-protocol tree
    #       launched from inside it. Before this rule SHAPE 7 read that foreign
    #       log, found no booking row for THIS launch, and blocked -- refusing an
    #       operator's workflow for a booking rule that folder never agreed to.
    scope = tempfile.mkdtemp(prefix="dispatch-gate-scope.", dir=sandbox)
    os.makedirs(os.path.join(scope, "CONTROL"), exist_ok=True)
    foreign_log = os.path.join(scope, "CONTROL", "dispatch-log.md")
    with open(foreign_log, "w", encoding="utf-8") as fh:
        fh.write(
            "# an operator's own orchestration log -- not a spec-protocol project\n\n"
            "2026-01-04T09:15:00Z | box-update-B | dispatch | [Sonnet x10] roll 10 boxes | "
            "agents=10\n"
        )
    rc_out, out_out = _run_child(payload(FIXTURE_THREE_STAGE), scope)
    ok = rc_out == 0 and SCOPE_NOTE in out_out
    report(21, "foreign-log-not-in-scope", ok,
           "a cwd carrying an UNRELATED CONTROL/dispatch-log.md and NO .gate0-proven -> "
           "rc=%d (want 0) and stderr carries the one-line note %r: %s. The operator's own "
           "orchestration folder is not a spec-protocol project and is never held to its "
           "booking rule"
           % (rc_out, SCOPE_NOTE, "yes" if SCOPE_NOTE in out_out else "NO -- note absent"))

    # 11b -- the SAME cwd, the SAME script, the SAME foreign log, one GATE 0
    #        marker added and nothing else changed. Now it IS a spec-protocol
    #        project, nothing inside the window booked the tree, and SHAPE 7
    #        blocks. This is the discriminating half: it proves the note above is
    #        a scope decision and not a hole.
    with open(os.path.join(scope, "CONTROL", GATE0_MARKER), "w", encoding="utf-8") as fh:
        fh.write("signal=keyword\nrecorded=2026-09-08T00:00:00Z\nproject=selftest\n")
    rc_in, out_in = _run_child(payload(FIXTURE_THREE_STAGE), scope)
    ok = (rc_in == 2 and "SHAPE 7" in out_in and "booked=none" in out_in
          and SCOPE_NOTE not in out_in)
    report(22, "same-cwd-in-scope-blocked", ok,
           "the IDENTICAL cwd once %s exists -> rc=%d (want 2), SHAPE 7 named: %s, "
           "booked=none: %s, and the scope note is GONE: %s. Only the marker changed"
           % (os.path.join(scope, "CONTROL", GATE0_MARKER), rc_in,
              "yes" if "SHAPE 7" in out_in else "NO",
              "yes" if "booked=none" in out_in else "NO",
              "yes" if SCOPE_NOTE not in out_in else "NO -- still noted"))

    # 12 -- a profile has no CONTROL marker or generic booking. Its packet
    # checker receives the identity through the observed Workflow `args`
    # surface and answers read-only about one pre-existing reservation.
    profiled = tempfile.mkdtemp(prefix="dispatch-gate-profile.", dir=sandbox)
    os.makedirs(os.path.join(profiled, "scripts"), exist_ok=True)
    os.makedirs(os.path.join(profiled, ".studio"), exist_ok=True)
    with open(os.path.join(profiled, ".studio", "build-state.json"), "w", encoding="utf-8") as fh:
        fh.write("{}\n")
    with open(os.path.join(profiled, PROFILE_FILE), "w", encoding="utf-8") as fh:
        json.dump({
            "schema": "spec-protocol.project-profile/v1",
            "documents": {"spec": "SPEC.md", "protocol": "PROTOCOL.md", "state": ".studio/build-state.json", "ledger": "LEDGER.md", "todo": "TODO.md", "checklist": "CHECKLIST.md", "qc": "QC.md"},
            "policy": {"maxActiveWorkflows": 10, "maxAgentsPerWorkflow": 10, "maxWorkingAgents": 100, "maxBuilderSubmissions": 4, "maxQCVerdicts": 4, "builderRoute": "opus-chain", "qcRoute": "sonnet-chain"},
            "targets": ["desktop"],
            "commands": {"validate": ["node", "scripts/state.mjs", "validate"], "dispatch": ["node", "scripts/state.mjs", "dispatch-check"], "release": ["node", "scripts/state.mjs", "release-check"]},
        }, fh)
    with open(os.path.join(profiled, "scripts", "state.mjs"), "w", encoding="utf-8") as fh:
        fh.write(
            "const [cmd,...a]=process.argv.slice(2);\n"
            "if(cmd==='validate'){console.log(JSON.stringify({ok:true,bootstrapReady:true,dispatchReady:false}));process.exit(0)}\n"
            "const get=k=>{const i=a.indexOf(k);return i<0?null:a[i+1]};\n"
            "const task=get('--task'), role=get('--role'), nativeWorkflowId=get('--native-workflow'), label=a[2];\n"
            "const intentId=task==='W01-01'?'intent-live':'intent-consumed';\n"
            "console.log(JSON.stringify({ok:true,taskAuthorization:{approved:true,kind:'reservation-check',readOnly:true,taskId:task,role,intentId,nativeWorkflowId,label,units:Number(a[0]),agents:Number(a[1]),stateRevision:7,sourceSpecHash:'a'.repeat(64),reservation:{id:intentId,state:intentId==='intent-live'?'RESERVED':'CONSUMED'}}}));\n"
        )
    identity = {"taskId": "W01-01", "role": "builder", "intentId": "intent-live", "nativeWorkflowId": "wf-canvas", "label": "[Opus x10] build canvas", "units": 10, "agents": 10}
    profile_event = {"tool_name": "Workflow", "cwd": profiled, "tool_input": {"script": FIXTURE_WAVE1, "args": {"specProtocol": identity}}}
    before = sorted(os.path.relpath(os.path.join(base, name), profiled) for base, _dirs, names in os.walk(profiled) for name in names)
    rc_profile, out_profile = _run_child(json.dumps(profile_event), profiled)
    after = sorted(os.path.relpath(os.path.join(base, name), profiled) for base, _dirs, names in os.walk(profiled) for name in names)
    report(23, "profile-reservation-read-only", rc_profile == 0 and before == after,
           "profile with no CONTROL marker and one matching RESERVED intent -> rc=%d (want 0), files unchanged: %s"
           % (rc_profile, "yes" if before == after and rc_profile == 0 else "NO: " + out_profile[:180]))
    consumed_event = json.loads(json.dumps(profile_event))
    consumed_event["tool_input"]["args"]["specProtocol"]["taskId"] = "W01-02"
    consumed_event["tool_input"]["args"]["specProtocol"]["intentId"] = "intent-consumed"
    rc_consumed, out_consumed = _run_child(json.dumps(consumed_event), profiled)
    report(24, "profile-consumed-refused", rc_consumed == 2 and "remains RESERVED" in out_consumed,
           "same read-only bridge with a consumed intent -> rc=%d (want 2), reservation state named: %s"
           % (rc_consumed, "yes" if "remains RESERVED" in out_consumed else "NO"))
    missing_event = json.loads(json.dumps(profile_event))
    missing_event["tool_input"]["args"] = {}
    rc_missing, out_missing = _run_child(json.dumps(missing_event), profiled)
    report(25, "profile-identity-required", rc_missing == 2 and "args.specProtocol" in out_missing,
           "profiled launch with no supported args identity -> rc=%d (want 2), missing identity named: %s"
           % (rc_missing, "yes" if "args.specProtocol" in out_missing else "NO"))

    underbooked_event = json.loads(json.dumps(profile_event))
    underbooked_event["tool_input"]["script"] = FIXTURE_PROFILE_SIX_AGENT
    underbooked_event["tool_input"]["args"]["specProtocol"]["units"] = 6
    underbooked_event["tool_input"]["args"]["specProtocol"]["agents"] = 5
    rc_underbooked, out_underbooked = _run_child(json.dumps(underbooked_event), profiled)
    report(26, "profile-visible-underbooking-refused",
           rc_underbooked == 2 and "declares 6 direct agent() calls" in out_underbooked
           and "authorizes only 5" in out_underbooked,
           "profiled script visibly declaring six agents against a five-agent reservation -> "
           "rc=%d (want 2), both counts named: %s"
           % (rc_underbooked,
              "yes" if "declares 6 direct agent() calls" in out_underbooked and "authorizes only 5" in out_underbooked else "NO"))

    print("\n".join(results))
    print("")
    if fails == 0:
        print("dispatch-gate.py selftest: ALL PASS (27 checks)")
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
