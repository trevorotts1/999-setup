#!/usr/bin/env python3
"""PreToolUse gate for the Workflow tool -- refuses the forbidden swarm shapes.

Why this exists: RULE 2's width floor and the forbidden shapes of SPEC 8.4.1
were prose. A conductor that resolved the ambiguity conservatively dispatched
"3 agents when 10 were possible" and nothing in the harness said no. This hook
says no, at launch, in the one place the model cannot talk its way past.

It reads the script the launch is about to run (inline `script` or `scriptPath`)
and blocks (exit 2) nine shapes, naming the fix for each:

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
     seconds -> the write-ahead rule (references/enforcement.md section 1,
     "SHAPE 7 — the write-ahead booking rule": dispatch-check.sh runs before
     every wave and writes the row), made mechanical.
     The message names both numbers: `declared=<n> booked=<n>`, or
     `booked=none` when nothing booked it at all.
  8. a BUILD dispatch out of a project whose CONTROL/LEDGER.md carries no
     `SEAT-PROBE: seats=<n> callable=<n> dead=<n> undetermined=<n>` line ->
     no seat was ever proven CALLABLE. tools/dispatch-check.sh refuses the
     same dispatch with exit 11; a ledger that discusses seats in PROSE is
     what the 2026-09-08 canary had instead of a probe.
  9. a BUILD dispatch with no PROVEN repository behind it -- no
     tools/repo-anchor.sh receipt beside the project's state, or a receipt
     whose remote is no longer what `git remote get-url origin` says. The
     skill's own description promises "merged-to-GitHub" and nothing in it
     ever created the repository or the remote; a run reached its first QC
     handoff on a folder that was not a git repository at all. A receipt with
     "source": "local-only" (the client declined GitHub and no operator owner
     was set) is accepted without the origin comparison: the work is anchored
     in a local repository and the morning report says it is not yet online.
 10. a BUILD dispatch out of a marked project with no run start marker
     (<project>/.spec-protocol-opened-<ISO8601Z>, tools/gate0.sh --open) or
     whose five-minute tick is not armed (tools/watch-tick.sh <project> --check
     rc 3). Any other rc, a missing tool, or a 5 s timeout fails open.

AGENT / TASK CALLS (fix #5). The same hook is registered on
"Workflow|Agent|Task" because the degrade path of references/workflows.md fans
out plain Agent calls, which never reached this gate. An Agent/Task call whose
description, or the first line of its prompt, carries "build" gets SHAPES 8, 9
and 10 exactly as a Workflow build does; every other Agent call (reader,
researcher, judge) passes in silence. Shapes 1-7 are facts about a Workflow
script and do not apply to a single agent. A READER is never a build, whatever
else its prompt says (round 7): its description or subagent_type says read,
reader, research, explore or audit-read; or its prompt's first 200 characters
say READ-ONLY / read-only / "You are a reader"; or subagent_type is Explore.
The skill owes a reader dispatch before the first confirm sentence, long before
repo-anchor, so an incidental "build" ("a reader for a build run") must not
hold it to SHAPES 8-10.

SHAPE 9 IS SCOPED TOO, but to BOTH project shapes: a marked legacy CONTROL/
and a profiled `.spec-protocol.json` alike, because the promise it enforces is
made to every client on every run. Its receipt lives at CONTROL/repo-anchor.json
on a legacy project and beside the profile's own `documents.state` on a profiled
one -- tools/ledger.sh refuses a profiled project by design, so there the receipt
IS the record. The `git remote get-url origin` it runs is a CONFIG READ with a
five-second timeout: SHAPE 9 never touches the network, and a git that will not
run, a timeout, or a malformed receipt is UNDETERMINED and fails open in silence.

SHAPES 7 AND 8 ARE SCOPED to spec-protocol projects. They are evaluated only
when cwd, or a parent up to forty levels above it, carries the GATE 0 marker
-- the file tools/gate0.sh --record writes after a genuine GATE 0 pass,
present before any dispatch and absent from any folder that merely has a
CONTROL/ directory. Everywhere else they fail OPEN -- SHAPE 7 saying so on
stderr in one line -- so an operator's own orchestration folder, which may
carry a CONTROL/dispatch-log.md of its own and no marker, is never refused for
a booking rule it never agreed to. SHAPE 6 is NOT scoped: it reads the budget
through find_state_file and fails open on whatever it cannot measure. Shapes
1-5 are facts about the SCRIPT and are not scoped: they hold wherever a
Workflow launches.

PROFILED PROJECTS are detected before any CONTROL lookup. They have one narrow,
read-only branch: the hook requires the actual Workflow `args.specProtocol`
identity and asks the profile's packet checker for an exact `RESERVED` intent.
It does not reserve, consume, increment a counter, or claim that launch equals
native receipt; the packet writer records consumption after its observed native
receipt. A missing, malformed, mismatched, or already-consumed reservation
fails closed. This branch deliberately does not read legacy CONTROL state --
and tools/seat-probe.sh itself refuses a profiled project (PROFILE-OWNED), so
SHAPE 8 never applies to one either.

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
    "  (agents.pause_blocks_granted + 1). It is a CHECKPOINT (references/capacity.md\n"
    "  section 10, THE SPEND LINE). When CONTROL/LEDGER.md carries a COST-LINE: and metered\n"
    "  spend is below it (or the line reads 'unmetered'), SELF-GRANT: run\n"
    "    bash tools/dispatch-check.sh <project> <units> <agents> \"<label>\" spend_usd=<y>\n"
    "  -- it writes the PAUSE-GRANT: line and raises agents.pause_blocks_granted, which\n"
    "  moves this wall up by one block -- then launch again; the client is not asked.\n"
    "  ONLY when spend is at or over the COST-LINE, or no COST-LINE is recorded: deploy the\n"
    "  best stable build, write the plain report, then ask the one question (SKILL.md\n"
    "  section 6); each 'keep going' raises agents.pause_blocks_granted the same way. The\n"
    "  run resumes at FULL width -- a pause is never a stop. tools/dispatch-check.sh\n"
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
    "  -- then launch again within the window. This is the write-ahead rule of\n"
    "  references/enforcement.md section 1, 'SHAPE 7 -- the write-ahead booking rule' (every\n"
    "  wave is booked before it fires) with a wall\n"
    "  behind it. A research reader (one agent, phase research, no build label) is exempt.\n"
    "  WHY: on 2026-09-07 ten stage-2 verifiers fired with NO dispatch-log row at all, so\n"
    "  agents.executions_total read 6 while 17 agents had run and the pause line was short by\n"
    "  whole trees. The counter was never the defect -- nothing forced the call that moves it.\n"
    "  RESIDUAL LIMIT (references/enforcement.md 1): this books a tree's DECLARED width at\n"
    "  launch. A PreToolUse hook fires once per launch, so an agent an already-running\n"
    "  workflow spawns internally is invisible here; tools/anchor.sh's dispatch-log census is\n"
    "  the cross-check, and a divergence between the two is a finding, never a rounding error."
)

FIX_8 = (
    "FIX: run  tools/seat-probe.sh <project>  first (SKILL.md step 21). It proves every seat\n"
    "  CALLABLE with a known-answer smoke call and writes exactly one line through\n"
    "  tools/ledger.sh:  SEAT-PROBE: seats=<n> callable=<n> dead=<n> undetermined=<n>\n"
    "  The SHAPE of that line is the proof the probe RAN, which is why this gate matches it and\n"
    "  never reads its counters. A ledger that DISCUSSES seats in prose has not run the probe.\n"
    "  WHY: on 2026-09-08 a run dispatched builders with no seat ever proven callable, behind a\n"
    "  ledger that talked about seat capacity at length. tools/dispatch-check.sh refuses the same\n"
    "  dispatch with exit 11; this hook is the half that holds when the conductor never calls it."
)

FIX_9 = (
    "  FIX: run  tools/repo-anchor.sh <project>  first (SKILL.md step 17). It creates the\n"
    "  repository if there is none, arranges the remote on the client's own GitHub login (or\n"
    "  the operator-provided remote when they declined), proves it with ls-remote and writes\n"
    "  the receipt this gate reads.\n"
    "  WHY: the skill promises merged-to-GitHub; a run once reached its first QC handoff on a\n"
    "  folder that was not a git repository at all, and nothing had refused the builders."
)

# SHAPE 7's booking window. A row older than this booked a tree that has already
# fired, so it is not a booking for THIS launch. Two minutes is the same order as
# the step it enforces: write the row, then launch.
BOOKING_WINDOW_SECONDS = 120

# A dispatch-log row as tools/dispatch-check.sh writes it:
#   <ISO8601Z> | <unit> | dispatch | <label> | run=… | units=… | agents=<n> | …
ROW_TS = re.compile(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})")
ROW_AGENTS = re.compile(r"(?<![A-Za-z0-9_-])agents\s*=\s*(\d+)")

# SHAPE 8's proof-of-probe. tools/dispatch-check.sh's SEAT_PROBE_RE, character
# for character, with [[:space:]] as \s -- and matched line by line, the way
# grep -E reads it, so no newline can bridge two fields. The counters are
# deliberately NOT read: the SHAPE is the proof the probe ran (dispatch-check.sh
# exit 11 and its comment at SEAT_PROBE_RE say the same).
SEAT_PROBE_RE = re.compile(
    r"SEAT-PROBE:\s*seats=\d+\s+callable=\d+\s+dead=\d+\s+undetermined=\d+"
)

# tools/dispatch-check.sh's is_build_label(), which is deliberately broad: any
# label carrying "build" in any case is a build dispatch, "rebuild" included.
BUILD_LABEL_RE = re.compile(r"build", re.I)

# Round 7: an Agent/Task call that says it only reads. Checked BEFORE the build
# label, so "You are a reader for a build run" stays a reader.
READER_LABEL_RE = re.compile(r"\b(read(er|ers|ing|s)?|research\w*|explor\w*|audit-read)\b", re.I)
READER_PROMPT_RE = re.compile(r"READ-ONLY|read-only|You are a reader")

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
PROFILE_ROLES = ("builder", "qc", "repair", "reader")
# A reader inspects and reports: it writes nothing, owns no path, and spends no
# builder or QC counter, so it has nothing to reserve and is reservation-exempt.
# Without this, a profiled project cannot dispatch a reader at all -- which forces
# the conductor to read whole project documents in its own context, the exact thing
# SKILL.md section 13 forbids. A reader that tries to write is rejected by the
# packet's state writer, where that check belongs.
PROFILE_EXEMPT_ROLES = ("reader",)


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


def run_arg_len(run_args, key):
    """len(tool_input.args[key]) when the launch passed that key as a list, else None."""
    v = run_args.get(key) if isinstance(run_args, dict) else None
    return len(v) if isinstance(v, list) else None


def resolve_identifier(code, ident, run_args=None):
    m = re.search(
        r"(?:const|let|var)\s+" + re.escape(ident) + r"\s*=\s*\[", code
    )
    if m:
        return count_array_elements(code, m.end() - 1)
    # D2: the templates read their items from the launch's own args
    # (`const units = args.units`), so the count lives in tool_input.args.
    m = re.search(
        r"(?:const|let|var)\s+" + re.escape(ident) + r"\s*=\s*args\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:[;\n]|$)",
        code,
    )
    return run_arg_len(run_args, m.group(1)) if m else None


def count_items(args, code, run_args=None):
    """How many items this stage call passes. None = UNDETERMINED (never a verdict)."""
    a = args.lstrip()
    if a.startswith("["):
        return count_array_elements(args, args.index("["))
    m = re.match(r"args\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\.\s*map\b|,|$)", a)
    if m:
        return run_arg_len(run_args, m.group(1))
    m = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*map\b", a)
    if m:
        return resolve_identifier(code, m.group(1), run_args)
    m = re.match(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|$)", a)
    if m:
        return resolve_identifier(code, m.group(1), run_args)
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


def declared_agents(code, stages, run_args=None):
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
    # D2: a template declares its own count in `meta` -- agentsTotal: <n>, or
    # agentsPerUnit: <k> (x len(args.units)). The larger of that and what the
    # parser can see is the count: a declaration can raise the visible count
    # (fan-out in a helper) but never lower it.
    meta = None
    m = re.search(r"(?<![A-Za-z0-9_$])agentsTotal\s*:\s*(\d+)", code)
    if m:
        meta = int(m.group(1))
    else:
        m = re.search(r"(?<![A-Za-z0-9_$])agentsPerUnit\s*:\s*(\d+)", code)
        n = run_arg_len(run_args, "units")
        if m and n is not None:
            meta = int(m.group(1)) * n
    visible = _visible_agents(code, stages)
    if visible is None:
        return meta or None
    return max(visible, meta or 0) or None


def _visible_agents(code, stages):
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


def visible_declared_agents(script, run_args=None):
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
                    "items": count_items(args, code, run_args),
                }
            )
    stages.sort(key=lambda stage: stage["start"])
    return declared_agents(code, stages, run_args)


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


# D1: the project comes from THIS session's transcript, the way
# conversation-gate.py resolves it -- tools/answers.sh prints
# `ANSWERS | init | <project>/00-INPUT/ANSWERS.md` (and `| flush |` when a held
# interview moves into the project). The latest such result line wins; a held
# file under spec-protocol/runs/ names no project yet and is skipped. With no
# line at all the launch's cwd is walked, so an operator session that never ran
# answers.sh stays exactly as scoped as before.
ANSWERS_RESULT = re.compile(r"^ANSWERS \| (?:init|flush) \| (.+?)\s*$", re.M)
ANSWERS_SUFFIX = os.path.join("00-INPUT", "ANSWERS.md")


def _tool_result_texts(rec):
    for b in (rec.get("message") or {}).get("content") or []:
        if not isinstance(b, dict) or b.get("type") != "tool_result":
            continue
        c = b.get("content")
        if isinstance(c, str):
            yield c
        elif isinstance(c, list):
            for x in c:
                if isinstance(x, dict) and isinstance(x.get("text"), str):
                    yield x["text"]


def transcript_project(transcript_path, cwd):
    """The project this session's latest answers.sh result line names, or None."""
    if not isinstance(transcript_path, str) or not os.path.isfile(transcript_path):
        return None
    found = None
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "ANSWERS | " not in line:
                    continue  # cheap pre-filter before any JSON parse
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if not isinstance(rec, dict) or rec.get("isSidechain") or rec.get("type") != "user":
                    continue
                for text in _tool_result_texts(rec):
                    for m in ANSWERS_RESULT.finditer(text):
                        path = os.path.expanduser(m.group(1).strip().strip("'\""))
                        if "%sspec-protocol%sruns%s" % (os.sep, os.sep, os.sep) in path:
                            continue  # a held interview, not a project
                        if not path.endswith(ANSWERS_SUFFIX):
                            continue
                        found = path[: -len(ANSWERS_SUFFIX)].rstrip(os.sep) or os.sep
    except Exception:
        return None
    if not found:
        return None
    if not os.path.isabs(found):
        found = os.path.join(cwd or os.getcwd(), found)
    found = os.path.abspath(found)
    return found if os.path.isdir(found) else None


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
    if identity.get("role") in PROFILE_EXEMPT_ROLES:
        # A reader carries no intent id because no intent is ever reserved for it.
        required_strings = ("taskId", "role", "label")
    else:
        required_strings = ("taskId", "role", "intentId", "nativeWorkflowId", "label")
    if any(not isinstance(identity.get(k), str) or not identity[k] for k in required_strings):
        return None, (
            "args.specProtocol must carry non-empty %s." % ", ".join(required_strings)
        )
    if identity["role"] not in PROFILE_ROLES:
        return None, "args.specProtocol.role must be builder, qc, repair, or reader."
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


def has_seat_probe_line(control_dir):
    """True / False for the SEAT-PROBE: line, or None when it cannot be READ.

    False is an ANSWER, not a shrug: a project with a CONTROL/ directory and no
    SEAT-PROBE: line in its ledger -- an absent ledger included -- is exactly the
    run that never proved a seat callable, which is what SHAPE 8 refuses. It is
    the same three-way split dispatch_log_booking() makes for the same reason.
    Only an unreadable path is UNDETERMINED, and that one fails open.
    """
    path = os.path.join(control_dir, "LEDGER.md")
    if not os.path.exists(path):
        return False
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except Exception:
        return None
    return any(SEAT_PROBE_RE.search(line) for line in text.splitlines())


# A credential embedded in a remote URL, stripped before any comparison so a
# working copy whose origin carries one is never refused for carrying it. The
# URL itself is never printed by this hook -- tools/env-sweep.sh:164 is the rule.
CRED_IN_URL = re.compile(r"://[^/@]*@")
REPO_ANCHOR_RECEIPT = "repo-anchor.json"


def strip_cred(url):
    return CRED_IN_URL.sub("://", (url or "").strip())


def repo_anchor_receipt_path(cwd, profiled):
    """Where tools/repo-anchor.sh files its receipt, or None when out of scope.

    Profiled: beside the profile's own `documents.state`, which is the directory
    a packet owns -- tools/ledger.sh refuses a profiled project (ledger.sh:471),
    so there the receipt IS the record. Legacy: the CONTROL/ the GATE 0 marker
    came out of, the same directory SHAPES 7 and 8 read.
    """
    if profiled:
        root = profile_project(cwd)
        if not root:
            return None
        try:
            with open(os.path.join(root, PROFILE_FILE), encoding="utf-8", errors="replace") as fh:
                doc = json.load(fh)
            state = doc["documents"]["state"]
        except Exception:
            return None
        if not isinstance(state, str) or not state or state.startswith("/") or ".." in state:
            return None
        return os.path.join(root, os.path.dirname(state), REPO_ANCHOR_RECEIPT)
    control = spec_protocol_project(cwd)
    if not control:
        return None
    return os.path.join(control, REPO_ANCHOR_RECEIPT)


def repo_anchor_proven(path):
    """True / False for the receipt, or None when it cannot be MEASURED.

    False is an ANSWER, the same three-way split has_seat_probe_line() makes: no
    receipt at all is exactly the unanchored build this shape refuses, and a
    receipt whose repoRoot no longer has that origin is a receipt describing a
    repository that is no longer there. Only a malformed receipt, a git that will
    not run, or a timeout is UNDETERMINED -- and that one fails open in silence.

    `git remote get-url origin` is a CONFIG READ. It reaches no network, which is
    what lets a PreToolUse hook call it on every build launch.
    """
    if not os.path.exists(path):
        return False
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            doc = json.load(fh)
        root, want = doc["repoRoot"], doc.get("remote")
    except Exception:
        return None
    if not isinstance(root, str) or not root:
        return None
    if doc.get("source") == "local-only":
        # fix #6: no remote exists by design -- a local repository is the anchor.
        return os.path.isdir(root)
    if not isinstance(want, str) or not want:
        return None
    try:
        proc = subprocess.run(
            ["git", "-C", root, "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return False  # the receipt names a working copy that has no origin today
    return strip_cred(proc.stdout) == strip_cred(want)


def is_build_dispatch(code):
    """True when any agent() this script declares carries a build label.

    tools/dispatch-check.sh is handed ONE label on the command line and tests it
    with is_build_label(); a Workflow launch carries one per agent(), so the same
    broad test is applied to every label:/phase: value this parser can see -- the
    same pair SHAPE 5 reads. Fail-closed is the safe direction there and here:
    the cost of gating one extra dispatch is a run of tools/seat-probe.sh.
    """
    for _start, args in find_calls(code, "agent"):
        for value in option_values(args, "label") + option_values(args, "phase"):
            if BUILD_LABEL_RE.search(value):
                return True
    return False


def is_reader_agent(ti):
    """True when an Agent/Task call is a reader: never a build, never SHAPES 8-10."""
    desc = ti.get("description") if isinstance(ti.get("description"), str) else ""
    kind = ti.get("subagent_type") if isinstance(ti.get("subagent_type"), str) else ""
    prompt = ti.get("prompt") if isinstance(ti.get("prompt"), str) else ""
    return (kind == "Explore" or bool(READER_LABEL_RE.search(desc + "\n" + kind))
            or bool(READER_PROMPT_RE.search(prompt[:200])))


def is_research_reader(code, declared):
    """D3: one agent, a research phase or reader label, and no build label.

    The step-3.5 reader dispatches before any Capacity Ledger, Parallelism Plan
    or seat exists; booking it would refuse the one dispatch the run needs to
    learn what to build. tools/dispatch-check.sh exempts the same shape.
    """
    if declared != 1 or is_build_dispatch(code):
        return False
    for _start, args in find_calls(code, "agent"):
        for value in option_values(args, "phase") + option_values(args, "label"):
            if re.search(r"research|reader", value, re.I):
                return True
    return False


# SHAPE 10 -- start marker and tick arming (fix #32).
START_MARKER_PREFIX = ".spec-protocol-opened-"
FIX_10 = (
    "  FIX: the run must be opened and watched before anything is built.\n"
    "  Start marker: tools/gate0.sh --open <project> (SKILL.md step 3).\n"
    "  Tick: tools/watch-tick.sh --arm <project> (SKILL.md step 3); proven by\n"
    "  tools/watch-tick.sh <project> --check returning 0."
)


def watch_tick_path():
    """tools/watch-tick.sh: env override, source layout, then the installed skill."""
    candidates = []
    if os.environ.get("SPEC_PROTOCOL_WATCH_TICK"):
        candidates.append(os.environ["SPEC_PROTOCOL_WATCH_TICK"])
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "watch-tick.sh"))
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    candidates.append(os.path.join(config, "skills", "spec-protocol", "tools", "watch-tick.sh"))
    return next((c for c in candidates if os.path.isfile(c)), None)


def tick_armed(project):
    """True (rc 0) / False (rc 3) from watch-tick.sh --check; None on anything else."""
    tick = watch_tick_path()
    if not tick:
        return None
    try:
        rc = subprocess.run(["bash", tick, project, "--check"],
                            capture_output=True, text=True, timeout=5).returncode
    except Exception:
        return None
    return {0: True, 3: False}.get(rc)


def build_findings(cwd, profiled):
    """SHAPES 8, 9 and 10 -- the gates every BUILD dispatch owes, Workflow or Agent."""
    findings = []
    # --- 9. no proven repository behind the build ---------------------------
    # The skill's own description promises "merged-to-GitHub"; a run once
    # reached its first QC handoff on a folder that was not a git repository at
    # all, because prose said "determine GitHub" and nothing refused the
    # builders. Unlike SHAPES 7 and 8 this one is scoped to BOTH project shapes:
    # the promise is made to every client on every run, and
    # tools/repo-anchor.sh writes its receipt on either.
    receipt = repo_anchor_receipt_path(cwd, profiled)
    if receipt is not None and repo_anchor_proven(receipt) is False:
        findings.append(
            "SHAPE 9 -- NO-REPO-ANCHOR | no proven repository behind this build "
            "(read: %s)\n%s" % (receipt, FIX_9)
        )
    if profiled:
        return findings
    control = spec_protocol_project(cwd)
    if control is None:
        return findings
    # --- 8. no seat proven callable, no builder -----------------------------
    # tools/seat-probe.sh is a shipped instrument the 2026-09-08 canary never
    # ran, because nothing refused a builder over its absence.
    # tools/dispatch-check.sh refuses the same dispatch with exit 11; this is
    # the half that intercepts the launch itself. Same scope and the same
    # CONTROL/ as SHAPE 7. seat-probe.sh refuses a profiled project, hence the
    # return above.
    if has_seat_probe_line(control) is False:
        findings.append(
            "SHAPE 8 -- NO-SEAT-PROBE | CONTROL/LEDGER.md carries no SEAT-PROBE: line\n"
            "  (read: %s)\n%s" % (os.path.join(control, "LEDGER.md"), FIX_8)
        )
    # --- SHAPE 10. start marker and armed tick ------------------------------
    project = os.path.dirname(control)
    try:
        opened = any(n.startswith(START_MARKER_PREFIX) for n in os.listdir(project))
    except Exception:
        opened = None
    armed = tick_armed(project)
    missing = []
    if opened is False:
        missing.append("no %s<ISO8601Z> marker in %s" % (START_MARKER_PREFIX, project))
    if armed is False:
        missing.append("watch-tick.sh --check says the five-minute tick is not armed")
    if missing:
        findings.append("SHAPE 10 -- RUN-NOT-OPENED | %s\n%s" % ("; ".join(missing), FIX_10))
    return findings


# ---------------------------------------------------------------------------
# The evaluation. Returns a list of findings; an empty list means "allow".
# ---------------------------------------------------------------------------
def evaluate(script, cwd=None, profiled=False, run_args=None):
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
                    "items": count_items(args, code, run_args),
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
    # A template launched by path cannot carry a dep= comment per launch, so
    # args.dep (a non-empty reason string) stands the width check down the same way.
    dep_arg = isinstance(run_args, dict) and isinstance(run_args.get("dep"), str) and run_args["dep"].strip()
    if not profiled and not dep_arg and not re.search(r"dep\s*=", script):
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
                    "  reason in the script as a `dep=<reason>` comment (or pass args.dep for a\n"
                    "  template launched by path) and this check stands down."
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

    # --- 8, 9, 10. the gates every BUILD dispatch owes (see build_findings) ---
    if is_build_dispatch(code):
        findings.extend(build_findings(cwd or os.getcwd(), profiled))

    # --- 7. the write-ahead rule: a tree that was never booked ---------------
    # tools/dispatch-check.sh books the WHOLE tree write-ahead and rolls the
    # booking back when the row fails to land, so agents.executions_total is
    # exact for every dispatch that CALLS it. On 2026-09-07 ten stage-2
    # verifiers fired without calling it at all -- no dispatch-log row, no
    # increment -- and the pause line was short by whole trees.
    # references/enforcement.md section 1 ("SHAPE 7 — the write-ahead booking
    # rule") binds every wave to book before it fires; this is the half that holds when the conductor forgets.
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
            declared = declared_agents(code, stages, run_args)
            if declared and is_research_reader(code, declared):
                declared = None  # D3: a research reader is exempt from booking
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
    if not isinstance(data, dict) or data.get("tool_name") not in ("Workflow", "Agent", "Task"):
        allow()

    ti = data.get("tool_input") or {}
    if not isinstance(ti, dict):
        allow()

    event_cwd = data.get("cwd") if isinstance(data.get("cwd"), str) else os.getcwd()
    # D1: every lookup below starts from the session's own project when the
    # transcript names one, so a conductor that is not cd'd into it is still gated.
    try:
        event_cwd = transcript_project(data.get("transcript_path"), event_cwd) or event_cwd
    except Exception:
        pass

    if data.get("tool_name") != "Workflow":
        # fix #5: an Agent/Task call is a build dispatch when its description or
        # the first line of its prompt says "build"; it then owes SHAPES 8-10.
        # A reader never does (round 7), whatever else its prompt says.
        if is_reader_agent(ti):
            allow()
        desc = ti.get("description") if isinstance(ti.get("description"), str) else ""
        prompt = ti.get("prompt") if isinstance(ti.get("prompt"), str) else ""
        first = prompt.strip().splitlines()[0] if prompt.strip() else ""
        if not BUILD_LABEL_RE.search(desc + "\n" + first):
            allow()
        try:
            findings = build_findings(event_cwd, bool(profile_project(event_cwd)))
        except Exception:
            allow()
        if findings:
            block(findings)
        allow()

    profiled_root = profile_project(event_cwd)
    if profiled_root:
        identity, problem = profile_launch_identity(ti)
        if problem:
            profile_block(problem)
        if identity["role"] not in PROFILE_EXEMPT_ROLES:
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
            declared = visible_declared_agents(script, ti.get("args"))
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
        findings = evaluate(script, event_cwd, profiled=bool(profiled_root), run_args=ti.get("args"))
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

FIXTURE_NO_BUILD_LABEL = """export const meta = { name: 'audit-only', description: 'three units, one auditor each' }
const UNITS = [ { id: 'u01' }, { id: 'u02' }, { id: 'u03' } ]
const done = await pipeline(
  UNITS,
  (u) => agent('inspect ' + u.id, { label: `[Sonnet x1] audit ${u.id}`, phase: 'Audit', model: 'sonnet' }),
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
    # SHAPE 10 must never read the operator's real crontab: every child sees a
    # stub watch-tick.sh (rc 0 = armed) unless a check swaps it for rc 3.
    tick_ok = os.path.join(sandbox, "tick-ok.sh")
    tick_unarmed = os.path.join(sandbox, "tick-unarmed.sh")
    for _p, _rc in ((tick_ok, 0), (tick_unarmed, 3)):
        with open(_p, "w", encoding="utf-8") as fh:
            fh.write("exit %d\n" % _rc)
    os.environ["SPEC_PROTOCOL_WATCH_TICK"] = tick_ok

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

    def git_ok():
        try:
            return subprocess.run(["git", "--version"], capture_output=True,
                                  text=True, timeout=20).returncode == 0
        except Exception:
            return False

    def git_repo_with_origin(parent, name, origin):
        """A REAL git repo whose origin is `origin`. None when git will not run.

        SHAPE 9's proof is `git remote get-url origin`, so the fixture has to be
        a real repository -- a mocked one would test the mock.
        """
        root = os.path.join(parent, name)
        os.makedirs(root, exist_ok=True)
        try:
            for cmd in (["git", "init", "-q", root],
                        ["git", "-C", root, "remote", "add", "origin", origin]):
                if subprocess.run(cmd, capture_output=True, text=True, timeout=20).returncode != 0:
                    return None
        except Exception:
            return None
        return root

    def write_anchor_receipt(state_dir, repo_root, remote, source="client-gh"):
        """The receipt tools/repo-anchor.sh writes after its ls-remote proof."""
        os.makedirs(state_dir, exist_ok=True)
        with open(os.path.join(state_dir, "repo-anchor.json"), "w", encoding="utf-8") as fh:
            json.dump({"repoRoot": repo_root, "remote": remote, "branch": "main",
                       "head": "0" * 40, "provedAt": "2026-09-22T00:00:00Z",
                       "source": source}, fh, indent=2)

    def write_ledger(d, kind):
        path = os.path.join(d, "CONTROL", "LEDGER.md")
        if kind == "none":
            if os.path.exists(path):
                os.remove(path)
            return
        body = ("- 2026-09-08T00:00:00Z | SEAT-PROBE: seats=12 callable=12 dead=0 undetermined=0\n"
                if kind == "probe" else
                "- 2026-09-08T00:00:00Z | we have 12 seats, all callable -- seat probe looks fine\n")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("# ledger\n\n" + body)

    # 10 -- SHAPE 7, the write-ahead rule: ONE fixture, three answers. Three
    #       stages over ten units declares thirty agents. Booked at thirty it is
    #       allowed; booked at ten it is blocked naming both numbers; booked
    #       nowhere it is blocked naming booked=none. If all three returned the
    #       same code the TEST would be broken, not the target -- which is why
    #       the allowed case is the first of the three and asserted first.
    # `ledger` is SHAPE 8's one variable: "probe" writes the proven line,
    # "prose" writes a ledger that only TALKS about seats, "none" writes no
    # ledger at all. Every pre-SHAPE-8 fixture keeps the default so the checks
    # above keep testing what they were written to test.
    def log_dir(name, agents, age_seconds=0, write_log=True, ledger="probe", anchor="ok"):
        d = tempfile.mkdtemp(prefix="dispatch-gate-%s." % name, dir=sandbox)
        os.makedirs(os.path.join(d, "CONTROL"), exist_ok=True)
        write_ledger(d, ledger)
        # `anchor` is SHAPE 9's one variable, added the same way `ledger` was
        # added for SHAPE 8: "ok" gives every pre-SHAPE-9 fixture a valid
        # repo-anchor receipt so 8 and 9 never score each other, "none" writes
        # no receipt at all.
        if anchor == "ok":
            repo = git_repo_with_origin(d, "repo", os.path.join(d, "origin.git"))
            if repo:
                write_anchor_receipt(os.path.join(d, "CONTROL"), repo,
                                     os.path.join(d, "origin.git"))
        # SHAPE 10's start marker, which tools/gate0.sh --open writes at step 3.
        open(os.path.join(d, ".spec-protocol-opened-2026-09-08T00:00:00Z"), "w").close()
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
    write_ledger(scope, "probe")  # so leg 11b isolates SHAPE 7, not SHAPE 8
    _scope_repo = git_repo_with_origin(scope, "repo", os.path.join(scope, "origin.git"))
    if _scope_repo:  # and SHAPE 9 either: only the marker may change the answer
        write_anchor_receipt(os.path.join(scope, "CONTROL"), _scope_repo,
                             os.path.join(scope, "origin.git"))
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
    # A profiled project's repo is rooted at the project home itself and its
    # repo-anchor receipt sits beside documents.state, which is .studio/ here.
    # Without it SHAPE 9 would refuse every profiled build fixture below, and
    # checks 23-26 and 32 would stop testing what they were written to test.
    _profiled_repo = git_repo_with_origin(os.path.dirname(profiled), os.path.basename(profiled),
                                          os.path.join(sandbox, "profiled-origin.git"))
    if _profiled_repo:
        write_anchor_receipt(os.path.join(profiled, ".studio"), profiled,
                             os.path.join(sandbox, "profiled-origin.git"))
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

    # 13 -- SHAPE 8, the seat probe: ONE directory, ONE script, three answers,
    #       and the ONLY thing that changes between them is the ledger's line.
    #       The tree is booked at 30 throughout, so SHAPE 7 is satisfied and
    #       anything that blocks here blocked for SHAPE 8 -- asserted, not
    #       assumed. The PROSE leg is the discriminating control: a ledger that
    #       talks about seats at length is what the 2026-09-08 canary had, and a
    #       gate that keyed on the word "seat" instead of the line's SHAPE would
    #       let it through.
    seatdir = log_dir("seatprobe", 30, ledger="none")
    rc_s0, out_s0 = _run_child(payload(FIXTURE_THREE_STAGE), seatdir)
    ok = rc_s0 == 2 and "SHAPE 8" in out_s0 and "SHAPE 7" not in out_s0
    report(27, "no-seat-probe-blocked", ok,
           "a booked build tree whose CONTROL/LEDGER.md carries no SEAT-PROBE line -> rc=%d "
           "(want 2), SHAPE 8 named: %s, and NOT a SHAPE 7 booking refusal: %s"
           % (rc_s0, "yes" if "SHAPE 8" in out_s0 else "NO",
              "correct" if "SHAPE 7" not in out_s0 else "NO -- blocked for the other rule"))

    write_ledger(seatdir, "prose")
    rc_s1, out_s1 = _run_child(payload(FIXTURE_THREE_STAGE), seatdir)
    ok = rc_s1 == 2 and "SHAPE 8" in out_s1
    report(28, "prose-ledger-still-blocked", ok,
           "the SAME dir once the ledger SAYS 'we have 12 seats, all callable' in prose -> "
           "rc=%d (want 2): prose is not a probe, the line's shape is the proof" % rc_s1)

    write_ledger(seatdir, "probe")
    rc_s2, out_s2 = _run_child(payload(FIXTURE_THREE_STAGE), seatdir)
    report(29, "seat-probe-line-allows", rc_s2 == 0,
           "the SAME dir once ONE real SEAT-PROBE: seats=12 callable=12 dead=0 undetermined=0 "
           "line exists -> rc=%d (want 0). Without this leg the two above would score a gate "
           "that refused every build%s"
           % (rc_s2, "" if rc_s2 == 0 else " -- output: " + out_s2.strip()[:400]))

    # 13b -- not a build dispatch: SHAPE 8 is silent. is_build_label() is
    #        deliberately broad, so the negative case has to be a tree whose
    #        labels carry no "build" anywhere -- three auditors, no ledger.
    nobuild = log_dir("nobuild", 3, ledger="none")
    rc_nb2, out_nb2 = _run_child(payload(FIXTURE_NO_BUILD_LABEL), nobuild)
    report(30, "non-build-label-silent", rc_nb2 == 0 and "SHAPE 8" not in out_nb2,
           "an audit-labelled tree in the SAME ledger-less project -> rc=%d (want 0) and no "
           "SHAPE 8: %s" % (rc_nb2, "yes" if "SHAPE 8" not in out_nb2 else "NO -- refused"))

    # 13c -- no GATE 0 marker: out of scope, exactly like SHAPE 7. A folder
    #        that merely owns a CONTROL/ directory never agreed to this rule.
    unmarked = tempfile.mkdtemp(prefix="dispatch-gate-unmarked.", dir=sandbox)
    os.makedirs(os.path.join(unmarked, "CONTROL"), exist_ok=True)
    rc_um, out_um = _run_child(payload(FIXTURE_THREE_STAGE), unmarked)
    report(31, "unmarked-project-silent", rc_um == 0 and "SHAPE 8" not in out_um,
           "a CONTROL/ directory with no %s and no ledger -> rc=%d (want 0) and no SHAPE 8: %s"
           % (GATE0_MARKER, rc_um, "yes" if "SHAPE 8" not in out_um else "NO -- refused"))

    # 13d -- a profiled project: tools/seat-probe.sh itself refuses one
    #        (PROFILE-OWNED), so SHAPE 8 must not demand a line that instrument
    #        will never write. Marker and prose ledger added to the SAME
    #        profiled fixture that passed check 23, so only the profile branch
    #        can be what keeps it at rc 0.
    os.makedirs(os.path.join(profiled, "CONTROL"), exist_ok=True)
    with open(os.path.join(profiled, "CONTROL", GATE0_MARKER), "w", encoding="utf-8") as fh:
        fh.write("signal=keyword\nrecorded=2026-09-08T00:00:00Z\nproject=selftest\n")
    write_ledger(profiled, "prose")
    rc_pp, out_pp = _run_child(json.dumps(profile_event), profiled)
    report(32, "profiled-project-silent", rc_pp == 0 and "SHAPE 8" not in out_pp,
           "a profiled build launch with a GATE 0 marker and a prose-only ledger -> rc=%d "
           "(want 0) and no SHAPE 8: %s -- seat-probe.sh answers a profiled project "
           "PROFILE-OWNED and never writes the line"
           % (rc_pp, "yes" if "SHAPE 8" not in out_pp else "NO -- refused"))

    # 13e -- an UNREADABLE ledger is UNDETERMINED, never a verdict. A path
    #        that exists and is not a file is the cheapest way to prove the
    #        third branch of has_seat_probe_line() is wired: without it the
    #        fail-open claim in this file's docstring is untested code.
    unreadable = log_dir("unreadable", 30, ledger="none")
    os.makedirs(os.path.join(unreadable, "CONTROL", "LEDGER.md"), exist_ok=True)
    rc_ur, out_ur = _run_child(payload(FIXTURE_THREE_STAGE), unreadable)
    report(33, "unreadable-ledger-fails-open", rc_ur == 0 and "SHAPE 8" not in out_ur,
           "a CONTROL/LEDGER.md that cannot be read as a file -> rc=%d (want 0) and no "
           "SHAPE 8: %s -- a gate that cannot read the ledger says NOTHING about the probe"
           % (rc_ur, "yes" if "SHAPE 8" not in out_ur else "NO -- refused"))

    # 14 -- SHAPE 9, the repository behind the build. The known-good control
    #       comes FIRST: every fixture below is a REAL git repository, so if git
    #       will not run here the fixtures are broken and their refusals prove
    #       nothing about the gate.
    have_git = git_ok()
    report(34, "git-runs-for-fixtures", have_git,
           "git --version rc 0: %s -- SHAPE 9's proof is `git remote get-url origin`, so "
           "every fixture below is a real repository and not a mock of one"
           % ("yes" if have_git else "NO -- the SHAPE 9 fixtures below are UNDETERMINED, "
              "not evidence"))

    # ONE marked, booked, seat-proven project. ONE build script. Three answers,
    # and the only thing that changes is the receipt.
    anchorless = log_dir("anchorless", 30, anchor="none")
    rc_r0, out_r0 = _run_child(payload(FIXTURE_THREE_STAGE), anchorless)
    ok = (rc_r0 == 2 and "SHAPE 9" in out_r0
          and "SHAPE 7" not in out_r0 and "SHAPE 8" not in out_r0)
    report(35, "no-repo-anchor-blocked", ok,
           "a booked, seat-proven build tree with no CONTROL/repo-anchor.json -> rc=%d "
           "(want 2), SHAPE 9 named: %s, and NOT a SHAPE 7 or SHAPE 8 refusal: %s"
           % (rc_r0, "yes" if "SHAPE 9" in out_r0 else "NO",
              "correct" if "SHAPE 7" not in out_r0 and "SHAPE 8" not in out_r0
              else "NO -- blocked for another rule"))

    anchored = log_dir("anchored", 30)
    rc_r1, out_r1 = _run_child(payload(FIXTURE_THREE_STAGE), anchored)
    report(36, "repo-anchor-allows", rc_r1 == 0,
           "the SAME script once a receipt proves the repository's origin -> rc=%d (want 0). "
           "Without this leg the two around it would score a gate that refused every build%s"
           % (rc_r1, "" if rc_r1 == 0 else " -- output: " + out_r1.strip()[:400]))

    # THE DISCRIMINATING CONTROL: the receipt is PRESENT and origin has moved.
    # A gate that tested only for the FILE passes both legs above and fails here.
    moved = log_dir("movedorigin", 30)
    try:
        subprocess.run(["git", "-C", os.path.join(moved, "repo"), "remote", "set-url",
                        "origin", os.path.join(moved, "somewhere-else.git")],
                       capture_output=True, text=True, timeout=20)
    except Exception:
        pass
    rc_r2, out_r2 = _run_child(payload(FIXTURE_THREE_STAGE), moved)
    report(37, "moved-origin-blocked", rc_r2 == 2 and "SHAPE 9" in out_r2,
           "the SAME receipt with origin re-pointed somewhere else -> rc=%d (want 2) and "
           "SHAPE 9 named: %s -- a receipt that is merely PRESENT proves nothing"
           % (rc_r2, "yes" if "SHAPE 9" in out_r2 else "NO"))

    # 14b -- the profiled half. Check 32 above already proved a profiled build
    #        ALLOWED with its receipt beside documents.state; this removes that
    #        one file and nothing else.
    try:
        os.remove(os.path.join(profiled, ".studio", "repo-anchor.json"))
    except Exception:
        pass
    rc_r3, out_r3 = _run_child(json.dumps(profile_event), profiled)
    report(38, "profiled-missing-anchor-blocked", rc_r3 == 2 and "SHAPE 9" in out_r3,
           "the profiled fixture that passed check 32 with a receipt, once .studio/"
           "repo-anchor.json is removed -> rc=%d (want 2) and SHAPE 9 named: %s. SHAPE 9 is "
           "scoped to BOTH project shapes because the merged-to-GitHub promise is made on "
           "every run" % (rc_r3, "yes" if "SHAPE 9" in out_r3 else "NO"))

    # 14c -- not a build dispatch: SHAPE 9 is silent even with no receipt at all,
    #        the same negative case SHAPE 8 owes.
    nobuild9 = log_dir("nobuild9", 3, anchor="none")
    rc_r4, out_r4 = _run_child(payload(FIXTURE_NO_BUILD_LABEL), nobuild9)
    report(39, "non-build-anchor-silent", rc_r4 == 0 and "SHAPE 9" not in out_r4,
           "an audit-labelled tree in a project with NO repo-anchor receipt -> rc=%d (want 0) "
           "and no SHAPE 9: %s"
           % (rc_r4, "yes" if "SHAPE 9" not in out_r4 else "NO -- refused"))

    # 15 -- fix #5: an Agent call labelled build owes SHAPES 8-10; a reader passes.
    #       Same ledger-less marked project for both legs, only the label differs.
    agentdir = log_dir("agentcall", 3, ledger="none")

    def agent_event(desc):
        return json.dumps({"tool_name": "Agent", "cwd": agentdir, "tool_input": {
            "description": desc, "prompt": "do the unit\nmore", "subagent_type": "general-purpose"}})
    rc_a1, out_a1 = _run_child(agent_event("build unit u01"), agentdir)
    rc_a2, _ = _run_child(agent_event("research reference apps"), agentdir)
    report(40, "agent-build-gated", rc_a1 == 2 and "SHAPE 8" in out_a1 and rc_a2 == 0,
           "Agent 'build unit u01' in a probe-less project -> rc=%d (want 2, SHAPE 8); "
           "Agent 'research reference apps' -> rc=%d (want 0)" % (rc_a1, rc_a2))

    # 15b -- round 7: a reader is never a build. The real blocked call: its
    #        prompt's first line says "build", and it must still pass. The
    #        control, the SAME anchor-less project, still refuses a builder.
    readerdir = log_dir("readercall", 3, anchor="none")

    def reader_event(desc, prompt, kind="general-purpose"):
        return json.dumps({"tool_name": "Agent", "cwd": readerdir, "tool_input": {
            "description": desc, "prompt": prompt, "subagent_type": kind}})
    rc_rd, out_rd = _run_child(reader_event(
        "Read client packet docs",
        "READ-ONLY task. You are a reader for a build run inside the project folder.\n"
        "Read every file and report."), readerdir)
    rc_ex, _ = _run_child(reader_event("scan units", "build nothing, list the files", "Explore"), readerdir)
    rc_bu, out_bu = _run_child(reader_event("Agent build unit", "build unit u01\nwrite the code"), readerdir)
    report(43, "reader-never-a-build",
           rc_rd == 0 and rc_ex == 0 and rc_bu == 2 and "SHAPE 9" in out_bu,
           "reader 'Read client packet docs' / 'READ-ONLY ... for a build run' -> rc=%d (want 0)%s; "
           "Explore -> rc=%d (want 0); 'Agent build unit' with no receipt -> rc=%d (want 2), "
           "SHAPE 9 named: %s" % (rc_rd, "" if rc_rd == 0 else " -- " + out_rd.strip()[:200],
                                  rc_ex, rc_bu, "yes" if "SHAPE 9" in out_bu else "NO"))

    # 16 -- fix #6: a local-only receipt (no origin by design) is accepted.
    #       Its remote field names something origin does not: the old origin
    #       comparison would refuse it, so this leg fails without the fix.
    localonly = log_dir("localonly", 30, anchor="none")
    lrepo = os.path.join(localonly, "repo")
    subprocess.run(["git", "init", "-q", lrepo], capture_output=True, timeout=20)
    write_anchor_receipt(os.path.join(localonly, "CONTROL"), lrepo, lrepo, source="local-only")
    rc_l, out_l = _run_child(payload(FIXTURE_THREE_STAGE), localonly)
    report(41, "local-only-anchor-allows", rc_l == 0,
           "receipt source=local-only on a repo with no origin -> rc=%d (want 0)%s"
           % (rc_l, "" if rc_l == 0 else " -- output: " + out_l.strip()[:300]))

    # 17 -- fix #32, SHAPE 10: an otherwise-allowed project (check 36's shape)
    #       blocked once the tick reads unarmed, and once the start marker is gone.
    opened = log_dir("shape10", 30)
    os.environ["SPEC_PROTOCOL_WATCH_TICK"] = tick_unarmed
    rc_t, out_t = _run_child(payload(FIXTURE_THREE_STAGE), opened)
    os.environ["SPEC_PROTOCOL_WATCH_TICK"] = tick_ok
    os.remove(os.path.join(opened, ".spec-protocol-opened-2026-09-08T00:00:00Z"))
    rc_m, out_m = _run_child(payload(FIXTURE_THREE_STAGE), opened)
    report(42, "shape10-open-and-armed", rc_t == 2 and "SHAPE 10" in out_t
           and rc_m == 2 and "SHAPE 10" in out_m,
           "tick --check rc 3 -> rc=%d (want 2); no start marker -> rc=%d (want 2); SHAPE 10 named"
           % (rc_t, rc_m))

    print("\n".join(results))
    print("")
    if fails == 0:
        print("dispatch-gate.py selftest: ALL PASS (%d checks)" % len(results))
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
