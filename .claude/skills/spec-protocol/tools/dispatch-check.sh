#!/usr/bin/env bash
# dispatch-check.sh — THE PRE-DISPATCH GATE (finding E2; SPEC 8.3 row WI-11).
#
# Usage:
#   dispatch-check.sh <project> <units> <agents> <label> [dep=<reason>] [stages=<n>]
#                     [unit=<work item>] [run=<run id>]
#   dispatch-check.sh --selftest
#   dispatch-check.sh --help
#
# WHAT IT IS FOR. RULE 2's width floor was prose with no script behind it, so
# "3 agents when 10 were possible" was a judgement call the conductor made
# alone, every time, under no instrument. This is the instrument. It is called
# BEFORE a wave fires, it answers in an exit code, and it leaves a row behind.
#
#   floor   = min(units, CLIENT_CAP)      — the skill enforces the FLOOR
#   ceiling = units × stages (default 4)  — the harness owns the real ceiling
#
# The harness caps a workflow at min(16, cores−2) and queues the rest, so a
# script can only ever pass FEWER items than it should. That is the only defect
# this gate can see, and the only one it claims to.
#
# EXIT CODES
#   0  PASS   — the dispatch is at or above the floor and not padded. The
#              dispatch-log row is written through tools/ledger.sh and
#              agents.executions_total in CONTROL/project_state.json is
#              incremented by <agents>, atomically (tmp + rename, under a lock).
#   2  TOOLING FAILURE — the gate could not run: bad usage, a file it must read
#              is missing or unreadable, CLIENT_CAP does not parse, ledger.sh is
#              absent, the state write failed. NEVER a verdict about the
#              dispatch. An exit 2 is "UNDETERMINED", said out loud, with the
#              exact path named — never a silent pass and never a silent block.
#   3  UNDER-WIDTH — agents < min(units, CLIENT_CAP) and no dep= reason was
#              given. This is the timid dispatch, refused.
#   4  REFUSED — the dispatch is malformed or its preconditions are missing:
#              the label does not match [<model> x<N>], or CONTROL/EXECUTION-PLAN.md
#              carries no "Parallelism Plan" heading ("no Parallelism Plan, no
#              dispatch" — references/execution-architecture.md, fail-closed).
#   5  PADDED — agents > units × stages. More seats than the work has stages to
#              put them in; someone inflated the number to satisfy the floor.
#   6  NO-RIGHTSIZE — a BUILD dispatch was attempted while CONTROL/LEDGER.md
#              carries no OVER-ENGINEERING-CHECK: line. The over-engineering
#              check (Law 42) is mandated by SKILL.md step 13 and defined in
#              references/pipeline.md, and the 2026-09-07 canary proved it can
#              be skipped in silence — it was never run and recorded nowhere,
#              and the apparatus outgrew the job unmeasured. This is what makes
#              it unskippable: the run cannot reach a builder without it. Run
#              tools/right-size.sh first; it writes that line, and only on a
#              pass. Like exit 4 this is a fact about the RUN, not a broken
#              tool, so it is kept out of exit 2.
#   7  BUDGET PAUSE — CONTROL/project_state.json says the run is AT or PAST its
#              pause line: agents.executions_total >= agents.first_pause ×
#              (agents.pause_blocks_granted + 1). The 2026-09-07 canary walked
#              from 20 executions to 72 with nothing refusing a single dispatch,
#              because the pause lived in exactly ONE instrument — tools/anchor.sh
#              — which only decides when the five-minute tick runs, and the tick
#              was armed at a step the run never reached. This is that same
#              decision, taken where the dispatch actually happens: deploy the
#              best stable build, write the plain report, ask the one question
#              (SKILL.md section 6). Each "keep going" increments
#              agents.pause_blocks_granted, which moves the wall up by one block
#              and the run resumes at full width. A PAUSE is never a STOP.
#   8  BUDGET CEILING — agents.executions_total >= agents.ceiling (2,000 per
#              project; operator decision 2026-09-07, finding G6). The absolute
#              stop: stop dispatching, run_status=STOPPED_CAP, preserve the best
#              stable build, write the blocker report. It is tested BEFORE the
#              pause, for the reason anchor.sh gives in its own budget audit: a
#              run at the ceiling is also past its pause line, and reporting
#              that as a pause would leave a project able to answer "keep going"
#              past a line it can never cross.
#
# The four the row enumerates are 0/3/5/2. Exits 4 and 6 are the fail-closed
# precondition refusals — a missing Parallelism Plan and a missing
# over-engineering check; both are kept separate from 2 on purpose, because
# calling a real refusal a tooling failure would let it read as a broken tool.
# Exits 7 and 8 are the BUDGET refusals and are kept out of 2 for the same
# reason: the instrument worked perfectly, the RUN is out of budget. When the
# four budget keys cannot be READ, though, the gate does not fall through to a
# pass — it exits 2 and names tools/state-check.sh, because a gate that cannot
# read the budget cannot licence a dispatch against it.
#
# CLIENT_CAP is read from <project>/CAPACITY-LEDGER.md, never declared, never
# asked, never inherited from the environment (finding S1). Two shapes are
# accepted, in this order:
#   1.  CLIENT_CAP=10                                     (tools/width.sh output)
#   2.  clientCap = max(2, min(harness_cap, ram_cap)) = 10   [MEASURED …]
# A line whose value is still the template placeholder (`= <k>`) parses as
# NOTHING, not as a number — an unfilled ledger is undetermined (exit 2), never
# a cap of 2 read out of `max(2, …)`.
#
# --selftest proves the instrument before any verdict is believed. It runs the
# three cases the work item names (10/10 at cap 10 → 0; 10 units, 3 agents,
# no dep= → 3; 4 units, 40 agents → 5), the executions_total arithmetic, both
# CLIENT_CAP parse shapes, the dep= escape hatch, both exit-4 refusals, the
# exit-6 pair (ONE build fixture refused without the OVER-ENGINEERING-CHECK:
# line and passed with it — a pass/fail pair on one fixture, so a broken check
# cannot show as a class-wide refusal), the missing-ledger tooling failure, and
# a known-positive control for every grep it relies on. The budget wall is
# proven on ONE fixture, all three legs: executions_total=19 against a
# first_pause of 20 passes, the SAME fixture at 20 exits 7 naming pause_at=20,
# and one granted block passes it again at 20 — a run where all three legs
# answer alike is a broken test, not a finding. A gate whose known-positive
# comes back negative reports BROKEN INSTRUMENT, never "clean".

set -uo pipefail

# --- The greps. Named, absolute, and proven in the selftest. -----------------
GREP="/usr/bin/grep"
if [[ ! -x "${GREP}" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"; else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"
LEDGER_SH="${SCRIPT_DIR}/ledger.sh"

DEFAULT_STAGES=4
LABEL_RE='\[[A-Za-z0-9.-]+ x[0-9]+\]'

usage() {
  sed -n '2,12p' "${SELF}"
}

# --- Exit helpers. Every one of them says WHICH path it read. ----------------
tooling() { printf 'DISPATCH-CHECK UNDETERMINED | tooling | %s\n' "$1" >&2; exit 2; }
refuse()  { printf 'DISPATCH-CHECK REFUSED | %s\n' "$1" >&2; exit 4; }

is_uint() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# --- CLIENT_CAP, read from the Capacity Ledger ------------------------------
parse_cap() {
  local f="$1" v=""
  v="$(sed -n 's/^[[:space:]]*CLIENT_CAP[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*$/\1/p' "${f}" 2>/dev/null | head -n 1)"
  if [[ -n "${v}" ]]; then printf '%s' "${v}"; return 0; fi
  # Bracketed provenance marks are stripped first ([MEASURED …] carries digits
  # of its own), then the LAST "= <n>" on a clientCap line is the value.
  v="$(sed -e 's/\[[^]]*\]//g' "${f}" 2>/dev/null \
       | sed -n 's/.*[Cc]lient[Cc]ap.*=[[:space:]]*\([0-9][0-9]*\)[[:space:]]*$/\1/p' | head -n 1)"
  if [[ -n "${v}" ]]; then printf '%s' "${v}"; return 0; fi
  return 1
}

# --- The Parallelism Plan gate (fail-closed) --------------------------------
has_parallelism_plan() {
  local f="$1"
  [[ -f "${f}" ]] || return 1
  "${GREP}" -qE '^[[:space:]]*#{1,6}[[:space:]].*Parallelism Plan' "${f}" 2>/dev/null && return 0
  "${GREP}" -qE '^[[:space:]]*(\*\*)?Parallelism Plan' "${f}" 2>/dev/null && return 0
  return 1
}

# --- The over-engineering check gate (fail-closed) ---------------------------
# tools/right-size.sh writes "OVER-ENGINEERING-CHECK: units=… verdict=…" into
# CONTROL/LEDGER.md, and writes it ONLY on a pass. So the presence of the line
# is the proof the check ran and cleared; its absence is the proof it did not.
has_rightsize_line() {
  local f="$1"
  [[ -f "${f}" ]] || return 1
  [[ -r "${f}" ]] || return 1
  "${GREP}" -q 'OVER-ENGINEERING-CHECK:' "${f}" 2>/dev/null && return 0
  return 1
}

# Deliberately broad: any label carrying "build" in any case is a build
# dispatch, "rebuild" included. Fail-closed is the safe direction here — the
# cost of gating one extra dispatch is a re-run of right-size.sh; the cost of
# missing one is the defect this exists to end.
is_build_label() {
  printf '%s' "$1" | "${GREP}" -qi 'build'
}

# --- The budget wall (RC-4b): the pause line and the ceiling -----------------
# Until this block existed, the pause decision lived in exactly one instrument,
# tools/anchor.sh, which only decides when the five-minute tick runs. The
# 2026-09-07 canary never reached the step that armed the tick, so
# executions_total walked from 20 (its own pause line) to 72 with nothing
# mechanical refusing a dispatch. The pause has to be a WALL, not a reminder,
# and a wall stands at the door the dispatch goes through.
#
# jnum below is COPIED, deliberately character for character, from
# tools/anchor.sh's budget audit (its jnum): the same sed, over the same
# newline-stripped text. Two instruments that decide the same pause must never
# disagree about how CONTROL/project_state.json parses. It matches an
# exactly-quoted key at ANY nesting depth and, being greedy, returns the LAST
# occurrence when a key appears twice — anchor.sh's override design, kept
# identical rather than "improved".
jnum() {  # jnum <flat-json-file> <key> -> integer on stdout, or rc 1
  local v
  v="$(sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9][0-9]*\).*/\1/p' "$1" | head -1)"
  [[ -n "$v" ]] || return 1
  printf '%s\n' "$v"
}

# The absolute per-project ceiling (operator decision 2026-09-07, finding G6).
# A state file may lower it; it may never raise it, which is why the state value
# is only taken when it is SMALLER — the same clamp anchor.sh applies.
DEFAULT_CEILING=2000

# budget_gate <state-json> — exits 8 at the ceiling, 7 at the pause line, and 2
# when the budget cannot be read. Returns 0 only when the run is PROVABLY under
# both lines. It never returns 0 on a file it could not measure: an undetermined
# budget is exactly the state in which a dispatch must not be licensed.
budget_gate() {
  local sp="$1" flat=""

  [[ -f "${sp}" ]] \
    || tooling "no state file at ${sp} — the pause line and the ceiling are UNDETERMINED, and an undetermined budget never licences a dispatch. SKILL.md section 6 writes agents.initial, agents.warn_at, agents.first_pause, agents.pause_blocks_granted and agents.ceiling BEFORE the first dispatch; tools/state-check.sh <project> says which of them are missing."
  [[ -r "${sp}" ]] \
    || tooling "state file is unreadable: ${sp} — run tools/state-check.sh <project>; the budget is UNDETERMINED and no dispatch is licensed against it"

  flat="$(mktemp "${TMPDIR:-/tmp}/dispatch-check-state.XXXXXX" 2>/dev/null)" \
    || tooling "could not create a temp file to read ${sp} — the budget is UNDETERMINED"
  if ! tr -d '\n\r' < "${sp}" > "${flat}" 2>/dev/null; then
    rm -f "${flat}" 2>/dev/null || true
    tooling "could not read ${sp} — the budget is UNDETERMINED; run tools/state-check.sh <project>"
  fi

  local exec_t pause_state blocks ceil_state missing=""
  exec_t="$(jnum      "${flat}" 'executions_total'     || true)"
  pause_state="$(jnum "${flat}" 'first_pause'          || true)"
  blocks="$(jnum      "${flat}" 'pause_blocks_granted' || true)"
  ceil_state="$(jnum  "${flat}" 'ceiling'              || true)"
  rm -f "${flat}" 2>/dev/null || true

  [[ -n "${exec_t}"      ]] || missing="${missing} agents.executions_total"
  [[ -n "${pause_state}" ]] || missing="${missing} agents.first_pause"
  [[ -n "${blocks}"      ]] || missing="${missing} agents.pause_blocks_granted"
  [[ -n "${ceil_state}"  ]] || missing="${missing} agents.ceiling"
  [[ -z "${missing}" ]] \
    || tooling "${sp} carries no${missing} — the budget is UNDETERMINED, so this gate refuses instead of passing a dispatch it cannot measure. Run tools/state-check.sh <project>: it exits 3 naming every missing key, and exits 4 when the numbers were computed and written to a near-miss path such as agents.project_budget.* — which is a WRITER defect, not an absent budget."

  is_uint "${exec_t}"      || tooling "agents.executions_total parsed as '${exec_t}' from ${sp}, which is not a non-negative integer — run tools/state-check.sh <project>"
  is_uint "${pause_state}" || tooling "agents.first_pause parsed as '${pause_state}' from ${sp}, which is not a non-negative integer — run tools/state-check.sh <project>"
  is_uint "${blocks}"      || tooling "agents.pause_blocks_granted parsed as '${blocks}' from ${sp}, which is not a non-negative integer — run tools/state-check.sh <project>"
  is_uint "${ceil_state}"  || tooling "agents.ceiling parsed as '${ceil_state}' from ${sp}, which is not a non-negative integer — run tools/state-check.sh <project>"

  local ceil="${DEFAULT_CEILING}" pause
  (( ceil_state < ceil )) && ceil="${ceil_state}"
  pause=$(( pause_state * ( blocks + 1 ) ))
  (( pause > ceil )) && pause="${ceil}"

  # THE CEILING IS TESTED FIRST, as tools/anchor.sh tests it first in its budget
  # audit, and for the reason it gives there: a run at 2,000 is also past its
  # pause line, and reporting that as a pause would leave a project able to
  # answer "keep going" past the absolute ceiling. A run BELOW the ceiling is
  # never STOPPED_CAP — it has budget left, so it pauses and asks instead.
  if (( exec_t >= ceil )); then
    printf 'DISPATCH-CHECK CEILING | executions=%s | ceiling=%s\n' "${exec_t}" "${ceil}" >&2
    printf 'DISPATCH-CHECK NOTE | read: %s | the absolute per-project ceiling is reached: stop dispatching, set run_status=STOPPED_CAP, preserve the best stable build and write the blocker report. A LIMIT REACHED stop is never a PASS and never drift, and it is never crossed without the operator.\n' "${sp}" >&2
    exit 8
  fi
  if (( exec_t >= pause )); then
    printf 'DISPATCH-CHECK PAUSED | executions=%s | pause_at=%s | ceiling=%s\n' "${exec_t}" "${pause}" "${ceil}" >&2
    printf 'DISPATCH-CHECK NOTE | read: %s | pause_at = agents.first_pause %s × (agents.pause_blocks_granted %s + 1). Deploy the best stable build, write the plain report, then ask the one question (SKILL.md section 6). Each "keep going" increments agents.pause_blocks_granted, which moves this wall up by one block, and the run resumes at full width. This is a PAUSE, not a stop.\n' "${sp}" "${pause_state}" "${blocks}" >&2
    exit 7
  fi
  return 0
}

# --- The state counter ------------------------------------------------------
# agents.executions_total is what anchor.sh line ~660 reads for the 200-pause
# and the 2,000-ceiling. Until this gate existed nothing WROTE it, so the cap
# depended on the conductor remembering a number. Written here, atomically,
# once per gated dispatch.
state_lock_dir=""
release_state_lock() {
  if [[ -n "${state_lock_dir}" ]]; then rm -rf "${state_lock_dir}" 2>/dev/null || true; state_lock_dir=""; fi
}
trap release_state_lock EXIT

acquire_state_lock() {
  local d="$1.lock.d" waited=0
  while ! mkdir "${d}" 2>/dev/null; do
    if [[ -d "${d}" ]] && (( waited >= 15 )); then
      # A holder older than any real critical section here (the whole
      # read-modify-write is milliseconds) has crashed. Reclaim once, loudly.
      printf 'DISPATCH-CHECK NOTE | reclaiming stale state lock %s after %ss\n' "${d}" "${waited}" >&2
      rm -rf "${d}" 2>/dev/null || true
      continue
    fi
    if (( waited >= 20 )); then return 1; fi
    sleep 1
    waited=$(( waited + 1 ))
  done
  printf 'pid=%s\n' "$$" > "${d}/owner" 2>/dev/null || true
  state_lock_dir="${d}"
  return 0
}

create_state_file() {
  local sp="$1" total="$2" tmp="$1.tmp.$$"
  mkdir -p "$(dirname "${sp}")" 2>/dev/null || return 1
  {
    printf '{\n'
    printf '  "schema": "spec-protocol/project-state@1",\n'
    printf '  "run_status": "RUNNING",\n'
    printf '  "agents": { "executions_total": %s }\n' "${total}"
    printf '}\n'
  } > "${tmp}" || return 1
  mv "${tmp}" "${sp}" || return 1
  return 0
}

# bump_state <state-path> <delta> — prints the new total on success.
bump_state() {
  local sp="$1" delta="$2" tmp="$1.tmp.$$" out=""
  # DISPATCH_NO_PYTHON=1 forces the awk path. It exists so the selftest can
  # PROVE the fallback on a box that has python3 — an untested fallback is a
  # fallback that fails the first time it is needed.
  if [[ "${DISPATCH_NO_PYTHON:-0}" != "1" ]] && command -v python3 >/dev/null 2>&1; then
    out="$(python3 - "${sp}" "${tmp}" "${delta}" <<'PY' 2>&1
import json, sys
src, tmp, delta = sys.argv[1], sys.argv[2], int(sys.argv[3])
with open(src, encoding="utf-8") as fh:
    doc = json.load(fh)
if not isinstance(doc, dict):
    raise SystemExit("state file root is not a JSON object")
agents = doc.get("agents")
if not isinstance(agents, dict):
    agents = {}
    doc["agents"] = agents
cur = agents.get("executions_total", 0)
if isinstance(cur, bool) or not isinstance(cur, int):
    raise SystemExit("agents.executions_total is not an integer: %r" % (cur,))
agents["executions_total"] = cur + delta
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
print(agents["executions_total"])
PY
)"
    if [[ $? -ne 0 || -z "${out}" ]]; then rm -f "${tmp}" 2>/dev/null || true; printf '%s' "${out}"; return 1; fi
  else
    # No python3: line-based edit of the one field, same atomicity. Exits 3 when
    # the field is not on a line of its own — an unparseable state file is
    # UNDETERMINED, never a silent no-op.
    awk -v d="${delta}" '
      BEGIN { done = 0 }
      {
        if (!done && match($0, /"executions_total"[[:space:]]*:[[:space:]]*[0-9]+/)) {
          seg = substr($0, RSTART, RLENGTH)
          pre = substr($0, 1, RSTART - 1)
          post = substr($0, RSTART + RLENGTH)
          n = seg; sub(/.*:[[:space:]]*/, "", n)
          nn = n + d
          sub(/[0-9]+$/, nn, seg)
          print pre seg post
          print nn > "/dev/stderr"
          done = 1
          next
        }
        print
      }
      END { if (!done) exit 3 }
    ' "${sp}" > "${tmp}" 2>"${tmp}.n"
    if [[ $? -ne 0 ]]; then
      rm -f "${tmp}" "${tmp}.n" 2>/dev/null || true
      printf 'agents.executions_total is not on a parseable line and python3 is absent'
      return 1
    fi
    out="$(tail -n 1 "${tmp}.n" 2>/dev/null)"
    rm -f "${tmp}.n" 2>/dev/null || true
  fi
  mv "${tmp}" "${sp}" || { rm -f "${tmp}" 2>/dev/null || true; printf 'rename failed'; return 1; }
  printf '%s' "${out}"
  return 0
}

# ============================================================================
# The run
# ============================================================================
run_check() {
  (( $# >= 4 )) \
    || { printf 'DISPATCH-CHECK UNDETERMINED | tooling | %s\n' \
         "usage: dispatch-check.sh <project> <units> <agents> <label> [dep=<reason>] [stages=<n>] — got $# argument(s)" >&2; exit 2; }
  local project units agents label
  project="$1"; units="$2"; agents="$3"; label="$4"
  shift 4

  local dep="" stages="${DISPATCH_STAGES:-${DEFAULT_STAGES}}" unit="" run_id="pending"
  local a
  for a in "$@"; do
    case "${a}" in
      dep=*)    dep="${a#dep=}" ;;
      stages=*) stages="${a#stages=}" ;;
      unit=*)   unit="${a#unit=}" ;;
      run=*)    run_id="${a#run=}" ;;
      *) tooling "unrecognised argument '${a}' — the optional arguments are dep=, stages=, unit=, run=" ;;
    esac
  done

  [[ -n "${project}" && -n "${units}" && -n "${agents}" && -n "${label}" ]] \
    || tooling "usage: dispatch-check.sh <project> <units> <agents> <label> [dep=<reason>] [stages=<n>]"
  [[ -n "${GREP}" && -x "${GREP}" ]] \
    || tooling "no usable grep (/usr/bin/grep, /bin/grep, PATH) — the gate cannot read its own inputs, so it claims nothing"
  is_uint "${units}"  || tooling "units must be a non-negative integer, got '${units}'"
  is_uint "${agents}" || tooling "agents must be a non-negative integer, got '${agents}'"
  is_uint "${stages}" || tooling "stages must be a non-negative integer, got '${stages}'"
  (( units  >= 1 ))   || tooling "units=0 — a dispatch of nothing is not a dispatch"
  (( agents >= 1 ))   || tooling "agents=0 — a dispatch of nothing is not a dispatch"
  (( stages >= 1 ))   || tooling "stages=0 — the padding ceiling would be zero"
  [[ -d "${project}" ]] || tooling "project directory does not exist: ${project}"

  local ledger_md="${project}/CAPACITY-LEDGER.md"
  local plan_md="${project}/CONTROL/EXECUTION-PLAN.md"
  local state_json="${project}/CONTROL/project_state.json"

  [[ -f "${ledger_md}" ]] \
    || tooling "no Capacity Ledger at ${ledger_md} — CLIENT_CAP is UNDETERMINED (that file is the only source this gate reads; the environment is never one). Write it at step 6.5 with tools/width.sh."
  [[ -r "${ledger_md}" ]] || tooling "Capacity Ledger is unreadable: ${ledger_md}"

  local cap
  cap="$(parse_cap "${ledger_md}")" || cap=""
  [[ -n "${cap}" ]] \
    || tooling "CLIENT_CAP does not parse from ${ledger_md} — looked for 'CLIENT_CAP=<n>' and for a clientCap line ending in '= <n>'. An unfilled template placeholder is not a number; fill the ledger."
  is_uint "${cap}" || tooling "CLIENT_CAP parsed as non-integer '${cap}' from ${ledger_md}"
  (( cap >= 1 && cap <= 64 )) \
    || tooling "CLIENT_CAP=${cap} from ${ledger_md} is outside 1..64 — that is a mis-parse or a corrupt ledger, not a width"

  # --- Fail-closed precondition: no Parallelism Plan, no dispatch ------------
  has_parallelism_plan "${plan_md}" \
    || refuse "no 'Parallelism Plan' heading in ${plan_md} — no Parallelism Plan, no dispatch (references/execution-architecture.md). Write step 12.7's plan first; it is the document this dispatch has to cite."

  # --- The label (S3): every dispatch is labelled [<model> x<N>] -------------
  printf '%s' "${label}" | "${GREP}" -qE "${LABEL_RE}" \
    || refuse "label '${label}' does not carry ${LABEL_RE} — every dispatch row and every tree name states its seat and its count, e.g. '[Opus x10] build wave-2'. An unlabelled tree is an invisible worker."

  local label_n
  label_n="$(printf '%s' "${label}" | sed -n 's/.*\[[A-Za-z0-9.-]* x\([0-9][0-9]*\)\].*/\1/p' | head -n 1)"
  if [[ -n "${label_n}" ]] && (( label_n != agents )); then
    printf 'DISPATCH-CHECK WARNING | label says x%s but agents=%s — the tree name will not match what ran\n' "${label_n}" "${agents}" >&2
  fi

  # --- Fail-closed precondition: no over-engineering check, no builder ------
  # Ahead of the width arithmetic on purpose: a dispatch that should never fire
  # is refused before its shape is argued about.
  if is_build_label "${label}"; then
    local ledger_doc="${project}/CONTROL/LEDGER.md"
    if ! has_rightsize_line "${ledger_doc}"; then
      printf 'DISPATCH-CHECK NO-RIGHTSIZE | CONTROL/LEDGER.md carries no OVER-ENGINEERING-CHECK: line\n' >&2
      printf 'DISPATCH-CHECK NOTE | read: %s | run tools/right-size.sh %s first — it writes that line, and only on a pass (Law 42, SKILL.md step 13)\n' \
        "${ledger_doc}" "${project}" >&2
      exit 6
    fi
  fi

  # --- Fail-closed precondition: the budget wall (RC-4b) --------------------
  # WI-31 reserved this point between the over-engineering gate above and the
  # width arithmetic below, and this is the block it reserved it for. The order
  # is the point: a dispatch that is past the pause line must not be argued
  # about on width — it must not fire at all, at any width.
  budget_gate "${state_json}"

  # --- The floor (S4). The only number this skill controls. -----------------
  local floor="${units}"
  (( cap < floor )) && floor="${cap}"
  if (( agents < floor )); then
    if [[ -z "${dep}" ]]; then
      printf 'DISPATCH-CHECK UNDER-WIDTH | units=%s cap=%s floor=%s agents=%s | %s\n' \
        "${units}" "${cap}" "${floor}" "${agents}" \
        "pass every dispatchable unit: re-author this dispatch at ${floor} agents, or give the wave dependency that makes it narrower as dep=<reason> (a dependency is a reason; a hunch is not)." >&2
      exit 3
    fi
    printf 'DISPATCH-CHECK NOTE | narrower than the floor by a stated dependency | floor=%s agents=%s dep=%s\n' \
      "${floor}" "${agents}" "${dep}" >&2
  fi

  # --- The padding ceiling --------------------------------------------------
  local pad_ceiling=$(( units * stages ))
  if (( agents > pad_ceiling )); then
    printf 'DISPATCH-CHECK PADDED | units=%s stages=%s ceiling=%s agents=%s | %s\n' \
      "${units}" "${stages}" "${pad_ceiling}" "${agents}" \
      "more seats than the work has stages to put them in. Either the unit count is wrong (split the work into real units) or the agent count was inflated to clear the floor." >&2
    exit 5
  fi

  # --- It passes. Now it is recorded, before anything fires. -----------------
  [[ -x "${LEDGER_SH}" ]] \
    || tooling "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every project write goes through it, so an unlogged dispatch is refused rather than written unlocked"

  local total=""
  if [[ -f "${state_json}" ]]; then
    acquire_state_lock "${state_json}" \
      || tooling "could not acquire ${state_json}.lock.d within 20s — inspect its owner file before removing it; the counter was NOT touched"
    total="$(bump_state "${state_json}" "${agents}")"
    if [[ $? -ne 0 || -z "${total}" ]]; then
      release_state_lock
      tooling "could not increment agents.executions_total in ${state_json}: ${total:-no detail}. Nothing was written; the dispatch is not gated."
    fi
    release_state_lock
  else
    create_state_file "${state_json}" "${agents}" \
      || tooling "could not create ${state_json} — the 200-pause counter has nowhere to live"
    total="${agents}"
    printf 'DISPATCH-CHECK NOTE | created %s — it did not exist; the executions counter starts at this dispatch\n' "${state_json}" >&2
  fi

  local ts row out rc
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  [[ -n "${unit}" ]] || unit="${units}-units"
  row="${ts} | ${unit} | dispatch | ${label} | run=${run_id} | units=${units} | agents=${agents} | cap=${cap} | floor=${floor} | stages=${stages} | dep=${dep:-none} | executions_total=${total}"
  out="$("${LEDGER_SH}" "${project}" "CONTROL/dispatch-log.md" "${row}" 2>&1)"; rc=$?
  if (( rc != 0 )); then
    # Un-bump: the counter moved for a dispatch that has no row. A counter
    # ahead of the log is exactly the drift anchor.sh's budget audit exists to
    # catch, so it is put back rather than left to be discovered later.
    if [[ -f "${state_json}" ]]; then
      if acquire_state_lock "${state_json}"; then
        bump_state "${state_json}" "-${agents}" >/dev/null 2>&1 \
          || printf 'DISPATCH-CHECK WARNING | could not roll back agents.executions_total (+%s) in %s — reconcile it by hand against CONTROL/dispatch-log.md\n' "${agents}" "${state_json}" >&2
        release_state_lock
      fi
    fi
    tooling "ledger.sh failed (rc=${rc}) writing CONTROL/dispatch-log.md: ${out}"
  fi

  printf 'DISPATCH-CHECK PASS | project=%s | units=%s | agents=%s | cap=%s | floor=%s | ceiling=%s | label=%s | dep=%s | executions_total=%s\n' \
    "${project}" "${units}" "${agents}" "${cap}" "${floor}" "${pad_ceiling}" "${label}" "${dep:-none}" "${total}"
  exit 0
}

# ============================================================================
# The selftest — the instrument proven before any verdict is believed
# ============================================================================
FAILS=0
report() { # report <n> <name> <ok 0|1> <detail>
  if [[ "$3" == "1" ]]; then printf 'PASS %-2s %-28s %s\n' "$1" "$2" "$4"
  else printf 'FAIL %-2s %-28s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
}

run_selftest() {
  local T
  T="$(mktemp -d "${TMPDIR:-/tmp}/dispatch-check-selftest.XXXXXX")" || {
    echo "BROKEN INSTRUMENT: cannot create a temp dir for the selftest" >&2; exit 2; }
  # shellcheck disable=SC2064
  trap "release_state_lock; rm -rf '${T}'" EXIT

  # --- control 0: the greps, proven on a known positive first ---------------
  local kp_label kp_head
  kp_label="$(printf '%s' '[Opus x10] build wave-2' | "${GREP}" -cE "${LABEL_RE}")"
  printf '## 4. Parallelism Plan\n' > "${T}/kp.md"
  kp_head="$("${GREP}" -cE '^[[:space:]]*#{1,6}[[:space:]].*Parallelism Plan' "${T}/kp.md")"
  if [[ "${kp_label}" != "1" || "${kp_head}" != "1" ]]; then
    echo "BROKEN INSTRUMENT: the gate's own greps do not match their known-positive controls (label=${kp_label} want 1, heading=${kp_head} want 1). No verdict below can be believed." >&2
    exit 2
  fi
  report 0 "grep-controls" 1 "label known-positive=1, heading known-positive=1 (both on ${GREP})"

  # --- the canonical state file every fixture that DISPATCHES now needs ------
  # The budget wall reads four keys before the width arithmetic, and refuses
  # (exit 2, naming tools/state-check.sh) when it cannot read them. That is the
  # deliberate design — an unreadable budget never licences a dispatch — so
  # every fixture below that expects a width verdict carries the canonical
  # block written at the paths SKILL.md section 6 names.
  #   write_state <path> <executions_total> <first_pause> <blocks> <ceiling>
  write_state() {
    printf '{\n  "schema": "spec-protocol/project-state@1",\n  "run_status": "RUNNING",\n  "agents": {\n    "executions_total": %s,\n    "initial": 35,\n    "warn_at": 150,\n    "first_pause": %s,\n    "pause_blocks_granted": %s,\n    "ceiling": %s\n  }\n}\n' "$2" "$3" "$4" "$5" > "$1"
  }
  # read_state_total <path> — the same sed the report lines use, one place.
  read_state_total() {
    sed -n 's/.*"executions_total"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" 2>/dev/null | head -n 1
  }

  # --- a project fixture ----------------------------------------------------
  local P="${T}/proj"
  mkdir -p "${P}/CONTROL"
  printf 'CLIENT_CAP=10\nBROWSER_CAP=12\nWORKFLOW_CEILING=50\n' > "${P}/CAPACITY-LEDGER.md"
  printf '# Execution plan\n\n## Parallelism Plan\n\nwave 2: 10 units, one tree.\n' > "${P}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P}/CONTROL/project_state.json" 0 200 0 2000
  # Every fixture below that dispatches a BUILD needs the over-engineering line
  # right-size.sh writes, or it is refused with exit 6 before its width is read.
  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=10 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P}/CONTROL/LEDGER.md"

  local rc out total ok
  read_total() { sed -n 's/.*"executions_total"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "${P}/CONTROL/project_state.json" | head -n 1; }

  # --- 1: 10 units at cap 10 with 10 agents → 0 -----------------------------
  out="$(bash "${SELF}" "${P}" 10 10 '[Opus x10] build wave-2' 2>&1)"; rc=$?
  total="$(read_total)"
  ok=0; [[ "${rc}" == "0" && "${total}" == "10" ]] && ok=1
  report 1 "at-cap-passes" "${ok}" "rc=${rc} (want 0); executions_total 0 → ${total} (want 10 = the agent count); ${out}"

  # --- 2: 10 units with 3 agents and no dep= → 3 ----------------------------
  out="$(bash "${SELF}" "${P}" 10 3 '[Opus x3] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "3" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'UNDER-WIDTH' || ok=0
  report 2 "under-width-refused" "${ok}" "rc=${rc} (want 3); message names the floor: ${out}"

  # --- 2b: the counter did NOT move on a refusal ----------------------------
  total="$(read_total)"
  ok=0; [[ "${total}" == "10" ]] && ok=1
  report 3 "refusal-does-not-count" "${ok}" "executions_total still ${total} (want 10) — a refused dispatch never spends budget"

  # --- 3: 4 units with 40 agents → 5 ----------------------------------------
  out="$(bash "${SELF}" "${P}" 4 40 '[Opus x40] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "5" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'PADDED' || ok=0
  report 4 "padding-refused" "${ok}" "rc=${rc} (want 5; ceiling = 4 units × 4 stages = 16); ${out}"

  # --- 4: the dep= escape hatch ---------------------------------------------
  out="$(bash "${SELF}" "${P}" 10 3 '[Opus x3] build wave-2' 'dep=WI-04 must land before the other 7 units unblock' 2>&1)"; rc=$?
  total="$(read_total)"
  ok=0; [[ "${rc}" == "0" && "${total}" == "13" ]] && ok=1
  report 5 "dep-reason-allows" "${ok}" "rc=${rc} (want 0); executions_total 10 → ${total} (want 13)"

  # --- 5: the dispatch-log rows are shaped so anchor.sh can census them ------
  local rows
  rows="$("${GREP}" -cE '^[[:space:]]*(- )?[0-9]{4}-[0-9]{2}-[0-9]{2}[^|]*\|[^|]*\|' "${P}/CONTROL/dispatch-log.md" 2>/dev/null)"
  ok=0; [[ "${rows}" == "2" ]] && ok=1
  report 6 "rows-are-censusable" "${ok}" "anchor.sh's own dispatch-census regex counts ${rows} rows (want 2 — one per PASS, none for the two refusals)"

  # --- 6: a bad label is refused (exit 4) -----------------------------------
  out="$(bash "${SELF}" "${P}" 10 10 'Opus x10 build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "4" ]] && ok=1
  report 7 "bad-label-refused" "${ok}" "rc=${rc} (want 4) for a label with no [<model> x<N>]"

  # --- 7: no Parallelism Plan → exit 4 (fail-closed) ------------------------
  local P2="${T}/proj-noplan"
  mkdir -p "${P2}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P2}/CAPACITY-LEDGER.md"
  printf '# Execution plan\n\nno plan section here.\n' > "${P2}/CONTROL/EXECUTION-PLAN.md"
  out="$(bash "${SELF}" "${P2}" 10 10 '[Opus x10] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "4" ]] && ok=1
  report 8 "no-plan-refused" "${ok}" "rc=${rc} (want 4); ${out}"

  # --- 8: the real ledger line shape parses to the same 10 ------------------
  local P3="${T}/proj-realledger"
  mkdir -p "${P3}/CONTROL"
  {
    printf '# CAPACITY LEDGER — fixture — 2026-09-07T00:00:00Z\n'
    printf 'Cores: 12 · RAM: 24 GB\n'
    printf 'clientCap = max(2, min(harness_cap, ram_cap)) = 10   [MEASURED sysctl-hw.ncpu 2026-09-07T00:00:00Z]\n'
  } > "${P3}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P3}/CONTROL/EXECUTION-PLAN.md"
  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=10 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P3}/CONTROL/LEDGER.md"
  write_state "${P3}/CONTROL/project_state.json" 0 200 0 2000
  # 10 units and 9 agents DISCRIMINATES: it exits 3 only if the cap parsed as
  # 10. A mis-parse of 2 (the `max(2,` on that same line) would make the floor
  # 2, and 9 agents would sail through with exit 0.
  out="$(bash "${SELF}" "${P3}" 10 9 '[Opus x9] build wave-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "3" ]] && ok=1
  report 9 "template-line-parses" "${ok}" "rc=${rc} (want 3 — cap 10 read from the 'clientCap = … = 10 [MEASURED …]' line, floor = min(10,10) = 10 > 9 agents; a mis-parse to 2 would have exited 0); ${out}"

  # --- 8b: a refused dispatch spends no budget ------------------------------
  # This fixture carries the canonical budget block (the wall requires it before
  # any width verdict), so the proof is the COUNTER, not the file's absence: the
  # exit-3 refusal above must have left executions_total exactly where it was.
  local p3_total
  p3_total="$(read_state_total "${P3}/CONTROL/project_state.json")"
  ok=0; [[ "${p3_total}" == "0" ]] && ok=1
  report 10 "no-spend-on-refusal" "${ok}" "executions_total still ${p3_total} (want 0) after the under-width refusal — a refused dispatch never spends budget"

  # --- 9: an unfilled template placeholder is UNDETERMINED, never cap 2 -----
  local P4="${T}/proj-placeholder"
  mkdir -p "${P4}/CONTROL"
  printf 'clientCap = max(2, min(harness_cap, ram_cap)) = <k>   [MEASURED <instrument> <ISO8601>]\n' > "${P4}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n' > "${P4}/CONTROL/EXECUTION-PLAN.md"
  out="$(bash "${SELF}" "${P4}" 10 10 '[Opus x10] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'CLIENT_CAP does not parse' || ok=0
  report 11 "placeholder-undetermined" "${ok}" "rc=${rc} (want 2, NOT a cap of 2 read out of max(2, …)); ${out}"

  # --- 10: a missing Capacity Ledger is a named tooling failure -------------
  local P5="${T}/proj-noledger"
  mkdir -p "${P5}/CONTROL"
  printf '## Parallelism Plan\n' > "${P5}/CONTROL/EXECUTION-PLAN.md"
  out="$(bash "${SELF}" "${P5}" 10 10 '[Opus x10] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q "${P5}/CAPACITY-LEDGER.md" || ok=0
  report 12 "missing-ledger-named" "${ok}" "rc=${rc} (want 2) and the message names the exact path it read"

  # --- 11: the negative control — a project that should NOT pass -----------
  out="$(bash "${SELF}" "${T}/does-not-exist" 10 10 '[Opus x10] x' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  report 13 "missing-project-named" "${ok}" "rc=${rc} (want 2) for a project directory that does not exist"

  # --- 12: the no-python3 fallback increments the same counter --------------
  local P6="${T}/proj-awk"
  mkdir -p "${P6}/CONTROL"
  printf 'CLIENT_CAP=4\n' > "${P6}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n' > "${P6}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P6}/CONTROL/project_state.json" 7 200 0 2000
  out="$(DISPATCH_NO_PYTHON=1 bash "${SELF}" "${P6}" 4 4 '[Sonnet x4] judge wave-2' 2>&1)"; rc=$?
  local awk_total
  awk_total="$(read_state_total "${P6}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "0" && "${awk_total}" == "11" ]] && ok=1
  report 14 "awk-fallback-counts" "${ok}" "rc=${rc} (want 0) with python3 forced off; executions_total 7 → ${awk_total} (want 11)"

  # --- 13: the exit-6 pair — ONE build fixture, both halves ----------------
  # A refusal that fired for every build dispatch would look identical to a
  # working gate from the failing half alone. The same fixture is therefore run
  # twice, with the OVER-ENGINEERING-CHECK: line the only thing that changes.
  local P7="${T}/proj-rightsize"
  mkdir -p "${P7}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P7}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P7}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P7}/CONTROL/project_state.json" 0 200 0 2000

  out="$(bash "${SELF}" "${P7}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "6" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'NO-RIGHTSIZE | CONTROL/LEDGER.md carries no OVER-ENGINEERING-CHECK: line' || ok=0
  printf '%s' "${out}" | "${GREP}" -q "${P7}/CONTROL/LEDGER.md" || ok=0
  local p7_total
  p7_total="$(read_state_total "${P7}/CONTROL/project_state.json")"
  [[ "${p7_total}" == "0" ]] || ok=0
  report 15 "no-rightsize-refused" "${ok}" "rc=${rc} (want 6) for a build dispatch with no OVER-ENGINEERING-CHECK: line; the message names the exact path read and no counter moved (executions_total still ${p7_total}, want 0)"

  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=10 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P7}/CONTROL/LEDGER.md"
  out="$(bash "${SELF}" "${P7}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  report 16 "rightsize-line-allows" "${ok}" "rc=${rc} (want 0) — the SAME dispatch, on the SAME fixture, with the ledger line added and nothing else changed. This half is what proves exit 6 is a fact about the missing line and not a class-wide refusal of build dispatches; ${out}"

  # --- 14: THE BUDGET WALL — three legs on ONE fixture (RC-4b) --------------
  # One fixture, three answers. A run where all three legs return the same code
  # is a broken test, not a finding: the pass leg proves the wall is not a
  # class-wide refusal of dispatches, the refusal leg proves it stands, and the
  # granted-block leg proves the wall MOVES rather than being a fixed number.
  local P8="${T}/proj-pause"
  mkdir -p "${P8}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P8}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P8}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P8}/CONTROL/project_state.json" 19 20 0 2000

  local p8_total
  out="$(bash "${SELF}" "${P8}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  p8_total="$(read_state_total "${P8}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "0" && "${p8_total}" == "20" ]] && ok=1
  report 17 "under-the-pause-passes" "${ok}" "rc=${rc} (want 0) at executions_total=19 against first_pause=20; the pass moved the counter 19 → ${p8_total} (want 20), which is what puts the SAME fixture on the far side of the line for the next leg"

  out="$(bash "${SELF}" "${P8}" 1 1 '[Sonnet x1] judge unit-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "7" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'DISPATCH-CHECK PAUSED | executions=20 | pause_at=20 | ceiling=2000' || ok=0
  p8_total="$(read_state_total "${P8}/CONTROL/project_state.json")"
  [[ "${p8_total}" == "20" ]] || ok=0
  report 18 "at-the-pause-refused" "${ok}" "rc=${rc} (want 7) on the SAME fixture one execution later; the line names pause_at=20 and the counter did not move (${p8_total}, want 20): ${out}"

  write_state "${P8}/CONTROL/project_state.json" 20 20 1 2000
  out="$(bash "${SELF}" "${P8}" 1 1 '[Sonnet x1] judge unit-3' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  report 19 "granted-block-moves-the-wall" "${ok}" "rc=${rc} (want 0) at the SAME executions_total=20 with agents.pause_blocks_granted=1 — the wall is 20 × (1+1) = 40, so a granted block resumes the run at full width rather than raising a new number"

  # --- 15: the ceiling outranks the pause -----------------------------------
  # At the ceiling a run is ALSO past its pause line. Reporting that as a pause
  # would leave a project able to answer "keep going" past a line it can never
  # cross, so the ceiling is tested first — as tools/anchor.sh tests it first.
  local P9="${T}/proj-ceiling"
  mkdir -p "${P9}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P9}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P9}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P9}/CONTROL/project_state.json" 2000 20 0 2000
  out="$(bash "${SELF}" "${P9}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "8" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'DISPATCH-CHECK CEILING | executions=2000 | ceiling=2000' || ok=0
  if printf '%s' "${out}" | "${GREP}" -q 'DISPATCH-CHECK PAUSED'; then ok=0; fi
  report 20 "ceiling-outranks-pause" "${ok}" "rc=${rc} (want 8, NOT 7) at executions_total=2000 against ceiling=2000 and a pause line it is also past; the output says CEILING and never PAUSED"

  # --- 16: no budget keys is UNDETERMINED, never a pass ---------------------
  local P10="${T}/proj-nobudget"
  mkdir -p "${P10}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P10}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P10}/CONTROL/EXECUTION-PLAN.md"
  printf '{\n  "schema": "spec-protocol/project-state@1",\n  "agents": { "executions_total": 5 }\n}\n' > "${P10}/CONTROL/project_state.json"
  out="$(bash "${SELF}" "${P10}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'tools/state-check.sh' || ok=0
  printf '%s' "${out}" | "${GREP}" -q 'agents.first_pause' || ok=0
  local p10_total
  p10_total="$(read_state_total "${P10}/CONTROL/project_state.json")"
  [[ "${p10_total}" == "5" ]] || ok=0
  report 21 "no-budget-keys-undetermined" "${ok}" "rc=${rc} (want 2, NEVER 0) for a state file carrying executions_total alone; the message names tools/state-check.sh and every missing key, and the counter did not move (${p10_total}, want 5): ${out}"

  # --- 17: no state file at all is the same answer --------------------------
  local P11="${T}/proj-nostate"
  mkdir -p "${P11}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P11}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P11}/CONTROL/EXECUTION-PLAN.md"
  out="$(bash "${SELF}" "${P11}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q "${P11}/CONTROL/project_state.json" || ok=0
  printf '%s' "${out}" | "${GREP}" -q 'tools/state-check.sh' || ok=0
  if [[ -f "${P11}/CONTROL/project_state.json" ]]; then ok=0; fi
  report 22 "no-state-file-undetermined" "${ok}" "rc=${rc} (want 2) when CONTROL/project_state.json does not exist: the gate names the exact path and tools/state-check.sh, and it does NOT seed a file to dispatch against — the budget block is written at SKILL.md section 6, before the first dispatch"

  printf '\n'
  if (( FAILS == 0 )); then
    printf 'dispatch-check.sh selftest: ALL PASS (23 checks)\n'
    exit 0
  fi
  printf 'dispatch-check.sh selftest: %s FAILED — this gate is a BROKEN INSTRUMENT; do the width arithmetic by hand and say so in the ledger\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --help|-h)  usage; exit 0 ;;
  "")         usage >&2; exit 2 ;;
  *)          run_check "$@" ;;
esac
